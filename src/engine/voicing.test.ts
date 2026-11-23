import { describe, expect, it } from "vitest";
import { parseChord } from "../chart/chords";
import { GUITAR_RANGE, PIANO_RANGE, SWING_RANGE, voiceChord, voicingIntervals, voicingOptions } from "./voicing";

const chord = parseChord;
/** Semitones above the root of each voiced note, as a sorted set. */
const degrees = (symbol: string, notes: number[]) => {
  const root = chord(symbol).root;
  return [...new Set(notes.map((n) => (n - root + 120) % 12))].sort((a, b) => a - b);
};
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

describe("voicingIntervals", () => {
  it("voices a dominant into a minor chord with b9 and b13", () => {
    expect(voicingIntervals(chord("A7"), chord("Dm7"))).toEqual([4, 8, 10, 1]);
    expect(voicingIntervals(chord("A7"), chord("Dm"))).toEqual([4, 8, 10, 1]);
    // Into major, or with no next chord, it keeps 13 and 9.
    expect(voicingIntervals(chord("A7"), chord("Dmaj7"))).toEqual([4, 9, 10, 2]);
    expect(voicingIntervals(chord("A7"))).toEqual([4, 9, 10, 2]);
    // Not a fifth down: no change.
    expect(voicingIntervals(chord("A7"), chord("Bm7"))).toEqual([4, 9, 10, 2]);
  });

  it("adds the b13 to a written b9 heard in a minor key, and keeps the 13 into major", () => {
    expect(voicingIntervals(chord("G7b9"), chord("Cm7"))).toEqual([4, 8, 10, 1]);
    expect(voicingIntervals(chord("D7(b9)"), chord("Gm7b5"))).toEqual([4, 8, 10, 1]);
    expect(voicingIntervals(chord("Bb7(b9)"), chord("Ebmaj7"))).toEqual([4, 9, 10, 1]);
    expect(voicingIntervals(chord("G7b9"))).toEqual([4, 9, 10, 1]);
  });

  it("voices a deceptive V7 to VI (up a half step to major) with b9 and b13", () => {
    expect(voicingIntervals(chord("G7"), chord("Abmaj7"))).toEqual([4, 8, 10, 1]);
    expect(voicingIntervals(chord("G7"), chord("Ab"))).toEqual([4, 8, 10, 1]);
    // Up a half step to a dominant (a chromatic chain) or a minor chord: no change.
    expect(voicingIntervals(chord("G7"), chord("Ab7"))).toEqual([4, 9, 10, 2]);
    expect(voicingIntervals(chord("G7"), chord("Abm7"))).toEqual([4, 9, 10, 2]);
    expect(voicingIntervals(chord("G13"), chord("Abmaj7"))).toContain(9);
  });

  it("lets written tensions win over the minor resolution", () => {
    expect(voicingIntervals(chord("A9"), chord("Dm7"))).toEqual([4, 9, 10, 2]);
    expect(voicingIntervals(chord("A13"), chord("Dm7"))).toContain(9);
    expect(voicingIntervals(chord("A7#9"), chord("Dm7"))).toEqual([4, 8, 10, 3]);
    expect(voicingIntervals(chord("A7sus4"), chord("Dm7"))).not.toContain(4);
  });

  it("voices diminished chords as diminished, half-diminished as before", () => {
    expect(sorted(voicingIntervals(chord("Bdim")))).toEqual([2, 3, 6, 9]);
    expect(sorted(voicingIntervals(chord("Bo")))).toEqual([2, 3, 6, 9]);
    expect(sorted(voicingIntervals(chord("Bdim7")))).toEqual([2, 3, 6, 9]);
    expect(voicingIntervals(chord("Bdim"))).not.toContain(10);
    expect(voicingIntervals(chord("Bm7b5"))).toEqual([3, 6, 10, 0]);
  });

  it("voices an 11 chord as a sus chord with no 3rd", () => {
    const iv = voicingIntervals(chord("F11"));
    expect(iv).not.toContain(4);
    expect(sorted(iv)).toEqual([2, 5, 7, 10]);
    expect(voicingIntervals(chord("F13sus4"))).toEqual([5, 9, 10, 2]);
  });

  it("voices the #11", () => {
    expect(voicingIntervals(chord("Eb7#11"))).toEqual([4, 6, 10, 2]);
    expect(voicingIntervals(chord("Eb7(#11)"))).toContain(6);
    expect(voicingIntervals(chord("Abmaj7#11"))).toEqual([4, 6, 11, 2]);
    // With a written 13 the #11 takes the 9th's place.
    expect(sorted(voicingIntervals(chord("Eb13#11")))).toEqual([4, 6, 9, 10]);
  });

  it("voices #9 with the b13 unless a 13 is written", () => {
    expect(voicingIntervals(chord("D7#9"))).toEqual([4, 8, 10, 3]);
    expect(voicingIntervals(chord("D7alt"))).toEqual([4, 8, 10, 3]);
    expect(voicingIntervals(chord("D13#9"))).toEqual([4, 9, 10, 3]);
    // b9 alone keeps the natural 13 (half-whole).
    expect(voicingIntervals(chord("D7b9"))).toEqual([4, 9, 10, 1]);
  });

  it("voices a minor triad without the b7, so a line cliché moves one voice", () => {
    const cliche = ["Bm", "BmMaj7", "Bm7", "Bm6"].map((s) => voicingIntervals(chord(s)));
    expect(cliche[0]).not.toContain(10);
    expect(cliche.map((iv) => iv[2])).toEqual([0, 11, 10, 9]);
    for (const iv of cliche) expect([iv[0], iv[1], iv[3]]).toEqual([3, 7, 2]);
    expect(voicingIntervals(chord("B-"))).toEqual(cliche[0]);
  });

  it("keeps the existing voicings", () => {
    expect(voicingIntervals(chord("A7"))).toEqual([4, 9, 10, 2]);
    expect(voicingIntervals(chord("B7(#5)"))).toEqual([4, 8, 10, 2]);
    expect(voicingIntervals(chord("D"))).toEqual([4, 7, 9, 2]);
    expect(voicingIntervals(chord("Em7"))).toEqual([3, 7, 10, 2]);
    expect(voicingIntervals(chord("Dmaj7"))).toEqual([4, 7, 11, 2]);
    expect(voicingIntervals(chord("G6"))).toEqual([4, 7, 9, 2]);
  });
});

