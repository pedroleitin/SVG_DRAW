import type { Palette } from "../scene/types";

/** Curated starter palettes. Instances store a colorIndex, not a literal
 *  color, so switching the active palette recolors the whole scene. */
export const STARTER_PALETTES: Palette[] = [
  {
    id: "bauhaus",
    name: "Bauhaus",
    colors: ["#e63946", "#f1c40f", "#1d3557", "#457b9d", "#bfab99"],
  },
  {
    id: "sunset",
    name: "Sunset",
    colors: ["#ff6b6b", "#ffa94d", "#ffd43b", "#ff8787", "#fff3bf"],
  },
  {
    id: "forest",
    name: "Forest",
    colors: ["#2b9348", "#55a630", "#80b918", "#aacc00", "#d4d700"],
  },
  {
    id: "mono",
    name: "Mono",
    colors: ["#111111", "#444444", "#777777", "#aaaaaa", "#dddddd"],
  },
  {
    id: "candy",
    name: "Candy",
    colors: ["#f72585", "#b5179e", "#7209b7", "#4361ee", "#4cc9f0"],
  },
];

export function paletteById(palettes: Palette[], id: string): Palette {
  return palettes.find((p) => p.id === id) ?? palettes[0];
}

export function colorAt(palette: Palette, index: number): string {
  if (index < 0) return "transparent"; // "none" sentinel (Edit → Recolor)
  return palette.colors[index % palette.colors.length];
}
