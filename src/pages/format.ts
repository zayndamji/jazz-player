import { keyName as plainKeyName, minorKeyName } from "../chart/chords";
import type { Chart } from "../chart/types";
import { chartStyles } from "../engine/schedule";

const pretty = (name: string) => name.replace("b", "♭").replace("#", "♯");

/** Key name with music sharps and flats, e.g. "B♭". */
export const keyName = (pc: number) => pretty(plainKeyName(pc));

/** A key as a short name: "E♭" for major, "C♯m" for minor. */
export const keyLabel = (pc: number, minor: boolean) => (minor ? pretty(minorKeyName(pc)) + "m" : keyName(pc));

/** A key in words: "E♭ major", "E minor". */
export const keyWords = (pc: number, minor: boolean) => (minor ? `${pretty(minorKeyName(pc))} minor` : `${keyName(pc)} major`);

/**
 * A section's name as shown: a chart's "Coda" is the tune's ending, not a section the music
 * jumps to, so it reads "Ending" (a tag that repeats earlier bars keeps its own name, "Tag").
 */
export const sectionName = (label: string) => (/^coda$/i.test(label.trim()) ? "Ending" : label);

/** What a bar needs to be numbered: which part it's in, and its place in the whole chart from 1. */
interface NumberedBar {
  ref: { part: "intro" | "form" | "ending" };
  number: number;
}

/**
 * The bar number musicians count: the form from 1, the ending on from there, and none in the
 * intro (its bars are counted from 1 within the intro by `barName`).
 */
export function shownNumber(bar: NumberedBar, introBars: number): number | null {
  return bar.ref.part === "intro" ? null : bar.number - introBars;
}

/** "Bar 5", or "Intro bar 2" for a bar of the intro. */
export function barName(bar: NumberedBar, introBars: number): string {
  const n = shownNumber(bar, introBars);
  return n === null ? `Intro bar ${bar.number}` : `Bar ${n}`;
}

/** A run of bars for the Loop button: "Bars 9-12", "Bar 5", "Intro bars 1-2", "Intro to bar 4". */
export function barsLabel(first: NumberedBar, last: NumberedBar, introBars: number): string {
  if (first === last || first.number === last.number) return barName(first, introBars);
  const a = shownNumber(first, introBars);
  const b = shownNumber(last, introBars);
  if (a !== null && b !== null) return `Bars ${a}-${b}`;
  if (a === null && b === null) return `Intro bars ${first.number}-${last.number}`;
  return `Intro to bar ${b}`;
}

/** A chart's own styles by name: "Latin and swing" for Latin A's with a swing bridge, one name when its sections all play one style. */
export function styleNames(chart: Chart): string {
  const names = chartStyles(chart).map((s, k) => (k ? s.name.toLowerCase() : s.name));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? chart.style);
}
