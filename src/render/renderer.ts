import type { SceneState, Instance } from "../scene/types";
import { cellKey } from "../scene/types";
import { visibleCellRange } from "../scene/grid";
import type { Library } from "../features/library";
import { paletteById, colorAt } from "../features/palette";
import { maskField, sampleMask } from "../features/noise";
import { mapCycleTime, sampleLifecycle } from "../anim/animations";
import type { AnimOutput } from "../anim/animations";
import { buildOrderField } from "../anim/order";
import { instanceGeom } from "../scene/geom";

const SVGNS = "http://www.w3.org/2000/svg";
const EMPTY_ANIM: AnimOutput = {};

/** Translates scene state into live SVG. Source of truth stays in the store;
 *  this only reflects it, applying minimal add/remove/update diffs and
 *  virtualizing to the visible cell range so the plane can be "infinite". */
export class Renderer {
  readonly svg: SVGSVGElement;
  private defs: SVGDefsElement;
  private gridRect: SVGRectElement;
  private gridDot: SVGCircleElement;
  private gridPattern: SVGPatternElement;
  private content: SVGGElement;
  private maskLayer: SVGGElement;
  private maskRects: SVGRectElement[] = [];
  private pathLayer: SVGGElement;
  private pathLine: SVGPolylineElement;
  private pathStart: SVGTextElement;
  private pathFinish: SVGTextElement;
  private frameLayer: SVGGElement;
  private frameRects: SVGRectElement[] = [];
  private nodes = new Map<string, SVGUseElement>(); // cellKey -> <use>
  private registeredSymbols = new Set<string>();

  constructor(
    private host: HTMLElement,
    private library: Library,
  ) {
    this.svg = document.createElementNS(SVGNS, "svg");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", "100%");
    this.svg.style.display = "block";
    this.svg.style.touchAction = "none";

    this.defs = document.createElementNS(SVGNS, "defs");

    // Dot-grid background: a <pattern> of a single dot tiled in world space, so
    // the dots align to cell corners and pan/zoom with the content.
    this.gridPattern = document.createElementNS(SVGNS, "pattern");
    this.gridPattern.setAttribute("id", "grid-dots");
    this.gridPattern.setAttribute("patternUnits", "userSpaceOnUse");
    this.gridDot = document.createElementNS(SVGNS, "circle");
    this.gridDot.setAttribute("cx", "0");
    this.gridDot.setAttribute("cy", "0");
    this.gridDot.setAttribute("class", "grid-dot");
    this.gridPattern.appendChild(this.gridDot);
    this.defs.appendChild(this.gridPattern);
    this.gridRect = document.createElementNS(SVGNS, "rect");
    this.gridRect.setAttribute("fill", "url(#grid-dots)");

    this.content = document.createElementNS(SVGNS, "g");
    this.content.setAttribute("class", "content");
    this.maskLayer = document.createElementNS(SVGNS, "g");
    this.maskLayer.setAttribute("class", "mask-overlay");
    this.maskLayer.style.pointerEvents = "none";

    // Order-path overlay: the drawn reveal line with START / FINISH labels.
    this.pathLayer = document.createElementNS(SVGNS, "g");
    this.pathLayer.setAttribute("class", "order-path");
    this.pathLayer.style.pointerEvents = "none";
    this.pathLine = document.createElementNS(SVGNS, "polyline");
    this.pathStart = this.makeLabel("START", "#37b24d");
    this.pathFinish = this.makeLabel("FINISH", "#f03e3e");
    this.pathLayer.append(this.pathLine, this.pathStart, this.pathFinish);

    // Export-frame overlay: 4 dark rects (letterbox) + a border on the frame.
    this.frameLayer = document.createElementNS(SVGNS, "g");
    this.frameLayer.setAttribute("class", "export-frame");
    this.frameLayer.style.pointerEvents = "none";
    for (let i = 0; i < 4; i++) {
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("fill", "#000");
      rect.setAttribute("fill-opacity", "0.55");
      this.frameRects.push(rect);
      this.frameLayer.appendChild(rect);
    }

    this.svg.append(
      this.defs,
      this.gridRect,
      this.content,
      this.maskLayer,
      this.pathLayer,
      this.frameLayer,
    );
    this.host.appendChild(this.svg);
  }

  get hostSize() {
    return { width: this.host.clientWidth, height: this.host.clientHeight };
  }

  /** Register an asset as a <symbol> once; instanced via <use href="#sym-…">. */
  private ensureSymbol(assetId: string): void {
    if (this.registeredSymbols.has(assetId)) return;
    const asset = this.library.get(assetId);
    if (!asset) return;
    const sym = document.createElementNS(SVGNS, "symbol");
    sym.setAttribute("id", `sym-${assetId}`);
    sym.setAttribute("viewBox", asset.viewBox);
    sym.setAttribute("overflow", "visible");
    sym.innerHTML = asset.markup;
    this.defs.appendChild(sym);
    this.registeredSymbols.add(assetId);
  }

