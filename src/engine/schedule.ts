import { isMinorKey, keyPitchClass, spellingPc } from "../chart/chords";
import type { Chart } from "../chart/types";
import type { NoteEvent, Style, Track } from "../styles/types";
import { applyTrading, markTrading, type TradeMode } from "./trading";
import { buildTimeline, keyCycle, loopedChoruses, playOrder, rangeOrder, sameRef, sectionOrder, type BarRange, type BarRef, type PlayItem, type TimelineBar } from "./timeline";

export type Repeat = number | "loop";

/** Which beats the metronome clicks: every beat, the backbeats (2 and 4, or 2 and 3 in 3/4), or only beat 1. */
export type ClickMode = "every" | "two-four" | "one";
export const CLICK_MODES: ClickMode[] = ["every", "two-four", "one"];

/** Whether the metronome clicks on a beat of the bar (from 0). The count-in always clicks every beat. */
export const clicksOn = (mode: ClickMode, beat: number, beatsPerBar = 4) =>
  mode === "every" ? true : mode === "two-four" ? (beatsPerBar === 3 ? beat >= 1 : beat % 2 === 1) : beat === 0;

/** The click setting's name in the menu: the backbeats are 2 and 4 in 4/4, 2 and 3 in 3/4. */
export const clickLabel = (mode: ClickMode, beatsPerBar = 4) =>
  mode === "every" ? "Every beat" : mode === "one" ? "Beat 1 only" : beatsPerBar === 3 ? "2 and 3" : "2 and 4";

/** Whether a count-in click sounds. With two bars the first is a bar of half notes in 4/4 ("1 . 2 . | 1 2 3 4"); in 3/4 it is one pulse ("1 . . | 1 2 3", a dotted half), which is how a drummer counts a waltz in. */
const countInClick = (beatsPerBar: number, bar: number, bars: number, beat: number) =>
  !(bar === 0 && bars > 1 && (beatsPerBar === 3 ? beat > 0 : beat % 2 === 1));

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
  /** Play the intro and first chorus in two; the chart's `twoFeel` when left out. */
  twoFeel?: boolean;
  /** Trade fours or eights with the drums in the solo choruses (off when left out). */
  trade?: TradeMode;
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
  /** Choruses (passes) the loop takes to come back to the same key: 1 when the key stays put. */
  cycle: number;
  /** The style's level changes per track, in dB. */
  mix: Partial<Record<Track, number>>;
  /** The parts that play (the chart's band, or the style's). */
  band: Track[];
}

/**
 * Everything the player needs, in beats. Looping plays the loop unit twice
 * and repeats the second copy, so playback can start anywhere in the first.
 */
export function buildSchedule(chart: Chart, style: Style, opts: PlaybackOptions): Schedule {
  // Chords are spelled in the major key, or the relative major of a minor key.
  const keyPc = spellingPc((keyPitchClass(chart.key) + opts.transpose + 120) % 12, isMinorKey(chart.key));
  const beatsPerBar = chart.beatsPerBar;

  // Loops lay the repeating unit out once more than a key cycle needs: the first copy is where playback can start,
  // the rest repeat. With the key moving each chorus the unit repeats for a whole key cycle, so every pass has its key.
  const cycle = keyCycle(opts.keyStep ?? 0);
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
      const items = loopedChoruses(chart, first, cycle + 1, opts.intro !== false);
      return { items, loopFrom: items.findIndex((i) => i.chorus === first + 1) };
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

  const full = buildTimeline(chart, items, opts.transpose, keyPc, opts.keyStep ?? 0);
  // A loop never ends the song: no final hit at the end of the repeating copy.
  if (loopFrom >= 0) for (const b of full) b.final = false;
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
  const played = style.generate(bars, 7, { tempo: opts.tempo ?? chart.tempo, twoFeel: opts.twoFeel ?? chart.twoFeel ?? false, comp: chart.comp }).filter((e) => band.includes(e.track));
  const events = applyTrading(played, bars, beatsPerBar, opts.trade ?? "off", 7, band.includes("drums"));
  return { bars, events, beats, totalBeats, beatsPerBar, loop, passes, cycle, mix: style.mix ?? {}, band };
}

/**
 * Beats from the first count-in click until the band stops: the count-in, the intro,
 * every chorus, the ending, and the two beats the last chord rings. For the readout's duration.
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
      .filter((i) => i.chorus === at)
      .map((i) => `${i.ref.section}.${i.ref.bar}`)
      .join();
  return at > 0 && layout(from) !== layout(to);
}

/** The parts that play a chart in a style. */
export function bandFor(chart: Chart, style: Style): Track[] {
  return chart.band ?? style.band;
}
