import { isMinorKey, keyPitchClass, spellingPc } from "../chart/chords";
import type { Chart } from "../chart/types";
import type { NoteEvent, Style, Track, Variation } from "../styles/types";
import { fitUnderMelody, melodyEvents, melodySwing, type MelodyMode, type MelodyNote } from "./melody";
import { applyTrading, markTrading, type TradeMode } from "./trading";
import { buildTimeline, keyCycle, loopedChoruses, playOrder, rangeOrder, sameRef, sectionOrder, tonicItem, type BarRange, type BarRef, type PlayItem, type TimelineBar } from "./timeline";

export type Repeat = number | "loop";

/** Which beats the metronome clicks: every beat, the backbeats (2 and 4, or 2 and 3 in 3/4; in 5/4 the 3+2 groups, 1 and 4), or only beat 1. */
export type ClickMode = "every" | "two-four" | "one";
export const CLICK_MODES: ClickMode[] = ["every", "two-four", "one"];

/** Whether the metronome clicks on a beat of the bar (from 0). The count-in always clicks every beat. */
export const clicksOn = (mode: ClickMode, beat: number, beatsPerBar = 4) =>
  mode === "every" ? true : mode === "two-four" ? (beatsPerBar === 3 ? beat >= 1 : beatsPerBar === 5 ? beat === 0 || beat === 3 : beat % 2 === 1) : beat === 0;

/** The click setting's name in the menu: the backbeats are 2 and 4 in 4/4, 2 and 3 in 3/4, 1 and 4 in 5/4. */
export const clickLabel = (mode: ClickMode, beatsPerBar = 4) =>
  mode === "every" ? "Every beat" : mode === "one" ? "Beat 1 only" : beatsPerBar === 3 ? "2 and 3" : beatsPerBar === 5 ? "1 and 4" : "2 and 4";

/** Whether a count-in click sounds. With two bars the first is a bar of half notes in 4/4 ("1 . 2 . | 1 2 3 4"); in 3/4 it is one pulse ("1 . . | 1 2 3", a dotted half), which is how a drummer counts a waltz in; in 5/4 it clicks the groups, 1 and 4. */
const countInClick = (beatsPerBar: number, bar: number, bars: number, beat: number) =>
  !(bar === 0 && bars > 1 && (beatsPerBar === 3 ? beat > 0 : beatsPerBar === 5 ? beat !== 0 && beat !== 3 : beat % 2 === 1));

export interface PlaybackOptions {
  /** Times through the form, or "loop" to repeat it until stopped. */
  choruses: Repeat;
  /** Count in two bars when true; `countInBars` says how many exactly. */
  countIn: boolean;
  /** Bars of count-in: 0, 1 or 2. Overrides `countIn` when set. */
  countInBars?: 0 | 1 | 2;
  transpose: number;
  /** Half steps the key moves up each chorus (see `KEY_STEPS`); each pass of a loop and each chorus until stopped moves it too. */
  keyStep?: number;
  /** Start from this bar instead of the top. */
  start?: { ref: BarRef; chorus: number } | null;
  /** Repeat only this form section until stopped. */
  loopSection?: number | null;
  /** Repeat only these bars, from the first to the last inclusive, until stopped (a loop section wins when both are set). */
  loopRange?: BarRange | null;
  /** Tempo the band's feel is built for; the chart's tempo when left out. */
  tempo?: number;
  /** Play the chart's intro (default true). */
  intro?: boolean;
  /** Play the chart's ending after the last chorus (default true). */
  ending?: boolean;
  /** Play the intro, first chorus and out-head in two; the chart's `twoFeel` when left out. */
  twoFeel?: boolean;
  /** Trade fours or eights with the drums in the solo choruses (off when left out). */
  trade?: TradeMode;
  /**
   * Live: with choruses until stopped, the chorus (as numbered in the schedule's bars) after
   * which the band plays the ending and stops. The bars before it stay where they were, so the
   * player can swap this schedule in mid-chorus without a jump.
   */
  liveEnd?: number;
  /** "straight" keeps the same groove every bar; "varied" (the default) lets the band develop. */
  variation?: Variation;
  /** Play the head's melody along with the band: the mode and the printed measures' notes (see `parseMelody`). */
  melody?: { mode: MelodyMode; measures: MelodyNote[][] };
}

