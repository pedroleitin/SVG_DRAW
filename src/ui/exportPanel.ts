import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { SceneState } from "../scene/types";
import { ASPECT_IDS, fitFrame, outSize, snapFrame } from "../export/frame";
import type { AspectId } from "../export/frame";
import { buildSceneSVG } from "../export/svgExport";
import { svgBlob, downloadBlob, svgToPngBlob } from "../export/raster";
import { exportPngSequence } from "../export/sequence";
import { exportMp4, isVideoExportSupported } from "../export/video";
import { loopDuration } from "../anim/animations";
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
  private progress!: HTMLElement;
  private fps = 30;
  private duration = 2;
  private busy = false;

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
          <label class="chk"><input type="checkbox" id="exp-snap" /> Snap to grid</label>
          <label class="chk"><input type="checkbox" id="exp-transp" /> Background transparent</label>
        </div>
        <div class="noise-actions">
          <button id="exp-fit">Fit to view</button>
        </div>
        <div class="noise-actions exp-save">
          <button id="exp-svg">⬇ SVG</button>
          <button id="exp-png">⬇ PNG</button>
        </div>
       </div>
       <div class="exp-col">
        <h3 class="exp-sub">Animated</h3>
        <div class="select-grid">
          <div id="exp-fps-slot"></div>
          <label class="sel dur-field"><span>Duration (s)</span>
            <input id="exp-dur" type="number" min="0.2" max="30" step="0.1" />
          </label>
        </div>
        <div class="noise-actions">
          <button id="exp-loop" title="Set duration to one animation loop">↺ Loop length</button>
        </div>
        <div class="exp-progress" id="exp-progress"></div>
        <div class="noise-actions exp-save">
          <button id="exp-seq">⬇ PNG Seq</button>
          <button id="exp-mp4">⬇ MP4</button>
        </div>
       </div>
      </div>`;
    host.appendChild(panel);

    this.snapChk = panel.querySelector("#exp-snap") as HTMLInputElement;
    this.transpChk = panel.querySelector("#exp-transp") as HTMLInputElement;
    this.dims = aboveHost.querySelector("#exp-dims") as HTMLElement;
    this.durInput = panel.querySelector("#exp-dur") as HTMLInputElement;
    this.progress = panel.querySelector("#exp-progress") as HTMLElement;

    const f = this.store.get().frame;
    this.aspectDD = createDropdown(
      ASPECT_IDS.map((a) => ({ value: a, label: a === "free" ? "Free Form" : a })),
      f.aspect,
      (v) => this.changeAspect(v as AspectId),
      { prefix: "Aspect" },
    );
    panel.querySelector("#exp-aspect-slot")!.append(this.aspectDD.el);
    this.resDD = createDropdown(
      RESOLUTIONS.map((r) => ({ value: String(r), label: `${r}px` })),
      String(f.outWidth),
      (v) => this.setFrame({ outWidth: Number(v) }),
      { prefix: "Res" },
    );
    panel.querySelector("#exp-res-slot")!.append(this.resDD.el);
    const fpsDD = createDropdown(
      FPS_OPTIONS.map((x) => ({ value: String(x) })),
      String(this.fps),
      (v) => (this.fps = Number(v)),
      { prefix: "FPS" },
    );
    panel.querySelector("#exp-fps-slot")!.append(fpsDD.el);

    this.duration = clampDur(loopDuration(this.store.get().animation));
    this.durInput.value = this.duration.toFixed(1);

    this.snapChk.addEventListener("change", () => this.toggleSnap(this.snapChk.checked));
    this.transpChk.addEventListener("change", () => this.store.set({ exportTransparent: this.transpChk.checked }));
    this.durInput.addEventListener("change", () => (this.duration = clampDur(Number(this.durInput.value))));
    panel.querySelector("#exp-fit")!.addEventListener("click", () => this.fit());
    panel.querySelector("#exp-svg")!.addEventListener("click", () => this.exportSVG());
    panel.querySelector("#exp-png")!.addEventListener("click", () => this.exportPNG());
    panel.querySelector("#exp-loop")!.addEventListener("click", () => this.setLoopDuration());
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

  private setLoopDuration(): void {
    this.duration = clampDur(loopDuration(this.store.get().animation));
    this.durInput.value = this.duration.toFixed(1);
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
      const opts = { fps: this.fps, duration: this.duration, background: this.bg(), onProgress };
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
    this.aspectDD.setValue(s.frame.aspect);
    this.resDD.setValue(String(s.frame.outWidth));
    this.snapChk.checked = s.frame.snap;
    this.transpChk.checked = s.exportTransparent;
    const { outW, outH } = outSize(s.frame);
    this.dims.textContent = `Output: ${outW} × ${outH} px`;
  }
}

const clampDur = (v: number): number => Math.min(30, Math.max(0.2, Math.round(v * 10) / 10 || 2));
