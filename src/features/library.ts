import type { Asset } from "../scene/types";
import { parseSvg } from "./svgImport";

/** Built-in starter library, loaded from /assets/*.svg at build time. parseSvg
 *  normalizes fills/strokes to currentColor so the palette recolors each shape
 *  by setting `color` on the <use> element. */
const files = import.meta.glob("../../assets/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export const STARTER_ASSETS: Asset[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([path, raw]) => {
    const name = path.split("/").pop()!.replace(/\.svg$/i, "");
    const asset = parseSvg(raw, name);
    return asset ? [{ ...asset, id: name, name, user: false }] : [];
  });

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
