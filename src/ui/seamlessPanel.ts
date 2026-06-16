import type { Store } from "../store/store";
import type { History } from "../commands/command";
import { ApplyMaskCommand } from "../commands/sceneCommands";
import { tileFill } from "../features/placement";

/** Seamless context: the tile frame is live while this is open. "Apply" bakes
 *  the repeated pattern onto the canvas, turns Seamless off, and returns to Draw. */
export class SeamlessPanel {
  constructor(host: HTMLElement, private store: Store, private history: History) {
    host.innerHTML = `
      <h2>Seamless</h2>
      <p class="ctx-hint">Edit elements inside the frame — the faded copies show
        the pattern tiling. Highlighted cells sit on the seam.</p>
      <div class="noise-actions">
        <button id="seamless-apply">Apply to view</button>
        <button id="seamless-crop">Apply + Crop</button>
      </div>`;
    host.querySelector("#seamless-apply")!.addEventListener("click", () => this.apply());
    host.querySelector("#seamless-crop")!.addEventListener("click", () => this.applyCrop());
  }

  /** Bake the repeated pattern onto the canvas (one undo step). */
  private bake(): void {
    const s = this.store.get();
    const { places, eraseKeys } = tileFill(s);
    if (places.length || eraseKeys.length) {
      this.history.dispatch(new ApplyMaskCommand(places, eraseKeys));
    }
  }

  /** Apply: bake, leave Seamless, return to drawing. */
  private apply(): void {
    this.bake();
    this.store.set({
      mask: { ...this.store.get().mask, seamless: false },
      mode: "draw",
      tool: "draw",
      contextPanel: null,
    });
  }

  /** Apply + Crop: bake, then jump to Export with the crop set to the tile. */
  private applyCrop(): void {
    this.bake();
    const s = this.store.get();
    const t = s.tileFrame;
    this.store.set({
      mask: { ...s.mask, seamless: false },
      frame: { ...s.frame, aspect: "free", x: t.x, y: t.y, w: t.w, h: t.h, show: true },
      mode: "export",
      contextPanel: "export",
    });
  }
}
