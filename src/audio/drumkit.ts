import * as Tone from "tone";
import type { DrumSound } from "../styles/types";

/**
 * Sampled acoustic kit (Virtuosity Drums, CC0). public/samples/drums/kit.json,
 * written by scripts/fetch_drum_samples.py, lists each sound's files by velocity
 * layer (soft to hard), each layer with one or more round-robin takes.
 */
type Manifest = Record<string, string[][]>;

/** Level of each sound relative to the others, so a style's velocities mean the same thing everywhere. */
const TRIM: Record<DrumSound, number> = {
  kick: 0.7,
  rim: 1.1,
  snare: 0.8,
  hat: 3.2,
  pedal: 0.9,
  ride: 1.8,
  crash: 0.45,
  tomHigh: 0.7,
  tomLow: 0.75,
};

export class DrumKit {
  private layers = new Map<DrumSound, Tone.ToneAudioBuffer[][]>();
  private turn = new Map<DrumSound, number>();

  constructor(private output: Tone.ToneAudioNode) {}

  async load(base: string) {
    const manifest: Manifest = await (await fetch(base + "kit.json")).json();
    for (const [sound, layers] of Object.entries(manifest)) {
      this.layers.set(
        sound as DrumSound,
        layers.map((takes) => takes.map((file) => new Tone.ToneAudioBuffer(base + file))),
      );
    }
  }

  /** Play a hit. Velocity picks the layer and scales the level within it. */
  play(sound: DrumSound, time: number, velocity: number) {
    const layers = this.layers.get(sound);
    if (!layers?.length) return;
    const v = Math.min(1, Math.max(0, velocity));
    const takes = layers[Math.min(layers.length - 1, Math.floor(v * layers.length))];
    const n = this.turn.get(sound) ?? 0;
    this.turn.set(sound, n + 1);
    const buffer = takes[n % takes.length];
    if (!buffer.loaded) return;
    const source = new Tone.ToneBufferSource(buffer).connect(this.output);
    source.onended = () => source.dispose();
    source.start(time, 0, undefined, TRIM[sound] * (0.45 + 0.55 * v));
  }
}
