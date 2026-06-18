import type { SceneState, Instance } from "../scene/types";
import { cellKey } from "../scene/types";
import { visibleCellRange } from "../scene/grid";
import type { Library } from "../features/library";
import { paletteById, colorAt } from "../features/palette";
import { stencilLit } from "../features/stencil";
import { mapCycleTime, sampleLifecycle } from "../anim/animations";
import type { AnimOutput } from "../anim/animations";
import { buildOrderField } from "../anim/order";
import { instanceGeom, cellBgRect } from "../scene/geom";
import type { Box } from "../scene/geom";
import { brushCells, brushBlocks } from "../scene/grid";
import { dividerBlocks, blockAt } from "../features/divider";
import {
  halftoneInstances,
  hasHalftoneImage,
  halftoneImageVersion,
  halftoneIsAnimated,
  halftoneLastBox,
  advanceHalftone,
} from "../features/halftone";
import { FILL_SCALE } from "../features/placement";
import { hash2, mulberry32, randInt } from "../util/rng";

const SVGNS = "http://www.w3.org/2000/svg";
const EMPTY_ANIM: AnimOutput = {};
const ORDER_COLOR = "#e03131";
/** Largest multi-cell block span (brush Size ≤ 6, divider ≤ ~9). The visible-cell
 *  scan looks back this many cells up/left to catch blocks anchored off-screen. */
const MAX_BLOCK_SPAN = 16;
/** Above this many visible cells (very zoomed out) iterate instances instead of
 *  scanning the cell range — keeps the cheaper path bounded. */
const CELL_SCAN_CAP = 6000;

/** Per-render context shared by both instance-iteration strategies. */
interface RenderCtx {
  state: SceneState;
  palette: Parameters<typeof colorAt>[0];
  range: { minCol: number; maxCol: number; minRow: number; maxRow: number };
  animate: boolean;
  orderOf: ((inst: Instance) => number) | null;
  T: number;
  tcyc: number;
  seen: Set<string>;
  /** Asset pool for the "shuffle" idle (glyphs swap over time); null when off. */
  shuffleIds: string[] | null;
}

/** The instance whose block covers cell (col,row), or null. */
function instanceCovering(
  instances: Record<string, Instance>,
  col: number,
  row: number,
): Instance | null {
  for (const k in instances) {
    const i = instances[k];
    if (col >= i.col && col < i.col + (i.cw ?? 1) && row >= i.row && row < i.row + (i.ch ?? 1)) {
      return i;
    }
  }
  return null;
}

/** Hover slots for Edit: the full block of any item under the footprint cells
 *  (so big glyphs highlight at their real size), else the bare cell. */
