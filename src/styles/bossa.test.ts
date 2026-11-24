import { describe, expect, it } from "vitest";
import type { Chart } from "../chart/types";
import { bossaForm } from "../fixtures";
import { buildSchedule, type Schedule } from "../engine/schedule";
import type { NoteEvent } from "./types";
import { bossa } from "./bossa";
import { chordAfter } from "./context";

/** A made-up minor bossa with half-diminished chords and a last bar of two chords. */
const minorBossa: Chart = {
  id: "minor-bossa-test",
  title: "Minor bossa (test)",
  key: "Cm",
  tempo: 150,
  beatsPerBar: 4,
  style: "bossa",
  form: [
    { label: "A", bars: ["Cm7", "%", "Fm7", "%", "Dm7b5", "G7", "Cm7", "%"] },
    { label: "A", bars: ["Ebm7", "Ab7", "Dbmaj7", "%", "Dm7b5", "G7(b9)", "Cm7", "Dm7b5 G7"] },
  ],
  ending: [{ label: "End", bars: ["Dm7b5 G7", "Ab7 Cm7"] }],
};

const take = (chart: Chart, transpose: number) => buildSchedule(chart, bossa, { choruses: 4, countIn: false, transpose });
const track = (s: Schedule, name: string) => s.events.filter((e) => e.track === name);
const barOf = (s: Schedule, e: NoteEvent) => s.bars.find((b) => e.time >= b.startBeat - 0.1 && e.time < b.startBeat + 3.9);
const chordUnder = (s: Schedule, e: NoteEvent) => {
  const bar = barOf(s, e);
  return bar?.chords.filter((c) => c.beat <= e.time - bar.startBeat + 0.1).at(-1)?.chord;
};

