import type { Store } from "../store/store";
import type { Library } from "../features/library";
import type { Renderer } from "../render/renderer";
import type { Asset, Palette, SceneState } from "../scene/types";
import { paletteById } from "../features/palette";
import { importSvgFile } from "../features/svgImport";
import { saveUserAsset, deleteUserAsset } from "../store/persistence";

/** Right-hand drawer: SVG library (with brush selection + upload) and the
 *  palette editor. Rebuilds only when the slices it shows actually change. */
export class Sidebar {
  private root: HTMLElement;
  private libEl: HTMLElement;
  private palEl: HTMLElement;
  private sig = "";

  constructor(
    host: HTMLElement,
    private store: Store,
    private library: Library,
    private renderer: Renderer,
  ) {
    this.root = host;
    this.root.innerHTML = `
      <section class="panel" id="library-panel">
        <h2>Library</h2>
        <div class="asset-grid"></div>
        <label class="dropzone">
          <input type="file" accept=".svg,image/svg+xml" multiple hidden />
          <span>⬆ Upload SVG <small>(or drop here)</small></span>
        </label>
      </section>
      <section class="panel" id="palette-panel">
        <h2>Palette</h2>
        <div class="palette-list"></div>
        <div class="swatches"></div>
      </section>`;
    this.libEl = this.root.querySelector("#library-panel")!;
    this.palEl = this.root.querySelector("#palette-panel")!;
    this.wireUpload();
    this.render(store.get());
    store.subscribe((s) => this.render(s));
  }

  /** Rebuild only when brush / palette / library state changed. */
  private render(s: SceneState): void {
    const sig = [
      s.brushAsset,
      s.activePaletteId,
      s.activeColorIndex,
      this.library.ids().join(","),
      JSON.stringify(s.palettes.map((p) => p.colors)),
    ].join("|");
    if (sig === this.sig) return;
    this.sig = sig;
    this.renderLibrary(s);
    this.renderPalette(s);
  }

  // ---- Library ----
  private renderLibrary(s: SceneState): void {
    const grid = this.libEl.querySelector(".asset-grid") as HTMLElement;
    grid.innerHTML = "";
    grid.appendChild(this.assetButton("random", "🎲", "Random", s.brushAsset === "random"));
    for (const asset of this.library.all()) {
      grid.appendChild(
        this.assetButton(asset.id, this.preview(asset), asset.name, s.brushAsset === asset.id, asset),
      );
    }
  }

  private assetButton(
    id: string,
    inner: string,
    title: string,
    active: boolean,
    asset?: Asset,
  ): HTMLElement {
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
    this.sig = ""; // force rebuild
    this.render(this.store.get());
  }

  private wireUpload(): void {
    const input = this.libEl.querySelector('input[type="file"]') as HTMLInputElement;
    const zone = this.libEl.querySelector(".dropzone") as HTMLElement;
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

  // ---- Palette ----
  private renderPalette(s: SceneState): void {
    const list = this.palEl.querySelector(".palette-list") as HTMLElement;
    list.innerHTML = "";
    for (const p of s.palettes) {
      const row = document.createElement("button");
      row.className = "palette-row" + (p.id === s.activePaletteId ? " active" : "");
      row.title = p.name;
      row.innerHTML = p.colors
        .map((c) => `<i style="background:${c}"></i>`)
        .join("");
      row.addEventListener("click", () => this.store.set({ activePaletteId: p.id }));
      list.appendChild(row);
    }

    const swatches = this.palEl.querySelector(".swatches") as HTMLElement;
    swatches.innerHTML = "";
    const active = paletteById(s.palettes, s.activePaletteId);
    active.colors.forEach((color, i) => {
      const wrap = document.createElement("div");
      wrap.className = "swatch" + (i === s.activeColorIndex ? " active" : "");
      const input = document.createElement("input");
      input.type = "color";
      input.value = toHex(color);
      input.title = `Color ${i} — click to use, edit to recolor`;
      input.addEventListener("input", () => this.editColor(active, i, input.value));
      input.addEventListener("click", () => this.store.set({ activeColorIndex: i }));
      wrap.appendChild(input);
      if (active.colors.length > 1) {
        const del = document.createElement("span");
        del.className = "swatch-del";
        del.textContent = "×";
        del.addEventListener("click", () => this.removeColor(active, i));
        wrap.appendChild(del);
      }
      swatches.appendChild(wrap);
    });
    const add = document.createElement("button");
    add.className = "swatch-add";
    add.textContent = "+";
    add.title = "Add color";
    add.addEventListener("click", () => this.addColor(active));
    swatches.appendChild(add);
  }

  /** Palette edits mutate the active palette immutably and keep ids stable so
   *  recoloring is instant (instances reference colorIndex, not literals). */
  private mutatePalette(active: Palette, colors: string[]): void {
    const palettes = this.store.get().palettes.map((p) =>
      p.id === active.id ? { ...p, colors } : p,
    );
    this.store.set({ palettes });
    this.renderer.invalidate();
  }

  private editColor(active: Palette, i: number, value: string): void {
    const colors = active.colors.slice();
    colors[i] = value;
    this.mutatePalette(active, colors);
  }

  private addColor(active: Palette): void {
    this.mutatePalette(active, [...active.colors, "#ffffff"]);
  }

  private removeColor(active: Palette, i: number): void {
    const colors = active.colors.slice();
    colors.splice(i, 1);
    const idx = this.store.get().activeColorIndex;
    if (idx >= colors.length) this.store.set({ activeColorIndex: colors.length - 1 });
    this.mutatePalette(active, colors);
  }
}

/** Normalize any CSS color string to #rrggbb for <input type=color>. */
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = color;
  return ctx.fillStyle as string;
}
