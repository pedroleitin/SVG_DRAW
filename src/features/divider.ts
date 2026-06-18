import { Simplex } from "./noise";
import { visibleCellRange } from "../scene/grid";
import type { SceneState } from "../scene/types";

/** A square block of cells (origin + span; cw === ch). */
export interface Block {
  col: number;
  row: number;
  cw: number;
  ch: number;
}

/** Cell region the Divider works on: the visible range, capped to 80×80. */
export function dividerRegion(s: SceneState) {
  const r = visibleCellRange(s.camera, s.cellSize, 0);
  return {
    minCol: r.minCol,
    minRow: r.minRow,
    cols: Math.min(80, r.maxCol - r.minCol + 1),
    rows: Math.min(80, r.maxRow - r.minRow + 1),
  };
}

/** Blocks for the current view (single source of truth for preview / apply /
 *  brush, so they always agree). */
export function dividerBlocks(s: SceneState): Block[] {
  const { minCol, minRow, cols, rows } = dividerRegion(s);
  return subdivide(minCol, minRow, cols, rows, s.divider.density, s.divider.seed, s.blocked);
}

/** The block covering cell (col,row), or null. */
export function blockAt(blocks: Block[], col: number, row: number): Block | null {
  for (const b of blocks) {
    if (col >= b.col && col < b.col + b.cw && row >= b.row && row < b.row + b.ch) return b;
  }
  return null;
}

/** Subdivide a cell region into varied-size SQUARE blocks. A noise field gives
 *  a target size per cell (so similar sizes cluster), then a greedy pass packs
 *  squares without overlap. `density` ≈ how many divisions: higher = smaller
 *  squares. Deterministic by `seed`. */
export function subdivide(
  minCol: number,
  minRow: number,
  cols: number,
  rows: number,
  density: number,
  seed: number,
  blocked?: Record<string, true>,
): Block[] {
  const field = new Simplex(seed || 1);
  const maxSize = Math.max(1, Math.round(10 - density)); // density 2→8 … 8→2
  const freq = 1 / 7; // size-region scale
  const covered = new Uint8Array(cols * rows);
  const idx = (c: number, r: number) => (r - minRow) * cols + (c - minCol);
  // Treat blocked cells as already covered so the packing flows around them
  // (no block ever includes a blocked cell). The Divider then leaves Blocks free.
  if (blocked) {
    for (let r = minRow; r < minRow + rows; r++) {
      for (let c = minCol; c < minCol + cols; c++) {
        if (blocked[`${c},${r}`]) covered[idx(c, r)] = 1;
      }
    }
  }
  const blocks: Block[] = [];

  for (let r = minRow; r < minRow + rows; r++) {
    for (let c = minCol; c < minCol + cols; c++) {
      if (covered[idx(c, r)]) continue;
      // Target square size from the noise field, clamped to the region.
      let s = Math.max(1, Math.round(field.norm(c * freq, r * freq) * maxSize));
      s = Math.min(s, minCol + cols - c, minRow + rows - r);
      // Shrink until the s×s square is entirely free.
      while (s > 1) {
        let free = true;
        for (let y = r; y < r + s && free; y++) {
          for (let x = c; x < c + s; x++) if (covered[idx(x, y)]) { free = false; break; }
        }
        if (free) break;
        s--;
      }
      for (let y = r; y < r + s; y++) for (let x = c; x < c + s; x++) covered[idx(x, y)] = 1;
      blocks.push({ col: c, row: r, cw: s, ch: s });
    }
  }
  return blocks;
}
