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
  /** Label of the bar's section ("A", "B", "Intro", "Tag"), empty for count-in. */
  label: string;
  /** True for form sections whose label differs from the first one (the bridge in AABA). */
  contrast: boolean;
  chords: TimelineChord[];
  countIn: boolean;
  /** The last bar of the song: the style plays a final hit. */
  final: boolean;
}

/** What to play, before chords are filled in. */
export interface PlayItem {
  ref: BarRef;
  chorus: number;
}

export interface ChartBar {
  ref: BarRef;
  text: string;
  /** Bar number on the chart, from 1. */
  number: number;
  /** Bar number on the lead sheet, from 1 (differs for a tag that repeats earlier bars). */
  sheetNumber: number;
}

/** Every bar of the chart once, in order, numbered from 1. */
export function chartBars(chart: Chart): ChartBar[] {
  const out: ChartBar[] = [];
  const add = (part: BarRef["part"], section: number, s: Section) =>
    s.bars.forEach((text, bar) =>
      out.push({ ref: { part, section, bar }, text, number: out.length + 1, sheetNumber: s.sheetBar ? s.sheetBar + bar : out.length + 1 }),
    );
  if (chart.intro) add("intro", 0, chart.intro);
  chart.form.forEach((s, i) => add("form", i, s));
  chart.ending?.forEach((s, i) => add("ending", i, s));
  return out;
}

export const sameRef = (a: BarRef | null | undefined, b: BarRef | null | undefined) =>
  !!a && !!b && a.part === b.part && a.section === b.section && a.bar === b.bar;

function sectionOf(chart: Chart, ref: BarRef): Section | undefined {
  return ref.part === "intro" ? chart.intro : ref.part === "ending" ? chart.ending?.[ref.section] : chart.form[ref.section];
}

function barText(chart: Chart, ref: BarRef): string {
  return sectionOf(chart, ref)?.bars[ref.bar] ?? "%";
}

/** The order bars are played in: intro, the form a number of times, ending. */
export function playOrder(chart: Chart, choruses: number, withIntro = true, withEnding = true): PlayItem[] {
  const items: PlayItem[] = [];
  const bars = chartBars(chart);
  if (withIntro) bars.filter((b) => b.ref.part === "intro").forEach((b) => items.push({ ref: b.ref, chorus: 0 }));
  for (let c = 1; c <= choruses; c++) bars.filter((b) => b.ref.part === "form").forEach((b) => items.push({ ref: b.ref, chorus: c }));
  if (withEnding) {
    chart.ending?.forEach((section, i) => {
      for (let r = 0; r < (section.repeat ?? 1); r++) section.bars.forEach((_, bar) => items.push({ ref: { part: "ending", section: i, bar }, chorus: 0 }));
    });
  }
  return items;
}

/** The bars of one form section, a number of times. */
export function sectionOrder(chart: Chart, section: number, times: number): PlayItem[] {
  const items: PlayItem[] = [];
  for (let c = 1; c <= times; c++) chart.form[section].bars.forEach((_, bar) => items.push({ ref: { part: "form", section, bar }, chorus: c }));
  return items;
}

/** Fill in chords (transposed) for a play order. Bar indexes and beats start at 0. */
export function buildTimeline(chart: Chart, items: PlayItem[], transpose: number, keyPc: number): TimelineBar[] {
  const beats = chart.beatsPerBar;
  let previous: ParsedChord | null = null;
  const bars = items.map((item, index): TimelineBar => {
    const parsed = parseBar(barText(chart, item.ref), beats);
    const chords: TimelineChord[] = [];
    if (parsed.repeat) {
      if (previous) chords.push({ beat: 0, length: beats, chord: previous, attack: false });
    } else {
      parsed.chords.forEach((slot, i) => {
        const next = parsed.chords[i + 1];
        const chord = parseChord(transposeSymbol(slot.symbol, transpose, keyPc));
        chords.push({ beat: slot.beat, length: (next ? next.beat : beats) - slot.beat, chord, attack: true });
        previous = chord;
      });
    }
    const section = sectionOf(chart, item.ref);
    const label = section?.label ?? "";
    const contrast = item.ref.part === "form" && label !== chart.form[0].label;
    return { index, startBeat: index * beats, ref: item.ref, chorus: item.chorus, label, contrast, chords, countIn: false, final: false };
  });
  const last = bars.at(-1);
  if (last && last.ref?.part === "ending") last.final = true;
  return bars;
}

/** The chord sounding at a beat inside a bar. */
export function chordAt(bar: TimelineBar, beat: number): TimelineChord | undefined {
  let found: TimelineChord | undefined;
  for (const c of bar.chords) if (c.beat <= beat + 1e-6) found = c;
  return found;
}
