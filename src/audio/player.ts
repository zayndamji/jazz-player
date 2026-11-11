import * as Tone from "tone";
import type { BeatMark, Schedule } from "../engine/schedule";
import type { NoteEvent, Track } from "../styles/types";
import { DrumKit } from "./drumkit";

const BASE = import.meta.env.BASE_URL + "samples/";

/** Note name to file for samples taken every minor third. */
function sampleMap(notes: string[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const n of notes) {
    const file = n.replace("D#", "Ds").replace("F#", "Fs").replace("A#", "Bb").replace("C#", "Db");
    files[n] = file + ".mp3";
  }
  return files;
}

const PIANO_SAMPLES = sampleMap(["A2", "C3", "D#3", "F#3", "A3", "C4", "D#4", "F#4", "A4", "C5", "D#5", "F#5", "A5"]);
const BASS_SAMPLES = sampleMap(["E1", "G1", "A#1", "C#2", "E2", "G2", "A#2", "C#3", "E3"]);
const GUITAR_SAMPLES = sampleMap(["E2", "G2", "A#2", "C#3", "E3", "G3", "A#3", "C#4", "E4", "G4", "A#4", "C#5", "E5"]);

export interface Position {
  bar: number;
  beat: number;
  countIn: boolean;
}

export type Mixable = Track | "metronome";

/** Level and stereo position of each channel. */
const CHANNELS: Record<Mixable, { volume: number; pan: number }> = {
  // Balanced against the reference track's band levels (context/reference-backing-track.md).
  bass: { volume: -6, pan: 0 },
  piano: { volume: -8, pan: -0.25 },
  guitar: { volume: -3.5, pan: 0.35 },
  drums: { volume: -4, pan: 0 },
  metronome: { volume: -8, pan: 0 },
};

const ticks = (beats: number) => `${Math.round(beats * Tone.getTransport().PPQ)}i`;

/**
 * Plays a Schedule with Tone.js. All times are in beats on the Transport, so
 * tempo changes take effect right away, even while playing.
 */
export class Player {
  private channels!: Record<Mixable, Tone.Channel>;
  private piano!: Tone.Sampler;
  private bass!: Tone.Sampler;
  private guitar!: Tone.Sampler;
  private drums!: DrumKit;
  private click!: Tone.Synth;
  private notes: Tone.Part<[string, NoteEvent]> | null = null;
  private clock: Tone.Part<[string, BeatMark]> | null = null;
  private endId: number | null = null;
  private loaded: Promise<void> | null = null;

  private styleMix: Partial<Record<Track, number>> = {};
  private levels: Record<Mixable, number> = { bass: 1, piano: 1, guitar: 1, drums: 1, metronome: 1 };

  metronomeOn = false;
  onPosition: (p: Position | null) => void = () => {};
  onLoop: () => void = () => {};
  onEnd: () => void = () => {};