  render(state: SceneState, time = 0): void {
    const cam = state.camera;
    this.svg.setAttribute("viewBox", `${cam.x} ${cam.y} ${cam.w} ${cam.h}`);
    this.renderGrid(state);
    this.renderInstances(state, time);
    this.renderMask(state);
    this.renderOrderPath(state);
    this.renderFrame(state);
  }

  /** Letterbox overlay: darken everything outside the export frame + outline it. */
  private renderFrame(state: SceneState): void {
    const f = state.frame;
    if (!f.show) {
      this.frameLayer.style.display = "none";
      return;
    }
    this.frameLayer.style.display = "";
    const cam = state.camera;
    const set = (rect: SVGRectElement, x: number, y: number, w: number, h: number) => {
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(Math.max(0, w)));
      rect.setAttribute("height", String(Math.max(0, h)));
    };
    // top, bottom, left, right bands around the frame, clipped to the viewport.
    set(this.frameRects[0], cam.x, cam.y, cam.w, f.y - cam.y);
    set(this.frameRects[1], cam.x, f.y + f.h, cam.w, cam.y + cam.h - (f.y + f.h));
    set(this.frameRects[2], cam.x, f.y, f.x - cam.x, f.h);
    set(this.frameRects[3], f.x + f.w, f.y, cam.x + cam.w - (f.x + f.w), f.h);
  }

  private makeLabel(text: string, color: string): SVGTextElement {
    const t = document.createElementNS(SVGNS, "text");
    t.textContent = text;
    t.setAttribute("fill", color);
    t.setAttribute("stroke", "#000");
    t.setAttribute("paint-order", "stroke");
    t.setAttribute("font-weight", "700");
    t.setAttribute("font-family", "system-ui, sans-serif");
    t.setAttribute("text-anchor", "middle");
    return t;
  }

  /** Draw the hand-drawn reveal path (world coords) with START/FINISH labels. */
  private renderOrderPath(state: SceneState): void {
    const path = state.orderPath;
    const relevant = state.tool === "path" || state.animation.order === "free";
    if (path.length < 2 || !relevant) {
      this.pathLayer.style.display = "none";
      this.pathLine.setAttribute("points", "");
      return;
    }
    this.pathLayer.style.display = "";
    const cam = state.camera;
    const px = 1 / (this.hostSize.width / cam.w); // world units per device px
    this.pathLine.setAttribute("points", path.map((p) => `${p.x},${p.y}`).join(" "));
    this.pathLine.setAttribute("fill", "none");
    this.pathLine.setAttribute("stroke", "#1c3980");
    this.pathLine.setAttribute("stroke-width", String(3 * px));
    this.pathLine.setAttribute("stroke-linejoin", "round");
    this.pathLine.setAttribute("stroke-linecap", "round");
    this.pathLine.setAttribute("stroke-dasharray", `${6 * px} ${5 * px}`);

    const fs = state.cellSize * 0.45;
    const place = (el: SVGTextElement, p: { x: number; y: number }) => {
      el.setAttribute("x", String(p.x));
      el.setAttribute("y", String(p.y - fs * 0.5));
      el.setAttribute("font-size", String(fs));
      el.setAttribute("stroke-width", String(px * 3));
    };
    place(this.pathStart, path[0]);
    place(this.pathFinish, path[path.length - 1]);
  }

  /** Live mask preview: shade visible cells by the fractal field (grayscale)
   *  and outline the cells that "Apply" would fill (accent) or erase (red). */
  private renderMask(state: SceneState): void {
    if (!state.maskPreview) {
      for (const rect of this.maskRects) rect.style.display = "none";
      return;
    }
    const { camera: cam, cellSize, mask } = state;
    const field = maskField(mask.seed);
    const r = visibleCellRange(cam, cellSize, 0);
    let i = 0;
    for (let row = r.minRow; row <= r.maxRow; row++) {
      for (let col = r.minCol; col <= r.maxCol; col++) {
        const rect = this.maskRect(i++);
        const v = sampleMask(field, col, row, mask);
        const lit = v >= mask.threshold;
        const occupied = !!state.instances[cellKey(col, row)];
        const g = Math.round(v * 255);
        rect.setAttribute("x", String(col * cellSize));
        rect.setAttribute("y", String(row * cellSize));
        rect.setAttribute("width", String(cellSize));
        rect.setAttribute("height", String(cellSize));
        rect.setAttribute("fill", `rgb(${g},${g},${g})`);
        // Keep the overlay faint so the artwork (and its animation) show
        // through; the action outlines below carry the important info.
        rect.setAttribute("fill-opacity", "0.18");
        // Action hints: green where it will add, red where it will remove.
        if (lit && !occupied) {
          rect.setAttribute("stroke", "#37b24d");
          rect.setAttribute("stroke-opacity", "0.9");
        } else if (!lit && occupied) {
          rect.setAttribute("stroke", "#f03e3e");
          rect.setAttribute("stroke-opacity", "0.9");
        } else {
          rect.setAttribute("stroke", "none");
        }
        rect.setAttribute("stroke-width", String(2 / (this.hostSize.width / cam.w)));
        rect.style.display = "";
      }
    }
    for (; i < this.maskRects.length; i++) this.maskRects[i].style.display = "none";
  }

  private maskRect(i: number): SVGRectElement {
    let rect = this.maskRects[i];
    if (!rect) {
      rect = document.createElementNS(SVGNS, "rect");
      this.maskLayer.appendChild(rect);
      this.maskRects[i] = rect;
    }
    return rect;
  }

  private renderGrid(state: SceneState): void {
    const { camera: cam, cellSize } = state;
    const zoom = this.hostSize.width / cam.w;
    // Hide dots when cells get sub-pixel (zoomed far out) to avoid moiré.
    if (cellSize * zoom < 6) {
      this.gridRect.setAttribute("fill", "none");
      return;
    }
    this.gridRect.setAttribute("fill", "url(#grid-dots)");
    // Tile = one cell; a dot at the tile corner lands on every cell corner.
    this.gridPattern.setAttribute("width", String(cellSize));
    this.gridPattern.setAttribute("height", String(cellSize));
    this.gridDot.setAttribute("r", String(1.3 / zoom)); // ~1.3 device px
    // Cover the whole viewport with the dot fill.
    this.gridRect.setAttribute("x", String(cam.x));
    this.gridRect.setAttribute("y", String(cam.y));
    this.gridRect.setAttribute("width", String(cam.w));
    this.gridRect.setAttribute("height", String(cam.h));
  }

  private renderInstances(state: SceneState, time: number): void {
    const { camera: cam, cellSize, instances, animation: anim } = state;
    const palette = paletteById(state.palettes, state.activePaletteId);
    const r = visibleCellRange(cam, cellSize, 1);
    const seen = new Set<string>();

    // Lifecycle animation only runs while playing; paused = static scene.
    const animate = anim.playing;
    const orderOf = animate ? buildOrderField(state) : null;
    const T = time * anim.speed;
    const tcyc = animate ? mapCycleTime(anim, T) : 0;

    for (let row = r.minRow; row <= r.maxRow; row++) {
      for (let col = r.minCol; col <= r.maxCol; col++) {
        const key = cellKey(col, row);
        const inst = instances[key];
        if (!inst) continue;
        seen.add(key);
        this.ensureSymbol(inst.assetId);
        let node = this.nodes.get(key);
        if (!node) {
          node = document.createElementNS(SVGNS, "use");
          this.content.appendChild(node);
          this.nodes.set(key, node);
        }
        // Sample this instance's lifecycle at the current cycle time. Its
        // order (when it appears) comes from the active order preset.
        let out: AnimOutput = EMPTY_ANIM;
        if (animate && orderOf) {
          out = sampleLifecycle(anim, orderOf(inst), tcyc, T);
        }
        this.applyInstance(node, inst, cellSize, colorAt(palette, inst.colorIndex), out);
      }
    }

    // Recycle nodes that scrolled out of view or were erased.
    for (const [key, node] of this.nodes) {
      if (!seen.has(key)) {
        node.remove();
        this.nodes.delete(key);
      }
    }
  }

  private applyInstance(
    node: SVGUseElement,
    inst: Instance,
    cellSize: number,
    color: string,
    anim: AnimOutput,
  ): void {
    node.setAttribute("href", `#sym-${inst.assetId}`);
    const g = instanceGeom(inst, cellSize, anim);
    node.setAttribute("x", String(g.x));
    node.setAttribute("y", String(g.y));
    node.setAttribute("width", String(g.size));
    node.setAttribute("height", String(g.size));
    node.style.color = color; // drives currentColor in the symbol
    node.setAttribute("transform", g.rot ? `rotate(${g.rot} ${g.cx} ${g.cy})` : "");
    if (g.opacity < 1) node.setAttribute("opacity", g.opacity.toFixed(3));
    else node.removeAttribute("opacity");
    node.dataset.instId = inst.id;
  }

  /** Force a full rebuild (e.g. after palette swap that changes every color). */
  invalidate(): void {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
  }
}
