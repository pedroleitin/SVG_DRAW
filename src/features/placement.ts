import type { Instance, SceneState } from "../scene/types";
import type { Library } from "./library";
import { mulberry32, hash2, randInt, pick } from "../util/rng";
import { stencilLit } from "./stencil";
import { visibleCellRange } from "../scene/grid";
import { cellKey } from "../scene/types";

let idCounter = 0;
const nextId = () => `i${(idCounter++).toString(36)}`;

/** Pick one asset id from the selected shapes (a random one); "random" or an
 *  empty selection means any shape from the library. */
export function pickAsset(brushAssets: string[], library: Library, rng: () => number): string {
  const pool = brushAssets.filter((id) => id !== "random" && library.get(id));
  if (brushAssets.includes("random") || pool.length === 0) return pick(rng, library.ids());
  return pool.length === 1 ? pool[0] : pool[randInt(rng, 0, pool.length - 1)];
}

/** The pool the Shuffle idle draws from: the selected shapes, or every library
 *  asset when "random"/none is selected (mirrors pickAsset's pool). */
export function shufflePool(brushAssets: string[], library: Library): string[] {
  const pool = brushAssets.filter((id) => id !== "random" && library.get(id));
  return brushAssets.includes("random") || pool.length === 0 ? library.ids() : pool;
}

/** Shuffle idle: the asset shown at time `T`, picked from `pool` and changing
 *  over time — staggered per instance (by seed) so they don't all flip together.
 *  `amount` (0..1) sets the pace. Pure + deterministic, so live render and export
 *  agree. Returns `inst.assetId` when the pool can't vary. */
export function shuffledAssetId(inst: Instance, pool: string[], T: number, amount: number): string {
  if (pool.length < 2) return inst.assetId;
  const interval = 0.7 - 0.58 * Math.max(0, Math.min(1, amount)); // 0=calm, 1=frantic
  const phase = (inst.seed >>> 0) % 997; // per-cell offset so flips desync
  const step = Math.floor(T / interval) + phase;
  return pool[hash2(inst.col, inst.row, step) % pool.length];
}

/** Fraction of the cell an SVG fills (leaves a small gutter). */
export const FILL_SCALE = 0.85;

/** Build a single instance for a cell using the active brush + active color.
 *  Deterministic per cell (the seed drives "random" asset picks and future
 *  animation phase). The fill mask decides *which* cells exist, not how they
 *  look. */
export function buildInstance(
  state: SceneState,
  library: Library,
  col: number,
  row: number,
  cw = 1,
  ch = 1,
): Instance {
  const seed = hash2(col, row, state.mask.seed);
  const rng = mulberry32(seed);

  const assetId = pickAsset(state.brushAssets, library, rng);

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
    ...(cw > 1 ? { cw } : {}),
    ...(ch > 1 ? { ch } : {}),
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

/** Bake the seamless tile: stamp the tile's content across the viewport so the
 *  pattern becomes real instances. Block-aware — only blocks that fit ENTIRELY
 *  inside the tile are tiled (copies spaced one tile apart never overlap); a
 *  block crossing the tile boundary can't wrap as a single rect, so it's
 *  dropped. Pure — caller wraps it in one undoable command. */
export function tileFill(state: SceneState): MaskResult {
  const cs = state.cellSize;
  const t = state.tileFrame;
  const c0 = Math.round(t.x / cs);
  const r0 = Math.round(t.y / cs);
  const cols = Math.max(1, Math.round(t.w / cs));
  const rows = Math.max(1, Math.round(t.h / cs));

  // Blocks fully contained in the tile (origin + span inside [0,cols)×[0,rows)).
  const fitted: { inst: Instance; lc: number; lr: number; cw: number; ch: number }[] = [];
  for (const inst of Object.values(state.instances)) {
    const lc = inst.col - c0;
    const lr = inst.row - r0;
    const cw = inst.cw ?? 1;
    const ch = inst.ch ?? 1;
    if (lc >= 0 && lr >= 0 && lc + cw <= cols && lr + ch <= rows) {
      fitted.push({ inst, lc, lr, cw, ch });
    }
  }

  const range = visibleCellRange(state.camera, cs, 1);
  const places: Instance[] = [];
  const placeKeys = new Set<string>();

  // Stamp the tile at every period that overlaps the viewport.
  const kMin = Math.floor((range.minCol - c0) / cols) - 1;
  const kMax = Math.floor((range.maxCol - c0) / cols) + 1;
  const mMin = Math.floor((range.minRow - r0) / rows) - 1;
  const mMax = Math.floor((range.maxRow - r0) / rows) + 1;
  for (let m = mMin; m <= mMax; m++) {
    for (let k = kMin; k <= kMax; k++) {
      for (const { inst, lc, lr, cw, ch } of fitted) {
        const col = c0 + lc + k * cols;
        const row = r0 + lr + m * rows;
        // Cull copies that don't touch the viewport.
        if (col + cw <= range.minCol || col > range.maxCol || row + ch <= range.minRow || row > range.maxRow) {
          continue;
        }
        placeKeys.add(cellKey(col, row));
        if (col === inst.col && row === inst.row) continue; // original — keep as-is
        const seq = idCounter;
        places.push({ ...inst, id: nextId(), col, row, seq });
      }
    }
  }

  // Erase everything overlapping the viewport that isn't a kept original or a
  // fresh copy — including blocks that crossed the tile boundary.
  const eraseKeys: string[] = [];
  for (const key in state.instances) {
    const inst = state.instances[key];
    const cw = inst.cw ?? 1;
    const ch = inst.ch ?? 1;
    if (
      inst.col + cw > range.minCol &&
      inst.col <= range.maxCol &&
      inst.row + ch > range.minRow &&
      inst.row <= range.maxRow &&
      !placeKeys.has(key)
    ) {
      eraseKeys.push(key);
    }
  }
  return { places, eraseKeys };
}

/** Apply the active stencil over a cell region. Default (replace): CLEARS the
 *  region and paints only the opening — lit cells get a fresh SVG, the rest end
 *  up empty. Add mode: only fills the opening's empty cells, keeping everything
 *  else. Pure — caller wraps the result in one command. */
export function applyMask(
  state: SceneState,
  library: Library,
  minCol: number,
  minRow: number,
  maxCol: number,
  maxRow: number,
): MaskResult {
  const lit = stencilLit(state);
  const add = state.stencil.add;
  const places: Instance[] = [];
  const eraseKeys: string[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const key = cellKey(col, row);
      if (state.blocked[key]) continue; // never touch blocked cells
      const occupied = !!state.instances[key];
      if (lit(col, row)) {
        if (!add || !occupied) places.push(buildInstance(state, library, col, row)); // (re)paint
      } else if (occupied && !add) {
        eraseKeys.push(key); // replace mode: clear outside the opening
      }
    }
  }
  return { places, eraseKeys };
}
