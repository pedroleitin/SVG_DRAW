import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { SceneState } from "../scene/types";
import type { Library } from "../features/library";
import { buildSceneSVG } from "./svgExport";
import { rasterizeSvg, downloadBlob } from "./raster";
import { outSize } from "./frame";

export interface VideoOptions {
  fps: number;
  duration: number; // seconds
  background?: string | null;
  onProgress?: (done: number, total: number) => void;
}

/** WebCodecs is required for in-browser H.264 encoding. */
export function isVideoExportSupported(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

/** Pick the first H.264 codec string the browser can encode at this size. */
async function pickCodec(w: number, h: number, fps: number, bitrate: number): Promise<string> {
  const candidates = ["avc1.640034", "avc1.640028", "avc1.4d0028", "avc1.42001f"];
  for (const codec of candidates) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps });
      if (r.supported) return codec;
    } catch {
      /* try next */
    }
  }
  return "avc1.42001f";
}

/** Render the animation frame-by-frame and encode an MP4 (H.264) in-browser. */
export async function exportMp4(
  state: SceneState,
  library: Library,
  opts: VideoOptions,
): Promise<void> {
  const { fps, duration, background, onProgress } = opts;
  let { outW, outH } = outSize(state.frame);
  outW -= outW % 2; // H.264 needs even dimensions
  outH -= outH % 2;
  const total = Math.max(1, Math.round(duration * fps));
  const bitrate = Math.min(24_000_000, Math.max(2_000_000, Math.round(outW * outH * fps * 0.07)));
  const codec = await pickCodec(outW, outH, fps, bitrate);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: outW, height: outH },
    fastStart: "in-memory",
  });
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  encoder.configure({ codec, width: outW, height: outH, bitrate, framerate: fps });

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;

  // H.264 has no alpha, so always composite onto a solid background.
  const bgFill = background ?? "#ffffff";
  for (let i = 0; i < total; i++) {
    if (encodeError) throw encodeError;
    const svg = buildSceneSVG(state, library, i / fps, bgFill);
    await rasterizeSvg(svg, canvas);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((i * 1e6) / fps),
      duration: Math.round(1e6 / fps),
    });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    // Relieve backpressure so memory doesn't balloon on long exports.
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    onProgress?.(i + 1, total);
  }

  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;
  muxer.finalize();
  const { buffer } = muxer.target;
  downloadBlob(new Blob([buffer], { type: "video/mp4" }), `svg-grid-${outW}x${outH}.mp4`);
}
