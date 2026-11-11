import { describe, expect, it } from "vitest";
import { STYLES } from "../styles";
import { CHARTS, CHART_FILES, validateChart } from ".";

describe("charts", () => {
  it("has charts", () => {
    expect(CHARTS.length).toBeGreaterThan(1);
  });

  it.each(Object.entries(CHART_FILES))("%s is valid", (file, chart) => {
    expect(chart.id).toBe(file);
    expect(validateChart(chart)).toEqual([]);
    expect(STYLES[chart.style], `style "${chart.style}"`).toBeDefined();
  });

  it("has unique ids", () => {
    expect(new Set(CHARTS.map((c) => c.id)).size).toBe(CHARTS.length);
  });
});
