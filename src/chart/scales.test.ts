import { describe, expect, it } from "vitest";
import { parseChord } from "./chords";
import { chordScale, scaleIntervals, scaleKind } from "./scales";

const c = parseChord;

describe("scaleKind", () => {
  it("gives Phrygian dominant to a dominant resolving to minor", () => {
    expect(scaleKind(c("A7"), c("Dm7"))).toBe("phrygianDominant");
    expect(scaleKind(c("A7b9"), c("Dm"))).toBe("phrygianDominant");
    expect(scaleKind(c("A7"), c("Dmaj7"))).toBe("mixolydian");
    expect(scaleKind(c("A7"))).toBe("mixolydian");
    expect(scaleKind(c("A13"), c("Dm7"))).toBe("mixolydian");
    expect(scaleIntervals(c("A7"), c("Dm7"))).toEqual([0, 1, 4, 5, 7, 8, 10]);
  });

  it("gives Lydian dominant to 7#11", () => {
    expect(scaleKind(c("Eb7#11"))).toBe("lydianDominant");
    expect(scaleKind(c("Eb9#11"))).toBe("lydianDominant");
    expect(scaleIntervals(c("Eb7#11"))).toEqual([0, 2, 4, 6, 7, 9, 10]);
    expect(scaleKind(c("Abmaj7#11"))).toBe("lydian");
  });

  it("gives whole-half to diminished chords", () => {
    expect(scaleKind(c("F#dim7"))).toBe("wholeHalf");
    expect(scaleKind(c("F#dim"))).toBe("wholeHalf");
    expect(scaleKind(c("F#m7b5"))).toBe("locrian2");
  });

  it("gives Mixolydian to sus and 11 chords", () => {
    expect(scaleKind(c("G7sus4"))).toBe("mixolydian");
    expect(scaleKind(c("Gsus4"))).toBe("mixolydian");
    expect(scaleKind(c("G11"))).toBe("mixolydian");
  });

  it("gives the altered scale to 7#9, half-whole to 7b9", () => {
    expect(scaleKind(c("D7#9"))).toBe("altered");
    expect(scaleKind(c("D13#9"))).toBe("halfWhole");
    expect(scaleKind(c("D7b9"))).toBe("halfWhole");
  });
});

describe("chordScale", () => {
  it("names and spells the new scales", () => {
    expect(chordScale(c("A7"), "A", 2, c("Dm7"))).toEqual({ name: "Phrygian dominant", notes: ["A", "B♭", "C♯", "D", "E", "F", "G"] });
    expect(chordScale(c("Bb7#11"), "Bb", 3)).toEqual({ name: "Lydian dominant", notes: ["B♭", "C", "D", "E", "F", "G", "A♭"] });
    // The three-argument call is unchanged.
    expect(chordScale(c("A7"), "A", 2).name).toBe("Mixolydian");
  });
});
