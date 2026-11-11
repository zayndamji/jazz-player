import { keyPitchClass } from "../chart/chords";
import type { Chart } from "../chart/types";
import type { NoteEvent, Style } from "../styles/types";
import { buildTimeline, type TimelineBar } from "./timeline";

export interface PlaybackOptions {
  choruses: number;
  countIn: boolean;
  transpose: number;
}

/** One beat on the clock, for the metronome and the playhead. */
export interface BeatMark {
  time: number;
  bar: number;
  beat: number;
  countIn: boolean;
}

export interface Schedule {
  bars: TimelineBar[];
  events: NoteEvent[];
  beats: BeatMark[];
  totalBeats: number;
  beatsPerBar: number;
}

/** Everything the player needs: bars, notes, and beat marks, all in beats. */
export function buildSchedule(chart: Chart, style: Style, opts: PlaybackOptions): Schedule {
  const keyPc = (keyPitchClass(chart.key) + opts.transpose + 120) % 12;
  const bars = buildTimeline(chart, {
    choruses: opts.choruses,
    countInBars: opts.countIn ? 1 : 0,
    transpose: opts.transpose,
    keyPc,
  });
  const beatsPerBar = chart.beatsPerBar;
  const beats: BeatMark[] = bars.flatMap((bar) =>
    Array.from({ length: beatsPerBar }, (_, beat) => ({ time: bar.startBeat + beat, bar: bar.index, beat, countIn: bar.countIn })),
  );
  return {
    bars,
    events: style.generate(bars, 7),
    beats,
    totalBeats: bars.length * beatsPerBar,
    beatsPerBar,
  };
}
