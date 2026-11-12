import { isMinorKey, keyPitchClass, spellingPc } from "../chart/chords";
import type { Chart } from "../chart/types";
import type { NoteEvent, Style, Track } from "../styles/types";
import { buildTimeline, playOrder, rangeOrder, sameRef, sectionOrder, type BarRange, type BarRef, type PlayItem, type TimelineBar } from "./timeline";

export type Repeat = number | "loop";

/** Which beats the metronome clicks: every beat, 2 and 4, or only beat 1. */
export type ClickMode = "every" | "two-four" | "one";
export const CLICK_MODES: ClickMode[] = ["every", "two-four", "one"];

/** Whether the metronome clicks on a beat of the bar (from 0). The count-in always clicks every beat. */
export const clicksOn = (mode: ClickMode, beat: number) => (mode === "every" ? true : mode === "two-four" ? beat % 2 === 1 : beat === 0);

export interface PlaybackOptions {
  /** Times through the form, or "loop" to repeat it until stopped. */
  choruses: Repeat;
  /** Count in two bars when true; `countInBars` says how many exactly. */
  countIn: boolean;
  /** Bars of count-in: 0, 1 or 2. Overrides `countIn` when set. */
  countInBars?: 0 | 1 | 2;
  transpose: number;
  /** Half steps the key moves up each chorus (see `KEY_STEPS`); loops and choruses until stopped stay in one key. */
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
}

/** One beat on the clock, for the metronome and the playhead. */
export interface BeatMark {
  time: number;
  bar: number;
  beat: number;
  countIn: boolean;
  /** The count-in clicks half notes in its first bar ("1, 2, 1 2 3 4"). */
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

  let items: PlayItem[];
  let loopFrom = -1; // index in items where the repeating copy starts
  if (opts.loopSection != null) {
    items = sectionOrder(chart, opts.loopSection, 2);
    loopFrom = items.length / 2;
  } else if (opts.loopRange) {
    items = rangeOrder(chart, opts.loopRange, 2);
    loopFrom = items.length / 2;
  } else if (opts.choruses === "loop") {
    items = playOrder(chart, 2, opts.intro !== false, false);
    loopFrom = items.findIndex((i) => i.chorus === 2);
  } else {
    items = playOrder(chart, opts.choruses, opts.intro !== false, opts.ending !== false, true);
  }

  const oneKey = opts.loopSection != null || !!opts.loopRange || opts.choruses === "loop";
  const full = buildTimeline(chart, items, opts.transpose, keyPc, oneKey ? 0 : (opts.keyStep ?? 0));
  let startAt = 0;
  if (opts.start) {
    const found = full.findIndex((b) => sameRef(b.ref, opts.start!.ref) && b.chorus === opts.start!.chorus);
    const anyChorus = full.findIndex((b) => sameRef(b.ref, opts.start!.ref));
    startAt = Math.max(0, found >= 0 ? found : anyChorus);
    if (loopFrom >= 0 && startAt >= loopFrom) startAt -= loopFrom;
  }

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
      click: !(bar.countIn && bar.index === 0 && countInBars > 1 && beat % 2 === 1),
    })),
  );
  const totalBeats = bars.length * beatsPerBar;
  const loop =
    loopFrom >= 0 ? { start: (loopFrom - startAt + countInBars) * beatsPerBar, end: totalBeats } : null;

  const band = bandFor(chart, style);
  const events = style.generate(bars, 7, { tempo: opts.tempo ?? chart.tempo, twoFeel: opts.twoFeel ?? chart.twoFeel ?? false }).filter((e) => band.includes(e.track));
  return { bars, events, beats, totalBeats, beatsPerBar, loop, mix: style.mix ?? {}, band };
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

/** The parts that play a chart in a style. */
export function bandFor(chart: Chart, style: Style): Track[] {
  return chart.band ?? style.band;
}