  /** Create instruments and load samples. Call after a user gesture. */
  load(): Promise<void> {
    if (this.loaded) return this.loaded;
    this.loaded = (async () => {
      await Tone.start();
      const out = new Tone.Compressor({ threshold: -16, ratio: 2.5, attack: 0.01, release: 0.2 }).toDestination();
      const room = new Tone.Reverb({ decay: 1.4, preDelay: 0.01, wet: 0.16 }).connect(out);
      const channels = {} as Record<Mixable, Tone.Channel>;
      for (const [name, c] of Object.entries(CHANNELS)) channels[name as Mixable] = new Tone.Channel(c).connect(room);
      this.channels = channels;

      this.piano = new Tone.Sampler({ urls: PIANO_SAMPLES, baseUrl: BASE + "piano/", release: 0.9 }).connect(channels.piano);
      this.bass = new Tone.Sampler({ urls: BASS_SAMPLES, baseUrl: BASE + "bass/", release: 0.25 }).connect(channels.bass);
      // A treble lift gives the nylon guitar the presence of the reference recording.
      const guitarTone = new Tone.Filter({ type: "highshelf", frequency: 2500, gain: 5 }).connect(channels.guitar);
      this.guitar = new Tone.Sampler({ urls: GUITAR_SAMPLES, baseUrl: BASE + "guitar/", release: 0.12 }).connect(guitarTone);
      this.drums = new DrumKit(channels.drums);
      await this.drums.load(BASE + "drums/");
      this.click = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
      }).connect(channels.metronome);
      Tone.getTransport().on("loop", () => window.setTimeout(() => this.onLoop(), 0));
      await Tone.loaded();
    })();
    return this.loaded;
  }

  /** Replace what's playing. The Transport keeps its position, so this works mid-song. */
  setSchedule(schedule: Schedule) {
    this.styleMix = schedule.mix;
    (Object.keys(this.levels) as Mixable[]).forEach((t) => this.setVolume(t, this.levels[t]));
    const transport = Tone.getTransport();
    this.notes?.dispose();
    this.clock?.dispose();
    if (this.endId !== null) transport.clear(this.endId);
    this.endId = null;

    this.notes = new Tone.Part<[string, NoteEvent]>(
      (time, e) => this.playNote(time, e),
      schedule.events.map((e): [string, NoteEvent] => [ticks(e.time), e]),
    );
    this.clock = new Tone.Part<[string, BeatMark]>((time, mark) => {
      if (mark.click && (this.metronomeOn || mark.countIn)) {
        this.click.triggerAttackRelease(mark.beat === 0 ? "E6" : "A5", 0.03, time, mark.beat === 0 ? 0.9 : 0.55);
      }
      Tone.getDraw().schedule(() => {
        if (Tone.getTransport().state === "started") this.onPosition({ bar: mark.bar, beat: mark.beat, countIn: mark.countIn });
      }, time);
    }, schedule.beats.map((b): [string, BeatMark] => [ticks(b.time), b]));
    this.notes.start(0);
    this.clock.start(0);

    if (schedule.loop) {
      transport.setLoopPoints(ticks(schedule.loop.start), ticks(schedule.loop.end));
      transport.loop = true;
    } else {
      transport.loop = false;
      // Let the last chord ring for two beats before stopping. A plain timer, not
      // Tone's Draw queue: Draw drops callbacks when animation frames are throttled.
      this.endId = transport.schedule((time) => {
        const delay = Math.max(0, (time - Tone.now()) * 1000);
        window.setTimeout(() => this.stop(), delay);
      }, ticks(schedule.totalBeats + 2));
    }
  }

  private playNote(time: number, e: NoteEvent) {
    const duration = ticks(e.duration);
    if (e.track === "drums" && e.drum) this.drums.play(e.drum, time, e.velocity);
    else if (e.notes) {
      const names = e.notes.map((n) => Tone.Frequency(n, "midi").toNote());
      const instrument = e.track === "piano" ? this.piano : e.track === "guitar" ? this.guitar : this.bass;
      if (e.track === "guitar") {
        // Strum: low string first, a few milliseconds apart.
        names.forEach((n, i) => instrument.triggerAttackRelease(n, duration, time + i * 0.008, e.velocity * (1 - i * 0.04)));
      } else instrument.triggerAttackRelease(names, duration, time, e.velocity);
    }
  }

  /** Start from the top of the schedule. */
  play() {
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    transport.start("+0.05");
  }

  get playing() {
    return Tone.getTransport().state === "started";
  }

  stop() {
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    Tone.getDraw().cancel(0);
    this.piano?.releaseAll();
    this.bass?.releaseAll();
    this.guitar?.releaseAll();
    this.onPosition(null);
    this.onEnd();
  }

  setTempo(bpm: number) {
    Tone.getTransport().bpm.value = bpm;
  }

  setVolume(track: Mixable, level: number) {
    this.levels[track] = level;
    if (!this.channels) return;
    const style = track === "metronome" ? 0 : (this.styleMix[track] ?? 0);
    this.channels[track].volume.value = level <= 0 ? -Infinity : CHANNELS[track].volume + style + Tone.gainToDb(level);
  }

  setMute(track: Mixable, mute: boolean) {
    if (this.channels) this.channels[track].mute = mute;
  }
}
