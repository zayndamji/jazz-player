import { describe, expect, it } from "vitest";
import { noteToMidi, pickSample, voiceSpan } from "./sprite";
import sprites from "./sprites.json";

describe("pickSample", () => {
  const sampled = [57, 60, 63, 66];

  it("takes the nearest sampled note", () => {
    expect(pickSample(61, sampled).midi).toBe(60);
    expect(pickSample(62, sampled).midi).toBe(63);
    expect(pickSample(60, sampled).midi).toBe(60);
  });

  it("returns the rate that tunes the sample to the note", () => {
    expect(pickSample(60, sampled).rate).toBe(1);
    expect(pickSample(62, sampled).rate).toBeCloseTo(2 ** (-1 / 12));
    expect(pickSample(72, [60]).rate).toBeCloseTo(2);
    expect(pickSample(48, [60]).rate).toBeCloseTo(0.5);
  });

  it("takes the higher sample on a tie, as Tone.Sampler does", () => {
    expect(pickSample(62, [60, 64]).midi).toBe(64);
  });

  it("works for notes far outside the sampled range", () => {
    expect(pickSample(20, sampled).midi).toBe(57);
    expect(pickSample(100, sampled).midi).toBe(66);
  });
});

describe("voiceSpan", () => {
  it("never plays past the region end, at any rate", () => {
    for (const rate of [0.5, 1, 1.26, 2]) {
      const { offset, maxLen } = voiceSpan([10, 14], rate);
      expect(offset).toBe(10);
      expect(maxLen * rate).toBeCloseTo(4);
    }
  });
});

describe("noteToMidi", () => {
  it("parses note names", () => {
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("D#3")).toBe(51);
    expect(noteToMidi("A#1")).toBe(34);
    expect(noteToMidi("E1")).toBe(28);
  });
});

describe("sprites.json", () => {
  for (const [name, sprite] of Object.entries(sprites)) {
    it(`${name} regions are ordered, inside the file and 0.09 s apart`, () => {
      const regions = Object.values(sprite.regions as Record<string, number[]>).sort((a, b) => a[0] - b[0]);
      expect(regions.length).toBeGreaterThan(0);
      let prevEnd = 0;
      for (const [start, end] of regions) {
        expect(start).toBeLessThan(end);
        expect(start - prevEnd).toBeGreaterThanOrEqual(0.09);
        prevEnd = end;
      }
    });
  }

  it("every drum in the kit has a region", () => {
    for (const layers of Object.values(sprites.drums.kit)) {
      for (const takes of layers) for (const take of takes) expect(sprites.drums.regions).toHaveProperty(take);
    }
  });
});
