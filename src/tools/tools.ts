import type { Store } from "../store/store";
import type { History } from "../commands/command";
import type { Library } from "../features/library";
import type { Renderer } from "../render/renderer";
import {
  PlaceInstances,
  EraseInstances,
  ApplyMaskCommand,
  BlockCells,
} from "../commands/sceneCommands";
import { buildInstance, pickAsset } from "../features/placement";
import { dividerBlocks, blockAt } from "../features/divider";
import { stencilLit } from "../features/stencil";
import { paletteById } from "../features/palette";
import type { AudioEngine } from "../features/audio";
import { screenToWorld, zoomAt, panBy } from "../scene/camera";
import { worldToCell, brushCells, brushBlocks } from "../scene/grid";
import { cellKey } from "../scene/types";
import type { Instance, SceneState } from "../scene/types";

/** Wires pointer + wheel input on the SVG to tools. Draw and erase paint
 *  across cells during a drag and commit as a single undoable command. */
export class InputController {
  private dragging = false;
  private spaceDown = false;
  private panning = false;
  private last = { x: 0, y: 0 };
  private strokeCells = new Set<string>();
  private strokePlaced: Instance[] = [];
  private strokeErased: Instance[] = [];
  /** Working instances map for the active stroke — cloned ONCE on pointerdown and
   *  mutated per move (avoids an O(N) clone of every SVG on each pointer event). */
  private strokeInstances: Record<string, Instance> = {};
  /** Last painted world point — the brush interpolates from here so fast moves
   *  don't leave gaps between sparse pointermove events. Null = stroke start. */
  private lastPaintW: { x: number; y: number } | null = null;
  private drawingPath = false;
  private pathPoints: { x: number; y: number }[] = [];
  // Line tool: draw a freehand path (preview), filled with glyphs on release.
  private liningPath = false;
  private linePoints: { x: number; y: number }[] = [];
  // Block tool state.
  private blockBrushing = false;
  private blockDragStart: { x: number; y: number } | null = null;
  private blockKeys: string[] = [];
  private blockCleanStroke = false; // clean (un-block) vs block, captured at down
  // Edit tool state.
  private editing = false;
  private editOriginals = new Map<string, Instance>(); // key -> pre-edit instance

  constructor(
    private store: Store,
    private history: History,
    private library: Library,
    private renderer: Renderer,
    private audio: AudioEngine,
    private onHover?: (col: number, row: number) => void,
  ) {
    const svg = renderer.svg;
    svg.addEventListener("pointerdown", this.onDown);
    svg.addEventListener("pointermove", this.onMove);
    svg.addEventListener("pointerleave", () => this.renderer.setHover(null));
    window.addEventListener("pointerup", this.onUp);
    svg.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
  }

  private host() {
    return this.renderer.hostSize;
  }

