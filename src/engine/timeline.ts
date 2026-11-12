import { isMinorKey, keyPitchClass, parseBar, parseChord, spellingPc, transposeSymbol, type ParsedChord } from "../chart/chords";
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

/** Fold semitones into -6..+5 so transposed charts stay near the written register. */
export const fold = (n: number) => ((((n + 6) % 12) + 12) % 12) - 6;

/** Half steps the key moves up each chorus when cycling: none, a fourth, a half step up or down, a whole step. */
export const KEY_STEPS = [0, 5, 1, -1, 2] as const;
export type KeyStep = (typeof KEY_STEPS)[number];

/** The transpose chorus `chorus` (from 1) plays in when each chorus moves the key by `step`, folded into -6..5. */
export const chorusTranspose = (base: number, step: number, chorus: number) => (step === 0 ? base : fold(base + (Math.max(1, chorus) - 1) * step));

export interface TimelineBar {
  /** Half steps from the original key this bar's chords are in. */
  transpose: number;
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

/** True when a form section plays in a head chorus (`head`) or a solo chorus. */
export const playsIn = (section: Section, head: boolean) => !section.play || (section.play === "head") === head;

/**
 * The order bars are played in: intro, the form a number of times, ending.
 * The first chorus is the head, and so is the last when the song ends; the
 * choruses between are solos (it matters only for sections marked `play`).
 * The intro and the ending can be left out; the last chorus is still a head chorus
 * unless `headLast` says otherwise (the choruses repeating until stopped).
 */
export function playOrder(chart: Chart, choruses: number, withIntro = true, withEnding = true, headLast = withEnding): PlayItem[] {
  const items: PlayItem[] = [];
  const bars = chartBars(chart);
  if (withIntro) bars.filter((b) => b.ref.part === "intro").forEach((b) => items.push({ ref: b.ref, chorus: 0 }));
  for (let c = 1; c <= choruses; c++) {
    const head = c === 1 || (headLast && c === choruses);
    bars.filter((b) => b.ref.part === "form" && playsIn(chart.form[b.ref.section], head)).forEach((b) => items.push({ ref: b.ref, chorus: c }));
  }
  if (withEnding) {
    chart.ending?.forEach((section, i) => {
      for (let r = 0; r < (section.repeat ?? 1); r++) section.bars.forEach((_, bar) => items.push({ ref: { part: "ending", section: i, bar }, chorus: 0 }));
    });
  }
  return items;
}

/** A run of bars to loop, from one bar to another in chart order (the two can be given either way round). */
export interface BarRange {
  from: BarRef;
  to: BarRef;
}

/** The chart's bars from one end of a range to the other, inclusive, in playing order within a chorus. */
export function rangeBars(chart: Chart, range: BarRange): ChartBar[] {
  const all = chartBars(chart);
  const a = all.findIndex((b) => sameRef(b.ref, range.from));
  const b = all.findIndex((b) => sameRef(b.ref, range.to));
  if (a < 0 || b < 0) return [];
  return all.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** The bars of a range, a number of times (the chorus counts up for form bars, like a looped section). */
export function rangeOrder(chart: Chart, range: BarRange, times: number): PlayItem[] {
  const bars = rangeBars(chart, range);
  const items: PlayItem[] = [];
  for (let c = 1; c <= times; c++) for (const b of bars) items.push({ ref: b.ref, chorus: b.ref.part === "form" ? c : 0 });
  return items;
}

/** The bars of one form section, a number of times. */
export function sectionOrder(chart: Chart, section: number, times: number): PlayItem[] {
  const items: PlayItem[] = [];
  for (let c = 1; c <= times; c++) chart.form[section].bars.forEach((_, bar) => items.push({ ref: { part: "form", section, bar }, chorus: c }));
  return items;
}

/**
 * Fill in chords (transposed) for a play order. Bar indexes and beats start at 0.
 * With a key `step` each chorus is in its own key (see `chorusTranspose`), chords spelled for it;
 * the intro is in the first chorus's key and the ending in the last one's.
 */
export function buildTimeline(chart: Chart, items: PlayItem[], transpose: number, keyPc: number, step = 0): TimelineBar[] {
  const beats = chart.beatsPerBar;
  let previous: ParsedChord | null = null;
  // Contrast is against the first section played in the same chorus (solo choruses may start elsewhere).
  const firstLabel = new Map<number, string>();
  for (const item of items) if (item.ref.part === "form" && !firstLabel.has(item.chorus)) firstLabel.set(item.chorus, chart.form[item.ref.section].label);
  const lastChorus = Math.max(1, ...items.map((i) => i.chorus));
  const chartPc = keyPitchClass(chart.key);
  const minor = isMinorKey(chart.key);
  const bars = items.map((item, index): TimelineBar => {
    const chorusOf = item.ref.part === "form" ? item.chorus : item.ref.part === "ending" ? lastChorus : 1;
    const barTranspose = chorusTranspose(transpose, step, chorusOf);
    const barKeyPc = step === 0 ? keyPc : spellingPc((chartPc + barTranspose + 120) % 12, minor);
    const parsed = parseBar(barText(chart, item.ref), beats);
    const chords: TimelineChord[] = [];
    if (parsed.repeat) {
      if (previous) chords.push({ beat: 0, length: beats, chord: previous, attack: false });
    } else {
      parsed.chords.forEach((slot, i) => {
        const next = parsed.chords[i + 1];
        const chord = parseChord(transposeSymbol(slot.symbol, barTranspose, barKeyPc));
        chords.push({ beat: slot.beat, length: (next ? next.beat : beats) - slot.beat, chord, attack: true });
        previous = chord;
      });
    }
    const section = sectionOf(chart, item.ref);
    const label = section?.label ?? "";
    const contrast = item.ref.part === "form" && label !== (firstLabel.get(item.chorus) ?? chart.form[0].label);
    return { transpose: barTranspose, index, startBeat: index * beats, ref: item.ref, chorus: item.chorus, label, contrast, chords, countIn: false, final: false };
  });
  const last = bars.at(-1);
  if (last && last.ref?.part === "ending") last.final = true;
  return bars;
}

/**
 * The next chord that differs from the one sounding at a beat, looking through the rest of
 * this bar and the next `ahead` bars (wrapping to `loopBar`, the first bar of the repeating copy, at the end).
 */
export function nextChord(bars: TimelineBar[], index: number, beat: number, ahead = 2, loopBar: number | null = null): { chord: ParsedChord; transpose: number } | null {
  const bar = bars[index];
  const now = bar && chordAt(bar, beat);
  if (!bar || !now) return null;
  const at = (i: number) => (i < bars.length ? bars[i] : loopBar !== null && bars.length > loopBar ? bars[loopBar + ((i - bars.length) % (bars.length - loopBar))] : undefined);
  for (let i = index; i <= index + ahead; i++) {
    const b = at(i);
    if (!b || b.countIn) return null;
    for (const c of b.chords) {
      if (i === index && c.beat <= now.beat + 1e-6) continue;
      if (c.attack && c.chord.symbol !== now.chord.symbol) return { chord: c.chord, transpose: b.transpose };
    }
  }
  return null;
}

/** The chord sounding at a beat inside a bar. */
export function chordAt(bar: TimelineBar, beat: number): TimelineChord | undefined {
  let found: TimelineChord | undefined;
  for (const c of bar.chords) if (c.beat <= beat + 1e-6) found = c;
  return found;
}

/**
 * The bars the arrow keys step through, in playing order: one form section when
 * looping it, intro and form when the choruses repeat until stopped (stepping
 * past the end goes on to the next chorus), else intro, every chorus, ending.
 */
export function navOrder(chart: Chart, choruses: number | "loop", loopSection: number | null, atChorus = 1, intro = true, ending = true): PlayItem[] {
  if (loopSection !== null) return sectionOrder(chart, loopSection, 1);
  if (choruses === "loop") return playOrder(chart, Math.max(2, atChorus + 1), intro, false);
  return playOrder(chart, choruses, intro, ending, true);
}

function indexIn(order: PlayItem[], from: PlayItem | null): number {
  if (!from) return 0;
  const exact = order.findIndex((i) => sameRef(i.ref, from.ref) && i.chorus === from.chorus);
  return exact >= 0 ? exact : Math.max(0, order.findIndex((i) => sameRef(i.ref, from.ref)));
}

/** One bar on or back from `from` (null is the top). Stops at the ends, or wraps around when `wrap`. */
export function stepBar(order: PlayItem[], from: PlayItem | null, delta: number, wrap = false): PlayItem {
  const i = indexIn(order, from) + delta;
  if (wrap) return order[((i % order.length) + order.length) % order.length];
  return order[Math.min(order.length - 1, Math.max(0, i))];
}

/**
 * The first bar of the next section, or going back, of this section (or the
 * previous one when already on its first bar), like "previous track" on a player.
 * A section is a run of bars with the same part, section and chorus.
 */
export function stepSection(order: PlayItem[], from: PlayItem | null, delta: number): PlayItem {
  const same = (a: PlayItem, b: PlayItem) => a.ref.part === b.ref.part && a.ref.section === b.ref.section && a.chorus === b.chorus;
  const i = indexIn(order, from);
  let start = i;
  while (start > 0 && same(order[start - 1], order[i])) start--;
  if (delta > 0) {
    let next = i;
    while (next < order.length && same(order[next], order[i])) next++;
    return order[Math.min(next, order.length - 1)];
  }
  if (i > start) return order[start];
  if (start === 0) return order[0];
  let prev = start - 1;
  while (prev > 0 && same(order[prev - 1], order[start - 1])) prev--;
  return order[prev];
}
