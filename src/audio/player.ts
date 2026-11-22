import * as Tone from "tone";
import { clicksOn, ringSeconds, ritardAt, ritardFor, type BeatMark, type ClickMode, type Schedule } from "../engine/schedule";
import type { NoteEvent, Track } from "../styles/types";
import { DrumKit } from "./drumkit";
import { SpriteSampler, loadSprite } from "./sprite";
import sprites from "./sprites.json";

const BASE = import.meta.env.BASE_URL + "samples/";

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
  // Comping sits right of centre, as in the reference tracks (piano right, guitar left when both play).
  piano: { volume: -8, pan: 0.2 },
  guitar: { volume: -3.5, pan: -0.3 },
  drums: { volume: -4, pan: 0 },
  // The melody sits in the middle, a little in front of the comping.
  melody: { volume: -4, pan: 0 },
  metronome: { volume: -8, pan: 0 },
};

/** Seconds notes fade over when the band restarts or stops: quick, but not a click. */
const FADE = 0.08;

/** Seconds the band fades over at the end of the song (a user's stop keeps `FADE`). How long it rings first: `ringSeconds` in schedule.ts. */
export const END_FADE = 1.5;

type SpriteName = "piano" | "bass" | "guitar" | "drums";
const SPRITES: SpriteName[] = ["piano", "bass", "guitar", "drums"];

const ticks =(beats: number) => `${Math.round(beats * Tone.getTransport().PPQ)}i`;

/**
 * Plays a Schedule with Tone.js. All times are in beats on the Transport, so
 * tempo changes take effect right away, even while playing.
 */
export class Player {
  private channels!: Record<Mixable, Tone.Channel>;
  private piano!: SpriteSampler;
  private bass!: SpriteSampler;
  private guitar!: SpriteSampler;
  private melody!: SpriteSampler;
  private drums!: DrumKit;
  private click!: Tone.Synth;
  private notes: Tone.Part<[string, NoteEvent]> | null = null;
  private clock: Tone.Part<[string, BeatMark]> | null = null;
  private endId: number | null = null;
  /** The timer that stops the band after the last chord rings; cleared by a restart or a stop. */
  private endTimer: number | null = null;
  private passIds: number[] = [];
  /** The Transport event that starts the ritard into the final hit (`ritardFor`). */
  private ritardId: number | null = null;
  /** The tempo the user set; the Transport's own bpm runs under it during a ritard. */
  private tempo: number | null = null;
  private loaded: Promise<void> | null = null;
  private sprites: Promise<Record<SpriteName, Tone.ToneAudioBuffer>> | null = null;

  private styleMix: Partial<Record<Track, number>> = {};
  private master: Tone.Gain | null = null;
  private muted = false;
  /** The master level (0 to 1) the gain returns to when not muted. */
  private masterLevel = 1;
  private levels: Record<Mixable, number> = { bass: 1, piano: 1, guitar: 1, drums: 1, melody: 1, metronome: 1 };

  metronomeOn = false;
  /** Which beats the metronome clicks; the count-in always clicks every beat. */
  clickMode: ClickMode = "every";
  onPosition: (p: Position | null) => void = () => {};
  onLoop: () => void = () => {};
  /** Called when a pass of a loop ends and the next begins (every chorus of a key cycle, and on each wrap). */
  onPass: () => void = () => {};
  /** Called when playback stops: `finished` is true when the song ran to its end, false when stopped. */
  onEnd: (finished: boolean) => void = () => {};

  /**
   * Fetch and decode the sample files, without starting the audio (no user gesture needed: a
   * suspended AudioContext decodes). Runs once; `load` waits on the same files. A failure lets a
   * later call try again.
   */
  preload(): Promise<void> {
    return this.fetchSprites().then(() => {});
  }

  private fetchSprites() {
    if (!this.sprites) {
      // One file per instrument, loaded in parallel and shared by every voice.
      this.sprites = Promise.all(SPRITES.map((name) => loadSprite(BASE + sprites[name].file))).then(
        (buffers) => Object.fromEntries(SPRITES.map((name, i) => [name, buffers[i]])) as Record<SpriteName, Tone.ToneAudioBuffer>,
      );
      this.sprites.catch(() => {
        this.sprites = null;
      });
    }
    return this.sprites;
  }

