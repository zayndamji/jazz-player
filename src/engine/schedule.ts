import { isMinorKey, keyPitchClass, spellingPc } from "../chart/chords";
import type { Chart } from "../chart/types";
import type { NoteEvent, Style, Track } from "../styles/types";
import { buildTimeline, playOrder, sameRef, sectionOrder, type BarRef, type PlayItem, type TimelineBar } from "./timeline";

export type Repeat = number | "loop";

export interface PlaybackOptions {
  /** Times through the form, or "loop" to repeat it until stopped. */
  choruses: Repeat;
  countIn: boolean;
  transpose: number;
  /** Start from this bar instead of the top. */
  start?: { ref: BarRef; chorus: number } | null;
  /** Repeat only this form section until stopped. */
  loopSection?: number | null;
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
  } else if (opts.choruses === "loop") {
    items = playOrder(chart, 2, true, false);
    loopFrom = items.findIndex((i) => i.chorus === 2);
  } else {
    items = playOrder(chart, opts.choruses);
  }

  const full = buildTimeline(chart, items, opts.transpose, keyPc);
  let startAt = 0;
  if (opts.start) {
    const found = full.findIndex((b) => sameRef(b.ref, opts.start!.ref) && b.chorus === opts.start!.chorus);
    const anyChorus = full.findIndex((b) => sameRef(b.ref, opts.start!.ref));
    startAt = Math.max(0, found >= 0 ? found : anyChorus);
    if (loopFrom >= 0 && startAt >= loopFrom) startAt -= loopFrom;
  }

  const countInBars = opts.countIn ? 2 : 0;
  const countIn: TimelineBar[] = Array.from({ length: countInBars }, (_, i) => ({
    index: i,
    startBeat: i * beatsPerBar,
    ref: null,
    chorus: 0,
    label: "",
    contrast: false,
    chords: [],
    countIn: true,
    final: false,
  }));
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

  return { bars, events: style.generate(bars, 7), beats, totalBeats, beatsPerBar, loop, mix: style.mix ?? {} };
}
