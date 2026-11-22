import * as Tone from "tone";
import type { DrumSound } from "../styles/types";
import type { Regions } from "./sprite";

/**
 * Sampled acoustic kit (Virtuosity Drums, CC0), all in one file. The kit table in
 * src/audio/sprites.json (from scripts/make_sprites.py) lists each sound's regions
 * by velocity layer (soft to hard), each layer with one or more round-robin takes.
 * The kit has no brushes, so the brush sweep and tap are made from shaped noise.
 */
type Kit = Record<string, string[][]>;

/** One hit: a region of the shared buffer, or a whole synthesized buffer. */
interface Take {
  buffer: Tone.ToneAudioBuffer;
  offset: number;
  length?: number;
}

/** Velocity jitter, so hits near a layer boundary mix the layers. */
const JITTER = 0.06;

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
  private layers = new Map<DrumSound, Take[][]>();
  private last = new Map<DrumSound, number>();
  private playing = new Set<Tone.ToneBufferSource>();

  constructor(private output: Tone.ToneAudioNode) {}

  load(sprite: Tone.ToneAudioBuffer, regions: Regions, kit: Kit) {
    for (const [sound, layers] of Object.entries(kit)) {
      this.layers.set(
        sound as DrumSound,
        layers.map((takes) => takes.map((name) => ({ buffer: sprite, offset: regions[name][0], length: regions[name][1] - regions[name][0] }))),
      );
    }
    const rate = Tone.getContext().sampleRate;
    const made = (make: (rate: number, seed: number) => Float32Array) => [
      [1, 2, 3].map((seed) => ({ buffer: Tone.ToneAudioBuffer.fromArray(make(rate, seed)), offset: 0 })),
    ];
    this.layers.set("brush", made(brushSweep));
    this.layers.set("brushTap", made(brushTap));
  }

  /**
   * Play a hit. Velocity picks the layer and scales the level within it; `gain` scales the level alone.
   * Every hit rings its whole region (the crash 3.5 s, the ride 2.5 s, both faded to about -77 dB at the
   * region's end in the sprite), with no choke: only `stopAll` shortens it, and the player waits for the
   * last crash to ring out before it fades the band at the end of a song (`ringSeconds` in schedule.ts).
   */
  play(sound: DrumSound, time: number, velocity: number, gain = 1) {
    const layers = this.layers.get(sound);
    if (!layers?.length) return;
    const v = Math.min(1, Math.max(0, velocity));
    const j = Math.min(1, Math.max(0, v + (Math.random() * 2 - 1) * JITTER));
    const takes = layers[Math.min(layers.length - 1, Math.floor(j * layers.length))];
    // A random take, never the same one twice in a row.
    const prev = this.last.get(sound) ?? -1;
    let n = Math.floor(Math.random() * takes.length);
    if (takes.length > 1 && n === prev) n = (n + 1 + Math.floor(Math.random() * (takes.length - 1))) % takes.length;
    this.last.set(sound, n);
    const take = takes[n];
    const source = new Tone.ToneBufferSource(take.buffer).connect(this.output);
    this.playing.add(source);
    source.onended = () => {
      this.playing.delete(source);
      source.dispose();
    };
    source.start(time, take.offset, take.length, gain * TRIM[sound] * (0.45 + 0.55 * v));
  }

  /** Fade out every hit that is sounding or about to (ride, crash and brush tails), over `fade` seconds. */
  stopAll(fade = 0.08) {
    const now = Tone.now();
    for (const source of [...this.playing]) {
      try {
        source.fadeOut = fade;
        source.stop(now);
      } catch {
        // Already finished.
      }
    }
  }
}
