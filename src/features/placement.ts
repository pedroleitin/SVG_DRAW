import type { Instance, SceneState } from "../scene/types";
import type { Library } from "./library";
import { mulberry32, hash2, randInt, pick } from "../util/rng";
import { maskField, sampleMask } from "./noise";
import { visibleCellRange } from "../scene/grid";
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

  // Cell background: a fixed palette index, random across the palette, or none.
  let bgIndex: number | undefined;
  if (state.activeBgIndex === "random") {
    bgIndex = paletteLen > 1 ? randInt(rng, 0, paletteLen - 1) : 0;
  } else if (state.activeBgIndex != null) {
    bgIndex = state.activeBgIndex;
  }

  const seq = idCounter;
  return {
    id: nextId(),
    assetId,
    col,
    row,
    colorIndex,
    ...(bgIndex != null ? { bgIndex } : {}),
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

/** Bake the seamless tile: replicate the content inside the tile frame across
 *  the visible viewport so the pattern becomes real instances. Places copies
 *  where the tile has content and erases where it doesn't, so the result equals
 *  the tile repeated. Pure — caller wraps it in one undoable command. */
export function tileFill(state: SceneState): MaskResult {
  const cs = state.cellSize;
  const t = state.tileFrame;
  const c0 = Math.round(t.x / cs);
  const r0 = Math.round(t.y / cs);
  const cols = Math.max(1, Math.round(t.w / cs));
  const rows = Math.max(1, Math.round(t.h / cs));

  // Index the tile's content by local cell.
  const tile = new Map<string, Instance>();
  for (const inst of Object.values(state.instances)) {
    const lc = inst.col - c0;
    const lr = inst.row - r0;
    if (lc >= 0 && lc < cols && lr >= 0 && lr < rows) tile.set(`${lc},${lr}`, inst);
  }

  const range = visibleCellRange(state.camera, cs, 1);
  const places: Instance[] = [];
  const eraseKeys: string[] = [];
  for (let row = range.minRow; row <= range.maxRow; row++) {
    for (let col = range.minCol; col <= range.maxCol; col++) {
      const lc = (((col - c0) % cols) + cols) % cols;
      const lr = (((row - r0) % rows) + rows) % rows;
      const src = tile.get(`${lc},${lr}`);
      const key = cellKey(col, row);
      if (src) {
        if (src.col === col && src.row === row) continue; // original — keep as-is
        const seq = idCounter;
        places.push({ ...src, id: nextId(), col, row, seq });
      } else if (state.instances[key]) {
        eraseKeys.push(key);
      }
    }
  }
  return { places, eraseKeys };
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
