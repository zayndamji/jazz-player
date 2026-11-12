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
    // Most bars swing the skip note; a few play the ride in straight quarters for variety.
    const swungBars = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].filter((b) =>
      inBar(b, "drums").some((e) => e.drum === "ride" && Math.abs((((e.time % 4) + 4) % 4) - (1 + 2 / 3)) < 0.06),
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
    const skips = fast.events.filter((e) => e.drum === "ride" && Math.abs((e.time % 1) - swingRatio(260)) < 0.03);
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
});
