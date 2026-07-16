import type { SceneState } from "../scene/types";
import type { Library } from "../features/library";
import { paletteById, colorAt } from "../features/palette";
import { instanceGeom, cellBgRect } from "../scene/geom";
import { FILL_SCALE, shufflePool, shuffledAssetId } from "../features/placement";
import { sampleTrack, sampleVisibility, transformListToString, shapePlayhead, restBasisForBucket } from "../features/svgAnim";
import type { Asset } from "../scene/types";
import { outSize } from "./frame";
import { mapCycleTime, sampleLifecycle } from "../anim/animations";
import { buildOrderField, buildShapeOrderField } from "../anim/order";

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
  // Shuffle idle swaps each glyph over time — apply it so exports match the canvas.
  const shuffle =
    animate && state.animation.idle === "shuffle" ? shufflePool(state.brushAssets, library) : null;
  // Per-cell phase field for animated shapes (mirrors the renderer): built while
  // unsynced, or synced with random rest (so each cell gets its own rest bucket).
  const shapeOrderOf =
    animate && (!state.animation.shapeSync || state.animation.shapeRestRandom)
      ? buildShapeOrderField(state)
      : null;

  // Symbol variants actually referenced: symId -> {assetId, phase01, restBasis}.
  // Animated shapes emit one symbol per phase bucket when unsynced (mirrors the
  // renderer).
  const usedSyms = new Map<string, { assetId: string; phase01: number; restBasis: number }>();
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
      const assetId = shuffle ? shuffledAssetId(inst, shuffle, T, state.animation.idleAmount) : inst.assetId;
      const a = library.get(assetId);
      const animated = animate && !!a?.anim?.length;
      let symId = `sym-${assetId}`;
      let phase01 = 0;
      let restBasis = 0;
      if (animated && shapeOrderOf) {
        const bucket = Math.floor(shapeOrderOf(inst) * PHASE_BUCKETS) % PHASE_BUCKETS;
        phase01 = bucket / PHASE_BUCKETS;
        restBasis = restBasisForBucket(bucket);
        symId = `sym-${assetId}~${bucket}`;
      }
      if (!usedSyms.has(symId)) usedSyms.set(symId, { assetId, phase01, restBasis });
      uses.push(
        `<use href="#${symId}" x="${r(g.x)}" y="${r(g.y)}" width="${r(g.size)}" height="${r(g.size)}" style="color:${color}"${transform}${op}/>`,
      );
    }
  }

  const defs = [...usedSyms]
    .map(([symId, { assetId, phase01, restBasis }]) => {
      const a = library.get(assetId);
      if (!a) return "";
      // Bake internal shape animation: at time T while animating, else a t=0
      // still (so a static export shows one coherent frame, not overlapping
      // visibility layers).
      const markup =
        a.anim && a.anim.length
          ? animatedMarkup(a, animate ? T : 0, phase01, restBasis, state.animation)
          : a.markup;
      return `<symbol id="${symId}" viewBox="${a.viewBox}" overflow="visible">${markup}</symbol>`;
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

const SVG_NS = "http://www.w3.org/2000/svg";

/** Kept in sync with the renderer: phase-bucket count for unsynced shapes. */
const PHASE_BUCKETS = 24;

/** Bake an animated asset's markup at time T (seconds): sample each internal
 *  animation track (honoring reverse/rest + this variant's phase) and write its
 *  transform onto the matching `<g data-anim>`, so the export matches the canvas. */
function animatedMarkup(
  asset: Asset,
  T: number,
  phase01: number,
  restBasis: number,
  anim: { shapeSync: boolean; shapeReverse: boolean; shapeRest: number; shapeRestRandom: boolean },
): string {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${asset.markup}</svg>`,
    "image/svg+xml",
  );
  const root = doc.documentElement;
  const tracks = new Map((asset.anim ?? []).map((t) => [t.index, t]));
  const rest = anim.shapeRestRandom ? restBasis * anim.shapeRest : anim.shapeRest;
  const opts = { reverse: anim.shapeReverse, rest };
  const ph = anim.shapeSync ? 0 : phase01;
  for (const el of Array.from(root.querySelectorAll("[data-anim]"))) {
    const track = tracks.get(Number(el.getAttribute("data-anim")));
    if (!track) continue;
    const p = shapePlayhead(opts, T, track.dur, ph);
    const fns = sampleTrack(track, p);
    if (fns.length) el.setAttribute("transform", transformListToString(fns));
    const vis = sampleVisibility(track, p);
    if (vis) el.setAttribute("visibility", vis);
  }
  return root.innerHTML;
}

/** Longest internal-shape loop (seconds) among the animated assets in the scene,
 *  scaled by playback speed — so the exporter can size a clip that captures a
 *  full shape cycle (reverse doubles it and adds the rest hold). 0 = none. */
export function shapeLoopDuration(state: SceneState, library: Library): number {
  const a = state.animation;
  let maxCycle = 0;
  const seen = new Set<string>();
  for (const inst of Object.values(state.instances)) {
    if (seen.has(inst.assetId)) continue;
    seen.add(inst.assetId);
    const asset = library.get(inst.assetId);
    if (!asset?.anim?.length) continue;
    for (const t of asset.anim) {
      const d = t.dur > 0 ? t.dur : 1;
      const rest = Math.max(0, a.shapeRest);
      const cycle = a.shapeReverse ? 2 * d + rest : d + rest;
      if (cycle > maxCycle) maxCycle = cycle;
    }
  }
  return maxCycle / Math.max(0.0001, a.speed);
}
