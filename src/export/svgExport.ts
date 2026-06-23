import type { SceneState } from "../scene/types";
import type { Library } from "../features/library";
import { paletteById, colorAt } from "../features/palette";
import { instanceGeom, cellBgRect } from "../scene/geom";
import { FILL_SCALE } from "../features/placement";
import { outSize } from "./frame";
import { mapCycleTime, sampleLifecycle } from "../anim/animations";
import { buildOrderField } from "../anim/order";

const SVGNS = "http://www.w3.org/2000/svg";

/** Serialize the scene inside the export frame to a standalone SVG string.
 *  Lossless vector output: symbols are inlined into <defs>, instances become
 *  <use>. If `time` is given, the animation is sampled at that instant (used by
 *  the PNG-sequence / MP4 exporters); otherwise the static scene is emitted. */
export function buildSceneSVG(
  state: SceneState,
  library: Library,
  time?: number,
  background?: string | null,
): string {
  const f = state.frame;
  const { outW, outH } = outSize(f);
  const palette = paletteById(state.palettes, state.activePaletteId);
  const cs = state.cellSize;
  const fillMul = state.cellFill / FILL_SCALE;
  const margin = cs;

  const animate = time != null;
  const orderOf = animate ? buildOrderField(state) : null;
  const T = animate ? time * state.animation.speed : 0;
  const tcyc = animate ? mapCycleTime(state.animation, T) : 0;

  const used = new Set<string>();
  const uses: string[] = [];

  for (const inst of Object.values(state.instances)) {
    const cx = (inst.col + 0.5) * cs;
    const cy = (inst.row + 0.5) * cs;
    // Cull to the frame (with a one-cell margin for overhang).
    if (cx < f.x - margin || cx > f.x + f.w + margin || cy < f.y - margin || cy > f.y + f.h + margin) {
      continue;
    }
    const anim = animate && orderOf ? sampleLifecycle(state.animation, orderOf(inst), tcyc, T) : {};
    if (anim.hidden || (anim.opacity ?? 1) <= 0) continue;

    const g = instanceGeom(inst, cs, anim, fillMul);
    const color = inst.color ?? colorAt(palette, inst.colorIndex);
    const transform = g.rot ? ` transform="rotate(${r(g.rot)} ${r(g.cx)} ${r(g.cy)})"` : "";
    const op = g.opacity < 1 ? ` opacity="${g.opacity.toFixed(3)}"` : "";
    // Cell-background square (fixed to the cell, shares the fade), behind the use.
    if (inst.bgIndex != null) {
      const bgOp = g.opacity < 1 ? ` opacity="${g.opacity.toFixed(3)}"` : "";
      const b = cellBgRect(inst.col, inst.row, cs, state.cellRounded, state.cellGutter, inst.cw ?? 1, inst.ch ?? 1);
      const rx = b.rx ? ` rx="${b.rx}"` : "";
      uses.push(
        `<rect x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}"${rx} fill="${colorAt(palette, inst.bgIndex)}"${bgOp}/>`,
      );
    }
    // Skip hidden glyphs (e.g. Halftone's cell-only target).
    if (color !== "transparent") {
      used.add(inst.assetId);
      uses.push(
        `<use href="#sym-${inst.assetId}" x="${r(g.x)}" y="${r(g.y)}" width="${r(g.size)}" height="${r(g.size)}" style="color:${color}"${transform}${op}/>`,
      );
    }
  }

  const defs = [...used]
    .map((id) => {
      const a = library.get(id);
      return a
        ? `<symbol id="sym-${id}" viewBox="${a.viewBox}" overflow="visible">${a.markup}</symbol>`
        : "";
    })
    .join("");

  const bg = background
    ? `<rect x="${r(f.x)}" y="${r(f.y)}" width="${r(f.w)}" height="${r(f.h)}" fill="${background}"/>`
    : "";

  return (
    `<svg xmlns="${SVGNS}" width="${outW}" height="${outH}" ` +
    `viewBox="${r(f.x)} ${r(f.y)} ${r(f.w)} ${r(f.h)}">` +
    `<defs>${defs}</defs>${bg}${uses.join("")}</svg>`
  );
}

/** Round to 3 decimals to keep the serialized SVG compact. */
const r = (n: number): number => Math.round(n * 1000) / 1000;
