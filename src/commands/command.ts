import type { Store } from "../store/store";

/** Command pattern: every scene mutation is reversible -> free undo/redo. */
export interface Command {
  readonly label: string;
  apply(store: Store): void;
  invert(store: Store): void;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private onChange?: () => void;

  constructor(private store: Store, onChange?: () => void) {
    this.onChange = onChange;
  }

  dispatch(cmd: Command): void {
    cmd.apply(this.store);
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
    this.onChange?.();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.invert(this.store);
    this.redoStack.push(cmd);
    this.onChange?.();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.apply(this.store);
    this.undoStack.push(cmd);
    this.onChange?.();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
