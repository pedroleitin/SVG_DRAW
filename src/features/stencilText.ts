/** Renders a text string to an offscreen B/W canvas and samples its luminance —
 *  the "text" stencil source. Like stencilImage, the pixels live here (not in
 *  serializable state); the placement (a cell box) lives in state.stencil.text. */

interface Sampled {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

let txt: Sampled | null = null;

export function hasStencilText(): boolean {
  return !!txt;
}

export function stencilTextAspect(): number | null {
  return txt ? txt.w / txt.h : null;
}

/** Rasterize white text on black; returns the canvas dims (or null if empty). */
export function renderStencilText(text: string, bold: boolean): { w: number; h: number } | null {
  if (!text.trim()) {
    txt = null;
    return null;
  }
  const fontPx = 80;
  const font = `${bold ? "700 " : ""}${fontPx}px sans-serif`;
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  probe.font = font;
  const w = Math.max(1, Math.ceil(probe.measureText(text).width) + 12);
  const h = Math.ceil(fontPx * 1.32);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2);
  txt = { data: ctx.getImageData(0, 0, w, h).data, w, h };
  return { w, h };
}

/** Luminance (0..1) at normalized text coords (nearest sample). */
export function sampleTextLum(u: number, v: number): number {
  if (!txt) return 0;
  const x = Math.min(txt.w - 1, Math.max(0, Math.floor(u * txt.w)));
  const y = Math.min(txt.h - 1, Math.max(0, Math.floor(v * txt.h)));
  const o = (y * txt.w + x) * 4;
  return (0.299 * txt.data[o] + 0.587 * txt.data[o + 1] + 0.114 * txt.data[o + 2]) / 255;
}
