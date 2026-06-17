/** Generative UI sound — plain Web Audio (oscillators + envelopes), no external
 *  library, mirroring the sibling Grid-o-matic project. A lazily-created
 *  AudioContext (browsers require a user gesture, so it resumes on first use)
 *  plays short blips on place / erase and a two-note chirp on theme toggle. */

// A 2-octave C-major-ish scale; placement pitch follows the cell so drawing is
// musical rather than a single repeated tone.
const SCALE = [
  261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25,
  784, 880, 1046.5, 1174.66, 1318.51, 1568, 1760, 2093,
];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  muted: boolean;

  constructor(muted = false) {
    this.muted = muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  /** Lazily create + resume the context. Returns null when muted/unavailable. */
  private async get(): Promise<AudioContext | null> {
    if (this.muted) return null;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AC();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        return null;
      }
    }
    return this.ctx.state === "running" ? this.ctx : null;
  }

  /** One enveloped oscillator. `glideTo` sweeps the pitch over the duration. */
  private async blip(
    freq: number,
    dur: number,
    vol: number,
    type: OscillatorType = "sine",
    glideTo?: number,
  ): Promise<void> {
    const ctx = await this.get();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo != null) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t);
    osc.stop(t + dur);
  }

  /** Pitched note for a placed cell — index picks the scale degree. */
  note(index: number): void {
    const i = ((index % SCALE.length) + SCALE.length) % SCALE.length;
    void this.blip(SCALE[i], 0.3, 0.12, "sine");
  }

  /** Short falling sweep for erase. */
  erase(): void {
    void this.blip(600, 0.12, 0.1, "sine", 300);
  }

  /** Two-note chirp for the theme toggle (up into dark, down into light). */
  async theme(toDark: boolean): Promise<void> {
    const ctx = await this.get();
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = (freq: number, delay: number, dur: number, vol: number): void => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + delay);
      gain.gain.linearRampToValueAtTime(vol, t + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
      osc.start(t + delay);
      osc.stop(t + delay + dur);
    };
    if (toDark) {
      n(880, 0, 0.18, 0.22);
      n(440, 0.1, 0.22, 0.26);
    } else {
      n(440, 0, 0.18, 0.22);
      n(880, 0.1, 0.22, 0.26);
    }
  }
}
