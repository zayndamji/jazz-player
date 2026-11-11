import * as Tone from "tone";
import type { BeatMark, Schedule } from "../engine/schedule";
import type { DrumSound, NoteEvent, Track } from "../styles/types";

const BASE = import.meta.env.BASE_URL + "samples/";

const PIANO_SAMPLES: Record<string, string> = {
  A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3",
  "F#4": "Fs4.mp3", A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3",
};

const BASS_SAMPLES: Record<string, string> = {
  E1: "E1.mp3", G1: "G1.mp3", "A#1": "Bb1.mp3", "C#2": "Db2.mp3", E2: "E2.mp3", G2: "G2.mp3", "A#2": "Bb2.mp3",
  "C#3": "Db3.mp3", E3: "E3.mp3",
};

export interface Position {
  bar: number;
  beat: number;
  countIn: boolean;
}

export type Mixable = Track | "metronome";

const ticks = (beats: number) => `${Math.round(beats * Tone.getTransport().PPQ)}i`;

/**
 * Plays a Schedule with Tone.js. All times are in beats on the Transport, so
 * tempo changes take effect right away, even while playing.
 */
export class Player {
  private channels!: Record<Mixable, Tone.Channel>;
  private piano!: Tone.Sampler;
  private bass!: Tone.Sampler;
  private drums!: Record<DrumSound, (time: number, velocity: number) => void>;
  private click!: Tone.Synth;
  private notes: Tone.Part<[string, NoteEvent]> | null = null;
  private clock: Tone.Part<[string, BeatMark]> | null = null;
  private endId: number | null = null;
  private loaded: Promise<void> | null = null;

  metronomeOn = true;
  onPosition: (p: Position | null) => void = () => {};
  onEnd: () => void = () => {};

  /** Create instruments and load samples. Call after a user gesture. */
  load(): Promise<void> {
    if (this.loaded) return this.loaded;
    this.loaded = (async () => {
      await Tone.start();
      const out = new Tone.Compressor({ threshold: -14, ratio: 3 }).toDestination();
      const reverb = new Tone.Reverb({ decay: 1.6, wet: 0.14 }).connect(out);
      const channel = (volume: number) => new Tone.Channel({ volume }).connect(reverb);
      this.channels = { bass: channel(-2), piano: channel(-8), drums: channel(-10), metronome: channel(-8) };

      this.piano = new Tone.Sampler({ urls: PIANO_SAMPLES, baseUrl: BASE + "piano/", release: 0.8 }).connect(this.channels.piano);
      this.bass = new Tone.Sampler({ urls: BASS_SAMPLES, baseUrl: BASE + "bass/", release: 0.25 }).connect(this.channels.bass);
      this.drums = makeDrums(this.channels.drums);
      this.click = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
      }).connect(this.channels.metronome);
      await Tone.loaded();
    })();
    return this.loaded;
  }

  setSchedule(schedule: Schedule) {
    const transport = Tone.getTransport();
    this.notes?.dispose();
    this.clock?.dispose();
    if (this.endId !== null) transport.clear(this.endId);

    this.notes = new Tone.Part<[string, NoteEvent]>(
      (time, e) => this.playNote(time, e),
      schedule.events.map((e): [string, NoteEvent] => [ticks(e.time), e]),
    );
    this.clock = new Tone.Part<[string, BeatMark]>((time, mark) => {
      if (this.metronomeOn || mark.countIn) {
        this.click.triggerAttackRelease(mark.beat === 0 ? "E6" : "A5", 0.03, time, mark.beat === 0 ? 0.9 : 0.55);
      }
      Tone.getDraw().schedule(() => {
        if (Tone.getTransport().state === "started") this.onPosition({ bar: mark.bar, beat: mark.beat, countIn: mark.countIn });
      }, time);
    }, schedule.beats.map((b): [string, BeatMark] => [ticks(b.time), b]));
    this.notes.start(0);
    this.clock.start(0);
    // Let the last chord ring for two beats before stopping. A plain timer, not
    // Tone's Draw queue: Draw drops callbacks when animation frames are throttled.
    this.endId = transport.schedule((time) => {
      const delay = Math.max(0, (time - Tone.now()) * 1000);
      window.setTimeout(() => this.stop(), delay);
    }, ticks(schedule.totalBeats + 2));
  }

  private playNote(time: number, e: NoteEvent) {
    const duration = ticks(e.duration);
    if (e.track === "drums" && e.drum) this.drums[e.drum](time, e.velocity);
    else if (e.notes) {
      const names = e.notes.map((n) => Tone.Frequency(n, "midi").toNote());
      (e.track === "piano" ? this.piano : this.bass).triggerAttackRelease(names, duration, time, e.velocity);
    }
  }

  play() {
    const transport = Tone.getTransport();
    transport.position = 0;
    transport.start("+0.05");
  }

  stop() {
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    Tone.getDraw().cancel(0);
    this.piano?.releaseAll();
    this.bass?.releaseAll();
    this.onPosition(null);
    this.onEnd();
  }

  setTempo(bpm: number) {
    Tone.getTransport().bpm.value = bpm;
  }

  setVolume(track: Mixable, level: number) {
    if (!this.channels) return;
    const base = { bass: -2, piano: -8, drums: -10, metronome: -8 }[track];
    this.channels[track].volume.value = level <= 0 ? -Infinity : base + Tone.gainToDb(level);
  }

  setMute(track: Mixable, mute: boolean) {
    if (this.channels) this.channels[track].mute = mute;
  }
}

/** Synthesized bossa kit: soft kick, cross-stick click, and a shaker-like hi-hat. */
function makeDrums(output: Tone.ToneAudioNode): Record<DrumSound, (time: number, velocity: number) => void> {
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.03,
    octaves: 5,
    envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.1 },
  }).connect(output);

  const rimFilter = new Tone.Filter({ type: "bandpass", frequency: 1900, Q: 1.2 }).connect(output);
  const rimNoise = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }).connect(rimFilter);
  const rimTone = new Tone.MembraneSynth({
    pitchDecay: 0.004,
    octaves: 1.5,
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
  }).connect(output);

  const hatFilter = new Tone.Filter({ type: "highpass", frequency: 7500 }).connect(output);
  const hat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.045, sustain: 0 } }).connect(hatFilter);
  hat.volume.value = -6;

  return {
    kick: (time, v) => kick.triggerAttackRelease("A0", 0.3, time, v),
    rim: (time, v) => {
      rimTone.triggerAttackRelease("E5", 0.05, time, v * 0.6);
      rimNoise.triggerAttackRelease(0.03, time, v);
    },
    hat: (time, v) => hat.triggerAttackRelease(0.04, time, v),
  };
}
