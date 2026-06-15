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

/** Animation panel — lifecycle + order + playback.
 *  - Order: how SVGs are sequenced in (linear/radial/sequential/random/free).
 *  - Enter/Exit: how each SVG forms in and out (fade/scale/pop/rotate).
 *  - Playback: loop / ping-pong / once.
 *  Toggling Play flips animation.playing; main.ts runs the engine. */
export class AnimPanel {
  private selects = new Map<keyof AnimationConfig, HTMLSelectElement>();
  private sliders = new Map<keyof AnimationConfig, { range: HTMLInputElement; out: HTMLElement }>();
  private playBtn!: HTMLButtonElement;

  constructor(host: HTMLElement, private store: Store) {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "anim-panel";
    panel.innerHTML = `
      <div class="anim-head">
        <h2>Animation</h2>
        <button id="anim-play" class="play">▶ Play</button>
      </div>
      <div class="select-grid" id="anim-selects"></div>
      <div class="sliders" id="anim-sliders"></div>`;
    host.appendChild(panel);

    this.playBtn = panel.querySelector("#anim-play") as HTMLButtonElement;
    this.playBtn.addEventListener("click", () =>
      this.set({ playing: !this.store.get().animation.playing }),
    );

    const selHost = panel.querySelector("#anim-selects")!;
    // "free" is the hand-drawn path mode — show it as "draw path".
    this.addSelect(selHost, "order", "Order", ORDER_MODES, { free: "draw path" });
    this.addSelect(selHost, "direction", "Direction", DIRECTIONS);
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
    label: string,
    options: readonly string[],
    labels: Record<string, string> = {},
  ): void {
    const wrap = document.createElement("label");
    wrap.className = "sel";
    wrap.innerHTML = `
      <span>${label}</span>
      <select>${options
        .map((o) => `<option value="${o}">${labels[o] ?? o}</option>`)
        .join("")}</select>`;
    const sel = wrap.querySelector("select")!;
    sel.addEventListener("change", () =>
      this.set({ [key]: sel.value } as Partial<AnimationConfig>),
    );
    this.selects.set(key, sel);
    host.appendChild(wrap);
  }

  private addSlider(
    host: Element,
    key: keyof AnimationConfig,
    label: string,
    min: number,
    max: number,
    step: number,
  ): void {
    const row = document.createElement("label");
    row.className = "slider";
    row.innerHTML = `
      <span class="slider-label">${label}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" />
      <span class="slider-val"></span>`;
    const range = row.querySelector("input")!;
    const out = row.querySelector(".slider-val") as HTMLElement;
    range.addEventListener("input", () =>
      this.set({ [key]: Number(range.value) } as Partial<AnimationConfig>),
    );
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
    this.playBtn.textContent = a.playing ? "⏸ Pause" : "▶ Play";
    this.playBtn.classList.toggle("playing", a.playing);

    for (const [key, sel] of this.selects) {
      const v = String(a[key]);
      if (sel.value !== v) sel.value = v;
    }
    // Direction only matters for linear order — dim it otherwise.
    const dirSel = this.selects.get("direction")!;
    (dirSel.closest(".sel") as HTMLElement).style.opacity = a.order === "linear" ? "1" : "0.4";

    for (const [key, { range, out }] of this.sliders) {
      const v = a[key] as number;
      if (Number(range.value) !== v) range.value = String(v);
      out.textContent = v.toFixed(2);
    }
  }
}
