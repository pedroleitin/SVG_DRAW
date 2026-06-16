/** Small shared UI widgets: a custom dropdown (styled like the Size pill) and
 *  a range-fill painter for the pill sliders. */

export interface DropdownOption {
  value: string;
  label?: string;
}

export interface DropdownHandle {
  el: HTMLElement;
  setValue(v: string): void;
}

// Only one dropdown menu is open at a time; it's portaled to <body> so it
// escapes the context menu's overflow clipping.
let openState: { owner: HTMLButtonElement; menu: HTMLElement } | null = null;

function closeOpen(): void {
  if (!openState) return;
  openState.menu.remove();
  openState = null;
}
document.addEventListener("click", closeOpen);
window.addEventListener("resize", closeOpen);
window.addEventListener("scroll", closeOpen, true);

export function createDropdown(
  options: DropdownOption[],
  value: string,
  onChange: (v: string) => void,
  opts: { prefix?: string } = {},
): DropdownHandle {
  const dd = document.createElement("div");
  dd.className = "dd";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tool-btn dd-btn";

  let current = value;
  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const render = () => {
    const prefix = opts.prefix ? `<span class="dd-prefix">${opts.prefix}</span>` : "";
    btn.innerHTML = `<span class="dd-label">${prefix}<b>${labelFor(current)}</b></span><span class="dd-caret">▾</span>`;
  };
  render();

  const open = () => {
    const menu = document.createElement("div");
    menu.className = "dd-menu";
    for (const o of options) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "dd-item" + (o.value === current ? " active" : "");
      item.textContent = o.label ?? o.value;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        current = o.value;
        render();
        closeOpen();
        onChange(o.value);
      });
      menu.appendChild(item);
    }
    document.body.appendChild(menu);

    const r = btn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.minWidth = `${r.width}px`;
    const mh = menu.offsetHeight;
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow < mh + 10 && r.top > mh ? r.top - mh - 6 : r.bottom + 6;
    menu.style.top = `${top}px`;
    menu.style.left = `${r.left}px`;
    openState = { owner: btn, menu };
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = openState?.owner === btn;
    closeOpen();
    if (!wasOpen) open();
  });

  dd.appendChild(btn);
  return {
    el: dd,
    setValue(v: string) {
      current = v;
      render();
    },
  };
}

export interface SliderHandle {
  el: HTMLElement;
  setValue(v: number): void;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

/** A "bar" slider: a tall pill whose dark fill shows the value, with the label
 *  (left) and value (right) INSIDE it. The text is drawn twice — dark on the
 *  light track and light clipped to the dark fill — so it always contrasts. */
export function createSlider(opts: SliderOptions): SliderHandle {
  const { label, min, max, step } = opts;
  const fmt = opts.format ?? ((v) => String(v));
  let value = opts.value;

  const root = document.createElement("div");
  root.className = "rng";
  root.tabIndex = 0;
  root.innerHTML = `
    <div class="rng-content"><span>${label}</span><span class="rng-val"></span></div>
    <div class="rng-fill"><div class="rng-content rng-content--light"><span>${label}</span><span class="rng-val"></span></div></div>`;
  const fill = root.querySelector(".rng-fill") as HTMLElement;
  const lightContent = root.querySelector(".rng-content--light") as HTMLElement;
  const vals = root.querySelectorAll<HTMLElement>(".rng-val");

  const paint = () => {
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    fill.style.width = `${pct}%`;
    lightContent.style.width = `${root.clientWidth}px`;
    const t = fmt(value);
    vals.forEach((v) => (v.textContent = t));
  };

  const commit = (v: number) => {
    v = Math.round(v / step) * step;
    v = Math.min(max, Math.max(min, v));
    v = parseFloat(v.toFixed(6));
    if (v === value) {
      paint();
      return;
    }
    value = v;
    paint();
    opts.onChange(v);
  };

  const fromX = (clientX: number) => {
    const r = root.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    commit(min + t * (max - min));
  };

  let dragging = false;
  root.addEventListener("pointerdown", (e) => {
    dragging = true;
    root.setPointerCapture(e.pointerId);
    fromX(e.clientX);
  });
  root.addEventListener("pointermove", (e) => dragging && fromX(e.clientX));
  root.addEventListener("pointerup", () => (dragging = false));
  root.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      commit(value - step);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      commit(value + step);
    }
  });

  // Repaint when the slider gets/changes size (e.g. shown from a hidden menu),
  // so the clipped light text always matches the track width.
  new ResizeObserver(paint).observe(root);
  paint();

  return {
    el: root,
    setValue(v: number) {
      value = v;
      paint();
    },
  };
}
