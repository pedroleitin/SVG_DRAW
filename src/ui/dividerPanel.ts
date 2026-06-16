import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { History } from "../commands/command";
import type { SceneState } from "../scene/types";
import { ApplyMaskCommand } from "../commands/sceneCommands";
import { buildInstance } from "../features/placement";
import { subdivide } from "../features/divider";
import { visibleCellRange } from "../scene/grid";
import { cellKey } from "../scene/types";
import { createSlider } from "./widgets";
import type { SliderHandle } from "./widgets";

/** Region (in cells) the Divider works on: the visible range, capped. */
function dividerRegion(s: SceneState) {
  const r = visibleCellRange(s.camera, s.cellSize, 0);
  return {
    minCol: r.minCol,
    minRow: r.minRow,
    cols: Math.min(80, r.maxCol - r.minCol + 1),
    rows: Math.min(80, r.maxRow - r.minRow + 1),
  };
}

/** Compose "Divider": recursively splits the view into rectangular blocks
 *  (live preview) and Apply fills each block with a scaled SVG. */
export class DividerPanel {
  private densitySlider: SliderHandle;

  constructor(
    host: HTMLElement,
    private store: Store,
    private library: Library,
    private history: History,
  ) {
    host.innerHTML = `
      <h2>Divider</h2>
      <p class="ctx-hint">Recursively splits the view into rectangular blocks.
        Apply fills each block with a scaled SVG.</p>
      <div id="div-density"></div>
      <div class="noise-actions">
        <button id="div-reseed">Reseed</button>
        <button id="div-apply">Apply to view</button>
      </div>`;

    this.densitySlider = createSlider({
      label: "Divisions",
      min: 2,
      max: 8,
      step: 1,
      value: store.get().divider.density,
      format: (v) => String(v),
      onChange: (v) => this.setDiv({ density: v }),
    });
    host.querySelector("#div-density")!.appendChild(this.densitySlider.el);
    host.querySelector("#div-reseed")!.addEventListener("click", () => this.reseed());
    host.querySelector("#div-apply")!.addEventListener("click", () => this.apply());

    store.subscribe((s) => this.densitySlider.setValue(s.divider.density));
  }

  private setDiv(patch: Partial<SceneState["divider"]>): void {
    this.store.set({ divider: { ...this.store.get().divider, ...patch } });
  }

  private reseed(): void {
    this.setDiv({ seed: (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0 });
  }

  /** Subdivide the view, drop an SVG in each block (skipping blocked ones),
   *  replacing whatever was in the region — one undo step. */
  private apply(): void {
    const s = this.store.get();
    const { minCol, minRow, cols, rows } = dividerRegion(s);
    const blocks = subdivide(minCol, minRow, cols, rows, s.divider.density, s.divider.seed);

    const blockedHit = (col: number, row: number, cw: number, ch: number): boolean => {
      for (let y = row; y < row + ch; y++) {
        for (let x = col; x < col + cw; x++) if (s.blocked[cellKey(x, y)]) return true;
      }
      return false;
    };

    const places = [];
    for (const b of blocks) {
      if (blockedHit(b.col, b.row, b.cw, b.ch)) continue;
      places.push(buildInstance(s, this.library, b.col, b.row, b.cw, b.ch));
    }
    const placeKeys = new Set(places.map((p) => cellKey(p.col, p.row)));

    // Clear every instance that OVERLAPS the region — not just those rooted in
    // it — so multi-cell blocks anchored just outside still get cleared
    // (otherwise they'd survive and overlap the fresh tiling).
    const right = minCol + cols;
    const bottom = minRow + rows;
    const eraseKeys: string[] = [];
    for (const key in s.instances) {
      const inst = s.instances[key];
      const cw = inst.cw ?? 1;
      const ch = inst.ch ?? 1;
      if (
        inst.col < right &&
        inst.col + cw > minCol &&
        inst.row < bottom &&
        inst.row + ch > minRow &&
        !placeKeys.has(key)
      ) {
        eraseKeys.push(key);
      }
    }

    if (places.length || eraseKeys.length) {
      this.history.dispatch(new ApplyMaskCommand(places, eraseKeys));
    }
  }
}
