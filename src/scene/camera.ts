import type { Camera } from "./types";

/** The camera is the root <svg> viewBox over an infinite plane.
 *  Zoom is expressed as (viewport pixels / world units) and recovered from
 *  the ratio of the host element size to the viewBox size. */

export interface Size {
  width: number;
  height: number;
}

export function makeCamera(host: Size, scale = 1): Camera {
  return { x: 0, y: 0, w: host.width / scale, h: host.height / scale };
}

/** Current zoom factor (screen px per world unit) for the horizontal axis. */
export const zoomOf = (cam: Camera, host: Size): number => host.width / cam.w;

export function screenToWorld(
  cam: Camera,
  host: Size,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return {
    x: cam.x + (sx / host.width) * cam.w,
    y: cam.y + (sy / host.height) * cam.h,
  };
}

/** Zoom by `factor` (>1 zoom in) keeping the world point under the cursor fixed. */
export function zoomAt(
  cam: Camera,
  host: Size,
  sx: number,
  sy: number,
  factor: number,
  limits = { min: 0.05, max: 40 },
): Camera {
  const currentZoom = zoomOf(cam, host);
  const nextZoom = clamp(currentZoom * factor, limits.min, limits.max);
  const realFactor = currentZoom / nextZoom; // viewBox scales inversely to zoom
  const before = screenToWorld(cam, host, sx, sy);
  const w = cam.w * realFactor;
  const h = cam.h * realFactor;
  // keep cursor anchored: world point under cursor must stay put
  const x = before.x - (sx / host.width) * w;
  const y = before.y - (sy / host.height) * h;
  return { x, y, w, h };
}

export function panBy(cam: Camera, host: Size, dxPx: number, dyPx: number): Camera {
  return {
    ...cam,
    x: cam.x - (dxPx / host.width) * cam.w,
    y: cam.y - (dyPx / host.height) * cam.h,
  };
}

/** Resize the viewport while preserving zoom and top-left world anchor. */
export function resizeCamera(cam: Camera, prev: Size, next: Size): Camera {
  const zoom = prev.width > 0 ? cam.w / prev.width : 1;
  return { ...cam, w: next.width * zoom, h: next.height * zoom };
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
