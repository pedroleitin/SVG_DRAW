import type { Store } from "../store/store";
import type { Renderer } from "../render/renderer";
import type { SceneState } from "../scene/types";
import { screenToWorld } from "../scene/camera";
import { snapToCell } from "../export/frame";

const SVGNS = "http://www.w3.org/2000/svg";

interface HandleDef {
  id: string;
  fx: number;
  fy: number;
  w?: boolean;
  e?: boolean;
  n?: boolean;
  s?: boolean;
  cursor: string;
}

const HANDLES: HandleDef[] = [
  { id: "nw", fx: 0, fy: 0, w: true, n: true, cursor: "nwse-resize" },
  { id: "ne", fx: 1, fy: 0, e: true, n: true, cursor: "nesw-resize" },
  { id: "se", fx: 1, fy: 1, e: true, s: true, cursor: "nwse-resize" },
  { id: "sw", fx: 0, fy: 1, w: true, s: true, cursor: "nesw-resize" },
  { id: "n", fx: 0.5, fy: 0, n: true, cursor: "ns-resize" },
  { id: "e", fx: 1, fy: 0.5, e: true, cursor: "ew-resize" },
  { id: "s", fx: 0.5, fy: 1, s: true, cursor: "ns-resize" },
  { id: "w", fx: 0, fy: 0.5, w: true, cursor: "ew-resize" },
];

/** Interactive seamless tile frame (Compose + Seamless): grab the BORDER to
 *  move, handles to resize. The interior is not captured, so painting the
 *  pattern still works. Always snapped to whole cells so tiles align. */
export class TileFrameController {
  private layer: SVGGElement;
  private borderHit: SVGRectElement;
  private border: SVGRectElement;
  private handles = new Map<string, SVGRectElement>();
  private drag: {
    mode: string;
    startWorld: { x: number; y: number };
    frame0: { x: number; y: number; w: number; h: number };
    cell: number;
  } | null = null;

  constructor(private store: Store, private renderer: Renderer) {
    this.layer = document.createElementNS(SVGNS, "g");
    this.layer.setAttribute("class", "tile-frame-ui");

    // Grab the border (stroke only) to move — interior stays paintable.
    this.borderHit = document.createElementNS(SVGNS, "rect");
    this.borderHit.setAttribute("fill", "none");
    this.borderHit.setAttribute("stroke", "transparent");
    this.borderHit.style.cursor = "move";
    this.borderHit.style.pointerEvents = "stroke";
    this.borderHit.dataset.mode = "move";

    this.border = document.createElementNS(SVGNS, "rect");
    this.border.setAttribute("class", "tile-frame-border");
    this.border.setAttribute("fill", "none");
    this.border.style.pointerEvents = "none";

    this.layer.append(this.borderHit, this.border);

    for (const h of HANDLES) {
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("class", "tile-frame-handle");
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
    return cam.w / this.renderer.hostSize.width;
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

  private visible(s: SceneState): boolean {
    return s.contextPanel === "seamless";
  }

  private layout(s: SceneState): void {
    if (!this.visible(s)) {
      this.layer.style.display = "none";
      return;
    }
    this.layer.style.display = "";
    const f = s.tileFrame;
    const px = this.px();

    const set = (el: SVGRectElement, x: number, y: number, w: number, h: number) => {
      el.setAttribute("x", String(x));
      el.setAttribute("y", String(y));
      el.setAttribute("width", String(w));
      el.setAttribute("height", String(h));
    };
    set(this.border, f.x, f.y, f.w, f.h);
    this.border.setAttribute("stroke-width", String(1.5 * px));
    this.border.setAttribute("stroke-dasharray", `${6 * px} ${5 * px}`);
    set(this.borderHit, f.x, f.y, f.w, f.h);
    this.borderHit.setAttribute("stroke-width", String(14 * px));

    const hs = 9 * px;
    for (const h of HANDLES) {
      set(this.handles.get(h.id)!, f.x + h.fx * f.w - hs / 2, f.y + h.fy * f.h - hs / 2, hs, hs);
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
      frame0: { ...s.tileFrame },
      cell: s.cellSize,
    };
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const d = this.drag;
    const p = this.worldAt(e);
    const snap = (v: number) => snapToCell(v, d.cell);

    if (d.mode === "move") {
      this.set({
        x: snap(d.frame0.x + (p.x - d.startWorld.x)),
        y: snap(d.frame0.y + (p.y - d.startWorld.y)),
      });
      return;
    }

    const def = HANDLES.find((h) => h.id === d.mode)!;
    const f0 = d.frame0;
    let L = f0.x;
    let R = f0.x + f0.w;
    let T = f0.y;
    let B = f0.y + f0.h;
    if (def.w) L = Math.min(snap(p.x), R - d.cell);
    if (def.e) R = Math.max(snap(p.x), L + d.cell);
    if (def.n) T = Math.min(snap(p.y), B - d.cell);
    if (def.s) B = Math.max(snap(p.y), T + d.cell);
    this.set({ x: L, y: T, w: R - L, h: B - T });
  };

  private onUp = () => {
    this.drag = null;
  };

  private set(patch: Partial<SceneState["tileFrame"]>): void {
    this.store.set({ tileFrame: { ...this.store.get().tileFrame, ...patch } });
  }
}
