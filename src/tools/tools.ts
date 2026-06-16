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
import { buildInstance } from "../features/placement";
import { screenToWorld, zoomAt, panBy } from "../scene/camera";
import { worldToCell, brushCells, brushBlocks } from "../scene/grid";
import { cellKey } from "../scene/types";
import type { Instance } from "../scene/types";

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
  private drawingPath = false;
  private pathPoints: { x: number; y: number }[] = [];
  // Block tool state.
  private blockBrushing = false;
  private blockDragStart: { x: number; y: number } | null = null;
  private blockKeys: string[] = [];
  private blockRemoved: Instance[] = [];
  private blockCleanStroke = false; // clean (un-block) vs block, captured at down

  constructor(
    private store: Store,
    private history: History,
    private library: Library,
    private renderer: Renderer,
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
    if (tool === "block") {
      this.strokeCells.clear();
      this.blockKeys = [];
      this.blockRemoved = [];
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
    this.dragging = true;
    this.strokeCells.clear();
    this.strokePlaced = [];
    this.strokeErased = [];
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
    if (this.blockDragStart) {
      this.commitBlockDrag(this.blockDragStart, this.worldAt(e));
      this.blockDragStart = null;
      this.renderer.setBlockRect(null);
    }
    if (this.blockBrushing) {
      this.commitBlockStroke();
      this.blockBrushing = false;
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
    const cs = state.cellSize;
    const w = this.worldAt(e);
    const span = Math.max(1, Math.round(state.brushSpan ?? 1));
    const instances = { ...state.instances };
    let changed = false;

    if (state.tool === "erase") {
      const cells = brushCells(w.x / cs, w.y / cs, state.brushSize, state.brushShape);
      for (const c of cells) {
        const key = cellKey(c.col, c.row);
        if (this.strokeCells.has(key)) continue;
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
      if (changed) this.store.set({ instances });
      return;
    }

    // DRAW: an N×N footprint (Brush) of span×span blocks (Size). Each block
    // clears what it covers, so placements never overlap.
    const blocks = brushBlocks(w.x / cs, w.y / cs, state.brushSize, state.brushShape, span);
    for (const blk of blocks) {
      // Skip if any covered cell is already painted this stroke, or is blocked.
      let skip = false;
      for (let y = blk.row; y < blk.row + span && !skip; y++) {
        for (let x = blk.col; x < blk.col + span; x++) {
          const k = cellKey(x, y);
          if (this.strokeCells.has(k) || state.blocked[k]) {
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
    if (changed) this.store.set({ instances });
  }

  /** Block brush: block (or, in Clean mode, un-block) footprint cells, removing
   *  any SVGs when blocking. */
  private paintBlock(e: PointerEvent) {
    const state = this.store.get();
    const clean = this.blockCleanStroke;
    const cs = state.cellSize;
    const w = this.worldAt(e);
    const cells = brushCells(w.x / cs, w.y / cs, state.brushSize, state.brushShape);
    const blocked = { ...state.blocked };
    const instances = { ...state.instances };
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
        const inst = instances[key];
        if (inst) {
          delete instances[key];
          this.blockRemoved.push(inst);
        }
        changed = true;
      }
    }
    if (changed) this.store.set({ blocked, instances });
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
    const instances = { ...this.store.get().instances };
    if (this.blockCleanStroke) {
      for (const key of this.blockKeys) blocked[key] = true; // restore pre-stroke
    } else {
      for (const key of this.blockKeys) delete blocked[key];
      for (const inst of this.blockRemoved) instances[cellKey(inst.col, inst.row)] = inst;
    }
    this.store.set({ blocked, instances }); // back to pre-stroke
    this.history.dispatch(new BlockCells(this.blockKeys, !this.blockCleanStroke));
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

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.renderer.svg.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0015);
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
