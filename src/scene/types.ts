/** Core, fully-serializable domain model.
 *  The store holds exactly this shape; everything else derives from it. */

import type { MaskParams } from "../features/noise";
import type { AnimationConfig } from "../anim/animations";
import type { ExportFrame } from "../export/frame";
export type { MaskParams };
export type { AnimationConfig };
export type { ExportFrame };

export type ToolId = "draw" | "erase" | "pan" | "path" | "block";

/** Footprint shape painted by the draw/erase brush. */
export type BrushShape = "square" | "circle";

/** How the Block tool marks cells: a click-drag rectangle, or a paint brush. */
export type BlockMode = "drag" | "brush";

/** Stencil source — what defines the paintable "opening" (lit cells). */
export type StencilType = "noise" | "stripes" | "image" | "text";

/** How an uploaded image is rendered with the selected shapes. */
export type HalftoneMode = "halftone" | "bayer" | "floyd";

export interface StencilParams {
  type: StencilType;
  /** Lock the pattern to the viewport (pans with the screen) instead of world. */
  lock: boolean;
  /** Additive: Apply only fills the opening's empty cells, keeping the rest
   *  (instead of clearing the region and repainting just the opening). */
  add: boolean;
  /** Diagonal zebra stripes: angle (deg), period (cells), lit fraction (0..1). */
  stripes: { angle: number; period: number; ratio: number };
  /** Uploaded image read as B/W. `box` is the world cell region it covers
   *  (captured on upload); the pixels live in a module cache, not in state. */
  image: {
    box: { col: number; row: number; cols: number; rows: number } | null;
    threshold: number;
    invert: boolean;
  };
  /** Text rasterized to B/W. `size` = glyph height in cells; `box` is the world
   *  region it covers (the rendered pixels live in a module cache). */
  text: {
    text: string;
    size: number;
    bold: boolean;
    box: { col: number; row: number; cols: number; rows: number } | null;
  };
}

/** Edit operation applied to the instance under the cursor (Compose → Edit). */
export type EditOp = "rotate" | "swap" | "recolor-item" | "recolor-cell" | "recolor-both";

/** Top-level UI mode (selected in the floating modes bar). */
export type Mode = "draw" | "compose" | "animate" | "export";

/** Which context menu is open, or null. */
export type ContextPanel =
  | "grid"
  | "shapes"
  | "colors"
  | "block"
  | "stencil"
  | "seamless"
  | "divider"
  | "halftone"
  | "edit"
  | "animate"
  | "export"
  | null;

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
  /** Optional cell-background color (palette index). Undefined = no fill. */
  bgIndex?: number;
  /** Cell span (width × height in cells) for multi-cell blocks. Default 1×1. */
  cw?: number;
  ch?: number;
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

/** Seamless tile region (world coords). Content inside repeats as a pattern. */
export interface TileFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** viewBox camera over the infinite plane. */
export interface Camera {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneState {
  mode: Mode;
  contextPanel: ContextPanel;
  tool: ToolId;
  cellSize: number;
  /** Show the dot grid on the canvas. */
  showGrid: boolean;
  /** Show the blocked-cells overlay (the Block tool's red zones). */
  showBlockers: boolean;
  /** Selected brush asset ids — a random one is placed per cell. The special
   *  id "random" (or an empty list) means "any shape from the library". */
  brushAssets: string[];
  /** Brush footprint multiplier: 1 = 1 cell, 2 = 2×2, 3 = 3×3, 4 = 4×4. */
  brushSize: number;
  /** Cell span of each placed SVG (1..6) — a single SVG over N×N cells. */
  brushSpan: number;
  /** Brush footprint shape. */
  brushShape: BrushShape;
  /** Round the cell-background squares (border radius). */
  cellRounded: boolean;
  /** Inset a small gutter between cell-background squares. */
  cellGutter: boolean;
  /** Fraction of the cell each placed SVG fills (1 = touches the cell edge).
   *  Applied as a global render multiplier, so it affects every instance live. */
  cellFill: number;
  /** Instances indexed by "col,row" for O(1) hit-testing. */
  instances: Record<string, Instance>;
  /** Cells where SVGs may not be placed (the Block tool), keyed "col,row". */
  blocked: Record<string, true>;
  /** Block tool mode: drag a rectangle or paint with the brush. */
  blockMode: BlockMode;
  /** Active Edit operation (Compose → Edit). */
  editOp: EditOp;
  /** When true, Recolor uses a random palette color instead of the active one. */
  editRecolorRandom: boolean;
  /** When true, Recolor paints "none" — clears the cell background and/or makes
   *  the glyph transparent (depending on the active Recolor target). */
  editRecolorNone: boolean;
  /** When true, the Block tool clears (un-blocks) cells instead of blocking. */
  blockClean: boolean;
  palettes: Palette[];
  activePaletteId: string;
  activeColorIndex: number;
  /** Selected cell-background color: a palette index, "random" to spread across
   *  the palette per cell, or null for none. */
  activeBgIndex: number | "random" | null;
  /** Maxon-style fractal noise params (one of the stencil sources). */
  mask: MaskParams;
  /** Stencil source selection + per-source params (the paintable opening). */
  stencil: StencilParams;
  /** Halftone/dither: render an uploaded image with the selected shapes. It
   *  aspect-fits live into the current view (pixels live in a module cache). */
  halftone: {
    mode: HalftoneMode;
    invert: boolean;
    /** Ink contrast around mid-gray (1 = none); shape scale (× cell). */
    contrast: number;
    scale: number;
  };
  /** Global animation settings (time-driven, sampled per frame). */
  animation: AnimationConfig;
  /** Hand-drawn path (world coords) defining the "free" reveal order. */
  orderPath: Point[];
  /** Export frame (world-space crop + output resolution). */
  frame: ExportFrame;
  /** Seamless tile region (shown in Compose while Seamless is on). */
  tileFrame: TileFrame;
  /** Divider (recursive subdivision) generator parameters. */
  divider: { density: number; seed: number };
  /** Canvas/working background color. */
  bgColor: string;
  /** When true, exports omit the background (transparent). */
  exportTransparent: boolean;
  camera: Camera;
}

export const cellKey = (col: number, row: number): string => `${col},${row}`;
