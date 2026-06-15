import type { Store } from "../store/store";
import type { Renderer } from "../render/renderer";
import type { SceneState } from "../scene/types";
import { screenToWorld } from "../scene/camera";
import { aspectRatio, snapToCell } from "../export/frame";

const SVGNS = "http://www.w3.org/2000/svg";

interface HandleDef {
  id: string;
  /** normalized position along the frame (0..1). */
  fx: number;
  fy: number;
  /** which edges this handle moves. */
  w?: boolean;
  e?: boolean;
  n?: boolean;
  s?: boolean;
  corner: boolean;
  cursor: string;
}

const HANDLES: HandleDef[] = [
  { id: "nw", fx: 0, fy: 0, w: true, n: true, corner: true, cursor: "nwse-resize" },
  { id: "n", fx: 0.5, fy: 0, n: true, corner: false, cursor: "ns-resize" },
  { id: "ne", fx: 1, fy: 0, e: true, n: true, corner: true, cursor: "nesw-resize" },
  { id: "e", fx: 1, fy: 0.5, e: true, corner: false, cursor: "ew-resize" },
  { id: "se", fx: 1, fy: 1, e: true, s: true, corner: true, cursor: "nwse-resize" },
  { id: "s", fx: 0.5, fy: 1, s: true, corner: false, cursor: "ns-resize" },
  { id: "sw", fx: 0, fy: 1, w: true, s: true, corner: true, cursor: "nesw-resize" },
  { id: "w", fx: 0, fy: 0.5, w: true, corner: false, cursor: "ew-resize" },
];

/** Interactive export frame: drag the border to MOVE, drag handles to RESIZE
 *  (corners scale; edges stretch one axis on Free Form; fixed aspects show only
 *  corners and keep ratio). Optional snap-to-grid keeps edges on cell lines so
 *  the frame never cuts a cell. */
export class FrameController {
  private layer: SVGGElement;
  private border: SVGRectElement;
  private hit: SVGRectElement;
  private handles = new Map<string, SVGRectElement>();
  private drag: {
    mode: string; // "move" | handle id
    startWorld: { x: number; y: number };
    frame0: { x: number; y: number; w: number; h: number };
    cell: number;
    snap: boolean;
    ratio: number; // 0 = free
  } | null = null;

  constructor(private store: Store, private renderer: Renderer) {
    this.layer = document.createElementNS(SVGNS, "g");
    this.layer.setAttribute("class", "frame-ui");

    // Wide transparent hit-stroke for grabbing the border to MOVE.
    this.hit = document.createElementNS(SVGNS, "rect");
    this.hit.setAttribute("fill", "none");
    this.hit.setAttribute("stroke", "transparent");
    this.hit.style.cursor = "move";
    this.hit.style.pointerEvents = "stroke";
    this.hit.dataset.mode = "move";

    this.border = document.createElementNS(SVGNS, "rect");
    this.border.setAttribute("fill", "none");
    this.border.setAttribute("stroke", "#4dabf7");
    this.border.style.pointerEvents = "none";

    this.layer.append(this.hit, this.border);

    for (const h of HANDLES) {
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("fill", "#4dabf7");
      rect.setAttribute("stroke", "#fff");
      rect.style.cursor = h.cursor;
      rect.style.pointerEvents = "all";
      rect.dataset.mode = h.id;
      this.handles.set(h.id, rect);
      this.layer.appendChild(rect);
    }

    this.renderer.svg.appendChild(this.layer);
    this.layer.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);

