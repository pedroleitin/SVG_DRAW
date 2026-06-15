import type { Store } from "../store/store";
import type { Renderer } from "../render/renderer";
import type { Palette, SceneState } from "../scene/types";
import { paletteById } from "../features/palette";

/** Colors context panel: palette picker + swatch editor. */
export class ColorsPanel {
  private root: HTMLElement;
  private sig = "";

  constructor(host: HTMLElement, private store: Store, private renderer: Renderer) {
    this.root = host;
    this.root.innerHTML = `
      <h2>Colors</h2>
      <div class="palette-list"></div>
      <div class="swatches"></div>`;
    this.render(store.get());
    store.subscribe((s) => this.render(s));
  }

  private render(s: SceneState): void {
    const sig = [s.activePaletteId, s.activeColorIndex, JSON.stringify(s.palettes.map((p) => p.colors))].join("|");
    if (sig === this.sig) return;
    this.sig = sig;

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

    const swatches = this.root.querySelector(".swatches") as HTMLElement;
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

  private mutatePalette(active: Palette, colors: string[]): void {
    const palettes = this.store.get().palettes.map((p) => (p.id === active.id ? { ...p, colors } : p));
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
    if (this.store.get().activeColorIndex >= colors.length) {
      this.store.set({ activeColorIndex: colors.length - 1 });
    }
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
