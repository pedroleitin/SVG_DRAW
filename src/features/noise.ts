import { mulberry32 } from "../util/rng";

/** Seeded 2D simplex noise for *spatially coherent* variation — smooth fields
 *  over (col,row) so scale/density vary in gradients and clusters rather than
 *  pure per-cell randomness. Seeded so export reproduces exactly.
 *  (Gustavson-style simplex; returns ~[-1, 1].) */
export class Simplex {
  private perm = new Uint8Array(512);
  private permMod12 = new Uint8Array(512);

  constructor(seed: number) {
    const rng = mulberry32(seed || 1);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher–Yates shuffle with the seeded PRNG.
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  private static GRAD = new Int8Array([
    1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1,
  ]);

  noise(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const G = Simplex.GRAD;

    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.permMod12[ii + this.perm[jj]];
    const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]];
    const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]];

    const corner = (x: number, y: number, gi: number): number => {
      let tt = 0.5 - x * x - y * y;
      if (tt < 0) return 0;
      tt *= tt;
      return tt * tt * (G[gi * 2] * x + G[gi * 2 + 1] * y);
    };

    return 70 * (corner(x0, y0, gi0) + corner(x1, y1, gi1) + corner(x2, y2, gi2));
  }

  /** Same as noise() but remapped to [0, 1]. */
  norm(x: number, y: number): number {
    return this.noise(x, y) * 0.5 + 0.5;
  }
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Maxon-style fractal noise mask parameters. Produces a grayscale field in
 *  [0,1] over grid cells: bright = keep/fill, dark = empty/erase. */
export interface MaskParams {
  scale: number; // feature size in cells (larger = bigger blobs)
  octaves: number; // fBm detail layers (1..6)
  persistence: number; // amplitude falloff per octave (roughness)
  contrast: number; // 1 = neutral, >1 pushes toward black/white
  brightness: number; // -0.5..0.5 shifts the whole field
  threshold: number; // cut for fill vs erase (0..1)
  seed: number;
  offsetX: number; // pan the field (cells) — enables interactive nudging
  offsetY: number;
  seamless?: boolean; // tile the field (no seams) so patterns repeat
}

const LACUNARITY = 2;

/** Plain fractal Brownian motion at (x,y) in cell space -> ~[0,1]. */
function fbm(field: Simplex, x: number, y: number, p: MaskParams): number {
  let freq = 1 / Math.max(0.5, p.scale);
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < p.octaves; o++) {
    sum += amp * field.norm(x * freq, y * freq);
    norm += amp;
    amp *= p.persistence;
    freq *= LACUNARITY;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Tileable fBm: bilinearly blend the four toroidal corners so the field is
 *  periodic (seamless) with period P cells in both axes. */
function fbmTileable(field: Simplex, x: number, y: number, p: MaskParams): number {
  const P = Math.max(2, Math.round(Math.max(0.5, p.scale) * 4)); // tile size (cells)
  const wx = ((x % P) + P) % P;
  const wy = ((y % P) + P) % P;
  const fx = wx / P;
  const fy = wy / P;
  let freq = 1 / Math.max(0.5, p.scale);
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < p.octaves; o++) {
    const n00 = field.norm(wx * freq, wy * freq);
    const n10 = field.norm((wx - P) * freq, wy * freq);
    const n01 = field.norm(wx * freq, (wy - P) * freq);
    const n11 = field.norm((wx - P) * freq, (wy - P) * freq);
    const blended =
      n00 * (1 - fx) * (1 - fy) +
      n10 * fx * (1 - fy) +
      n01 * (1 - fx) * fy +
      n11 * fx * fy;
    sum += amp * blended;
    norm += amp;
    amp *= p.persistence;
    freq *= LACUNARITY;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Sample the fractal mask at a grid cell -> [0,1] (post contrast/brightness). */
export function sampleMask(field: Simplex, col: number, row: number, p: MaskParams): number {
  const x = col + p.offsetX;
  const y = row + p.offsetY;
  let v = p.seamless ? fbmTileable(field, x, y, p) : fbm(field, x, y, p);
  v = (v - 0.5) * p.contrast + 0.5 + p.brightness;
  return clamp01(v);
}

/** Cache one Simplex per seed (the permutation only depends on the seed; all
 *  other params are applied at sample time, so live slider tweaks are cheap). */
let cachedField: { seed: number; field: Simplex } | null = null;
export function maskField(seed: number): Simplex {
  if (!cachedField || cachedField.seed !== seed) {
    cachedField = { seed, field: new Simplex(seed) };
  }
  return cachedField.field;
}
