import type { Asset } from "../scene/types";

/** Built-in starter library. Each asset's markup uses currentColor so the
 *  palette system recolors it by setting `color` on the <use> element.
 *  All authored on a 0 0 100 100 viewBox, centered, ~80px footprint. */

export const STARTER_ASSETS: Asset[] = [
  {
    id: "circle",
    name: "Circle",
    viewBox: "0 0 100 100",
    markup: `<circle cx="50" cy="50" r="40" fill="currentColor"/>`,
  },
  {
    id: "ring",
    name: "Ring",
    viewBox: "0 0 100 100",
    markup: `<circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="12"/>`,
  },
  {
    id: "square",
    name: "Square",
    viewBox: "0 0 100 100",
    markup: `<rect x="14" y="14" width="72" height="72" rx="6" fill="currentColor"/>`,
  },
  {
    id: "triangle",
    name: "Triangle",
    viewBox: "0 0 100 100",
    markup: `<path d="M50 12 L88 84 L12 84 Z" fill="currentColor"/>`,
  },
  {
    id: "diamond",
    name: "Diamond",
    viewBox: "0 0 100 100",
    markup: `<path d="M50 10 L90 50 L50 90 L10 50 Z" fill="currentColor"/>`,
  },
  {
    id: "plus",
    name: "Plus",
    viewBox: "0 0 100 100",
    markup: `<path d="M40 12 H60 V40 H88 V60 H60 V88 H40 V60 H12 V40 H40 Z" fill="currentColor"/>`,
  },
  {
    id: "quarter",
    name: "Quarter",
    viewBox: "0 0 100 100",
    markup: `<path d="M14 86 A72 72 0 0 1 86 14 L86 86 Z" fill="currentColor"/>`,
  },
  {
    id: "slash",
    name: "Slash",
    viewBox: "0 0 100 100",
    markup: `<path d="M16 84 L84 16" stroke="currentColor" stroke-width="16" stroke-linecap="round"/>`,
  },
  {
    id: "dot-grid",
    name: "Dots",
    viewBox: "0 0 100 100",
    markup: `<g fill="currentColor"><circle cx="32" cy="32" r="10"/><circle cx="68" cy="32" r="10"/><circle cx="32" cy="68" r="10"/><circle cx="68" cy="68" r="10"/></g>`,
  },
  {
    id: "star",
    name: "Star",
    viewBox: "0 0 100 100",
    markup: `<path d="M50 10 L61 38 L91 39 L67 58 L76 88 L50 70 L24 88 L33 58 L9 39 L39 38 Z" fill="currentColor"/>`,
  },
];

/** Live registry (starter + uploaded). */
export class Library {
  private map = new Map<string, Asset>();

  constructor(assets: Asset[] = STARTER_ASSETS) {
    for (const a of assets) this.map.set(a.id, a);
  }

  all(): Asset[] {
    return [...this.map.values()];
  }
  get(id: string): Asset | undefined {
    return this.map.get(id);
  }
  add(asset: Asset): void {
    this.map.set(asset.id, asset);
  }
  remove(id: string): boolean {
    return this.map.delete(id);
  }
  ids(): string[] {
    return [...this.map.keys()];
  }
}
