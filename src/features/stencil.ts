import type { SceneState } from "../scene/types";
import { maskField, sampleMask } from "./noise";
import { hasStencilImage, sampleStencilLum, stencilImageAspect } from "./stencilImage";
import { hasStencilText, sampleTextLum, stencilTextAspect } from "./stencilText";
import { visibleCellRange } from "../scene/grid";

/** A stencil resolves to a per-cell predicate: is this cell inside the paintable
 *  opening? The brush, the live silhouette, and "Apply" all use this — so adding
 *  a new source only means adding a branch here + its panel controls. */
export type LitFn = (col: number, row: number) => boolean;

export interface CellBox {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** Aspect-fit (contain) a box of the given aspect into the visible cell range,
 *  centered. Used to place an image source — once at upload, or live when the
 *  stencil is locked to the view. */
export function fitBox(state: SceneState, aspect: number): CellBox {
  const r = visibleCellRange(state.camera, state.cellSize, 0);
  const cols = r.maxCol - r.minCol + 1;
  const rows = r.maxRow - r.minRow + 1;
  let bc = cols;
  let br = Math.max(1, Math.round(cols / aspect));
  if (br > rows) {
    br = rows;
    bc = Math.max(1, Math.round(rows * aspect));
  }
  return {
    col: r.minCol + Math.floor((cols - bc) / 2),
    row: r.minRow + Math.floor((rows - br) / 2),
    cols: bc,
    rows: br,
  };
}

/** A box `size` cells tall (width follows the aspect), centered in the view —
 *  for the text source, whose glyph height the user controls directly. */
export function textBox(state: SceneState, aspect: number, size: number): CellBox {
  const r = visibleCellRange(state.camera, state.cellSize, 0);
  const cols = r.maxCol - r.minCol + 1;
  const rows = r.maxRow - r.minRow + 1;
  const br = Math.max(1, Math.min(rows, Math.round(size)));
  const bc = Math.max(1, Math.min(cols, Math.round(br * aspect)));
  return {
    col: r.minCol + Math.floor((cols - bc) / 2),
    row: r.minRow + Math.floor((rows - br) / 2),
    cols: bc,
    rows: br,
  };
}

export function stencilLit(state: SceneState): LitFn {
  const st = state.stencil;
  // Locked → shift world cells by the view origin so the pattern stays fixed on
  // screen while you pan (rather than fixed to the canvas).
  let ox = 0;
  let oy = 0;
  if (st.lock) {
    const r = visibleCellRange(state.camera, state.cellSize, 0);
    ox = r.minCol;
    oy = r.minRow;
  }

  if (st.type === "stripes") {
    const { angle, period, ratio } = st.stripes;
    const p = Math.max(1, period);
    const rad = (angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    return (col, row) => {
      const t = (col - ox + 0.5) * dx + (row - oy + 0.5) * dy;
      const phase = ((t % p) + p) % p;
      return phase < p * ratio;
    };
  }

  if (st.type === "image") {
    if (!hasStencilImage()) return () => false;
    const { threshold, invert } = st.image;
    // Locked: the image follows the view (re-fit each render). Else: its stored
    // world box from upload.
    let box = st.image.box;
    if (st.lock) {
      const ar = stencilImageAspect();
      box = ar == null ? null : fitBox(state, ar);
    }
    if (!box) return () => false;
    const b = box;
    return (col, row) => {
      const lc = col - b.col;
      const lr = row - b.row;
      if (lc < 0 || lr < 0 || lc >= b.cols || lr >= b.rows) return false;
      const lum = sampleStencilLum((lc + 0.5) / b.cols, (lr + 0.5) / b.rows);
      return invert ? lum < threshold : lum >= threshold;
    };
  }

  if (st.type === "text") {
    if (!hasStencilText()) return () => false;
    let box = st.text.box;
    if (st.lock) {
      const ar = stencilTextAspect();
      box = ar == null ? null : textBox(state, ar, st.text.size);
    }
    if (!box) return () => false;
    const b = box;
    return (col, row) => {
      const lc = col - b.col;
      const lr = row - b.row;
      if (lc < 0 || lr < 0 || lc >= b.cols || lr >= b.rows) return false;
      return sampleTextLum((lc + 0.5) / b.cols, (lr + 0.5) / b.rows) >= 0.5;
    };
  }

  // Default: fractal noise (lit = field >= threshold).
  const field = maskField(state.mask.seed);
  return (col, row) => sampleMask(field, col - ox, row - oy, state.mask) >= state.mask.threshold;
}
