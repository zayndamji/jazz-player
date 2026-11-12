import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { swingForm } from "../fixtures";
import { STYLES } from "../styles";
import { parseMelody } from "./melody";
import { buildSchedule } from "./schedule";

const xml = readFileSync(fileURLToPath(new URL("../fixtures/swing-head.musicxml", import.meta.url)), "utf8");
const measures = parseMelody(xml);
const swing = STYLES.swing;
const head = { mode: "head" as const, measures };
const every = { mode: "every" as const, measures };
const base = { countIn: false, transpose: 0, melody: head };
const melodyOf = (s: ReturnType<typeof buildSchedule>) => s.events.filter((e) => e.track === "melody");

describe("parseMelody", () => {
  it("reads one list of notes per printed measure and skips rests", () => {
    expect(measures.length).toBe(12);
    expect(measures.slice(0, 4).every((m) => m.length === 0)).toBe(true);
    expect(measures[4]).toEqual([
      { midi: 72, start: 0, length: 1 },
      { midi: 76, start: 1, length: 1 },
      { midi: 79, start: 2, length: 3 },
    ]);
  });

  it("merges a tie over the barline into the first note", () => {
    expect(measures[4].at(-1)).toMatchObject({ midi: 79, length: 3 });
    expect(measures[5].some((n) => n.midi === 79)).toBe(false);
  });

  it("keeps a triplet's own length and places it after the rest", () => {
    expect(measures[5].map((n) => n.midi)).toEqual([74, 76, 77]);
    expect(measures[5].map((n) => n.start)).toEqual([expect.closeTo(2), expect.closeTo(2 + 2 / 3), expect.closeTo(2 + 4 / 3)]);
    expect(measures[5][0].length).toBeCloseTo(2 / 3);
  });

  it("resolves accidentals and plays chord notes at the same start", () => {
    expect(measures[6]).toEqual([
      { midi: 74, start: 0, length: 2 },
      { midi: 78, start: 0, length: 2 },
      { midi: 70, start: 2, length: 2 },
    ]);
  });

  it("plays voice 1 only", () => {
    expect(measures[7]).toEqual([{ midi: 72, start: 0, length: 4 }]);
  });

  it("converts a transposing part to concert pitch", () => {
    // A B-flat part: written C5 sounds B-flat 4 (two half steps down).
    const flat = xml.replace("</attributes>", "<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>");
    expect(parseMelody(flat)[4][0].midi).toBe(70);
    const octave = xml.replace("</attributes>", "<transpose><chromatic>0</chromatic><octave-change>-1</octave-change></transpose></attributes>");
    expect(parseMelody(octave)[4][0].midi).toBe(60);
  });
});

describe("melody on the timeline", () => {
  // swing-form: intro bars 1-4, then A (5-12), A (13-20), B, A, coda. Notes are printed for bars 5-12 only.
  it("takes the notes of the printed measure each playing bar is numbered as", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: 1, ending: false });
    expect(melodyOf(s).filter((e) => e.time < 16)).toEqual([]); // the intro measures are rests
    const bar5 = melodyOf(s).filter((e) => e.time >= 16 && e.time < 20);
    expect(bar5.map((e) => [e.notes![0], e.time - 16])).toEqual([
      [72, 0],
      [76, 1],
      [79, 2],
    ]);
    // The tie holds into the next bar, which is the next printed measure.
    expect(bar5.at(-1)!.duration).toBeCloseTo(3.05);
  });

  it("stops a tied note at the end of its bar when the next bar isn't the next measure", () => {
    const bar = { part: "form" as const, section: 0, bar: 0 };
    const s = buildSchedule(swingForm, swing, { ...base, melody: every, choruses: 1, loopRange: { from: bar, to: bar } });
    const tied = melodyOf(s).find((e) => e.notes![0] === 79)!;
    expect(tied.duration).toBeCloseTo(2.05);
  });

  it("uses each bar's own key", () => {
    const up = buildSchedule(swingForm, swing, { ...base, transpose: 2, choruses: 1, ending: false });
    expect(melodyOf(up)[0].notes![0]).toBe(74);
    // Chorus 2 is a half step above chorus 1; its first printed notes are the ones of bar 5 again, so use every-chorus mode.
    const keyed = buildSchedule(swingForm, swing, { ...base, melody: every, keyStep: 1, choruses: 2, intro: false, ending: false });
    const inChorus2 = melodyOf(keyed).filter((e) => e.time >= 32 * 4);
    // Chorus 2's first bar is chart bar 5 + 0 again, which has the same printed notes a half step higher.
    expect(inChorus2[0].notes![0]).toBe(73);
  });

  it("plays nothing in a solo chorus, and the last chorus is a head when the song ends", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: 3, intro: false, ending: false });
    const chorus = (c: number) => melodyOf(s).filter((e) => e.time >= (c - 1) * 32 * 4 && e.time < c * 32 * 4);
    expect(chorus(1).length).toBeGreaterThan(0);
    expect(chorus(2)).toEqual([]);
    expect(chorus(3).length).toBeGreaterThan(0);
  });

  it("plays only the first chorus when the choruses repeat until stopped", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: "loop", intro: false });
    expect(melodyOf(s).filter((e) => e.time < 32 * 4).length).toBeGreaterThan(0);
    expect(melodyOf(s).filter((e) => e.time >= 32 * 4)).toEqual([]);
  });

  it("plays every chorus when asked", () => {
    const s = buildSchedule(swingForm, swing, { ...base, melody: every, choruses: 3, intro: false, ending: false });
    expect(melodyOf(s).some((e) => e.time >= 32 * 4 && e.time < 64 * 4)).toBe(true);
  });

  it("is off by default and lists the melody in the band only when it plays", () => {
    const s = buildSchedule(swingForm, swing, { countIn: false, transpose: 0, choruses: 1 });
    expect(melodyOf(s)).toEqual([]);
    expect(s.band).not.toContain("melody");
    expect(buildSchedule(swingForm, swing, { ...base, choruses: 1 }).band).toContain("melody");
    expect(melodyOf(buildSchedule(swingForm, swing, { ...base, choruses: 1, melody: { mode: "off", measures } }))).toEqual([]);
  });

  it("stays out of a looped section in head mode", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: 1, loopSection: 0 });
    expect(melodyOf(s)).toEqual([]);
  });

  it("stays silent on the drums' turns when trading", () => {
    const s = buildSchedule(swingForm, swing, { ...base, melody: every, choruses: 3, intro: false, ending: false, trade: "fours" });
    // Chorus 2 bars 4 to 7 (the first A's bars 5 to 8) are the drums' four: no melody there.
    const drums = melodyOf(s).filter((e) => e.time >= (32 + 4) * 4 && e.time < (32 + 8) * 4);
    expect(drums).toEqual([]);
  });
});
