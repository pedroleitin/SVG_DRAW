import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { History } from "../commands/command";
import type { HalftoneMode, HalftoneTarget, SceneState } from "../scene/types";
import { ApplyMaskCommand } from "../commands/sceneCommands";
import { createSlider } from "./widgets";
import type { SliderHandle } from "./widgets";
import { ShapesPanel } from "./shapesPanel";
import {
  setHalftoneSource,
  setHalftoneFrame,
  hasHalftoneImage,
  sampleHalftoneLum,
  halftoneInstances,
  halftoneCoverage,
  halftoneIsAnimated,
  halftoneIsVideo,
  halftonePlayhead,
} from "../features/halftone";

const MODES: { mode: HalftoneMode; label: string }[] = [
  { mode: "halftone", label: "Halftone" },
  { mode: "bayer", label: "Bayer" },
  { mode: "floyd", label: "Floyd" },
  { mode: "atkinson", label: "Atkinson" },
  { mode: "jarvis", label: "Jarvis" },
];

const TARGETS: { target: HalftoneTarget; label: string }[] = [
  { target: "glyph", label: "Gliph" },
  { target: "cell", label: "Cell" },
  { target: "both", label: "Both" },
];

const PREVIEW_RES = 80;

/** Compose "Halftone": render an uploaded image as a grid of the selected
 *  shapes (dot size by darkness, or ordered / error-diffusion dithering). */
export class HalftonePanel {
  private modeBtns = new Map<HalftoneMode, HTMLButtonElement>();
  private targetBtns = new Map<HalftoneTarget, HTMLButtonElement>();
  private invertChk: HTMLInputElement;
  private shapeLumChk: HTMLInputElement;
  private contrast: SliderHandle;
  private sizeSlider: SliderHandle;
  private scrub: SliderHandle;
  private scrubHost: HTMLElement;
  private playBtn: HTMLButtonElement;
  private uiRaf = 0;
  private drop: HTMLElement;
  private canvas: HTMLCanvasElement;