  /** Start the audio and create the instruments, on the preloaded samples. Call after a user gesture. */
  load(): Promise<void> {
    if (this.loaded) return this.loaded;
    this.loaded = (async () => {
      // The files start loading before the audio starts, so a load without a preload loses no time.
      const files = this.fetchSprites();
      await Tone.start();
      // Master mute and volume are the last stage, so tools can still listen just before it.
      this.master = new Tone.Gain(this.muted ? 0 : this.masterLevel).toDestination();
      const out = new Tone.Compressor({ threshold: -14, ratio: 1.8, attack: 0.01, release: 0.2 }).connect(this.master);
      if (import.meta.env.DEV) (window as unknown as { __jazzPlayer: unknown }).__jazzPlayer = { preMute: out, Tone, player: this };
      const room = new Tone.Reverb({ decay: 1.4, preDelay: 0.01, wet: 0.16 }).connect(out);
      const channels = {} as Record<Mixable, Tone.Channel>;
      for (const [name, c] of Object.entries(CHANNELS)) channels[name as Mixable] = new Tone.Channel(c).connect(room);
      this.channels = channels;

      const { piano, bass, guitar, drums } = await files;
      this.piano = new SpriteSampler({ buffer: piano, regions: sprites.piano.regions, release: 0.9, brightness: { low: 3500, high: 16000 } }).connect(channels.piano);
      // The melody is a second voice on the piano samples (the same buffer): brighter, with a shorter release so a line reads as legato.
      this.melody = new SpriteSampler({ buffer: piano, regions: sprites.piano.regions, release: 0.3, brightness: { low: 5000, high: 16000 } }).connect(channels.melody);
      this.bass = new SpriteSampler({ buffer: bass, regions: sprites.bass.regions, release: 0.25 }).connect(channels.bass);
      // A treble lift gives the nylon guitar the presence of the reference recording.
      const guitarTone = new Tone.Filter({ type: "highshelf", frequency: 2500, gain: 5 }).connect(channels.guitar);
      this.guitar = new SpriteSampler({ buffer: guitar, regions: sprites.guitar.regions, release: 0.12 }).connect(guitarTone);
      this.drums = new DrumKit(channels.drums);
      this.drums.load(drums, sprites.drums.regions, sprites.drums.kit);
      this.click = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
      }).connect(channels.metronome);
      Tone.getTransport().on("loop", () => window.setTimeout(() => this.onLoop(), 0));
      await Tone.loaded();
    })();
    return this.loaded;
  }

  /** What's playing, for the dev tools (scripts/record-site.js). */
  schedule: Schedule | null = null;

  /** Replace what's playing. The Transport keeps its position, so this works mid-song. */
  setSchedule(schedule: Schedule) {
    this.schedule = schedule;
    this.styleMix = schedule.mix;
    (Object.keys(this.levels) as Mixable[]).forEach((t) => this.setVolume(t, this.levels[t]));
    const transport = Tone.getTransport();
    this.notes?.dispose();
    this.clock?.dispose();
    if (this.endId !== null) transport.clear(this.endId);
    this.endId = null;
    this.clearEndTimer();
    for (const id of this.passIds) transport.clear(id);
    this.passIds = [];
    this.followRitard();

    this.notes = new Tone.Part<[string, NoteEvent]>(
      (time, e) => this.playNote(time, e),
      schedule.events.map((e): [string, NoteEvent] => [ticks(e.time), e]),
    );
    this.clock = new Tone.Part<[string, BeatMark]>((time, mark) => {
      if (mark.click && (mark.countIn || (this.metronomeOn && clicksOn(this.clickMode, mark.beat, schedule.beatsPerBar)))) {
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
      // Each pass of the loop ends where the next copy begins. The Transport reaches the first copy's
      // start on its way in and again on every wrap. A plain timer, not Draw (see below).
      this.passIds = schedule.passes.map((beat) =>
        transport.schedule((time) => {
          window.setTimeout(() => this.onPass(), Math.max(0, (time - Tone.now()) * 1000));
        }, ticks(beat)),
      );
    } else {
      transport.loop = false;
      // Let the last chord and the crash ring out (`ringSeconds`, from the last bar's downbeat, at the
      // tempo the ritard slowed to), then fade gently and stop. Plain timers, not Tone's Draw queue:
      // Draw drops callbacks when animation frames are throttled.
      const lastStart = schedule.bars.at(-1)?.startBeat ?? 0;
      const lastBeats = schedule.totalBeats - lastStart;
      const ring = () => ringSeconds(lastBeats, transport.bpm.value);
      const at = Math.round(lastStart * transport.PPQ);
      if (transport.state === "started" && transport.ticks > at) {
        // A new schedule after the last downbeat (a tempo change while it rings): finish from here.
        const past = ((transport.ticks - at) / transport.PPQ) * (60 / transport.bpm.value);
        this.endAfter(Math.max(0, ring() - past) * 1000);
      } else {
        this.endId = transport.schedule((time) => this.endAfter(Math.max(0, (time - Tone.now()) * 1000) + ring() * 1000), `${at}i`);
      }
    }
  }

  /** In `ms`, fade the band out over `END_FADE`, then stop as a finished song (`onEnd(true)`). */
  private endAfter(ms: number) {
    this.clearEndTimer();
    this.endTimer = window.setTimeout(() => {
      this.releaseAll(END_FADE);
      this.endTimer = window.setTimeout(() => {
        this.endTimer = null;
        this.stop(true);
      }, (END_FADE + 0.1) * 1000);
    }, ms);
  }

  /** The user's tempo: what the Transport plays at outside a ritard. */
  private get baseTempo() {
    return this.tempo ?? Tone.getTransport().bpm.value;
  }

  /**
   * Set the Transport's tempo for where it is in the schedule: the user's tempo, or, in a song that
   * ends, the ritard into the final hit (`ritardFor`): a linear ramp in time that lands the final
   * downbeat on its tick, then holds the slowed tempo through the final bar. From inside the ritard
   * (a new schedule or tempo mid-way) it carries on from the tempo it has reached (`ritardAt`).
   * Beats, the playhead and the end-of-song event are all in ticks, so they follow the ramp.
   */
  private followRitard() {
    const transport = Tone.getTransport();
    if (this.ritardId !== null) transport.clear(this.ritardId);
    this.ritardId = null;
    const base = this.baseTempo;
    // Setting the value drops any ramp still scheduled.
    transport.bpm.value = base;
    const r = this.schedule ? ritardFor(this.schedule, base) : null;
    if (!r) return;
    const beat = transport.ticks / transport.PPQ;
    if (transport.state === "started" && beat > r.from) {
      const now = ritardAt(r, base, beat);
      transport.bpm.value = now.bpm;
      if (now.seconds > 0) transport.bpm.linearRampTo(now.target, now.seconds);
      return;
    }
    this.ritardId = transport.schedule((time) => {
      const start = ritardAt(r, this.baseTempo, r.from);
      transport.bpm.linearRampTo(start.target, start.seconds, time);
    }, `${Math.round(r.from * transport.PPQ)}i`);
  }

  private clearEndTimer() {
    if (this.endTimer !== null) window.clearTimeout(this.endTimer);
    this.endTimer = null;
  }

  /** Fade out whatever is sounding, over `fade` seconds: quickly but not as a click, unless the song is ending. */
  private releaseAll(fade = FADE) {
    this.piano?.releaseAll(fade);
    this.bass?.releaseAll(fade);
    this.guitar?.releaseAll(fade);
    this.melody?.releaseAll(fade);
    this.drums?.stopAll(fade);
  }

  private playNote(time: number, e: NoteEvent) {
    if (e.track === "drums" && e.drum) this.drums.play(e.drum, time, e.velocity, e.gain);
    else if (e.notes) {
      const duration = Tone.Time(ticks(e.duration)).toSeconds();
      const instrument = e.track === "piano" ? this.piano : e.track === "guitar" ? this.guitar : e.track === "melody" ? this.melody : this.bass;
      e.notes.forEach((n, i) => {
        // Guitar strum: low string first, a few milliseconds apart, on top of any chord offsets.
        const strum = e.track === "guitar" ? i * 0.008 : 0;
        const velocity = e.velocity * (e.levels?.[i] ?? 1) * (e.track === "guitar" ? 1 - i * 0.04 : 1);
        instrument.triggerAttackRelease(n, duration, time + (e.offsets?.[i] ?? 0) + strum, velocity);
      });
    }
  }

  /** Start from the top of the schedule. */
  play() {
    const transport = Tone.getTransport();
    // A restart while playing: end the old run's ringing notes and its pending end-of-song stop.
    this.clearEndTimer();
    this.releaseAll();
    transport.stop();
    transport.position = 0;
    // Back on the user's tempo, with the ritard waiting at its place again.
    this.followRitard();
    transport.start("+0.05");
  }

  get playing() {
    return Tone.getTransport().state === "started";
  }

  stop(finished = false) {
    const transport = Tone.getTransport();
    this.clearEndTimer();
    transport.stop();
    transport.position = 0;
    // A stop in or after the ritard leaves the Transport on the user's tempo.
    transport.bpm.value = this.baseTempo;
    Tone.getDraw().cancel(0);
    this.releaseAll();
    this.onPosition(null);
    this.onEnd(finished);
  }

  /** The user's tempo. In the ritard the band slows from the new tempo, from where it has got to. */
  setTempo(bpm: number) {
    this.tempo = bpm;
    if (this.schedule && !this.schedule.loop) this.followRitard();
    else Tone.getTransport().bpm.value = bpm;
  }

  setVolume(track: Mixable, level: number) {
    this.levels[track] = level;
    if (!this.channels) return;
    const style = track === "metronome" ? 0 : (this.styleMix[track] ?? 0);
    this.channels[track].volume.value = level <= 0 ? -Infinity : CHANNELS[track].volume + style + Tone.gainToDb(level);
  }

  /** Silence everything without stopping (the band keeps its place). */
  setMasterMute(mute: boolean) {
    this.muted = mute;
    if (this.master) this.master.gain.value = mute ? 0 : this.masterLevel;
  }

  /** The master volume, 0 to 1 (a gain after the compressor); Mute keeps it for when it's turned off. */
  setMasterLevel(level: number) {
    this.masterLevel = Math.min(1, Math.max(0, level));
    // A short ramp, so dragging the slider doesn't crackle.
    if (this.master && !this.muted) this.master.gain.rampTo(this.masterLevel, 0.03);
  }

  setMute(track: Mixable, mute: boolean) {
    if (this.channels) this.channels[track].mute = mute;
  }
}
