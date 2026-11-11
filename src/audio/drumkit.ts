import * as Tone from "tone";
import type { DrumSound } from "../styles/types";

/**
 * Sampled acoustic kit (Virtuosity Drums, CC0). public/samples/drums/kit.json,
 * written by scripts/fetch_drum_samples.py, lists each sound's files by velocity
 * layer (soft to hard), each layer with one or more round-robin takes.
 * The kit has no brushes, so the brush sweep and tap are made from shaped noise.
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
  brush: 0.035,
  brushTap: 0.12,
};

/** Seeded white noise, so the synthesized brushes are the same on every load. */
function noise(length: number, seed: number): Float32Array {
  const out = new Float32Array(length);
  let s = seed >>> 0;
  for (let i = 0; i < length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = s / 2 ** 31 - 1;
  }
  return out;
}

/** One-pole high-pass then low-pass, in place: the band of wire brushes on a snare head. */
function band(x: Float32Array, rate: number, low: number, high: number) {
  const a = Math.exp((-2 * Math.PI * low) / rate);
  const b = 1 - Math.exp((-2 * Math.PI * high) / rate);
  let lp = 0;
  let hpPrev = 0;
  let hp = 0;
  for (let i = 0; i < x.length; i++) {
    hp = a * (hp + x[i] - hpPrev);
    hpPrev = x[i];
    lp += b * (hp - lp);
    x[i] = lp;
  }
}

/**
 * A brush sweep: 1.3 s of filtered noise that swells and fades, with a slow
 * flutter like bristles dragging. Styles start one every two beats so they overlap.
 */
function brushSweep(rate: number, seed: number): Float32Array {
  const length = Math.round(1.3 * rate);
  const x = noise(length, seed);
  band(x, rate, 1200, 4500);
  for (let i = 0; i < length; i++) {
    const t = i / length;
    const swell = t < 0.4 ? Math.sin((t / 0.4) * (Math.PI / 2)) ** 2 : Math.cos(((t - 0.4) / 0.6) * (Math.PI / 2)) ** 2;
    const flutter = 1 + 0.18 * Math.sin(2 * Math.PI * 6 * (i / rate) + seed);
    x[i] *= 0.9 * swell * flutter;
  }
  return x;
}

/** A brush stroke on beats 2 and 4: a short noise burst with a little drum body. */
function brushTap(rate: number, seed: number): Float32Array {
  const length = Math.round(0.3 * rate);
  const x = noise(length, seed);
  band(x, rate, 700, 4000);
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const attack = Math.min(1, t / 0.004);
    x[i] = attack * (1.6 * x[i] * Math.exp(-t / 0.05) + 0.12 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.035));
  }
  return x;
}

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
    const rate = Tone.getContext().sampleRate;
    const made = (make: (rate: number, seed: number) => Float32Array) => [[1, 2, 3].map((seed) => Tone.ToneAudioBuffer.fromArray(make(rate, seed)))];
    this.layers.set("brush", made(brushSweep));
    this.layers.set("brushTap", made(brushTap));
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
