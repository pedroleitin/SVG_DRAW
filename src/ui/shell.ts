import type { Store } from "../store/store";
import type { History } from "../commands/command";
import type { Library } from "../features/library";
import type { Renderer } from "../render/renderer";
import type { Mode, ContextPanel, SceneState, ToolId } from "../scene/types";
import { ClearAll } from "../commands/sceneCommands";
import { makeCamera, zoomOf, zoomAt } from "../scene/camera";
import { ShapesPanel } from "./shapesPanel";
import { ColorsPanel } from "./colorsPanel";
import { Controls } from "./controls";
import { AnimPanel } from "./animPanel";
import { ExportPanel } from "./exportPanel";

const MODES: { id: Mode; label: string }[] = [
  { id: "draw", label: "Draw" },
  { id: "compose", label: "Compose" },
  { id: "animate", label: "Animate" },
  { id: "export", label: "Export" },
];

/** The floating UI shell: a modes bar (top), a per-mode toolbox (bottom-center)
 *  with a context menu above it, and status / zoom in the bottom corners.
 *  Context panels (Shapes, Colors, Noise, Animate, Export) are mounted once and
 *  shown on demand. */
export class Shell {
  private modesEl: HTMLElement;
  private toolboxEl: HTMLElement;
  private contextEl: HTMLElement;
  private statusEl: HTMLElement;
  private zoomEl: HTMLElement;
  private ctxHosts = new Map<string, HTMLElement>();
  private toolboxSig = "";

  constructor(
    private store: Store,
    private history: History,
    library: Library,
    private renderer: Renderer,
  ) {
    this.modesEl = document.getElementById("modes") as HTMLElement;
    this.toolboxEl = document.getElementById("toolbox") as HTMLElement;
    this.contextEl = document.getElementById("context") as HTMLElement;
    this.statusEl = document.getElementById("status") as HTMLElement;
    this.zoomEl = document.getElementById("zoombox") as HTMLElement;

    this.buildModes();
    this.buildStatus();
    this.buildZoom();
    this.mountContexts(library);

    history.onChange = () => this.refreshStatus();
    this.store.subscribe((s) => this.sync(s));
    this.sync(store.get());
  }

  // ---- Modes bar ----
  private buildModes(): void {
    this.modesEl.innerHTML = "";
    for (const m of MODES) {
      const btn = document.createElement("button");
      btn.className = "mode-btn";
      btn.dataset.mode = m.id;
      btn.textContent = m.label;
      btn.addEventListener("click", () => this.setMode(m.id));
      this.modesEl.appendChild(btn);
    }
  }

  private setMode(mode: Mode): void {
    const patch: Partial<SceneState> = { mode, contextPanel: null };
    if (mode === "draw" || mode === "compose") patch.tool = "draw";
    // Export mode shows the frame as its working affordance.
    patch.frame = { ...this.store.get().frame, show: mode === "export" };
    this.store.set(patch);
  }

  // ---- Context panels ----
  private mountContexts(library: Library): void {
    const make = (key: string) => {
      const div = document.createElement("div");
      div.className = "ctx-panel";
      div.dataset.ctx = key;
      this.contextEl.appendChild(div);
      this.ctxHosts.set(key, div);
      return div;
    };
    new ShapesPanel(make("shapes"), this.store, library);
    new ColorsPanel(make("colors"), this.store, this.renderer);
    new Controls(make("noise"), this.store, library, this.history);
    new AnimPanel(make("animate"), this.store);
    new ExportPanel(make("export"), this.store, library);
  }

  private toggleContext(key: Exclude<ContextPanel, null>): void {
    const cur = this.store.get().contextPanel;
    this.store.set({ contextPanel: cur === key ? null : key });
  }

  // ---- Toolbox (per mode) ----
  private btn(
    label: string,
    opts: { title?: string; active?: boolean; onClick: () => void },
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "tool-btn" + (opts.active ? " active" : "");
    b.innerHTML = label;
    if (opts.title) b.title = opts.title;
    b.addEventListener("click", opts.onClick);
    return b;
  }

  private toolBtn(label: string, tool: ToolId, s: SceneState, title?: string): HTMLButtonElement {
    return this.btn(label, { title, active: s.tool === tool, onClick: () => this.store.set({ tool }) });
  }

  private ctxBtn(label: string, key: Exclude<ContextPanel, null>, s: SceneState, title?: string): HTMLButtonElement {
    return this.btn(label, { title, active: s.contextPanel === key, onClick: () => this.toggleContext(key) });
  }

