import { BEAT, barTokens, parseChord } from "../chart/chords";
import { TEMPO, type Chart, type Section } from "../chart/types";

/** A chart made from a file, with notes about what was left out. */
export interface ImportResult {
  chart: Chart;
  warnings: string[];
}

/** One written bar before repeats are played out. */
export interface Measure {
  /** The bar as a chart string ("Dm7 G7", "%"). */
  bar: string;
  /** Rehearsal mark or section name starting at this bar. */
  mark?: string;
  /** A repeat starts before this bar. */
  forward?: boolean;
  /** A repeat ends after this bar; the number is how many times the passage plays (default 2). */
  backward?: number;
  /** Numbered endings this bar belongs to (first ending is [1]). */
  endings?: number[];
}

/** A bar in playing order. */
export interface Played {
  bar: string;
  mark?: string;
  /** First bar of a replayed passage. */
  passStart: boolean;
}

/** Style for a time signature when the file doesn't say. */
export const defaultStyle = (beatsPerBar: number) => (beatsPerBar === 3 ? "waltz" : beatsPerBar === 5 ? "five" : "swing");

export const clampTempo = (bpm: number) => Math.min(TEMPO.max, Math.max(TEMPO.min, Math.round(bpm)));

/** A tune id from a title: lowercase letters, digits and dashes. */
export function slug(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return s || "tune";
}

/**
 * A bar string from chords placed on beats: the coarsest even split that holds them
 * ("Dm7 G7" rather than "Dm7 / G7 /"). A chord that starts later leaves a "/" before it.
 * No chords at all gives "%".
 */
export function barString(beats: (string | undefined)[], beatsPerBar: number): string {
  const placed = beats.map((chord, beat) => [chord, beat] as const).filter(([chord]) => chord);
  if (placed.length === 0) return "%";
  for (let n = 1; n <= beatsPerBar; n++) {
    if (beatsPerBar % n !== 0) continue;
    const step = beatsPerBar / n;
    if (!placed.every(([, beat]) => beat % step === 0)) continue;
    const tokens: string[] = [];
    for (let k = 0; k < n; k++) tokens.push(beats[k * step] ?? BEAT);
    return tokens.join(" ");
  }
  return beats.map((c) => c ?? BEAT).join(" ");
}

/** Play out repeats and numbered endings into one run of bars. */
export function expand(measures: Measure[]): Played[] {
  const out: Played[] = [];
  let i = 0;
  let repeatStart = 0;
  let pass = 1;
  let newPass = false;
  let steps = 0;
  while (i < measures.length) {
    if (++steps > measures.length * 16 + 64) throw new Error("The repeats in this chart never end.");
    const m = measures[i];
    if (m.forward && pass === 1) repeatStart = i;
    if (m.endings && !m.endings.includes(pass)) {
      // Not this pass's ending: skip to one that is.
      while (i < measures.length && measures[i].endings && !measures[i].endings!.includes(pass)) i++;
      continue;
    }
    out.push({ bar: m.bar, mark: newPass ? undefined : m.mark, passStart: newPass });
    newPass = false;
    const next = measures[i + 1];
    if (m.backward !== undefined && pass < m.backward) {
      pass++;
      i = repeatStart;
      newPass = true;
      continue;
    }
    if (m.backward !== undefined || (m.endings && !next?.endings)) {
      pass = 1;
      repeatStart = i + 1;
    }
    i++;
  }
  return out;
}

/** True when the chord parser reads "C" plus this quality. */
export function chordWorks(quality: string): boolean {
  try {
    parseChord("C" + quality);
    return true;
  } catch {
    return false;
  }
}

const INTRO = /^(intro|verse)$/i;

/** Group played bars into sections: a new one at each rehearsal mark and each replayed passage. */
export function buildSections(played: Played[]): Section[] {
  const marked = played.some((p) => p.mark);
  const sections: Section[] = [];
  let label = "A";
  let current: Section | null = null;
  for (const p of played) {
    const split = current === null || p.mark !== undefined || p.passStart || (!marked && current.bars.length >= 8 && played.length > 16);
    if (p.mark !== undefined) label = p.mark;
    if (split) {
      current = { label, bars: [] };
      sections.push(current);
    }
    current!.bars.push(p.bar);
  }
  return sections;
}

/** Drop bars before the first chord (a pickup, a count), and let a first chord that starts late start the bar. */
export function trimLead(sections: Section[]): Section[] {
  const out = sections.map((s) => ({ ...s, bars: [...s.bars] }));
  while (out.length) {
    while (out[0].bars.length && out[0].bars[0] === "%") out[0].bars.shift();
    if (out[0].bars.length) break;
    out.shift();
  }
  if (out.length) {
    const tokens = barTokens(out[0].bars[0]);
    const first = tokens.find((t) => t !== BEAT);
    if (first) out[0].bars[0] = tokens.map((t) => (t === BEAT ? first : t)).join(" ");
  }
  return out;
}

/** Leading Intro or Verse sections become the chart's intro; the rest is the form. */
export function chartParts(sections: Section[]): Pick<Chart, "intro" | "form"> {
  let n = 0;
  while (n < sections.length - 1 && INTRO.test(sections[n].label)) n++;
  const lead = sections.slice(0, n);
  const form = sections.slice(n);
  return lead.length ? { intro: { label: lead[0].label, bars: lead.flatMap((s) => s.bars) }, form } : { form };
}
