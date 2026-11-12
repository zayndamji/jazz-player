import { beforeEach, describe, expect, it } from "vitest";
import { bossaForm, swingForm } from "../fixtures";
import { TEMPO } from "../chart/types";
import { clearSettings, defaultSettings, loadSettings, parseSettings, raisedTempo, saveSettings, tuneKey } from "./settings";

const data = new Map<string, string>();
beforeEach(() => {
  data.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as Storage;
});

describe("tune settings", () => {
  it("starts from the chart's own values", () => {
    const d = defaultSettings(swingForm);
    expect(d.tempo).toBe(swingForm.tempo);
    expect(d.style).toBe(swingForm.style);
    expect(loadSettings(swingForm)).toEqual(d);
  });

  it("round-trips a change and removes the entry at the defaults", () => {
    const s = { ...defaultSettings(bossaForm), tempo: 90, transpose: -2, choruses: "loop" as const };
    saveSettings(bossaForm, s);
    expect(data.has(tuneKey(bossaForm.id))).toBe(true);
    expect(loadSettings(bossaForm)).toEqual(s);
    saveSettings(bossaForm, defaultSettings(bossaForm));
    expect(data.has(tuneKey(bossaForm.id))).toBe(false);
  });

  it("clears the entry", () => {
    saveSettings(bossaForm, { ...defaultSettings(bossaForm), tempo: 90 });
    clearSettings(bossaForm.id);
    expect(loadSettings(bossaForm)).toEqual(defaultSettings(bossaForm));
  });

  it("ignores bad fields and keeps good ones", () => {
    const got = parseSettings({
      tempo: 900,
      transpose: 6,
      style: "polka",
      choruses: 7,
      countIn: 3,
      twoFeel: true,
      view: "poster",
      showScales: 1,
      mix: { bass: { level: 3, mute: true }, drums: { level: 0.5, mute: "no" } },
    });
    expect(got).toEqual({ twoFeel: true, mix: expect.objectContaining({ bass: { level: 1, mute: true }, drums: { level: 0.5, mute: false } }) });
    expect(parseSettings({ tempo: 120, transpose: -6, style: "bossa", choruses: "loop", view: "sheet" })).toEqual({ tempo: 120, transpose: -6, style: "bossa", choruses: "loop", view: "sheet" });
  });

  it("reads the old yes-or-no count-in", () => {
    expect(parseSettings({ countIn: true }).countIn).toBe(2);
    expect(parseSettings({ countIn: false }).countIn).toBe(0);
    expect(parseSettings({ countIn: 1 }).countIn).toBe(1);
  });

  it("survives junk in storage", () => {
    data.set(tuneKey(bossaForm.id), "{not json");
    expect(loadSettings(bossaForm)).toEqual(defaultSettings(bossaForm));
    data.set(tuneKey(bossaForm.id), "[1,2]");
    expect(loadSettings(bossaForm)).toEqual(defaultSettings(bossaForm));
  });
});

describe("speed up each pass", () => {
  it("adds the step and stops at the top tempo", () => {
    expect(raisedTempo(100, 5)).toBe(105);
    expect(raisedTempo(TEMPO.max - 2, 5)).toBe(TEMPO.max);
  });
  it("accepts only the offered steps", () => {
    expect(parseSettings({ speedUp: 5 }).speedUp).toBe(5);
    expect(parseSettings({ speedUp: 3 }).speedUp).toBeUndefined();
  });
});
