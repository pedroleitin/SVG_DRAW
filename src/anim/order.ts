import type { SceneState, Instance, Point } from "../scene/types";
import { directionPhase } from "./animations";
import { halftoneLastBox, sampleHalftoneLum, hasHalftoneImage } from "../features/halftone";

/** Builds a function instance → order∈[0,1] for the active OrderMode.
 *  Memoized on (instances ref, order, direction, path) so during playback —
 *  when the scene doesn't change — it's computed once, not per frame. */
let cache: {
  ref: unknown;
  order: string;
  dir: string;
  pathRef: unknown;
  fn: (inst: Instance) => number;
} | null = null;

export function buildOrderField(state: SceneState): (inst: Instance) => number {
  const a = state.animation;
  const ref = state.instances;
  const pathRef = state.orderPath;
  if (
    cache &&
    cache.ref === ref &&
    cache.order === a.order &&
    cache.dir === a.direction &&
    cache.pathRef === pathRef
  ) {
    return cache.fn;
  }

  const insts = Object.values(ref);
  const cellSize = state.cellSize;

  // Centroid (for radial ordering).
  let cx = 0;
  let cy = 0;
  if (a.order === "radial" && insts.length) {
    for (const i of insts) {
      cx += i.col;
      cy += i.row;
    }
    cx /= insts.length;
    cy /= insts.length;
  }

  // Precompute the polyline's cumulative arc-lengths (for "free" order).
  const path = state.orderPath;
  const usePath = a.order === "free" && path.length >= 2;
  const cum = usePath ? cumulativeLengths(path) : null;

  const raw = (inst: Instance): number => {
    switch (a.order) {
      case "random":
        return frac(inst.seed);
      case "sequential":
        return inst.seq;
      case "free":
        // Project the cell center onto the drawn path -> arc-length param.
        // No path yet -> fall back to placement order.
        if (!usePath || !cum) return inst.seq;
        return projectParam(
          path,
          cum,
          (inst.col + 0.5) * cellSize,
          (inst.row + 0.5) * cellSize,
        );
      case "radial":
        return Math.hypot(inst.col - cx, inst.row - cy);
      case "halftone": {
        // Reveal by the halftone source's luminance at each cell — dark (ink)
        // first. Falls back to placement order without a source.
        const box = halftoneLastBox();
        if (!box || !hasHalftoneImage()) return inst.seq;
        const u = (inst.col - box.col + 0.5) / box.cols;
        const v = (inst.row - box.row + 0.5) / box.rows;
        return sampleHalftoneLum(u, v);
      }
      case "linear":
      default:
        return directionPhase(inst.col, inst.row, a.direction);
    }
  };

  // Normalize raw values to [0,1] across the whole scene.
  let min = Infinity;
  let max = -Infinity;
  for (const i of insts) {
    const r = raw(i);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  const span = max - min || 1;
  const fn = (inst: Instance) => (raw(inst) - min) / span;

  cache = { ref, order: a.order, dir: a.direction, pathRef, fn };
  return fn;
}

/** Deterministic [0,1) from an instance seed. */
const frac = (n: number): number => ((n >>> 0) % 100000) / 100000;

/** Cumulative arc-length at each path vertex; last entry = total length. */
function cumulativeLengths(path: Point[]): number[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    cum.push(cum[i - 1] + d);
  }
  return cum;
}

/** Nearest point on the polyline to (x,y), returned as its arc-length fraction
 *  along the whole path (0 = START, 1 = FINISH). */
function projectParam(path: Point[], cum: number[], x: number, y: number): number {
  const total = cum[cum.length - 1] || 1;
  let best = Infinity;
  let bestLen = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const segLen2 = vx * vx + vy * vy || 1e-9;
    // projection factor of point onto segment, clamped to [0,1]
    let t = ((x - a.x) * vx + (y - a.y) * vy) / segLen2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + t * vx;
    const py = a.y + t * vy;
    const d2 = (x - px) * (x - px) + (y - py) * (y - py);
    if (d2 < best) {
      best = d2;
      bestLen = cum[i - 1] + t * Math.sqrt(segLen2);
    }
  }
  return bestLen / total;
}
