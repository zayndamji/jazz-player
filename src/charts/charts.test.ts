import { describe, expect, it } from "vitest";
import { STYLES, playsMeter } from "../styles";
import { CHARTS, CHART_FILES, validateChart } from ".";
import { FIXTURES } from "../fixtures";
import { buildSchedule } from "../engine/schedule";

describe("charts", () => {
  it("has the example chart", () => {
    expect(CHARTS.some((c) => c.id === "blues-in-f")).toBe(true);
  });

  // Every chart in tunes/ and examples/, plus the test fixtures.
  it.each([...Object.entries(CHART_FILES), ...FIXTURES.map((c) => [c.id, c] as const)])("%s is valid", (file, chart) => {
    expect(chart.id).toBe(file);
    expect(validateChart(chart)).toEqual([]);
    expect(STYLES[chart.style], `style "${chart.style}"`).toBeDefined();
    // A section's own style is one the player knows and that plays the chart's meter.
    for (const section of [...(chart.intro ? [chart.intro] : []), ...chart.form, ...(chart.ending ?? [])])
      if (section.style) expect(STYLES[section.style] && playsMeter(STYLES[section.style], chart.beatsPerBar), `section ${section.label} style "${section.style}"`).toBe(true);
    if (chart.soloStyle) expect(STYLES[chart.soloStyle] && playsMeter(STYLES[chart.soloStyle], chart.beatsPerBar), `soloStyle "${chart.soloStyle}"`).toBe(true);
  });

  // Any tune can be played in any style, at its own tempo, fast, and in two.
  it.each([...CHARTS, ...FIXTURES].map((c) => [c.id, c] as const))("%s plays in every style that plays its meter", (_, chart) => {
    for (const style of Object.values(STYLES).filter((s) => playsMeter(s, chart.beatsPerBar))) {
      for (const feel of [{}, { tempo: 260 }, { twoFeel: true }]) {
        const s = buildSchedule(chart, style, { choruses: 2, countIn: true, transpose: 3, ...feel });
        expect(s.events.length, style.id).toBeGreaterThan(s.bars.length);
        for (const e of s.events) {
          expect(Number.isFinite(e.time) && e.time >= 0 && e.duration > 0, `${style.id} ${JSON.stringify(e)}`).toBe(true);
          for (const n of e.notes ?? []) expect(n >= 24 && n <= 96, `${style.id} note ${n}`).toBe(true);
        }
      }
    }
  });

  it("has unique ids", () => {
    expect(new Set(CHARTS.map((c) => c.id)).size).toBe(CHARTS.length);
  });
});
