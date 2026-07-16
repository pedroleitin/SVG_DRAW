import type { Store } from "../store/store";
import type { SceneState } from "../scene/types";
import {
  ORDER_MODES,
  DIRECTIONS,
  PLAYBACK_MODES,
  ENTER_EXITS,
  IDLE_IDS,
} from "../anim/animations";
import type { AnimationConfig, OrderMode } from "../anim/animations";
import { createDropdown, createSlider } from "./widgets";
import type { DropdownHandle, SliderHandle } from "./widgets";

/** Order modes offered for the animated-shape phase stagger (a sensible subset
 *  of the reveal orders — no "all"/"free"/"halftone"). */
const SHAPE_ORDER_MODES: OrderMode[] = ["random", "radial", "linear", "sequential"];

/** "left-right" -> "Left-Right", "linear" -> "Linear". */
const titleCase = (s: string): string =>
  s.replace(/[a-z]+/g, (w) => w[0].toUpperCase() + w.slice(1));

/** Animation panel — lifecycle + order + playback.
 *  - Order: how SVGs are sequenced in (linear/radial/sequential/random/free).
 *  - Enter/Exit: how each SVG forms in and out (fade/scale/pop/rotate).
 *  - Playback: loop / ping-pong / once.
 *  Toggling Play flips animation.playing; main.ts runs the engine. */
export class AnimPanel {
  private dropdowns = new Map<keyof AnimationConfig, { dd: DropdownHandle; wrap: HTMLElement }>();
  private sliders = new Map<keyof AnimationConfig, SliderHandle>();
  private toggles = new Map<keyof AnimationConfig, { btn: HTMLElement; paint: () => void }>();

  constructor(host: HTMLElement, private store: Store) {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "anim-panel";
    panel.innerHTML = `
      <h2>Animation</h2>
      <div class="anim-cols">
        <div class="anim-selects" id="anim-selects"></div>
        <div class="anim-sliders" id="anim-sliders"></div>
      </div>
      <h3 class="anim-sub">Animated shapes</h3>
      <div class="anim-shapes" id="anim-shapes"></div>`;
    host.appendChild(panel);

    const selHost = panel.querySelector("#anim-selects")!;
    // "free" is the hand-drawn path mode — show it as "draw path".
    this.addSelect(selHost, "order", "Order", ORDER_MODES, { free: "draw path", all: "all at once" });
    this.addSelect(selHost, "direction", "Dir", DIRECTIONS);
    this.addSelect(selHost, "enter", "Intro", ENTER_EXITS);
    this.addSelect(selHost, "exit", "Outro", ENTER_EXITS);
    this.addSelect(selHost, "playback", "Playback", PLAYBACK_MODES);
    this.addSelect(selHost, "idle", "Idle", IDLE_IDS);

    const slHost = panel.querySelector("#anim-sliders")!;
    this.addSlider(slHost, "speed", "Speed", 0.1, 3, 0.05);
    this.addSlider(slHost, "spread", "Spread", 0, 6, 0.1);
    this.addSlider(slHost, "enterDur", "Intro dur", 0, 3, 0.05);
    this.addSlider(slHost, "hold", "Hold", 0, 10, 0.1);
    this.addSlider(slHost, "exitDur", "Outro dur", 0, 3, 0.05);
    this.addSlider(slHost, "idleAmount", "Idle amt", 0, 1, 0.01);

    // Animated-shape controls: Sync (lockstep vs staggered), Order (how the
    // stagger sweeps the grid), Reverse (play back down), and the Rest hold.
    const shHost = panel.querySelector("#anim-shapes")!;
    this.addToggle(shHost, "shapeSync", "Sync", "Synced", "Per-shape");
    this.addSelect(shHost, "shapeOrder", "Order", SHAPE_ORDER_MODES);
    this.addToggle(shHost, "shapeReverse", "Reverse", "On", "Off");
    this.addSlider(shHost, "shapeRest", "Rest", 0, 5, 0.05);
    this.addToggle(shHost, "shapeRestRandom", "Random rest", "On", "Off");

    this.sync(store.get());
    store.subscribe((s) => this.sync(s));
  }

  /** A checkbox (GG2 switch, `.chk`) bound to a boolean config key. */
  private addToggle(
    host: Element,
    key: keyof AnimationConfig,
    label: string,
    _onLabel: string,
    _offLabel: string,
  ): void {
    const wrap = document.createElement("label");
    wrap.className = "chk anim-chk";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.type = "checkbox";
    const paint = () => {
      input.checked = this.store.get().animation[key] as boolean;
    };
    input.addEventListener("change", () => {
      this.set({ [key]: input.checked } as Partial<AnimationConfig>);
    });
    wrap.append(span, input);
    paint();
    this.toggles.set(key, { btn: wrap, paint });
    host.appendChild(wrap);
  }

  private addSelect(
    host: Element,
    key: keyof AnimationConfig,
    prefix: string,
    options: readonly string[],
    labels: Record<string, string> = {},
  ): void {
    const dd = createDropdown(
      options.map((o) => ({ value: o, label: labels[o] ?? titleCase(o) })),
      String(this.store.get().animation[key]),
      (v) => this.set({ [key]: v } as Partial<AnimationConfig>),
      { prefix },
    );
    this.dropdowns.set(key, { dd, wrap: dd.el });
    host.appendChild(dd.el);
  }

  private addSlider(
    host: Element,
    key: keyof AnimationConfig,
    label: string,
    min: number,
    max: number,
    step: number,
  ): void {
    const sl = createSlider({
      label,
      min,
      max,
      step,
      value: this.store.get().animation[key] as number,
      format: (v) => v.toFixed(2),
      onChange: (v) => this.set({ [key]: v } as Partial<AnimationConfig>),
    });
    this.sliders.set(key, sl);
    host.appendChild(sl.el);
  }

  private set(patch: Partial<AnimationConfig>): void {
    const s = this.store.get();
    const update: Partial<SceneState> = {
      animation: { ...s.animation, ...patch },
    };
    // Selecting "free" arms the Order draw tool; leaving "free" clears the drawn
    // line and disarms the tool (back to Draw).
    if (patch.order !== undefined) {
      if (patch.order === "free") {
        update.tool = "path";
      } else {
        update.orderPath = [];
        if (s.tool === "path") update.tool = "draw";
      }
    }
    this.store.set(update);
  }

  private sync(s: SceneState): void {
    const a = s.animation;
    for (const [key, { dd }] of this.dropdowns) dd.setValue(String(a[key]));
    // Direction matters for a linear order (reveal or shape phase) — dim otherwise.
    const dirUsed = a.order === "linear" || (!a.shapeSync && a.shapeOrder === "linear");
    this.dropdowns.get("direction")!.wrap.style.opacity = dirUsed ? "1" : "0.4";
    // Shape Order only applies when unsynced — dim it while Synced.
    const shapeOrderDd = this.dropdowns.get("shapeOrder");
    if (shapeOrderDd) shapeOrderDd.wrap.style.opacity = a.shapeSync ? "0.4" : "1";

    for (const [key, sl] of this.sliders) sl.setValue(a[key] as number);
    for (const [, t] of this.toggles) t.paint();
  }
}
