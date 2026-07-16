import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { Instance, SceneState } from "../scene/types";
import { cellKey } from "../scene/types";
import { ASPECT_IDS, fitFrame, outSize, snapFrame } from "../export/frame";
import type { AspectId } from "../export/frame";
import { buildSceneSVG, shapeLoopDuration } from "../export/svgExport";
import { svgBlob, downloadBlob, svgToPngBlob } from "../export/raster";
import { exportPngSequence } from "../export/sequence";
import { exportMp4, isVideoExportSupported } from "../export/video";
import { loopDuration } from "../anim/animations";
import {
  halftoneIsAnimated,
  halftoneDuration,
  setHalftoneFrame,
  halftoneInstances,
  halftoneLastBox,
  halftoneCoverage,
} from "../features/halftone";
import { createDropdown } from "./widgets";
import type { DropdownHandle } from "./widgets";

const RESOLUTIONS = [720, 1080, 1440, 2160];
const FPS_OPTIONS = [24, 30, 60];

/** Export panel: choose an aspect-ratio frame + output resolution, preview it
 *  as a letterbox on the canvas, and export the framed scene to SVG / PNG. */
export class ExportPanel {
  private aspectDD!: DropdownHandle;
  private resDD!: DropdownHandle;
  private snapChk!: HTMLInputElement;
  private transpChk!: HTMLInputElement;
  private dims!: HTMLElement;
  private durInput!: HTMLInputElement;
  private htChk!: HTMLInputElement;
  private progress!: HTMLElement;
  private fps = 30;
  private duration = 2;
  private busy = false;
  private prevMode?: SceneState["mode"];

  constructor(host: HTMLElement, private store: Store, private library: Library, aboveHost: HTMLElement) {
    // Output size shows as a left-aligned pill above the context menu.
    aboveHost.innerHTML = `<div class="float output-pill"><span id="exp-dims"></span></div>`;

    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "export-panel";
    panel.innerHTML = `
      <div class="exp-cols">
       <div class="exp-col">
        <h3 class="exp-sub">Static</h3>
        <div class="select-grid">
          <div id="exp-aspect-slot"></div>
          <div id="exp-res-slot"></div>
        </div>
        <div class="exp-toggles">
          <label class="chk" title="Align the export frame to the cell grid so nothing is cut mid-cell"><input type="checkbox" id="exp-snap" /> Snap to grid</label>
          <label class="chk" title="Export with no background fill (transparent PNG / SVG)"><input type="checkbox" id="exp-transp" /> Background transparent</label>
        </div>
        <div class="noise-actions" id="exp-fit-row">
          <button id="exp-fit" title="Resize the export frame to match the current view">Fit to view</button>
        </div>
        <div class="noise-actions exp-save">
          <button id="exp-svg" title="Download the framed scene as a lossless vector SVG">⬇ SVG</button>
          <button id="exp-png" title="Download the framed scene as a raster PNG at the chosen resolution">⬇ PNG</button>
        </div>
       </div>
       <div class="exp-col">
        <h3 class="exp-sub">Animated</h3>
        <div class="select-grid">
          <div id="exp-fps-slot"></div>
          <div class="num-field">
            <span class="dd-prefix">Dur</span>
            <input id="exp-dur" type="number" min="0.2" max="30" step="0.1" title="Duration (seconds)" />
          </div>
        </div>
        <div class="exp-toggles">
          <label class="chk" id="exp-ht-row" title="Export the animated Halftone source instead of the scene animation">
            <input type="checkbox" id="exp-ht" /> Halftone source
          </label>
        </div>
        <div class="exp-progress" id="exp-progress"></div>
        <div class="noise-actions exp-save">
          <button id="exp-seq" title="Download an animated pass as a ZIP of numbered PNG frames">⬇ PNG Seq</button>
          <button id="exp-mp4" title="Download an animated pass as an MP4 video (needs WebCodecs)">⬇ MP4</button>
        </div>
       </div>
      </div>`;
    host.appendChild(panel);

    this.snapChk = panel.querySelector("#exp-snap") as HTMLInputElement;
    this.transpChk = panel.querySelector("#exp-transp") as HTMLInputElement;
    this.dims = aboveHost.querySelector("#exp-dims") as HTMLElement;
    this.durInput = panel.querySelector("#exp-dur") as HTMLInputElement;
    this.htChk = panel.querySelector("#exp-ht") as HTMLInputElement;
    this.progress = panel.querySelector("#exp-progress") as HTMLElement;

    const f = this.store.get().frame;
    this.aspectDD = createDropdown(
      ASPECT_IDS.map((a) => ({ value: a, label: a === "free" ? "Free Form" : a })),
      f.aspect,
      (v) => this.changeAspect(v as AspectId),
      { prefix: "Aspect", title: "Aspect ratio of the export frame" },
    );
    panel.querySelector("#exp-aspect-slot")!.append(this.aspectDD.el);
    this.resDD = createDropdown(
      RESOLUTIONS.map((r) => ({ value: String(r), label: `${r}px` })),
      String(f.outHeight),
      (v) => this.setFrame({ outHeight: Number(v) }),
      { prefix: "Res", title: "Output resolution (height in pixels)" },
    );
    panel.querySelector("#exp-res-slot")!.append(this.resDD.el);
    const fpsDD = createDropdown(
      FPS_OPTIONS.map((x) => ({ value: String(x) })),
      String(this.fps),
      (v) => (this.fps = Number(v)),
      { prefix: "FPS", title: "Frames per second (animated export)" },
    );
    panel.querySelector("#exp-fps-slot")!.append(fpsDD.el);

    this.duration = clampDur(this.autoDuration());
    this.durInput.value = this.duration.toFixed(1);

    this.snapChk.addEventListener("change", () => this.toggleSnap(this.snapChk.checked));
    this.transpChk.addEventListener("change", () => this.store.set({ exportTransparent: this.transpChk.checked }));
    this.durInput.addEventListener("change", () => (this.duration = clampDur(Number(this.durInput.value))));
    this.htChk.addEventListener("change", () => {
      this.store.set({ exportHalftone: this.htChk.checked });
      if (this.htChk.checked) {
        // Default the duration to one pass of the source.
        if (halftoneDuration() > 0) {
          this.duration = clampDur(halftoneDuration());
          this.durInput.value = this.duration.toFixed(1);
        }
        // Frame the union of all frames so nothing is cut by an unseen frame.
        void this.fitToCoverage();
      }
    });
    panel.querySelector("#exp-fit")!.addEventListener("click", () => this.fit());
    panel.querySelector("#exp-svg")!.addEventListener("click", () => this.exportSVG());
    panel.querySelector("#exp-png")!.addEventListener("click", () => this.exportPNG());
    panel.querySelector("#exp-seq")!.addEventListener("click", () => this.runExport("seq"));
    const mp4Btn = panel.querySelector("#exp-mp4") as HTMLButtonElement;
    mp4Btn.addEventListener("click", () => this.runExport("mp4"));
    if (!isVideoExportSupported()) {
      mp4Btn.disabled = true;
      mp4Btn.title = "MP4 needs WebCodecs (use Chrome/Edge). PNG Seq works everywhere.";
    }

    this.sync(store.get());
    store.subscribe((s) => this.sync(s));
  }

