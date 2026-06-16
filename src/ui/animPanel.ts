import type { Store } from "../store/store";
import type { SceneState } from "../scene/types";
import {
  ORDER_MODES,
  DIRECTIONS,
  PLAYBACK_MODES,
  ENTER_EXITS,
  IDLE_IDS,
} from "../anim/animations";
import type { AnimationConfig } from "../anim/animations";
import { createDropdown, paintRange } from "./widgets";
import type { DropdownHandle } from "./widgets";

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
  private sliders = new Map<keyof AnimationConfig, { range: HTMLInputElement; out: HTMLElement }>();

  constructor(host: HTMLElement, private store: Store) {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "anim-panel";
    panel.innerHTML = `
      <h2>Animation</h2>
      <div class="anim-cols">
        <div class="anim-selects" id="anim-selects"></div>
        <div class="anim-sliders" id="anim-sliders"></div>
      </div>`;
    host.appendChild(panel);

    const selHost = panel.querySelector("#anim-selects")!;
    // "free" is the hand-drawn path mode — show it as "draw path".
    this.addSelect(selHost, "order", "Order", ORDER_MODES, { free: "draw path" });
    this.addSelect(selHost, "direction", "Dir", DIRECTIONS);
    this.addSelect(selHost, "enter", "Enter", ENTER_EXITS);
    this.addSelect(selHost, "exit", "Exit", ENTER_EXITS);
    this.addSelect(selHost, "playback", "Playback", PLAYBACK_MODES);
    this.addSelect(selHost, "idle", "Idle", IDLE_IDS);

    const slHost = panel.querySelector("#anim-sliders")!;
    this.addSlider(slHost, "speed", "Speed", 0.1, 3, 0.05);
    this.addSlider(slHost, "spread", "Spread", 0, 6, 0.1);
    this.addSlider(slHost, "enterDur", "Enter dur", 0, 3, 0.05);
    this.addSlider(slHost, "hold", "Hold", 0, 5, 0.1);
    this.addSlider(slHost, "exitDur", "Exit dur", 0, 3, 0.05);
    this.addSlider(slHost, "idleAmount", "Idle amt", 0, 1, 0.01);

    this.sync(store.get());
    store.subscribe((s) => this.sync(s));
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
    const row = document.createElement("div");
    row.className = "slider";
    row.innerHTML = `
      <div class="slider-head"><span class="slider-label">${label}</span><span class="slider-val"></span></div>
      <input type="range" min="${min}" max="${max}" step="${step}" />`;
    const range = row.querySelector("input")!;
    const out = row.querySelector(".slider-val") as HTMLElement;
    range.addEventListener("input", () => {
      paintRange(range);
      this.set({ [key]: Number(range.value) } as Partial<AnimationConfig>);
    });
    this.sliders.set(key, { range, out });
    host.appendChild(row);
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
    // Direction only matters for linear order — dim it otherwise.
    this.dropdowns.get("direction")!.wrap.style.opacity = a.order === "linear" ? "1" : "0.4";

    for (const [key, { range, out }] of this.sliders) {
      const v = a[key] as number;
      if (Number(range.value) !== v) range.value = String(v);
      paintRange(range);
      out.textContent = v.toFixed(2);
    }
  }
}