  constructor(
    host: HTMLElement,
    private store: Store,
    private library: Library,
    private history: History,
  ) {
    host.innerHTML = `
      <div class="ht-cols">
        <div class="ht-main">
          <h2>Halftone</h2>
          <div class="seg stencil-src" id="ht-mode"></div>
          <div class="noise-body">
            <div class="noise-left">
              <label class="img-drop" id="ht-drop" title="Drop an image, GIF or video to upload">
                <input type="file" accept="image/*,video/*" hidden />
                <canvas class="mask-preview img-preview" width="${PREVIEW_RES}" height="${PREVIEW_RES}"></canvas>
                <span class="img-hint">⬆ Drop image / GIF / video<br>or click</span>
              </label>
              <div id="ht-scrub" hidden></div>
            </div>
            <div class="noise-right">
              <div class="seg" id="ht-target"></div>
              <div class="sliders" id="ht-sliders"></div>
              <label class="chk"><span>Invert</span><input type="checkbox" id="ht-invert" /></label>
              <label class="chk"><span>Shape by luminance</span><input type="checkbox" id="ht-shapelum" /></label>
            </div>
          </div>
          <div class="noise-actions">
            <button id="ht-apply">Apply to view</button>
            <button id="ht-export">Send to Export →</button>
          </div>
        </div>
        <div class="ht-shapes" id="ht-shapes"></div>
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

    const tgtHost = host.querySelector("#ht-target") as HTMLElement;
    for (const t of TARGETS) {
      const b = document.createElement("button");
      b.className = "seg-btn";
      b.textContent = t.label;
      b.title = `Fill the ${t.label.toLowerCase()}`;
      b.addEventListener("click", () => this.setHt({ target: t.target }));
      this.targetBtns.set(t.target, b);
      tgtHost.appendChild(b);
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
    this.shapeLumChk = host.querySelector("#ht-shapelum") as HTMLInputElement;
    this.shapeLumChk.addEventListener("change", () => this.setHt({ shapeByLum: this.shapeLumChk.checked }));

    // Frame scrubber + play — only shown for animated sources (video / GIF).
    this.scrubHost = host.querySelector("#ht-scrub") as HTMLElement;
    this.playBtn = document.createElement("button");
    this.playBtn.className = "tool-btn icon-btn ht-play";
    this.playBtn.textContent = "▶";
    this.playBtn.title = "Play / pause the source";
    this.playBtn.addEventListener("click", () => this.togglePlay());
    this.scrubHost.appendChild(this.playBtn);
    this.scrub = createSlider({
      label: "Frame",
      min: 0,
      max: 1,
      step: 0.01,
      value: 0,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => this.scrubTo(v),
    });
    this.scrubHost.appendChild(this.scrub.el);

    // Inline Shapes picker (same selection the brush uses).
    new ShapesPanel(host.querySelector("#ht-shapes") as HTMLElement, store, library);

    this.drop = host.querySelector("#ht-drop") as HTMLElement;
    this.canvas = host.querySelector(".img-preview") as HTMLCanvasElement;
    const input = this.drop.querySelector("input") as HTMLInputElement;
    input.addEventListener("change", () => this.loadSource(input.files?.[0] ?? null));
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
      this.loadSource((e as DragEvent).dataTransfer?.files?.[0] ?? null),
    );

    host.querySelector("#ht-apply")!.addEventListener("click", () => this.apply());
    host.querySelector("#ht-export")!.addEventListener("click", () => this.sendToExport());

    this.sync(store.get());
    store.subscribe((s) => this.sync(s));
  }

  private setHt(patch: Partial<SceneState["halftone"]>): void {
    this.store.set({ halftone: { ...this.store.get().halftone, ...patch } });
  }

  private async loadSource(file: File | null): Promise<void> {
    if (!file) return;
    this.setPlaying(false);
    const meta = await setHalftoneSource(file);
    if (!meta) return;
    this.drop.classList.add("has-image");
    // Animated sources get the Play button; the frame scrubber only shows when the
    // source is seekable (the Safari <img> GIF plays but can't seek).
    this.scrubHost.hidden = !meta.animated;
    this.scrub.el.style.display = meta.seekable ? "" : "none";
    this.scrub.setValue(0);
    this.drawPreview();
    this.bump();
  }

  /** Rasterize a new frame at u (0..1) and repaint the live preview. */
  private async scrubTo(u: number): Promise<void> {
    this.setPlaying(false); // manual scrub takes over playback
    await setHalftoneFrame(u);
    this.drawPreview();
    this.bump();
  }

  /** Play is the GLOBAL animation clock (so the halftone also plays on the canvas
   *  in any mode); this just toggles it. */
  private togglePlay(): void {
    this.setPlaying(!this.store.get().animation.playing);
  }

  private setPlaying(on: boolean): void {
    const a = this.store.get().animation;
    if (a.playing !== on) this.store.set({ animation: { ...a, playing: on } });
  }

  /** While playing in this panel, keep the scrubber playhead + mini preview live
   *  (the renderer advances the actual frames off the global clock). */
  private uiTick = (): void => {
    const s = this.store.get();
    if (!(s.animation.playing && halftoneIsAnimated() && s.contextPanel === "halftone")) {
      this.uiRaf = 0;
      return;
    }
    if (halftoneIsVideo()) this.scrub.setValue(halftonePlayhead());
    this.drawPreview();
    this.uiRaf = requestAnimationFrame(this.uiTick);
  };

  /** Bump the store so the live preview repaints (pixels live outside state). */
  private bump(): void {
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

  /** Jump to Export pre-set for this halftone: bake the current view, turn on the
   *  Halftone-source export, and crop the frame to the union of all frames (covers
   *  every glyph, Free Form). */
  private async sendToExport(): Promise<void> {
    if (!hasHalftoneImage()) return;
    this.setPlaying(false);
    this.apply(); // bake what's on screen so it shows in Export (preview is panel-only)
    const cov = await halftoneCoverage(this.store.get(), this.library);
    const s = this.store.get();
    const cs = s.cellSize;
    const framePatch = cov
      ? { aspect: "free" as const, x: cov.col * cs, y: cov.row * cs, w: cov.cols * cs, h: cov.rows * cs }
      : {};
    this.store.set({
      mode: "export",
      contextPanel: "export",
      tool: "draw",
      exportHalftone: true,
      frame: { ...s.frame, ...framePatch, show: true },
    });
  }

  private sync(s: SceneState): void {
    // Play is global; reflect it on the button and keep the UI tick alive while
    // playing in this panel (the canvas keeps playing in any mode regardless).
    this.playBtn.textContent = s.animation.playing ? "⏸" : "▶";
    if (s.animation.playing && halftoneIsAnimated() && s.contextPanel === "halftone" && !this.uiRaf) {
      this.uiRaf = requestAnimationFrame(this.uiTick);
    }
    for (const [m, b] of this.modeBtns) b.classList.toggle("active", m === s.halftone.mode);
    for (const [t, b] of this.targetBtns) b.classList.toggle("active", t === s.halftone.target);
    this.invertChk.checked = s.halftone.invert;
    this.shapeLumChk.checked = s.halftone.shapeByLum;
    this.contrast.setValue(s.halftone.contrast);
    this.sizeSlider.setValue(s.halftone.scale);
  }
}