/** One beat on the clock, for the metronome and the playhead. */
export interface BeatMark {
  time: number;
  bar: number;
  beat: number;
  countIn: boolean;
  /** The count-in clicks half notes in its first bar ("1, 2, 1 2 3 4"; "1, 1 2 3" in 3/4). */
  click: boolean;
}

export interface Schedule {
  bars: TimelineBar[];
  events: NoteEvent[];
  beats: BeatMark[];
  totalBeats: number;
  beatsPerBar: number;
  /** Beats the Transport repeats between, when looping. */
  loop: { start: number; end: number } | null;
  /** Beats where a pass of the loop ends and the next begins (empty when not looping). */
  passes: number[];
  /**
   * Passes (repeating copies) in one wrap of the loop, each generated on its own: a whole number of key
   * cycles and at least `MIN_REPEATS`, so the band doesn't repeat itself note for note (`loopRepeats`).
   * A wrap goes back this many choruses.
   */
  cycle: number;
  /** The style's level changes per track, in dB. */
  mix: Partial<Record<Track, number>>;
  /** The parts that play (the chart's band, or the style's). */
  band: Track[];
}

/** The fewest distinct copies a loop repeats, so a looped chorus or section isn't heard again note for note every pass. */
export const MIN_REPEATS = 4;

/**
 * How many copies a loop lays out to repeat: at least `MIN_REPEATS`, and a whole number of key
 * cycles when the key moves each pass, so the wrap comes back to the key it left (1 to 4, 6 to 6, 12 to 12).
 */
export const loopRepeats = (keyStep: number) => {
  const cycle = keyCycle(keyStep);
  return cycle * Math.ceil(MIN_REPEATS / cycle);
};

/**
 * Everything the player needs, in beats. Looping plays a first copy of the loop unit (where playback
 * can start) and then `loopRepeats` copies the Transport repeats, each generated as its own pass.
 * Choruses until stopped from the top play the head and one solo chorus that builds before the repeats.
 */