describe("bossa style", () => {
  it("keeps every bass leap within an octave", () => {
    for (const chart of [bossaForm, minorBossa])
      for (let transpose = -5; transpose <= 6; transpose++) {
        const bass = track(take(chart, transpose), "bass").map((e) => e.notes![0]);
        for (let k = 1; k < bass.length; k++) expect(Math.abs(bass[k] - bass[k - 1])).toBeLessThanOrEqual(12);
      }
  });

  it("never plays the flat 9th over a half-diminished chord's root", () => {
    for (let transpose = -5; transpose <= 6; transpose++) {
      const s = take(minorBossa, transpose);
      for (const e of track(s, "bass")) {
        const chord = chordUnder(s, e);
        if (!chord?.intervalNames.includes("5d") || !chord.intervalNames.includes("3m")) continue;
        expect((e.notes![0] - chord.root + 120) % 12).not.toBe(1);
      }
    }
  });

  it("keeps the piano and the guitar's chords a minor third clear of the bass", () => {
    for (const chart of [bossaForm, minorBossa])
      for (let transpose = -5; transpose <= 6; transpose++) {
        const s = take(chart, transpose);
        const bass = track(s, "bass");
        for (const e of [...track(s, "piano"), ...track(s, "guitar").filter((g) => g.notes!.length > 1)])
          for (const b of bass)
            if (b.time < e.time + e.duration - 0.1 && b.time + b.duration > e.time + 0.1) expect(Math.min(...e.notes!)).toBeGreaterThan(b.notes![0] + 2);
      }
  });

  it("plucks the guitar's chords as three-note grips, together, with the top note under A4", () => {
    for (const chart of [bossaForm, minorBossa])
      for (let transpose = -5; transpose <= 6; transpose++) {
        const chords = track(take(chart, transpose), "guitar").filter((g) => g.notes!.length > 1);
        expect(chords.length).toBeGreaterThan(0);
        for (const e of chords) {
          const n = e.notes!;
          expect(n).toHaveLength(3);
          expect(Math.max(...n)).toBeLessThanOrEqual(69);
          expect(Math.min(...n)).toBeGreaterThanOrEqual(50);
          // One note per string: never a half step between neighbours, and seconds only at the top.
          for (let k = 1; k < n.length; k++) expect(n[k] - n[k - 1]).toBeGreaterThan(k === n.length - 1 ? 1 : 2);
          // A pinch, not a strum: every note within 6 ms.
          expect(Math.max(...e.offsets!)).toBeLessThanOrEqual(0.006);
        }
      }
  });

  it("plays the guitar's thumb on 1 and 3, on the bass's note (root or fifth)", () => {
    for (let transpose = -5; transpose <= 6; transpose++) {
      const s = take(minorBossa, transpose);
      const bass = track(s, "bass");
      const thumbs = track(s, "guitar").filter((g) => g.notes!.length === 1);
      expect(thumbs.length).toBeGreaterThan(0);
      for (const e of thumbs) {
        const bar = barOf(s, e)!;
        const beat = e.time - bar.startBeat;
        expect(Math.min(Math.abs(beat), Math.abs(beat - 2))).toBeLessThan(0.1);
        const struck = bass.filter((b) => b.time <= e.time + 0.1).at(-1)!;
        const chord = chordUnder(s, e)!;
        const pc = e.notes![0] % 12;
        expect(pc === struck.notes![0] % 12 || pc === chord.bass).toBe(true);
      }
    }
  });

  it("plays each chord of the last bar and holds the last one", () => {
    const s = take(minorBossa, 0);
    const last = s.bars.at(-1)!;
    expect(last.final).toBe(true);
    const at = (name: string) => track(s, name).filter((e) => e.time >= last.startBeat - 0.05);
    const pcs = (e: NoteEvent) => e.notes!.map((n) => n % 12);
    const [ab7, cm7] = at("piano");
    expect(ab7.time).toBeCloseTo(last.startBeat);
    expect(cm7.time).toBeCloseTo(last.startBeat + 2);
    expect(pcs(cm7)).toContain(3); // Eb, the minor third: the last chord is Cm7, not Ab7
    expect(cm7.duration).toBeGreaterThanOrEqual(4);
    expect(at("bass").map((e) => e.notes![0] % 12)).toEqual([8, 0]);
    expect(at("guitar")).toHaveLength(2);
  });

  it("voices a dominant resolving to minor with the flat 9th and flat 13th", () => {
    const s = take(minorBossa, 0);
    const g7 = track(s, "piano").filter((e) => {
      const bar = barOf(s, e)!;
      const beat = e.time - bar.startBeat;
      return chordUnder(s, e)?.symbol === "G7" && beat < 3.4 && chordAfter(s.bars, bar.index, beat)?.symbol === "Cm7";
    });
    expect(g7.length).toBeGreaterThan(0);
    for (const e of g7) expect(e.notes!.map((n) => n % 12)).toEqual(expect.arrayContaining([8, 3])); // Ab and Eb
  });

  it("keeps the bass's second note off a half step under or over the comping (no natural 5th under a b13 or #11)", () => {
    // A7 into Dm7 and G7 into Cm7 voice the b13; G7(#5) the #5. The bass then plays the root again, not the 5th.
    for (const chart of [bossaForm, minorBossa])
      for (let transpose = -5; transpose <= 6; transpose++) {
        const s = take(chart, transpose);
        const comping = [...track(s, "piano"), ...track(s, "guitar")];
        for (const b of track(s, "bass")) {
          const bar = barOf(s, b);
          const beat = b.time - (bar?.startBeat ?? 0);
          if (!bar || Math.abs(beat - Math.round(beat)) > 0.1) continue; // the eighths anticipate the next note
          const chord = chordUnder(s, b)!;
          const pc = b.notes![0] % 12;
          if (pc === chord.root || pc === chord.bass) continue;
          for (const e of comping)
            if (e.time < b.time + b.duration - 0.05 && e.time + e.duration > b.time + 0.05)
              for (const n of e.notes!) expect([1, 11]).not.toContain((((n - pc) % 12) + 12) % 12);
        }
      }
  });
});