  private gridSelect(s: SceneState): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "tb-field";
    wrap.innerHTML = `<span>cell</span>`;
    const sel = document.createElement("select");
    for (const size of [128, 64, 32, 16]) {
      const o = document.createElement("option");
      o.value = String(size);
      o.textContent = String(size);
      if (size === s.cellSize) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => this.store.set({ cellSize: Number(sel.value) }));
    wrap.appendChild(sel);
    return wrap;
  }

  private sep(): HTMLElement {
    const d = document.createElement("span");
    d.className = "tb-sep";
    return d;
  }

  private buildToolbox(s: SceneState): void {
    const tb = this.toolboxEl;
    tb.innerHTML = "";
    const add = (...els: HTMLElement[]) => els.forEach((e) => tb.appendChild(e));

    switch (s.mode) {
      case "draw":
        add(
          this.toolBtn("✏️ Draw", "draw", s),
          this.toolBtn("🩹 Erase", "erase", s),
          this.sep(),
          this.ctxBtn("◆ Shapes", "shapes", s),
          this.ctxBtn("🎨 Colors", "colors", s),
          this.sep(),
          this.gridSelect(s),
        );
        break;
      case "compose":
        add(
          this.ctxBtn("⬡ Noise", "noise", s, "Noise mask: fill / erase"),
          this.sep(),
          this.ctxBtn("◆ Shapes", "shapes", s),
          this.ctxBtn("🎨 Colors", "colors", s),
          this.sep(),
          this.gridSelect(s),
        );
        break;
      case "animate": {
        const playing = s.animation.playing;
        add(
          this.btn(playing ? "⏸ Pause" : "▶ Play", {
            active: playing,
            onClick: () => this.store.set({ animation: { ...s.animation, playing: !playing } }),
          }),
          this.toolBtn("🧭 Order", "path", s, "Draw reveal order: START→FINISH"),
          this.sep(),
          this.ctxBtn("⚙ Settings", "animate", s, "Animation settings"),
        );
        break;
      }
      case "export":
        add(
          this.btn(s.frame.show ? "▣ Frame ✓" : "▢ Frame", {
            active: s.frame.show,
            title: "Toggle export frame",
            onClick: () => this.store.set({ frame: { ...s.frame, show: !s.frame.show } }),
          }),
          this.sep(),
          this.ctxBtn("⬇ Export", "export", s, "Output settings + save"),
        );
        break;
    }
  }

  // ---- Status (bottom-left) ----
  private buildStatus(): void {
    this.statusEl.innerHTML = `
      <div class="status-actions">
        <button id="sh-undo" title="Undo (⌘Z)">↶</button>
        <button id="sh-redo" title="Redo (⌘⇧Z)">↷</button>
        <button id="sh-clear" title="Clear all">Clear</button>
      </div>
      <div class="status-info"><span id="sh-coords">cell 0,0</span> · <span id="sh-count">0 placed</span></div>`;
    this.statusEl.querySelector("#sh-undo")!.addEventListener("click", () => this.history.undo());
    this.statusEl.querySelector("#sh-redo")!.addEventListener("click", () => this.history.redo());
    this.statusEl.querySelector("#sh-clear")!.addEventListener("click", () => {
      if (Object.keys(this.store.get().instances).length) this.history.dispatch(new ClearAll());
    });
  }

  setCoords(col: number, row: number): void {
    const el = this.statusEl.querySelector("#sh-coords");
    if (el) el.textContent = `cell ${col},${row}`;
  }

  private refreshStatus(): void {
    const s = this.store.get();
    const count = this.statusEl.querySelector("#sh-count");
    if (count) count.textContent = `${Object.keys(s.instances).length} placed`;
    (this.statusEl.querySelector("#sh-undo") as HTMLButtonElement).disabled = !this.history.canUndo();
    (this.statusEl.querySelector("#sh-redo") as HTMLButtonElement).disabled = !this.history.canRedo();
  }

  // ---- Zoom (bottom-right) ----
  private buildZoom(): void {
    this.zoomEl.innerHTML = `
      <button id="sh-pan" title="Pan (Space)">✋</button>
      <span class="tb-sep"></span>
      <button id="sh-zout">−</button>
      <span id="sh-zlabel">100%</span>
      <button id="sh-zin">+</button>
      <button id="sh-zreset" title="Reset view">⤢</button>`;
    const zoom = (factor: number) => () => {
      const h = this.renderer.hostSize;
      this.store.set({ camera: zoomAt(this.store.get().camera, h, h.width / 2, h.height / 2, factor) });
    };
    this.zoomEl.querySelector("#sh-zin")!.addEventListener("click", zoom(1.2));
    this.zoomEl.querySelector("#sh-zout")!.addEventListener("click", zoom(1 / 1.2));
    this.zoomEl.querySelector("#sh-zreset")!.addEventListener("click", () =>
      this.store.set({ camera: makeCamera(this.renderer.hostSize, 1) }),
    );
    this.zoomEl.querySelector("#sh-pan")!.addEventListener("click", () => {
      const next: ToolId = this.store.get().tool === "pan" ? "draw" : "pan";
      this.store.set({ tool: next });
    });
  }

  // ---- Reactive sync ----
  private sync(s: SceneState): void {
    // Modes highlight.
    this.modesEl.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === s.mode),
    );

    // Rebuild toolbox only when something it shows changes.
    const sig = [s.mode, s.tool, s.contextPanel, s.cellSize, s.animation.playing, s.frame.show].join("|");
    if (sig !== this.toolboxSig) {
      this.toolboxSig = sig;
      this.buildToolbox(s);
    }

    // Context menu visibility.
    const open = s.contextPanel;
    this.contextEl.classList.toggle("hidden", open === null);
    for (const [key, host] of this.ctxHosts) host.classList.toggle("hidden", key !== open);

    // Pan + zoom.
    this.zoomEl.querySelector("#sh-pan")!.classList.toggle("active", s.tool === "pan");
    const zl = this.zoomEl.querySelector("#sh-zlabel");
    if (zl) zl.textContent = `${Math.round(zoomOf(s.camera, this.renderer.hostSize) * 100)}%`;

    this.refreshStatus();
  }
}
