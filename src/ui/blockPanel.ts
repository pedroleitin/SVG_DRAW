import type { Store } from "../store/store";
import type { BlockMode, SceneState } from "../scene/types";

/** Block context: choose how the Block tool marks no-go cells — Drag a
 *  rectangle (always cell-snapped), or paint with the Brush — plus Clean to
 *  un-block. (Brush uses the current brush size/shape.) */
export class BlockPanel {
  private modeBtns = new Map<BlockMode, HTMLButtonElement>();
  private cleanChk: HTMLInputElement;

  constructor(host: HTMLElement, private store: Store) {
    host.innerHTML = `
      <h2>Block</h2>
      <p class="ctx-hint">Mark cells where SVGs can't be placed (existing ones are
        removed). Clean clears blocked cells.</p>
      <div class="block-row">
        <div class="seg" id="block-mode"></div>
        <label class="chk"><span>Clean</span><input type="checkbox" id="block-clean" /></label>
      </div>`;

    const seg = host.querySelector("#block-mode") as HTMLElement;
    const labels: Record<BlockMode, string> = { drag: "Drag", brush: "Brush" };
    (["drag", "brush"] as BlockMode[]).forEach((mode) => {
      const b = document.createElement("button");
      b.className = "seg-btn seg-text";
      b.textContent = labels[mode];
      b.title = mode === "drag" ? "Drag a rectangle to block" : "Paint blocked cells";
      b.addEventListener("click", () => this.store.set({ blockMode: mode }));
      this.modeBtns.set(mode, b);
      seg.appendChild(b);
    });

    this.cleanChk = host.querySelector("#block-clean") as HTMLInputElement;
    this.cleanChk.addEventListener("change", () => this.store.set({ blockClean: this.cleanChk.checked }));

    this.sync(store.get());
    store.subscribe((s) => this.sync(s));
  }

  private sync(s: SceneState): void {
    for (const [mode, b] of this.modeBtns) b.classList.toggle("active", s.blockMode === mode);
    this.cleanChk.checked = s.blockClean;
  }
}