export function buildSchedule(chart: Chart, style: Style, opts: PlaybackOptions): Schedule {
  // Chords are spelled in the major key, or the relative major of a minor key.
  const keyPc = spellingPc((keyPitchClass(chart.key) + opts.transpose + 120) % 12, isMinorKey(chart.key));
  const beatsPerBar = chart.beatsPerBar;

  // Loops lay the repeating unit out once more than the repeats need: the first copy is where playback can start,
  // the rest repeat, each its own pass (with the key moving, a whole number of key cycles, so every pass has its key).
  // From the top, choruses until stopped also keep the first solo chorus out of the repeats: it builds from the head.
  const cycle = loopRepeats(opts.keyStep ?? 0);
  const layout = (first: number): { items: PlayItem[]; loopFrom: number } => {
    if (opts.loopSection != null) {
      const items = sectionOrder(chart, opts.loopSection, cycle + 1, first);
      return { items, loopFrom: items.length / (cycle + 1) };
    }
    if (opts.loopRange) {
      const items = rangeOrder(chart, opts.loopRange, cycle + 1, first);
      return { items, loopFrom: items.length / (cycle + 1) };
    }
    if (opts.choruses === "loop") {
      const lead = first === 1 ? 2 : 1;
      const items = loopedChoruses(chart, first, lead + cycle, opts.intro !== false);
      return { items, loopFrom: items.findIndex((i) => i.chorus === first + lead) };
    }
    return { items: playOrder(chart, opts.choruses, opts.intro !== false, opts.ending !== false, true), loopFrom: -1 };
  };
  const looped = opts.loopSection != null || !!opts.loopRange || opts.choruses === "loop";
  const locate = (items: PlayItem[]) => {
    const found = items.findIndex((i) => sameRef(i.ref, opts.start!.ref) && i.chorus === opts.start!.chorus);
    return Math.max(0, found >= 0 ? found : items.findIndex((i) => sameRef(i.ref, opts.start!.ref)));
  };

  // Chorus numbers in a loop are the real ones, counted from where playback starts.
  let { items, loopFrom } = layout(opts.start && opts.start.ref.part === "form" ? Math.max(1, opts.start.chorus) : 1);
  let startAt = opts.start ? locate(items) : 0;
  if (looped && opts.start && loopFrom >= 0 && startAt >= loopFrom) {
    // A bar that only the repeating copies hold: number the choruses from its chorus so it falls in the first copy.
    ({ items, loopFrom } = layout(items[startAt].chorus));
    startAt = locate(items);
  }
  // Live: end after the chosen chorus, then the ending (or the held tonic without one), instead of looping.
  // The bars that were repeating copies stay marked, so the band plays them as it did in the loop.
  const repeatFrom = loopFrom;
  if (opts.choruses === "loop" && opts.liveEnd != null && opts.loopSection == null && !opts.loopRange) {
    const last = items.map((i) => i.chorus).lastIndexOf(opts.liveEnd);
    if (last >= 0) {
      const ending = opts.ending !== false ? playOrder(chart, 0, false, true) : [];
      items = [...items.slice(0, last + 1), ...(ending.length ? ending : [tonicItem(items[last])])];
      loopFrom = -1;
    }
  }

  const full = buildTimeline(chart, items, opts.transpose, keyPc, opts.keyStep ?? 0);
  // A loop never ends the song: no final hit at the end of the repeating copy.
  if (loopFrom >= 0) for (const b of full) b.final = false;
  // The chorus arc (feel.ts) builds and holds through choruses until stopped, and never ramps into a copy the loop wraps back to.
  full.forEach((b, i) => {
    if (opts.choruses === "loop" && opts.loopSection == null && !opts.loopRange) b.open = true;
    if (repeatFrom >= 0 && i >= repeatFrom && !b.tonic && !(loopFrom < 0 && b.ref?.part === "ending")) b.repeats = true;
  });
  // Trading goes by the chorus each bar is in: the head choruses and the intro and ending are left alone.
  // A looped section or range has no head to tell apart, so all its passes are solos.
  const lastChorus = Math.max(1, ...full.map((b) => b.chorus));
  const sectionLoop = opts.loopSection != null || !!opts.loopRange;
  markTrading(full, opts.trade ?? "off", (c) => sectionLoop || (c >= 2 && (opts.choruses === "loop" || c < lastChorus)));

  const countInBars = opts.countInBars ?? (opts.countIn ? 2 : 0);
  const countIn: TimelineBar[] = Array.from({ length: countInBars }, (_, i) => ({
    index: i,
    startBeat: i * beatsPerBar,
    ref: null,
    chorus: 0,
    transpose: 0,
    label: "",
    contrast: false,
    chords: [],
    countIn: true,
    final: false,
  }));
  for (const bar of countIn) bar.transpose = full[startAt]?.transpose ?? opts.transpose;
  const music = full.slice(startAt).map((b, i) => ({ ...b, index: i + countInBars, startBeat: (i + countInBars) * beatsPerBar }));
  const bars = [...countIn, ...music];

  const beats: BeatMark[] = bars.flatMap((bar) =>
    Array.from({ length: beatsPerBar }, (_, beat) => ({
      time: bar.startBeat + beat,
      bar: bar.index,
      beat,
      countIn: bar.countIn,
      click: !bar.countIn || countInClick(beatsPerBar, bar.index, countInBars, beat),
    })),
  );
  const totalBeats = bars.length * beatsPerBar;
  const loop = loopFrom >= 0 ? { start: (loopFrom - startAt + countInBars) * beatsPerBar, end: totalBeats } : null;
  // Where one pass of a loop ends and the next begins: every repeating copy's first beat (the Transport reaches the first one on its way in and on every wrap).
  const passes: number[] = [];
  if (loop) {
    const unit = (totalBeats - loop.start) / cycle;
    for (let i = 0; i < cycle; i++) passes.push(loop.start + i * unit);
  }

  const band = bandFor(chart, style);
  const pedal = chart.pedal ? keyPitchClass(chart.pedal) : undefined;
  const tempo = opts.tempo ?? chart.tempo;
  const played = style.generate(bars, 7, { tempo, twoFeel: opts.twoFeel ?? chart.twoFeel ?? false, comp: chart.comp, pedal, variation: opts.variation ?? "varied" }).filter((e) => band.includes(e.track));
  let events = applyTrading(played, bars, beatsPerBar, opts.trade ?? "off", 7, band.includes("drums"));
  const melody = opts.melody && opts.melody.mode !== "off" ? opts.melody : null;
  if (melody) {
    // The head choruses are the first and, when the song ends, the last (as `playOrder` has it); a looped
    // section or range has no head, so only "every chorus" plays there. The intro and ending count as head.
    // The held tonic that ends a song without an ending has no melody of its own.
    const isHead = (b: TimelineBar) => !b.tonic && (b.ref?.part !== "form" || b.chorus === 1 || (opts.choruses !== "loop" && b.chorus === lastChorus));
    const tune = melodyEvents(chart, bars, melody.measures, (b) => !b.tonic && (melody.mode === "every" || (!sectionLoop && isHead(b))), { swing: melodySwing(style.id, tempo), bpm: tempo });
    // The comping steps under the melody wherever both sound.
    events = [...fitUnderMelody(events, tune), ...tune].sort((a, b) => a.time - b.time);
  }
  events = holdFinalChord(events, bars, totalBeats, tempo);
  return { bars, events, beats, totalBeats, beatsPerBar, loop, passes, cycle, mix: mixFor(chart, style), band: melody ? [...band, "melody"] : band };
}

