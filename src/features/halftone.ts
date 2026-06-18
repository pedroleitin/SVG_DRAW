import type { Instance, SceneState, HalftoneMode } from "../scene/types";
import type { Library } from "./library";
import type { MaskResult } from "./placement";
import { buildInstance, FILL_SCALE } from "./placement";
import { fitBox } from "./stencil";
import { cellKey } from "../scene/types";

/** Renders an uploaded image as a grid of the selected SVG shapes — halftone
 *  (dot size follows darkness) or ordered/error-diffusion dithering (on/off).
 *  Pixels live here (not in serializable state); the placement box is in
 *  `state.halftone`. */

export type { HalftoneMode };

interface Sampled {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}
let img: Sampled | null = null;
let imgVersion = 0;

export function hasHalftoneImage(): boolean {
  return !!img;
}

/** Bumped whenever a new image is loaded — lets the live preview cache know the
 *  pixels changed even though they don't live in the serializable state. */
export function halftoneImageVersion(): number {
  return imgVersion;
}

export function halftoneAspect(): number | null {
  return img ? img.w / img.h : null;
}

/** Decode + downscale a file (max 320px side) for luminance sampling. */
export async function setHalftoneImage(file: File): Promise<{ w: number; h: number } | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return null;
  }
  const max = 320;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close?.();
    return null;
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  img = { data: ctx.getImageData(0, 0, w, h).data, w, h };
  imgVersion++;
  const dims = { w: bmp.width, h: bmp.height };
  bmp.close?.();
  return dims;
}

/** Luminance (0..1) at normalized image coords (nearest sample). */
export function sampleHalftoneLum(u: number, v: number): number {
  if (!img) return 0;
  const x = Math.min(img.w - 1, Math.max(0, Math.floor(u * img.w)));
  const y = Math.min(img.h - 1, Math.max(0, Math.floor(v * img.h)));
  const o = (y * img.w + x) * 4;
  return (0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2]) / 255;
}

// 4×4 Bayer ordered-dither matrix (thresholds 0..15).
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Error-diffusion kernels: [dx, dy, weight], shared divisor. Atkinson spreads
 *  only 6/8 of the error (its weights sum < divisor), which lightens flats. */
const DIFFUSION: Record<"floyd" | "atkinson" | "jarvis", { div: number; k: [number, number, number][] }> = {
  floyd: { div: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  atkinson: { div: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  jarvis: {
    div: 48,
    k: [
      [1, 0, 7], [2, 0, 5],
      [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
      [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
    ],
  },
};

/** Build the instances that render the image as shapes, aspect-fit live into the
 *  current view (so cell size / pan / zoom re-resolve it). Clears that region
 *  first (replace), so re-applying re-renders cleanly. Pure. */
export function halftoneInstances(state: SceneState, library: Library): MaskResult {
  const aspect = halftoneAspect();
  if (aspect == null) return { places: [], eraseKeys: [] };
  const box = fitBox(state, aspect);
  const { mode, target, invert, contrast, shapeByLum } = state.halftone;
  const { cols, rows } = box;

  // Ink per cell (0 = empty, 1 = full): darkness (unless inverted), pushed
  // around mid-gray by contrast.
  const ink = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lum = sampleHalftoneLum((c + 0.5) / cols, (r + 0.5) / rows);
      const v = invert ? lum : 1 - lum;
      ink[r * cols + c] = Math.max(0, Math.min(1, (v - 0.5) * contrast + 0.5));
    }
  }

  // Error-diffusion dithers diffuse the residual before thresholding.
  const diff = DIFFUSION[mode as "floyd" | "atkinson" | "jarvis"];
  if (diff) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const old = ink[i];
        const next = old >= 0.5 ? 1 : 0;
        ink[i] = next;
        const err = (old - next) / diff.div;
        for (const [dx, dy, w] of diff.k) {
          const nc = c + dx;
          const nr = r + dy;
          if (nc >= 0 && nc < cols && nr < rows) ink[nr * cols + nc] += err * w;
        }
      }
    }
  }

  // Ordered shape pool (for "shape by luminance"): the selected shapes, in order.
  const pool = state.brushAssets.filter((id) => id !== "random" && library.get(id));
  const order = pool.length ? pool : library.ids();

  const places: Instance[] = [];
  const placeKeys = new Set<string>();
  const glyphOn = target === "glyph" || target === "both";
  const cellOn = target === "cell" || target === "both";

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const col = box.col + c;
      const row = box.row + r;
      if (state.blocked[cellKey(col, row)]) continue;
      const v = ink[r * cols + c];

      const base = FILL_SCALE * state.halftone.scale;
      let on = false;
      let scale = base;
      if (mode === "halftone") {
        // Dot area ∝ ink → radius ∝ sqrt(ink). Skip near-empty cells.
        on = v > 0.06;
        scale = Math.sqrt(Math.min(1, v)) * base;
      } else if (mode === "bayer") {
        on = v > (BAYER[r & 3][c & 3] + 0.5) / 16;
      } else {
        on = v >= 0.5; // diffusion already thresholded to 0/1
      }
      if (!on) continue;

      const inst = buildInstance(state, library, col, row);
      const pickedIdx = inst.colorIndex;

      // Shape chosen by luminance: light → first, dark → last of the selection.
      if (shapeByLum && order.length) {
        const idx = Math.min(order.length - 1, Math.max(0, Math.floor(v * order.length)));
        inst.assetId = order[idx];
      }

      // Glyph: scale it (halftone), or hide it (cell-only target).
      if (glyphOn) inst.scale = scale;
      else inst.color = "transparent";
      // Cell background uses the cell's palette color.
      if (cellOn) inst.bgIndex = pickedIdx;

      places.push(inst);
      placeKeys.add(cellKey(col, row));
    }
  }

  // Clear the box (anything occupied that isn't being re-placed).
  const eraseKeys: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = cellKey(box.col + c, box.row + r);
      if (state.instances[key] && !placeKeys.has(key)) eraseKeys.push(key);
    }
  }
  return { places, eraseKeys };
}
