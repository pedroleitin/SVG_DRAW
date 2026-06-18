import type { Store } from "../store/store";
import type { EditOp, SceneState } from "../scene/types";
import { paletteById } from "../features/palette";

/** Vector die (5 pips) for the "random color" swatch. */
const DICE_ICON = `<svg viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="4.5" stroke="currentColor" stroke-width="2"/>
  <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
  <circle cx="16" cy="8" r="1.5" fill="currentColor"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
  <circle cx="8" cy="16" r="1.5" fill="currentColor"/>
  <circle cx="16" cy="16" r="1.5" fill="currentColor"/>
</svg>`;

/** "No color" swatch: a white tile with a red diagonal bar. */
const NONE_ICON = `<svg viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="4.5" fill="#fff" stroke="currentColor" stroke-width="2"/>
  <line x1="5" y1="19" x2="19" y2="5" stroke="#e03131" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

const TARGETS: { op: EditOp; label: string; hint: string }[] = [
  { op: "recolor-item", label: "Gliph", hint: "Recolor the icon with the selected color" },
  { op: "recolor-cell", label: "Cell", hint: "Recolor the cell background with the selected color" },
  { op: "recolor-both", label: "Both", hint: "Recolor the icon and the cell background together" },
];

/** Compose → Edit: Edit ops + Brush/Size (left) and Recolor (right), split by a
 *  divider. Pick an op, then click/drag over canvas items to apply it. */
export class EditPanel {
  private btns = new Map<EditOp, HTMLButtonElement>();
  private swatchHost: HTMLElement;
  private swatchSig = "";

  constructor(host: HTMLElement, private store: Store) {
    host.innerHTML = `
      <div class="edit-cols">
        <div class="edit-side">
          <h2>Edit</h2>
          <p class="ctx-hint">Click or drag over items on the canvas.</p>
          <div class="edit-row">
            <button class="tool-btn" id="edit-rotate">Rotate</button>
            <button class="tool-btn" id="edit-swap">Swap</button>
          </div>
        </div>
        <div class="edit-sep"></div>
        <div class="edit-side">
          <h2>Recolor</h2>
          <div class="edit-swatches"></div>
          <div class="edit-btns" id="edit-targets"></div>
        </div>
      </div>`;

    const s = store.get();
    this.addOp(host.querySelector("#edit-rotate") as HTMLButtonElement, "rotate", "Click an item to turn it 90°");
    this.addOp(host.querySelector("#edit-swap") as HTMLButtonElement, "swap", "Replace the item with a shape selected in Shapes");
    const tgtHost = host.querySelector("#edit-targets") as HTMLElement;
    for (const o of TARGETS) {
      const b = document.createElement("button");
      b.className = "tool-btn";
      b.textContent = o.label;
      b.title = o.hint;
      b.addEventListener("click", () => this.store.set({ editOp: o.op }));
      this.btns.set(o.op, b);
      tgtHost.appendChild(b);
    }

    this.swatchHost = host.querySelector(".edit-swatches") as HTMLElement;
    this.sync(s);
    store.subscribe((st) => this.sync(st));
  }

  private addOp(btn: HTMLButtonElement, op: EditOp, hint: string): void {
    btn.title = hint;
    btn.addEventListener("click", () => this.store.set({ editOp: op }));
    this.btns.set(op, btn);
  }

  private sync(s: SceneState): void {
    for (const [op, b] of this.btns) b.classList.toggle("active", s.editOp === op);

    const active = paletteById(s.palettes, s.activePaletteId);
    const sig = [s.activePaletteId, JSON.stringify(active.colors)].join("|");
    if (sig !== this.swatchSig) {
      this.swatchSig = sig;
      this.swatchHost.innerHTML = "";
      const none = document.createElement("button");
      none.className = "edit-swatch none";
      none.innerHTML = NONE_ICON;
      none.title = "Recolor to none (clear the cell / hide the icon)";
      none.addEventListener("click", () =>
        this.store.set({ editRecolorNone: true, editRecolorRandom: false }),
      );
      this.swatchHost.appendChild(none);
      const dice = document.createElement("button");
      dice.className = "edit-swatch dice";
      dice.innerHTML = DICE_ICON;
      dice.title = "Recolor with a random palette color";
      dice.addEventListener("click", () =>
        this.store.set({ editRecolorRandom: true, editRecolorNone: false }),
      );
      this.swatchHost.appendChild(dice);
      active.colors.forEach((color, i) => {
        const sw = document.createElement("button");
        sw.className = "edit-swatch color";
        sw.style.background = color;
        sw.title = `Recolor with color ${i}`;
        sw.addEventListener("click", () =>
          this.store.set({ activeColorIndex: i, editRecolorRandom: false, editRecolorNone: false }),
        );
        this.swatchHost.appendChild(sw);
      });
    }
    const none = this.swatchHost.querySelector(".edit-swatch.none");
    if (none) none.classList.toggle("active", s.editRecolorNone);
    const dice = this.swatchHost.querySelector(".edit-swatch.dice");
    if (dice) dice.classList.toggle("active", s.editRecolorRandom);
    this.swatchHost.querySelectorAll<HTMLElement>(".edit-swatch.color").forEach((el, i) =>
      el.classList.toggle(
        "active",
        !s.editRecolorRandom && !s.editRecolorNone && i === s.activeColorIndex,
      ),
    );
  }
}
