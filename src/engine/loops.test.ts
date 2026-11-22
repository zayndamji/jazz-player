import { describe, expect, it } from "vitest";
import { bossaForm } from "../fixtures";
import { bossa } from "../styles/bossa";
import type { Chart } from "../chart/types";
import { swing } from "../styles/swing";
import type { NoteEvent } from "../styles/types";
import { buildSchedule, chorusLayoutChanges, loopRepeats } from "./schedule";
import { chorusTranspose, fold, keyCycle, performanceFraction, playOrder, type BarRef } from "./timeline";

const chart = bossaForm;
const form = (section: number, bar: number): BarRef => ({ part: "form", section, bar });
const base = { countIn: false, transpose: 0 } as const;
const music = (s: ReturnType<typeof buildSchedule>) => s.bars.filter((b) => !b.countIn);

const headAndSolos: Chart = {
  id: "head-and-solos",
  title: "Head and solos (test)",
  key: "F",
  tempo: 120,
  beatsPerBar: 4,
  style: "swing",
  form: [
    { label: "A", play: "head", bars: ["F7", "Bb7", "F7", "%"] },
    { label: "A", play: "solos", sheetBar: 1, bars: ["F7", "Bb7", "F7", "C7"] },
  ],
  ending: [{ label: "End", bars: ["F7"] }],
};

describe("starting inside the repeating chorus", () => {
  it("starts in chorus 2 of choruses until stopped on that very bar", () => {
    const s = buildSchedule(chart, bossa, { ...base, choruses: "loop", start: { ref: form(0, 3), chorus: 2 } });
    expect(s.bars[0].chorus).toBe(2);
    expect(s.bars[0].ref).toEqual(form(0, 3));
    // The repeating chorus follows what is left of this one.
    expect(s.loop).toEqual({ start: (32 - 3) * 4, end: s.totalBeats });
    expect(s.bars[29].chorus).toBe(3);
    expect(s.bars[29].ref).toEqual(form(0, 0));
  });

  it("keeps a start in the head chorus and the intro as they were", () => {
    const s = buildSchedule(chart, bossa, { ...base, choruses: "loop" });
    expect(s.bars.length).toBe(4 + 6 * 32);
    expect(s.loop).toEqual({ start: (4 + 64) * 4, end: (4 + 6 * 32) * 4 });
    const h = buildSchedule(chart, bossa, { ...base, choruses: "loop", start: { ref: form(1, 0), chorus: 1 } });
    expect(h.bars[0].chorus).toBe(1);
  });

  it("starts at a solo-only bar, given as the head chorus, in the chorus that has it", () => {
    const s = buildSchedule(headAndSolos, bossa, { ...base, choruses: "loop", start: { ref: form(1, 2), chorus: 1 } });
    expect(s.bars[0].ref).toEqual(form(1, 2));
    expect(s.bars[0].chorus).toBe(2);
    expect(s.loop!.start).toBe(2 * 4);
  });
});

describe("a loop never plays the song's final hit", () => {
  it("leaves final off when a range ends in an ending bar", () => {
    const range = { from: { part: "ending" as const, section: 0, bar: 2 }, to: { part: "ending" as const, section: 1, bar: 0 } };
    const s = buildSchedule(chart, bossa, { ...base, choruses: 2, loopRange: range });
    expect(s.loop).not.toBeNull();
    expect(s.bars.some((b) => b.final)).toBe(false);
    const plain = buildSchedule(chart, bossa, { ...base, choruses: 1 });
    expect(plain.bars.at(-1)!.final).toBe(true);
  });
});

