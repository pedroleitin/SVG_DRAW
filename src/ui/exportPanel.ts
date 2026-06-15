import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { SceneState } from "../scene/types";
import { ASPECT_IDS, fitFrame, outSize, snapFrame } from "../export/frame";
import type { AspectId } from "../export/frame";
import { buildSceneSVG } from "../export/svgExport";
import { svgBlob, downloadBlob, svgToPngBlob } from "../export/raster";

const RESOLUTIONS = [720, 1080, 1440, 2160];

/** Export panel: choose an aspect-ratio frame + output resolution, preview it
 *  as a letterbox on the canvas, and export the framed scene to SVG / PNG. */
export class ExportPanel {
  private aspectSel!: HTMLSelectElement;
  private resSel!: HTMLSelectElement;
  private showChk!: HTMLInputElement;
  private snapChk!: HTMLInputElement;
  private dims!: HTMLElement;

  constructor(host: HTMLElement, private store: Store, private library: Library) {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "export-panel";
    panel.innerHTML = `
      <h2>Export</h2>
      <div class="select-grid">
        <label class="sel"><span>Aspect</span>
          <select id="exp-aspect">${ASPECT_IDS.map((a) => `<option value="${a}">${a === "free" ? "Free Form" : a}</option>`).join("")}</select>
        </label>
        <label class="sel"><span>Resolution</span>
          <select id="exp-res">${RESOLUTIONS.map((r) => `<option value="${r}">${r}px</option>`).join("")}</select>
        </label>
      </div>
      <div class="exp-toggles">
        <label class="chk"><input type="checkbox" id="exp-show" /> Show frame</label>
        <label class="chk"><input type="checkbox" id="exp-snap" /> Snap to grid</label>
      </div>
      <div class="exp-dims" id="exp-dims"></div>
      <div class="noise-actions">
        <button id="exp-fit">Fit to view</button>
      </div>
      <div class="noise-actions">
        <button id="exp-svg">⬇ SVG</button>
        <button id="exp-png">⬇ PNG</button>
      </div>`;
    host.appendChild(panel);

    this.aspectSel = panel.querySelector("#exp-aspect") as HTMLSelectElement;
    this.resSel = panel.querySelector("#exp-res") as HTMLSelectElement;
    this.showChk = panel.querySelector("#exp-show") as HTMLInputElement;
    this.snapChk = panel.querySelector("#exp-snap") as HTMLInputElement;
    this.dims = panel.querySelector("#exp-dims") as HTMLElement;

    this.aspectSel.addEventListener("change", () => this.changeAspect(this.aspectSel.value as AspectId));
    this.resSel.addEventListener("change", () => this.setFrame({ outWidth: Number(this.resSel.value) }));
    this.showChk.addEventListener("change", () => this.setFrame({ show: this.showChk.checked }));
    this.snapChk.addEventListener("change", () => this.toggleSnap(this.snapChk.checked));
    panel.querySelector("#exp-fit")!.addEventListener("click", () => this.fit());
    panel.querySelector("#exp-svg")!.addEventListener("click", () => this.exportSVG());
    panel.querySelector("#exp-png")!.addEventListener("click", () => this.exportPNG());

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

  private exportSVG(): void {
    const svg = buildSceneSVG(this.store.get(), this.library);
    downloadBlob(svgBlob(svg), "svg-grid.svg");
  }

  private async exportPNG(): Promise<void> {
    const state = this.store.get();
    const { outW, outH } = outSize(state.frame);
    const svg = buildSceneSVG(state, this.library);
    const png = await svgToPngBlob(svg, outW, outH);
    downloadBlob(png, `svg-grid-${outW}x${outH}.png`);
  }

  private sync(s: SceneState): void {
    if (this.aspectSel.value !== s.frame.aspect) this.aspectSel.value = s.frame.aspect;
    if (Number(this.resSel.value) !== s.frame.outWidth) this.resSel.value = String(s.frame.outWidth);
    this.showChk.checked = s.frame.show;
    this.snapChk.checked = s.frame.snap;
    const { outW, outH } = outSize(s.frame);
    this.dims.textContent = `${outW} × ${outH}px`;
  }
}
