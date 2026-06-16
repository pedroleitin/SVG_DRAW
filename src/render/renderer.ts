import type { SceneState, Instance } from "../scene/types";
import { cellKey } from "../scene/types";
import { visibleCellRange } from "../scene/grid";
import type { Library } from "../features/library";
import { paletteById, colorAt } from "../features/palette";
import { maskField, sampleMask } from "../features/noise";
import { mapCycleTime, sampleLifecycle } from "../anim/animations";
import type { AnimOutput } from "../anim/animations";
import { buildOrderField } from "../anim/order";
import { instanceGeom, cellBgRect } from "../scene/geom";
import { brushCells } from "../scene/grid";

const SVGNS = "http://www.w3.org/2000/svg";
const EMPTY_ANIM: AnimOutput = {};
const ORDER_COLOR = "#e03131";

/** Translates scene state into live SVG. Source of truth stays in the store;
 *  this only reflects it, applying minimal add/remove/update diffs and
 *  virtualizing to the visible cell range so the plane can be "infinite". */
export class Renderer {
  readonly svg: SVGSVGElement;
  private defs: SVGDefsElement;
  private gridRect: SVGRectElement;
  private gridDot: SVGCircleElement;
  private gridPattern: SVGPatternElement;
  private cellBgLayer: SVGGElement;
  private cellBgNodes = new Map<string, SVGRectElement>(); // cellKey -> bg <rect>
  private content: SVGGElement;
  private hoverLayer: SVGGElement;
  private hoverCellsGroup: SVGGElement;
  private hoverRects: SVGRectElement[] = [];
  private hoverBg: SVGRectElement;
  private hoverGhost: SVGUseElement;
  private hoverPt: { cx: number; cy: number } | null = null; // fractional cell coords
  private lastState?: SceneState;
  private maskLayer: SVGGElement;
  private maskRects: SVGRectElement[] = [];
  private pathLayer: SVGGElement;
  private pathLine: SVGPolylineElement;
  private pathStart: SVGTextElement;
  private pathFinish: SVGTextElement;
  private pathDotStart: SVGCircleElement;
  private pathDotFinish: SVGCircleElement;
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

    // Per-cell colored background squares, drawn behind the artwork.
    this.cellBgLayer = document.createElementNS(SVGNS, "g");
    this.cellBgLayer.setAttribute("class", "cell-bg");

    this.content = document.createElementNS(SVGNS, "g");
    this.content.setAttribute("class", "content");

    // Hover overlay: a highlight on the cell under the cursor + a faint ghost
    // of the brush asset.
    this.hoverLayer = document.createElementNS(SVGNS, "g");
    this.hoverLayer.setAttribute("class", "hover-overlay");
    this.hoverLayer.style.pointerEvents = "none";
    this.hoverLayer.style.display = "none";
    // Footprint highlights (one rect per brush cell), then the bg + asset ghost.
    this.hoverCellsGroup = document.createElementNS(SVGNS, "g");
    this.hoverBg = document.createElementNS(SVGNS, "rect");
    this.hoverBg.setAttribute("opacity", "0.5");
    this.hoverGhost = document.createElementNS(SVGNS, "use");
    this.hoverGhost.setAttribute("opacity", "0.4");
    this.hoverLayer.append(this.hoverCellsGroup, this.hoverBg, this.hoverGhost);

    this.maskLayer = document.createElementNS(SVGNS, "g");
    this.maskLayer.setAttribute("class", "mask-overlay");
    this.maskLayer.style.pointerEvents = "none";

