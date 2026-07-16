/** Parses the internal CSS animation of an imported SVG (a shape whose own
 *  markup animates — e.g. a square that scales on Y) into a PURE function of
 *  time. This mirrors the project's philosophy: the same code drives live
 *  playback AND frame-accurate export.
 *
 *  Scope (matches the curated assets we ship): CSS `@keyframes` that animate
 *  `transform`, with per-keyframe `animation-timing-function` (cubic-bezier or
 *  linear). Each animated element is a `<g>` carrying an `animation:` shorthand
 *  that names one keyframes block. Transform lists are interpolated
 *  component-wise when their function shape matches across two stops. */

const TF_RE = /([a-zA-Z]+)\(([^)]*)\)/g;

export interface TransformFn {
  name: string;
  args: number[];
}

export interface AnimStop {
  /** Keyframe offset, 0..1. */
  off: number;
  /** Parsed transform list at this stop. */
  fns: TransformFn[];
  /** Easing for the segment STARTING at this stop. */
  easing: Easing;
  /** Optional stepwise `visibility` at this stop (not interpolated). */
  vis?: "visible" | "hidden";
}

/** One element's internal animation: a keyframes track + a loop duration. */
export interface AssetAnim {
  /** Marker index — matches `data-anim` on the element in the asset markup. */
  index: number;
  stops: AnimStop[];
  /** Loop duration in seconds. */
  dur: number;
}

type Easing = { kind: "linear" } | { kind: "cubic"; p: [number, number, number, number] };

const LINEAR: Easing = { kind: "linear" };

/** Parse a transform string (e.g. "translate(64 128) scale(1,0)") into a list. */
function parseTransformList(s: string): TransformFn[] {
  const out: TransformFn[] = [];
  TF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TF_RE.exec(s))) {
    const args = m[2]
      .split(/[\s,]+/)
      .map((t) => parseFloat(t))
      .filter((n) => !Number.isNaN(n));
    out.push({ name: m[1].toLowerCase(), args });
  }
  return out;
}

/** Serialize a transform list back to an SVG transform attribute string. */
export function transformListToString(fns: TransformFn[]): string {
  return fns.map((f) => `${f.name}(${f.args.map(fmt).join(" ")})`).join(" ");
}

const fmt = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

function parseEasing(v: string | undefined): Easing {
  if (!v) return LINEAR;
  const t = v.trim().toLowerCase();
  if (t === "linear") return LINEAR;
  if (t === "ease") return { kind: "cubic", p: [0.25, 0.1, 0.25, 1] };
  if (t === "ease-in") return { kind: "cubic", p: [0.42, 0, 1, 1] };
  if (t === "ease-out") return { kind: "cubic", p: [0, 0, 0.58, 1] };
  if (t === "ease-in-out") return { kind: "cubic", p: [0.42, 0, 0.58, 1] };
  const m = t.match(/cubic-bezier\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    if (p.length === 4 && p.every((x) => !Number.isNaN(x))) {
      return { kind: "cubic", p: p as [number, number, number, number] };
    }
  }
  return LINEAR;
}

/** Sample a cubic-bezier(x1,y1,x2,y2) easing at progress k∈[0,1] → eased y.
 *  Solves for the parametric t where the x-curve equals k (Newton + bisection),
 *  then evaluates the y-curve — the standard CSS timing-function method. */
