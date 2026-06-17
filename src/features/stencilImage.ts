/** Holds the uploaded stencil image's pixels (downscaled) outside the
 *  serializable state — like the asset library. The image's world placement
 *  (a cell box) lives in `state.stencil.image`. */

interface Sampled {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

let img: Sampled | null = null;

export function hasStencilImage(): boolean {
  return !!img;
}

/** Aspect ratio (w/h) of the loaded image, or null. */
export function stencilImageAspect(): number | null {
  return img ? img.w / img.h : null;
}

/** Decode + downscale a file (max 256px side) into a luminance-samplable grid. */
export async function setStencilImage(file: File): Promise<{ w: number; h: number } | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return null;
  }
  const max = 256;
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
  const dims = { w: bmp.width, h: bmp.height }; // read before releasing the bitmap
  bmp.close?.();
  return dims;
}

/** Luminance (0..1) at normalized image coords (nearest sample). */
export function sampleStencilLum(u: number, v: number): number {
  if (!img) return 0;
  const x = Math.min(img.w - 1, Math.max(0, Math.floor(u * img.w)));
  const y = Math.min(img.h - 1, Math.max(0, Math.floor(v * img.h)));
  const o = (y * img.w + x) * 4;
  return (0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2]) / 255;
}