/**
 * Seconds the song's last chord rings after its downbeat before the band fades, at least: longer than the
 * crash (3.5 s) and the piano's held chord. The player waits this long (`ringSeconds`) before its end-of-song fade.
 */
export const RING_SECONDS = 4.5;

/** Beats from the last bar's downbeat until the end-of-song fade, at a tempo: `RING_SECONDS`, or the bar and a beat more when that is longer. */
export const ringBeats = (lastBarBeats: number, bpm: number) => Math.max((RING_SECONDS * bpm) / 60, lastBarBeats + 1);

/** The same wait in seconds, for the player's end-of-song timer. */
export const ringSeconds = (lastBarBeats: number, bpm: number) => (ringBeats(lastBarBeats, bpm) * 60) / bpm;

/** A slowing into the song's final hit: the tempo falls from `from` to `to` (beats) to `factor` times the tempo, and stays there. */
export interface Ritard {
  from: number;
  to: number;
  factor: number;
}

/**
 * How much the band slows into the final hit at a tempo, as a fraction: 10% up to 90 BPM (a ballad
 * broadens into its last chord), rising smoothly to 14% from 200 (a burner sits back further). Never less at a faster tempo.
 */
export const ritardDepth = (bpm: number) => (bpm <= 90 ? 0.1 : Math.min(0.14, 0.1 + (0.04 * (bpm - 90)) / 110));

/**
 * The ritard into a song's final bar: over the bar before it (two bars from 160 BPM), never into the
 * count-in. Null for loops, a schedule without a final bar (choruses until stopped, Live before it ends),
 * and a start on the final bar.
 */
export function ritardFor(schedule: Pick<Schedule, "bars" | "loop" | "beatsPerBar">, bpm: number): Ritard | null {
  const last = schedule.bars.at(-1);
  const depth = ritardDepth(bpm);
  if (schedule.loop || !last?.final || depth <= 0) return null;
  const music = schedule.bars.find((b) => !b.countIn)?.startBeat ?? last.startBeat;
  const from = Math.max(music, last.startBeat - (bpm >= 160 ? 2 : 1) * schedule.beatsPerBar);
  return from < last.startBeat ? { from, to: last.startBeat, factor: 1 - depth } : null;
}

/**
 * The tempo at a beat of a ritard (the base tempo before it, the slowed one after), and the seconds the
 * rest of it takes. The player ramps the tempo linearly in time, so the beats covered grow with the
 * square of the tempo: v² = v0² + (v1² - v0²) · (beats in / ritard length). The rest takes its beats over the mean tempo.
 */