  private worldAt(e: PointerEvent) {
    const rect = this.renderer.svg.getBoundingClientRect();
    return screenToWorld(
      this.store.get().camera,
      this.host(),
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  }

  private cellAt(e: PointerEvent) {
    const w = this.worldAt(e);
    return worldToCell(w.x, w.y, this.store.get().cellSize);
  }

  private onDown = (e: PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const tool = this.store.get().tool;
    const usePan = tool === "pan" || this.spaceDown || e.button === 1;
    if (usePan) {
      this.panning = true;
      this.last = { x: e.clientX, y: e.clientY };
      this.renderer.svg.parentElement?.classList.add("panning");
      return;
    }
    if (tool === "path") {
      this.drawingPath = true;
      this.pathPoints = [this.worldAt(e)];
      this.store.set({ orderPath: this.pathPoints });
      return;
    }
    if (tool === "line") {
      // Draw the line as a preview stroke; it's filled with glyphs on release.
      this.liningPath = true;
      this.linePoints = [this.worldAt(e)];
      this.renderer.setLinePreview(this.linePoints);
      return;
    }
    if (tool === "block") {
      this.strokeCells.clear();
      this.blockKeys = [];
      this.blockCleanStroke = this.store.get().blockClean;
      if (this.store.get().blockMode === "drag") {
        this.blockDragStart = this.worldAt(e);
        this.renderer.setBlockRect(this.blockDragStart, this.blockDragStart);
      } else {
        this.blockBrushing = true;
        this.paintBlock(e);
      }
      return;
    }
    // Edit operates on existing instances while the Edit context is open.
    if (this.store.get().contextPanel === "edit") {
      this.editing = true;
      this.strokeCells.clear();
      this.strokePlaced = [];
      this.editOriginals.clear();
      this.strokeInstances = { ...this.store.get().instances }; // clone once per stroke
      this.paintEdit(e);
      return;
    }
    this.dragging = true;
    this.strokeCells.clear();
    this.strokePlaced = [];
    this.strokeErased = [];
    this.strokeInstances = { ...this.store.get().instances }; // clone once per stroke
    this.lastPaintW = null; // fresh stroke — no interpolation from a prior point
    this.paint(e);
  };

  private onMove = (e: PointerEvent) => {
    const cell = this.cellAt(e);
    this.onHover?.(cell.col, cell.row);
    const w = this.worldAt(e);
    const cs = this.store.get().cellSize;
    this.renderer.setHover(w.x / cs, w.y / cs);
    if (this.panning) {
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      this.store.set({ camera: panBy(this.store.get().camera, this.host(), dx, dy) });
      return;
    }
    if (this.drawingPath) {
      const p = this.worldAt(e);
      const last = this.pathPoints[this.pathPoints.length - 1];
      // Sample by distance so the path stays light but smooth.
      const minStep = this.store.get().cellSize * 0.4;
      if (Math.hypot(p.x - last.x, p.y - last.y) >= minStep) {
        this.pathPoints = [...this.pathPoints, p];
        this.store.set({ orderPath: this.pathPoints });
      }
      return;
    }
    if (this.liningPath) {
      const p = this.worldAt(e);
      const last = this.linePoints[this.linePoints.length - 1];
      const minStep = this.store.get().cellSize * 0.35;
      if (Math.hypot(p.x - last.x, p.y - last.y) >= minStep) {
        this.linePoints.push(p);
        this.renderer.setLinePreview(this.linePoints);
      }
      return;
    }
    if (this.blockDragStart) {
      // The rubber-band always snaps to the whole cells it covers (what you
      // see = what gets blocked).
      const s = this.store.get();
      const b = this.worldAt(e);
      const cs = s.cellSize;
      const a = this.blockDragStart;
      const c0 = Math.floor(Math.min(a.x, b.x) / cs);
      const c1 = Math.floor(Math.max(a.x, b.x) / cs);
      const r0 = Math.floor(Math.min(a.y, b.y) / cs);
      const r1 = Math.floor(Math.max(a.y, b.y) / cs);
      this.renderer.setBlockRect({ x: c0 * cs, y: r0 * cs }, { x: (c1 + 1) * cs, y: (r1 + 1) * cs });
      return;
    }
    if (this.blockBrushing) {
      this.paintBlock(e);
      return;
    }
    if (this.editing) {
      this.paintEdit(e);
      return;
    }
    if (this.dragging) this.paint(e);
  };

  private onUp = (e: PointerEvent) => {
    if (this.drawingPath) {
      this.pathPoints = [...this.pathPoints, this.worldAt(e)];
      // Finalize the path and switch reveal order to follow it.
      this.store.set({
        orderPath: this.pathPoints,
        animation: { ...this.store.get().animation, order: "free" },
      });
      this.drawingPath = false;
    }
    if (this.liningPath) {
      this.linePoints.push(this.worldAt(e));
      this.commitLine();
      this.renderer.setLinePreview(null);
      this.liningPath = false;
    }
    if (this.blockDragStart) {
      this.commitBlockDrag(this.blockDragStart, this.worldAt(e));
      this.blockDragStart = null;
      this.renderer.setBlockRect(null);
    }
    if (this.blockBrushing) {
      this.commitBlockStroke();
      this.blockBrushing = false;
    }
    if (this.editing) {
      this.commitEditStroke();
      this.editing = false;
    }
    if (this.dragging) this.commitStroke();
    this.dragging = false;
    this.panning = false;
    this.renderer.svg.parentElement?.classList.remove("panning");
  };

  /** Place/erase across the brush footprint, deduped within the stroke. With
   *  Size > 1, Draw stamps non-overlapping N×N SVGs (clearing what's under
   *  them); Erase removes any SVG covering a touched cell (multi-cell aware). */
  private paint(e: PointerEvent) {
    const state = this.store.get();
    // Divider context: the brush fills the subdivision block under the cursor
    // with one SVG spanning the whole block (size adapts to the preview).
    if (state.contextPanel === "divider" && state.tool !== "erase") {
      this.paintDivider(e, state);
      return;
    }
    const cs = state.cellSize;
    const w = this.worldAt(e);
    const span = Math.max(1, Math.round(state.brushSpan ?? 1));
    const instances = this.strokeInstances; // mutated in place; cloned at stroke start
    // While the Stencil is open, the brush may only paint inside the lit (green)
    // opening — built once, then reused across the interpolated points.
    const lit = state.tool !== "erase" && state.contextPanel === "stencil" ? stencilLit(state) : null;

    // Interpolate from the previous point so a fast pointer move (sparse events)
    // doesn't leave gaps along the path.
    let changed = false;
    const prev = this.lastPaintW;
    if (prev) {
      const steps = Math.max(1, Math.ceil(Math.hypot(w.x - prev.x, w.y - prev.y) / (cs * 0.5)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (this.paintAt(prev.x + (w.x - prev.x) * t, prev.y + (w.y - prev.y) * t, state, instances, span, lit)) {
          changed = true;
        }
      }
    } else if (this.paintAt(w.x, w.y, state, instances, span, lit)) {
      changed = true;
    }
    this.lastPaintW = w;

    if (changed) {
      this.store.set({ instances });
      if (state.tool === "erase") this.audio.erase();
      else this.audio.note(Math.floor(w.x / cs) + Math.floor(w.y / cs));
    }
  }

  /** Paint the brush footprint at a single world point (no store/audio side
   *  effects — the caller batches those). Returns whether anything changed. */
  private paintAt(
    wx: number,
    wy: number,
    state: SceneState,
    instances: Record<string, Instance>,
    span: number,
    lit: ((col: number, row: number) => boolean) | null,
  ): boolean {
    const cs = state.cellSize;
    let changed = false;

    if (state.tool === "erase") {
      const cells = brushCells(wx / cs, wy / cs, state.brushSize, state.brushShape);
      for (const c of cells) {
        const key = cellKey(c.col, c.row);
        if (this.strokeCells.has(key) || state.blocked[key]) continue; // blocked = protected
        this.strokeCells.add(key);
        for (const k of coveringKeys(instances, c.col, c.row)) {
          const inst = instances[k];
          if (inst) {
            delete instances[k];
            this.strokeErased.push(inst);
            changed = true;
          }
        }
      }
      return changed;
    }

    const litAt = (col: number, row: number): boolean => !lit || lit(col, row);

    // DRAW: an N×N footprint (Brush) of span×span blocks (Size). Each block
    // clears what it covers, so placements never overlap.
    const blocks = brushBlocks(wx / cs, wy / cs, state.brushSize, state.brushShape, span);
    for (const blk of blocks) {
      // Skip if any covered cell is already painted this stroke, is blocked, or
      // (with the stencil on) falls outside the lit opening.
      let skip = false;
      for (let y = blk.row; y < blk.row + span && !skip; y++) {
        for (let x = blk.col; x < blk.col + span; x++) {
          const k = cellKey(x, y);
          if (this.strokeCells.has(k) || state.blocked[k] || !litAt(x, y)) {
            skip = true;
            break;
          }
        }
      }
      if (skip) continue;
      // Clear whatever the block covers.
      for (const k of instancesInRect(instances, blk.col, blk.row, span, span)) {
        const inst = instances[k];
        if (inst) {
          delete instances[k];
          this.strokeErased.push(inst);
        }
      }
      // Reserve the block's cells, then place it.
      for (let y = blk.row; y < blk.row + span; y++) {
        for (let x = blk.col; x < blk.col + span; x++) this.strokeCells.add(cellKey(x, y));
      }
      const inst = buildInstance(state, this.library, blk.col, blk.row, span, span);
      instances[cellKey(blk.col, blk.row)] = inst;
      this.strokePlaced.push(inst);
      changed = true;
    }
    return changed;
  }

  /** Divider brush: fill the subdivision block under the cursor with one SVG
   *  spanning the whole block. Drag to fill several; uses the normal stroke
   *  buffers so commitStroke coalesces it into one undo step. */
  private paintDivider(e: PointerEvent, state: SceneState) {
    const cs = state.cellSize;
    const w = this.worldAt(e);
    const col = Math.floor(w.x / cs);
    const row = Math.floor(w.y / cs);
    const b = blockAt(dividerBlocks(state), col, row);
    if (!b) return;
    const originKey = cellKey(b.col, b.row);
    if (this.strokeCells.has(originKey)) return; // block already filled this stroke
    // Skip if any of the block's cells is blocked.
    for (let y = b.row; y < b.row + b.ch; y++) {
      for (let x = b.col; x < b.col + b.cw; x++) {
        if (state.blocked[cellKey(x, y)]) return;
      }
    }
    const instances = this.strokeInstances; // mutated in place; cloned at stroke start
    // Clear whatever the block covers, then place the spanning SVG.
    for (const k of instancesInRect(instances, b.col, b.row, b.cw, b.ch)) {
      const inst = instances[k];
      if (inst) {
        delete instances[k];
        this.strokeErased.push(inst);
      }
    }
    this.strokeCells.add(originKey);
    const inst = buildInstance(state, this.library, b.col, b.row, b.cw, b.ch);
    instances[cellKey(b.col, b.row)] = inst;
    this.strokePlaced.push(inst);
    this.store.set({ instances });
    this.audio.note(b.col + b.row);
  }

  /** Block brush: block (or, in Clean mode, un-block) footprint cells. Blocking
   *  preserves any SVG already there (draw/erase/edit skip blocked cells). */
  private paintBlock(e: PointerEvent) {
    const state = this.store.get();
    const clean = this.blockCleanStroke;
    const cs = state.cellSize;
    const w = this.worldAt(e);
    const cells = brushCells(w.x / cs, w.y / cs, state.brushSize, state.brushShape);
    const blocked = { ...state.blocked };
    let changed = false;
    for (const c of cells) {
      const key = cellKey(c.col, c.row);
      if (this.strokeCells.has(key)) continue;
      this.strokeCells.add(key);
      if (clean) {
        if (!blocked[key]) continue;
        delete blocked[key];
        this.blockKeys.push(key);
        changed = true;
      } else {
        if (blocked[key]) continue;
        blocked[key] = true;
        this.blockKeys.push(key);
        changed = true;
      }
    }
    if (changed) this.store.set({ blocked });
  }

  /** Block drag: block (or clean) every cell the rubber-band rectangle covers. */
  private commitBlockDrag(a: { x: number; y: number }, b: { x: number; y: number }) {
    const cs = this.store.get().cellSize;
    const c0 = Math.floor(Math.min(a.x, b.x) / cs);
    const c1 = Math.floor(Math.max(a.x, b.x) / cs);
    const r0 = Math.floor(Math.min(a.y, b.y) / cs);
    const r1 = Math.floor(Math.max(a.y, b.y) / cs);
    const keys: string[] = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) keys.push(cellKey(c, r));
    if (keys.length) this.history.dispatch(new BlockCells(keys, !this.blockCleanStroke));
  }

  /** Coalesce the eager block-brush edits into one undoable command. */
  private commitBlockStroke() {
    if (!this.blockKeys.length) return;
    const blocked = { ...this.store.get().blocked };
    if (this.blockCleanStroke) {
      for (const key of this.blockKeys) blocked[key] = true; // restore pre-stroke
    } else {
      for (const key of this.blockKeys) delete blocked[key]; // restore pre-stroke
    }
    this.store.set({ blocked }); // back to pre-stroke
    this.history.dispatch(new BlockCells(this.blockKeys, !this.blockCleanStroke));
  }

  /** Edit (rotate / swap / recolor) the instance(s) under the brush footprint.
   *  Deduped by instance so a drag touches each one once per stroke. */
  private paintEdit(e: PointerEvent) {
    const state = this.store.get();
    const cs = state.cellSize;
    const w = this.worldAt(e);
    const cells = brushCells(w.x / cs, w.y / cs, state.brushSize, state.brushShape);
    const instances = this.strokeInstances; // mutated in place; cloned at stroke start
    let changed = false;
    for (const c of cells) {
      if (state.blocked[cellKey(c.col, c.row)]) continue; // blocked = protected
      for (const k of coveringKeys(instances, c.col, c.row)) {
        if (this.strokeCells.has(k)) continue;
        this.strokeCells.add(k);
        const inst = instances[k];
        if (!this.editOriginals.has(k)) this.editOriginals.set(k, inst);
        const edited = editInstance(state, this.library, inst);
        instances[k] = edited;
        this.strokePlaced.push(edited);
        changed = true;
      }
    }
    if (changed) {
      this.store.set({ instances });
      this.audio.note(Math.floor(w.x / cs) + Math.floor(w.y / cs));
    }
  }

  /** Restore the originals, then dispatch the edits as one undoable replace. */
  private commitEditStroke() {
    if (!this.strokePlaced.length) return;
    const instances = { ...this.store.get().instances };
    for (const [k, orig] of this.editOriginals) instances[k] = orig;
    this.store.set({ instances }); // back to pre-edit
    this.history.dispatch(new PlaceInstances(this.strokePlaced));
  }

  /** Coalesce the eager per-cell edits into one undoable command. We first
   *  restore the pre-stroke state, then dispatch a single command so history
   *  captures the correct before/after for undo and redo. */
  private commitStroke() {
    const placed = this.strokePlaced;
    const erased = this.strokeErased;
    if (!placed.length && !erased.length) return;

    // Restore the pre-stroke state, then dispatch one command.
    const instances = { ...this.store.get().instances };
    for (const inst of placed) delete instances[cellKey(inst.col, inst.row)];
    for (const inst of erased) instances[cellKey(inst.col, inst.row)] = inst;
    this.store.set({ instances });

    if (placed.length && erased.length) {
      // Multi-cell draw that cleared what it covered. Don't erase a cell we're
      // also re-placing (place-then-erase order would drop it).
      const placedKeys = new Set(placed.map((i) => cellKey(i.col, i.row)));
      const eraseKeys = erased.map((i) => cellKey(i.col, i.row)).filter((k) => !placedKeys.has(k));
      this.history.dispatch(new ApplyMaskCommand(placed, eraseKeys));
    } else if (placed.length) {
      this.history.dispatch(new PlaceInstances(placed));
    } else {
      this.history.dispatch(new EraseInstances(erased.map((i) => cellKey(i.col, i.row))));
    }
  }

  /** Rasterize the drawn line into glyphs (Brush = thickness; Size = each glyph's
   *  span, tiled along the path) and place them as one undoable step. */
  private commitLine() {
    const state = this.store.get();
    const cs = state.cellSize;
    const pts = this.linePoints;
    if (!pts.length) return;
    const span = Math.max(1, Math.round(state.brushSpan ?? 1));
    const reserved = new Set<string>(); // cells already taken by a placed glyph
    const places: Instance[] = [];
    const eraseSet = new Set<string>(); // existing instances the line clears
    const stamp = (xCell: number, yCell: number) => {
      for (const blk of brushBlocks(xCell, yCell, state.brushSize, "circle", span)) {
        // Skip if any of the span×span cells is already reserved or blocked.
        let skip = false;
        for (let y = blk.row; y < blk.row + span && !skip; y++) {
          for (let x = blk.col; x < blk.col + span; x++) {
            if (reserved.has(cellKey(x, y)) || state.blocked[cellKey(x, y)]) {
              skip = true;
              break;
            }
          }
        }
        if (skip) continue;
        // Clear whatever this block covers so it doesn't stack on existing SVGs.
        for (const k of instancesInRect(state.instances, blk.col, blk.row, span, span)) {
          eraseSet.add(k);
        }
        for (let y = blk.row; y < blk.row + span; y++) {
          for (let x = blk.col; x < blk.col + span; x++) reserved.add(cellKey(x, y));
        }
        places.push(buildInstance(state, this.library, blk.col, blk.row, span, span));
      }
    };
    if (pts.length === 1) {
      stamp(pts[0].x / cs, pts[0].y / cs);
    } else {
      // Walk each segment in sub-cell steps so the glyphs follow the curve with
      // no gaps even where the sampled points are far apart.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cs * 0.5)));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          stamp((a.x + (b.x - a.x) * t) / cs, (a.y + (b.y - a.y) * t) / cs);
        }
      }
    }
    if (places.length || eraseSet.size) {
      const placedKeys = new Set(places.map((i) => cellKey(i.col, i.row)));
      const eraseKeys = [...eraseSet].filter((k) => !placedKeys.has(k));
      this.history.dispatch(new ApplyMaskCommand(places, eraseKeys));
      this.audio.note(places.length);
    }
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.renderer.svg.getBoundingClientRect();
    // Normalize the wheel delta across browsers: Chrome reports pixels, but
    // Safari/Firefox often report line- or page-mode deltas (tiny values) — which
    // made the zoom imperceptible. Convert to ~pixels, then clamp big momentum jumps.
    const unit = e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? this.host().height : 1;
    const dy = Math.max(-240, Math.min(240, e.deltaY * unit));
    const factor = Math.exp(-dy * 0.0015);
    const cam = zoomAt(
      this.store.get().camera,
      this.host(),
      e.clientX - rect.left,
      e.clientY - rect.top,
      factor,
    );
    this.store.set({ camera: cam });
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.code === "Space") this.spaceDown = e.type === "keydown";
  };
}

