import { describe, expect, it } from "vitest";
import { FIXTURES } from "../fixtures";
import { buildSchedule } from "../engine/schedule";
import { STYLES } from ".";
import { isFormEnd } from "./swing";
import type { Variation } from "./types";

/** The drums' rhythm in each bar (sound and half beat, wide enough for the timing pockets), for the bars inside the form away from its ends. */
function drumBars(chartId: string, styleId: string, variation: Variation) {
  const chart = FIXTURES.find((c) => c.id === chartId)!;
  const s = buildSchedule(chart, STYLES[styleId], { choruses: 3, countIn: false, transpose: 0, intro: false, ending: false, variation });
  const per = chart.beatsPerBar;
  return s.bars
    .filter((b, i) => b.ref?.part === "form" && !b.final && !isFormEnd(b, s.bars[i + 1]) && !(i > 0 && isFormEnd(s.bars[i - 1], b)))
    .map((b) =>
      s.events
        .filter((e) => e.track === "drums" && e.time >= b.startBeat - 0.12 && e.time < b.startBeat + per - 0.12)
        .map((e) => `${e.drum}@${Math.floor((e.time - b.startBeat) * 2 + 0.25)}`)
        .sort()
        .join(" "),
    );
}

describe("straight feel", () => {
  for (const chart of FIXTURES) {
    const styles = Object.values(STYLES).filter((s) => (s.meters ?? [4]).includes(chart.beatsPerBar));
    for (const style of styles) {
      it(`keeps one drum groove in ${style.id} over ${chart.id}`, () => {
        const straight = new Set(drumBars(chart.id, style.id, "straight"));
        const varied = new Set(drumBars(chart.id, style.id, "varied"));
        // Every style's straight groove repeats every bar (bossa's cross-stick is on 2 and 4, not a two-bar clave).
        expect(straight.size).toBe(1);
        expect(varied.size).toBeGreaterThan(1);
      });
    }
  }
});