  private setFrame(patch: Partial<SceneState["frame"]>): void {
    this.store.set({ frame: { ...this.store.get().frame, ...patch } });
  }

  /** Changing aspect re-fits the frame to the current view and shows it. */
  private changeAspect(aspect: AspectId): void {
    const s = this.store.get();
    let box = fitFrame(s.camera, aspect);
    if (s.frame.snap && aspect === "free") box = snapFrame(box, s.cellSize);
    this.setFrame({ aspect, ...box, show: true });
  }

  private fit(): void {
    const s = this.store.get();
    let box = fitFrame(s.camera, s.frame.aspect);
    if (s.frame.snap && s.frame.aspect === "free") box = snapFrame(box, s.cellSize);
    this.setFrame({ ...box, show: true });
  }

  /** Turning snap on immediately aligns the current frame to the grid. */
  private toggleSnap(on: boolean): void {
    const s = this.store.get();
    if (on && s.frame.aspect === "free") {
      this.setFrame({ snap: on, ...snapFrame(s.frame, s.cellSize) });
    } else {
      this.setFrame({ snap: on });
    }
  }

  /** Background to bake into exports: null when "transparent export" is on. */
  private bg(): string | null {
    const s = this.store.get();
    return s.exportTransparent ? null : s.bgColor;
  }

  private exportSVG(): void {
    const svg = buildSceneSVG(this.store.get(), this.library, undefined, this.bg());
    downloadBlob(svgBlob(svg), "svg-grid.svg");
  }

  private async exportPNG(): Promise<void> {
    const state = this.store.get();
    const { outW, outH } = outSize(state.frame);
    const svg = buildSceneSVG(state, this.library, undefined, this.bg());
    const png = await svgToPngBlob(svg, outW, outH);
    downloadBlob(png, `svg-grid-${outW}x${outH}.png`);
  }


