import type { Command } from "./command";
import type { Store } from "../store/store";
import type { Instance } from "../scene/types";
import { cellKey } from "../scene/types";

/** Place (or replace) instances at their cells. Stores the previous
 *  occupants so it can be inverted exactly. A whole drag-stroke or random
 *  fill is one command -> one undo step. */
export class PlaceInstances implements Command {
  readonly label = "Place";
  private prev: Record<string, Instance | undefined> = {};

  constructor(private items: Instance[]) {}

  apply(store: Store): void {
    const instances = { ...store.get().instances };
    for (const inst of this.items) {
      const key = cellKey(inst.col, inst.row);
      if (!(key in this.prev)) this.prev[key] = instances[key];
      instances[key] = inst;
    }
    store.set({ instances });
  }

  invert(store: Store): void {
    const instances = { ...store.get().instances };
    for (const [key, before] of Object.entries(this.prev)) {
      if (before) instances[key] = before;
      else delete instances[key];
    }
    store.set({ instances });
  }
}

/** Erase instances at the given cell keys. */
export class EraseInstances implements Command {
  readonly label = "Erase";
  private removed: Record<string, Instance> = {};

  constructor(private keys: string[]) {}

  apply(store: Store): void {
    const instances = { ...store.get().instances };
    for (const key of this.keys) {
      const inst = instances[key];
      if (inst) {
        this.removed[key] = inst;
        delete instances[key];
      }
    }
    store.set({ instances });
  }

  invert(store: Store): void {
    const instances = { ...store.get().instances };
    for (const [key, inst] of Object.entries(this.removed)) {
      instances[key] = inst;
    }
    store.set({ instances });
  }
}

/** Place a batch of instances and erase a batch of cells in one step — used
 *  by "Apply mask" so a fill+erase pass is a single undo. */
export class ApplyMaskCommand implements Command {
  readonly label = "Apply mask";
  private prev: Record<string, Instance | undefined> = {};

  constructor(
    private places: Instance[],
    private eraseKeys: string[],
  ) {}

  apply(store: Store): void {
    const instances = { ...store.get().instances };
    for (const inst of this.places) {
      const key = cellKey(inst.col, inst.row);
      if (!(key in this.prev)) this.prev[key] = instances[key];
      instances[key] = inst;
    }
    for (const key of this.eraseKeys) {
      if (!(key in this.prev)) this.prev[key] = instances[key];
      delete instances[key];
    }
    store.set({ instances });
  }

  invert(store: Store): void {
    const instances = { ...store.get().instances };
    for (const [key, before] of Object.entries(this.prev)) {
      if (before) instances[key] = before;
      else delete instances[key];
    }
    store.set({ instances });
  }
}

export class ClearAll implements Command {
  readonly label = "Clear";
  private prev: Record<string, Instance> = {};

  apply(store: Store): void {
    this.prev = store.get().instances;
    store.set({ instances: {} });
  }

  invert(store: Store): void {
    store.set({ instances: this.prev });
  }
}
