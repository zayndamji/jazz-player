import { describe, expect, it } from "vitest";
import { applyPreset, currentPreset, effectiveMute, presetsFor, PRESETS } from "./mix";
import type { Track } from "../styles/types";
import { initialMix } from "./settings";

const trio = ["bass", "piano", "drums"] as const;
const band = [...trio];

describe("solo", () => {
  it("silences every other part of the band, never the metronome", () => {
    const mix = initialMix();
    mix.bass.solo = true;
    expect(effectiveMute(mix, "bass")).toBe(false);
    expect(effectiveMute(mix, "piano")).toBe(true);
    expect(effectiveMute(mix, "drums")).toBe(true);
    expect(effectiveMute(mix, "metronome")).toBe(false);
  });

  it("lets several soloed parts sound, and still obeys mute", () => {
    const mix = initialMix();
    mix.bass.solo = true;
    mix.drums.solo = true;
    mix.drums.mute = true;
    expect(effectiveMute(mix, "bass")).toBe(false);
    expect(effectiveMute(mix, "drums")).toBe(true);
    expect(effectiveMute(mix, "piano")).toBe(true);
  });

  it("changes nothing without a solo", () => {
    const mix = initialMix();
    mix.piano.mute = true;
    expect(effectiveMute(mix, "bass")).toBe(false);
    expect(effectiveMute(mix, "piano")).toBe(true);
  });
});

describe("band presets", () => {
  const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

  it("sets the mutes and clears solos", () => {
    const mix = initialMix();
    mix.bass.solo = true;
    mix.metronome.mute = true;
    const next = applyPreset(mix, preset("no-piano"), band);
    expect(next.piano.mute).toBe(true);
    expect(next.bass.mute).toBe(false);
    expect(next.bass.solo).toBe(false);
    expect(next.metronome.mute).toBe(true);
  });

  it("recognises what it set, and calls anything else custom", () => {
    expect(currentPreset(initialMix(), band)?.id).toBe("full");
    expect(currentPreset(applyPreset(initialMix(), preset("drums"), band), band)?.id).toBe("drums");
    const four: Track[] = ["bass", "guitar", "piano", "drums"];
    expect(currentPreset(applyPreset(initialMix(), preset("bass-drums"), four), four)?.id).toBe("bass-drums");
    const mix = initialMix();
    mix.bass.mute = true;
    mix.drums.mute = true;
    expect(currentPreset(mix, band)).toBeNull();
    const solo = initialMix();
    solo.bass.solo = true;
    expect(currentPreset(solo, band)).toBeNull();
  });

  it("only lists mixes that make sense for the band", () => {
    expect(presetsFor(band).map((p) => p.id)).toEqual(["full", "no-piano", "no-bass", "no-drums", "drums"]);
    expect(presetsFor(["bass", "guitar", "piano", "drums"]).map((p) => p.id)).toEqual(["full", "no-piano", "no-bass", "no-drums", "bass-drums", "drums"]);
    expect(presetsFor(["bass", "drums"]).map((p) => p.id)).toEqual(["full", "no-bass", "no-drums"]);
  });
});
