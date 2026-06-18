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
  halftoneDuration,
  halftonePlayVideo,
  halftonePauseVideo,
  sampleHalftoneCurrentFrame,
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
  private playing = false;
  private raf = 0;
  private playStart = 0;
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
    this.stopPlay();
    const meta = await setHalftoneSource(file);
    if (!meta) return;
    this.drop.classList.add("has-image");
    // Show the frame scrubber + play for animated sources (video / GIF).
    this.scrubHost.hidden = !meta.animated;
    this.scrub.setValue(0);
    this.drawPreview();
    this.bump();
  }

  /** Rasterize a new frame at u (0..1) and repaint the live preview. */
  private async scrubTo(u: number): Promise<void> {
    if (this.playing) this.stopPlay(); // manual scrub takes over playback
    await setHalftoneFrame(u);
    this.drawPreview();
    this.bump();
  }

  private togglePlay(): void {
    if (this.playing) this.stopPlay();
    else this.startPlay();
  }

  private startPlay(): void {
    if (this.playing || !halftoneIsAnimated()) return;
    this.playing = true;
    this.playStart = performance.now();
    this.playBtn.textContent = "⏸";
    document.body.classList.add("ht-playing"); // drop panel blur while it animates
    halftonePlayVideo();
    this.raf = requestAnimationFrame(this.tickPlay);
  }

  private stopPlay(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    halftonePauseVideo();
    document.body.classList.remove("ht-playing");
    this.playBtn.textContent = "▶";
  }

  /** Advance the source and repaint the preview each frame while playing. */
  private tickPlay = async (): Promise<void> => {
    if (!this.playing) return;
    if (halftoneIsVideo()) {
      sampleHalftoneCurrentFrame(); // draw the playing video's current frame
      this.scrub.setValue(halftonePlayhead());
    } else {
      const dur = halftoneDuration() || 1;
      const u = ((performance.now() - this.playStart) / 1000 / dur) % 1;
      this.scrub.setValue(u);
      await setHalftoneFrame(u);
    }
    this.drawPreview();
    this.bump();
    if (this.playing) this.raf = requestAnimationFrame(this.tickPlay);
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

  /** Jump to Export pre-set for this halftone: Halftone-source on, and the frame
   *  cropped to the union of all frames (covers every glyph, Free Form). */
  private async sendToExport(): Promise<void> {
    if (!hasHalftoneImage()) return;
    this.stopPlay();
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
    // Stop the source playback when the panel is no longer the active context.
    if (s.contextPanel !== "halftone" && this.playing) this.stopPlay();
    for (const [m, b] of this.modeBtns) b.classList.toggle("active", m === s.halftone.mode);
    for (const [t, b] of this.targetBtns) b.classList.toggle("active", t === s.halftone.target);
    this.invertChk.checked = s.halftone.invert;
    this.shapeLumChk.checked = s.halftone.shapeByLum;
    this.contrast.setValue(s.halftone.contrast);
    this.sizeSlider.setValue(s.halftone.scale);
  }
}
