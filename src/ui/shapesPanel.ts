import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { Asset, SceneState } from "../scene/types";
import { importSvgFile } from "../features/svgImport";
import { saveUserAsset, deleteUserAsset } from "../store/persistence";

/** Shapes context panel: the SVG library (brush selection) + upload. */
export class ShapesPanel {
  private root: HTMLElement;
  private sig = "";

  constructor(host: HTMLElement, private store: Store, private library: Library) {
    this.root = host;
    this.root.innerHTML = `
      <h2>Shapes</h2>
      <div class="asset-grid"></div>
      <label class="dropzone">
        <input type="file" accept=".svg,image/svg+xml" multiple hidden />
        <span>⬆ Upload SVG <small>(or drop here)</small></span>
      </label>`;
    this.wireUpload();
    this.render(store.get());
    store.subscribe((s) => this.render(s));
  }

  private render(s: SceneState): void {
    const sig = [s.brushAsset, this.library.ids().join(",")].join("|");
    if (sig === this.sig) return;
    this.sig = sig;
    const grid = this.root.querySelector(".asset-grid") as HTMLElement;
    grid.innerHTML = "";
    grid.appendChild(this.assetButton("random", "🎲", "Random", s.brushAsset === "random"));
    for (const asset of this.library.all()) {
      grid.appendChild(
        this.assetButton(asset.id, this.preview(asset), asset.name, s.brushAsset === asset.id, asset),
      );
    }
  }

  private assetButton(id: string, inner: string, title: string, active: boolean, asset?: Asset): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "asset-btn" + (active ? " active" : "");
    btn.title = title;
    btn.innerHTML = inner;
    btn.addEventListener("click", () => this.store.set({ brushAsset: id }));
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
    return `<svg viewBox="${asset.viewBox}" style="color:var(--text)">${asset.markup}</svg>`;
  }

  private removeAsset(id: string): void {
    this.library.remove(id);
    void deleteUserAsset(id);
    if (this.store.get().brushAsset === id) this.store.set({ brushAsset: "random" });
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
    if (lastId) this.store.set({ brushAsset: lastId });
    else this.render(this.store.get());
  }
}
