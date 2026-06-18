import "./ui/styles/app.css";
import { Store } from "./store/store";
import { History } from "./commands/command";
import { Library } from "./features/library";
import { Renderer } from "./render/renderer";
import { InputController } from "./tools/tools";
import { Shell } from "./ui/shell";
import { FrameController } from "./ui/frameController";
import { TileFrameController } from "./ui/tileFrameController";
import { AnimationEngine } from "./anim/engine";
import { loadUserAssets } from "./store/persistence";
import { AudioEngine } from "./features/audio";
import { STARTER_PALETTES } from "./features/palette";
import { fitFrame, snapToCell } from "./export/frame";
import { makeCamera, resizeCamera } from "./scene/camera";
import { FILL_SCALE } from "./features/placement";
import type { SceneState, ToolId } from "./scene/types";

// Apply the saved theme before first paint (avoids a flash).
const savedTheme =
  (() => {
    try {
      return localStorage.getItem("theme");
    } catch {
      return null;
    }
  })() === "dark"
    ? "dark"
    : "light";
document.documentElement.setAttribute("data-theme", savedTheme);

const stage = document.getElementById("stage") as HTMLElement;
const library = new Library();

const host = { width: stage.clientWidth, height: stage.clientHeight };
const camera0 = makeCamera(host, 1);

const initial: SceneState = {
  mode: "draw",
  contextPanel: null,
  tool: "draw",
  cellSize: 64,
  showGrid: true,
  showBlockers: true,
  brushAssets: ["random"],
  brushSize: 1,
  brushSpan: 1,
  brushShape: "square",
  cellRounded: false,
  cellGutter: false,
  cellFill: FILL_SCALE,
  instances: {},
  blocked: {},
  blockMode: "drag",
  blockClean: false,
  editOp: "rotate",
  editRecolorRandom: false,
  editRecolorNone: false,
  palettes: STARTER_PALETTES,
  activePaletteId: STARTER_PALETTES[0].id,
  activeColorIndex: 0,
  activeBgIndex: null,
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
    seamless: false,
  },
  stencil: {
    type: "noise",
    lock: false,
    add: false,
    stripes: { angle: 45, period: 4, ratio: 0.5 },
    image: { box: null, threshold: 0.5, invert: false },
    text: { text: "HELLO", size: 6, bold: true, box: null },
  },
  halftone: {
    mode: "halftone",
    target: "glyph",
    invert: false,
    shapeByLum: false,
    contrast: 1,
    scale: 1,
  },
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
  frame: { aspect: "1:1", ...fitFrame(camera0, "1:1"), outHeight: 1080, show: false, snap: true },
  tileFrame: (() => {
    const side = 8 * 64; // 8×8 cells, centered in the initial view, cell-aligned
    return {
      x: snapToCell(camera0.x + (camera0.w - side) / 2, 64),
      y: snapToCell(camera0.y + (camera0.h - side) / 2, 64),
      w: side,
      h: side,
    };
  })(),
  divider: { density: 5, seed: 1337 },
  bgColor: savedTheme === "dark" ? "#111110" : "#f7f5ef",
  exportTransparent: false,
  exportHalftone: false,
  camera: camera0,
};

const store = new Store(initial);
const renderer = new Renderer(stage, library);
const history = new History(store);

// Live canvas background color + pan cursor (hand when the Pan tool is active).
let prevBg = "";
store.subscribe((s) => {
  if (s.bgColor !== prevBg) {
    prevBg = s.bgColor;
    stage.style.backgroundColor = s.bgColor;
  }
  stage.classList.toggle("tool-pan", s.tool === "pan");
});
stage.style.backgroundColor = initial.bgColor;

let prevPaletteId = initial.activePaletteId;

const paint = (t: number) => renderer.render(store.get(), t);

// The engine owns the clock while playing and paints every frame.
const engine = new AnimationEngine(paint);

// --- Render loop: while paused, re-render on state change (rAF-coalesced).
//     While playing, the engine paints continuously. ---
let rafQueued = false;
let prevPlaying = initial.animation.playing;
// Drop the panels' backdrop-blur while the scene moves behind them (playing, or
// during pan/zoom) — blur would recomposite every frame. Pan/zoom uses a short
// idle debounce so it restores once you stop.
let prevCam = initial.camera;
let blurIdleTimer = 0;
store.subscribe((state) => {
  if (state.activePaletteId !== prevPaletteId) {
    prevPaletteId = state.activePaletteId;
    renderer.invalidate();
  }
  if (state.camera !== prevCam) {
    prevCam = state.camera;
    if (!state.animation.playing) {
      document.body.classList.add("perf-noblur");
      clearTimeout(blurIdleTimer);
      blurIdleTimer = window.setTimeout(() => {
        if (!engine.isPlaying) document.body.classList.remove("perf-noblur");
      }, 200);
    }
  }
  if (state.animation.playing !== prevPlaying) {
    prevPlaying = state.animation.playing;
    document.body.classList.toggle("perf-noblur", state.animation.playing);
    if (state.animation.playing) engine.play();
    else {
      engine.pause();
      paint(engine.now());
    }
  }
  if (engine.isPlaying) return;
  if (!rafQueued) {
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      paint(engine.now());
    });
  }
});

// Generative UI sound (muted preference persisted, like the theme).
const audio = new AudioEngine(
  (() => {
    try {
      return localStorage.getItem("muted") === "1";
    } catch {
      return false;
    }
  })(),
);

// Floating UI shell (modes / toolbox / context / status / zoom).
const shell = new Shell(store, history, library, renderer, audio);

new InputController(store, history, library, renderer, audio, (col, row) => shell.setCoords(col, row));
new FrameController(store, renderer);
new TileFrameController(store, renderer);

// Restore user-uploaded assets from IndexedDB (async, after first paint).
loadUserAssets().then((assets) => {
  if (!assets.length) return;
  for (const a of assets) library.add(a);
  store.set({ brushAssets: [...store.get().brushAssets] });
});

// --- Keyboard shortcuts ---
window.addEventListener("keydown", (e) => {
  const meta = e.metaKey || e.ctrlKey;
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "SELECT") return;
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
let lastHost = renderer.hostSize;
new ResizeObserver(() => {
  const nextHost = renderer.hostSize;
  store.set({ camera: resizeCamera(store.get().camera, lastHost, nextHost) });
  lastHost = nextHost;
}).observe(stage);

// --- First paint ---
paint(0);
