import { describe, expect, it } from "vitest";
import { STYLES } from "../styles";
import { CHARTS, CHART_FILES, validateChart } from ".";
import { FIXTURES } from "../fixtures";

describe("charts", () => {
  it("has the example chart", () => {
    expect(CHARTS.some((c) => c.id === "blues-in-f")).toBe(true);
  });

  // Every chart in tunes/ and examples/, plus the test fixtures.
  it.each([...Object.entries(CHART_FILES), ...FIXTURES.map((c) => [c.id, c] as const)])("%s is valid", (file, chart) => {
    expect(chart.id).toBe(file);
    expect(validateChart(chart)).toEqual([]);
    expect(STYLES[chart.style], `style "${chart.style}"`).toBeDefined();
  });

  it("has unique ids", () => {
    expect(new Set(CHARTS.map((c) => c.id)).size).toBe(CHARTS.length);
  });
});
