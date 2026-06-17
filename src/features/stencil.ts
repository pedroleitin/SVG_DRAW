import type { SceneState } from "../scene/types";
import { maskField, sampleMask } from "./noise";

/** A stencil resolves to a per-cell predicate: is this cell inside the paintable
 *  opening? The brush, the live silhouette, and "Apply" all use this — so adding
 *  a new source only means adding a branch here + its panel controls. */
export type LitFn = (col: number, row: number) => boolean;

export function stencilLit(state: SceneState): LitFn {
  const st = state.stencil;

  if (st.type === "stripes") {
    const { angle, period, ratio } = st.stripes;
    const p = Math.max(1, period);
    const rad = (angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    return (col, row) => {
      // Project the cell center onto the stripe normal, wrap by the period.
      const t = (col + 0.5) * dx + (row + 0.5) * dy;
      const phase = ((t % p) + p) % p;
      return phase < p * ratio;
    };
  }

  // Default: fractal noise (lit = field >= threshold).
  const field = maskField(state.mask.seed);
  return (col, row) => sampleMask(field, col, row, state.mask) >= state.mask.threshold;
}