export function ritardAt(r: Ritard, bpm: number, beat: number): { bpm: number; seconds: number; target: number } {
  const target = bpm * r.factor;
  if (beat <= r.from) return { bpm, seconds: ((r.to - r.from) * 120) / (bpm + target), target };
  if (beat >= r.to) return { bpm: target, seconds: 0, target };
  const p = (beat - r.from) / (r.to - r.from);
  const now = Math.sqrt(bpm * bpm + (target * target - bpm * bpm) * p);
  return { bpm: now, seconds: ((r.to - beat) * 120) / (now + target), target };
}

/** The parts whose last chord is held under the final ring (the drums ring by themselves). */
const HELD: Track[] = ["piano", "guitar", "bass"];

/**
 * The styles write the final chord's length in beats, which at a fast tempo (or for a short final bass
 * note, as bossa and 5/4 play) is over long before the crash and the player's ring. Each piano, guitar
 * and bass note that is sounding at the final bar's last chord change and is the last note on its track
 * (no later one starts) is held until the end-of-song fade (`ringBeats` at the tempo the notes are built
 * for). Earlier chords of a final bar that changes chord keep their length. The sampler fades a note that
 * outlasts its sample. A rebuild on a tempo change works this out again.
 */
export function holdFinalChord(events: NoteEvent[], bars: TimelineBar[], totalBeats: number, bpm: number): NoteEvent[] {
  const last = bars.at(-1);
  if (!last?.final) return events;
  const until = last.startBeat + ringBeats(totalBeats - last.startBeat, bpm);
  const change = last.startBeat + (last.chords.filter((c) => c.attack).at(-1)?.beat ?? 0);
  // The latest start on each held track: a note is that track's last when nothing starts after it
  // (a rolled chord's notes are one event; a little room covers notes of one chord placed apart).
  const latest = new Map<string, number>();
  for (const e of events) if (HELD.includes(e.track) && e.time > (latest.get(e.track) ?? -Infinity)) latest.set(e.track, e.time);
  const SAME = 0.12;
  return events.map((e) =>
    HELD.includes(e.track) &&
    e.time >= latest.get(e.track)! - SAME &&
    e.time <= change + 0.25 &&
    e.time + e.duration > change - 0.05 &&
    e.time + e.duration < until
      ? { ...e, duration: until - e.time }
      : e,
  );
}

/**
 * Beats from the first count-in click until the band stops: the count-in, the intro,
 * every chorus, the ending (or the held tonic bar without one), and two beats for the last chord. For the readout's duration.
 */
export function performanceBeats(chart: Chart, opts: { choruses: number; countInBars: number; intro?: boolean; ending?: boolean }): number {
  const bars = playOrder(chart, opts.choruses, opts.intro !== false, opts.ending !== false, true).length;
  return (opts.countInBars + bars) * chart.beatsPerBar + 2;
}

/**
 * How many choruses to build when the count changes during playback: the band
 * finishes the chorus it's in rather than stopping mid-chorus.
 */
export const chorusesFor = (requested: number, currentChorus: number) => Math.max(requested, currentChorus, 1);

/**
 * Whether changing the number of choruses from `from` to `to` while chorus `at` plays would
 * change which bars that chorus holds (a head chorus has other sections than a solo one),
 * so the band can't keep its place and has to restart at the current bar.
 */
export function chorusLayoutChanges(chart: Chart, from: number, to: number, at: number): boolean {
  const layout = (n: number) =>
    playOrder(chart, n, false, false, true)
      .filter((i) => i.chorus === at && !i.tonic)
      .map((i) => `${i.ref.section}.${i.ref.bar}`)
      .join();
  return at > 0 && layout(from) !== layout(to);
}

/** The style's mix with the chart's own level changes (`Chart.mix`), which apply in the chart's own style only. */
export function mixFor(chart: Chart, style: Style): Partial<Record<Track, number>> {
  const mix = { ...(style.mix ?? {}) };
  if (style.id === chart.style) for (const [track, db] of Object.entries(chart.mix ?? {}) as [Track, number][]) mix[track] = (mix[track] ?? 0) + db;
  return mix;
}

/** The parts that play a chart in a style. */
export function bandFor(chart: Chart, style: Style): Track[] {
  return chart.band ?? style.band;
}
