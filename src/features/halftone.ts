import type { Instance, SceneState, HalftoneMode } from "../scene/types";
import type { Library } from "./library";
import type { MaskResult } from "./placement";
import { buildInstance, FILL_SCALE } from "./placement";
import { fitBox } from "./stencil";
import type { CellBox } from "./stencil";
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
let img: Sampled | null = null; // current frame's pixels (downscaled)
let imgVersion = 0;

const SAMPLE_MAX = 320; // longest side of the luminance buffer

/** A still image, a <video>, an animated GIF (decoded via WebCodecs), or a GIF
 *  played in a hidden <img> (the Safari fallback — plays but can't seek). The
 *  current frame is rasterized into `img` for luminance sampling. */
type Source =
  | { kind: "still" }
  | { kind: "video"; el: HTMLVideoElement; url: string; duration: number; w: number; h: number }
  | { kind: "gif"; dec: ImageDecoder; count: number; duration: number; w: number; h: number }
  | { kind: "gifimg"; el: HTMLImageElement; url: string; w: number; h: number };
let source: Source = { kind: "still" };

/** Reused sampling canvas (1 per session) to avoid per-frame allocations. */
let sampleCanvas: HTMLCanvasElement | null = null;
let sampleCtx: CanvasRenderingContext2D | null = null;

export interface SourceMeta {
  w: number;
  h: number;
  animated: boolean;
  /** Frame count for GIFs; 0 for video (time-based scrubbing). */
  frameCount: number;
  duration: number; // seconds
  /** Whether individual frames can be addressed (scrubber). The <img> GIF
   *  fallback plays but can't seek, so it shows Play but no scrubber. */
  seekable: boolean;
}

export function hasHalftoneImage(): boolean {
  return !!img;
}

/** Bumped whenever a new frame is rasterized — lets the live preview cache know
 *  the pixels changed even though they don't live in the serializable state. */
export function halftoneImageVersion(): number {
  return imgVersion;
}

export function halftoneAspect(): number | null {
  return img ? img.w / img.h : null;
}

export function halftoneIsAnimated(): boolean {
  return source.kind !== "still";
}

