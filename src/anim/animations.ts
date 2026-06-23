/** Time-driven animation system. Everything is a PURE function of time so the
 *  same code drives live playback AND frame-accurate export (Phase 6).
 *
 *  Two layers:
 *   1. Lifecycle — each SVG ENTERS (forms in), HOLDS (optionally with idle
 *      motion), then EXITS (forms out). Enter/exit styles: fade, scale, rotate…
 *   2. Order — WHEN each SVG starts its lifecycle, as a normalized value o∈[0,1]
 *      from a preset (random / sequential / linear / radial / free-drawn path).
 *      `spread` turns that order into a stagger so the reveal sweeps the grid. */

export interface AnimOutput {
  rotate?: number; // degrees, added to base
  scaleMul?: number; // multiplies base scale
  dx?: number; // cell-fraction offset
  dy?: number;
  opacity?: number; // 0..1
}

/** Idle motion applied while an instance is fully visible (HOLD phase). */
export type AnimFn = (tt: number, amount: number) => AnimOutput;

const TAU = Math.PI * 2;

export const ANIMATIONS: Record<string, AnimFn> = {
  none: () => ({}),
  spin: (tt, a) => ({ rotate: tt * 120 * a }),
  pulse: (tt, a) => ({ scaleMul: 1 + Math.sin(tt * TAU) * 0.35 * a }),
  bob: (tt, a) => ({ dy: Math.sin(tt * TAU) * 0.3 * a }),
  sway: (tt, a) => ({ dx: Math.sin(tt * TAU) * 0.3 * a }),
  orbit: (tt, a) => ({
    dx: Math.cos(tt * TAU) * 0.25 * a,
    dy: Math.sin(tt * TAU) * 0.25 * a,
  }),
};

// "shuffle" isn't a transform motion — it swaps each glyph's shape over time.
// The renderer handles it (sampleLifecycle treats it as `none` for transforms).
export const IDLE_IDS = [...Object.keys(ANIMATIONS), "shuffle"];

// ---- Direction (used by the "linear" order preset) ----

export type Direction =
  | "left-right"
  | "right-left"
  | "top-bottom"
  | "bottom-top"
  | "diagonal"
  | "radial";

export const DIRECTIONS: Direction[] = [
  "left-right",
  "right-left",
  "top-bottom",
  "bottom-top",
  "diagonal",
  "radial",
];

/** Scalar that increases along a direction — used to rank cells for ordering. */
export function directionPhase(col: number, row: number, dir: Direction): number {
  switch (dir) {
    case "left-right":
      return col;
    case "right-left":
      return -col;
    case "top-bottom":
      return row;
    case "bottom-top":
      return -row;
    case "diagonal":
      return col + row;
    case "radial":
      return Math.hypot(col, row);
    default:
      return col;
  }
}

// ---- Lifecycle config ----

export type OrderMode = "all" | "free" | "random" | "sequential" | "linear" | "radial" | "halftone";
export const ORDER_MODES: OrderMode[] = [
  "all",
  "linear",
  "radial",
  "sequential",
  "random",
  "free",
  "halftone",
];

export type PlaybackMode = "loop" | "pingpong" | "once" | "sweep";
export const PLAYBACK_MODES: PlaybackMode[] = ["loop", "pingpong", "once", "sweep"];

export type EnterExit = "none" | "fade" | "scale" | "pop" | "rotate";
export const ENTER_EXITS: EnterExit[] = ["none", "fade", "scale", "pop", "rotate"];

export interface AnimationConfig {
  playing: boolean;
  playback: PlaybackMode;
  speed: number;
  // ordering
  order: OrderMode;
  direction: Direction;
  spread: number; // seconds between first and last instance start
  // lifecycle (seconds)
  enter: EnterExit;
  exit: EnterExit;
  enterDur: number;
  hold: number;
  exitDur: number;
  // idle motion during hold
  idle: string;
  idleAmount: number;
}

// ---- Sampling ----

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const easeOutBack = (k: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};

/** Map a visibility factor k∈[0,1] (0 = absent, 1 = present) to a transform. */
function transition(style: EnterExit, k: number): AnimOutput {
  const kk = clamp01(k);
  switch (style) {
    case "fade":
      return { opacity: kk };
    case "scale":
      return { scaleMul: easeOut(kk), opacity: kk };
    case "pop":
      return { scaleMul: easeOutBack(kk), opacity: kk };
    case "rotate":
      return { rotate: (1 - kk) * 180, scaleMul: easeOut(kk), opacity: kk };
    case "none":
    default:
      return {};
  }
}

