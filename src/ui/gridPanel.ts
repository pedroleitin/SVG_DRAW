import type { Store } from "../store/store";
import type { SceneState } from "../scene/types";
import { createSlider } from "./widgets";
import type { SliderHandle } from "./widgets";

/** Compose-mode Grid context: global cell/grid appearance — rounded corners,
 *  gutter between cells, grid-dot visibility, and how much each SVG fills its
 *  cell (the space between cells). */
export class GridPanel {
  private roundedChk: HTMLInputElement;
  private gutterChk: HTMLInputElement;
  private showChk: HTMLInputElement;
  private blockersChk: HTMLInputElement;
  private fillSlider: SliderHandle;

  constructor(host: HTMLElement, private store: Store) {
    host.innerHTML = `
      <h2>Grid</h2>
      <div class="grid-opts">
        <label class="chk"><input type="checkbox" id="grid-rounded" /> Rounded cells</label>
        <label class="chk"><input type="checkbox" id="grid-gutter" /> Gutter</label>
        <label class="chk"><input type="checkbox" id="grid-show" /> Show grid</label>
        <label class="chk"><input type="checkbox" id="grid-blockers" /> Show blockers</label>
      </div>
      <div class="sliders" id="grid-sliders"></div>`;

    this.fillSlider = createSlider({
      label: "Cell fill",
      min: 0.4,
      max: 1,
      step: 0.05,
      value: store.get().cellFill,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => this.store.set({ cellFill: v }),
    });
    (host.querySelector("#grid-sliders") as HTMLElement).appendChild(this.fillSlider.el);

    this.roundedChk = host.querySelector("#grid-rounded") as HTMLInputElement;
    this.roundedChk.addEventListener("change", () =>
      this.store.set({ cellRounded: this.roundedChk.checked }),
    );
    this.gutterChk = host.querySelector("#grid-gutter") as HTMLInputElement;
    this.gutterChk.addEventListener("change", () =>
      this.store.set({ cellGutter: this.gutterChk.checked }),
    );
    this.showChk = host.querySelector("#grid-show") as HTMLInputElement;
    this.showChk.addEventListener("change", () => this.store.set({ showGrid: this.showChk.checked }));
    this.blockersChk = host.querySelector("#grid-blockers") as HTMLInputElement;
    this.blockersChk.addEventListener("change", () =>
      this.store.set({ showBlockers: this.blockersChk.checked }),
    );

    this.sync(store.get());
    store.subscribe((s) => this.sync(s));
  }

  private sync(s: SceneState): void {
    this.roundedChk.checked = s.cellRounded;
    this.gutterChk.checked = s.cellGutter;
    this.showChk.checked = s.showGrid;
    this.blockersChk.checked = s.showBlockers;
    this.fillSlider.setValue(s.cellFill);
  }
}
