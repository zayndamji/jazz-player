import { parseBar, parseChord, transposeSymbol, type ParsedChord } from "../chart/chords";
import type { Chart, Section } from "../chart/types";

/** Where a bar sits on the chart, so the grid can light it up. */
export interface BarRef {
  part: "intro" | "form" | "ending";
  section: number;
  bar: number;
}

export interface TimelineChord {
  /** Beat in the bar where it starts. */
  beat: number;
  /** Length in beats. */
  length: number;
  chord: ParsedChord;
  /** False when the chord carries over from the previous bar ("%"). */
  attack: boolean;
}

export interface TimelineBar {
  /** Bar number from the start of playback, from 0 (count-in bars come first). */
  index: number;
  startBeat: number;
  /** null for count-in bars. */
  ref: BarRef | null;
  /** 0 for count-in, intro and ending; 1 and up for each time through the form. */
  chorus: number;
  chords: TimelineChord[];
  countIn: boolean;
  /** The last bar of the song. */
  final: boolean;
}

export interface TimelineOptions {
  choruses: number;
  countInBars: number;
  transpose: number;
  /** Pitch class of the key after transposing, for spelling. */
  keyPc: number;
}

/** Lay the chart out bar by bar in playing order. */
export function buildTimeline(chart: Chart, opts: TimelineOptions): TimelineBar[] {
  const beats = chart.beatsPerBar;
  const bars: TimelineBar[] = [];
  let previous: ParsedChord | null = null;

  const push = (ref: BarRef | null, chorus: number, text: string | null) => {
    const index = bars.length;
    const chords: TimelineChord[] = [];
    if (text !== null) {
      const parsed = parseBar(text, beats);
      if (parsed.repeat) {
        if (previous) chords.push({ beat: 0, length: beats, chord: previous, attack: false });
      } else {
        parsed.chords.forEach((slot, i) => {
          const next = parsed.chords[i + 1];
          const chord = parseChord(transposeSymbol(slot.symbol, opts.transpose, opts.keyPc));
          chords.push({ beat: slot.beat, length: (next ? next.beat : beats) - slot.beat, chord, attack: true });
          previous = chord;
        });
      }
    }
    bars.push({ index, startBeat: index * beats, ref, chorus, chords, countIn: text === null, final: false });
  };

  for (let i = 0; i < opts.countInBars; i++) push(null, 0, null);
  const addSection = (part: BarRef["part"], section: Section, sectionIndex: number, chorus: number) =>
    section.bars.forEach((text, bar) => push({ part, section: sectionIndex, bar }, chorus, text));

  if (chart.intro) addSection("intro", chart.intro, 0, 0);
  for (let chorus = 1; chorus <= opts.choruses; chorus++) {
    chart.form.forEach((section, s) => addSection("form", section, s, chorus));
  }
  if (chart.ending) addSection("ending", chart.ending, 0, 0);
  if (bars.length) bars[bars.length - 1].final = true;
  return bars;
}

/** The chord sounding at a beat inside a bar. */
export function chordAt(bar: TimelineBar, beat: number): TimelineChord | undefined {
  let found: TimelineChord | undefined;
  for (const c of bar.chords) if (c.beat <= beat + 1e-6) found = c;
  return found;
}
