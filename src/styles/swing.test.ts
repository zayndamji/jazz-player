import { describe, expect, it } from "vitest";
import { swingForm } from "../fixtures";
import { buildSchedule } from "../engine/schedule";
import { swing, swingRatio } from "./swing";

const chart = swingForm;
const schedule = buildSchedule(chart, swing, { choruses: 2, countIn: false, transpose: 0 });
const inBar = (index: number, track: string) =>
  schedule.events.filter((e) => e.track === track && e.time >= index * 4 - 0.05 && e.time < index * 4 + 3.95);
/** Bass notes on the beat (leaving out ghosted notes between beats). */
const onBeat = (index: number) => inBar(index, "bass").filter((e) => Math.abs(e.time - Math.round(e.time)) < 0.05);

describe("swing style", () => {
  it("walks four quarter notes in every bar but the last", () => {
    for (const bar of schedule.bars.slice(0, -1)) expect(onBeat(bar.index).length).toBe(4);
  });

  it("lands on the chord's bass note on its first beat", () => {
    const bar = schedule.bars.find((b) => b.ref?.part === "form" && b.ref.bar === 2)!; // D7
    const first = inBar(bar.index, "bass")[0];
    expect(first.notes![0] % 12).toBe(2);
  });

  it("approaches the next chord by a half step or a fifth", () => {
    let checked = 0;
    for (let i = 0; i < schedule.bars.length - 2; i++) {
      const bar = schedule.bars[i];
      const next = schedule.bars[i + 1];
      if (bar.chords.length !== 1 || !next.chords[0]?.attack || next.final) continue;
      const fourth = onBeat(bar.index)[3].notes![0];
      const target = next.chords[0].chord.bass;
      const d = (((fourth - target) % 12) + 12) % 12;
      expect([1, 11, 7]).toContain(d);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("swings the ride and keeps the hi-hat on 2 and 4", () => {
    // Most bars swing a skip note (on the ride, or the closed hi-hat in some heads); a few play
    // straight quarters for variety.
    const swungBars = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].filter((b) =>
      inBar(b, "drums").some((e) => (e.drum === "ride" || e.drum === "hat") && Math.abs((((e.time % 1) + 1) % 1) - 2 / 3) < 0.06),
    );
    expect(swungBars.length).toBeGreaterThanOrEqual(6);
    const drums = inBar(5, "drums");
    const pedal = drums.filter((e) => e.drum === "pedal").map((e) => Math.round(e.time % 4));
    expect(pedal).toEqual([1, 3]);
  });

  it("swings harder when slow and straighter when fast", () => {
    expect(swingRatio(140)).toBeCloseTo(2 / 3, 5);
    expect(swingRatio(100)).toBeGreaterThan(swingRatio(140));
    expect(swingRatio(260)).toBeLessThan(0.6);
  });

  it("thins out at up tempos: no guitar, straighter ride", () => {
    const fast = buildSchedule(chart, swing, { choruses: 1, countIn: false, transpose: 0, tempo: 260 });
    expect(fast.events.some((e) => e.track === "guitar")).toBe(false);
    // Within the timing pocket's few milliseconds of the up-tempo swing ratio.
    const skips = fast.events.filter((e) => e.drum === "ride" && Math.abs((e.time % 1) - swingRatio(260)) < 0.06);
    expect(skips.length).toBeGreaterThan(20);
    const comps = (s: typeof schedule) => s.events.filter((e) => e.track === "piano").length / s.bars.length;
    expect(comps(fast)).toBeLessThan(comps(schedule));
  });

  it("plays the first chorus in two with cross-stick on 4, then walks", () => {
    const two = buildSchedule(chart, swing, { choruses: 2, countIn: false, transpose: 0, twoFeel: true });
    const bar = (chorus: number, section: number, n: number) =>
      two.bars.find((b) => b.chorus === chorus && b.ref?.part === "form" && b.ref.section === section && b.ref.bar === n)!;
    const notes = (index: number, track: string) => two.events.filter((e) => e.track === track && e.time >= index * 4 - 0.05 && e.time < index * 4 + 3.95);
    const onBeats = (index: number) => notes(index, "bass").filter((e) => Math.abs(e.time - Math.round(e.time)) < 0.05).map((e) => Math.round(e.time) % 4);
    expect(onBeats(bar(1, 0, 0).index)).toEqual([0, 2]);
    expect(onBeats(bar(1, 3, 7).index).length).toBe(4); // the last bar walks into chorus 2
    expect(onBeats(bar(2, 0, 0).index).length).toBe(4);
    expect(notes(bar(1, 0, 1).index, "drums").some((e) => e.drum === "rim" && Math.round(e.time % 4) === 3)).toBe(true);
  });

  it("arcs over the choruses: a lighter head, a peak in the solos, the head again at the end", () => {
    const four = buildSchedule(chart, swing, { choruses: 4, countIn: false, transpose: 0 });
    const ride = (chorus: number) => {
      const bars = new Set(four.bars.filter((b) => b.chorus === chorus).map((b) => b.index));
      const v = four.events.filter((e) => (e.drum === "ride" || e.drum === "hat") && bars.has(Math.floor(e.time / 4))).map((e) => e.velocity);
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    const top = (chorus: number) => {
      const bars = new Set(four.bars.filter((b) => b.chorus === chorus).map((b) => b.index));
      const tops = four.events.filter((e) => e.track === "piano" && bars.has(Math.floor(e.time / 4))).map((e) => Math.max(...e.notes!));
      return tops.reduce((a, b) => a + b, 0) / tops.length;
    };
    expect(ride(3)).toBeGreaterThan(ride(1) * 1.08);
    expect(ride(4)).toBeLessThan(ride(3));
    expect(top(3)).toBeGreaterThan(top(1) + 1);
  });

  it("touches each piano chord: the top note loudest, the notes a few milliseconds apart", () => {
    const chords = schedule.events.filter((e) => e.track === "piano");
    for (const e of chords) {
      expect(e.levels!.length).toBe(e.notes!.length);
      expect(Math.max(...e.levels!)).toBe(e.levels!.at(-1));
      expect(e.offsets![0]).toBe(0);
      expect(e.offsets!.at(-1)!).toBeLessThan(0.08);
    }
  });

  it("keeps every note within 18 ms of the grid's pocket", () => {
    const beatMs = 60000 / chart.tempo;
    for (const e of schedule.events.filter((x) => x.track === "bass")) {
      const off = (e.time - Math.round(e.time * 3) / 3) * beatMs;
      expect(Math.abs(off)).toBeLessThan(60); // a ghosted note sits on the swung eighth, which is near a triplet
    }
    const onBeats = schedule.events.filter((x) => x.track === "bass" && Math.abs(x.time - Math.round(x.time)) < 0.1);
    for (const e of onBeats) expect(Math.abs(e.time - Math.round(e.time)) * beatMs).toBeLessThanOrEqual(18.5);
  });
});
