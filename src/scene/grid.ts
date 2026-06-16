import type { Camera, BrushShape } from "./types";

/** Pure grid <-> world coordinate helpers. The grid is virtual (math only),
 *  never one DOM node per cell. */

export interface Cell {
  col: number;
  row: number;
}

export const worldToCell = (x: number, y: number, cellSize: number): Cell => ({
  col: Math.floor(x / cellSize),
  row: Math.floor(y / cellSize),
});

export const cellOrigin = (col: number, row: number, cellSize: number) => ({
  x: col * cellSize,
  y: row * cellSize,
});

export const cellCenter = (col: number, row: number, cellSize: number) => ({
  x: (col + 0.5) * cellSize,
  y: (row + 0.5) * cellSize,
});

/** Cells covered by a brush stroke centered on the cursor at fractional cell
 *  coords (cx,cy). The footprint stays centered on the pointer: odd sizes
 *  center on the cell under it, even sizes on the nearest grid corner.
 *  Square fills the whole N×N block; circle keeps the inscribed disc (size 3 is
 *  a 5-cell cross, size 4 a rounded disc). */
export function brushCells(cx: number, cy: number, size: number, shape: BrushShape): Cell[] {
  if (size <= 1) return [{ col: Math.floor(cx), row: Math.floor(cy) }];
  const startC = size % 2 ? Math.floor(cx) - (size - 1) / 2 : Math.round(cx) - size / 2;
  const startR = size % 2 ? Math.floor(cy) - (size - 1) / 2 : Math.round(cy) - size / 2;
  const center = (size - 1) / 2;
  const r2 = (size / 2) ** 2;
  const cells: Cell[] = [];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (shape === "circle") {
        const dx = i - center;
        const dy = j - center;
        // size 3 → 5-cell cross (orthogonal only); otherwise an inscribed disc.
        if (size === 3 ? Math.abs(dx) + Math.abs(dy) > 1 : dx * dx + dy * dy > r2) continue;
      }
      cells.push({ col: startC + i, row: startR + j });
    }
  }
  return cells;
}

/** Range of cells intersecting the camera viewport (+margin cells). */
export function visibleCellRange(cam: Camera, cellSize: number, margin = 1) {
  return {
    minCol: Math.floor(cam.x / cellSize) - margin,
    minRow: Math.floor(cam.y / cellSize) - margin,
    maxCol: Math.ceil((cam.x + cam.w) / cellSize) + margin,
    maxRow: Math.ceil((cam.y + cam.h) / cellSize) + margin,
  };
}
