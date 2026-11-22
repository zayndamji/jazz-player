import { describe, expect, it } from "vitest";
import { chordParts } from "./LeadSheet";

describe("chord symbols on the lead sheet", () => {
  it("splits OSMD's text into root, quality and bass, as the chart prints them", () => {
    expect(chordParts("CΔ7")).toEqual({ root: "C", quality: "Δ7", bass: "" });
    expect(chordParts("Bbm7(b5)/Ab")).toEqual({ root: "B♭", quality: "m7(♭5)", bass: "A♭" });
    expect(chordParts("A♭7(♯5)/G♭")).toEqual({ root: "A♭", quality: "7(♯5)", bass: "G♭" });
    expect(chordParts("F#m11/E")).toEqual({ root: "F♯", quality: "m11", bass: "E" });
    expect(chordParts("C/G")).toEqual({ root: "C", quality: "", bass: "G" });
    expect(chordParts("Ebsus4")).toEqual({ root: "E♭", quality: "sus4", bass: "" });
  });
});