describe("voiceChord", () => {
  it("passes the next chord through", () => {
    const v = voiceChord(chord("A7"), null, PIANO_RANGE, { next: chord("Dm7") });
    expect(degrees("A7", v)).toEqual([1, 4, 8, 10]);
  });

  it("keeps the top voice under a ceiling, or as low as it can", () => {
    for (const symbol of ["Dm7", "G7", "Cmaj7", "Fdim7", "Bb"]) {
      const free = voiceChord(chord(symbol), null);
      const ceiling = Math.max(...free) - 3;
      const v = voiceChord(chord(symbol), null, PIANO_RANGE, { ceiling });
      expect(Math.max(...v), symbol).toBeLessThanOrEqual(ceiling);
      expect(degrees(symbol, v)).toEqual(degrees(symbol, free));
    }
    // Nothing fits under C3: the lowest-topped option.
    const low = voiceChord(chord("Dm7"), null, PIANO_RANGE, { ceiling: 40 });
    const guides = [5, 0]; // F and C
    const tops = voicingOptions([5, 9, 0, 4])
      .filter((o) => o.notes[0] >= 52 || guides.includes(o.notes[0] % 12))
      .map((o) => o.notes[o.notes.length - 1]);
    expect(Math.max(...low)).toBe(Math.min(...tops));
  });

  it("stays a minor third above the bass and keeps 9ths and 13ths out of the low register", () => {
    for (const range of [PIANO_RANGE, SWING_RANGE, GUITAR_RANGE]) {
      let prev: number[] | null = null;
      for (const [symbol, bass] of [["Cm7", 46], ["F7", 41], ["Bbmaj7", 46], ["Eb6", 51], ["Am7b5", 45], ["D7b9", 50], ["Gm", 43]] as const) {
        const c = chord(symbol);
        const v = voiceChord(c, prev, range, { bass });
        expect(v[0], symbol).toBeGreaterThanOrEqual(bass + 3);
        const bottom = (v[0] - c.root + 120) % 12;
        if (v[0] < 52) expect([3, 4, 9, 10, 11], symbol).toContain(bottom);
        prev = v;
      }
    }
  });

  it("never puts a 9th or 13th at the bottom below E3, even without a bass note", () => {
    let prev: number[] | null = null;
    for (const symbol of ["Cm7", "F9", "Bbmaj7", "Ebmaj7", "Am7b5", "D7", "Gm7", "C7", "Fm7", "Bb7", "Eb6", "Ab7"]) {
      const c = chord(symbol);
      const v = voiceChord(c, prev);
      const bottom = (v[0] - c.root + 120) % 12;
      if (v[0] < 52) expect([3, 4, 9, 10, 11], symbol).toContain(bottom);
      prev = v;
    }
  });

  it("moves one voice by half steps through a line cliché", () => {
    for (const range of [PIANO_RANGE, SWING_RANGE]) {
      let prev = voiceChord(chord("Dm"), null, range);
      for (const symbol of ["DmMaj7", "Dm7", "Dm6"]) {
        const v = voiceChord(chord(symbol), prev, range);
        const moves = v.map((n, i) => n - prev[i]).filter((d) => d !== 0);
        expect(moves, symbol).toEqual([-1]);
        prev = v;
      }
    }
  });

  it("works unchanged without a context and stays deterministic", () => {
    const a = voiceChord(chord("Em7"), null);
    expect(voiceChord(chord("Em7"), null, PIANO_RANGE, {})).toEqual(a);
    expect(voiceChord(chord("Em7"), null)).toEqual(a);
  });
});
