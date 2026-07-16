/** Material Symbols icon set for the UI buttons. When the Grid → "Labels" toggle
 *  is off, text buttons swap their label for the matching icon; a few buttons
 *  (undo/redo/pan/fit) are always icons. Icons render as a glyph from the
 *  Material Symbols Outlined web font (see index.html + `.msym` in app.css). */

export interface IconDef {
  /** Material Symbols glyph name (ligature). */
  sym: string;
  /** Filled variant (FILL axis 1) instead of outline. */
  fill?: boolean;
}

/** Keyed by a canonical button name (lowercase). */
export const ICON_MAP: Record<string, IconDef> = {
  draw: { sym: "draw" },
  erase: { sym: "ink_eraser" },
  line: { sym: "diagonal_line" },
  block: { sym: "cancel" },
  stencil: { sym: "fragrance" },
  shapes: { sym: "interests" },
  colors: { sym: "colors" },
  grid: { sym: "grid_4x4" },
  clear: { sym: "cancel_presentation" },
  hand: { sym: "back_hand" },
  undo: { sym: "undo" },
  redo: { sym: "redo" },
  divider: { sym: "dashboard" },
  halftone: { sym: "blur_on" },
  fit: { sym: "pageless" },
  seamless: { sym: "grain" },
  edit: { sym: "settings" },
  rotate: { sym: "rotate_right" },
  swap: { sym: "sync_alt" },
  cell: { sym: "square", fill: true },
  gliph: { sym: "filter_vintage", fill: true },
  reset: { sym: "history", fill: true },
  sun: { sym: "wb_sunny" },
  moon: { sym: "bedtime" },
  soundOn: { sym: "volume_up" },
  soundOff: { sym: "volume_off" },
};

/** Icon markup for a mapped key (empty string when unknown). */
export function icon(key: string): string {
  const d = ICON_MAP[key];
  if (!d) return "";
  return `<span class="msym${d.fill ? " fill" : ""}">${d.sym}</span>`;
}

/** True when `key` has an icon and labels are off (so a text button iconizes). */
export function useIconFor(key: string | undefined, labels: boolean): boolean {
  return !labels && !!key && key in ICON_MAP;
}

/** Set a button's content to its icon (labels off) or its text (labels on),
 *  toggling the square `icon-btn` layout and keeping the text as a tooltip. */
export function applyBtnContent(
  btn: HTMLElement,
  text: string,
  iconKey: string | undefined,
  labels: boolean,
): void {
  const asIcon = useIconFor(iconKey, labels);
  btn.innerHTML = asIcon ? icon(iconKey as string) : text;
  btn.classList.toggle("icon-btn", asIcon);
  if (asIcon && !btn.title) btn.title = text;
}
