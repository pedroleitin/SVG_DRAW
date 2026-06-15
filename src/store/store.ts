import type { SceneState } from "../scene/types";

/** Minimal observable store. Single source of truth; everything subscribes. */
export type Listener = (state: SceneState, prev: SceneState) => void;

export class Store {
  private state: SceneState;
  private listeners = new Set<Listener>();

  constructor(initial: SceneState) {
    this.state = initial;
  }

  get(): SceneState {
    return this.state;
  }

  /** Shallow-merge a patch and notify. Use commands for scene mutations. */
  set(patch: Partial<SceneState>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    this.emit(prev);
  }

  /** Replace whole state (used by undo/redo and load). */
  replace(next: SceneState): void {
    const prev = this.state;
    this.state = next;
    this.emit(prev);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(prev: SceneState): void {
    for (const fn of this.listeners) fn(this.state, prev);
  }
}
