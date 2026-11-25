import { describe, expect, it } from "vitest";
import { waltzForm } from "../fixtures";
import { buildSchedule } from "../engine/schedule";
import type { Chart } from "../chart/types";
import { latinWaltz, pairOf } from "./latin-waltz";

const chart: Chart = { ...waltzForm, style: "latin-waltz", tempo: 133 };
const base = { countIn: false, transpose: 0 } as const;
type Bar = ReturnType<typeof buildSchedule>["bars"][number];
const inBar = (s: ReturnType<typeof buildSchedule>, b: Bar, track: string) => s.events.filter((e) => e.track === track && e.time >= b.startBeat - 0.1 && e.time < b.startBeat + 2.9);
/** Eighth slots of a bar's events, 0 to 5. */
const slots = (s: ReturnType<typeof buildSchedule>, b: Bar, track: string) => inBar(s, b, track).map((e) => Math.round((e.time - b.startBeat) * 2) || 0);

describe("Latin waltz", () => {
  const s = buildSchedule(chart, latinWaltz, { ...base, choruses: 3, variation: "straight" });
  // One-chord bars away from the ends, so the figure isn't bent by a change on 3 or a fill.
  const plain = s.bars.filter((b, i) => b.ref?.part === "form" && !b.final && b.chords.length === 1 && s.bars[i + 1] && !s.bars[i + 1].final);

  it("pairs bars from each section's first bar", () => {
    const a = s.bars.filter((b) => b.ref?.part === "form" && b.ref.section === 0).slice(0, 4);
    expect(a.map((b, i) => pairOf(b, i))).toEqual([0, 1, 0, 1]);
  });

  it("plays the bass's two-bar figure: 1 and 3, then 1, the and of 2 and the next root on the and of 3", () => {
    for (const b of plain) {
      const bass = inBar(s, b, "bass");
      if (pairOf(b, 0) === 0) expect(slots(s, b, "bass")).toEqual([0, 4]);
      else {
        expect(slots(s, b, "bass")).toEqual([0, 3, 5]);
        expect(bass[1].notes![0]).toBe(bass[0].notes![0]); // the root again, same octave
        const i = s.bars.indexOf(b);
        const nextRoot = s.bars[i + 1].chords[0].chord.bass;
        expect(((bass[2].notes![0] - nextRoot) % 12 + 12) % 12).toBe(0);
      }
    }
  });

  it("plays the piano ostinato on the and of 1 and beat 3, in straight eighths", () => {
    for (const b of plain.slice(4)) expect(slots(s, b, "piano")).toEqual([1, 4]);
    for (const e of s.events.filter((x) => x.track === "piano" && !s.bars.find((b) => b.final && x.time >= b.startBeat - 0.1)))
      expect(Math.abs(e.time * 2 - Math.round(e.time * 2))).toBeLessThan(0.08);
  });

  it("rides the record's figure, the and of 3 only in the second bar", () => {
    const ride = (b: Bar) => [...new Set(inBar(s, b, "drums").filter((e) => e.drum === "ride").map((e) => Math.round((e.time - b.startBeat) * 2) || 0))];
    const firsts = plain.filter((b) => pairOf(b, 0) === 0 && b.ref!.bar > 0);
    const seconds = plain.filter((b) => pairOf(b, 0) === 1 && !(b.ref!.bar === 15));
    for (const b of firsts) expect(ride(b)).toEqual([0, 1, 2, 3, 4]);
    for (const b of seconds) expect(ride(b)).toEqual([0, 2, 3, 4, 5]);
  });

  it("varies when varied: the piano strolls some solo phrases and the head plays lighter", () => {
    const v = buildSchedule(chart, latinWaltz, { ...base, choruses: 4, variation: "varied" });
    const soloBars = v.bars.filter((b) => b.ref?.part === "form" && b.chorus > 1 && b.chorus < 4 && !b.final);
    const empty = soloBars.filter((b) => inBar(v, b, "piano").length === 0).length;
    expect(empty).toBeGreaterThan(0);
    expect(empty / soloBars.length).toBeLessThan(0.6);
    const head = v.bars.filter((b) => b.ref?.part === "form" && b.chorus === 1);
    const headRide = head.flatMap((b) => inBar(v, b, "drums").filter((e) => e.drum === "ride"));
    const soloRide = soloBars.flatMap((b) => inBar(v, b, "drums").filter((e) => e.drum === "ride"));
    expect(headRide.length / head.length).toBeLessThan(soloRide.length / soloBars.length);
  });

  it("never strikes one voicing more than three times running, and keeps notes in range", () => {
    for (const variation of ["varied", "straight"] as const) {
      const vamp: Chart = { ...chart, intro: undefined, ending: undefined, form: [{ label: "A", bars: Array.from({ length: 16 }, () => "Em9") }] };
      const sch = buildSchedule(vamp, latinWaltz, { ...base, choruses: 2, variation });
      const piano = sch.events.filter((e) => e.track === "piano");
      let run = 1;
      for (let k = 1; k < piano.length; k++) {
        run = piano[k].notes!.join() === piano[k - 1].notes!.join() ? run + 1 : 1;
        expect(run, `${variation} hit ${k}`).toBeLessThanOrEqual(3);
      }
      for (const e of sch.events.filter((x) => x.notes)) for (const n of e.notes!) expect(n).toBeGreaterThanOrEqual(e.track === "piano" ? 45 : 28);
    }
  });
});