describe("key each chorus in loops and until stopped", () => {
  const keys = (s: ReturnType<typeof buildSchedule>, section: number) =>
    music(s)
      .filter((b) => b.ref?.part === "form" && b.ref.section === section && b.ref.bar === 0)
      .map((b) => [b.chorus, b.transpose]);

  it("knows how long a key cycle is", () => {
    expect([0, 5, 1, -1, 2].map(keyCycle)).toEqual([1, 12, 12, 12, 6]);
  });

  it("repeats at least four copies, and whole key cycles", () => {
    expect([0, 5, 1, -1, 2].map(loopRepeats)).toEqual([4, 12, 12, 12, 6]);
  });

  it("lays out a whole key cycle of repeating choruses until stopped", () => {
    const s = buildSchedule(chart, bossa, { ...base, choruses: "loop", keyStep: 5 });
    expect(s.cycle).toBe(12);
    // The head, the solo chorus that builds, then twelve that repeat.
    expect(keys(s, 0)).toEqual(Array.from({ length: 14 }, (_, i) => [i + 1, chorusTranspose(0, 5, i + 1)]));
    // The last copy is in the key before the first repeating copy's, so the wrap steps the key up a fourth.
    expect(fold(s.bars.at(-1)!.transpose + 5)).toBe(chorusTranspose(0, 5, 3));
    expect(s.loop!.start).toBe((4 + 64) * 4);
    expect(s.passes).toHaveLength(12);
    expect(s.passes[0]).toBe(s.loop!.start);
    expect(s.passes[1] - s.passes[0]).toBe(32 * 4);
    expect(s.loop!.end - s.loop!.start).toBe(12 * 32 * 4);
  });

  it("repeats a whole six-key cycle for whole steps", () => {
    const s = buildSchedule(chart, bossa, { ...base, choruses: "loop", keyStep: 2 });
    expect(s.cycle).toBe(6);
    expect(s.passes).toHaveLength(6);
    expect((s.loop!.end - s.loop!.start) / (32 * 4)).toBe(6);
  });

  it("moves the key every pass of a looped section and range", () => {
    const sec = buildSchedule(chart, bossa, { ...base, choruses: 3, keyStep: 2, loopSection: 1 });
    expect(sec.cycle).toBe(6);
    expect(sec.passes).toHaveLength(6);
    expect(keys(sec, 1).map(([, t]) => t)).toEqual([0, 2, 4, -6, -4, -2, 0]);
    const range = buildSchedule(chart, bossa, { ...base, choruses: 3, keyStep: 5, loopRange: { from: form(0, 2), to: form(0, 5) } });
    expect(range.bars.length).toBe(4 * 13);
    expect(range.bars[4].transpose).toBe(5);
  });

  it("keeps one key and four repeating copies when the key does not move", () => {
    const s = buildSchedule(chart, bossa, { ...base, choruses: 3, loopSection: 0 });
    expect(s.cycle).toBe(4);
    expect(s.bars.length).toBe(8 * 5);
    expect(s.loop).toEqual({ start: 8 * 4, end: 40 * 4 });
    expect(s.passes).toEqual([8, 16, 24, 32].map((b) => b * 4));
    expect(s.bars.every((b) => b.transpose === 0)).toBe(true);
  });

  it("starts a loop in the pass it was in, with the count-in in that key", () => {
    const s = buildSchedule(chart, bossa, { choruses: "loop", countIn: true, transpose: 0, keyStep: 5, start: { ref: form(1, 4), chorus: 7 } });
    const first = s.bars[2];
    expect(first.chorus).toBe(7);
    expect(first.transpose).toBe(chorusTranspose(0, 5, 7));
    expect(s.bars[0].transpose).toBe(first.transpose);
    expect(s.loop!.start).toBe((2 + 4 + 8 + 8) * 4);
  });
});

describe("the progress line on a repeated tag", () => {
  it("uses the place in the run to tell the two tags apart", () => {
    const order = playOrder(chart, 2);
    const tag = order.findIndex((i) => i.ref.part === "ending");
    const second = tag + 4;
    const place = order[second];
    expect(performanceFraction(order, place, 0, 4)).toBeCloseTo(tag / order.length);
    expect(performanceFraction(order, place, 0, 4, second)).toBeCloseTo(second / order.length);
  });
});

