import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { Asset, SceneState } from "../scene/types";
import { importSvgFile } from "../features/svgImport";
import { saveUserAsset, deleteUserAsset } from "../store/persistence";
import {
  sampleTrack,
  sampleVisibility,
  transformListToString,
  type AssetAnim,
} from "../features/svgAnim";

/** Vector die (5 pips) for the "random" tile. */
const DICE_ICON = `<svg viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="4.5" stroke="currentColor" stroke-width="2"/>
  <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
  <circle cx="16" cy="8" r="1.5" fill="currentColor"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
  <circle cx="8" cy="16" r="1.5" fill="currentColor"/>
  <circle cx="16" cy="16" r="1.5" fill="currentColor"/>
</svg>`;

/** Shapes context panel: a multi-select SVG library (the brush picks a random
 *  one of the selected shapes) + Select all + upload. */
export class ShapesPanel {
  private root: HTMLElement;
  private sig = "";
  private animChk!: HTMLInputElement;
  /** Live-animated preview elements collected from the drawer (rebuilt each
   *  render); driven by a single ambient rAF so the thumbnails move. */
  private animPreviews: { el: Element; track: AssetAnim }[] = [];
  private raf = 0;

  constructor(host: HTMLElement, private store: Store, private library: Library) {
    this.root = host;
    this.root.innerHTML = `
      <div class="shapes-head">
        <h2>Shapes</h2>
        <label class="chk" title="Include animated shapes when the brush picks a random shape"><input type="checkbox" id="shapes-anim" /> <span>Animated in random</span></label>
        <button id="shapes-all" class="tool-btn">Select all</button>
      </div>
      <div class="asset-row">
        <div class="asset-list"></div>
        <label class="dropzone" title="Upload SVG (or drop here)">
          <input type="file" accept=".svg,image/svg+xml" multiple hidden />
          <span>⬆ Upload</span>
        </label>
      </div>`;
    this.root.querySelector("#shapes-all")!.addEventListener("click", () => this.selectAll());
    this.animChk = this.root.querySelector("#shapes-anim") as HTMLInputElement;
    this.animChk.checked = store.get().brushRandomAnimated;
    this.animChk.addEventListener("change", () =>
      this.store.set({ brushRandomAnimated: this.animChk.checked }),
    );
    this.wireUpload();
    this.render(store.get());
    store.subscribe((s) => this.render(s));
  }

  private render(s: SceneState): void {
    if (this.animChk) this.animChk.checked = s.brushRandomAnimated;
    const sig = [s.brushAssets.join(","), this.library.ids().join(",")].join("|");
    if (sig === this.sig) return;
    this.sig = sig;
    const sel = new Set(s.brushAssets);
    const grid = this.root.querySelector(".asset-list") as HTMLElement;
    grid.innerHTML = "";
    this.animPreviews = [];
    grid.appendChild(this.assetButton("random", DICE_ICON, "Random", sel.has("random")));
    const sep = document.createElement("div");
    sep.className = "asset-sep";
    grid.appendChild(sep);
    for (const asset of this.library.all()) {
      grid.appendChild(
        this.assetButton(asset.id, this.preview(asset), asset.name, sel.has(asset.id), asset),
      );
    }
    this.ensurePreviewLoop();
  }

  /** Start the ambient preview loop if any animated thumbnails are present. */
  private ensurePreviewLoop(): void {
    if (this.raf || !this.animPreviews.length) return;
    this.raf = requestAnimationFrame(this.tickPreviews);
  }

  /** Sample each animated preview's track at wall-clock time and write the SVG
   *  transform/visibility — identical to how the renderer drives the canvas, so
   *  the thumbnail matches the placed shape. Continuous forward loop. */
  private tickPreviews = (): void => {
    if (!this.animPreviews.length) {
      this.raf = 0;
      return;
    }
    const T = performance.now() / 1000;
    for (const { el, track } of this.animPreviews) {
      const p = (((T / (track.dur > 0 ? track.dur : 1)) % 1) + 1) % 1;
      const fns = sampleTrack(track, p);
      if (fns.length) el.setAttribute("transform", transformListToString(fns));
      const vis = sampleVisibility(track, p);
      if (vis) el.setAttribute("visibility", vis);
    }
    this.raf = requestAnimationFrame(this.tickPreviews);
  };

  /** Toggle a shape in/out of the selection. "random" is exclusive; picking a
   *  shape drops "random"; deselecting the last shape falls back to "random". */
  private toggle(id: string): void {
    const cur = this.store.get().brushAssets;
    if (id === "random") {
      this.store.set({ brushAssets: ["random"] });
      return;
    }
    let next = cur.filter((x) => x !== "random");
    next = next.includes(id) ? next.filter((x) => x !== id) : [...next, id];
    if (next.length === 0) next = ["random"];
    this.store.set({ brushAssets: next });
  }

  private selectAll(): void {
    this.store.set({ brushAssets: this.library.ids() });
  }

  private assetButton(id: string, inner: string, _title: string, active: boolean, asset?: Asset): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "asset-btn" + (active ? " active" : "");
    // Only the "random" tile keeps a tooltip; shape tiles would just repeat their name.
    if (id === "random") btn.title = "Draw a random shape from the selected set";
    btn.innerHTML = inner;
    btn.addEventListener("click", () => this.toggle(id));
    if (asset?.anim?.length) {
      // Collect this preview's animated elements + their tracks for the loop.
      const tracks = new Map(asset.anim.map((t) => [t.index, t]));
      for (const el of Array.from(btn.querySelectorAll("[data-anim]"))) {
        const track = tracks.get(Number(el.getAttribute("data-anim")));
        if (track) this.animPreviews.push({ el, track });
      }
      const badge = document.createElement("span");
      badge.className = "anim-badge";
      badge.textContent = "A";
      badge.title = "Animated shape";
      btn.appendChild(badge);
    }
    if (asset?.user) {
      const del = document.createElement("span");
      del.className = "del-badge";
      del.textContent = "×";
      del.title = "Delete asset";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.removeAsset(asset.id);
      });
      btn.appendChild(del);
    }
    return btn;
  }

  private preview(asset: Asset): string {
    // No inline color → the SVG inherits the tile color (dark, or accent-ink when active).
    return `<svg viewBox="${asset.viewBox}">${asset.markup}</svg>`;
  }

  private removeAsset(id: string): void {
    this.library.remove(id);
    void deleteUserAsset(id);
    const next = this.store.get().brushAssets.filter((x) => x !== id);
    this.store.set({ brushAssets: next.length ? next : ["random"] });
    this.sig = "";
    this.render(this.store.get());
  }

  private wireUpload(): void {
    const input = this.root.querySelector('input[type="file"]') as HTMLInputElement;
    const zone = this.root.querySelector(".dropzone") as HTMLElement;
    input.addEventListener("change", () => this.ingest(input.files));
    ["dragover", "dragenter"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add("over");
      }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove("over");
      }),
    );
    zone.addEventListener("drop", (e) => this.ingest((e as DragEvent).dataTransfer?.files ?? null));
  }

  private async ingest(files: FileList | null): Promise<void> {
    if (!files || !files.length) return;
    let lastId: string | null = null;
    for (const file of Array.from(files)) {
      if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) continue;
      const asset = await importSvgFile(file);
      if (!asset) continue;
      this.library.add(asset);
      void saveUserAsset(asset);
      lastId = asset.id;
    }
    this.sig = "";
    if (lastId) this.store.set({ brushAssets: [lastId] });
    else this.render(this.store.get());
  }
}
