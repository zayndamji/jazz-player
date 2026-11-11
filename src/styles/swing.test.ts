import { describe, expect, it } from "vitest";
import { swingForm } from "../fixtures";
import { buildSchedule } from "../engine/schedule";
import { swing } from "./swing";

const chart = swingForm;
const schedule = buildSchedule(chart, swing, { choruses: 2, countIn: false, transpose: 0 });
const inBar = (index: number, track: string) =>
  schedule.events.filter((e) => e.track === track && e.time >= index * 4 - 0.05 && e.time < index * 4 + 3.95);

describe("swing style", () => {
  it("walks four quarter notes in every bar but the last", () => {
    for (const bar of schedule.bars.slice(0, -1)) expect(inBar(bar.index, "bass").length).toBe(4);
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
      const fourth = inBar(bar.index, "bass")[3].notes![0];
      const target = next.chords[0].chord.bass;
      const d = (((fourth - target) % 12) + 12) % 12;
      expect([1, 11, 7]).toContain(d);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("swings the ride and keeps the hi-hat on 2 and 4", () => {
    const drums = inBar(5, "drums");
    const ride = drums.filter((e) => e.drum === "ride").map((e) => Math.round(((e.time % 4) + 4) % 4 * 12) / 12);
    expect(ride.some((t) => Math.abs(t - (1 + 2 / 3)) < 0.06)).toBe(true);
    const pedal = drums.filter((e) => e.drum === "pedal").map((e) => Math.round(e.time % 4));
    expect(pedal).toEqual([1, 3]);
  });
});
