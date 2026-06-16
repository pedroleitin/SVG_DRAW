import type { Store } from "../store/store";
import type { BrushShape, SceneState } from "../scene/types";
import { createSlider } from "./widgets";
import type { SliderHandle } from "./widgets";

/** Shape icons: filled when the shape is active, outline when not. */
const SHAPE_ICON: Record<BrushShape, { on: string; off: string }> = {
  square: {
    on: `<svg viewBox="0 0 24 24" width="16" height="16"><rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor"/></svg>`,
    off: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>`,
  },
  circle: {
    on: `<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="7" fill="currentColor"/></svg>`,
    off: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="6.8"/></svg>`,
  },
};

/** Always-on brush bar (shown while Draw or Erase is active). Two titled
 *  groups: BRUSH (size + shape) and CELL (random background). */
export class BrushPanel {
  private sizeSlider: SliderHandle;
  private shapeBtns = new Map<BrushShape, HTMLButtonElement>();
  private bgChk: HTMLInputElement;

  constructor(host: HTMLElement, private store: Store) {
    host.innerHTML = `
      <div class="brush-group">
        <span class="brush-title">Brush</span>
        <div class="brush-controls">
          <div id="brush-size"></div>
          <div class="seg" id="brush-shape"></div>
        </div>
      </div>
      <span class="tb-sep"></span>
      <div class="brush-group">
        <span class="brush-title">Cell</span>
        <div class="brush-controls">
          <label class="chk"><span>Cell background</span><input type="checkbox" id="cell-bg" /></label>
        </div>
      </div>`;

    const s = store.get();

    // Brush size: 1 → 4 footprint multiplier. Circle needs size ≥ 3, so drop
    // back to square when shrinking below that.
    this.sizeSlider = createSlider({
      label: "Brush",
      min: 1,
      max: 4,
      step: 1,
      value: s.brushSize,
      format: (v) => String(v),
      onChange: (v) => {
        const reset = v < 3 && this.store.get().brushShape === "circle";
        this.store.set({ brushSize: v, ...(reset ? { brushShape: "square" as BrushShape } : {}) });
      },
    });
    host.querySelector("#brush-size")!.appendChild(this.sizeSlider.el);

    // Brush shape: square / circle segmented toggle.
    const shapeHost = host.querySelector("#brush-shape") as HTMLElement;
    (["square", "circle"] as BrushShape[]).forEach((shape) => {
      const b = document.createElement("button");
      b.className = "seg-btn";
      b.addEventListener("click", () => {
        if (b.disabled) return;
        this.store.set({ brushShape: shape });
      });
      this.shapeBtns.set(shape, b);
      shapeHost.appendChild(b);
    });

    this.bgChk = host.querySelector("#cell-bg") as HTMLInputElement;
    this.bgChk.addEventListener("change", () =>
      this.store.set({ activeBgIndex: this.bgChk.checked ? "random" : null }),
    );

    this.sync(s);
    store.subscribe((st) => this.sync(st));
  }

  private sync(s: SceneState): void {
    this.sizeSlider.setValue(s.brushSize);
    const circleOk = s.brushSize >= 3;
    for (const [shape, b] of this.shapeBtns) {
      const active = s.brushShape === shape;
      b.innerHTML = SHAPE_ICON[shape][active ? "on" : "off"];
      b.classList.toggle("active", active);
    }
    const circleBtn = this.shapeBtns.get("circle")!;
    circleBtn.disabled = !circleOk;
    circleBtn.classList.toggle("disabled", !circleOk);
    circleBtn.title = circleOk ? "Circle brush" : "Circle brush (size 3–4)";
    this.shapeBtns.get("square")!.title = "Square brush";
    this.bgChk.checked = s.activeBgIndex != null;
  }
}
