import type { Store } from "../store/store";
import type { SceneState } from "../scene/types";

/** Compose-mode Grid context: global cell/grid appearance — rounded corners,
 *  gutter between cells, and grid-dot visibility. */
export class GridPanel {
  private roundedChk: HTMLInputElement;
  private gutterChk: HTMLInputElement;
  private showChk: HTMLInputElement;

  constructor(host: HTMLElement, private store: Store) {
    host.innerHTML = `
      <h2>Grid</h2>
      <div class="grid-opts">
        <label class="chk"><input type="checkbox" id="grid-rounded" /> Rounded cells</label>
        <label class="chk"><input type="checkbox" id="grid-gutter" /> Gutter</label>
        <label class="chk"><input type="checkbox" id="grid-show" /> Show grid</label>
      </div>`;

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

    this.sync(store.get());
    store.subscribe((s) => this.sync(s));
  }

  private sync(s: SceneState): void {
    this.roundedChk.checked = s.cellRounded;
    this.gutterChk.checked = s.cellGutter;
    this.showChk.checked = s.showGrid;
  }
}
