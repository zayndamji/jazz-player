import { describe, expect, it } from "vitest";
import { displayParts, isMinorKey, keyPitchClass, minorKeyDominant, minorKeyTensions, parseBar, parseChord, resolvesToMinor, spellingPc, transposeSymbol } from "./chords";
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

  it("reads minor-major and flat-13 chords", () => {
    expect(parseChord("AmMaj7").intervals).toEqual([0, 3, 7, 11]);
    expect(parseChord("E7(b13)").intervals).toContain(20);
    expect(parseChord("E7b13").intervals).toContain(20);
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

  it("reads lead-sheet spellings tonal doesn't", () => {
    const iv = (s: string) => parseChord(s).intervals;
    expect(iv("Fø7")).toEqual([0, 3, 6, 10]);
    expect(iv("Fø")).toEqual([0, 3, 6, 10]);
    expect(iv("F°7")).toEqual([0, 3, 6, 9]);
    expect(iv("G7+5")).toEqual([0, 4, 8, 10]);
    expect(iv("G7-9")).toEqual([0, 4, 7, 10, 13]);
    expect(iv("G7(b9,b13)")).toEqual([0, 4, 7, 10, 13, 20]);
    expect(iv("G7(#5,#9)")).toEqual([0, 4, 8, 10, 15]);
    expect(iv("Dm(maj7)")).toEqual([0, 3, 7, 11]);
    expect(iv("D-^7")).toEqual([0, 3, 7, 11]);
    expect(iv("DmM7")).toEqual([0, 3, 7, 11]);
    expect(iv("Eb^7")).toEqual([0, 4, 7, 11]);
    expect(iv("EbMA7")).toEqual([0, 4, 7, 11]);
    expect(iv("Dmin7")).toEqual([0, 3, 7, 10]);
    expect(iv("Dm7b9")).toEqual([0, 3, 7, 10, 13]);
    expect(iv("G7#11b9")).toEqual([0, 4, 7, 10, 13, 18]);
    expect(iv("G7sus2")).toEqual([0, 2, 7, 10]);
    expect(iv("Galt")).toEqual(iv("G7alt"));
    expect(iv("Fø9")).toEqual([0, 3, 6, 10, 14]);
    expect(iv("Dm6/9")).toEqual([0, 3, 7, 9, 14]);
  });

  it("reads every quality the iReal importer and the charts write", () => {
    const qualities = [
      "", "m", "6", "7", "9", "11", "13", "69", "m6", "m69", "m7", "m9", "m11", "m7b5", "dim", "dim7", "aug", "mMaj7",
      "maj7", "maj9", "maj13", "maj7#11", "7b9", "7#9", "7b5", "7#5", "7#11", "7b13", "7b9#9", "7alt", "7sus4", "9sus4",
      "sus4", "sus2", "5", "7(#11)", "7(#5)", "7(b9)", "7(b13)", "h7", "o", "o7", "+", "+7", "ø7", "-", "-7", "-^7", "^7",
    ];
    for (const q of qualities) expect(() => parseChord("C" + q), q).not.toThrow();
  });

  it("still refuses what it can't read", () => {
    expect(() => parseChord("Cxyz")).toThrow(/Unknown chord quality/);
  });
});

describe("minorKeyDominant", () => {
  it("is a resolution down a fifth to minor or a deceptive move up a half step to major", () => {
    expect(minorKeyDominant(parseChord("G7b9"), parseChord("Cm7"))).toBe(true);
    expect(minorKeyDominant(parseChord("G7"), parseChord("Abmaj7"))).toBe(true);
    expect(minorKeyDominant(parseChord("G7"), parseChord("Ab7"))).toBe(false);
    expect(minorKeyDominant(parseChord("G7"), parseChord("Cmaj7"))).toBe(false);
    expect(minorKeyDominant(parseChord("Gm7"), parseChord("Abmaj7"))).toBe(false);
    expect(minorKeyDominant(parseChord("G7"), null)).toBe(false);
  });
});

describe("resolvesToMinor", () => {
  it("is true for a dominant going down a fifth to a minor chord", () => {
    expect(resolvesToMinor(parseChord("A7"), parseChord("Dm7"))).toBe(true);
    expect(resolvesToMinor(parseChord("E7b9"), parseChord("Am"))).toBe(true);
    expect(resolvesToMinor(parseChord("A7"), parseChord("Dmaj7"))).toBe(false);
    expect(resolvesToMinor(parseChord("A7"), parseChord("Em7"))).toBe(false);
    expect(resolvesToMinor(parseChord("Am7"), parseChord("Dm7"))).toBe(false);
    expect(resolvesToMinor(parseChord("A7"), null)).toBe(false);
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

describe("minorKeyTensions", () => {
  const inKey = (symbol: string, key: number) => ({ ...parseChord(symbol), key });
  it("keeps the flat 9 and flat 13 into the tonic minor, and into iii or vi of a major key", () => {
    expect(minorKeyTensions(inKey("G7", 3), inKey("Cm7", 3))).toEqual({ ninth: 1, thirteenth: 8 }); // C minor
    expect(minorKeyTensions(inKey("E7", 0), inKey("Am7", 0))).toEqual({ ninth: 1, thirteenth: 8 }); // vi in C
    expect(minorKeyTensions(inKey("B7", 0), inKey("Em7", 0))).toEqual({ ninth: 1, thirteenth: 8 }); // iii in C
  });

  it("takes the natural 9 with the flat 13 into ii of a major key (Mixolydian b13)", () => {
    expect(minorKeyTensions(inKey("D7", 5), inKey("Gm7", 5))).toEqual({ ninth: 2, thirteenth: 8 }); // F major
    expect(minorKeyTensions(inKey("A7", 0), inKey("Dm7", 0))).toEqual({ ninth: 2, thirteenth: 8 }); // C major
  });

  it("keeps the flat 9 and flat 13 without a key, into a borrowed minor chord, or deceptively", () => {
    expect(minorKeyTensions(parseChord("D7"), parseChord("Gm7"))).toEqual({ ninth: 1, thirteenth: 8 });
    expect(minorKeyTensions(inKey("A7", 2), inKey("Dm7", 2))).toEqual({ ninth: 1, thirteenth: 8 }); // Dm7 borrowed in D major
    expect(minorKeyTensions(inKey("G7", 3), inKey("Abmaj7", 3))).toEqual({ ninth: 1, thirteenth: 8 });
  });
});
