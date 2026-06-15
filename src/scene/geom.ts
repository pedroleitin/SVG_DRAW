import type { Instance } from "./types";
import type { AnimOutput } from "../anim/animations";

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
  const size = cellSize * inst.scale * (anim.scaleMul ?? 1);
  const cx = (inst.col + 0.5 + inst.dx + (anim.dx ?? 0)) * cellSize;
  const cy = (inst.row + 0.5 + inst.dy + (anim.dy ?? 0)) * cellSize;
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
