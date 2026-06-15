import type { Camera } from "./types";

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

/** Range of cells intersecting the camera viewport (+margin cells). */
export function visibleCellRange(cam: Camera, cellSize: number, margin = 1) {
  return {
    minCol: Math.floor(cam.x / cellSize) - margin,
    minRow: Math.floor(cam.y / cellSize) - margin,
    maxCol: Math.ceil((cam.x + cam.w) / cellSize) + margin,
    maxRow: Math.ceil((cam.y + cam.h) / cellSize) + margin,
  };
}