/** Apply the active Edit operation to one instance, returning a new instance. */
function editInstance(state: SceneState, library: Library, inst: Instance): Instance {
  // -1 = "none": transparent glyph / no cell background.
  const recolorIndex = () => {
    if (state.editRecolorNone) return -1;
    if (!state.editRecolorRandom) return state.activeColorIndex;
    const len = paletteById(state.palettes, state.activePaletteId).colors.length;
    return Math.floor(Math.random() * len);
  };
  switch (state.editOp) {
    case "rotate":
      return { ...inst, rotation: (inst.rotation + 90) % 360 };
    case "swap":
      return { ...inst, assetId: pickAsset(state.brushAssets, library, Math.random) };
    case "recolor-item":
      return { ...inst, colorIndex: recolorIndex() };
    case "recolor-cell": {
      const idx = recolorIndex();
      return { ...inst, bgIndex: idx < 0 ? undefined : idx };
    }
    case "recolor-both": {
      const idx = recolorIndex();
      return { ...inst, colorIndex: idx, bgIndex: idx < 0 ? undefined : idx };
    }
    default:
      return inst;
  }
}

/** Keys of instances whose block covers cell (col,row). Spans are ≤6, so only
 *  origins up-to-5 cells up/left can reach it. */
function coveringKeys(instances: Record<string, Instance>, col: number, row: number): string[] {
  const keys: string[] = [];
  for (let oy = row; oy > row - 6; oy--) {
    for (let ox = col; ox > col - 6; ox--) {
      const inst = instances[cellKey(ox, oy)];
      if (!inst) continue;
      if (col < ox + (inst.cw ?? 1) && row < oy + (inst.ch ?? 1)) keys.push(cellKey(ox, oy));
    }
  }
  return keys;
}

/** Keys of instances whose block overlaps the rect (col,row,w,h) in cells. */
function instancesInRect(
  instances: Record<string, Instance>,
  col: number,
  row: number,
  w: number,
  h: number,
): string[] {
  const keys: string[] = [];
  for (let oy = row - 5; oy < row + h; oy++) {
    for (let ox = col - 5; ox < col + w; ox++) {
      const inst = instances[cellKey(ox, oy)];
      if (!inst) continue;
      if (
        ox < col + w &&
        ox + (inst.cw ?? 1) > col &&
        oy < row + h &&
        oy + (inst.ch ?? 1) > row
      ) {
        keys.push(cellKey(ox, oy));
      }
    }
  }
  return keys;
}