  /** Run an animated export (PNG sequence or MP4) with a progress readout. */
  private async runExport(kind: "seq" | "mp4"): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const onProgress = (done: number, total: number) => {
      this.progress.textContent = `Rendering ${done}/${total}…`;
    };
    try {
      const state = this.store.get();
      const renderFrame =
        state.exportHalftone && halftoneIsAnimated()
          ? this.halftoneFrameRenderer(state, kind)
          : undefined;
      const opts = { fps: this.fps, duration: this.duration, background: this.bg(), onProgress, renderFrame };
      if (kind === "seq") await exportPngSequence(state, this.library, opts);
      else await exportMp4(state, this.library, opts);
      this.progress.textContent = "Done ✓";
    } catch (err) {
      this.progress.textContent = `Export failed: ${(err as Error).message ?? err}`;
    } finally {
      this.busy = false;
    }
  }

  private sync(s: SceneState): void {
    // Entering Export refreshes the duration to the full animation length, so
    // it always exports a complete pass (like the old "Loop length").
    if (s.mode === "export" && this.prevMode !== "export") {
      this.duration = clampDur(this.autoDuration());
      this.durInput.value = this.duration.toFixed(1);
    }
    this.prevMode = s.mode;

    this.aspectDD.setValue(s.frame.aspect);
    this.resDD.setValue(String(s.frame.outHeight));
    this.snapChk.checked = s.frame.snap;
    this.transpChk.checked = s.exportTransparent;
    // "Fit to view" is only relevant for the manually-positioned Free Form frame.
    // "Fit to view" works for every aspect (fitFrame keeps the ratio); always shown.
    // The Halftone-source toggle is only usable with an animated source loaded.
    const htAnim = halftoneIsAnimated();
    this.htChk.disabled = !htAnim;
    this.htChk.checked = htAnim && s.exportHalftone;
    const htRow = this.htChk.closest(".chk") as HTMLElement;
    if (htRow) htRow.style.opacity = htAnim ? "" : "0.45";
    const { outW, outH } = outSize(s.frame);
    this.dims.innerHTML = `Output: <span class="mono">${outW} × ${outH}</span> px`;
  }

  /** Natural export length: the longer of the lifecycle loop and the internal
   *  shape-animation loop, so animated shapes export a full cycle even when the
   *  scene reveal is short/static. */
  private autoDuration(): number {
    const s = this.store.get();
    return Math.max(loopDuration(s.animation), shapeLoopDuration(s, this.library));
  }

  /** Frame the union of every source frame's glyphs (Free Form), so the crop
   *  covers all of them even ones you didn't scrub to. */
  private async fitToCoverage(): Promise<void> {
    this.progress.textContent = "Mapping frames…";
    const cov = await halftoneCoverage(this.store.get(), this.library);
    this.progress.textContent = "";
    if (!cov) return;
    const cs = this.store.get().cellSize;
    this.setFrame({
      aspect: "free",
      x: cov.col * cs,
      y: cov.row * cs,
      w: cov.cols * cs,
      h: cov.rows * cs,
      show: true,
    });
  }

  /** Per-frame SVG builder for an animated Halftone source export: seek the
   *  source by time, halftone it, and emit a static frame SVG. */
  private halftoneFrameRenderer(
    state: SceneState,
    kind: "seq" | "mp4",
  ): (timeSec: number) => Promise<string> {
    const dur = halftoneDuration() || this.duration;
    const bg = kind === "mp4" ? this.bg() ?? "#ffffff" : this.bg();
    // Reuse the exact grid the user last saw (preview/apply), not a fresh fit from
    // the export-time camera — so the per-cell shapes/colors (seeded by col,row)
    // and the framing match what's on screen. The frame just crops it.
    const box = halftoneLastBox() ?? undefined;
    return async (timeSec: number): Promise<string> => {
      const u = dur > 0 ? (timeSec / dur) % 1 : 0;
      await setHalftoneFrame(u);
      const { places } = halftoneInstances(state, this.library, box);
      const instances: Record<string, Instance> = {};
      for (const p of places) instances[cellKey(p.col, p.row)] = p;
      return buildSceneSVG({ ...state, instances }, this.library, undefined, bg);
    };
  }
}

const clampDur = (v: number): number => Math.min(30, Math.max(0.2, Math.round(v * 10) / 10 || 2));
