import type { Instance, SceneState } from "../scene/types";
import type { Library } from "./library";
import { mulberry32, hash2, randInt, pick } from "../util/rng";
import { maskField, sampleMask } from "./noise";
import { cellKey } from "../scene/types";

let idCounter = 0;
const nextId = () => `i${(idCounter++).toString(36)}`;

/** Fraction of the cell an SVG fills (leaves a small gutter). */
const FILL_SCALE = 0.85;

/** Build a single instance for a cell using the active brush + active color.
 *  Deterministic per cell (the seed drives "random" asset picks and future
 *  animation phase). The fill mask decides *which* cells exist, not how they
 *  look. */
export function buildInstance(
  state: SceneState,
  library: Library,
  col: number,
  row: number,
): Instance {
  const seed = hash2(col, row, state.mask.seed);
  const rng = mulberry32(seed);

  const assetId =
    state.brushAsset === "random" ? pick(rng, library.ids()) : state.brushAsset;

  // Spread colors across the active palette, deterministically per cell.
  const palette = state.palettes.find((p) => p.id === state.activePaletteId);
  const paletteLen = palette ? palette.colors.length : 1;
  const colorIndex = paletteLen > 1 ? randInt(rng, 0, paletteLen - 1) : 0;

  const seq = idCounter;
  return {
    id: nextId(),
    assetId,
    col,
    row,
    colorIndex,
    rotation: 0,
    scale: FILL_SCALE,
    dx: 0,
    dy: 0,
    seed,
    seq,
  };
}

export interface MaskResult {
  /** New instances for white cells that were empty. */
  places: Instance[];
  /** Cell keys for black cells that currently hold an instance. */
  eraseKeys: string[];
}

/** Apply the fractal mask over a cell region: white (>= threshold) fills empty
 *  cells, black (< threshold) erases occupied ones. Pure — caller wraps the
 *  result in one undoable command. */
export function applyMask(
  state: SceneState,
  library: Library,
  minCol: number,
  minRow: number,
  maxCol: number,
  maxRow: number,
): MaskResult {
  const field = maskField(state.mask.seed);
  const places: Instance[] = [];
  const eraseKeys: string[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const key = cellKey(col, row);
      const occupied = !!state.instances[key];
      const lit = sampleMask(field, col, row, state.mask) >= state.mask.threshold;
      if (lit && !occupied) places.push(buildInstance(state, library, col, row));
      else if (!lit && occupied) eraseKeys.push(key);
    }
  }
  return { places, eraseKeys };
}
