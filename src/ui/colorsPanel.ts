import type { Store } from "../store/store";
import type { Renderer } from "../render/renderer";
import type { Palette, SceneState } from "../scene/types";
import { paletteById } from "../features/palette";
import { parseAse } from "../features/aseImport";

const DEFAULT_BG = "#f7f5ef";

/** Colors context panel: palette picker + swatch editor (left); canvas
 *  background + cell-background mode (right). */
export class ColorsPanel {
  private root: HTMLElement;
  private bgInput!: HTMLInputElement;
  private bgHex!: HTMLInputElement;
  private colorHex!: HTMLInputElement;
  private cellSegBtns!: HTMLButtonElement[];
  private paletteSig = "";
  private swatchSig = "";

  constructor(host: HTMLElement, private store: Store, private renderer: Renderer) {
    this.root = host;
    this.root.innerHTML = `
      <h2>Colors</h2>
      <div class="colors-cols">
        <div class="colors-left">
          <div class="pal-head">
            <h3 class="exp-sub">Palette</h3>
            <button id="ase-import" class="tool-btn ase-btn" title="Import an Adobe .ase swatch file (or drop one here)">Import .ase</button>
          </div>
          <div class="palette-list"></div>
          <div class="swatches"></div>
          <label class="hex-row"><span>Hex</span><input type="text" id="color-hex" class="hex-input" spellcheck="false" maxlength="7" /></label>
          <input type="file" id="ase-file" accept=".ase" hidden />
        </div>
        <div class="colors-right">
          <h3 class="exp-sub">Canvas background</h3>
          <div class="bg-row">
            <div class="swatch"><input type="color" id="bg-color" title="Canvas + export background" /></div>
            <input type="text" id="bg-hex" class="hex-input" spellcheck="false" maxlength="7" />
            <button id="bg-reset" class="tool-btn">Reset</button>
          </div>
          <h3 class="exp-sub">Cell background</h3>
          <div class="seg" id="cell-bg-seg">
            <button class="seg-btn seg-text" data-bg="none">None</button>
            <button class="seg-btn seg-text" data-bg="random">Random</button>
          </div>
        </div>
      </div>`;

    this.bgInput = this.root.querySelector("#bg-color") as HTMLInputElement;
    this.bgInput.addEventListener("input", () => this.store.set({ bgColor: this.bgInput.value }));
    this.root.querySelector("#bg-reset")!.addEventListener("click", () =>
      this.store.set({ bgColor: DEFAULT_BG }),
    );

    // Hex fields (type an exact color; the native picker lacks a hex field).
    this.bgHex = this.root.querySelector("#bg-hex") as HTMLInputElement;
    this.bgHex.addEventListener("change", () => {
      const hex = parseHex(this.bgHex.value);
      if (hex) this.store.set({ bgColor: hex });
      else this.bgHex.value = this.store.get().bgColor.toUpperCase();
    });
    this.colorHex = this.root.querySelector("#color-hex") as HTMLInputElement;
    this.colorHex.addEventListener("change", () => {
      const s = this.store.get();
      const active = paletteById(s.palettes, s.activePaletteId);
      const hex = parseHex(this.colorHex.value);
      if (hex) this.editColor(active.id, s.activeColorIndex, hex);
      else this.colorHex.value = toHex(active.colors[s.activeColorIndex] ?? "").toUpperCase();
    });

    // Cell background: None / Random (no per-color choice).
    this.cellSegBtns = [...this.root.querySelectorAll<HTMLButtonElement>("#cell-bg-seg .seg-btn")];
    for (const btn of this.cellSegBtns) {
      btn.addEventListener("click", () =>
        this.store.set({ activeBgIndex: btn.dataset.bg === "random" ? "random" : null }),
      );
    }

    // Import .ase swatch files — via the button or by dropping onto the panel.
    const aseFile = this.root.querySelector("#ase-file") as HTMLInputElement;
    this.root.querySelector("#ase-import")!.addEventListener("click", () => aseFile.click());
    aseFile.addEventListener("change", () => {
      if (aseFile.files?.[0]) this.importAse(aseFile.files[0]);
      aseFile.value = ""; // allow re-importing the same file
    });
    this.root.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.root.classList.add("drag-over");
    });
    this.root.addEventListener("dragleave", (e) => {
      if (e.target === this.root) this.root.classList.remove("drag-over");
    });
    this.root.addEventListener("drop", (e) => {
      e.preventDefault();
      this.root.classList.remove("drag-over");
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => /\.ase$/i.test(f.name));
      if (file) this.importAse(file);
    });

    this.render(store.get());
    store.subscribe((s) => this.render(s));
  }

  private render(s: SceneState): void {
    if (this.bgInput.value.toLowerCase() !== s.bgColor.toLowerCase()) this.bgInput.value = s.bgColor;
    const active = paletteById(s.palettes, s.activePaletteId);
    // Sync hex fields (skip the one being typed in).
    if (document.activeElement !== this.bgHex) this.bgHex.value = toHex(s.bgColor).toUpperCase();
    if (document.activeElement !== this.colorHex) {
      this.colorHex.value = toHex(active.colors[s.activeColorIndex] ?? active.colors[0] ?? "").toUpperCase();
    }

    // Palette previews — safe to rebuild (no color <input>s).
    const pSig = [s.activePaletteId, JSON.stringify(s.palettes.map((p) => p.colors))].join("|");
    if (pSig !== this.paletteSig) {
      this.paletteSig = pSig;
      this.buildPaletteList(s);
    }

    // Swatches hold native color pickers — only rebuild on add/remove/switch, so
    // selecting or editing a color never replaces the open picker (which made it
    // pop up at the window corner).
    const swSig = [s.activePaletteId, active.colors.length].join("|");
    if (swSig !== this.swatchSig) {
      this.swatchSig = swSig;
      this.buildSwatches(active);
    }

    // Active highlights + value sync (no rebuild — keeps the open picker anchored).
    this.root.querySelectorAll<HTMLElement>(".swatches .swatch").forEach((el, i) => {
      el.classList.toggle("active", i === s.activeColorIndex);
      const inp = el.querySelector("input") as HTMLInputElement | null;
      if (inp && inp !== document.activeElement) inp.value = toHex(active.colors[i] ?? "");
    });
    for (const btn of this.cellSegBtns) {
      const on = btn.dataset.bg === "random" ? s.activeBgIndex === "random" : s.activeBgIndex == null;
      btn.classList.toggle("active", on);
    }
  }

  private buildPaletteList(s: SceneState): void {
    const list = this.root.querySelector(".palette-list") as HTMLElement;
    list.innerHTML = "";
    for (const p of s.palettes) {
      const row = document.createElement("button");
      row.className = "palette-row" + (p.id === s.activePaletteId ? " active" : "");
      row.title = p.name;
      row.innerHTML = p.colors.map((c) => `<i style="background:${c}"></i>`).join("");
      row.addEventListener("click", () => this.store.set({ activePaletteId: p.id }));
      list.appendChild(row);
    }
  }

  private buildSwatches(active: Palette): void {
    const swatches = this.root.querySelector(".swatches") as HTMLElement;
    swatches.innerHTML = "";
    active.colors.forEach((color, i) => {
      const wrap = document.createElement("div");
      wrap.className = "swatch";
      const input = document.createElement("input");
      input.type = "color";
      input.value = toHex(color);
      input.title = `Color ${i} — click to use, edit to recolor`;
      input.addEventListener("input", () => this.editColor(active.id, i, input.value));
      input.addEventListener("click", () => this.store.set({ activeColorIndex: i }));
      wrap.appendChild(input);
      if (active.colors.length > 1) {
        const del = document.createElement("span");
        del.className = "del-badge";
        del.textContent = "×";
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          this.removeColor(active.id, i);
        });
        wrap.appendChild(del);
      }
      swatches.appendChild(wrap);
    });
    const add = document.createElement("button");
    add.className = "swatch-add";
    add.textContent = "+";
    add.title = "Add color";
    add.addEventListener("click", () => this.addColor(active.id));
    swatches.appendChild(add);
  }

  // Read the palette fresh from the store by id (never a captured snapshot): the
  // swatch handlers are built once and reused across edits, so a captured palette
  // would be stale and editing a 2nd color would revert the 1st.
  private mutatePalette(paletteId: string, colors: string[]): void {
    const palettes = this.store.get().palettes.map((p) => (p.id === paletteId ? { ...p, colors } : p));
    this.store.set({ palettes });
    this.renderer.invalidate();
  }

  private editColor(paletteId: string, i: number, value: string): void {
    const cur = paletteById(this.store.get().palettes, paletteId);
    const colors = cur.colors.slice();
    colors[i] = value;
    this.mutatePalette(paletteId, colors);
  }

  private addColor(paletteId: string): void {
    const cur = paletteById(this.store.get().palettes, paletteId);
    this.mutatePalette(paletteId, [...cur.colors, "#ffffff"]);
  }

  private removeColor(paletteId: string, i: number): void {
    const cur = paletteById(this.store.get().palettes, paletteId);
    const colors = cur.colors.slice();
    colors.splice(i, 1);
    if (this.store.get().activeColorIndex >= colors.length) {
      this.store.set({ activeColorIndex: colors.length - 1 });
    }
    this.mutatePalette(paletteId, colors);
  }

  /** Read an .ase file, add its colors as a new palette, and make it active. */
  private importAse(file: File): void {
    file.arrayBuffer().then((buf) => {
      const colors = parseAse(buf).map((c) => c.hex);
      if (!colors.length) return;
      const base = file.name.replace(/\.ase$/i, "").trim();
      const id = this.uniqueId(base);
      const palette: Palette = { id, name: base || "Imported", colors };
      this.store.set({
        palettes: [...this.store.get().palettes, palette],
        activePaletteId: id,
        activeColorIndex: 0,
      });
      this.renderer.invalidate();
    });
  }

  private uniqueId(base: string): string {
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ase";
    const taken = new Set(this.store.get().palettes.map((p) => p.id));
    let id = slug;
    for (let n = 2; taken.has(id); n++) id = `${slug}-${n}`;
    return id;
  }
}

/** Parse a typed hex (#rgb / #rrggbb, with or without #) → #rrggbb, or null. */
function parseHex(v: string): string | null {
  const h = v.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(h)) return "#" + h.toLowerCase();
  if (/^[0-9a-fA-F]{3}$/.test(h)) return "#" + [...h].map((c) => c + c).join("").toLowerCase();
  return null;
}

/** Normalize any CSS color string to #rrggbb for <input type=color>. */
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = color;
  return ctx.fillStyle as string;
}
