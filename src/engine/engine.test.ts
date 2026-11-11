import { describe, expect, it } from "vitest";
import { parseChord } from "../chart/chords";
import { chordScale } from "../chart/scales";
import { exampleTune } from "../charts/example-tune";
import { bossa } from "../styles/bossa";
import { buildSchedule } from "./schedule";
import { buildTimeline, chartBars, playOrder } from "./timeline";
import { VOICING_HIGH, VOICING_LOW, voiceChord, voicingIntervals } from "./voicing";

const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pcs = (notes: number[]) => notes.map((n) => names[n % 12]);
const chart = exampleTune;

describe("timeline", () => {
  it("numbers bars like the sheet", () => {
    const bars = chartBars(chart);
    expect(bars.length).toBe(4 + 32 + 4 + 1);
    expect(bars[4]).toMatchObject({ number: 5, text: "D", ref: { part: "form", section: 0, bar: 0 } });
    expect(bars[20].number).toBe(21);
    expect(bars[20].text).toBe("Am7");
  });

  it("plays intro, each chorus, the tag twice and the final bar", () => {
    const bars = buildTimeline(chart, playOrder(chart, 2), 0, 2);
    expect(bars.length).toBe(4 + 32 * 2 + 4 * 2 + 1);
    expect(bars[4].chorus).toBe(1);
    expect(bars[36].chorus).toBe(2);
    expect(bars.at(-1)!.final).toBe(true);
  });

  it("carries a chord through a repeat bar without a new attack", () => {
    const bars = buildTimeline(chart, playOrder(chart, 1), 0, 2);
    expect(bars[7].chords[0].chord.symbol).toBe("E7");
    expect(bars[7].chords[0].attack).toBe(false);
  });

  it("transposes chords", () => {
    const bars = buildTimeline(chart, playOrder(chart, 1), -2, 0);
    expect(bars[5].chords[0].chord.symbol).toBe("A7(#5)");
  });
});

describe("schedule", () => {
  it("adds a two-bar count-in that clicks 1, 2, 1 2 3 4", () => {
    const s = buildSchedule(chart, bossa, { choruses: 1, countIn: true, transpose: 0 });
    expect(s.bars.length).toBe(2 + 4 + 32 + 8 + 1);
    expect(s.bars[1].countIn).toBe(true);
    expect(s.beats.slice(0, 8).map((b) => b.click)).toEqual([true, false, true, false, true, true, true, true]);
    expect(s.beats.length).toBe(s.totalBeats);
    expect(s.loop).toBeNull();
  });

  it("starts from a chosen bar", () => {
    const s = buildSchedule(chart, bossa, {
      choruses: 2,
      countIn: true,
      transpose: 0,
      start: { ref: { part: "form", section: 2, bar: 0 }, chorus: 2 },
    });
    expect(s.bars[2].ref).toEqual({ part: "form", section: 2, bar: 0 });
    expect(s.bars[2].chorus).toBe(2);
    expect(s.bars.length).toBe(2 + 16 + 8 + 1);
  });

  it("loops the form after the intro", () => {
    const s = buildSchedule(chart, bossa, { choruses: "loop", countIn: false, transpose: 0 });
    expect(s.bars.length).toBe(4 + 64);
    expect(s.loop).toEqual({ start: (4 + 32) * 4, end: 68 * 4 });
  });

  it("loops one section, starting part way through", () => {
    const s = buildSchedule(chart, bossa, {
      choruses: 3,
      countIn: true,
      transpose: 0,
      loopSection: 2,
      start: { ref: { part: "form", section: 2, bar: 4 }, chorus: 1 },
    });
    expect(s.bars[2].ref).toEqual({ part: "form", section: 2, bar: 4 });
    expect(s.loop).toEqual({ start: (2 + 4) * 4, end: (2 + 4 + 8) * 4 });
  });
});

