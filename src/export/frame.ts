import type { Camera } from "../scene/types";

/** Export frame: a rectangle in WORLD coordinates defining what gets exported,
 *  decoupled from the on-screen zoom/pan. */
export interface ExportFrame {
  aspect: AspectId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Output width in pixels; height derives from the frame's w/h ratio. */
  outWidth: number;
  /** Show the letterbox overlay + border on the canvas. */
  show: boolean;
  /** Snap frame edges to cell boundaries so it never cuts a cell. */
  snap: boolean;
}

/** Round a world value to the nearest cell boundary. */
export const snapToCell = (v: number, cellSize: number): number =>
  Math.round(v / cellSize) * cellSize;

/** Snap a frame's edges to whole cells (size stays >= 1 cell). */
export function snapFrame(
  f: { x: number; y: number; w: number; h: number },
  cellSize: number,
): { x: number; y: number; w: number; h: number } {
  const x = snapToCell(f.x, cellSize);
  const y = snapToCell(f.y, cellSize);
  const w = Math.max(cellSize, snapToCell(f.w, cellSize));
  const h = Math.max(cellSize, snapToCell(f.h, cellSize));
  return { x, y, w, h };
}

export type AspectId = "16:9" | "1:1" | "9:16" | "4:5" | "4:3" | "free";

export const ASPECTS: { id: AspectId; ratio: number }[] = [
  { id: "16:9", ratio: 16 / 9 },
  { id: "1:1", ratio: 1 },
  { id: "9:16", ratio: 9 / 16 },
  { id: "4:5", ratio: 4 / 5 },
  { id: "4:3", ratio: 4 / 3 },
  { id: "free", ratio: 0 }, // 0 = use the frame's own w/h
];

export const ASPECT_IDS = ASPECTS.map((a) => a.id);

export function aspectRatio(id: AspectId): number {
  return ASPECTS.find((a) => a.id === id)?.ratio ?? 1;
}

/** Output pixel size: width is fixed, height follows the frame's real ratio. */
export function outSize(frame: ExportFrame): { outW: number; outH: number } {
  const ratio = frame.w / frame.h || 1;
  const outW = Math.max(1, Math.round(frame.outWidth));
  return { outW, outH: Math.max(1, Math.round(outW / ratio)) };
}

/** Largest rect of the given aspect that fits ~90% of the viewport, centered.
 *  aspect "free" matches the current viewport ratio. */
export function fitFrame(cam: Camera, aspect: AspectId): { x: number; y: number; w: number; h: number } {
  const ratio = aspect === "free" || aspectRatio(aspect) <= 0 ? cam.w / cam.h : aspectRatio(aspect);
  let w = cam.w * 0.9;
  let h = w / ratio;
  if (h > cam.h * 0.9) {
    h = cam.h * 0.9;
    w = h * ratio;
  }
  return {
    x: cam.x + (cam.w - w) / 2,
    y: cam.y + (cam.h - h) / 2,
    w,
    h,
  };
}
