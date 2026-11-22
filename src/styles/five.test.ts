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

  it("keeps the ostinato rhythm on the bridge's roots, and walks a bar split another way", () => {
    for (const n of [1, 3]) {
      const b = s.bars.find((x) => x.ref?.part === "form" && x.ref.section === 1 && x.ref.bar === n)!;
      expect(inBar(b, "bass").map((e) => Math.round(e.time - b.startBeat) || 0)).toEqual([0, 3, 4]);
    }
    const changing = s.bars.find((x) => x.ref?.part === "form" && x.ref.section === 1 && x.ref.bar === 1)!; // Am7 Dm7
    expect(inBar(changing, "bass")[1].notes![0] % 12).toBe(2);
    const walked = buildSchedule({ ...fiveForm, form: [{ label: "A", bars: ["Dm / Am7 / C7", "Dm / Am7 / C7"] }] }, five, { choruses: 1, countIn: false, transpose: 0, intro: false });
    expect(walked.events.filter((e) => e.track === "bass" && e.time < 4.9).length).toBe(5);
  });

  it("plays both chords of a two-chord last bar and holds the second", () => {
    const chart = { ...fiveForm, ending: [{ label: "Tag", bars: ["Dm Am7", "Dm Am7"] }] };
    const sch = buildSchedule(chart, five, { choruses: 1, countIn: false, transpose: 0 });
    const end = sch.bars.find((b) => b.final)!;
    const at = (track: string) => sch.events.filter((e) => e.track === track && e.time >= end.startBeat - 0.1);
    expect(at("bass").map((e) => [Math.round(e.time - end.startBeat), e.notes![0] % 12])).toEqual([[0, 2], [3, 9]]);
    const piano = at("piano");
    expect(piano.map((e) => Math.round(e.time - end.startBeat))).toEqual([0, 3]);
    for (const n of piano[1].notes!) expect([9, 0, 4, 7, 11, 2, 5]).toContain(n % 12); // Am7's notes and tensions
    expect(piano[1].duration).toBeGreaterThanOrEqual(4);
  });

  it("varies the vamp: the figure changes bar to bar and no voicing repeats more than three hits", () => {
    const vamp = { ...fiveForm, intro: undefined, ending: undefined, form: [{ label: "A", bars: Array.from({ length: 32 }, () => "Dm Am7") }] };
    for (const variation of ["varied", "straight"] as const) {
      const sch = buildSchedule(vamp, five, { choruses: 2, countIn: false, transpose: 0, variation });
      const piano = sch.events.filter((e) => e.track === "piano");
      let run = 1;
      for (let k = 1; k < piano.length; k++) {
        run = piano[k].notes!.join() === piano[k - 1].notes!.join() ? run + 1 : 1;
        expect(run, `${variation} hit ${k}`).toBeLessThanOrEqual(3);
      }
      for (const e of [...piano, ...sch.events.filter((x) => x.track === "bass")]) for (const n of e.notes!) expect(n).toBeGreaterThanOrEqual(e.track === "piano" ? 45 : 28);
      if (variation === "straight") continue;
      const figure = (b: (typeof sch.bars)[0]) => piano.filter((e) => e.time >= b.startBeat - 0.1 && e.time < b.startBeat + 4.9).map((e) => Math.round((e.time - b.startBeat) * 3)).join();
      const repeats = sch.bars.filter((b, i) => i > 0 && figure(b) === figure(sch.bars[i - 1])).length;
      expect(repeats / sch.bars.length).toBeLessThan(0.4);
    }
  });
});