describe("voicing", () => {
  it("leaves out the root and keeps guide tones", () => {
    expect(pcs(voiceChord(parseChord("Em7"), null)).sort()).toEqual(["B", "D", "F#", "G"]);
    expect(voicingIntervals(parseChord("A7"))).toEqual([4, 9, 10, 2]);
    expect(voicingIntervals(parseChord("B7(#5)"))).toEqual([4, 8, 10, 2]);
    expect(voicingIntervals(parseChord("D"))).toEqual([4, 7, 9, 2]);
  });

  it("stays in range, avoids low clusters, and moves smoothly", () => {
    let prev: number[] | null = null;
    for (const symbol of ["D", "B7(#5)", "E7", "Em7", "A7", "Dmaj7", "Am7", "D7", "G6", "Bm7", "Em7/A", "D6/9"]) {
      const v = voiceChord(parseChord(symbol), prev);
      expect(Math.min(...v)).toBeGreaterThanOrEqual(VOICING_LOW);
      expect(Math.max(...v)).toBeLessThanOrEqual(VOICING_HIGH);
      for (let i = 1; i < v.length; i++) if (v[i - 1] < 55) expect(v[i] - v[i - 1]).toBeGreaterThanOrEqual(3);
      if (prev) expect(v.reduce((s, n, i) => s + Math.abs(n - prev![i]), 0)).toBeLessThanOrEqual(12);
      prev = v;
    }
  });

  it("spreads chords wider than an octave", () => {
    const v = voiceChord(parseChord("Em7"), null);
    expect(v[3] - v[0]).toBeGreaterThan(12);
  });
});

describe("scales", () => {
  it("picks a scale per chord type and spells it", () => {
    expect(chordScale(parseChord("Em7"), "E", 2)).toEqual({ name: "Dorian", notes: ["E", "F♯", "G", "A", "B", "C♯", "D"] });
    expect(chordScale(parseChord("A7"), "A", 2).name).toBe("Mixolydian");
    expect(chordScale(parseChord("B7(#5)"), "B", 2)).toEqual({ name: "Whole tone", notes: ["B", "C♯", "D♯", "F", "G", "A"] });
    expect(chordScale(parseChord("D"), "D", 2).name).toBe("Major");
    expect(chordScale(parseChord("Bb7"), "Bb", 3).notes[0]).toBe("B♭");
  });
});

describe("bossa style", () => {
  const schedule = buildSchedule(chart, bossa, { choruses: 1, countIn: true, transpose: 0 });
  const inBar = (index: number, track: string) =>
    schedule.events.filter((e) => e.track === track && e.time >= index * 4 - 0.1 && e.time < index * 4 + 3.9);

  it("plays nothing in the count-in", () => {
    for (const bar of [0, 1]) for (const t of ["bass", "piano", "guitar", "drums"]) expect(inBar(bar, t).length).toBe(0);
  });

  it("plays root and fifth in the bass", () => {
    const bass = inBar(2, "bass"); // intro bar 1, D
    expect(bass.map((e) => e.time - 8)).toEqual([0, 1.5, 2, 3.5]);
    expect(pcs(bass.map((e) => e.notes![0]))).toEqual(["D", "A", "A", "A"]); // next bar is Em7/A
  });

  it("plays eight hi-hats, 2 and 4 accented, and the clave", () => {
    const drums = inBar(3, "drums");
    const hats = drums.filter((e) => e.drum === "hat");
    expect(hats.length).toBe(8);
    expect(hats[2].velocity).toBeGreaterThan(hats[1].velocity);
    expect(drums.filter((e) => e.drum === "rim").length).toBe(2);
  });

  it("plays guitar on every bar and fills at section ends", () => {
    expect(inBar(3, "guitar").length).toBe(4);
    const endOfA = 2 + 4 + 7; // last bar of the first A
    expect(inBar(endOfA, "drums").some((e) => e.drum === "snare")).toBe(true);
    const endOfForm = 2 + 4 + 31;
    expect(inBar(endOfForm, "drums").filter((e) => e.drum?.startsWith("tom")).length).toBe(4);
    expect(inBar(endOfA + 1, "drums").some((e) => e.drum === "crash")).toBe(true);
  });
});
