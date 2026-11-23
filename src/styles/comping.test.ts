import { describe, expect, it } from "vitest";
import { bossaForm, fiveForm, swingForm, waltzForm } from "../fixtures";
import { buildSchedule } from "../engine/schedule";
import { bossa } from "./bossa";
import { five } from "./five";
import { DAMPER, GrooveBook, grooveBar, vary, type CompHit, type Groove } from "./comping";
import { seededRandom } from "./random";
import { swing } from "./swing";
import { waltz } from "./waltz";
import type { Style } from "./types";

const groove: Groove = { id: "test", weight: 1, bars: [[[0, 0.6, 0.5], [3, 0.4, 0.48]], [[2, 0.45, 0.5], [6, 0.45, 0.5]]] };
const options = { adds: [2, 4, 6].map((slot) => ({ slot, weight: 1 })), busier: 1, length: 0.4, velocity: 0.47 };

describe("comping grooves", () => {
  it("varies a bar by one small move, never emptying it", () => {
    const random = seededRandom(3);
    for (let k = 0; k < 300; k++) {
      const bar: CompHit[] = k % 2 ? [[4, 1, 0.5]] : groove.bars[0];
      const out = vary(bar, random, options);
      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(Math.abs(out.length - bar.length)).toBeLessThanOrEqual(1);
      expect(out.every(([slot]) => slot >= 0 && slot <= 7)).toBe(true);
      expect(new Set(out.map(([s]) => s)).size).toBe(out.length);
    }
  });

  it("plays A B A B through a phrase, the phrase's first bar nearly always as written", () => {
    const random = seededRandom(5);
    const chances = { first: 0.05, middle: 0.2, last: 0.4 };
    const asWritten = (inPhrase: number) => {
      let same = 0;
      for (let k = 0; k < 400; k++) same += JSON.stringify(grooveBar(groove, inPhrase, random, chances, options)) === JSON.stringify(groove.bars[inPhrase % 2]) ? 1 : 0;
      return same / 400;
    };
    expect(asWritten(0)).toBeGreaterThan(0.9);
    expect(asWritten(1)).toBeGreaterThan(0.7);
    expect(asWritten(3)).toBeLessThan(asWritten(1));
  });

  it("keeps a section's groove through the chorus", () => {
    const book = new GrooveBook(seededRandom(1), 0.5);
    let n = 0;
    const pick = () => ({ ...groove, id: `g${n++}` });
    const a = book.grooveFor(1, "A", pick);
    expect(book.grooveFor(1, "A", pick)).toBe(a);
    expect(book.grooveFor(1, "B", pick)).not.toBe(a);
  });
});

/**
 * How the site's piano comps, on the measures used for the references' piano stems
 * (context/piano-comping.md): the share of bars holding the section's busiest eighth (per section
 * of a chorus, as the references were measured in windows), and how many hits a bar shares with the
 * bar before and with the bar two before.
 */
function shape(style: Style, chart: typeof swingForm, straightAnds: boolean, beats = 4) {
  const s = buildSchedule(chart, style, { choruses: 6, countIn: false, transpose: 0 });
  const bars = s.bars.filter((b) => b.ref?.part === "form" && b.chorus >= 2 && b.chorus <= 5);
  const sets = bars.map((b) => {
    const slots = new Set<number>();
    for (const e of s.events)
      if (e.track === "piano" && e.notes!.length > 1 && e.time >= b.startBeat - 0.12 && e.time < b.startBeat + beats - 0.12) {
        const beat = Math.max(0, e.time - b.startBeat);
        const frac = beat - Math.floor(beat);
        slots.add(Math.floor(beat) * 2 + (frac > (straightAnds ? 0.35 : 0.45) ? 1 : 0));
      }
    return slots;
  });
  const sections = new Map<string, Set<number>[]>();
  bars.forEach((b, i) => {
    const key = `${b.chorus}.${b.ref!.section}`;
    sections.set(key, [...(sections.get(key) ?? []), sets[i]]);
  });
  const anchors = [...sections.values()].map((group) => {
    const count = new Array(beats * 2).fill(0);
    group.forEach((set) => set.forEach((slot) => count[slot]++));
    const top = count.indexOf(Math.max(...count));
    return group.filter((set) => set.has(top)).length / group.length;
  });
  const jac = (a: Set<number>, b: Set<number>) => (a.size + b.size === 0 ? 1 : [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size);
  const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
  return {
    anchor: mean(anchors),
    jac1: mean(sets.slice(1).map((set, i) => jac(set, sets[i]))),
    jac2: mean(sets.slice(2).map((set, i) => jac(set, sets[i]))),
    short: s.events.filter((e) => e.track === "piano" && e.duration < 1.2 && e.notes!.length > 1).every((e) => e.release === DAMPER),
  };
}

describe("predictable comping", () => {
  for (const [name, style, chart, straightAnds] of [
    ["swing", swing, swingForm, false],
    ["bossa", bossa, bossaForm, true],
    ["waltz", waltz, waltzForm, false],
    ["5/4", five, fiveForm, false],
  ] as const) {
    it(`${name}: comes back to one place in the bar and repeats its two-bar figure, varied a little`, () => {
      const m = shape(style, chart, straightAnds, chart.beatsPerBar ?? 4);
      // The references' busiest eighth is in 50 to 100% of bars; the old comping's in about 40%.
      expect(m.anchor).toBeGreaterThan(0.5);
      // Bars two apart share more than neighbours (the A B A B groove), but bars still vary.
      expect(m.jac2).toBeGreaterThan(0.4);
      expect(m.jac2).toBeLessThan(0.95);
      // (The 5/4 vamp's two bars differ by one hit, so neighbours share nearly as much.)
      expect(m.jac2).toBeGreaterThan(name === "5/4" ? m.jac1 - 0.05 : m.jac1);
      expect(m.short).toBe(true);
    });
  }
});

describe("held comping", () => {
  // The share of each comped bar with a piano chord sounding: the old comping cut its chords after
  // about half a beat and left 25 to 40% of the bar sounding (Autumn Leaves in two: one beat, then silence).
  for (const [name, style, chart] of [
    ["swing", swing, swingForm],
    ["swing in two", swing, { ...swingForm, twoFeel: true }],
    ["bossa", bossa, bossaForm],
    ["waltz", waltz, waltzForm],
    ["5/4", five, fiveForm],
  ] as const) {
    it(`${name}: holds its chords until about the next one instead of dropping out`, () => {
      const s = buildSchedule(chart, style, { choruses: 3, countIn: false, transpose: 0 });
      const beats = chart.beatsPerBar ?? 4;
      const chords = s.events.filter((e) => e.track === "piano" && e.notes!.length > 1);
      const shares = s.bars
        .filter((b) => b.ref?.part === "form" && chords.some((e) => e.time >= b.startBeat - 0.3 && e.time < b.startBeat + beats - 0.1))
        .map((b) => {
          let on = 0;
          for (let k = 0; k < beats * 20; k++) {
            const at = b.startBeat + k / 20;
            if (chords.some((e) => e.time <= at && e.time + e.duration > at)) on++;
          }
          return on / (beats * 20);
        });
      expect(shares.reduce((a, b) => a + b, 0) / shares.length).toBeGreaterThan(0.5);
    });
  }
});
