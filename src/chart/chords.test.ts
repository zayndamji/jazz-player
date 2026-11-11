import { describe, expect, it } from "vitest";
import { displayParts, isMinorKey, keyPitchClass, parseBar, parseChord, spellingPc, transposeSymbol } from "./chords";
import { FIXTURES } from "../fixtures";

describe("parseChord", () => {
  it("reads roots, qualities and slash basses", () => {
    const c = parseChord("Em7/A");
    expect(c.root).toBe(4);
    expect(c.bass).toBe(9);
    expect(c.intervals).toEqual([0, 3, 7, 10]);
  });

  it("reads altered and sixth chords", () => {
    expect(parseChord("B7(#5)").intervals).toEqual([0, 4, 8, 10]);
    expect(parseChord("G6").intervals).toEqual([0, 4, 7, 9]);
    expect(parseChord("D6/9").intervals).toEqual([0, 4, 7, 9, 14]);
    expect(parseChord("Dmaj7").intervals).toEqual([0, 4, 7, 11]);
    expect(parseChord("D").intervals).toEqual([0, 4, 7]);
    expect(parseChord("Bb7").root).toBe(10);
  });

  it("reads every chord in the test charts", () => {
    const sections = FIXTURES.flatMap((c) => [...(c.intro ? [c.intro] : []), ...c.form, ...(c.ending ?? [])]);
    for (const section of sections) {
      for (const bar of section.bars) {
        for (const slot of parseBar(bar, 4).chords) {
          expect(() => parseChord(slot.symbol)).not.toThrow();
        }
      }
    }
  });
});

describe("parseBar", () => {
  it("splits two chords evenly and marks repeats", () => {
    expect(parseBar("Em7/A A7", 4).chords).toEqual([
      { symbol: "Em7/A", beat: 0 },
      { symbol: "A7", beat: 2 },
    ]);
    expect(parseBar("%", 4).repeat).toBe(true);
  });
});

describe("transposeSymbol", () => {
  it("moves roots and basses and spells for the key", () => {
    expect(transposeSymbol("Em7/A", -2, 0)).toBe("Dm7/G");
    expect(transposeSymbol("B7(#5)", -2, 0)).toBe("A7(#5)");
    expect(transposeSymbol("D", 1, 3)).toBe("Eb");
    expect(transposeSymbol("A7", 1, 3)).toBe("Bb7");
  });
});

describe("displayParts", () => {
  it("uses music symbols", () => {
    expect(displayParts("B7(#5)")).toEqual({ root: "B", quality: "7(♯5)", bass: "" });
    expect(displayParts("Dmaj7")).toEqual({ root: "D", quality: "Δ7", bass: "" });
    expect(displayParts("Bbm7/Eb")).toEqual({ root: "B♭", quality: "m7", bass: "E♭" });
  });
});

describe("bars and keys", () => {
  it("holds a chord through slash beats", () => {
    expect(parseBar("Am7 / / Fmaj7", 4)).toEqual({ repeat: false, chords: [{ symbol: "Am7", beat: 0 }, { symbol: "Fmaj7", beat: 3 }] });
    expect(parseBar("Emaj7 / / Em", 4).chords.map((c) => c.beat)).toEqual([0, 3]);
  });

  it("reads minor keys and spells them like the relative major", () => {
    expect(keyPitchClass("Em")).toBe(4);
    expect(keyPitchClass("Bbm")).toBe(10);
    expect(isMinorKey("Em")).toBe(true);
    expect(isMinorKey("Eb")).toBe(false);
    expect(spellingPc(4, true)).toBe(7); // E minor is spelled like G major
    expect(transposeSymbol("B7", 2, spellingPc(6, true))).toBe("C#7"); // a B-flat part in F# minor
  });
});
