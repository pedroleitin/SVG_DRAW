import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { History } from "../commands/command";
import type { MaskParams, SceneState, StencilType } from "../scene/types";
import { ApplyMaskCommand } from "../commands/sceneCommands";
import { applyMask } from "../features/placement";
import { maskField, sampleMask } from "../features/noise";
import { setStencilImage, hasStencilImage, sampleStencilLum } from "../features/stencilImage";
import { fitBox } from "../features/stencil";
import { visibleCellRange } from "../scene/grid";
import { morphResize } from "./morph";
import { createSlider } from "./widgets";
import type { SliderHandle } from "./widgets";

// Only the numeric mask params get sliders (excludes the boolean `seamless`).
type MaskKey = Exclude<keyof MaskParams, "seamless">;
type StripeKey = keyof SceneState["stencil"]["stripes"];

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

const STRIPE_SLIDERS: SliderDef<StripeKey>[] = [
  { key: "angle", label: "Angle", min: 0, max: 180, step: 5, format: (v) => `${v}°` },
  { key: "period", label: "Period", min: 2, max: 20, step: 1, format: (v) => String(v) },
  { key: "ratio", label: "Lit", min: 0.1, max: 0.9, step: 0.05, format: pct },
];

const IMAGE_THRESHOLD: SliderDef<"threshold"> = {
  key: "threshold",
  label: "Threshold",
  min: 0,
  max: 1,
  step: 0.01,
  format: pct,
};

/** Stencil sources (Image / Text are placeholders until wired up). */
const SOURCES: { type: StencilType; label: string; soon?: boolean }[] = [
  { type: "noise", label: "Noise" },
  { type: "stripes", label: "Stripes" },
  { type: "image", label: "Image" },
  { type: "text", label: "Text", soon: true },
];

const PREVIEW_RES = 80; // sampled pixels per side
const PREVIEW_CELLS = 36; // grid cells shown across the preview window

/** Stencil panel: pick a source (Noise / Stripes / …) that defines the paintable
 *  opening, tune it, and "Apply to view" stencils it onto the grid. */
