import type { Store } from "../store/store";
import type { History } from "../commands/command";
import type { Library } from "../features/library";
import type { Renderer } from "../render/renderer";
import type { Mode, ContextPanel, SceneState, ToolId } from "../scene/types";
import { ClearAll } from "../commands/sceneCommands";
import { makeCamera, zoomOf, zoomAt } from "../scene/camera";
import { createDropdown } from "./widgets";
import type { DropdownHandle } from "./widgets";
import { icon, useIconFor } from "./icons";
import { morphResize, morphOpen, morphClose } from "./morph";
import type { AudioEngine } from "../features/audio";
import { BrushPanel } from "./brushPanel";
import { BlockPanel } from "./blockPanel";
import { GridPanel } from "./gridPanel";
import { SeamlessPanel } from "./seamlessPanel";
import { DividerPanel } from "./dividerPanel";
import { HalftonePanel } from "./halftonePanel";
import { EditPanel } from "./editPanel";
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

/** Contexts whose menu carries the shared Brush / Size / Cell footer. */
const BRUSH_CONTEXTS = new Set<ContextPanel>(["stencil", "divider", "seamless", "block", "edit"]);

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
  private gridBtn!: HTMLButtonElement;
  private playBtn!: HTMLButtonElement;
  private sizeDD?: DropdownHandle;
  private contextEl: HTMLElement;
  private ctxBodyEl!: HTMLElement;
  private brushHostEl!: HTMLElement;
  private ctxAboveEl: HTMLElement;
  private statusEl: HTMLElement;
  private zoomEl: HTMLElement;
  private ctxHosts = new Map<string, HTMLElement>();
  private toolboxSig = "";
  private prevToolboxMode: Mode | undefined;
  private prevCtxShown: boolean | undefined;
  private prevBodySig: string | null | undefined;
  private prevLabels: boolean | undefined;

  constructor(
    private store: Store,
    private history: History,
    library: Library,
    private renderer: Renderer,
    private audio: AudioEngine,
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
    this.buildSound();
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
      btn.innerHTML = dark ? icon("sun") : icon("moon");
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
      void this.audio.theme(next === "dark");
    });
  }

  /** Sound on/off toggle (top-right, left of the theme toggle). */
  private buildSound(): void {
    const btn = document.getElementById("sound-toggle") as HTMLButtonElement;
    const render = () => {
      btn.innerHTML = this.audio.muted ? icon("soundOff") : icon("soundOn");
      btn.title = this.audio.muted ? "Sound off" : "Sound on";
    };
    render();
    btn.addEventListener("click", () => {
      this.audio.setMuted(!this.audio.muted);
      try {
        localStorage.setItem("muted", this.audio.muted ? "1" : "0");
      } catch {
        /* ignore */
      }
      render();
      // A little confirmation note when turning sound back on.
      if (!this.audio.muted) this.audio.note(9);
    });
  }

  private setMode(mode: Mode): void {
    const patch: Partial<SceneState> = { mode, contextPanel: null };
    if (mode === "draw" || mode === "compose") patch.tool = "draw";
    // Compose, Animate & Export open with their primary context menu.
    if (mode === "compose") patch.contextPanel = "edit";
    if (mode === "animate") patch.contextPanel = "animate";
    if (mode === "export") patch.contextPanel = "export";
    // Export mode shows the frame as its working affordance.
    patch.frame = { ...this.store.get().frame, show: mode === "export" };
    this.store.set(patch);
  }

  // ---- Context panels ----
  private mountContexts(library: Library): void {
    // The panels live in a scrollable body; the brush footer sits below it (and
    // outside the scroll) so it's always visible even when a panel is tall.
    this.ctxBodyEl = document.createElement("div");
    this.ctxBodyEl.id = "ctx-body";
    this.contextEl.appendChild(this.ctxBodyEl);
    const make = (key: string) => {
      const div = document.createElement("div");
      div.className = "ctx-panel";
      div.dataset.ctx = key;
      this.ctxBodyEl.appendChild(div);
      this.ctxHosts.set(key, div);
      return div;
    };
    new GridPanel(make("grid"), this.store);
    new BlockPanel(make("block"), this.store);
    new SeamlessPanel(make("seamless"), this.store, this.history);
    new DividerPanel(make("divider"), this.store, library, this.history);
    new HalftonePanel(make("halftone"), this.store, library, this.history);
    new EditPanel(make("edit"), this.store);
    new ShapesPanel(make("shapes"), this.store, library);
    new ColorsPanel(make("colors"), this.store, this.renderer);
    new Controls(make("stencil"), this.store, library, this.history);
    new AnimPanel(make("animate"), this.store);
    new ExportPanel(make("export"), this.store, library, this.ctxAboveEl);

    // Shared Brush / Size / Cell controls — a footer inside the context box,
    // shown below the active panel for brush-relevant contexts (and base draw).
    this.brushHostEl = document.createElement("div");
    this.brushHostEl.id = "ctx-brush";
    this.contextEl.appendChild(this.brushHostEl);
    new BrushPanel(this.brushHostEl, this.store);
  }

  /** The context a mode falls back to when you close the current one. Animate &
   *  Export have a primary panel with no toolbox button to reopen it, so closing
   *  another context (e.g. Grid) must return there rather than to nothing. */
  private homeContext(mode: Mode): ContextPanel {
    if (mode === "animate") return "animate";
    if (mode === "export") return "export";
    return null;
  }

  private toggleContext(key: Exclude<ContextPanel, null>): void {
    const s = this.store.get();
    const opening = s.contextPanel !== key;
    const patch: Partial<SceneState> = {
      contextPanel: opening ? key : this.homeContext(s.mode),
    };
    // The Block tool is bound to its own panel; opening any other context exits
    // it, so the new panel's drawing (e.g. the Noise stencil) works right away.
    if (opening && key !== "block" && s.tool === "block") patch.tool = "draw";
    this.store.set(patch);
  }

  // ---- Toolbox (per mode) ----
  private btn(
    label: string,
    opts: { title?: string; active?: boolean; icon?: boolean; iconKey?: string; onClick: () => void },
  ): HTMLButtonElement {
    const b = document.createElement("button");
    const asIcon = useIconFor(opts.iconKey, this.store.get().labels);
    b.className = "tool-btn" + (opts.icon || asIcon ? " icon-btn" : "") + (opts.active ? " active" : "");
    b.innerHTML = asIcon ? icon(opts.iconKey as string) : label;
    const isHtmlLabel = /^\s*</.test(label);
    if (opts.title) b.title = opts.title;
    else if (!isHtmlLabel) b.title = label;
    b.addEventListener("click", opts.onClick);
    return b;
  }

  private ctxBtn(label: string, key: Exclude<ContextPanel, null>, s: SceneState, title?: string): HTMLButtonElement {
    return this.btn(label, { title, iconKey: key, active: s.contextPanel === key, onClick: () => this.toggleContext(key) });
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
      this.btn(icon("undo"), { title: "Undo (⌘Z)", icon: true, onClick: () => this.history.undo() }),
      this.btn(icon("redo"), { title: "Redo (⌘⇧Z)", icon: true, onClick: () => this.history.redo() }),
    );
  }

  /** Play + Grid + cell size + Clear — a separate floating box right of the toolbox. */
  private buildSettings(): void {
    this.settingsEl.innerHTML = "";
    // Play/Pause — only shown while an animation is playing outside Animate mode,
    // so you can pause from any mode. Toggled visible in sync().
    this.playBtn = this.btn("⏸", {
      title: "Pause animation",
      icon: true,
      onClick: () => {
        const a = this.store.get().animation;
        this.store.set({ animation: { ...a, playing: !a.playing } });
      },
    });
    this.playBtn.style.display = "none";
    // Grid appearance toggle (global).
    this.gridBtn = this.btn("Grid", {
      iconKey: "grid",
      title: "Grid & cell appearance",
      onClick: () => this.toggleContext("grid"),
    });
    const clear = this.btn("Clear", {
      iconKey: "clear",
      title: "Clear all",
      onClick: () => {
        if (Object.keys(this.store.get().instances).length) this.history.dispatch(new ClearAll());
      },
    });
    this.sizeDD = createDropdown(
      [128, 64, 32, 16].map((n) => ({ value: String(n) })),
      String(this.store.get().cellSize),
      (v) => this.store.set({ cellSize: Number(v) }),
      { prefix: "Size", title: "Cell size in pixels" },
    );
    this.settingsEl.append(this.playBtn, this.gridBtn, this.sizeDD.el, clear);
  }

  private buildToolbox(s: SceneState): void {
    const tb = this.toolboxEl;
    tb.innerHTML = "";
    const add = (...els: HTMLElement[]) => els.forEach((e) => tb.appendChild(e));

    switch (s.mode) {
      case "draw": {
        // Draw/Erase are painting modes; opening Shapes/Colors deselects them
        // (and clicking either closes the open context menu).
        const painting = s.contextPanel === null;
        const paintBtn = (label: string, tool: ToolId, iconKey: string) =>
          this.btn(label, {
            iconKey,
            active: painting && s.tool === tool,
            onClick: () => this.store.set({ tool, contextPanel: null }),
          });
        add(
          paintBtn("Draw", "draw", "draw"),
          paintBtn("Erase", "erase", "erase"),
          paintBtn("Line", "line", "line"),
          this.btn("Block", {
            iconKey: "block",
            // Stays the active tool while its own panel (or none) is open, but
            // dims when another context takes over — like Draw/Erase do.
            active: s.tool === "block" && (s.contextPanel === "block" || s.contextPanel === null),
            title: "Block cells — no SVGs allowed",
            onClick: () => this.store.set({ tool: "block", contextPanel: "block" }),
          }),
          this.ctxBtn("Stencil", "stencil", s, "Stencil: paint inside a mask"),
          this.sep(),
          this.ctxBtn("Shapes", "shapes", s),
          this.ctxBtn("Colors", "colors", s),
        );
        break;
      }
      case "compose": {
        // Seamless opens its context AND enables the tile frame; closing it
        // turns the mode back off.
        const seamOpen = s.contextPanel === "seamless";
        add(
          this.btn("Seamless", {
            iconKey: "seamless",
            active: seamOpen,
            title: "Seamless tile pattern",
            onClick: () =>
              this.store.set({
                contextPanel: seamOpen ? null : "seamless",
                mask: { ...s.mask, seamless: !seamOpen },
              }),
          }),
          this.ctxBtn("Divider", "divider", s, "Recursive subdivision"),
          this.ctxBtn("Halftone", "halftone", s, "Render an image with the shapes"),
          this.ctxBtn("Edit", "edit", s, "Edit items: rotate / swap / recolor"),
        );
        break;
      }
      case "animate": {
        const playing = s.animation.playing;
        add(
          this.btn(playing ? "⏸ Pause" : "▶ Play", {
            active: playing,
            // Read the live animation state (the toolbox isn't rebuilt when the
            // order combobox changes, so a captured `s` would revert it).
            onClick: () => {
              const a = this.store.get().animation;
              this.store.set({ animation: { ...a, playing: !a.playing } });
            },
          }),
          this.btn("Path", {
            // Arm the path tool AND switch the order to "draw path" (free) so the
            // combobox stays in sync.
            active: s.tool === "path",
            title: "Draw reveal order: START→FINISH",
            onClick: () => {
              const a = this.store.get().animation;
              this.store.set({ tool: "path", animation: { ...a, order: "free" } });
            },
          }),
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
    this.statusEl.innerHTML = `cell <span id="sh-coords">0,0</span> · <span id="sh-count">0</span>`;
  }

  setCoords(col: number, row: number): void {
    const el = this.statusEl.querySelector("#sh-coords");
    if (el) el.textContent = `${col},${row}`;
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
    const pan = this.btn(icon("hand"), {
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
      this.btn(icon("fit"), {
        title: "Reset view",
        icon: true,
        onClick: () => this.store.set({ camera: makeCamera(this.renderer.hostSize, 1) }),
      }),
    );
  }

  /** The Brush/Size/Cell footer shows for brush-relevant contexts (generators)
   *  and for base draw/erase — but not Shapes/Colors or appearance panels. */
  private brushVisible(s: SceneState): boolean {
    if (s.contextPanel && BRUSH_CONTEXTS.has(s.contextPanel)) return true;
    return (
      s.contextPanel === null &&
      (s.mode === "draw" || s.mode === "compose") &&
      (s.tool === "draw" || s.tool === "erase" || s.tool === "line")
    );
  }

  /** Toggle the context container's layout classes + show the active panel and
   *  the shared brush footer. */
  private applyContext(s: SceneState): void {
    const open = s.contextPanel;
    const brush = this.brushVisible(s);
    const showCtx = open != null || brush;
    this.contextEl.classList.toggle("hidden", !showCtx);
    // Wider 2-column panels. Noise also has 2 columns but carries the footer, so
    // it fits its content instead (the fixed width would crop the footer).
    const wide = open === "export" || open === "animate" || open === "colors";
    this.contextEl.classList.toggle("wide", wide);
    this.contextEl.classList.toggle("anim", open === "animate");
    // Edit gets a fixed wider width so the Recolor swatches have room to wrap as
    // more colors are added (instead of fitting tight to the current count).
    this.contextEl.classList.toggle("edit", open === "edit");
    // Halftone is a 2-column panel (controls + inline Shapes), so it gets its
    // own wider fixed width.
    this.contextEl.classList.toggle("ht", open === "halftone");
    // Any non-wide box that carries the brush footer fits its content, so a
    // small panel doesn't crowd the footer's controls on narrow windows.
    this.contextEl.classList.toggle(
      "fit",
      !wide && open !== "edit" && open !== "halftone" && (brush || open === "shapes"),
    );
    // Drop the footer's divider when there's no panel above it.
    this.contextEl.classList.toggle("brush-only", open === null && brush);
    // The output-size pill above the context belongs to Export only.
    this.ctxAboveEl.classList.toggle("hidden", open !== "export");
    for (const [key, host] of this.ctxHosts) host.classList.toggle("hidden", key !== open);
    this.brushHostEl.classList.toggle("hidden", !brush);
  }

  // ---- Reactive sync ----
  private sync(s: SceneState): void {
    // Labels toggle swaps text ↔ icons on the fixed boxes; rebuild them and force
    // the toolbox to rebuild (its buttons carry labels too).
    if (this.prevLabels !== s.labels) {
      const first = this.prevLabels === undefined;
      this.prevLabels = s.labels;
      if (!first) {
        this.buildEdits();
        this.buildSettings();
        this.buildZoom();
        this.toolboxSig = "";
      }
    }

    // Modes highlight.
    this.modesEl.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === s.mode),
    );

    // Toolbox: morph (fade out → resize → fade in) only when the MODE changes —
    // within a mode the buttons are the same set (just the active highlight
    // moves), so rebuild instantly.
    const sig = [s.mode, s.tool, s.contextPanel, s.cellSize, s.animation.playing, s.frame.show, s.showGrid, s.mask.seamless, s.labels].join("|");
    if (sig !== this.toolboxSig) {
      const first = this.toolboxSig === "";
      const modeChanged = this.prevToolboxMode !== s.mode;
      this.toolboxSig = sig;
      this.prevToolboxMode = s.mode;
      if (first || !modeChanged) this.buildToolbox(s);
      else morphResize(this.toolboxEl, () => this.buildToolbox(s));
    }

    // The context box opens/closes as a whole (morph #context); a panel→panel
    // switch morphs only the BODY (#ctx-body), so the shared brush footer below
    // it stays fixed (the bottom-anchored box keeps it in place).
    const open = s.contextPanel;
    const shown = open != null || this.brushVisible(s);
    const bodySig = `${open}`;
    const prevShown = this.prevCtxShown;
    const prevBody = this.prevBodySig;
    this.prevCtxShown = shown;
    this.prevBodySig = shown ? bodySig : null;
    const commit = () => this.applyContext(s);
    if (prevShown === undefined) {
      commit(); // first sync (no anim)
    } else if (shown && !prevShown) {
      morphOpen(this.contextEl, commit); // box appears
    } else if (!shown && prevShown) {
      morphClose(this.contextEl, commit); // box disappears
    } else if (shown && prevBody !== bodySig) {
      morphResize(this.ctxBodyEl, commit); // swap the body; footer stays put
    } else {
      commit(); // no visual change
    }

    // Settings box: Grid toggle highlight + cell size. The Play/Pause button
    // shows only while an animation plays outside Animate mode (Animate already
    // has its own Play in the toolbox).
    this.gridBtn.classList.toggle("active", s.contextPanel === "grid");
    const showPlay = s.animation.playing && s.mode !== "animate";
    this.playBtn.style.display = showPlay ? "" : "none";
    this.playBtn.classList.toggle("active", s.animation.playing);
    this.sizeDD?.setValue(String(s.cellSize));
    this.zoomEl.querySelector("#sh-pan")!.classList.toggle("active", s.tool === "pan");
    const zl = this.zoomEl.querySelector("#sh-zlabel");
    if (zl) zl.textContent = `${Math.round(zoomOf(s.camera, this.renderer.hostSize) * 100)}%`;

    this.refreshStatus();
  }
}
