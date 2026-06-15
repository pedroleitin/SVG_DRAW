import "./ui/styles/app.css";
import { Store } from "./store/store";
import { History } from "./commands/command";
import { Library } from "./features/library";
import { Renderer } from "./render/renderer";
import { InputController } from "./tools/tools";
import { Sidebar } from "./ui/sidebar";
import { Controls } from "./ui/controls";
import { AnimPanel } from "./ui/animPanel";
import { ExportPanel } from "./ui/exportPanel";
import { FrameController } from "./ui/frameController";
import { AnimationEngine } from "./anim/engine";
import { ClearAll } from "./commands/sceneCommands";
import { loadUserAssets } from "./store/persistence";
import { STARTER_PALETTES } from "./features/palette";
import { fitFrame } from "./export/frame";
import { makeCamera, zoomOf, resizeCamera, zoomAt } from "./scene/camera";
import type { SceneState, ToolId } from "./scene/types";

const stage = document.getElementById("stage") as HTMLElement;
const library = new Library();

const host = { width: stage.clientWidth, height: stage.clientHeight };
const camera0 = makeCamera(host, 1);

const initial: SceneState = {
  tool: "draw",
  cellSize: 64,
  brushAsset: "random",
  instances: {},
  palettes: STARTER_PALETTES,
  activePaletteId: STARTER_PALETTES[0].id,
  activeColorIndex: 0,
  mask: {
    scale: 10,
    octaves: 4,
    persistence: 0.5,
    contrast: 1.3,
    brightness: 0,
    threshold: 0.5,
    seed: 1337,
    offsetX: 0,
    offsetY: 0,
  },
  maskPreview: false,
  animation: {
    playing: false,
    playback: "loop",
    speed: 1,
    order: "linear",
    direction: "left-right",
    spread: 1.5,
    enter: "fade",
    exit: "none",
    enterDur: 0.5,
    hold: 1,
    exitDur: 0.5,
    idle: "none",
    idleAmount: 0.6,
  },
  orderPath: [],
  frame: { aspect: "1:1", ...fitFrame(camera0, "1:1"), outWidth: 1080, show: false, snap: true },
  bgColor: "#f7f5ef",
  exportTransparent: false,
  camera: camera0,
};

const store = new Store(initial);
const renderer = new Renderer(stage, library);

// Live canvas background color.
let prevBg = "";
store.subscribe((s) => {
  if (s.bgColor !== prevBg) {
    prevBg = s.bgColor;
    stage.style.backgroundColor = s.bgColor;
  }
});
stage.style.backgroundColor = initial.bgColor;

let prevPaletteId = initial.activePaletteId;
const history = new History(store, refreshHistoryButtons);

const paint = (t: number) => {
  renderer.render(store.get(), t);
  updateStatus();
};

// The engine owns the clock while playing and paints every frame.
const engine = new AnimationEngine(paint);

// --- Render loop: while paused, re-render on state change (rAF-coalesced).
//     While playing, the engine already paints continuously, so we only need
//     to handle palette invalidation here and let the next frame reflect it. ---
let rafQueued = false;
let prevPlaying = initial.animation.playing;
store.subscribe((state) => {
  if (state.activePaletteId !== prevPaletteId) {
    prevPaletteId = state.activePaletteId;
    renderer.invalidate();
  }
  if (state.animation.playing !== prevPlaying) {
    prevPlaying = state.animation.playing;
    if (state.animation.playing) engine.play();
    else {
      engine.pause();
      paint(engine.now()); // settle on the paused frame
    }
  }
  if (engine.isPlaying) return; // engine's rAF will paint this change next frame
  if (!rafQueued) {
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      paint(engine.now());
    });
  }
});

new InputController(store, history, library, renderer, (col, row) => {
  const el = document.getElementById("status-coords")!;
  el.textContent = `cell ${col},${row}`;
});

// Sidebar: library drawer + palette editor, then the noise controls panel.
const sidebarEl = document.getElementById("sidebar") as HTMLElement;
new Sidebar(sidebarEl, store, library, renderer);
new Controls(sidebarEl, store, library, history);
new AnimPanel(sidebarEl, store);
new ExportPanel(sidebarEl, store, library);
new FrameController(store, renderer);

// Restore user-uploaded assets from IndexedDB (async, after first paint).
loadUserAssets().then((assets) => {
  if (!assets.length) return;
  for (const a of assets) library.add(a);
  // Nudge the store so the sidebar rebuilds with the restored assets.
  store.set({ brushAsset: store.get().brushAsset });
});

// --- Toolbar wiring ---
document.querySelectorAll<HTMLButtonElement>("#tool-group button").forEach((btn) => {
  btn.addEventListener("click", () => store.set({ tool: btn.dataset.tool as ToolId }));
});
// Keep the toolbar highlight in sync with state.tool, wherever it changes from
// (clicks, keyboard, or selecting the "free" order mode).
store.subscribe((s) => {
  document
    .querySelectorAll<HTMLButtonElement>("#tool-group button")
    .forEach((b) => b.classList.toggle("active", b.dataset.tool === s.tool));
});

const gridSelect = document.getElementById("grid-size") as HTMLSelectElement;
gridSelect.addEventListener("change", () => {
  store.set({ cellSize: Number(gridSelect.value) });
});

document.getElementById("undo")!.addEventListener("click", () => history.undo());
document.getElementById("redo")!.addEventListener("click", () => history.redo());
document.getElementById("clear")!.addEventListener("click", () => {
  if (Object.keys(store.get().instances).length) history.dispatch(new ClearAll());
});

const zoomButton = (factor: number) => () => {
  const h = renderer.hostSize;
  store.set({ camera: zoomAt(store.get().camera, h, h.width / 2, h.height / 2, factor) });
};
document.getElementById("zoom-in")!.addEventListener("click", zoomButton(1.2));
document.getElementById("zoom-out")!.addEventListener("click", zoomButton(1 / 1.2));
document.getElementById("zoom-reset")!.addEventListener("click", () => {
  store.set({ camera: makeCamera(renderer.hostSize, 1) });
});

// --- Keyboard shortcuts ---
window.addEventListener("keydown", (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? history.redo() : history.undo();
  } else if (!meta && e.key.toLowerCase() === "b") {
    setTool("draw");
  } else if (!meta && e.key.toLowerCase() === "e") {
    setTool("erase");
  } else if (!meta && e.key.toLowerCase() === "p") {
    setTool("path");
  }
});

function setTool(tool: ToolId) {
  store.set({ tool });
}

// --- Resize handling ---
const resize = () => {
  const prev = { width: store.get().camera.w, height: store.get().camera.h };
  void prev;
  const prevHost = lastHost;
  const nextHost = renderer.hostSize;
  store.set({ camera: resizeCamera(store.get().camera, prevHost, nextHost) });
  lastHost = nextHost;
};
let lastHost = renderer.hostSize;
new ResizeObserver(resize).observe(stage);

function updateStatus() {
  const s = store.get();
  document.getElementById("status-count")!.textContent =
    `${Object.keys(s.instances).length} placed`;
  document.getElementById("zoom-label")!.textContent =
    `${Math.round(zoomOf(s.camera, renderer.hostSize) * 100)}%`;
}

function refreshHistoryButtons() {
  (document.getElementById("undo") as HTMLButtonElement).disabled = !history.canUndo();
  (document.getElementById("redo") as HTMLButtonElement).disabled = !history.canRedo();
}

// --- First paint ---
paint(0);
refreshHistoryButtons();
