import { describe, expect, it } from "vitest";
import type { Chart } from "../chart/types";
import { latinForm } from "../fixtures";
import { validateChart } from "../charts";
import { STYLES } from "../styles";
import { buildSchedule } from "./schedule";

/** The made-up Latin chart with a four-bar break after the last A, played in the head only. */
const withBreak: Chart = {
  ...latinForm,
  id: "break-test",
  form: [...latinForm.form, { label: "Break", break: true, play: "head", bars: ["Em7b5", "A7", "Dm6", "%"] }, { label: "C", play: "solos", bars: ["Gm7", "C7", "Fmaj7", "%"] }],
};

describe("breaks", () => {
  it("is a valid chart", () => {
    expect(validateChart(withBreak)).toEqual([]);
    expect(validateChart({ ...withBreak, form: [{ ...withBreak.form[0], break: "yes" as unknown as boolean }] })).not.toEqual([]);
  });

  for (const id of ["latin", "swing", "bossa"])
    it(`stops the band in the break (${id})`, () => {
      const s = buildSchedule(withBreak, STYLES[id], { choruses: 3, countIn: true, transpose: 0 });
      const rests = s.bars.filter((b) => b.rest);
      // Played in the head choruses only: the first and the last.
      expect(rests.length).toBe(8);
      for (const bar of rests) {
        const inside = s.events.filter((e) => e.time >= bar.startBeat - 0.12 && e.time < bar.startBeat + 3.88);
        expect(inside, `bar ${bar.index}`).toEqual([]);
        const ringing = s.events.filter((e) => e.track !== "drums" && e.time < bar.startBeat - 0.12 && e.time + e.duration > bar.startBeat + 0.001);
        expect(ringing, `bar ${bar.index}`).toEqual([]);
      }
      // The metronome goes on through it, and the band comes back after it.
      expect(s.beats.filter((b) => rests.some((r) => r.index === b.bar)).length).toBe(32);
      const after = s.bars[rests[3].index + 1];
      expect(s.events.some((e) => e.track === "bass" && e.time >= after.startBeat - 0.12 && e.time < after.startBeat + 4)).toBe(true);
    });
});
