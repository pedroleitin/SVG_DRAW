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
    const prefix = opts.prefix ? `<span class="dd-prefix">${opts.prefix}</span> ` : "";
    btn.innerHTML = `${prefix}<b>${labelFor(current)}</b><span class="dd-caret">▾</span>`;
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

/** Paint a range input's track as a dark fill up to its value (GG2 pill slider). */
export function paintRange(input: HTMLInputElement): void {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
  input.style.background = `linear-gradient(to right, var(--text) 0 ${pct}%, var(--line) ${pct}% 100%)`;
}
