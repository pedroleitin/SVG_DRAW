import type { Store } from "../store/store";
import type { SceneState } from "../scene/types";
import { createSlider } from "./widgets";
import type { SliderHandle } from "./widgets";

/** Shared Brush controls: footprint Size + per-SVG span + cell background. The
 *  footprint shape is fixed to square for now (the selector is hidden). */
export class BrushPanel {
  private sizeSlider: SliderHandle;
  private spanSlider: SliderHandle;
  private bgChk: HTMLInputElement;

  constructor(host: HTMLElement, private store: Store) {
    host.innerHTML = `
      <div class="brush-group">
        <span class="brush-title">Brush</span>
        <div class="brush-controls">
          <div id="brush-span"></div>
          <div id="brush-size"></div>
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

    // Brush size: 1 → 4 footprint multiplier.
    this.sizeSlider = createSlider({
      label: "Brush",
      min: 1,
      max: 4,
      step: 1,
      value: s.brushSize,
      format: (v) => String(v),
      onChange: (v) => this.store.set({ brushSize: v }),
    });
    host.querySelector("#brush-size")!.appendChild(this.sizeSlider.el);

    // Size: cell span of each placed SVG (1..6) — one SVG over N×N cells.
    this.spanSlider = createSlider({
      label: "Size",
      min: 1,
      max: 6,
      step: 1,
      value: s.brushSpan,
      format: (v) => String(v),
      onChange: (v) => this.store.set({ brushSpan: v }),
    });
    host.querySelector("#brush-span")!.appendChild(this.spanSlider.el);

    this.bgChk = host.querySelector("#cell-bg") as HTMLInputElement;
    this.bgChk.addEventListener("change", () =>
      this.store.set({ activeBgIndex: this.bgChk.checked ? "random" : null }),
    );

    this.sync(s);
    store.subscribe((st) => this.sync(st));
  }

  private sync(s: SceneState): void {
    this.sizeSlider.setValue(s.brushSize);
    this.spanSlider.setValue(s.brushSpan);
    this.bgChk.checked = s.activeBgIndex != null;
  }
}
