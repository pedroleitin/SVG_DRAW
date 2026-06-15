import JSZip from "jszip";
import type { SceneState } from "../scene/types";
import type { Library } from "../features/library";
import { buildSceneSVG } from "./svgExport";
import { rasterizeSvg, downloadBlob } from "./raster";
import { outSize } from "./frame";

export interface SeqOptions {
  fps: number;
  duration: number; // seconds
  background?: string | null;
  onProgress?: (done: number, total: number) => void;
}

/** Render the animation frame-by-frame (sampling the pure timeline) and bundle
 *  the PNGs into a .zip. */
export async function exportPngSequence(
  state: SceneState,
  library: Library,
  opts: SeqOptions,
): Promise<void> {
  const { fps, duration, background, onProgress } = opts;
  const { outW, outH } = outSize(state.frame);
  const total = Math.max(1, Math.round(duration * fps));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const zip = new JSZip();
  const pad = String(total).length;

  for (let i = 0; i < total; i++) {
    const svg = buildSceneSVG(state, library, i / fps, background);
    await rasterizeSvg(svg, canvas);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
    );
    zip.file(`frame_${String(i).padStart(pad, "0")}.png`, blob);
    onProgress?.(i + 1, total);
  }

  const out = await zip.generateAsync({ type: "blob" });
  downloadBlob(out, `svg-grid-${outW}x${outH}-${total}f.zip`);
}
