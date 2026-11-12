import { describe, expect, it } from "vitest";
import { swingForm } from "../fixtures";
import { defaultSettings } from "./settings";
import { parseLink, rememberable, shareUrl, withLink } from "./share";

describe("shared links", () => {
  it("reads every parameter", () => {
    expect(parseLink("#/tune/x?bpm=120&key=-2&style=bossa&for=Bb&choruses=4")).toEqual({ tempo: 120, transpose: -2, style: "bossa", instrument: "Bb", choruses: 4 });
    expect(parseLink("#/tune/x?choruses=loop")).toEqual({ choruses: "loop" });
  });

  it("ignores bad values", () => {
    expect(parseLink("#/tune/x?bpm=9000&key=7&style=polka&for=kazoo&choruses=7")).toEqual({});
    expect(parseLink("#/tune/x?bpm=&key=")).toEqual({});
    expect(parseLink("#/tune/x")).toEqual({});
  });

  it("puts the link over the stored settings", () => {
    const base = { ...defaultSettings(swingForm), tempo: 100, transpose: 3 };
    const got = withLink(base, { tempo: 140, choruses: 2 });
    expect(got.tempo).toBe(140);
    expect(got.transpose).toBe(3);
    expect(got.choruses).toBe(2);
  });

  it("keeps stored values for what the link set and the user didn't touch", () => {
    const stored = { ...defaultSettings(swingForm), tempo: 100, transpose: 3 };
    const link = { tempo: 140, transpose: -2 };
    const visit = withLink(stored, link);
    expect(rememberable(visit, stored, link)).toEqual(stored);
    expect(rememberable({ ...visit, tempo: 150 }, stored, link).tempo).toBe(150);
    expect(rememberable({ ...visit, tempo: 150 }, stored, link).transpose).toBe(3);
  });

  it("builds a link that reads back the same", () => {
    const s = { tempo: 130, transpose: -3, style: "swing", instrument: "Eb", choruses: "loop" as const };
    const url = shareUrl("https://example.org/app/", "my-tune", s);
    expect(url.startsWith("https://example.org/app/#/tune/my-tune?")).toBe(true);
    expect(parseLink(url.slice(url.indexOf("#")))).toEqual({ tempo: 130, transpose: -3, style: "swing", instrument: "Eb", choruses: "loop" });
    expect(shareUrl("", "t", { ...s, instrument: "C" })).not.toContain("for=");
  });

  it("carries trading", () => {
    expect(parseLink("#/tune/x?trade=eights")).toEqual({ trade: "eights" });
    expect(parseLink("#/tune/x?trade=sixes")).toEqual({});
    const s = { tempo: 130, transpose: 0, style: "swing", instrument: "C", choruses: 3 as const };
    expect(parseLink(shareUrl("", "t", { ...s, trade: "fours-out" }).slice(1)).trade).toBe("fours-out");
    expect(shareUrl("", "t", { ...s, trade: "off" })).not.toContain("trade=");
    expect(withLink(defaultSettings(swingForm), { trade: "fours" }).trade).toBe("fours");
  });

  it("carries which chords show", () => {
    expect(parseLink("#/tune/x?chords=hidden")).toEqual({ chords: "hidden" });
    expect(parseLink("#/tune/x?chords=none")).toEqual({});
    const s = { tempo: 130, transpose: 0, style: "swing", instrument: "C", choruses: 3 as const };
    expect(parseLink(shareUrl("", "t", { ...s, chords: "after-first" }).slice(1)).chords).toBe("after-first");
    expect(shareUrl("", "t", { ...s, chords: "always" })).not.toContain("chords=");
    expect(withLink(defaultSettings(swingForm), { chords: "hidden" }).chords).toBe("hidden");
  });
});
