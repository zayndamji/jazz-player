import { describe, expect, it } from "vitest";
import { FIXTURES } from "../fixtures";
import { buildSchedule } from "../engine/schedule";
import { STYLES } from ".";
import { isFormEnd } from "./context";
import type { Variation } from "./types";

/** The drums' rhythm in each bar (sound and half beat, wide enough for the timing pockets), for the bars inside the form away from its ends. */
function drumBars(chartId: string, styleId: string, variation: Variation) {
  const found = FIXTURES.find((c) => c.id === chartId)!;
  // One style's groove: sections that name their own style play in it too.
  const chart = { ...found, form: found.form.map(({ style: _, ...section }) => section) };
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
        // Every style's straight groove repeats every bar (bossa's cross-stick is on 2 and 4, not a two-bar clave);
        // Latin's repeats every two, the clave's 2 side and 3 side.
        expect(straight.size).toBe(style.id === "latin" ? 2 : 1);
        expect(varied.size).toBeGreaterThan(1);
      });
    }
  }
});
