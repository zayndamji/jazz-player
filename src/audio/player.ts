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
  /** The schedule the beat belongs to (during a jump the old one plays on until the next beat). */
  schedule: Schedule;
  /** The Transport beat where that schedule's beat 0 sits. */
  origin: number;
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

/**
 * How far ahead a jump has to land, in seconds after Tone's lookahead: the band before it has already
 * been handed to the audio clock up to the lookahead, so the jump waits for the first beat past it.
 */
const JUMP_MARGIN = 0.05;

/**
 * Seconds before a jump's beat that the old schedule stops: its notes for that beat, played a little
 * early by the band's timing, are the new bar's to play.
 */
const JUMP_EARLY = 0.03;

/**
 * Beats the notes part starts before the schedule's beat 0 (its events moved on by as much), so a
 * note the band plays a little early on the first beat still sounds after a jump or a swap in place.
 */
const LEAD = 0.25;

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
  /** True between our `play` and `stop`: stopping a stopped Transport would undo its last stop (see `play`). */
  private running = false;
  /** Each schedule's parts are a generation; a jump ends the earlier ones' notes on its beat (`cut`). */
  private generation = 0;
  private cut: { generation: number; time: number } | null = null;
  /** Parts of the schedule a jump left, playing on until the jump's beat; disposed after it. */
  private retiring: { parts: Tone.ToneEvent[]; timer: number }[] = [];
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
      if (import.meta.env.DEV) (window as unknown as { __jazzStand: unknown }).__jazzStand = { preMute: out, Tone, player: this };
      const room = new Tone.Reverb({ decay: 1.4, preDelay: 0.01, wet: 0.16 }).connect(out);
      const channels = {} as Record<Mixable, Tone.Channel>;
      for (const [name, c] of Object.entries(CHANNELS)) channels[name as Mixable] = new Tone.Channel(c).connect(room);
      this.channels = channels;

      const { piano, bass, guitar, drums } = await files;
      this.piano = new SpriteSampler({ buffer: piano, regions: sprites.piano.regions, release: 0.9, brightness: { low: 3500, high: 16000 } }).connect(channels.piano);
      // The melody is a second voice on the piano samples (the same buffer): brighter, with a shorter release so a line reads as legato.
      this.melody = new SpriteSampler({ buffer: piano, regions: sprites.piano.regions, release: 0.3, brightness: { low: 5000, high: 16000 } }).connect(channels.melody);
      this.bass = new SpriteSampler({ buffer: bass, regions: sprites.bass.regions, release: 0.25 }).connect(channels.bass);
      // A small treble lift for presence; each pluck is darker the softer it is (1.8 to 8 kHz by velocity),
      // as a nylon string played softly is, since the samples have one loudness.
      const guitarTone = new Tone.Filter({ type: "highshelf", frequency: 2500, gain: 2 }).connect(channels.guitar);
      this.guitar = new SpriteSampler({ buffer: guitar, regions: sprites.guitar.regions, release: 0.12, brightness: { low: 1800, high: 8000 } }).connect(guitarTone);
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
  /** The Transport beat where the schedule's beat 0 sits: 0 from a start, later after a jump or a swap in place. */
  origin = 0;

  /**
   * Replace what's playing. The Transport keeps its position, so this works mid-song: with the same
   * `origin` the new schedule's beats line up with the old one's (a rebuild for a new key or tempo);
   * a later origin puts its beat 0 there (a loop turned on or off at the bar that's playing).
   * Notes already handed to the audio clock (the lookahead) sound as they were.
   */
  setSchedule(schedule: Schedule, origin = this.origin) {
    this.schedule = schedule;
    this.origin = origin;
    this.styleMix = schedule.mix;
    (Object.keys(this.levels) as Mixable[]).forEach((t) => this.setVolume(t, this.levels[t]));
    const transport = Tone.getTransport();
    this.notes?.dispose();
    this.clock?.dispose();
    this.notes = null;
    this.clock = null;
    if (this.endId !== null) transport.clear(this.endId);
    this.endId = null;
    this.clearEndTimer();
    for (const id of this.passIds) transport.clear(id);
    this.passIds = [];
    this.followRitard();

    const generation = ++this.generation;
    // The notes part starts up to `LEAD` early (never before the Transport's 0), its events moved on by as much.
    const notesFrom = Math.max(0, origin - LEAD);
    this.notes = new Tone.Part<[string, NoteEvent]>(
      (time, e) => this.playNote(time, e, generation),
      schedule.events.map((e): [string, NoteEvent] => [ticks(e.time + origin - notesFrom), e]),
    );
    this.clock = new Tone.Part<[string, BeatMark]>((time, mark) => {
      if (mark.click && (mark.countIn || (this.metronomeOn && clicksOn(this.clickMode, mark.beat, schedule.beatsPerBar)))) {
        this.click.triggerAttackRelease(mark.beat === 0 ? "E6" : "A5", 0.03, time, mark.beat === 0 ? 0.9 : 0.55);
      }
      Tone.getDraw().schedule(() => {
        if (Tone.getTransport().state === "started") this.onPosition({ bar: mark.bar, beat: mark.beat, countIn: mark.countIn, schedule, origin });
      }, time);
    }, schedule.beats.map((b): [string, BeatMark] => [ticks(b.time), b]));
    this.notes.start(ticks(notesFrom));
    this.clock.start(ticks(origin));

    if (schedule.loop) {
      transport.setLoopPoints(ticks(origin + schedule.loop.start), ticks(origin + schedule.loop.end));
      transport.loop = true;
      // Each pass of the loop ends where the next copy begins. The Transport reaches the first copy's
      // start on its way in and again on every wrap. A plain timer, not Draw (see below).
      this.passIds = schedule.passes.map((beat) =>
        transport.schedule((time) => {
          window.setTimeout(() => this.onPass(), Math.max(0, (time - Tone.now()) * 1000));
        }, ticks(origin + beat)),
      );
    } else {
      transport.loop = false;
      // Let the last chord and the crash ring out (`ringSeconds`, from the last bar's downbeat, at the
      // tempo the ritard slowed to), then fade gently and stop. Plain timers, not Tone's Draw queue:
      // Draw drops callbacks when animation frames are throttled.
      const lastStart = schedule.bars.at(-1)?.startBeat ?? 0;
      const lastBeats = schedule.totalBeats - lastStart;
      const ring = () => ringSeconds(lastBeats, transport.bpm.value);
      const at = Math.round((origin + lastStart) * transport.PPQ);
      if (transport.state === "started" && transport.ticks > at) {
        // A new schedule after the last downbeat (a tempo change while it rings): finish from here.
        const past = ((transport.ticks - at) / transport.PPQ) * (60 / transport.bpm.value);
        this.endAfter(Math.max(0, ring() - past) * 1000);
      } else {
        this.endId = transport.schedule((time) => this.endAfter(Math.max(0, (time - Tone.now()) * 1000) + ring() * 1000), `${at}i`);
      }
    }
  }

  /**
   * Go to another place while playing, on the next beat: the band plays on until that beat, then
   * the new schedule starts there with its first bar's downbeat, so the pulse never stops. Notes of
   * the old schedule still sounding on that beat fade out quickly, as they do on a restart.
   */
  jumpTo(schedule: Schedule) {
    if (!this.running || !this.playing) return this.play(schedule);
    const transport = Tone.getTransport();
    const PPQ = transport.PPQ;
    // Tone.now() is already the lookahead ahead of what's heard: everything before it is scheduled.
    const soon = Tone.now() + JUMP_MARGIN;
    const tick = transport.getTicksAtTime(soon);
    const beat = Math.ceil(tick / PPQ - 1e-6);
    const time = soon + ((beat * PPQ - tick) / PPQ) * (60 / transport.bpm.getValueAtTime(soon));
    const parts: Tone.ToneEvent[] = [this.notes, this.clock].filter((x) => x !== null);
    // The clock stops on the beat (the old schedule's last beat mark is before it); the notes just before it.
    this.clock?.stop(ticks(beat));
    this.notes?.stop(`${Math.round(beat * PPQ - (JUMP_EARLY * transport.bpm.getValueAtTime(soon) * PPQ) / 60)}i`);
    this.notes = null;
    this.clock = null;
    const entry = { parts, timer: 0 };
    entry.timer = window.setTimeout(() => {
      parts.forEach((x) => x.dispose());
      this.retiring = this.retiring.filter((r) => r !== entry);
    }, (time - Tone.now() + 1) * 1000);
    this.retiring.push(entry);
    // What the old parts still play before the beat ends on it; what is sounding then fades.
    this.cut = { generation: this.generation + 1, time: time - JUMP_EARLY };
    this.releaseAll(FADE, time - JUMP_EARLY);
    this.setSchedule(schedule, beat);
  }

  private disposeRetiring() {
    for (const r of this.retiring) {
      window.clearTimeout(r.timer);
      r.parts.forEach((x) => x.dispose());
    }
    this.retiring = [];
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
    const beat = transport.ticks / transport.PPQ - this.origin;
    if (transport.state === "started" && beat > r.from) {
      const now = ritardAt(r, base, beat);
      transport.bpm.value = now.bpm;
      if (now.seconds > 0) transport.bpm.linearRampTo(now.target, now.seconds);
      return;
    }
    this.ritardId = transport.schedule((time) => {
      const start = ritardAt(r, this.baseTempo, r.from);
      transport.bpm.linearRampTo(start.target, start.seconds, time);
    }, `${Math.round((this.origin + r.from) * transport.PPQ)}i`);
  }

  private clearEndTimer() {
    if (this.endTimer !== null) window.clearTimeout(this.endTimer);
    this.endTimer = null;
  }

  /** Fade out whatever is sounding (or about to) at `at`, over `fade` seconds: quickly but not as a click, unless the song is ending. */
  private releaseAll(fade = FADE, at?: number) {
    this.piano?.releaseAll(fade, at);
    this.bass?.releaseAll(fade, at);
    this.guitar?.releaseAll(fade, at);
    this.melody?.releaseAll(fade, at);
    this.drums?.stopAll(fade, at);
  }

  private playNote(time: number, e: NoteEvent, generation: number) {
    // A schedule a jump has left plays on until the jump's beat, and nothing of it rings past it.
    const cut = this.cut && generation < this.cut.generation ? this.cut.time : null;
    if (cut !== null && time >= cut) return;
    if (e.track === "drums" && e.drum) this.drums.play(e.drum, time, e.velocity, e.gain, cut ?? undefined);
    else if (e.notes) {
      const duration = Tone.Time(ticks(e.duration)).toSeconds();
      const instrument = e.track === "piano" ? this.piano : e.track === "guitar" ? this.guitar : e.track === "melody" ? this.melody : this.bass;
      e.notes.forEach((n, i) => {
        // Guitar strum: low string first, a few milliseconds apart, on top of any chord offsets.
        const strum = e.track === "guitar" ? (e.offsets ? 0 : i * 0.008) : 0;
        const velocity = e.velocity * (e.levels?.[i] ?? 1) * (e.track === "guitar" && !e.levels ? 1 - i * 0.04 : 1);
        const at = time + (e.offsets?.[i] ?? 0) + strum;
        if (cut !== null && at >= cut) return;
        if (cut !== null && at + duration > cut) instrument.triggerAttackRelease(n, cut - at, at, velocity, FADE, e.gain);
        else instrument.triggerAttackRelease(n, duration, at, velocity, e.release, e.gain);
      });
    }
  }

  /** Start from the top of a schedule (the one set already when none is given). */
  play(schedule: Schedule | null = this.schedule) {
    const transport = Tone.getTransport();
    // A restart while playing: end the old run's ringing notes and its pending end-of-song stop.
    this.clearEndTimer();
    this.releaseAll();
    this.cut = null;
    this.disposeRetiring();
    // Only stop a running Transport: Tone's TickSource.stop on a stopped one cancels its last stop, so for
    // one tick of the clock it runs on from where it stopped and plays whatever the schedule has there.
    if (this.running) transport.stop();
    this.running = true;
    transport.position = 0;
    if (schedule) this.setSchedule(schedule, 0);
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
    if (this.running) transport.stop();
    this.running = false;
    this.cut = null;
    this.disposeRetiring();
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
