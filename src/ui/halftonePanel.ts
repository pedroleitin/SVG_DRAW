import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { History } from "../commands/command";
import type { HalftoneMode, SceneState } from "../scene/types";
import { ApplyMaskCommand } from "../commands/sceneCommands";
import { createSlider } from "./widgets";
import type { SliderHandle } from "./widgets";
import {
  setHalftoneImage,
  hasHalftoneImage,
  sampleHalftoneLum,
  halftoneInstances,
} from "../features/halftone";

const MODES: { mode: HalftoneMode; label: string }[] = [
  { mode: "halftone", label: "Halftone" },
  { mode: "bayer", label: "Bayer" },
  { mode: "floyd", label: "Floyd" },
];

const PREVIEW_RES = 80;

/** Compose "Halftone": render an uploaded image as a grid of the selected
 *  shapes (dot size by darkness, or ordered / error-diffusion dithering). */
export class HalftonePanel {
  private modeBtns = new Map<HalftoneMode, HTMLButtonElement>();
  private invertChk: HTMLInputElement;
  private contrast: SliderHandle;
  private sizeSlider: SliderHandle;
  private drop: HTMLElement;
  private canvas: HTMLCanvasElement;

  constructor(
    host: HTMLElement,
    private store: Store,
    private library: Library,
    private history: History,
  ) {
    host.innerHTML = `
      <h2>Halftone</h2>
      <div class="seg stencil-src" id="ht-mode"></div>
      <div class="noise-body">
        <div class="noise-left">
          <label class="img-drop" id="ht-drop" title="Drop an image or click to upload">
            <input type="file" accept="image/*" hidden />
            <canvas class="mask-preview img-preview" width="${PREVIEW_RES}" height="${PREVIEW_RES}"></canvas>
            <span class="img-hint">⬆ Drop image<br>or click</span>
          </label>
        </div>
        <div class="noise-right">
          <div class="sliders" id="ht-sliders"></div>
          <label class="chk"><span>Invert</span><input type="checkbox" id="ht-invert" /></label>
        </div>
      </div>
      <p class="ctx-hint">Fills with the shapes selected in <b>Shapes</b>, recolored by the palette.</p>
      <div class="noise-actions">
        <button id="ht-apply">Apply to view</button>
      </div>`;

    const modeHost = host.querySelector("#ht-mode") as HTMLElement;
    for (const m of MODES) {
      const b = document.createElement("button");
      b.className = "seg-btn";
      b.textContent = m.label;
      b.title = m.label;
      b.addEventListener("click", () => this.setHt({ mode: m.mode }));
      this.modeBtns.set(m.mode, b);
      modeHost.appendChild(b);
    }

    const slHost = host.querySelector("#ht-sliders") as HTMLElement;
    this.contrast = createSlider({
      label: "Contrast",
      min: 0.4,
      max: 3,
      step: 0.1,
      value: store.get().halftone.contrast,
      format: (v) => v.toFixed(1),
      onChange: (v) => this.setHt({ contrast: v }),
    });
    slHost.appendChild(this.contrast.el);
    this.sizeSlider = createSlider({
      label: "Size",
      min: 0.3,
      max: 1,
      step: 0.05,
      value: store.get().halftone.scale,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => this.setHt({ scale: v }),
    });
    slHost.appendChild(this.sizeSlider.el);

    this.invertChk = host.querySelector("#ht-invert") as HTMLInputElement;
    this.invertChk.addEventListener("change", () => this.setHt({ invert: this.invertChk.checked }));

    this.drop = host.querySelector("#ht-drop") as HTMLElement;
    this.canvas = host.querySelector(".img-preview") as HTMLCanvasElement;
    const input = this.drop.querySelector("input") as HTMLInputElement;
    input.addEventListener("change", () => this.loadImage(input.files?.[0] ?? null));
    ["dragover", "dragenter"].forEach((ev) =>
      this.drop.addEventListener(ev, (e) => {
        e.preventDefault();
        this.drop.classList.add("over");
      }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      this.drop.addEventListener(ev, (e) => {
        e.preventDefault();
        this.drop.classList.remove("over");
      }),
    );
    this.drop.addEventListener("drop", (e) =>
      this.loadImage((e as DragEvent).dataTransfer?.files?.[0] ?? null),
    );

    host.querySelector("#ht-apply")!.addEventListener("click", () => this.apply());

    this.sync(store.get());
    store.subscribe((s) => this.sync(s));
  }

  private setHt(patch: Partial<SceneState["halftone"]>): void {
    this.store.set({ halftone: { ...this.store.get().halftone, ...patch } });
  }

  private async loadImage(file: File | null): Promise<void> {
    if (!file) return;
    const ok = await setHalftoneImage(file);
    if (!ok) return;
    this.drop.classList.add("has-image");
    this.drawPreview();
    // Bump the store so the live preview repaints with the new image.
    this.store.set({ halftone: { ...this.store.get().halftone } });
  }

  /** Grayscale preview of the uploaded image. */
  private drawPreview(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx || !hasHalftoneImage()) return;
    const img = ctx.createImageData(PREVIEW_RES, PREVIEW_RES);
    for (let py = 0; py < PREVIEW_RES; py++) {
      for (let px = 0; px < PREVIEW_RES; px++) {
        const g = (sampleHalftoneLum(px / PREVIEW_RES, py / PREVIEW_RES) * 255) | 0;
        const o = (py * PREVIEW_RES + px) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = g;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  private apply(): void {
    if (!hasHalftoneImage()) return;
    const { places, eraseKeys } = halftoneInstances(this.store.get(), this.library);
    if (places.length || eraseKeys.length) {
      this.history.dispatch(new ApplyMaskCommand(places, eraseKeys));
    }
  }

  private sync(s: SceneState): void {
    for (const [m, b] of this.modeBtns) b.classList.toggle("active", m === s.halftone.mode);
    this.invertChk.checked = s.halftone.invert;
    this.contrast.setValue(s.halftone.contrast);
    this.sizeSlider.setValue(s.halftone.scale);
  }
}