/** Total length of one cycle in seconds (exit:none = reveal-and-stay). */
export function cycleLength(c: AnimationConfig): number {
  const exit = c.exit === "none" ? 0 : c.exitDur;
  // "sweep" plays a full reveal sweep, then a full erase sweep in the SAME order
  // direction — so the stagger (spread) is paid twice (once per sweep).
  if (c.playback === "sweep") {
    return Math.max(0.0001, c.spread + c.enterDur + c.hold + c.spread + exit);
  }
  return Math.max(0.0001, c.spread + c.enterDur + c.hold + exit);
}

/** Map elapsed (already speed-scaled) time T to a time within one cycle,
 *  honoring the playback mode. */
export function mapCycleTime(c: AnimationConfig, T: number): number {
  const L = cycleLength(c);
  if (c.playback === "once") return Math.min(T, L);
  if (c.playback === "pingpong") {
    const p = 2 * L;
    const m = ((T % p) + p) % p;
    return m <= L ? m : p - m;
  }
  const m = ((T % L) + L) % L;
  return m;
}

/** Natural real-time duration (seconds) of one full animation pass — a clean
 *  loop length for export. Ping-pong takes a forward + back pass. */
export function loopDuration(c: AnimationConfig): number {
  const base = cycleLength(c) / Math.max(0.0001, c.speed);
  return c.playback === "pingpong" ? base * 2 : base;
}

export interface LifeOutput extends AnimOutput {
  hidden?: boolean;
}

/** Sample one instance's lifecycle: `o` is its order [0,1], `tcyc` the cycle
 *  time, `idleT` a continuous clock for HOLD-phase idle motion. */
export function sampleLifecycle(
  c: AnimationConfig,
  o: number,
  tcyc: number,
  idleT: number,
): LifeOutput {
  if (c.playback === "sweep") return sampleSweep(c, o, tcyc, idleT);
  const start = o * c.spread;
  const p = tcyc - start;
  if (p < 0) return { hidden: true, opacity: 0 };

  const enterEnd = c.enterDur;
  const holdEnd = enterEnd + c.hold;
  const exitEnd = holdEnd + c.exitDur;

  if (p < enterEnd) {
    const k = c.enterDur > 0 ? p / c.enterDur : 1;
    return transition(c.enter, k);
  }
  // exit:none -> stay visible forever after entering (reveal and hold).
  if (c.exit === "none" || p < holdEnd) {
    const fn = ANIMATIONS[c.idle] ?? ANIMATIONS.none;
    return fn(idleT, c.idleAmount);
  }
  if (p < exitEnd) {
    const k = c.exitDur > 0 ? 1 - (p - holdEnd) / c.exitDur : 0;
    return transition(c.exit, k);
  }
  return { hidden: true, opacity: 0 };
}

/** "sweep" playback: two distinct passes in the SAME order direction. First the
 *  whole scene reveals (each instance enters at o·spread); after a hold, the
 *  whole scene erases — again low-order first — so a left→right reveal is undone
 *  left→right (not mirrored like ping-pong). */
function sampleSweep(c: AnimationConfig, o: number, tcyc: number, idleT: number): LifeOutput {
  const idle = ANIMATIONS[c.idle] ?? ANIMATIONS.none;
  const enterStart = o * c.spread;
  // Erase pass begins after every instance has fully entered, plus the hold.
  const eraseBase = c.spread + c.enterDur + c.hold;
  const exitStart = eraseBase + o * c.spread; // same forward order as the reveal

  if (tcyc < enterStart) return { hidden: true, opacity: 0 };
  if (tcyc < enterStart + c.enterDur) {
    const k = c.enterDur > 0 ? (tcyc - enterStart) / c.enterDur : 1;
    return transition(c.enter, k);
  }
  // Fully visible until this instance's erase turn.
  if (tcyc < exitStart) return idle(idleT, c.idleAmount);
  // No exit style -> hard cut (instant wipe) at the erase turn.
  if (c.exit === "none") return { hidden: true, opacity: 0 };
  if (tcyc < exitStart + c.exitDur) {
    const k = c.exitDur > 0 ? 1 - (tcyc - exitStart) / c.exitDur : 0;
    return transition(c.exit, k);
  }
  return { hidden: true, opacity: 0 };
}
