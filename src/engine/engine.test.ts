import { describe, expect, it } from "vitest";
import { parseChord } from "../chart/chords";
import { exampleTune } from "../charts/example-tune";
import { bossa } from "../styles/bossa";
import { buildSchedule } from "./schedule";
import { buildTimeline } from "./timeline";
import { VOICING_HIGH, VOICING_LOW, voiceChord, voicingIntervals } from "./voicing";

const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pcs = (notes: number[]) => notes.map((n) => names[n % 12]);

describe("buildTimeline", () => {
  it("plays count-in, intro, each chorus and the ending", () => {
    const bars = buildTimeline(exampleTune, { choruses: 2, countInBars: 1, transpose: 0, keyPc: 2 });
    expect(bars.length).toBe(1 + 4 + 32 * 2 + 1);
    expect(bars[0].countIn).toBe(true);
    expect(bars[5].chords[0].chord.symbol).toBe("D");
    expect(bars[5].chorus).toBe(1);
    expect(bars[37].chorus).toBe(2);
    expect(bars.at(-1)!.final).toBe(true);
  });

  it("carries a chord through a repeat bar without a new attack", () => {
    const bars = buildTimeline(exampleTune, { choruses: 1, countInBars: 0, transpose: 0, keyPc: 2 });
    const repeat = bars[4 + 3]; // A section bar 4
    expect(repeat.chords[0].chord.symbol).toBe("E7");
    expect(repeat.chords[0].attack).toBe(false);
  });

  it("transposes chords", () => {
    const bars = buildTimeline(exampleTune, { choruses: 1, countInBars: 0, transpose: -2, keyPc: 0 });
    expect(bars[5].chords[0].chord.symbol).toBe("A7(#5)");
  });
});

describe("voicing", () => {
  it("leaves out the root and keeps guide tones", () => {
    expect(pcs(voiceChord(parseChord("Em7"), null)).sort()).toEqual(["B", "D", "F#", "G"]);
    expect(voicingIntervals(parseChord("A7"))).toEqual([4, 9, 10, 2]);
    expect(voicingIntervals(parseChord("B7(#5)"))).toEqual([4, 8, 10, 2]);
    expect(voicingIntervals(parseChord("D"))).toEqual([4, 7, 9, 2]);
  });

  it("stays in range and moves smoothly", () => {
    let prev: number[] | null = null;
    for (const symbol of ["D", "B7(#5)", "E7", "Em7", "A7", "Dmaj7", "Am7", "D7", "G6", "Bm7"]) {
      const v = voiceChord(parseChord(symbol), prev);
      expect(Math.min(...v)).toBeGreaterThanOrEqual(VOICING_LOW);
      expect(Math.max(...v)).toBeLessThanOrEqual(VOICING_HIGH);
      if (prev) expect(v.reduce((s, n, i) => s + Math.abs(n - prev![i]), 0)).toBeLessThanOrEqual(10);
      prev = v;
    }
  });
});

describe("bossa style", () => {
  const schedule = buildSchedule(exampleTune, bossa, { choruses: 1, countIn: true, transpose: 0 });
  const inBar = (index: number, track: string) =>
    schedule.events.filter((e) => e.track === track && e.time >= index * 4 - 0.1 && e.time < index * 4 + 3.9);

  it("plays nothing in the count-in bar", () => {
    expect(inBar(0, "bass").length + inBar(0, "piano").length + inBar(0, "drums").length).toBe(0);
  });

  it("plays root and fifth in the bass", () => {
    const bass = inBar(1, "bass"); // intro bar 1, D
    expect(bass.map((e) => e.time - 4)).toEqual([0, 1.5, 2, 3.5]);
    expect(pcs(bass.map((e) => e.notes![0]))).toEqual(["D", "A", "A", "A"]); // next bar is Em7/A
  });

  it("plays eight hi-hats and the clave in each bar", () => {
    const drums = inBar(2, "drums");
    expect(drums.filter((e) => e.drum === "hat").length).toBe(8);
    expect(drums.filter((e) => e.drum === "rim").length).toBe(2);
  });

  it("has beat marks for every bar", () => {
    expect(schedule.beats.length).toBe(schedule.totalBeats);
    expect(schedule.beats[0].countIn).toBe(true);
  });
});
