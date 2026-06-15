/** Core, fully-serializable domain model.
 *  The store holds exactly this shape; everything else derives from it. */

import type { MaskParams } from "../features/noise";
import type { AnimationConfig } from "../anim/animations";
export type { MaskParams };
export type { AnimationConfig };

export type ToolId = "draw" | "erase" | "pan" | "path";

export interface Point {
  x: number;
  y: number;
}

/** A library asset registered once in <defs> as a <symbol>. */
export interface Asset {
  id: string;
  name: string;
  /** viewBox of the symbol, e.g. "0 0 100 100". */
  viewBox: string;
  /** Inner markup of the symbol (paths/shapes), color-ready (currentColor). */
  markup: string;
  /** true for user-uploaded assets (persisted in IndexedDB). */
  user?: boolean;
}

/** A single placed instance, keyed in the scene by its cell. */
export interface Instance {
  id: string;
  assetId: string;
  /** Grid cell coordinates (integer column / row). */
  col: number;
  row: number;
  /** Index into the active palette's color array. */
  colorIndex: number;
  /** Per-instance transform (fixed at placement; reserved for animation). */
  rotation: number; // degrees
  scale: number; // 1 = fills cell
  dx: number; // fractional cell offset, -0.5..0.5
  dy: number;
  /** Stable seed so animation phase / re-rolls stay deterministic. */
  seed: number;
  /** Monotonic placement order — used by the "sequential" reveal order. */
  seq: number;
  /** Optional named animation. */
  animationId?: string;
}

export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

/** viewBox camera over the infinite plane. */
export interface Camera {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneState {
  tool: ToolId;
  cellSize: number;
  /** Active brush asset id, or "random" to pick from the library. */
  brushAsset: string;
  /** Instances indexed by "col,row" for O(1) hit-testing. */
  instances: Record<string, Instance>;
  palettes: Palette[];
  activePaletteId: string;
  activeColorIndex: number;
  /** Maxon-style fractal fill mask (white fills, black erases). */
  mask: MaskParams;
  /** When true, the renderer overlays a live preview of the mask selection. */
  maskPreview: boolean;
  /** Global animation settings (time-driven, sampled per frame). */
  animation: AnimationConfig;
  /** Hand-drawn path (world coords) defining the "free" reveal order. */
  orderPath: Point[];
  camera: Camera;
}

export const cellKey = (col: number, row: number): string => `${col},${row}`;