function cubicBezier(p: [number, number, number, number], k: number): number {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  const [x1, y1, x2, y2] = p;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  let t = k;
  for (let i = 0; i < 8; i++) {
    const x = sampleX(t) - k;
    if (Math.abs(x) < 1e-6) break;
    const d = sampleDX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= x / d;
  }
  // Bisection fallback keeps t in range if Newton diverged.
  if (t < 0 || t > 1) {
    let lo = 0;
    let hi = 1;
    t = k;
    for (let i = 0; i < 20; i++) {
      const x = sampleX(t);
      if (Math.abs(x - k) < 1e-6) break;
      if (x < k) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
  }
  return ((ay * t + by) * t + cy) * t;
}

function ease(e: Easing, k: number): number {
  return e.kind === "linear" ? k : cubicBezier(e.p, k);
}

/** Interpolate two transform lists at eased progress u∈[0,1]. Component-wise
 *  when shapes match; otherwise snap to whichever stop is nearer. */
function lerpTransforms(a: TransformFn[], b: TransformFn[], u: number): TransformFn[] {
  const same =
    a.length === b.length &&
    a.every((f, i) => f.name === b[i].name && f.args.length === b[i].args.length);
  if (!same) return u < 0.5 ? a : b;
  return a.map((f, i) => ({
    name: f.name,
    args: f.args.map((x, j) => x + (b[i].args[j] - x) * u),
  }));
}

/** Evaluate an animation track at a normalized progress p∈[0,1] (no wrapping —
 *  p is clamped, so p=1 yields the final stop, needed for reverse/hold). */
export function sampleTrack(anim: AssetAnim, p: number): TransformFn[] {
  const s = anim.stops;
  if (s.length === 0) return [];
  if (s.length === 1) return s[0].fns;
  const t = p < 0 ? 0 : p > 1 ? 1 : p;
  let i = 0;
  while (i < s.length - 1 && t >= s[i + 1].off) i++;
  const a = s[i];
  const b = s[Math.min(i + 1, s.length - 1)];
  const span = b.off - a.off;
  const k = span > 1e-9 ? (t - a.off) / span : 0;
  return lerpTransforms(a.fns, b.fns, ease(a.easing, k));
}

/** Evaluate an animation track at normalized time t01 (wraps — sawtooth loop). */
export function transformAt(anim: AssetAnim, t01: number): TransformFn[] {
  return sampleTrack(anim, ((t01 % 1) + 1) % 1);
}

/** True if any stop actually carries a transform (vs a visibility-only track). */
export function hasTransformTrack(anim: AssetAnim): boolean {
  return anim.stops.some((s) => s.fns.length > 0);
}

/** True if any stop drives `visibility` (a step property, not interpolated). */
export function hasVisibilityTrack(anim: AssetAnim): boolean {
  return anim.stops.some((s) => s.vis !== undefined);
}

/** Stepwise `visibility` at normalized progress p∈[0,1]: the value of the last
 *  stop at or before p (no interpolation). null when the track has none. */
export function sampleVisibility(anim: AssetAnim, p: number): "visible" | "hidden" | null {
  const s = anim.stops;
  if (!s.length) return null;
  const t = p < 0 ? 0 : p > 1 ? 1 : p;
  let val: "visible" | "hidden" | null = null;
  for (const stop of s) {
    if (stop.off > t) break;
    if (stop.vis !== undefined) val = stop.vis;
  }
  // Before the first defining stop, fall back to the earliest defined value.
  if (val === null) {
    for (const stop of s) {
      if (stop.vis !== undefined) return stop.vis;
    }
  }
  return val;
}

/** Playback controls for an internal shape animation. */
export interface ShapePlaybackOpts {
  /** Play the track forward then backward (else it loops back to the start). */
  reverse: boolean;
  /** Seconds to hold at the top (end of the forward pass) before it loops or
   *  reverses — applies with or without reverse. */
  rest: number;
}

const modPos = (a: number, n: number): number => ((a % n) + n) % n;

/** Map (speed-scaled) time T to a normalized progress p∈[0,1] along an internal
 *  shape track, honoring reverse + rest and an optional per-instance phase.
 *  Without reverse: 0→1, hold(rest) at the top, then jump back to 0 (sawtooth +
 *  hold). With reverse: 0→1 → hold(rest) → 1→0. `phase01` shifts the start
 *  (0 = synced; unsynced instances use a per-cell offset so they don't all move
 *  together). */
export function shapePlayhead(
  opts: ShapePlaybackOpts,
  T: number,
  dur: number,
  phase01 = 0,
): number {
  const d = dur > 0 ? dur : 1;
  const rest = Math.max(0, opts.rest);
  if (!opts.reverse) {
    const period = d + rest;
    const t = modPos(T + phase01 * period, period);
    return t < d ? t / d : 1; // 0→1, then hold at the top until it loops
  }
  const period = d + rest + d;
  let t = modPos(T + phase01 * period, period);
  if (t < d) return t / d; // intro 0→1
  t -= d;
  if (t < rest) return 1; // hold at the top
  t -= rest;
  return 1 - t / d; // reverse 1→0
}

/** Deterministic pseudo-random rest scale in [0,1) for a phase bucket, so the
 *  "random rest" toggle scatters hold times reproducibly (same bucket → same
 *  value, which keeps instancing intact). */
export function restBasisForBucket(bucket: number): number {
  let h = (bucket * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Resolve `--var` references in a CSS value against a vars map. */
function resolveVar(value: string, vars: Map<string, string>): string {
  return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => vars.get(name) ?? "");
}

/** Parse a duration token ("1s", "500ms") to seconds. */
function parseDur(v: string): number {
  const t = v.trim().toLowerCase();
  if (t.endsWith("ms")) return parseFloat(t) / 1000;
  if (t.endsWith("s")) return parseFloat(t);
  const n = parseFloat(t);
  return Number.isNaN(n) ? 1 : n;
}

interface StyleModel {
  /** :root custom properties. */
  vars: Map<string, string>;
  /** class name → { keyframes name, duration seconds }. */
  animByClass: Map<string, { name: string; dur: number }>;
  /** keyframes name → parsed stops. */
  keyframes: Map<string, AnimStop[]>;
}

/** Very small CSS reader tailored to our exported animation stylesheets. */
export function parseStyle(css: string): StyleModel {
  const vars = new Map<string, string>();
  const animByClass = new Map<string, { name: string; dur: number }>();
  const keyframes = new Map<string, AnimStop[]>();

  // 1) Pull out @keyframes blocks first. Bodies contain nested `{}` (per-stop
  //    declaration blocks), so a plain regex isn't reliable — walk and match
  //    braces to extract each block, removing it from the working copy.
  let rest = css;
  const kfBlocks: Array<[string, string]> = [];
  {
    const marker = "@keyframes";
    let idx = rest.indexOf(marker);
    while (idx !== -1) {
      const nameStart = idx + marker.length;
      const braceOpen = rest.indexOf("{", nameStart);
      if (braceOpen === -1) break;
      const name = rest.slice(nameStart, braceOpen).trim();
      let depth = 1;
      let j = braceOpen + 1;
      for (; j < rest.length && depth > 0; j++) {
        if (rest[j] === "{") depth++;
        else if (rest[j] === "}") depth--;
      }
      kfBlocks.push([name, rest.slice(braceOpen + 1, j - 1)]);
      rest = rest.slice(0, idx) + rest.slice(j);
      idx = rest.indexOf(marker);
    }
  }

  for (const [name, body] of kfBlocks) {
    keyframes.set(name, parseKeyframeBody(body));
  }

  // 2) Rule blocks: `selector { decls }` on the keyframe-free CSS.
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rm: RegExpExecArray | null;
  while ((rm = ruleRe.exec(rest))) {
    const selector = rm[1].trim();
    const decls = parseDecls(rm[2]);
    if (selector === ":root") {
      for (const [k, v] of decls) if (k.startsWith("--")) vars.set(k, v);
      continue;
    }
    const anim = decls.get("animation");
    if (anim) {
      // shorthand: "<name> <dur> <timing> ..." — grab name + first time token.
      const resolved = resolveVar(anim, vars);
      const toks = resolved.trim().split(/\s+/);
      let name = "";
      let dur = 1;
      for (const tk of toks) {
        if (/^[0-9.]+m?s$/i.test(tk)) dur = parseDur(tk);
        else if (!name && !/^(infinite|linear|ease|ease-in|ease-out|ease-in-out|normal|forwards|backwards|both|alternate|reverse|paused|running)$/i.test(tk) && !/^cubic-bezier/.test(tk))
          name = tk;
      }
      for (const cls of selectorClasses(selector)) animByClass.set(cls, { name, dur });
    }
  }

  return { vars, animByClass, keyframes };
}

/** Extract `.class` names from a selector (supports comma-separated groups). */
function selectorClasses(selector: string): string[] {
  const out: string[] = [];
  for (const part of selector.split(",")) {
    const m = part.trim().match(/\.([\w-]+)/);
    if (m) out.push(m[1]);
  }
  return out;
}

function parseDecls(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const chunk of body.split(";")) {
    const i = chunk.indexOf(":");
    if (i === -1) continue;
    const k = chunk.slice(0, i).trim().toLowerCase();
    const v = chunk.slice(i + 1).trim();
    if (k) map.set(k, v);
  }
  return map;
}

/** Parse a @keyframes body into ordered stops with per-stop easing. */
function parseKeyframeBody(body: string): AnimStop[] {
  const stops: AnimStop[] = [];
  const stopRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = stopRe.exec(body))) {
    const selectors = m[1].trim();
    const decls = parseDecls(m[2]);
    const transform = decls.get("transform") ?? "";
    const easing = parseEasing(decls.get("animation-timing-function"));
    const fns = parseTransformList(transform);
    const visRaw = decls.get("visibility")?.toLowerCase();
    const vis = visRaw === "visible" || visRaw === "hidden" ? visRaw : undefined;
    for (const sel of selectors.split(",")) {
      const off = parseOffset(sel.trim());
      if (off != null) stops.push({ off, fns, easing, vis });
    }
  }
  stops.sort((a, b) => a.off - b.off);
  return stops;
}

function parseOffset(sel: string): number | null {
  const t = sel.toLowerCase();
  if (t === "from") return 0;
  if (t === "to") return 1;
  const m = t.match(/^([0-9.]+)%$/);
  if (m) return parseFloat(m[1]) / 100;
  return null;
}
