import type { Store } from "../store/store";
import type { History } from "../commands/command";
import type { Library } from "../features/library";
import type { Renderer } from "../render/renderer";
import type { Mode, ContextPanel, SceneState, ToolId } from "../scene/types";
import { ClearAll } from "../commands/sceneCommands";
import { makeCamera, zoomOf, zoomAt } from "../scene/camera";
import { createDropdown } from "./widgets";
import type { DropdownHandle } from "./widgets";
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
  hand: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`,
  fit: SVG(`<path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M20 9V5a1 1 0 0 0-1-1h-4"/><path d="M4 15v4a1 1 0 0 0 1 1h4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/>`),
  sun: SVG(
    `<circle cx="12" cy="12" r="4"/><path d="M12 3v1.6M12 19.4V21M4.6 4.6l1.1 1.1M18.3 18.3l1.1 1.1M3 12h1.6M19.4 12H21M4.6 19.4l1.1-1.1M18.3 5.7l1.1-1.1"/>`,
  ),
  moon: SVG(`<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/>`),
};

const THEME_BG: Record<string, string> = { light: "#f7f5ef", dark: "#111110" };

/** The floating UI shell: a modes bar (top), a per-mode toolbox (bottom-center)
 *  with a context menu above it, and status / zoom in the bottom corners.
 *  Context panels (Shapes, Colors, Noise, Animate, Export) are mounted once and
 *  shown on demand. */
export class Shell {
  private modesEl: HTMLElement;
  private toolboxEl: HTMLElement;
  private editsEl: HTMLElement;
  private settingsEl: HTMLElement;
  private sizeDD?: DropdownHandle;
  private contextEl: HTMLElement;
  private ctxAboveEl: HTMLElement;
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
    this.ctxAboveEl = document.getElementById("ctx-above") as HTMLElement;
    this.statusEl = document.getElementById("status") as HTMLElement;
    this.zoomEl = document.getElementById("zoombox") as HTMLElement;

    this.buildModes();
    this.buildTheme();
    this.buildEdits();
    this.buildSettings();
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

  /** Light/dark theme toggle (top-right). The canvas bg follows the theme. */
  private buildTheme(): void {
    const btn = document.getElementById("theme-toggle") as HTMLButtonElement;
    const render = () => {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      btn.innerHTML = dark ? ICONS.sun : ICONS.moon;
    };
    render();
    btn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch {
        /* ignore */
      }
      this.store.set({ bgColor: THEME_BG[next] });
      render();
    });
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
    new Controls(make("noise"), this.store, library, this.history);
    new AnimPanel(make("animate"), this.store);
    new ExportPanel(make("export"), this.store, library, this.ctxAboveEl);
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
    this.sizeDD = createDropdown(
      [128, 64, 32, 16].map((n) => ({ value: String(n) })),
      String(this.store.get().cellSize),
      (v) => this.store.set({ cellSize: Number(v) }),
      { prefix: "Size" },
    );
    this.settingsEl.append(this.sizeDD.el, clear);
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
          this.btn("Grid", {
            active: s.showGrid,
            title: "Toggle grid",
            onClick: () => this.store.set({ showGrid: !s.showGrid }),
          }),
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
    this.statusEl.innerHTML = `<span id="sh-coords">cell 0,0</span> · <span id="sh-count">0</span>`;
  }

  setCoords(col: number, row: number): void {
    const el = this.statusEl.querySelector("#sh-coords");
    if (el) el.textContent = `cell ${col},${row}`;
  }

  private refreshStatus(): void {
    const count = this.statusEl.querySelector("#sh-count");
    if (count) count.textContent = String(Object.keys(this.store.get().instances).length);
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
    const sig = [s.mode, s.tool, s.contextPanel, s.cellSize, s.animation.playing, s.frame.show, s.showGrid].join("|");
    if (sig !== this.toolboxSig) {
      this.toolboxSig = sig;
      this.buildToolbox(s);
    }

    // Context menu visibility. Some panels use a wider 2-column layout.
    const open = s.contextPanel;
    this.contextEl.classList.toggle("hidden", open === null);
    this.contextEl.classList.toggle(
      "wide",
      open === "noise" || open === "export" || open === "animate" || open === "colors",
    );
    this.contextEl.classList.toggle("anim", open === "animate");
    // The output-size pill above the context belongs to Export only.
    this.ctxAboveEl.classList.toggle("hidden", open !== "export");
    for (const [key, host] of this.ctxHosts) host.classList.toggle("hidden", key !== open);

    // Pan + zoom.
    this.sizeDD?.setValue(String(s.cellSize));
    this.zoomEl.querySelector("#sh-pan")!.classList.toggle("active", s.tool === "pan");
    const zl = this.zoomEl.querySelector("#sh-zlabel");
    if (zl) zl.textContent = `${Math.round(zoomOf(s.camera, this.renderer.hostSize) * 100)}%`;

    this.refreshStatus();
  }
}