/** Rasterize a frame into the luminance buffer (downscaled to SAMPLE_MAX). */
function drawFrameToImg(frame: CanvasImageSource, srcW: number, srcH: number): void {
  const scale = Math.min(1, SAMPLE_MAX / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  if (!sampleCanvas) {
    sampleCanvas = document.createElement("canvas");
    sampleCtx = sampleCanvas.getContext("2d");
  }
  if (sampleCanvas.width !== w || sampleCanvas.height !== h) {
    sampleCanvas.width = w;
    sampleCanvas.height = h;
  }
  if (!sampleCtx) return;
  sampleCtx.drawImage(frame, 0, 0, w, h);
  img = { data: sampleCtx.getImageData(0, 0, w, h).data, w, h };
  imgVersion++;
}

/** Release the previous source's resources (video URL / GIF decoder). */
function disposeSource(): void {
  if (source.kind === "video") {
    source.el.src = "";
    URL.revokeObjectURL(source.url);
  } else if (source.kind === "gif") {
    source.dec.close();
  } else if (source.kind === "gifimg") {
    source.el.remove();
    URL.revokeObjectURL(source.url);
  }
  source = { kind: "still" };
  lastGifIndex = -1;
}

/** Seek a <video> to a time and resolve once the frame is ready. */
function seekVideo(el: HTMLVideoElement, t: number): Promise<void> {
  const target = Math.max(0, Math.min(el.duration || 0, t));
  if (Math.abs(el.currentTime - target) < 1e-3) return Promise.resolve();
  return new Promise((res) => {
    const done = () => {
      el.removeEventListener("seeked", done);
      res();
    };
    el.addEventListener("seeked", done);
    el.currentTime = target;
  });
}

/** Load a still image, video, or animated GIF and rasterize its first frame.
 *  Returns metadata (or null on failure). */
export async function setHalftoneSource(file: File): Promise<SourceMeta | null> {
  disposeSource();

  // Video — a hidden <video> we seek per frame.
  if (file.type.startsWith("video/")) {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.muted = true;
    el.playsInline = true;
    el.preload = "auto";
    el.src = url;
    try {
      await new Promise<void>((res, rej) => {
        el.onloadeddata = () => res();
        el.onerror = () => rej(new Error("video decode failed"));
      });
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
    const w = el.videoWidth || 1;
    const h = el.videoHeight || 1;
    const duration = isFinite(el.duration) ? el.duration : 0;
    await seekVideo(el, 0);
    drawFrameToImg(el, w, h);
    source = { kind: "video", el, url, duration, w, h };
    return { w, h, animated: true, frameCount: 0, duration, seekable: true };
  }

  // Animated GIF — decode frames via WebCodecs (frame-accurate, scrubbable).
  if (file.type === "image/gif" && typeof (window as { ImageDecoder?: unknown }).ImageDecoder !== "undefined") {
    try {
      const data = await file.arrayBuffer();
      const dec = new ImageDecoder({ data, type: "image/gif" });
      await dec.tracks.ready;
      const track = dec.tracks.selectedTrack;
      const count = track?.frameCount ?? 1;
      const { image } = await dec.decode({ frameIndex: 0 });
      const w = image.displayWidth;
      const h = image.displayHeight;
      const frameDur = (image.duration ?? 100000) / 1e6; // µs → s
      drawFrameToImg(image, w, h);
      image.close();
      source = { kind: "gif", dec, count, duration: frameDur * count, w, h };
      return { w, h, animated: count > 1, frameCount: count, duration: frameDur * count, seekable: count > 1 };
    } catch {
      // fall through to the <img> fallback
    }
  }

  // GIF without WebCodecs (Safari): play it in a hidden <img> and sample the
  // current frame — animated (Play works) but not seekable (no scrubber).
  if (file.type === "image/gif") {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.src = url;
    // Render it off-screen so the browser keeps the GIF animating.
    el.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1";
    try {
      await el.decode();
    } catch {
      URL.revokeObjectURL(url);
      // fall through to still
    }
    if (el.naturalWidth) {
      document.body.appendChild(el);
      drawFrameToImg(el, el.naturalWidth, el.naturalHeight);
      source = { kind: "gifimg", el, url, w: el.naturalWidth, h: el.naturalHeight };
      return { w: el.naturalWidth, h: el.naturalHeight, animated: true, frameCount: 0, duration: 0, seekable: false };
    }
  }

  // Still image (also the final GIF fallback: just its first frame).
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return null;
  }
  drawFrameToImg(bmp, bmp.width, bmp.height);
  const dims = { w: bmp.width, h: bmp.height };
  bmp.close?.();
  source = { kind: "still" };
  return { ...dims, animated: false, frameCount: 0, duration: 0, seekable: false };
}

/** Bounding cell box of every cell that lights up across the whole source (all
 *  frames, sampled). Lets the export frame cover all glyphs so no frame is cut.
 *  Restores the source to frame 0 when done. Null if nothing lights up. */
export async function halftoneCoverage(
  state: SceneState,
  library: Library,
  samples = 20,
): Promise<CellBox | null> {
  const aspect = halftoneAspect();
  if (aspect == null) return null;
  const box = lastBox ?? fitBox(state, aspect);
  let minC = Infinity;
  let minR = Infinity;
  let maxC = -Infinity;
  let maxR = -Infinity;
  // gifimg can't seek, so coverage uses only the current frame.
  const n = source.kind === "still" || source.kind === "gifimg" ? 1 : Math.max(2, samples);
  for (let i = 0; i < n; i++) {
    if (n > 1) await setHalftoneFrame(i / (n - 1));
    for (const p of halftoneInstances(state, library, box).places) {
      if (p.col < minC) minC = p.col;
      if (p.row < minR) minR = p.row;
      if (p.col > maxC) maxC = p.col;
      if (p.row > maxR) maxR = p.row;
    }
  }
  if (n > 1) await setHalftoneFrame(0); // restore
  if (maxC < minC) return null;
  return { col: minC, row: minR, cols: maxC - minC + 1, rows: maxR - minR + 1 };
}

/** Rasterize the frame at normalized time u (0..1) of an animated source. */
export async function setHalftoneFrame(u: number): Promise<void> {
  const t = Math.max(0, Math.min(1, u));
  if (source.kind === "video") {
    await seekVideo(source.el, t * source.duration);
    drawFrameToImg(source.el, source.w, source.h);
  } else if (source.kind === "gif") {
    const i = Math.min(source.count - 1, Math.max(0, Math.floor(t * source.count)));
    const { image } = await source.dec.decode({ frameIndex: i });
    drawFrameToImg(image, source.w, source.h);
    image.close();
  }
}

/** Back-compat alias (still images). */
export async function setHalftoneImage(file: File): Promise<SourceMeta | null> {
  return setHalftoneSource(file);
}

export function halftoneIsVideo(): boolean {
  return source.kind === "video";
}

export function halftoneDuration(): number {
  return source.kind === "video" || source.kind === "gif" ? source.duration : 0;
}

/** Start/stop the underlying <video> for live playback (no-op for GIF/still). */
export function halftonePlayVideo(): void {
  if (source.kind === "video") {
    source.el.loop = true;
    source.el.play().catch(() => {});
  }
}
export function halftonePauseVideo(): void {
  if (source.kind === "video") source.el.pause();
}

/** Current playhead position 0..1 (video time / duration), else 0. */
export function halftonePlayhead(): number {
  if (source.kind === "video" && source.duration > 0) {
    return (source.el.currentTime % source.duration) / source.duration;
  }
  return 0;
}

let lastGifIndex = -1;

/** Advance an animated source to the global animation time (called per render
 *  frame while playing). Video samples its own clock; GIF maps time → frame
 *  index and decodes only when it changes. Cheap / no store mutation. */
export function advanceHalftone(timeSec: number): void {
  if (source.kind === "video" || source.kind === "gifimg") {
    // Sample the element's currently-displayed frame (it plays on its own).
    drawFrameToImg(source.el, source.w, source.h);
  } else if (source.kind === "gif") {
    const u = source.duration > 0 ? (timeSec / source.duration) % 1 : 0;
    const i = Math.min(source.count - 1, Math.max(0, Math.floor(u * source.count)));
    if (i !== lastGifIndex) {
      lastGifIndex = i;
      void setHalftoneFrame(u);
    }
  }
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

/** The fit box of the most recent live (preview/apply) halftone build — so the
 *  animated export can reuse the exact same grid the user saw, instead of
 *  re-deriving it from the camera at export time. */
let lastBox: CellBox | null = null;
export function halftoneLastBox(): CellBox | null {
  return lastBox;
}

/** Build the instances that render the image as shapes, aspect-fit live into the
 *  current view (so cell size / pan / zoom re-resolve it) — or into an explicit
 *  `boxOverride` (the export reusing the last live box). Clears that region first
 *  (replace), so re-applying re-renders cleanly. Pure apart from caching the box. */
export function halftoneInstances(
  state: SceneState,
  library: Library,
  boxOverride?: CellBox,
): MaskResult {
  const aspect = halftoneAspect();
  if (aspect == null) return { places: [], eraseKeys: [] };
  const box = boxOverride ?? fitBox(state, aspect);
  if (!boxOverride) lastBox = box; // remember live fits, not export reuses
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