function editHoverSlots(
  instances: Record<string, Instance>,
  footprint: { col: number; row: number }[],
): { col: number; row: number; cw: number; ch: number }[] {
  const slots: { col: number; row: number; cw: number; ch: number }[] = [];
  const seen = new Set<string>();
  for (const c of footprint) {
    const inst = instanceCovering(instances, c.col, c.row);
    if (inst) {
      const key = `${inst.col},${inst.row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push({ col: inst.col, row: inst.row, cw: inst.cw ?? 1, ch: inst.ch ?? 1 });
    } else {
      slots.push({ col: c.col, row: c.row, cw: 1, ch: 1 });
    }
  }
  return slots;
}

// Cardinal directions, y-down: 0=R, 1=D, 2=L, 3=U.
const DIR_DX = [1, 0, -1, 0];
const DIR_DY = [0, 1, 0, -1];

/** Trace the silhouette of a set of grid cells ("col,row" keys) into SVG path
 *  data with rounded corners. Each cell side bordering a free cell is a directed
 *  boundary edge (clockwise, interior on the right). The walk turns clockwise-
 *  most at every vertex, which resolves diagonal "pinch" points cleanly (two
 *  cells touching at a corner don't merge into a stray line). Holes included.
 *  `cs` = cell size, `radius` in world units. */
function blockedRegionPath(blocked: Record<string, true>, cs: number, radius: number): string {
  const has = (c: number, r: number) => blocked[`${c},${r}`] === true;
  // out[vertexKey] = Map(dir -> targetVertexKey): the boundary edges leaving a vertex.
  const out = new Map<string, Map<number, string>>();
  const addEdge = (x: number, y: number, dir: number) => {
    const k = `${x},${y}`;
    let m = out.get(k);
    if (!m) out.set(k, (m = new Map()));
    m.set(dir, `${x + DIR_DX[dir]},${y + DIR_DY[dir]}`);
  };
  for (const key in blocked) {
    const ci = key.indexOf(",");
    const c = +key.slice(0, ci);
    const r = +key.slice(ci + 1);
    if (!has(c, r - 1)) addEdge(c, r, 0); // top:    (c,r)   → R
    if (!has(c + 1, r)) addEdge(c + 1, r, 1); // right:  (c+1,r) → D
    if (!has(c, r + 1)) addEdge(c + 1, r + 1, 2); // bottom: (c+1,r+1) → L
    if (!has(c - 1, r)) addEdge(c, r + 1, 3); // left:   (c,r+1) → U
  }

  const used = new Set<string>();
  let d = "";
  for (const [startKey, m0] of out) {
    for (const startDir of m0.keys()) {
      if (used.has(`${startKey}:${startDir}`)) continue;
      const pts: Array<[number, number]> = [];
      let vk = startKey;
      let dir = startDir;
      while (!used.has(`${vk}:${dir}`)) {
        used.add(`${vk}:${dir}`);
        const ci = vk.indexOf(",");
        pts.push([+vk.slice(0, ci), +vk.slice(ci + 1)]);
        const target = out.get(vk)!.get(dir)!;
        const tm = out.get(target);
        let nextDir = dir;
        // Priority: turn right (cw), straight, left (ccw), reverse.
        for (const cand of [(dir + 1) % 4, dir, (dir + 3) % 4, (dir + 2) % 4]) {
          if (tm && tm.has(cand)) {
            nextDir = cand;
            break;
          }
        }
        vk = target;
        dir = nextDir;
      }
      // Keep only corners (drop collinear run-vertices), in world units.
      const corners: Array<[number, number]> = [];
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const [px, py] = pts[(i - 1 + n) % n];
        const [x, y] = pts[i];
        const [nx, ny] = pts[(i + 1) % n];
        if (Math.sign(x - px) !== Math.sign(nx - x) || Math.sign(y - py) !== Math.sign(ny - y)) {
          corners.push([x * cs, y * cs]);
        }
      }
      d += roundedLoop(corners, radius);
    }
  }
  return d;
}

/** One closed sub-path through `corners` (world units) with rounded turns. */
function roundedLoop(corners: Array<[number, number]>, radius: number): string {
  const n = corners.length;
  if (n < 3) return "";
  const A: Array<[number, number]> = [];
  const B: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = corners[(i - 1 + n) % n];
    const [x, y] = corners[i];
    const [nx, ny] = corners[(i + 1) % n];
    const lin = Math.hypot(x - px, y - py) || 1;
    const lout = Math.hypot(nx - x, ny - y) || 1;
    const rr = Math.min(radius, lin / 2, lout / 2);
    A.push([x - ((x - px) / lin) * rr, y - ((y - py) / lin) * rr]);
    B.push([x + ((nx - x) / lout) * rr, y + ((ny - y) / lout) * rr]);
  }
  let d = `M${A[0][0]} ${A[0][1]}`;
  for (let i = 0; i < n; i++) {
    d += `Q${corners[i][0]} ${corners[i][1]} ${B[i][0]} ${B[i][1]}`;
    d += `L${A[(i + 1) % n][0]} ${A[(i + 1) % n][1]}`;
  }
  return d + "Z";
}

/** Translates scene state into live SVG. Source of truth stays in the store;
 *  this only reflects it, applying minimal add/remove/update diffs and
 *  virtualizing to the visible cell range so the plane can be "infinite". */
export class Renderer {
  readonly svg: SVGSVGElement;
  private defs: SVGDefsElement;
  private gridDotsGroup: SVGGElement;
  private gridDots: SVGCircleElement[] = [];
  private gridSig = "";
  private cellBgLayer: SVGGElement;
  private cellBgNodes = new Map<string, SVGRectElement>(); // cellKey -> bg <rect>
  private cellShapeSig = ""; // gutter/rounded signature — drives the glide transition
  private cellAnimTimer = 0;
  private tileLayer: SVGGElement;
  private tileGhosts: SVGGElement[] = [];
  private tileClip: SVGClipPathElement;
  private tileClipRect: SVGRectElement;
  private tileSeamLayer: SVGGElement;
  private tileSeamRects: SVGRectElement[] = [];
  private content: SVGGElement;
  private blockedShape: SVGPathElement;
  private blockedCache: { ref: Record<string, true>; cs: number; d: string } | null = null;
  private dividerPath: SVGPathElement;
  private dividerCache: { sig: string; d: string } | null = null;
  private blockRectEl: SVGRectElement;
  private hoverLayer: SVGGElement;
  private hoverCellsGroup: SVGGElement;
  private hoverRects: SVGRectElement[] = [];
  private hoverBg: SVGRectElement;
  private hoverGhost: SVGUseElement;
  private hoverPt: { cx: number; cy: number } | null = null; // fractional cell coords
  private lastState?: SceneState;
  private stencilShape!: SVGPathElement;
  private linePreview!: SVGPolylineElement;
  /** Ambient (small-screen) layer: a procedurally-filled field of pulsing glyphs. */
  private ambientLayer!: SVGGElement;
  private ambientNodes: SVGUseElement[] = [];
  private ambientCache = new Map<string, { assetId: string; colorIdx: number; phase: number; period: number }>();
  private htPreviewLayer!: SVGGElement;
  private htPreviewBg!: SVGGElement;
  private htPreviewFg!: SVGGElement;
  private htPreviewNodes: SVGUseElement[] = [];
  private htPreviewBgNodes: SVGRectElement[] = [];
  /** Signature of the inputs the halftone preview depends on — skip the (heavy)
   *  recompute when nothing relevant changed since the last frame. */
  private htPreviewSig = "";
  /** Reused box for instanceGeom in the hot render loops (avoids per-cell alloc).
   *  Safe to share: each call fully consumes it before the next. */
  private scratchBox: Box = { x: 0, y: 0, size: 0, cx: 0, cy: 0, rot: 0, opacity: 1 };
  private pathLayer: SVGGElement;
  private pathLine: SVGPolylineElement;
  private pathStart: SVGTextElement;
  private pathFinish: SVGTextElement;
  private pathDotStart: SVGCircleElement;
  private pathDotFinish: SVGCircleElement;
  private frameLayer: SVGGElement;
  private frameRects: SVGRectElement[] = [];
  private nodes = new Map<string, SVGUseElement>(); // cellKey -> <use>
  private registeredSymbols = new Set<string>();
  /** Global cell-fill multiplier for this render pass (state.cellFill / FILL_SCALE). */
  private fillMul = 1;

  constructor(
    private host: HTMLElement,
    private library: Library,
  ) {
    this.svg = document.createElementNS(SVGNS, "svg");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", "100%");
    this.svg.style.display = "block";
    this.svg.style.touchAction = "none";

    this.defs = document.createElementNS(SVGNS, "defs");

    // Dot-grid background: a <pattern> of a single dot tiled in world space, so
    // the dots align to cell corners and pan/zoom with the content.
    // Grid dots: real <circle> elements at each visible cell corner (pooled).
    // Exact positioning, no pattern-tiling seam (which drifted ~1px).
    this.gridDotsGroup = document.createElementNS(SVGNS, "g");
    this.gridDotsGroup.setAttribute("class", "grid-dots-layer");
    this.gridDotsGroup.style.pointerEvents = "none";

    // Per-cell colored background squares, drawn behind the artwork.
    this.cellBgLayer = document.createElementNS(SVGNS, "g");
    this.cellBgLayer.setAttribute("class", "cell-bg");

    this.content = document.createElementNS(SVGNS, "g");
    this.content.setAttribute("class", "content");
    this.content.setAttribute("id", "scene-content");

    // Seamless tile preview: ghost copies of the tile's content repeated in the
    // 8 neighbor positions, each clipped to the tile so only what's INSIDE the
    // frame repeats. Lets the user nudge elements until the pattern is seamless.
    this.tileClip = document.createElementNS(SVGNS, "clipPath");
    this.tileClip.setAttribute("id", "tile-clip");
    this.tileClip.setAttribute("clipPathUnits", "userSpaceOnUse");
    this.tileClipRect = document.createElementNS(SVGNS, "rect");
    this.tileClip.appendChild(this.tileClipRect);
    this.defs.appendChild(this.tileClip);

    this.tileLayer = document.createElementNS(SVGNS, "g");
    this.tileLayer.setAttribute("class", "tile-preview");
    this.tileLayer.style.pointerEvents = "none";
    this.tileLayer.style.display = "none";
    for (let i = 0; i < 8; i++) {
      const outer = document.createElementNS(SVGNS, "g");
      outer.setAttribute("opacity", "0.4");
      const clipped = document.createElementNS(SVGNS, "g");
      clipped.setAttribute("clip-path", "url(#tile-clip)");
      const use = document.createElementNS(SVGNS, "use");
      use.setAttribute("href", "#scene-content");
      clipped.appendChild(use);
      outer.appendChild(clipped);
      this.tileGhosts.push(outer);
      this.tileLayer.appendChild(outer);
    }

    // Seam highlight: rings around the instances sitting on the tile edges
    // (drawn above the content so they read clearly).
    this.tileSeamLayer = document.createElementNS(SVGNS, "g");
    this.tileSeamLayer.setAttribute("class", "tile-seam-layer");
    this.tileSeamLayer.style.pointerEvents = "none";

    // Hover overlay: a highlight on the cell under the cursor + a faint ghost
    // of the brush asset.
    // Blocked-cell overlay (reddish fill + dashed red border) + the drag rect.
    // A single filled, dotted-outline path tracing the blocked region's
    // rounded silhouette (computed from the cell set).
    this.blockedShape = document.createElementNS(SVGNS, "path");
    this.blockedShape.setAttribute("class", "blocked-shape");
    this.blockedShape.style.pointerEvents = "none";
    // Divider preview: the recursive subdivision lines.
    this.dividerPath = document.createElementNS(SVGNS, "path");
    this.dividerPath.setAttribute("class", "divider-lines");
    this.dividerPath.style.pointerEvents = "none";
    this.dividerPath.style.display = "none";
    this.blockRectEl = document.createElementNS(SVGNS, "rect");
    this.blockRectEl.setAttribute("class", "block-drag-rect");
    this.blockRectEl.style.pointerEvents = "none";
    this.blockRectEl.style.display = "none";

    this.hoverLayer = document.createElementNS(SVGNS, "g");
    this.hoverLayer.setAttribute("class", "hover-overlay");
    this.hoverLayer.style.pointerEvents = "none";
    // Footprint highlights (one rect per brush cell), then the bg + asset ghost.
    this.hoverCellsGroup = document.createElementNS(SVGNS, "g");
    this.hoverCellsGroup.setAttribute("class", "hover-cells");
    this.hoverBg = document.createElementNS(SVGNS, "rect");
    this.hoverBg.setAttribute("class", "hover-bg");
    this.hoverBg.setAttribute("opacity", "0.5");
    this.hoverGhost = document.createElementNS(SVGNS, "use");
    this.hoverGhost.setAttribute("class", "hover-ghost");
    this.hoverGhost.setAttribute("opacity", "0.4");
    this.hoverLayer.append(this.hoverCellsGroup, this.hoverBg, this.hoverGhost);

    // Faint ghost preview of the halftone result (while the panel is open).
    this.htPreviewLayer = document.createElementNS(SVGNS, "g");
    this.htPreviewLayer.setAttribute("class", "halftone-preview");
    this.htPreviewLayer.style.pointerEvents = "none";
    this.htPreviewLayer.style.display = "none";
    // Cell backgrounds behind the glyphs (document order = paint order).
    this.htPreviewBg = document.createElementNS(SVGNS, "g");
    this.htPreviewFg = document.createElementNS(SVGNS, "g");
    this.htPreviewLayer.append(this.htPreviewBg, this.htPreviewFg);

    // Green stencil silhouette (rounded + dotted, like the Block overlay).
    this.stencilShape = document.createElementNS(SVGNS, "path");
    this.stencilShape.setAttribute("class", "stencil-shape");
    this.stencilShape.style.pointerEvents = "none";
    this.stencilShape.style.display = "none";

    // Line-tool preview: the freehand stroke being drawn (filled with glyphs on
    // release). A dashed polyline in world space.
    this.linePreview = document.createElementNS(SVGNS, "polyline");
    this.linePreview.setAttribute("class", "line-preview");
    this.linePreview.style.pointerEvents = "none";
    this.linePreview.style.display = "none";

    // Ambient field (small-screen screensaver).
    this.ambientLayer = document.createElementNS(SVGNS, "g");
    this.ambientLayer.setAttribute("class", "ambient-field");
    this.ambientLayer.style.pointerEvents = "none";
    this.ambientLayer.style.display = "none";

    // Order-path overlay: the drawn reveal line with START / FINISH labels.
    this.pathLayer = document.createElementNS(SVGNS, "g");
    this.pathLayer.setAttribute("class", "order-path");
    this.pathLayer.style.pointerEvents = "none";
    this.pathLine = document.createElementNS(SVGNS, "polyline");
    this.pathDotStart = this.makeDot();
    this.pathDotFinish = this.makeDot();
    this.pathStart = this.makeLabel("START");
    this.pathFinish = this.makeLabel("FINISH");
    this.pathLayer.append(
      this.pathLine,
      this.pathDotStart,
      this.pathDotFinish,
      this.pathStart,
      this.pathFinish,
    );

    // Export-frame overlay: 4 dark rects (letterbox) + a border on the frame.
    this.frameLayer = document.createElementNS(SVGNS, "g");
    this.frameLayer.setAttribute("class", "export-frame");
    this.frameLayer.style.pointerEvents = "none";
    for (let i = 0; i < 4; i++) {
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("fill", "#000");
      rect.setAttribute("fill-opacity", "0.55");
      this.frameRects.push(rect);
      this.frameLayer.appendChild(rect);
    }

    this.svg.append(
      this.defs,
      this.gridDotsGroup,
      this.cellBgLayer,
      this.tileLayer,
      this.content,
      this.dividerPath,
      this.tileSeamLayer,
      this.blockedShape,
      this.blockRectEl,
      this.hoverLayer,
      this.htPreviewLayer,
      this.stencilShape,
      this.linePreview,
      this.ambientLayer,
      this.pathLayer,
      this.frameLayer,
    );
    this.host.appendChild(this.svg);
  }

  get hostSize() {
    return { width: this.host.clientWidth, height: this.host.clientHeight };
  }

  /** Register an asset as a <symbol> once; instanced via <use href="#sym-…">. */
  private ensureSymbol(assetId: string): void {
    if (this.registeredSymbols.has(assetId)) return;
    const asset = this.library.get(assetId);
    if (!asset) return;
    const sym = document.createElementNS(SVGNS, "symbol");
    sym.setAttribute("id", `sym-${assetId}`);
    sym.setAttribute("viewBox", asset.viewBox);
    sym.setAttribute("overflow", "visible");
    sym.innerHTML = asset.markup;
    this.defs.appendChild(sym);
    this.registeredSymbols.add(assetId);
  }

  render(state: SceneState, time = 0): void {
    this.lastState = state;
    this.fillMul = state.cellFill / FILL_SCALE;
    // Global Play drives an animated Halftone source (video/GIF) on the canvas.
    if (state.animation.playing && halftoneIsAnimated()) advanceHalftone(time);
    const cam = state.camera;
    this.svg.setAttribute("viewBox", `${cam.x} ${cam.y} ${cam.w} ${cam.h}`);

    // Ambient mode replaces the scene with a self-contained field of pulsing
    // glyphs — hide the normal scene layers and render only that.
    const ambient = state.ambient;
    this.gridDotsGroup.style.display = ambient ? "none" : "";
    this.cellBgLayer.style.display = ambient ? "none" : "";
    this.content.style.display = ambient ? "none" : "";
    if (ambient) {
      this.renderAmbient(state, time);
      return;
    }
    this.ambientLayer.style.display = "none";

    this.glideCellShape(state);
    this.renderGrid(state);
    this.renderTilePreview(state);
    this.renderInstances(state, time);
    this.renderDivider(state);
    this.renderBlocked(state);
    this.renderHover();
    this.renderMask(state);
    this.renderHalftonePreview(state);
    this.renderOrderPath(state);
    this.renderFrame(state);
  }

  /** Smooth fade in → hold → fade out → hidden over one normalized cycle. */
  private static ambientPulse(t: number): number {
    const ease = (x: number) => x * x * (3 - 2 * x);
    if (t < 0.15) return ease(t / 0.15);
    if (t < 0.55) return 1;
    if (t < 0.7) return ease((0.7 - t) / 0.15);
    return 0;
  }

  /** Procedural field for ambient mode: each visible cell may hold a random glyph
   *  (seeded, so it's stable) that fades in/out on its own random cycle. */
  private renderAmbient(state: SceneState, time: number): void {
    this.ambientLayer.style.display = "";
    const cs = state.cellSize;
    const cam = state.camera;
    const r = visibleCellRange(cam, cs, 1);
    const palette = paletteById(state.palettes, state.activePaletteId);
    const ids = this.library.ids();
    if (!ids.length || !palette.colors.length) return;
    // Clear gap around the centered message — no glyphs behind the text.
    const ccx = cam.x + cam.w / 2;
    const ccy = cam.y + cam.h / 2;
    const clearHalfW = cam.w * 0.46;
    const clearHalfH = Math.max(cs * 1.5, cam.h * 0.12);
    let i = 0;
    for (let row = r.minRow; row <= r.maxRow; row++) {
      for (let col = r.minCol; col <= r.maxCol; col++) {
        const cellCx = (col + 0.5) * cs;
        const cellCy = (row + 0.5) * cs;
        if (Math.abs(cellCx - ccx) < clearHalfW && Math.abs(cellCy - ccy) < clearHalfH) continue;
        const key = `${col},${row}`;
        let c = this.ambientCache.get(key);
        if (!c) {
          const rng = mulberry32(hash2(col, row, 1337));
          if (rng() < 0.4) {
            this.ambientCache.set(key, (c = { assetId: "", colorIdx: 0, phase: 0, period: 0 })); // empty cell
          } else {
            c = {
              assetId: ids[randInt(rng, 0, ids.length - 1)],
              colorIdx: randInt(rng, 0, palette.colors.length - 1),
              phase: rng(),
              period: 2.5 + rng() * 4.5,
            };
            this.ambientCache.set(key, c);
          }
        }
        if (!c.assetId) continue; // empty cell
        const op = Renderer.ambientPulse((time / c.period + c.phase) % 1);
        if (op <= 0.01) continue;
        this.ensureSymbol(c.assetId);
        let node = this.ambientNodes[i];
        if (!node) {
          node = document.createElementNS(SVGNS, "use");
          this.ambientLayer.appendChild(node);
          this.ambientNodes[i] = node;
        }
        const size = cs * FILL_SCALE;
        const off = (cs - size) / 2;
        node.setAttribute("href", `#sym-${c.assetId}`);
        node.setAttribute("x", String(col * cs + off));
        node.setAttribute("y", String(row * cs + off));
        node.setAttribute("width", String(size));
        node.setAttribute("height", String(size));
        node.style.color = colorAt(palette, c.colorIdx);
        node.setAttribute("opacity", op.toFixed(3));
        node.style.display = "";
        i++;
      }
    }
    for (; i < this.ambientNodes.length; i++) this.ambientNodes[i].style.display = "none";
  }

  /** Ghost preview of the halftone result — shown in its panel, or anywhere while
   *  an animated source is playing (driven by global Play). */
  private renderHalftonePreview(state: SceneState): void {
    const live =
      state.contextPanel === "halftone" || (state.animation.playing && halftoneIsAnimated());
    if (!live || !hasHalftoneImage()) {
      this.htPreviewLayer.style.display = "none";
      this.htPreviewSig = "";
      return;
    }
    this.htPreviewLayer.style.display = "";
    const cs = state.cellSize;
    const palette = paletteById(state.palettes, state.activePaletteId);
    // The preview recompute (luminance sampling + diffusion + per-cell instances)
    // is heavy; skip it when none of its inputs changed since the last frame.
    const cam = state.camera;
    const sig = [
      halftoneImageVersion(),
      JSON.stringify(state.halftone),
      cs,
      this.fillMul,
      `${cam.x},${cam.y},${cam.w},${cam.h}`,
      state.brushAssets.join(","),
      state.mask.seed,
      state.activePaletteId,
      palette.colors.join(","),
      Object.keys(state.blocked).length,
    ].join("|");
    if (sig === this.htPreviewSig) return;
    this.htPreviewSig = sig;

    // While playing, anchor to the established box (the area you set up / applied)
    // so zoom/pan move over it instead of re-fitting the halftone to the window.
    // While setting up (not playing), fit to view live (and refresh that box).
    const box = state.animation.playing ? halftoneLastBox() ?? undefined : undefined;
    const places = halftoneInstances(state, this.library, box).places;
    let i = 0; // glyph node cursor
    let b = 0; // bg node cursor
    for (const inst of places) {
      // Cell background (palette color), behind the glyph.
      if (inst.bgIndex != null) {
        let rect = this.htPreviewBgNodes[b];
        if (!rect) {
          rect = document.createElementNS(SVGNS, "rect");
          this.htPreviewBg.appendChild(rect);
          this.htPreviewBgNodes[b] = rect;
        }
        const box = cellBgRect(inst.col, inst.row, cs, state.cellRounded, state.cellGutter, inst.cw ?? 1, inst.ch ?? 1);
        rect.setAttribute("x", String(box.x));
        rect.setAttribute("y", String(box.y));
        rect.setAttribute("width", String(box.w));
        rect.setAttribute("height", String(box.h));
        rect.setAttribute("rx", String(box.rx || 0));
        rect.setAttribute("fill", colorAt(palette, inst.bgIndex));
        rect.style.display = "";
        b++;
      }
      // Glyph (skip when hidden — e.g. the cell-only target).
      const color = inst.color ?? colorAt(palette, inst.colorIndex);
      if (color !== "transparent") {
        this.ensureSymbol(inst.assetId);
        let node = this.htPreviewNodes[i];
        if (!node) {
          node = document.createElementNS(SVGNS, "use");
          this.htPreviewFg.appendChild(node);
          this.htPreviewNodes[i] = node;
        }
        const g = instanceGeom(inst, cs, EMPTY_ANIM, this.fillMul, this.scratchBox);
        node.setAttribute("href", `#sym-${inst.assetId}`);
        node.setAttribute("x", String(g.x));
        node.setAttribute("y", String(g.y));
        node.setAttribute("width", String(g.size));
        node.setAttribute("height", String(g.size));
        node.style.color = color;
        node.style.display = "";
        i++;
      }
    }
    for (; b < this.htPreviewBgNodes.length; b++) this.htPreviewBgNodes[b].style.display = "none";
    for (; i < this.htPreviewNodes.length; i++) this.htPreviewNodes[i].style.display = "none";
  }

  /** Set the cursor position in fractional cell coords (or null). Updates only
   *  the hover overlay. */
  setHover(cx: number | null, cy = 0): void {
    this.hoverPt = cx === null ? null : { cx, cy };
    this.renderHover();
  }

  /** Highlight the cells the brush would paint + a faint ghost of the asset. */
  private renderHover(): void {
    const state = this.lastState;
    const pt = this.hoverPt;
    const isBlockBrush = !!state && state.tool === "block" && state.blockMode === "brush";
    const isEdit = !!state && state.contextPanel === "edit";
    const isDivider = !!state && state.contextPanel === "divider";
    const isLine = !!state && state.tool === "line";
    const placing =
      state && (state.tool === "draw" || state.tool === "erase" || isBlockBrush || isEdit || isLine);
    if (!state || !pt || !placing) {
      // Fade out in place (kept in the DOM at its last spot; opacity → 0).
      this.hoverLayer.classList.remove("visible");
      return;
    }
    this.hoverLayer.classList.add("visible");
    // Block-brush footprint reads red (no-go zone); Clean reads neutral.
    this.hoverCellsGroup.classList.toggle("block", isBlockBrush && !state.blockClean);
    const cs = state.cellSize;
    const erase = state.tool === "erase";
    const px = state.camera.w / this.hostSize.width; // world units per screen px
    // Anchor cell (under the cursor) for the single-cell bg/ghost previews.
    const anchor = { col: Math.floor(pt.cx), row: Math.floor(pt.cy) };

    // Highlight what the brush would touch. Draw shows the span-block footprint
    // (Brush × Size); Edit wraps the full item under the cursor (so a 2×2+ glyph
    // highlights at its real size); erase/block show the plain footprint cells.
    const span = Math.max(1, Math.round(state.brushSpan ?? 1));
    const drawing = !erase && !isBlockBrush && !isEdit && !isDivider && !isLine;
    const off = Math.floor((span - 1) / 2);
    const bcol = anchor.col - off;
    const brow = anchor.row - off;
    // ~3px gap, but never more than 40% of a cell — otherwise (very zoomed out,
    // where 1px is many world units) the rect width cs - inset*2 goes negative.
    const inset = Math.min(3 * px, cs * 0.4);
    let slots: { col: number; row: number; cw: number; ch: number }[];
    if (isDivider) {
      // Snap the highlight to the subdivision block under the cursor.
      const b = blockAt(dividerBlocks(state), anchor.col, anchor.row);
      slots = b ? [{ col: b.col, row: b.row, cw: b.cw, ch: b.ch }] : [];
    } else if (isEdit) {
      slots = editHoverSlots(
        state.instances,
        brushCells(pt.cx, pt.cy, state.brushSize, state.brushShape),
      );
    } else if (isLine) {
      // The Line tool's circular ribbon footprint, span-aware (Size).
      slots = brushBlocks(pt.cx, pt.cy, state.brushSize, "circle", span).map((b) => ({
        col: b.col,
        row: b.row,
        cw: span,
        ch: span,
      }));
    } else if (drawing) {
      slots = brushBlocks(pt.cx, pt.cy, state.brushSize, state.brushShape, span).map((b) => ({
        col: b.col,
        row: b.row,
        cw: span,
        ch: span,
      }));
    } else {
      slots = brushCells(pt.cx, pt.cy, state.brushSize, state.brushShape).map((c) => ({
        col: c.col,
        row: c.row,
        cw: 1,
        ch: 1,
      }));
    }
    slots.forEach((c, i) => {
      const r = this.hoverRectAt(i);
      r.setAttribute("x", String(c.col * cs + inset));
      r.setAttribute("y", String(c.row * cs + inset));
      r.setAttribute("width", String(c.cw * cs - inset * 2));
      r.setAttribute("height", String(c.ch * cs - inset * 2));
      r.setAttribute("rx", String(10 * px));
      r.style.display = "";
    });
    for (let i = slots.length; i < this.hoverRects.length; i++) {
      this.hoverRects[i].style.display = "none";
    }

    // bg + asset ghost preview (only for a single footprint cell), sized to span.
    const showPreview = state.brushSize <= 1 && !erase && !isBlockBrush && !isEdit && !isDivider;
    const palette = paletteById(state.palettes, state.activePaletteId);
    if (showPreview && state.activeBgIndex != null) {
      const bgIdx = state.activeBgIndex === "random" ? 0 : state.activeBgIndex;
      this.hoverBg.setAttribute("x", String(bcol * cs));
      this.hoverBg.setAttribute("y", String(brow * cs));
      this.hoverBg.setAttribute("width", String(span * cs));
      this.hoverBg.setAttribute("height", String(span * cs));
      this.hoverBg.setAttribute("fill", colorAt(palette, bgIdx));
      this.hoverBg.style.display = "";
    } else {
      this.hoverBg.style.display = "none";
    }

    // Ghost only when a single concrete shape is selected (a random pool can't
    // be previewed).
    const picks = state.brushAssets.filter((id) => id !== "random");
    const assetId = picks.length === 1 ? picks[0] : "";
    if (showPreview && assetId && this.library.get(assetId)) {
      this.ensureSymbol(assetId);
      const size = span * cs * 0.85;
      const x = (bcol + span / 2) * cs - size / 2;
      const y = (brow + span / 2) * cs - size / 2;
      this.hoverGhost.setAttribute("href", `#sym-${assetId}`);
      this.hoverGhost.setAttribute("x", String(x));
      this.hoverGhost.setAttribute("y", String(y));
      this.hoverGhost.setAttribute("width", String(size));
      this.hoverGhost.setAttribute("height", String(size));
      this.hoverGhost.style.color = colorAt(palette, state.activeColorIndex);
      this.hoverGhost.style.display = "";
    } else {
      this.hoverGhost.style.display = "none";
    }
  }

  /** Fill the blocked region + trace its rounded, dotted silhouette. The traced
   *  path is cached against the (immutable) blocked set so playback is cheap. */
  private renderBlocked(state: SceneState): void {
    const { cellSize: cs, blocked } = state;
    if (!state.showBlockers) {
      this.blockedShape.style.display = "none";
      return;
    }
    const px = state.camera.w / this.hostSize.width;
    if (!this.blockedCache || this.blockedCache.ref !== blocked || this.blockedCache.cs !== cs) {
      this.blockedCache = { ref: blocked, cs, d: blockedRegionPath(blocked, cs, cs * 0.3) };
    }
    const d = this.blockedCache.d;
    if (d) {
      this.blockedShape.setAttribute("d", d);
      this.blockedShape.setAttribute("stroke-width", String(2.2 * px));
      this.blockedShape.setAttribute("stroke-dasharray", `0 ${6 * px}`); // round dots
      this.blockedShape.style.display = "";
    } else {
      this.blockedShape.style.display = "none";
    }
  }

  /** Show/hide the Block-tool rubber-band rectangle (world coords). */
  setBlockRect(a: { x: number; y: number } | null, b?: { x: number; y: number }): void {
    if (!a || !b) {
      this.blockRectEl.style.display = "none";
      return;
    }
    const px = this.lastState ? this.lastState.camera.w / this.hostSize.width : 1;
    this.blockRectEl.setAttribute("x", String(Math.min(a.x, b.x)));
    this.blockRectEl.setAttribute("y", String(Math.min(a.y, b.y)));
    this.blockRectEl.setAttribute("width", String(Math.abs(b.x - a.x)));
    this.blockRectEl.setAttribute("height", String(Math.abs(b.y - a.y)));
    this.blockRectEl.setAttribute("stroke-width", String(2.2 * px));
    this.blockRectEl.setAttribute("stroke-dasharray", `0 ${6 * px}`); // round dots
    this.blockRectEl.style.display = "";
  }

  /** Show/hide the Line tool's freehand preview stroke (world-space points). */
  setLinePreview(pts: { x: number; y: number }[] | null): void {
    if (!pts || pts.length < 1) {
      this.linePreview.style.display = "none";
      return;
    }
    const px = this.lastState ? this.lastState.camera.w / this.hostSize.width : 1;
    this.linePreview.setAttribute("points", pts.map((p) => `${p.x},${p.y}`).join(" "));
    this.linePreview.setAttribute("stroke-width", String(2.5 * px));
    this.linePreview.setAttribute("stroke-dasharray", `${8 * px} ${6 * px}`);
    this.linePreview.style.display = "";
  }

  /** Lazily grow the pool of footprint-highlight rects. */
  private hoverRectAt(i: number): SVGRectElement {
    let rect = this.hoverRects[i];
    if (!rect) {
      rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("class", "hover-cell");
      this.hoverCellsGroup.appendChild(rect);
      this.hoverRects[i] = rect;
    }
    return rect;
  }

  /** Letterbox overlay: darken everything outside the export frame + outline it. */
  private renderFrame(state: SceneState): void {
    const f = state.frame;
    if (!f.show) {
      this.frameLayer.style.display = "none";
      return;
    }
    this.frameLayer.style.display = "";
    const cam = state.camera;
    const set = (rect: SVGRectElement, x: number, y: number, w: number, h: number) => {
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(Math.max(0, w)));
      rect.setAttribute("height", String(Math.max(0, h)));
    };
    // top, bottom, left, right bands around the frame, clipped to the viewport.
    set(this.frameRects[0], cam.x, cam.y, cam.w, f.y - cam.y);
    set(this.frameRects[1], cam.x, f.y + f.h, cam.w, cam.y + cam.h - (f.y + f.h));
    set(this.frameRects[2], cam.x, f.y, f.x - cam.x, f.h);
    set(this.frameRects[3], f.x + f.w, f.y, cam.x + cam.w - (f.x + f.w), f.h);
  }

  private makeLabel(text: string): SVGTextElement {
    const t = document.createElementNS(SVGNS, "text");
    t.textContent = text;
    t.setAttribute("fill", ORDER_COLOR);
    t.setAttribute("font-weight", "600");
    t.setAttribute("font-family", "system-ui, sans-serif");
    t.setAttribute("text-anchor", "middle");
    return t;
  }

  private makeDot(): SVGCircleElement {
    const c = document.createElementNS(SVGNS, "circle");
    c.setAttribute("fill", ORDER_COLOR);
    return c;
  }

  /** Draw the hand-drawn reveal path (world coords) with START/FINISH labels. */
  private renderOrderPath(state: SceneState): void {
    const path = state.orderPath;
    const relevant = state.tool === "path" || state.animation.order === "free";
    if (path.length < 2 || !relevant) {
      this.pathLayer.style.display = "none";
      this.pathLine.setAttribute("points", "");
      return;
    }
    this.pathLayer.style.display = "";
    const cam = state.camera;
    const px = 1 / (this.hostSize.width / cam.w); // world units per device px
    this.pathLine.setAttribute("points", path.map((p) => `${p.x},${p.y}`).join(" "));
    this.pathLine.setAttribute("fill", "none");
    this.pathLine.setAttribute("stroke", ORDER_COLOR);
    this.pathLine.setAttribute("stroke-width", String(2.5 * px));
    this.pathLine.setAttribute("stroke-linejoin", "round");
    this.pathLine.setAttribute("stroke-linecap", "round");
    this.pathLine.removeAttribute("stroke-dasharray"); // solid line

    const start = path[0];
    const finish = path[path.length - 1];
    const dotR = 4.5 * px;
    const dot = (c: SVGCircleElement, p: { x: number; y: number }) => {
      c.setAttribute("cx", String(p.x));
      c.setAttribute("cy", String(p.y));
      c.setAttribute("r", String(dotR));
    };
    dot(this.pathDotStart, start);
    dot(this.pathDotFinish, finish);

    const fs = 14 * px; // ~14 screen px regardless of zoom
    const place = (el: SVGTextElement, p: { x: number; y: number }) => {
      el.setAttribute("x", String(p.x));
      el.setAttribute("y", String(p.y - dotR - 5 * px));
      el.setAttribute("font-size", String(fs));
    };
    place(this.pathStart, start);
    place(this.pathFinish, finish);
  }

  /** Live mask preview: shade visible cells by the fractal field (grayscale)
   *  and outline the stencil opening (lit cells, green) — where Apply paints.
   *  Cells outside the opening are masked off (cleared on Apply). */
  private renderMask(state: SceneState): void {
    // The stencil opening (lit cells), traced like the Block overlay — rounded +
    // dotted, in green. Shown only while the Stencil context is open.
    if (state.contextPanel !== "stencil") {
      this.stencilShape.style.display = "none";
      return;
    }
    const { camera: cam, cellSize } = state;
    const litFn = stencilLit(state);
    const r = visibleCellRange(cam, cellSize, 0);
    const lit: Record<string, true> = {};
    for (let row = r.minRow; row <= r.maxRow; row++) {
      for (let col = r.minCol; col <= r.maxCol; col++) {
        if (litFn(col, row)) lit[`${col},${row}`] = true;
      }
    }
    const px = cam.w / this.hostSize.width;
    const d = blockedRegionPath(lit, cellSize, cellSize * 0.3);
    if (d) {
      this.stencilShape.setAttribute("d", d);
      this.stencilShape.setAttribute("stroke-width", String(2.2 * px));
      this.stencilShape.setAttribute("stroke-dasharray", `0 ${6 * px}`); // round dots
      this.stencilShape.style.display = "";
    } else {
      this.stencilShape.style.display = "none";
    }
  }

  /** Repeat the tile's content in the 8 neighbor positions + ring the cells on
   *  the tile's edges (the seam). Shown while the Seamless panel is open. */
  private renderTilePreview(state: SceneState): void {
    if (state.contextPanel !== "seamless") {
      this.tileLayer.style.display = "none";
      this.tileSeamLayer.style.display = "none";
      return;
    }
    this.tileLayer.style.display = "";
    this.tileSeamLayer.style.display = "";
    const t = state.tileFrame;
    this.tileClipRect.setAttribute("x", String(t.x));
    this.tileClipRect.setAttribute("y", String(t.y));
    this.tileClipRect.setAttribute("width", String(t.w));
    this.tileClipRect.setAttribute("height", String(t.h));
    // 8 neighbor offsets (skip 0,0 — that's the real content).
    const offsets = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ];
    offsets.forEach(([ox, oy], i) => {
      this.tileGhosts[i].setAttribute("transform", `translate(${ox * t.w} ${oy * t.h})`);
    });

    // Ring the instances sitting on the tile's edge rows/cols — these touch the
    // seam and must continue on the opposite edge for a clean tile.
    const cs = state.cellSize;
    const c0 = Math.round(t.x / cs);
    const r0 = Math.round(t.y / cs);
    const cols = Math.max(1, Math.round(t.w / cs));
    const rows = Math.max(1, Math.round(t.h / cs));
    const px = state.camera.w / this.hostSize.width;
    let si = 0;
    for (const inst of Object.values(state.instances)) {
      const lc = inst.col - c0;
      const lr = inst.row - r0;
      if (lc < 0 || lc >= cols || lr < 0 || lr >= rows) continue;
      if (lc !== 0 && lc !== cols - 1 && lr !== 0 && lr !== rows - 1) continue;
      const rect = this.tileSeamRectAt(si++);
      rect.setAttribute("x", String(inst.col * cs));
      rect.setAttribute("y", String(inst.row * cs));
      rect.setAttribute("width", String(cs));
      rect.setAttribute("height", String(cs));
      rect.setAttribute("rx", String(4 * px));
      rect.setAttribute("stroke-width", String(2 * px));
      rect.style.display = "";
    }
    for (; si < this.tileSeamRects.length; si++) this.tileSeamRects[si].style.display = "none";
  }

  private tileSeamRectAt(i: number): SVGRectElement {
    let rect = this.tileSeamRects[i];
    if (!rect) {
      rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("class", "tile-seam");
      rect.setAttribute("fill", "none");
      this.tileSeamLayer.appendChild(rect);
      this.tileSeamRects[i] = rect;
    }
    return rect;
  }

  /** Preview the recursive subdivision lines (while the Divider panel is open). */
  private renderDivider(state: SceneState): void {
    if (state.contextPanel !== "divider") {
      this.dividerPath.style.display = "none";
      return;
    }
    const cs = state.cellSize;
    const r = visibleCellRange(state.camera, cs, 0);
    const minCol = r.minCol;
    const minRow = r.minRow;
    const cols = Math.min(80, r.maxCol - r.minCol + 1);
    const rows = Math.min(80, r.maxRow - r.minRow + 1);
    const sig = `${minCol},${minRow},${cols},${rows},${state.divider.density},${state.divider.seed}`;
    if (this.dividerCache?.sig !== sig) {
      let d = "";
      for (const b of dividerBlocks(state)) {
        const x = b.col * cs;
        const y = b.row * cs;
        d += `M${x} ${y}h${b.cw * cs}v${b.ch * cs}h${-b.cw * cs}Z`;
      }
      this.dividerCache = { sig, d };
    }
    this.dividerPath.setAttribute("d", this.dividerCache.d);
    this.dividerPath.setAttribute("stroke-width", String(state.camera.w / this.hostSize.width));
    this.dividerPath.style.display = "";
  }

  private renderGrid(state: SceneState): void {
    const { camera: cam, cellSize: cs } = state;
    const zoom = this.hostSize.width / cam.w;
    // Visible corners (one extra each side). Cap the count so a far zoom-out
    // doesn't spawn tens of thousands of nodes.
    const c0 = Math.floor(cam.x / cs);
    const c1 = Math.ceil((cam.x + cam.w) / cs);
    const r0 = Math.floor(cam.y / cs);
    const r1 = Math.ceil((cam.y + cam.h) / cs);
    const count = (c1 - c0 + 1) * (r1 - r0 + 1);
    if (!state.showGrid || cs * zoom < 6 || count > 6000) {
      this.gridDotsGroup.style.display = "none";
      this.gridSig = ""; // force a rebuild next time it shows
      return;
    }
    this.gridDotsGroup.style.display = "";
    const px = cam.w / this.hostSize.width; // world units per device px
    const sig = `${c0},${c1},${r0},${r1},${cs},${px.toFixed(4)}`;
    if (sig === this.gridSig) return;
    this.gridSig = sig;
    const rad = 1.2 * px; // ~1.2 device px, exactly at each cell corner
    let i = 0;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const dot = this.gridDotAt(i++);
        dot.setAttribute("cx", String(col * cs));
        dot.setAttribute("cy", String(row * cs));
        dot.setAttribute("r", String(rad));
        dot.style.display = "";
      }
    }
    for (; i < this.gridDots.length; i++) this.gridDots[i].style.display = "none";
  }

  private gridDotAt(i: number): SVGCircleElement {
    let dot = this.gridDots[i];
    if (!dot) {
      dot = document.createElementNS(SVGNS, "circle");
      dot.setAttribute("class", "grid-dot");
      this.gridDotsGroup.appendChild(dot);
      this.gridDots[i] = dot;
    }
    return dot;
  }

  private renderInstances(state: SceneState, time: number): void {
    const { camera: cam, cellSize, instances, animation: anim } = state;
    const palette = paletteById(state.palettes, state.activePaletteId);
    const r = visibleCellRange(cam, cellSize, 1);
    const seen = new Set<string>();

    // Lifecycle animation only runs while playing; paused = static scene. An
    // animated Halftone source takes priority on Play, so the scene stays static.
    const animate = anim.playing && !halftoneIsAnimated();
    const orderOf = animate ? buildOrderField(state) : null;
    const T = time * anim.speed;
    const tcyc = animate ? mapCycleTime(anim, T) : 0;
    // Shuffle idle: pre-fetch the asset pool once per frame (not per instance).
    const shuffleIds = animate && anim.idle === "shuffle" ? this.library.ids() : null;
    const ctx: RenderCtx = { state, palette, range: r, animate, orderOf, T, tcyc, seen, shuffleIds };

    // Incremental: scan the visible cell range (+ a back-margin for multi-cell
    // blocks anchored off-screen) so a dense scene viewed up close costs
    // O(visible), not O(all instances). Fall back to iterating instances when
    // zoomed far out (the scan area would be larger than the scene).
    const M = MAX_BLOCK_SPAN;
    const visCells = (r.maxCol - r.minCol + 1 + M) * (r.maxRow - r.minRow + 1 + M);
    if (visCells <= CELL_SCAN_CAP) {
      for (let row = r.minRow - M; row <= r.maxRow; row++) {
        for (let col = r.minCol - M; col <= r.maxCol; col++) {
          const key = cellKey(col, row);
          const inst = instances[key];
          if (inst) this.renderOneInstance(key, inst, ctx);
        }
      }
    } else {
      for (const key in instances) this.renderOneInstance(key, instances[key], ctx);
    }

    // Recycle nodes that scrolled out of view or were erased.
    for (const [key, node] of this.nodes) {
      if (!seen.has(key)) {
        node.remove();
        this.nodes.delete(key);
      }
    }
    for (const [key, rect] of this.cellBgNodes) {
      if (!seen.has(key)) {
        rect.remove();
        this.cellBgNodes.delete(key);
      }
    }
  }

  /** Render one instance (block) if it overlaps the viewport: cull, ensure node,
   *  sample its lifecycle, and apply geometry/color. Shared by both iteration
   *  strategies in renderInstances. */
  private renderOneInstance(key: string, inst: Instance, ctx: RenderCtx): void {
    const r = ctx.range;
    const cw = inst.cw ?? 1;
    const ch = inst.ch ?? 1;
    if (inst.col + cw <= r.minCol || inst.col > r.maxCol || inst.row + ch <= r.minRow || inst.row > r.maxRow) {
      return;
    }
    ctx.seen.add(key);
    // "shuffle" idle swaps the displayed glyph over time (staggered per cell).
    const assetId =
      ctx.shuffleIds && ctx.shuffleIds.length > 1
        ? this.shuffledAsset(inst, ctx.T, ctx.state.animation.idleAmount, ctx.shuffleIds)
        : inst.assetId;
    this.ensureSymbol(assetId);
    let node = this.nodes.get(key);
    if (!node) {
      node = document.createElementNS(SVGNS, "use");
      this.content.appendChild(node);
      this.nodes.set(key, node);
    }
    const cs = ctx.state.cellSize;
    // Sample this instance's lifecycle at the current cycle time (order from the
    // active preset). Static scene = EMPTY_ANIM.
    let out: AnimOutput = EMPTY_ANIM;
    if (ctx.animate && ctx.orderOf) {
      out = sampleLifecycle(ctx.state.animation, ctx.orderOf(inst), ctx.tcyc, ctx.T);
    }
    this.applyCellBg(key, inst, cs, ctx.palette, out, ctx.state.cellRounded, ctx.state.cellGutter);
    this.applyInstance(node, inst, cs, inst.color ?? colorAt(ctx.palette, inst.colorIndex), out, assetId);
  }

  /** "shuffle" idle: pick a glyph from the pool that changes over time, staggered
   *  per cell so they don't all flip on the same beat. `amount` (0..1) sets pace. */
  private shuffledAsset(inst: Instance, T: number, amount: number, ids: string[]): string {
    // amount 0 = calm (~0.7s/swap), 1 = frantic (~0.12s/swap).
    const interval = 0.7 - 0.58 * Math.max(0, Math.min(1, amount));
    const phase = (inst.seed >>> 0) % 997; // per-cell offset so flips desync
    const step = Math.floor(T / interval) + phase;
    return ids[hash2(inst.col, inst.row, step) % ids.length];
  }

  /** Draw (or remove) the colored cell-background square behind an instance.
   *  Stays fixed to the cell; only the lifecycle opacity is shared so it
   *  fades in/out with its artwork. */
  /** When gutter/rounded toggles, briefly enable CSS transitions on the cell
   *  backgrounds so they glide to the new shape. Excludes cellSize (which moves
   *  the glyphs too, and those don't transition) so the two never desync. */
  private glideCellShape(state: SceneState): void {
    const sig = `${state.cellRounded}|${state.cellGutter}`;
    if (this.cellShapeSig && this.cellShapeSig !== sig) {
      this.cellBgLayer.classList.add("animating");
      clearTimeout(this.cellAnimTimer);
      this.cellAnimTimer = window.setTimeout(
        () => this.cellBgLayer.classList.remove("animating"),
        260,
      );
    }
    this.cellShapeSig = sig;
  }

  private applyCellBg(
    key: string,
    inst: Instance,
    cellSize: number,
    palette: Parameters<typeof colorAt>[0],
    anim: AnimOutput,
    rounded: boolean,
    gutter: boolean,
  ): void {
    let rect = this.cellBgNodes.get(key);
    if (inst.bgIndex == null) {
      if (rect) {
        rect.remove();
        this.cellBgNodes.delete(key);
      }
      return;
    }
    if (!rect) {
      rect = document.createElementNS(SVGNS, "rect");
      this.cellBgLayer.appendChild(rect);
      this.cellBgNodes.set(key, rect);
    }
    const box = cellBgRect(inst.col, inst.row, cellSize, rounded, gutter, inst.cw ?? 1, inst.ch ?? 1);
    const fill = colorAt(palette, inst.bgIndex);
    const op = anim.opacity ?? 1;
    // Dirty-check: skip writes when this cell background is unchanged.
    const sig = `${box.x}|${box.y}|${box.w}|${box.h}|${box.rx}|${fill}|${op}`;
    const dirty = rect as unknown as { __sig?: string };
    if (dirty.__sig === sig) return;
    dirty.__sig = sig;
    rect.setAttribute("x", String(box.x));
    rect.setAttribute("y", String(box.y));
    rect.setAttribute("width", String(box.w));
    rect.setAttribute("height", String(box.h));
    // Always numeric (0 when square) so rx can interpolate — `auto`↔number won't.
    rect.setAttribute("rx", String(box.rx || 0));
    rect.setAttribute("fill", fill);
    if (op < 1) rect.setAttribute("opacity", op.toFixed(3));
    else rect.removeAttribute("opacity");
  }

  private applyInstance(
    node: SVGUseElement,
    inst: Instance,
    cellSize: number,
    color: string,
    anim: AnimOutput,
    assetId: string = inst.assetId,
  ): void {
    const g = instanceGeom(inst, cellSize, anim, this.fillMul, this.scratchBox);
    // Dirty-check: skip all DOM writes when nothing this node shows changed
    // (e.g. a pan only moves the viewBox; static instances during animation).
    const sig = `${assetId}|${g.x}|${g.y}|${g.size}|${g.rot}|${g.cx}|${g.cy}|${g.opacity}|${color}|${inst.id}`;
    const dirty = node as unknown as { __sig?: string };
    if (dirty.__sig === sig) return;
    dirty.__sig = sig;
    node.setAttribute("href", `#sym-${assetId}`);
    node.setAttribute("x", String(g.x));
    node.setAttribute("y", String(g.y));
    node.setAttribute("width", String(g.size));
    node.setAttribute("height", String(g.size));
    node.style.color = color; // drives currentColor in the symbol
    node.setAttribute("transform", g.rot ? `rotate(${g.rot} ${g.cx} ${g.cy})` : "");
    if (g.opacity < 1) node.setAttribute("opacity", g.opacity.toFixed(3));
    else node.removeAttribute("opacity");
    node.dataset.instId = inst.id;
  }

  /** Force a full rebuild (e.g. after palette swap that changes every color). */
  invalidate(): void {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
    for (const rect of this.cellBgNodes.values()) rect.remove();
    this.cellBgNodes.clear();
  }
}
