import { describe, expect, it } from "vitest";
import { parseBar } from "../chart/chords";
import { fiveForm } from "../fixtures";
import { buildSchedule, clicksOn } from "../engine/schedule";
import { five } from "./five";

const s = buildSchedule(fiveForm, five, { choruses: 2, countIn: false, transpose: 0 });
const inBar = (b: (typeof s.bars)[0], track: string) => s.events.filter((e) => e.track === track && e.time >= b.startBeat - 0.1 && e.time < b.startBeat + 4.9);
const vamps = s.bars.filter((b) => b.ref?.part === "form" && b.ref.section !== 1 && !b.final);

describe("5/4", () => {
  it("splits two chords 3+2 and clicks the groups", () => {
    expect(parseBar("Dm Am7", 5).chords.map((c) => c.beat)).toEqual([0, 3]);
    expect(parseBar("Dm / / Am7 /", 5).chords.map((c) => c.beat)).toEqual([0, 3]);
    expect([0, 1, 2, 3, 4].filter((b) => clicksOn("two-four", b, 5))).toEqual([0, 3]);
  });

  it("plays the bass ostinato in the vamp: 1, 4 and 5", () => {
    for (const b of vamps) {
      const beats = inBar(b, "bass").map((e) => Math.round(e.time - b.startBeat) || 0);
      expect(beats).toEqual([0, 3, 4]);
      expect(inBar(b, "bass")[0].notes![0] % 12).toBe(2); // D
      expect(inBar(b, "bass")[1].notes![0] % 12).toBe(9); // A, the second chord's root
    }
  });

  it("rides every beat with skips after 2 and 4", () => {
    const b = vamps[3];
    const ride = inBar(b, "drums").filter((e) => e.drum === "ride").map((e) => e.time - b.startBeat);
    for (const beat of [0, 1, 2, 3, 4]) expect(ride.some((t) => Math.abs(t - beat) < 0.06)).toBe(true);
    expect(ride.some((t) => t > 1.5 && t < 1.8)).toBe(true);
    expect(ride.some((t) => t > 3.5 && t < 3.8)).toBe(true);
  });

  it("walks the bass over the bridge's changes", () => {
    const bridge = s.bars.find((b) => b.ref?.part === "form" && b.ref.section === 1 && b.ref.bar === 3)!; // Fmaj7, a whole bar
    expect(inBar(bridge, "bass").length).toBe(5);
    const changing = s.bars.find((b) => b.ref?.part === "form" && b.ref.section === 1 && b.ref.bar === 1)!;
    expect(inBar(changing, "bass").length).toBe(5);
  });
});
