/** A single floating tooltip driven by the native `title` attribute. On first
 *  hover we steal the element's `title` into `data-tip` (so the OS tooltip never
 *  shows) and render our own styled bubble, portaled to <body> to avoid getting
 *  clipped by the toolboxes' overflow. */

let tip: HTMLElement | null = null;
let current: HTMLElement | null = null;

function ensureTip(): HTMLElement {
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "tooltip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  return tip;
}

/** The nearest ancestor carrying a tooltip (native `title` or stolen `data-tip`). */
function tipTarget(el: EventTarget | null): HTMLElement | null {
  let node = el as HTMLElement | null;
  while (node && node !== document.body) {
    if (node.hasAttribute?.("title") || node.hasAttribute?.("data-tip")) return node;
    node = node.parentElement;
  }
  return null;
}

function textFor(el: HTMLElement): string {
  const native = el.getAttribute("title");
  if (native != null) {
    el.setAttribute("data-tip", native);
    el.removeAttribute("title");
  }
  return el.getAttribute("data-tip") ?? "";
}

function show(el: HTMLElement): void {
  const text = textFor(el).trim();
  if (!text) return;
  current = el;
  const t = ensureTip();
  t.textContent = text;
  t.classList.add("show");
  position(el, t);
}

function position(el: HTMLElement, t: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const tw = t.offsetWidth;
  const th = t.offsetHeight;
  const gap = 8;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - tw - 6));
  let top = r.top - th - gap;
  t.classList.toggle("below", top < 6);
  if (top < 6) top = r.bottom + gap;
  t.style.left = `${Math.round(left)}px`;
  t.style.top = `${Math.round(top)}px`;
}

function hide(): void {
  current = null;
  tip?.classList.remove("show", "below");
}

/** Wire the delegated hover/focus listeners once. */
export function initTooltips(): void {
  document.addEventListener("pointerover", (e) => {
    const target = tipTarget(e.target);
    if (target && target !== current) show(target);
  });
  document.addEventListener("pointerout", (e) => {
    if (!current) return;
    const to = tipTarget((e as PointerEvent).relatedTarget);
    if (to !== current) hide();
  });
  // A click / press usually acts on the control — dismiss so it doesn't linger.
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("focusin", (e) => {
    const target = tipTarget(e.target);
    if (target) show(target);
  });
  document.addEventListener("focusout", hide);
  window.addEventListener("scroll", hide, true);
}
