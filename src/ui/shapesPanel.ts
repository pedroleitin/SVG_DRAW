import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { Asset, SceneState } from "../scene/types";
import { importSvgFile } from "../features/svgImport";
import { saveUserAsset, deleteUserAsset } from "../store/persistence";

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

  constructor(host: HTMLElement, private store: Store, private library: Library) {
    this.root = host;
    this.root.innerHTML = `
      <div class="shapes-head">
        <h2>Shapes</h2>
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
    this.wireUpload();
    this.render(store.get());
    store.subscribe((s) => this.render(s));
  }

  private render(s: SceneState): void {
    const sig = [s.brushAssets.join(","), this.library.ids().join(",")].join("|");
    if (sig === this.sig) return;
    this.sig = sig;
    const sel = new Set(s.brushAssets);
    const grid = this.root.querySelector(".asset-list") as HTMLElement;
    grid.innerHTML = "";
    grid.appendChild(this.assetButton("random", DICE_ICON, "Random", sel.has("random")));
    for (const asset of this.library.all()) {
      grid.appendChild(
        this.assetButton(asset.id, this.preview(asset), asset.name, sel.has(asset.id), asset),
      );
    }
  }

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

  private assetButton(id: string, inner: string, title: string, active: boolean, asset?: Asset): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "asset-btn" + (active ? " active" : "");
    btn.title = title;
    btn.innerHTML = inner;
    btn.addEventListener("click", () => this.toggle(id));
    if (asset?.user) {
      const del = document.createElement("span");
      del.className = "asset-del";
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