    // Order-path overlay: the drawn reveal line with START / FINISH labels.
    this.pathLayer = document.createElementNS(SVGNS, "g");
    this.pathLayer.setAttribute("class", "order-path");
    this.pathLayer.style.pointerEvents = "none";
    this.pathLine = document.createElementNS(SVGNS, "polyline");
    this.pathDotStart = this.makeDot();
    this.pathDotFinish = this.makeDot();
    this.pathStart = this.makeLabel("START");
    this.pathFinish = this.makeLabel("FINISH");
    this.pathLayer.append(
      this.pathLine,
      this.pathDotStart,
      this.pathDotFinish,
      this.pathStart,
      this.pathFinish,
    );

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
      this.cellBgLayer,
      this.content,
      this.hoverLayer,
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
    this.lastState = state;
    const cam = state.camera;
    this.svg.setAttribute("viewBox", `${cam.x} ${cam.y} ${cam.w} ${cam.h}`);
    this.renderGrid(state);
    this.renderInstances(state, time);
    this.renderHover();
    this.renderMask(state);
    this.renderOrderPath(state);
    this.renderFrame(state);
  }

  /** Set the cursor position in fractional cell coords (or null). Updates only
   *  the hover overlay. */
  setHover(cx: number | null, cy = 0): void {
    this.hoverPt = cx === null ? null : { cx, cy };
    this.renderHover();
  }

  /** Highlight the cells the brush would paint + a faint ghost of the asset. */
  private renderHover(): void {
    const state = this.lastState;
    const pt = this.hoverPt;
    const placing = state && (state.tool === "draw" || state.tool === "erase");
    if (!state || !pt || !placing) {
      this.hoverLayer.style.display = "none";
      return;
    }
    this.hoverLayer.style.display = "";
    const cs = state.cellSize;
    const erase = state.tool === "erase";
    const px = state.camera.w / this.hostSize.width; // world units per screen px
    // Anchor cell (under the cursor) for the single-cell bg/ghost previews.
    const anchor = { col: Math.floor(pt.cx), row: Math.floor(pt.cy) };

    // Highlight every cell the brush would paint (shape + size preview).
    const inset = 3 * px;
    const cells = brushCells(pt.cx, pt.cy, state.brushSize, state.brushShape);
    cells.forEach((c, i) => {
      const r = this.hoverRectAt(i);
      r.setAttribute("x", String(c.col * cs + inset));
      r.setAttribute("y", String(c.row * cs + inset));
      r.setAttribute("width", String(cs - inset * 2));
      r.setAttribute("height", String(cs - inset * 2));
      r.setAttribute("rx", String(10 * px));
      r.style.display = "";
    });
    for (let i = cells.length; i < this.hoverRects.length; i++) {
      this.hoverRects[i].style.display = "none";
    }

    // The single-cell bg/asset previews only make sense for a 1× brush.
    const single = state.brushSize <= 1;
    const palette = paletteById(state.palettes, state.activePaletteId);
    if (single && !erase && state.activeBgIndex != null) {
      const bgIdx = state.activeBgIndex === "random" ? 0 : state.activeBgIndex;
      this.hoverBg.setAttribute("x", String(anchor.col * cs));
      this.hoverBg.setAttribute("y", String(anchor.row * cs));
      this.hoverBg.setAttribute("width", String(cs));
      this.hoverBg.setAttribute("height", String(cs));
      this.hoverBg.setAttribute("fill", colorAt(palette, bgIdx));
      this.hoverBg.style.display = "";
    } else {
      this.hoverBg.style.display = "none";
    }

    // Ghost preview of the asset that would be drawn (skip for random/erase).
    const assetId = state.brushAsset;
    if (single && !erase && assetId !== "random" && this.library.get(assetId)) {
      this.ensureSymbol(assetId);
      const size = cs * 0.85;
      const x = (anchor.col + 0.5) * cs - size / 2;
      const y = (anchor.row + 0.5) * cs - size / 2;
      this.hoverGhost.setAttribute("href", `#sym-${assetId}`);
      this.hoverGhost.setAttribute("x", String(x));
      this.hoverGhost.setAttribute("y", String(y));
      this.hoverGhost.setAttribute("width", String(size));
      this.hoverGhost.setAttribute("height", String(size));
      this.hoverGhost.style.color = colorAt(palette, state.activeColorIndex);
      this.hoverGhost.style.display = "";
    } else {
      this.hoverGhost.style.display = "none";
    }
  }

  /** Lazily grow the pool of footprint-highlight rects. */
  private hoverRectAt(i: number): SVGRectElement {
    let rect = this.hoverRects[i];
    if (!rect) {
      rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("class", "hover-cell");
      this.hoverCellsGroup.appendChild(rect);
      this.hoverRects[i] = rect;
    }
    return rect;
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

  private makeLabel(text: string): SVGTextElement {
    const t = document.createElementNS(SVGNS, "text");
    t.textContent = text;
    t.setAttribute("fill", ORDER_COLOR);
    t.setAttribute("font-weight", "600");
    t.setAttribute("font-family", "system-ui, sans-serif");
    t.setAttribute("text-anchor", "middle");
    return t;
  }

  private makeDot(): SVGCircleElement {
    const c = document.createElementNS(SVGNS, "circle");
    c.setAttribute("fill", ORDER_COLOR);
    return c;
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
    this.pathLine.setAttribute("stroke", ORDER_COLOR);
    this.pathLine.setAttribute("stroke-width", String(2.5 * px));
    this.pathLine.setAttribute("stroke-linejoin", "round");
    this.pathLine.setAttribute("stroke-linecap", "round");
    this.pathLine.removeAttribute("stroke-dasharray"); // solid line

    const start = path[0];
    const finish = path[path.length - 1];
    const dotR = 4.5 * px;
    const dot = (c: SVGCircleElement, p: { x: number; y: number }) => {
      c.setAttribute("cx", String(p.x));
      c.setAttribute("cy", String(p.y));
      c.setAttribute("r", String(dotR));
    };
    dot(this.pathDotStart, start);
    dot(this.pathDotFinish, finish);

    const fs = 14 * px; // ~14 screen px regardless of zoom
    const place = (el: SVGTextElement, p: { x: number; y: number }) => {
      el.setAttribute("x", String(p.x));
      el.setAttribute("y", String(p.y - dotR - 5 * px));
      el.setAttribute("font-size", String(fs));
    };
    place(this.pathStart, start);
    place(this.pathFinish, finish);
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
    // Hidden by the user, or when cells get sub-pixel (zoomed far out).
    if (!state.showGrid || cellSize * zoom < 6) {
      this.gridRect.setAttribute("fill", "none");
      return;
    }
    this.gridRect.setAttribute("fill", "url(#grid-dots)");
    // Tile = one cell; a dot at the tile corner lands on every cell corner.
    this.gridPattern.setAttribute("width", String(cellSize));
    this.gridPattern.setAttribute("height", String(cellSize));
    this.gridDot.setAttribute("r", String(1.8 / zoom)); // ~1.8 device px
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
        this.applyCellBg(key, inst, cellSize, palette, out, state.cellRounded, state.cellGutter);
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
    for (const [key, rect] of this.cellBgNodes) {
      if (!seen.has(key)) {
        rect.remove();
        this.cellBgNodes.delete(key);
      }
    }
  }

  /** Draw (or remove) the colored cell-background square behind an instance.
   *  Stays fixed to the cell; only the lifecycle opacity is shared so it
   *  fades in/out with its artwork. */
  private applyCellBg(
    key: string,
    inst: Instance,
    cellSize: number,
    palette: Parameters<typeof colorAt>[0],
    anim: AnimOutput,
    rounded: boolean,
    gutter: boolean,
  ): void {
    let rect = this.cellBgNodes.get(key);
    if (inst.bgIndex == null) {
      if (rect) {
        rect.remove();
        this.cellBgNodes.delete(key);
      }
      return;
    }
    if (!rect) {
      rect = document.createElementNS(SVGNS, "rect");
      this.cellBgLayer.appendChild(rect);
      this.cellBgNodes.set(key, rect);
    }
    const box = cellBgRect(inst.col, inst.row, cellSize, rounded, gutter);
    rect.setAttribute("x", String(box.x));
    rect.setAttribute("y", String(box.y));
    rect.setAttribute("width", String(box.w));
    rect.setAttribute("height", String(box.h));
    if (box.rx) rect.setAttribute("rx", String(box.rx));
    else rect.removeAttribute("rx");
    rect.setAttribute("fill", colorAt(palette, inst.bgIndex));
    const op = anim.opacity ?? 1;
    if (op < 1) rect.setAttribute("opacity", op.toFixed(3));
    else rect.removeAttribute("opacity");
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
    for (const rect of this.cellBgNodes.values()) rect.remove();
    this.cellBgNodes.clear();
  }
}
