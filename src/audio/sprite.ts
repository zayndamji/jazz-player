import * as Tone from "tone";

/** One audio file per instrument, holding every sample. Regions are [start, end] in seconds. */
export type Regions = Record<string, number[]>;

export function loadSprite(url: string): Promise<Tone.ToneAudioBuffer> {
  return Tone.ToneAudioBuffer.load(url).then((audio) => new Tone.ToneAudioBuffer(audio));
}

const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const;

/** "D#3" to MIDI 51 (C4 = 60). */
export function noteToMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) throw new Error(`bad note name: ${name}`);
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return SEMITONE[m[1] as keyof typeof SEMITONE] + accidental + 12 * (Number(m[3]) + 1);
}

/**
 * The sampled note closest to `midi` and the playback rate that tunes it.
 * On a tie it takes the higher sample, as Tone.Sampler does (it checks above first).
 */
export function pickSample(midi: number, sampled: number[]): { midi: number; rate: number } {
  let best = sampled[0];
  for (const s of sampled) {
    const d = Math.abs(s - midi);
    const bd = Math.abs(best - midi);
    if (d < bd || (d === bd && s > best)) best = s;
  }
  return { midi: best, rate: 2 ** ((midi - best) / 12) };
}

/** Where a voice starts in the shared buffer and how long it may play (never into the next region). */
export function voiceSpan(region: number[], rate: number): { offset: number; maxLen: number } {
  return { offset: region[0], maxLen: (region[1] - region[0]) / rate };
}

export interface SpriteSamplerOptions {
  buffer: Tone.ToneAudioBuffer;
  regions: Regions;
  /** Fade-out in seconds after a note ends. */
  release: number;
  /** Low-pass per voice: cutoff runs from `low` Hz at velocity 0 to `high` Hz at velocity 1. */
  brightness?: { low: number; high: number };
}

interface Voice {
  source: Tone.ToneBufferSource;
}

/**
 * A sampler that plays regions of one shared buffer (no copies of the audio).
 *
 * Findings from Tone's ToneBufferSource and OneShotSource:
 * - start(time, offset, duration, gain) starts the native source at `offset` (it is not
 *   given a length) and, when `duration` is set, calls stop(time + duration). Nothing
 *   else keeps a voice inside its region, so notes are ended early enough (see below).
 * - stop(t) does not cut at t. It ramps the gain to 0 over fadeOut starting at t and
 *   stops the native source later (fadeOut after t, plus twice that for an exponential curve).
 *   The ramp is in output time, so playbackRate does not change it.
 * - The curve defaults to "linear". Tone.Sampler uses "exponential", so this does too.
 * - After onended the source disposes itself.
 */
export class SpriteSampler {
  private readonly output = new Tone.Gain(1);
  private readonly names: number[];
  private readonly byMidi = new Map<number, number[]>();
  private voices = new Set<Voice>();

  constructor(private readonly options: SpriteSamplerOptions) {
    for (const [name, region] of Object.entries(options.regions)) this.byMidi.set(noteToMidi(name), region);
    this.names = [...this.byMidi.keys()];
  }

  connect(node: Tone.InputNode): this {
    this.output.connect(node);
    return this;
  }

  /** Velocity is the gain, as in Tone.Sampler. */
  triggerAttackRelease(midi: number, duration: number, time: number, velocity = 1) {
    const { midi: sampled, rate } = pickSample(midi, this.names);
    const region = this.byMidi.get(sampled)!;
    const { offset, maxLen } = voiceSpan(region, rate);
    const source = new Tone.ToneBufferSource({
      url: this.options.buffer,
      curve: "exponential",
      fadeOut: this.options.release,
      playbackRate: rate,
    });
    let filter: Tone.Filter | undefined;
    const b = this.options.brightness;
    if (b) {
      const v = Math.min(1, Math.max(0, velocity));
      filter = new Tone.Filter({ type: "lowpass", rolloff: -12, frequency: b.low * (b.high / b.low) ** v });
      source.connect(filter);
      filter.connect(this.output);
    } else source.connect(this.output);

    source.start(time, offset, maxLen, velocity);
    // End the note early enough for its release fade to finish inside the region: this clamp is
    // what keeps a voice out of the next sample. (Tone stops the native source itself after the
    // fade; stopping it ourselves would be overridden by that later stop.) A note longer than the
    // region minus the release is cut there, which is about 2.9 s for the bass.
    source.stop(time + Math.max(0.02, Math.min(duration, maxLen - this.options.release)));

    const voice: Voice = { source };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      filter?.dispose();
    };
  }

  /** Fade every sounding voice out, over `fade` seconds when given (else the instrument's own release). */
  releaseAll(fade?: number) {
    const now = Tone.now();
    for (const { source } of this.voices) {
      if (fade !== undefined) source.fadeOut = fade;
      source.stop(now);
    }
    this.voices.clear();
  }
}
