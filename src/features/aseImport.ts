/** Adobe Swatch Exchange (.ase) → hex colors.
 *
 *  ASE is a big-endian binary format: a 4-byte "ASEF" signature, a version
 *  (2×uint16), a uint32 block count, then blocks. We read color-entry blocks
 *  (type 0x0001) and skip group start/end (0xc001/0xc002). Each color carries a
 *  UTF-16BE name, a 4-char color model ("RGB ", "CMYK", "LAB ", "Gray"), the
 *  channel floats, then a color-type uint16. RGB/CMYK/Gray/LAB are converted to
 *  #rrggbb. */

export interface AseColor {
  name: string;
  hex: string;
}

export function parseAse(buf: ArrayBuffer): AseColor[] {
  const dv = new DataView(buf);
  if (dv.byteLength < 12) return [];
  if (str(dv, 0, 4) !== "ASEF") return [];
  const blocks = dv.getUint32(8, false);
  const out: AseColor[] = [];
  let off = 12;
  for (let b = 0; b < blocks && off + 6 <= dv.byteLength; b++) {
    const type = dv.getUint16(off, false);
    const len = dv.getUint32(off + 2, false);
    const start = off + 6;
    if (type === 0x0001) {
      const c = readColor(dv, start);
      if (c) out.push(c);
    }
    off = start + len; // group blocks just advance
  }
  return out;
}

function readColor(dv: DataView, start: number): AseColor | null {
  let p = start;
  const nameLen = dv.getUint16(p, false); // chars incl. null terminator
  p += 2;
  let name = "";
  for (let i = 0; i < nameLen; i++) {
    const code = dv.getUint16(p, false);
    p += 2;
    if (code) name += String.fromCharCode(code);
  }
  const model = str(dv, p, 4).trim();
  p += 4;
  let hex: string | null = null;
  if (model === "RGB") {
    hex = rgbToHex(dv.getFloat32(p, false), dv.getFloat32(p + 4, false), dv.getFloat32(p + 8, false));
  } else if (model === "CMYK") {
    const c = dv.getFloat32(p, false), m = dv.getFloat32(p + 4, false);
    const y = dv.getFloat32(p + 8, false), k = dv.getFloat32(p + 12, false);
    hex = rgbToHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
  } else if (model === "Gray") {
    const g = dv.getFloat32(p, false);
    hex = rgbToHex(g, g, g);
  } else if (model === "LAB") {
    // ASE stores L as 0..1; a/b as signed values (~ -128..127).
    hex = labToHex(dv.getFloat32(p, false) * 100, dv.getFloat32(p + 4, false), dv.getFloat32(p + 8, false));
  }
  return hex ? { name: name || "Color", hex } : null;
}

function str(dv: DataView, off: number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(off + i));
  return s;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

function labToHex(L: number, a: number, b: number): string {
  // LAB → XYZ (D65) → sRGB.
  let y = (L + 16) / 116;
  let x = a / 500 + y;
  let z = y - b / 200;
  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  x = 0.95047 * f(x);
  y = 1.0 * f(y);
  z = 1.08883 * f(z);
  let r = x * 3.2406 - y * 1.5372 - z * 0.4986;
  let g = -x * 0.9689 + y * 1.8758 + z * 0.0415;
  let bl = x * 0.0557 - y * 0.204 + z * 1.057;
  const gamma = (c: number) => (c > 0.0031308 ? 1.055 * c ** (1 / 2.4) - 0.055 : 12.92 * c);
  return rgbToHex(gamma(r), gamma(g), gamma(bl));
}
