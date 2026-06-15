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

/** Minimal line icons (inherit currentColor). */
const SVG = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICONS = {
  undo: SVG(`<polyline points="9 14 4 9 9 4"/><path d="M4 9h11a5 5 0 0 1 0 10H8"/>`),
  redo: SVG(`<polyline points="15 14 20 9 15 4"/><path d="M20 9H9a5 5 0 0 0 0 10h7"/>`),
  hand: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V6a1.5 1.5 0 0 1 3 0v4"/><path d="M11 10V5a1.5 1.5 0 0 1 3 0v5"/><path d="M14 10.5V7a1.5 1.5 0 0 1 3 0v6"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.8-2.4l-2.4-3.2a1.5 1.5 0 0 1 2.4-1.8L8 12"/></svg>`,
  fit: SVG(`<path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M20 9V5a1 1 0 0 0-1-1h-4"/><path d="M4 15v4a1 1 0 0 0 1 1h4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/>`),
};

/** The floating UI shell: a modes bar (top), a per-mode toolbox (bottom-center)
 *  with a context menu above it, and status / zoom in the bottom corners.
 *  Context panels (Shapes, Colors, Noise, Animate, Export) are mounted once and
 *  shown on demand. */
export class Shell {
  private modesEl: HTMLElement;
  private toolboxEl: HTMLElement;
  private editsEl: HTMLElement;
  private settingsEl: HTMLElement;
  private sizeNum?: HTMLElement;
  private sizeMenu?: HTMLElement;
  private contextEl: HTMLElement;
  private noisePreviewEl: HTMLElement;
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
    this.editsEl = document.getElementById("edits") as HTMLElement;
    this.settingsEl = document.getElementById("settings") as HTMLElement;
    this.contextEl = document.getElementById("context") as HTMLElement;
    this.noisePreviewEl = document.getElementById("noise-preview") as HTMLElement;
    this.statusEl = document.getElementById("status") as HTMLElement;
    this.zoomEl = document.getElementById("zoombox") as HTMLElement;

    this.buildModes();
    this.buildEdits();
    this.buildSettings();
    this.buildStatus();
    this.buildZoom();
    this.mountContexts(library);

    history.onChange = () => this.refreshStatus();
    document.addEventListener("click", () => this.sizeMenu?.classList.add("hidden"));
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
    // Animate & Export keep their context menu open by default.
    if (mode === "animate") patch.contextPanel = "animate";
    if (mode === "export") patch.contextPanel = "export";
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
    new Controls(make("noise"), this.store, library, this.history, this.noisePreviewEl);
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
    opts: { title?: string; active?: boolean; icon?: boolean; onClick: () => void },
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "tool-btn" + (opts.icon ? " icon-btn" : "") + (opts.active ? " active" : "");
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

  private sep(): HTMLElement {
    const d = document.createElement("span");
    d.className = "tb-sep";
    return d;
  }

  /** Undo / redo — a separate floating box left of the toolbox. */
  private buildEdits(): void {
    this.editsEl.innerHTML = "";
    this.editsEl.append(
      this.btn(ICONS.undo, { title: "Undo (⌘Z)", icon: true, onClick: () => this.history.undo() }),
      this.btn(ICONS.redo, { title: "Redo (⌘⇧Z)", icon: true, onClick: () => this.history.redo() }),
    );
  }

  /** Cell size + Clear — a separate floating box right of the toolbox. */
  private buildSettings(): void {
    this.settingsEl.innerHTML = "";
    const clear = this.btn("Clear", {
      title: "Clear all",
      onClick: () => {
        if (Object.keys(this.store.get().instances).length) this.history.dispatch(new ClearAll());
      },
    });
    this.settingsEl.append(this.sizeDropdown(), clear);
  }

  /** Custom "Size N" dropdown (styled pill + floating list). */
  private sizeDropdown(): HTMLElement {
    const dd = document.createElement("div");
    dd.className = "size-dd";
    const btn = document.createElement("button");
    btn.className = "tool-btn size-btn";
    btn.innerHTML = `Size <b>${this.store.get().cellSize}</b>`;
    this.sizeNum = btn.querySelector("b") as HTMLElement;
    const menu = document.createElement("div");
    menu.className = "size-menu hidden";
    for (const size of [128, 64, 32, 16]) {
      const opt = document.createElement("button");
      opt.textContent = String(size);
      opt.dataset.size = String(size);
      opt.addEventListener("click", () => {
        this.store.set({ cellSize: size });
        menu.classList.add("hidden");
      });
      menu.appendChild(opt);
    }
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("hidden");
      this.syncSizeMenu();
    });
    this.sizeMenu = menu;
    dd.append(btn, menu);
    return dd;
  }

  private syncSizeMenu(): void {
    const cell = this.store.get().cellSize;
    if (this.sizeNum) this.sizeNum.textContent = String(cell);
    this.sizeMenu?.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
      b.classList.toggle("active", Number(b.dataset.size) === cell),
    );
  }

  private buildToolbox(s: SceneState): void {
    const tb = this.toolboxEl;
    tb.innerHTML = "";
    const add = (...els: HTMLElement[]) => els.forEach((e) => tb.appendChild(e));

    switch (s.mode) {
      case "draw":
        add(
          this.toolBtn("Draw", "draw", s),
          this.toolBtn("Erase", "erase", s),
          this.sep(),
          this.ctxBtn("Shapes", "shapes", s),
          this.ctxBtn("Colors", "colors", s),
        );
        break;
      case "compose":
        add(
          this.ctxBtn("Noise", "noise", s, "Noise mask: fill / erase"),
          this.sep(),
          this.ctxBtn("Shapes", "shapes", s),
          this.ctxBtn("Colors", "colors", s),
        );
        break;
      case "animate": {
        const playing = s.animation.playing;
        add(
          this.btn(playing ? "⏸ Pause" : "▶ Play", {
            active: playing,
            onClick: () => this.store.set({ animation: { ...s.animation, playing: !playing } }),
          }),
          this.toolBtn("Order", "path", s, "Draw reveal order: START→FINISH"),
        );
        break;
      }
      case "export":
        add(
          this.btn("Frame", {
            active: s.frame.show,
            title: "Toggle export frame",
            onClick: () => this.store.set({ frame: { ...s.frame, show: !s.frame.show } }),
          }),
        );
        break;
    }
  }

  // ---- Status (bottom-left) ----
  private buildStatus(): void {
    this.statusEl.innerHTML = `<span id="sh-coords">cell 0,0</span> · <span id="sh-count">0 placed</span>`;
  }

  setCoords(col: number, row: number): void {
    const el = this.statusEl.querySelector("#sh-coords");
    if (el) el.textContent = `cell ${col},${row}`;
  }

  private refreshStatus(): void {
    const count = this.statusEl.querySelector("#sh-count");
    if (count) count.textContent = `${Object.keys(this.store.get().instances).length} placed`;
  }

  // ---- Zoom (bottom-right) ----
  private buildZoom(): void {
    const zoom = (factor: number) => () => {
      const h = this.renderer.hostSize;
      this.store.set({ camera: zoomAt(this.store.get().camera, h, h.width / 2, h.height / 2, factor) });
    };
    const pan = this.btn(ICONS.hand, {
      title: "Pan (Space)",
      icon: true,
      onClick: () => this.store.set({ tool: this.store.get().tool === "pan" ? "draw" : "pan" }),
    });
    pan.id = "sh-pan";
    const label = document.createElement("span");
    label.id = "sh-zlabel";
    label.textContent = "100%";

    this.zoomEl.innerHTML = "";
    this.zoomEl.append(
      pan,
      this.sep(),
      this.btn("−", { title: "Zoom out", onClick: zoom(1 / 1.2) }),
      label,
      this.btn("+", { title: "Zoom in", onClick: zoom(1.2) }),
      this.btn(ICONS.fit, {
        title: "Reset view",
        icon: true,
        onClick: () => this.store.set({ camera: makeCamera(this.renderer.hostSize, 1) }),
      }),
    );
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

    // Context menu visibility. Some panels use a wider 2-column layout.
    const open = s.contextPanel;
    this.contextEl.classList.toggle("hidden", open === null);
    this.contextEl.classList.toggle(
      "wide",
      open === "export" || open === "animate" || open === "colors",
    );
    // The noise pixel preview floats above the context, shown only for noise.
    this.noisePreviewEl.classList.toggle("hidden", open !== "noise");
    for (const [key, host] of this.ctxHosts) host.classList.toggle("hidden", key !== open);

    // Pan + zoom.
    this.syncSizeMenu();
    this.zoomEl.querySelector("#sh-pan")!.classList.toggle("active", s.tool === "pan");
    const zl = this.zoomEl.querySelector("#sh-zlabel");
    if (zl) zl.textContent = `${Math.round(zoomOf(s.camera, this.renderer.hostSize) * 100)}%`;

    this.refreshStatus();
  }
}