describe("changing choruses to a different layout", () => {
  it("sees when the chorus that is playing becomes or stops being the last head chorus", () => {
    // 3 choruses: chorus 3 is the closing head. Lowering to 2 while in chorus 2 makes chorus 2 the closing head.
    expect(chorusLayoutChanges(headAndSolos, 3, 2, 2)).toBe(true);
    expect(chorusLayoutChanges(headAndSolos, 2, 4, 2)).toBe(true);
    // Chorus 2 of 4 stays a solo chorus when the count goes from 4 to 6.
    expect(chorusLayoutChanges(headAndSolos, 4, 6, 2)).toBe(false);
    // The first chorus never changes, and a chart with no head or solo sections never changes.
    expect(chorusLayoutChanges(headAndSolos, 3, 5, 1)).toBe(false);
    expect(chorusLayoutChanges(chart, 3, 2, 2)).toBe(false);
  });
});

/** The events of the bars from `from` to `to` (beats), as times from `from`, so two passes can be compared. */
const slice = (events: NoteEvent[], from: number, to: number, track?: string) =>
  events
    .filter((e) => e.time >= from - 1e-6 && e.time < to - 1e-6 && (!track || e.track === track))
    .map((e) => `${e.track}:${(e.time - from).toFixed(3)}:${e.drum ?? e.notes?.join(".")}:${e.velocity.toFixed(3)}`);

describe("the repeating copies are each their own pass", () => {
  const passPairs = (s: ReturnType<typeof buildSchedule>) => s.passes.map((p, i) => [p, s.passes[i + 1] ?? s.loop!.end]);

  it("plays every looped chorus differently until stopped", () => {
    for (const style of [bossa, swing]) {
      const s = buildSchedule(chart, style, { ...base, choruses: "loop" });
      const passes = passPairs(s).map(([a, b]) => slice(s.events, a, b));
      for (let i = 1; i < passes.length; i++) expect(passes[i]).not.toEqual(passes[i - 1]);
      // The wrap: the last copy goes back to the first, and those differ too.
      expect(passes.at(-1)).not.toEqual(passes[0]);
      // Not only the drums: the bass and piano lines move as well.
      for (const track of ["bass", "piano"]) expect(slice(s.events, ...(passPairs(s)[0] as [number, number]), track)).not.toEqual(slice(s.events, ...(passPairs(s)[1] as [number, number]), track));
    }
  });

  it("plays a looped section and range differently each pass", () => {
    const sec = buildSchedule(chart, swing, { ...base, choruses: 3, loopSection: 1 });
    const range = buildSchedule(chart, swing, { ...base, choruses: 3, loopRange: { from: form(0, 0), to: form(0, 7) } });
    for (const s of [sec, range]) {
      const passes = passPairs(s).map(([a, b]) => slice(s.events, a, b));
      expect(passes).toHaveLength(4);
      for (let i = 1; i < passes.length; i++) expect(passes[i]).not.toEqual(passes[i - 1]);
    }
  });

  it("builds through the first solo chorus and holds a solo level in the repeats", () => {
    const s = buildSchedule(chart, swing, { ...base, choruses: "loop" });
    const drumLevel = (from: number, to: number) => {
      const hits = s.events.filter((e) => e.track === "drums" && e.drum === "ride" && e.time >= from && e.time < to);
      return hits.reduce((n, e) => n + e.velocity * (e.gain ?? 1), 0) / Math.max(1, hits.length);
    };
    const bar = (n: number) => n * 4;
    const headEnd = drumLevel(bar(4 + 24), bar(4 + 32));
    const soloStart = drumLevel(bar(4 + 32), bar(4 + 40));
    const soloEnd = drumLevel(bar(4 + 56), bar(4 + 64));
    expect(soloEnd).toBeGreaterThan(soloStart);
    // The barline from head to solos is a step, but a smaller one than the whole build.
    expect(20 * Math.log10(soloEnd / headEnd)).toBeGreaterThan(20 * Math.log10(soloStart / headEnd));
    const repeats = passPairs(s).map(([a, b]) => drumLevel(a, b));
    for (const r of repeats) expect(Math.abs(20 * Math.log10(r / repeats[0]))).toBeLessThan(1.5);
  });
});
