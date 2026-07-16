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
  private randSizeChk: HTMLInputElement;

  constructor(host: HTMLElement, private store: Store) {
    host.innerHTML = `
      <div class="brush-group">
        <span class="brush-title">Brush</span>
        <div class="brush-controls">
          <div id="brush-span"></div>
          <div id="brush-size"></div>
          <label class="chk"><span>Random size</span><input type="checkbox" id="brush-rand-size" title="Each placed cell gets a random size (1–3)" /></label>
        </div>
      </div>
      <span class="tb-sep"></span>
      <div class="brush-group">
        <span class="brush-title">Cell</span>
        <div class="brush-controls">
          <label class="chk" title="Fill each painted cell with a background square (random palette color)"><span>Cell background</span><input type="checkbox" id="cell-bg" /></label>
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
      title: "",
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
      title: "",
    });
    host.querySelector("#brush-span")!.appendChild(this.spanSlider.el);

    this.bgChk = host.querySelector("#cell-bg") as HTMLInputElement;
    this.bgChk.addEventListener("change", () =>
      this.store.set({ activeBgIndex: this.bgChk.checked ? "random" : null }),
    );

    // Random size: Draw places a randomly-sized (1–3) SVG per cell.
    this.randSizeChk = host.querySelector("#brush-rand-size") as HTMLInputElement;
    this.randSizeChk.addEventListener("change", () =>
      this.store.set({ brushRandomSize: this.randSizeChk.checked }),
    );

    this.sync(s);
    store.subscribe((st) => this.sync(st));
  }

  private sync(s: SceneState): void {
    this.sizeSlider.setValue(s.brushSize);
    this.spanSlider.setValue(s.brushSpan);
    this.bgChk.checked = s.activeBgIndex != null;
    this.randSizeChk.checked = s.brushRandomSize;
    // Random size overrides the Size slider — dim it to show it's inactive.
    this.spanSlider.el.classList.toggle("disabled", s.brushRandomSize);
  }
}
