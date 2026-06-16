import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { History } from "../commands/command";
import type { MaskParams, SceneState } from "../scene/types";
import { ApplyMaskCommand } from "../commands/sceneCommands";
import { applyMask } from "../features/placement";
import { maskField, sampleMask } from "../features/noise";
import { visibleCellRange } from "../scene/grid";
import { createSlider } from "./widgets";
import type { SliderHandle } from "./widgets";

// Only the numeric mask params get sliders (excludes the boolean `seamless`).
type MaskKey = Exclude<keyof MaskParams, "seamless">;

interface SliderDef<K> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const MASK_SLIDERS: SliderDef<MaskKey>[] = [
  { key: "scale", label: "Scale", min: 1, max: 40, step: 0.5, format: (v) => v.toFixed(1) },
  { key: "octaves", label: "Octaves", min: 1, max: 6, step: 1, format: (v) => String(v) },
  { key: "persistence", label: "Roughness", min: 0, max: 1, step: 0.05, format: pct },
  { key: "contrast", label: "Contrast", min: 0.2, max: 4, step: 0.05, format: (v) => v.toFixed(2) },
  { key: "brightness", label: "Brightness", min: -0.5, max: 0.5, step: 0.01, format: (v) => v.toFixed(2) },
  { key: "threshold", label: "Threshold", min: 0, max: 1, step: 0.01, format: pct },
];

const PREVIEW_RES = 80; // sampled pixels per side
const PREVIEW_CELLS = 36; // grid cells shown across the preview window

/** Maxon-style fractal-mask controls: white fills, black erases. A live
 *  grayscale preview reflects every slider, the preview is draggable to pan
 *  the field, and an on-canvas overlay shows exactly which cells Apply touches. */
export class Controls {
  private maskSliders = new Map<MaskKey, SliderHandle>();
  private canvas!: HTMLCanvasElement;
  private previewBW = false;

  constructor(
    host: HTMLElement,
    private store: Store,
    private library: Library,
    private history: History,
  ) {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "mask-panel";
    panel.innerHTML = `
      <h2>Noise mask</h2>
      <div class="noise-body">
        <div class="noise-left">
          <canvas class="mask-preview" width="${PREVIEW_RES}" height="${PREVIEW_RES}"
            title="Drag to move the noise"></canvas>
          <div class="mask-preview-row">
            <label class="chk"><input type="checkbox" id="mask-live" /> Preview on canvas</label>
            <label class="chk"><input type="checkbox" id="mask-bw" /> B/W</label>
          </div>
        </div>
        <div class="noise-right">
          <div class="sliders" id="mask-sliders"></div>
          <div class="noise-actions">
            <button id="mask-apply">Apply to view</button>
            <button id="mask-reseed">Reseed</button>
          </div>
        </div>
      </div>`;
    host.appendChild(panel);

    this.canvas = panel.querySelector(".mask-preview") as HTMLCanvasElement;
    const slHost = panel.querySelector("#mask-sliders")!;
    for (const def of MASK_SLIDERS) {
      const sl = createSlider({
        label: def.label,
        min: def.min,
        max: def.max,
        step: def.step,
        value: this.store.get().mask[def.key],
        format: def.format ?? ((v) => v.toFixed(2)),
        onChange: (v) => this.setMask(def.key, v),
      });
      this.maskSliders.set(def.key, sl);
      slHost.appendChild(sl.el);
    }

    const live = panel.querySelector("#mask-live") as HTMLInputElement;
    live.checked = this.store.get().maskPreview;
    live.addEventListener("change", () => this.store.set({ maskPreview: live.checked }));
    const bw = panel.querySelector("#mask-bw") as HTMLInputElement;
    bw.addEventListener("change", () => {
      this.previewBW = bw.checked;
      this.drawPreview(this.store.get());
    });

    panel.querySelector("#mask-apply")!.addEventListener("click", () => this.apply());
    panel.querySelector("#mask-reseed")!.addEventListener("click", () => this.reseed());
    this.wirePreviewDrag();

    this.sync(this.store.get());
    this.store.subscribe((s) => this.sync(s));
  }


  private setMask(key: MaskKey, value: number): void {
    this.store.set({ mask: { ...this.store.get().mask, [key]: value } });
  }

  /** Reflect store changes (reseed, drag-offset) back into the UI. */
  private sync(s: SceneState): void {
    for (const def of MASK_SLIDERS) this.maskSliders.get(def.key)!.setValue(s.mask[def.key]);
    this.drawPreview(s);
  }

  /** Render the fractal mask into the preview canvas (grayscale or thresholded). */
  private drawPreview(s: SceneState): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const field = maskField(s.mask.seed);
    const img = ctx.createImageData(PREVIEW_RES, PREVIEW_RES);
    for (let py = 0; py < PREVIEW_RES; py++) {
      for (let px = 0; px < PREVIEW_RES; px++) {
        const col = (px / PREVIEW_RES) * PREVIEW_CELLS;
        const row = (py / PREVIEW_RES) * PREVIEW_CELLS;
        let v = sampleMask(field, col, row, s.mask);
        if (this.previewBW) v = v >= s.mask.threshold ? 1 : 0;
        const g = (v * 255) | 0;
        const o = (py * PREVIEW_RES + px) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = g;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Drag inside the preview to pan the noise field (offsetX/Y in cells). */
  private wirePreviewDrag(): void {
    let dragging = false;
    let last = { x: 0, y: 0 };
    const toCells = (dpx: number) => (dpx / this.canvas.clientWidth) * PREVIEW_CELLS;
    this.canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const m = this.store.get().mask;
      this.store.set({
        mask: {
          ...m,
          offsetX: m.offsetX - toCells(e.clientX - last.x),
          offsetY: m.offsetY - toCells(e.clientY - last.y),
        },
      });
      last = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener("pointerup", () => (dragging = false));
  }

  /** Fill white cells / erase black cells across the visible region (1 undo). */
  private apply(): void {
    const s = this.store.get();
    const r = visibleCellRange(s.camera, s.cellSize, 0);
    const { places, eraseKeys } = applyMask(s, this.library, r.minCol, r.minRow, r.maxCol, r.maxRow);
    if (places.length || eraseKeys.length) {
      this.history.dispatch(new ApplyMaskCommand(places, eraseKeys));
    }
  }

  private reseed(): void {
    const seed = (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0;
    this.store.set({ mask: { ...this.store.get().mask, seed } });
  }
}
