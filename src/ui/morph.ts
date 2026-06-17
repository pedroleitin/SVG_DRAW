/** Animated content swap for a floating menu: fade the current content out,
 *  morph the box from its old size to the new content's size, then fade the new
 *  content in. `commit` mutates the DOM (rebuild / toggle) to the next state;
 *  it runs only after the fade-out, so the swap is hidden behind the animation.
 *
 *  Re-entrant: a new call on the same element cancels the in-flight sequence and
 *  morphs from wherever the box currently is. */

const FADE = 110; // ms — content fade out / in
const SIZE = 210; // ms — box width/height morph

interface MorphState {
  token: number;
  timers: number[];
}
const states = new WeakMap<HTMLElement, MorphState>();

export function morphResize(el: HTMLElement, commit: () => void): void {
  let st = states.get(el);
  if (!st) {
    st = { token: 0, timers: [] };
    states.set(el, st);
  }
  st.timers.forEach(clearTimeout);
  st.timers = [];
  const token = ++st.token;
  const alive = () => st!.token === token;

  // Freeze the current size so fading the content out doesn't reflow the box.
  const r0 = el.getBoundingClientRect();
  el.classList.add("morph");
  el.classList.remove("is-sizing");
  el.style.width = `${r0.width}px`;
  el.style.height = `${r0.height}px`;
  void el.offsetWidth; // flush, so adding is-fading actually transitions
  el.classList.add("is-fading");

  st.timers.push(
    window.setTimeout(() => {
      if (!alive()) return;
      // Swap content (still invisible), measure its natural size.
      commit();
      el.style.width = "";
      el.style.height = "";
      const r1 = el.getBoundingClientRect();
      // Animate from the old size to the new one.
      el.style.width = `${r0.width}px`;
      el.style.height = `${r0.height}px`;
      void el.offsetWidth;
      el.classList.add("is-sizing");
      el.style.width = `${r1.width}px`;
      el.style.height = `${r1.height}px`;

      st!.timers.push(
        window.setTimeout(() => {
          if (!alive()) return;
          // Size reached: release the lock and fade the new content in.
          el.classList.remove("is-sizing");
          el.style.width = "";
          el.style.height = "";
          el.classList.remove("is-fading");
          st!.timers.push(
            window.setTimeout(() => {
              if (!alive()) return;
              el.classList.remove("morph");
            }, FADE),
          );
        }, SIZE),
      );
    }, FADE),
  );
}
