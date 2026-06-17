/** Animated content swaps for the floating menus.
 *
 *  morphResize: fade the current content out, morph the box from its old size to
 *  the new content's size, then fade the new content in. `commit` mutates the DOM
 *  to the next state and runs only after the fade-out, so the swap is hidden.
 *
 *  morphOpen: the box was closed (no old content) — reveal it by growing its
 *  height from 0 to the new content's size, then fade the content in.
 *
 *  Both are re-entrant per element: a new call cancels the in-flight sequence and
 *  animates from wherever the box currently is. */

const FADE = 110; // ms — content fade out / in
const SIZE = 210; // ms — box width/height morph (matches the CSS transition)

interface MorphState {
  token: number;
  timers: number[];
}
const states = new WeakMap<HTMLElement, MorphState>();

/** Cancel any in-flight sequence on `el` and return a fresh token + a liveness
 *  check / timer-scheduler bound to it. */
function begin(el: HTMLElement): { alive: () => boolean; after: (ms: number, fn: () => void) => void } {
  let st = states.get(el);
  if (!st) {
    st = { token: 0, timers: [] };
    states.set(el, st);
  }
  st.timers.forEach(clearTimeout);
  st.timers = [];
  const token = ++st.token;
  const alive = () => st!.token === token;
  const after = (ms: number, fn: () => void) =>
    st!.timers.push(window.setTimeout(() => alive() && fn(), ms));
  return { alive, after };
}

export function morphResize(el: HTMLElement, commit: () => void, done?: () => void): void {
  const { after } = begin(el);

  // Freeze the current size so fading the content out doesn't reflow the box.
  const r0 = el.getBoundingClientRect();
  el.classList.add("morph");
  el.classList.remove("is-sizing");
  el.style.width = `${r0.width}px`;
  el.style.height = `${r0.height}px`;
  void el.offsetWidth; // flush, so adding is-fading actually transitions
  el.classList.add("is-fading");

  after(FADE, () => {
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

    after(SIZE, () => {
      // Size reached: release the lock and fade the new content in.
      el.classList.remove("is-sizing");
      el.style.width = "";
      el.style.height = "";
      el.classList.remove("is-fading");
      after(FADE, () => {
        el.classList.remove("morph");
        done?.();
      });
    });
  });
}

export function morphClose(el: HTMLElement, commit: () => void, done?: () => void): void {
  const { after } = begin(el);

  // Fade the content out, then collapse the height to 0, then commit (hide).
  const r0 = el.getBoundingClientRect();
  el.classList.add("morph");
  el.classList.remove("is-sizing");
  el.style.width = `${r0.width}px`;
  el.style.height = `${r0.height}px`;
  void el.offsetWidth;
  el.classList.add("is-fading");

  after(FADE, () => {
    el.classList.add("is-sizing");
    el.style.height = "0px";
    after(SIZE, () => {
      commit(); // apply hidden / clear the panel
      el.classList.remove("is-sizing", "is-fading", "morph");
      el.style.width = "";
      el.style.height = "";
      done?.();
    });
  });
}

export function morphOpen(el: HTMLElement, commit: () => void, done?: () => void): void {
  const { after } = begin(el);

  // Reveal + apply classes, then measure the target size while content is hidden.
  commit();
  el.classList.add("morph", "is-fading");
  el.classList.remove("is-sizing");
  el.style.width = "";
  el.style.height = "";
  const r1 = el.getBoundingClientRect();
  // Grow the height from 0 to the natural size.
  el.style.height = "0px";
  void el.offsetWidth;
  el.classList.add("is-sizing");
  el.style.height = `${r1.height}px`;

  after(SIZE, () => {
    el.classList.remove("is-sizing");
    el.style.height = "";
    el.classList.remove("is-fading");
    after(FADE, () => {
      el.classList.remove("morph");
      done?.();
    });
  });
}
