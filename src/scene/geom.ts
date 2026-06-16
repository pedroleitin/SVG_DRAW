import type { Instance } from "./types";
import type { AnimOutput } from "../anim/animations";

/** Cell-background appearance constants. */
export const CELL_RADIUS = 10; // world px when "rounded" is on
export const CELL_GUTTER = 4; // world px gap between cells when "gutter" is on

/** World-space box for a cell-background square, honoring rounded / gutter.
 *  Shared by the renderer and the exporter so they stay pixel-identical. */
export function cellBgRect(
  col: number,
  row: number,
  cellSize: number,
  rounded: boolean,
  gutter: boolean,
  cw = 1,
  ch = 1,
) {
  const inset = gutter ? CELL_GUTTER / 2 : 0;
  return {
    x: col * cellSize + inset,
    y: row * cellSize + inset,
    w: cw * cellSize - inset * 2,
    h: ch * cellSize - inset * 2,
    rx: rounded ? CELL_RADIUS : 0,
  };
}

/** Final on-canvas box for an instance, combining its baked transform with the
 *  current animation output. Shared by the renderer and the exporter so live
 *  view and exported frames stay pixel-identical. */
export interface Box {
  x: number;
  y: number;
  size: number;
  cx: number;
  cy: number;
  rot: number;
  opacity: number;
}

export function instanceGeom(inst: Instance, cellSize: number, anim: AnimOutput): Box {
  const cw = inst.cw ?? 1;
  const ch = inst.ch ?? 1;
  // Square artwork, sized to the block's shorter side, centered in the block.
  const size = cellSize * Math.min(cw, ch) * inst.scale * (anim.scaleMul ?? 1);
  const cx = (inst.col + cw / 2 + inst.dx + (anim.dx ?? 0)) * cellSize;
  const cy = (inst.row + ch / 2 + inst.dy + (anim.dy ?? 0)) * cellSize;
  return {
    x: cx - size / 2,
    y: cy - size / 2,
    size,
    cx,
    cy,
    rot: inst.rotation + (anim.rotate ?? 0),
    opacity: anim.opacity ?? 1,
  };
}
