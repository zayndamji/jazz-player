import { describe, expect, it } from "vitest";
import { CLAMP_FADE, noteSpan, noteToMidi, pickSample, voiceSpan } from "./sprite";
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

describe("noteSpan", () => {
  const maxLen = 3.13; // a bass region at its own pitch
  const release = 0.25;

  it("plays a note that fits for its length with the instrument's release", () => {
    expect(noteSpan(1, maxLen, release)).toEqual({ hold: 1, fade: release });
    expect(noteSpan(0.001, maxLen, release).hold).toBe(0.02);
  });

  it("fades a note longer than the region out inside it instead of cutting it at the end", () => {
    for (const duration of [maxLen - CLAMP_FADE + 0.01, 2.9, 3.13, 4, 10]) {
      const { hold, fade } = noteSpan(duration, maxLen, release);
      expect(fade).toBe(CLAMP_FADE);
      expect(hold + fade).toBeCloseTo(maxLen);
      expect(fade).toBeGreaterThanOrEqual(0.15);
    }
  });

  it("never ends past the region, holds longer for longer notes, and keeps a long release", () => {
    let prev = 0;
    for (let d = 0.1; d < 6; d += 0.05) {
      const { hold, fade } = noteSpan(d, maxLen, release);
      expect(hold + fade).toBeLessThanOrEqual(maxLen + 1e-9);
      expect(hold).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = hold;
    }
    expect(noteSpan(20, 12, 0.9)).toEqual({ hold: 11.1, fade: 0.9 });
    // A tiny region (a high note played fast) still fades inside it.
    const tiny = noteSpan(2, 0.5, release);
    expect(tiny.hold + tiny.fade).toBeCloseTo(0.5);
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
