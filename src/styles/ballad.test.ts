import { describe, expect, it } from "vitest";
import { balladForm } from "../fixtures";
import { buildSchedule } from "../engine/schedule";
import { ballad } from "./ballad";

const chart = balladForm;
const schedule = buildSchedule(chart, ballad, { choruses: 2, countIn: false, transpose: 0 });
const inBar = (index: number, track: string) =>
  schedule.events.filter((e) => e.track === track && e.time >= index * 4 - 0.05 && e.time < index * 4 + 3.95);
const formBar = (chorus: number, section: number, bar: number) =>
  schedule.bars.find((b) => b.chorus === chorus && b.ref?.part === "form" && b.ref.section === section && b.ref.bar === bar)!;

describe("ballad style", () => {
  it("plays half notes in the first chorus's A sections and walks later", () => {
    const first = inBar(formBar(1, 0, 0).index, "bass"); // Ebmaj7, a whole bar
    expect(first.map((e) => Math.round(e.time % 4) % 4)).toEqual([0, 2]);
    expect(first[0].notes![0] % 12).toBe(3); // Eb
    expect(inBar(formBar(2, 0, 0).index, "bass").length).toBe(4);
    expect(inBar(formBar(1, 2, 0).index, "bass").length).toBe(4); // the bridge walks
  });

  it("has no guitar", () => {
    expect(schedule.events.some((e) => e.track === "guitar")).toBe(false);
  });

  it("rolls each chord change on the piano from the bottom up", () => {
    const bar = formBar(1, 0, 1); // Gm7 C7
    const onThree = inBar(bar.index, "piano").filter((e) => Math.abs((e.time % 4) - 2) < 0.2);
    const notes = onThree.slice(0, 4).map((e) => e.notes![0]);
    expect(notes).toEqual([...notes].sort((a, b) => a - b));
    expect(onThree[3].time).toBeGreaterThan(onThree[0].time);
  });

  it("sweeps on 1 and 3 and strokes 2 and 4 with brushes", () => {
    const drums = inBar(formBar(1, 0, 1).index, "drums");
    expect(drums.filter((e) => e.drum === "brush").map((e) => Math.round(e.time % 4))).toEqual([0, 2]);
    expect(drums.filter((e) => e.drum === "brushTap").map((e) => Math.round(e.time % 4))).toEqual([1, 3]);
    expect(drums.some((e) => e.drum === "ride" || e.drum === "snare")).toBe(false);
  });
});
