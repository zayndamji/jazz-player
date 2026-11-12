import { describe, expect, it } from "vitest";
import { TEMPO } from "../chart/types";
import { clampTempo } from "./TempoControl";

describe("typed tempo", () => {
  it("rounds and stays inside the tempo range", () => {
    expect(clampTempo(120.4)).toBe(120);
    expect(clampTempo(10)).toBe(TEMPO.min);
    expect(clampTempo(999)).toBe(TEMPO.max);
  });
});