    this.layout(store.get());
    store.subscribe((s) => this.layout(s));
  }

  private px(): number {
    const cam = this.store.get().camera;
    return cam.w / this.renderer.hostSize.width; // world units per screen px
  }

  private worldAt(e: PointerEvent) {
    const rect = this.renderer.svg.getBoundingClientRect();
    return screenToWorld(
      this.store.get().camera,
      this.renderer.hostSize,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  }

  private layout(s: SceneState): void {
    const f = s.frame;
    if (!f.show) {
      this.layer.style.display = "none";
      return;
    }
    this.layer.style.display = "";
    const px = this.px();
    const freeForm = f.aspect === "free";

    const set = (el: SVGRectElement, x: number, y: number, w: number, h: number) => {
      el.setAttribute("x", String(x));
      el.setAttribute("y", String(y));
      el.setAttribute("width", String(w));
      el.setAttribute("height", String(h));
    };
    set(this.border, f.x, f.y, f.w, f.h);
    this.border.setAttribute("stroke-width", String(1.5 * px));
    set(this.hit, f.x, f.y, f.w, f.h);
    this.hit.setAttribute("stroke-width", String(10 * px));

    const hs = 9 * px; // handle size in world units
    for (const h of HANDLES) {
      const rect = this.handles.get(h.id)!;
      // Fixed aspects expose only corner handles (ratio-locked scaling).
      if (!freeForm && !h.corner) {
        rect.style.display = "none";
        continue;
      }
      rect.style.display = "";
      set(rect, f.x + h.fx * f.w - hs / 2, f.y + h.fy * f.h - hs / 2, hs, hs);
    }
  }

  private onDown = (e: PointerEvent) => {
    const mode = (e.target as HTMLElement).dataset?.mode;
    if (!mode) return;
    e.stopPropagation(); // don't let the draw/erase tool fire
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const s = this.store.get();
    this.drag = {
      mode,
      startWorld: this.worldAt(e),
      frame0: { x: s.frame.x, y: s.frame.y, w: s.frame.w, h: s.frame.h },
      cell: s.cellSize,
      snap: s.frame.snap,
      ratio: s.frame.aspect === "free" ? 0 : aspectRatio(s.frame.aspect),
    };
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const d = this.drag;
    const p = this.worldAt(e);
    const snap = (v: number) => (d.snap ? snapToCell(v, d.cell) : v);

    if (d.mode === "move") {
      const nx = snap(d.frame0.x + (p.x - d.startWorld.x));
      const ny = snap(d.frame0.y + (p.y - d.startWorld.y));
      this.setFrame({ x: nx, y: ny });
      return;
    }

    const def = HANDLES.find((h) => h.id === d.mode)!;
    const f0 = d.frame0;
    const next = d.ratio > 0 ? this.resizeRatio(def, f0, p, snap, d.ratio, d.cell) : this.resizeFree(def, f0, p, snap, d.cell);
    this.setFrame(next);
  };

  private onUp = () => {
    this.drag = null;
  };

  /** Free-form resize: each active edge follows the pointer independently. */
  private resizeFree(
    def: HandleDef,
    f0: { x: number; y: number; w: number; h: number },
    p: { x: number; y: number },
    snap: (v: number) => number,
    cell: number,
  ) {
    let L = f0.x;
    let R = f0.x + f0.w;
    let T = f0.y;
    let B = f0.y + f0.h;
    if (def.w) L = Math.min(snap(p.x), R - cell);
    if (def.e) R = Math.max(snap(p.x), L + cell);
    if (def.n) T = Math.min(snap(p.y), B - cell);
    if (def.s) B = Math.max(snap(p.y), T + cell);
    return { x: L, y: T, w: R - L, h: B - T };
  }

  /** Ratio-locked corner resize: width follows the pointer, height = w/ratio,
   *  anchored at the opposite corner. */
  private resizeRatio(
    def: HandleDef,
    f0: { x: number; y: number; w: number; h: number },
    p: { x: number; y: number },
    snap: (v: number) => number,
    ratio: number,
    cell: number,
  ) {
    const anchorX = def.w ? f0.x + f0.w : f0.x; // fixed horizontal edge
    const anchorY = def.n ? f0.y + f0.h : f0.y; // fixed vertical edge
    const width = Math.max(cell, Math.abs(snap(p.x) - anchorX));
    const height = width / ratio;
    const x = def.w ? anchorX - width : anchorX;
    const y = def.n ? anchorY - height : anchorY;
    return { x, y, w: width, h: height };
  }

  private setFrame(patch: Partial<SceneState["frame"]>): void {
    this.store.set({ frame: { ...this.store.get().frame, ...patch } });
  }
}
