# copilot.md — SVG Grid Drawing Tool

Guidance for GitHub Copilot CLI working in this repo. Keep it current as the project
evolves. (Mirrors `CLAUDE.md` — same project, any assistant.)

## What this is

A browser-based generative tool that fills an infinite, zoomable grid with SVG shapes:
draw / erase / **line** brushes (line draws a freehand path then fills it with glyphs),
palette recoloring, per-cell backgrounds, a **Block** tool that locks cells (preserves +
protects their content), a multi-source **Stencil** (noise / stripes / image / text masks you
paint inside), a **Halftone** that renders an image / GIF / video as shapes (live animated
preview via global Play + animated MP4/PNG-seq export), seamless tiling, a square-packing
divider (block-aware), multi-cell scaling, time-driven animation, and SVG / PNG / MP4 export.
Vite + TypeScript, native SVG DOM as the source of truth.

## Commands

```bash
npm run dev        # http://localhost:5173
npm run build      # tsc + vite build -> dist/
npm run typecheck  # tsc -p .   (typecheck only — see noEmit below)
```

- **Always run `tsc` from the project dir**: `cd <repo> && npx tsc -p .`. The shell's cwd can
  persist between calls; running `npx tsc` elsewhere may install a bogus old tsc.
- A dev server is usually already running on :5173 — check before starting another.

## Architecture

Unidirectional **Store → Render → Input → Commands** loop:

- `src/store/` — observable single source of truth (serializable `SceneState`).
- `src/scene/` — domain model + pure math (`grid`, `camera`, `types`, `geom`).
- `src/render/` — diffs scene → SVG; virtualizes to the visible cell range (`renderer.ts`).
- `src/tools/` — pointer/wheel input → draw / erase / line / pan / zoom / block / path (`tools.ts`).
- `src/commands/` — Command pattern → undo/redo; a stroke coalesces into one step.
- `src/features/` — `library`, `palette`, `placement`, `noise`, `divider` (block-aware), `svgImport`,
  `audio`, `halftone` (image / GIF / video → shapes, animated), and the stencil sources (`stencil` → `litFn` per cell, `stencilImage`, `stencilText`).
- `src/anim/` — time-driven engine + reveal order (drives export too).
- `src/export/` — frame, SVG/PNG raster, animated PNG-zip / MP4 muxers.
- `src/ui/` — floating shell: modes bar, per-mode toolbox, context panels, menu morph.

Key ideas:
- **SVG DOM is the truth** (so SVG export is lossless); `<symbol>` + `<use>` instancing.
- The camera is the root `<svg>` viewBox; zoom is cursor-anchored.
- Randomness is **seeded per cell** via `hash2(col, row, seed)` → scenes reproduce exactly.
- A placed item is an `Instance` keyed by `"col,row"`; multi-cell items use optional `cw`/`ch`.

## UI model

Four **modes** (Draw, Compose, Animate, Export) swap the bottom toolbox. Tools open
**context panels** above it, gated by `state.contextPanel` (`shapes`, `colors`, `stencil`,
`seamless`, `divider`, `halftone`, `edit`, `grid`, `block`, `animate`, `export`).

The context box (`#context`) wraps a scrollable **`#ctx-body`** (the active panel) + a shared
**`#ctx-brush`** footer (Brush / Size / Cell). The footer shows for brush-relevant contexts
(stencil/divider/seamless/block/edit + base draw/erase), hidden for shapes/colors. Only the
body scrolls, so the footer is always visible.

Menu transitions use `src/ui/morph.ts` (`morphResize` / `morphOpen` / `morphClose`):
fade content out → morph the box size → fade in. The toolbox morphs on **mode change**. The
context **box** morphs open/close (`#context`); a **panel→panel switch morphs only `#ctx-body`**
so the footer stays fixed (the bottom-anchored dock keeps it in place). **If you change a morph
CSS duration, sync the matching `SIZE`/`FADE` constant in `morph.ts`.**

## Conventions

- **Communicate in Brazilian Portuguese** (the user does).
- Match the surrounding code's style: small focused modules, terse comments that explain
  *why*, no new runtime deps in the core (the only deps are `jszip` + `mp4-muxer` for export).
- **Commit/push only when asked.** Keep commit messages factual and scoped to what changed;
  identify the assistant in the trailer, e.g. `Co-authored-by: Copilot <noreply@github.com>`.
  The workflow commits to `main` directly. GitHub: `git@github.com:pedroleitin/SVG_DRAW.git`.
- Track ideas/known-bugs in [BACKLOG.md](BACKLOG.md); mark items done there when shipped.

## Gotchas

- `tsconfig` has `noEmit: true` and `types: []`. `import.meta.glob` needs
  `src/vite-env.d.ts` (`/// <reference types="vite/client" />`) to typecheck.
- A native `<input type="color">` mis-positions if its element is **rebuilt on click** — split
  structural rebuilds from active-state toggles (see `colorsPanel.ts`).
- SVG **geometry presentation attributes** (`x`/`y`/`width`/`height`/`rx`) can CSS-transition,
  but `auto ↔ number` won't interpolate — always set `rx` numerically.
- The zoom-out button label is `−` (U+2212), not an ASCII hyphen.

## Verification

Typecheck with `npx tsc -p .`, then sanity-check behavior in headless Chrome (e.g.
playwright-core with `channel: "chrome"`). **Re-query the DOM after any click that triggers a
re-render** (elements detach), and prefer reading state/classes over pixel-diffing. Clean up
temp scripts/screenshots when done.