export class Controls {
  private maskSliders = new Map<MaskKey, SliderHandle>();
  private stripeSliders = new Map<StripeKey, SliderHandle>();
  private srcBtns = new Map<StencilType, HTMLButtonElement>();
  private imgThreshold!: SliderHandle;
  private imgInvert!: HTMLInputElement;
  private imgDrop!: HTMLElement;
  private imgCanvas!: HTMLCanvasElement;
  private lockChk!: HTMLInputElement;
  private noiseEl!: HTMLElement;
  private stripesEl!: HTMLElement;
  private imageEl!: HTMLElement;
  private reseedEl!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctxBody: HTMLElement | null;
  private prevType: StencilType | undefined;

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
      <h2>Stencil</h2>
      <div class="seg stencil-src" id="stencil-src"></div>
      <div id="src-noise">
        <div class="noise-body">
          <div class="noise-left">
            <canvas class="mask-preview" width="${PREVIEW_RES}" height="${PREVIEW_RES}"
              title="Drag to move the noise"></canvas>
          </div>
          <div class="noise-right">
            <div class="sliders" id="mask-sliders"></div>
          </div>
        </div>
      </div>
      <div id="src-stripes">
        <div class="sliders" id="stripe-sliders"></div>
      </div>
      <div id="src-image">
        <div class="noise-body">
          <div class="noise-left">
            <label class="img-drop" id="img-drop" title="Drop an image or click to upload">
              <input type="file" accept="image/*" hidden />
              <canvas class="mask-preview img-preview" width="${PREVIEW_RES}" height="${PREVIEW_RES}"></canvas>
              <span class="img-hint">⬆ Drop image<br>or click</span>
            </label>
          </div>
          <div class="noise-right">
            <div class="sliders" id="image-sliders"></div>
            <label class="chk"><span>Invert</span><input type="checkbox" id="img-invert" /></label>
          </div>
        </div>
      </div>
      <label class="chk stencil-lock"><input type="checkbox" id="stencil-lock" />
        <span>Lock projection (pan moves the view, the stencil stays put)</span></label>
      <div class="noise-actions">
        <button id="mask-apply">Apply to view</button>
        <button id="mask-reseed">Reseed</button>
      </div>`;
    host.appendChild(panel);
    // The scrollable body wrapper (parent of this panel) is the morph target
    // when the source changes — so the box animates its size.
    this.ctxBody = host.parentElement;

    // Source selector.
    const srcHost = panel.querySelector("#stencil-src") as HTMLElement;
    for (const src of SOURCES) {
      const b = document.createElement("button");
      b.className = "seg-btn";
      b.textContent = src.label;
      b.disabled = !!src.soon;
      b.title = src.soon ? `${src.label} — coming soon` : src.label;
      b.addEventListener("click", () => {
        if (b.disabled) return;
        this.store.set({ stencil: { ...this.store.get().stencil, type: src.type } });
      });
      this.srcBtns.set(src.type, b);
      srcHost.appendChild(b);
    }

    this.noiseEl = panel.querySelector("#src-noise") as HTMLElement;
    this.stripesEl = panel.querySelector("#src-stripes") as HTMLElement;
    this.imageEl = panel.querySelector("#src-image") as HTMLElement;
    this.reseedEl = panel.querySelector("#mask-reseed") as HTMLElement;
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

    const stripeHost = panel.querySelector("#stripe-sliders")!;
    for (const def of STRIPE_SLIDERS) {
      const sl = createSlider({
        label: def.label,
        min: def.min,
        max: def.max,
        step: def.step,
        value: this.store.get().stencil.stripes[def.key],
        format: def.format ?? ((v) => v.toFixed(2)),
        onChange: (v) => this.setStripe(def.key, v),
      });
      this.stripeSliders.set(def.key, sl);
      stripeHost.appendChild(sl.el);
    }

    // Image source: threshold slider + invert + upload.
    this.imgThreshold = createSlider({
      label: IMAGE_THRESHOLD.label,
      min: IMAGE_THRESHOLD.min,
      max: IMAGE_THRESHOLD.max,
      step: IMAGE_THRESHOLD.step,
      value: this.store.get().stencil.image.threshold,
      format: IMAGE_THRESHOLD.format!,
      onChange: (v) => this.setImage({ threshold: v }),
    });
    panel.querySelector("#image-sliders")!.appendChild(this.imgThreshold.el);
    this.imgInvert = panel.querySelector("#img-invert") as HTMLInputElement;
    this.imgInvert.addEventListener("change", () => this.setImage({ invert: this.imgInvert.checked }));
    this.imgDrop = panel.querySelector("#img-drop") as HTMLElement;
    this.imgCanvas = panel.querySelector(".img-preview") as HTMLCanvasElement;
    const fileInput = this.imgDrop.querySelector("input") as HTMLInputElement;
    fileInput.addEventListener("change", () => this.loadImage(fileInput.files?.[0] ?? null));
    // Drag-and-drop onto the preview.
    ["dragover", "dragenter"].forEach((ev) =>
      this.imgDrop.addEventListener(ev, (e) => {
        e.preventDefault();
        this.imgDrop.classList.add("over");
      }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      this.imgDrop.addEventListener(ev, (e) => {
        e.preventDefault();
        this.imgDrop.classList.remove("over");
      }),
    );
    this.imgDrop.addEventListener("drop", (e) =>
      this.loadImage((e as DragEvent).dataTransfer?.files?.[0] ?? null),
    );

    this.lockChk = panel.querySelector("#stencil-lock") as HTMLInputElement;
    this.lockChk.addEventListener("change", () =>
      this.store.set({ stencil: { ...this.store.get().stencil, lock: this.lockChk.checked } }),
    );

    this.reseedEl.addEventListener("click", () => this.reseed());
    panel.querySelector("#mask-apply")!.addEventListener("click", () => this.apply());
    this.wirePreviewDrag();

    this.sync(this.store.get());
    this.store.subscribe((s) => this.sync(s));
  }

  private setMask(key: MaskKey, value: number): void {
    this.store.set({ mask: { ...this.store.get().mask, [key]: value } });
  }

  private setStripe(key: StripeKey, value: number): void {
    const st = this.store.get().stencil;
    this.store.set({ stencil: { ...st, stripes: { ...st.stripes, [key]: value } } });
  }

  private setImage(patch: Partial<SceneState["stencil"]["image"]>): void {
    const st = this.store.get().stencil;
    this.store.set({ stencil: { ...st, image: { ...st.image, ...patch } } });
  }

  /** Decode the file, place it (aspect-fit) in the current view, and stencil. */
  private async loadImage(file: File | null): Promise<void> {
    if (!file) return;
    const dims = await setStencilImage(file);
    if (!dims) return;
    const s = this.store.get();
    const box = fitBox(s, dims.w / dims.h);
    this.imgDrop.classList.add("has-image");
    this.drawImagePreview();
    this.store.set({ stencil: { ...s.stencil, type: "image", image: { ...s.stencil.image, box } } });
  }

  /** Grayscale preview of the uploaded image (luminance per pixel). */
  private drawImagePreview(): void {
    const ctx = this.imgCanvas.getContext("2d");
    if (!ctx || !hasStencilImage()) return;
    const img = ctx.createImageData(PREVIEW_RES, PREVIEW_RES);
    for (let py = 0; py < PREVIEW_RES; py++) {
      for (let px = 0; px < PREVIEW_RES; px++) {
        const g = (sampleStencilLum(px / PREVIEW_RES, py / PREVIEW_RES) * 255) | 0;
        const o = (py * PREVIEW_RES + px) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = g;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Show only the active source's controls (+ Reseed for Noise). */
  private applySections(type: StencilType): void {
    this.noiseEl.classList.toggle("hidden", type !== "noise");
    this.stripesEl.classList.toggle("hidden", type !== "stripes");
    this.imageEl.classList.toggle("hidden", type !== "image");
    this.reseedEl.classList.toggle("hidden", type !== "noise"); // seed is noise-only
  }

  /** Reflect store changes (source, reseed, drag-offset) back into the UI. */
  private sync(s: SceneState): void {
    const type = s.stencil.type;
    for (const [t, b] of this.srcBtns) b.classList.toggle("active", t === type);
    for (const def of MASK_SLIDERS) this.maskSliders.get(def.key)!.setValue(s.mask[def.key]);
    for (const def of STRIPE_SLIDERS) this.stripeSliders.get(def.key)!.setValue(s.stencil.stripes[def.key]);
    this.imgThreshold.setValue(s.stencil.image.threshold);
    this.imgInvert.checked = s.stencil.image.invert;
    this.lockChk.checked = s.stencil.lock;
    if (type === "noise") this.drawPreview(s);

    // Animate the box when the source changes (the sections have different
    // sizes); otherwise just apply the section visibility.
    if (this.prevType !== undefined && this.prevType !== type && this.ctxBody) {
      morphResize(this.ctxBody, () => this.applySections(type));
    } else {
      this.applySections(type);
    }
    this.prevType = type;
  }

  /** Render the fractal mask into the preview canvas (grayscale). */
  private drawPreview(s: SceneState): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const field = maskField(s.mask.seed);
    const img = ctx.createImageData(PREVIEW_RES, PREVIEW_RES);
    for (let py = 0; py < PREVIEW_RES; py++) {
      for (let px = 0; px < PREVIEW_RES; px++) {
        const col = (px / PREVIEW_RES) * PREVIEW_CELLS;
        const row = (py / PREVIEW_RES) * PREVIEW_CELLS;
        const v = sampleMask(field, col, row, s.mask);
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

  /** Stencil the visible region: clear it, then paint the lit opening. 1 undo. */
  private apply(): void {
    const s = this.store.get();
    const r = visibleCellRange(s.camera, s.cellSize, 0);
    const { places, eraseKeys } = applyMask(s, this.library, r.minCol, r.minRow, r.maxCol, r.maxRow);
    if (places.length) {
      this.history.dispatch(new ApplyMaskCommand(places, eraseKeys));
    }
  }

  private reseed(): void {
    const seed = (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0;
    this.store.set({ mask: { ...this.store.get().mask, seed } });
  }
}
