import type { Store } from "../store/store";
import type { History } from "../commands/command";
import type { Library } from "../features/library";
import type { Renderer } from "../render/renderer";
import { PlaceInstances, EraseInstances } from "../commands/sceneCommands";
import { buildInstance } from "../features/placement";
import { screenToWorld, zoomAt, panBy } from "../scene/camera";
import { worldToCell, brushCells } from "../scene/grid";
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
      return;
    }
    if (tool === "path") {
      this.drawingPath = true;
      this.pathPoints = [this.worldAt(e)];
      this.store.set({ orderPath: this.pathPoints });
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
    if (this.dragging) this.commitStroke();
    this.dragging = false;
    this.panning = false;
  };

  /** Place/erase every cell in the brush footprint, deduped within the stroke. */
  private paint(e: PointerEvent) {
    const state = this.store.get();
    const cs = state.cellSize;
    const w = this.worldAt(e);
    const cells = brushCells(w.x / cs, w.y / cs, state.brushSize, state.brushShape);
    const instances = { ...state.instances };
    let changed = false;

    for (const c of cells) {
      const key = cellKey(c.col, c.row);
      if (this.strokeCells.has(key)) continue;
      this.strokeCells.add(key);

      if (state.tool === "erase") {
        const existing = instances[key];
        if (existing) {
          // Eagerly remove for responsiveness; remember original for commit.
          delete instances[key];
          this.strokeErased.push(existing);
          changed = true;
        }
      } else {
        const inst = buildInstance(state, this.library, c.col, c.row);
        instances[key] = inst;
        this.strokePlaced.push(inst);
        changed = true;
      }
    }
    if (changed) this.store.set({ instances });
  }

  /** Coalesce the eager per-cell edits into one undoable command. We first
   *  restore the pre-stroke state, then dispatch a single command so history
   *  captures the correct before/after for undo and redo. */
  private commitStroke() {
    if (this.strokePlaced.length) {
      const instances = { ...this.store.get().instances };
      for (const inst of this.strokePlaced) delete instances[cellKey(inst.col, inst.row)];
      this.store.set({ instances }); // back to pre-stroke
      this.history.dispatch(new PlaceInstances(this.strokePlaced));
    } else if (this.strokeErased.length) {
      const instances = { ...this.store.get().instances };
      for (const inst of this.strokeErased) instances[cellKey(inst.col, inst.row)] = inst;
      this.store.set({ instances }); // back to pre-stroke
      this.history.dispatch(new EraseInstances(this.strokeErased.map((i) => cellKey(i.col, i.row))));
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
