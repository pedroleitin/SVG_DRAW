/** Drives a requestAnimationFrame loop, accumulating elapsed seconds and
 *  calling back each frame. Decoupled from what gets rendered — it just owns
 *  "what time is it". Speed and per-cell phase are applied downstream so the
 *  same clock can be paused, scrubbed, or sampled by the exporter. */
export class AnimationEngine {
  private raf = 0;
  private playing = false;
  private last = 0;
  private time = 0;

  constructor(private onFrame: (t: number) => void) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  now(): number {
    return this.time;
  }

  /** Jump the clock (e.g. exporter sampling a specific frame). */
  setTime(t: number): void {
    this.time = t;
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  private loop = (): void => {
    const n = performance.now();
    this.time += (n - this.last) / 1000;
    this.last = n;
    this.onFrame(this.time);
    if (this.playing) this.raf = requestAnimationFrame(this.loop);
  };
}
