# SVG Grid Generator

A browser-based generative tool for filling an infinite grid with random SVG
shapes, recolored by palette, with draw/erase tools, zoom/pan, and (planned)
animation + SVG/PNG/MP4 export.

## Stack

- **Vite + TypeScript** — dev server, bundling, strict types.
- **Native SVG DOM** as the single source of truth (so SVG export is lossless),
  with `<symbol>` + `<use>` instancing for low DOM weight.
- Zero runtime dependencies so far; later phases add seedable noise, palette
  color math, and export muxers as needed.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc + vite build -> dist/
npm run typecheck
```

## Architecture

Unidirectional **Store → Render → Input → Commands** loop:

- `src/store/` — observable single source of truth (serializable `SceneState`).
- `src/scene/` — domain model + pure math (`grid`, `camera`, `types`).
- `src/render/` — diffs scene → SVG; virtualizes to the visible cell range.
- `src/tools/` — pointer/wheel input → draw / erase / pan / zoom.
- `src/commands/` — Command pattern → undo/redo; strokes coalesce to one step.
- `src/features/` — `library`, `palette`, `placement` (+ noise).

The camera is the root `<svg>` viewBox; zoom is cursor-anchored. Randomness is
seeded per cell (`hash2(col,row,seed)`) so a scene reproduces deterministically —
the foundation for frame-accurate export later.

## Status

**Working now (Phases 0–1, plus early 2–4):**

- [x] Infinite canvas: pan (Space/middle-drag/Pan tool), cursor-anchored zoom (wheel/buttons)
- [x] Adjustable grid sizes (16/32/64/128), virtual grid rendering with sub-pixel culling
- [x] Starter SVG library (10 shapes) instanced via `<symbol>`/`<use>`
- [x] Random placement with seeded per-cell variation
- [x] Color palettes (5 curated) with index-based recoloring + color variation noise
- [x] Draw + Erase tools with drag-paint; strokes are single undo steps
- [x] Undo / redo / clear; keyboard shortcuts (B, E, ⌘Z, ⌘⇧Z)
- [x] Library drawer with shape previews + per-asset brush selection (or Random)
- [x] SVG upload (drag-drop / file picker): sanitized (strips script/handlers/remote refs),
      normalized to `currentColor`, persisted in IndexedDB, restored on reload
- [x] Palette editor: switch palettes, click swatch to set active color, edit/add/remove colors
- [x] **Maxon-style fractal noise mask** (white fills / black erases): seeded fBm with
      Scale, Octaves, Roughness, Contrast, Brightness, Threshold sliders
- [x] Live grayscale **preview canvas** (with B/W threshold view), **draggable to pan** the field
- [x] Interactive **on-canvas overlay**: shades visible cells by the field, green = will fill,
      red = will erase — updates live as you move sliders
- [x] "Apply to view" (fill white / erase black across visible cells, one undo step) + "Reseed"
- [x] Separate collapsible **Variation** group (jitter / rotation / scale / color) — independent of the mask
- [x] Verified via headless Chrome (mask preview grayscale + B/W, overlay rects, apply fill→81 / high-threshold
      erase→1, drag-to-pan changes field, per-seed determinism — no console errors)

> Note: `tsconfig` uses `noEmit` so `tsc` only typechecks — Vite owns bundling. (An earlier build had
> emitted stale `.js` into `src/` that Vite resolved over the `.ts`; fixed.)

- [x] **Animation engine** (Phase 5): rAF clock + pure time-driven sampling (drives export too)
- [x] **Lifecycle**: each SVG ENTERS → HOLDS → EXITS, with enter/exit styles (fade, scale, pop, rotate)
      and adjustable enter/hold/exit durations
- [x] **Reveal order**: linear (+ direction), radial, sequential, random, and **free** —
      the 🧭 Order tool (P) lets you draw a path on the canvas (START→FINISH labels) and SVGs
      reveal along it; `spread` staggers the order so the reveal sweeps the grid
- [x] **Playback modes**: loop, ping-pong, once · plus optional idle motion (spin/pulse/bob/sway/orbit) during hold
- [x] Verified via headless Chrome (staggered reveal 6→94 over time, pause = full static scene, no errors)

**Next phases:**

- [ ] Phase 6 — export: SVG (serialize), PNG sequence (canvas + JSZip), MP4 (WebCodecs + mp4-muxer)
- [ ] Phase 7 — save/load projects, bulk ops, performance tuning
