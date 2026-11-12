import { describe, expect, it } from "vitest";
import { parseChord } from "../chart/chords";
import { validateChart } from "../charts";
import { decodeLink, expandShorthand, importIReal, parseMusic, qualityOf, songToChart, styleFor, unscramble } from "./ireal";
import { bossaSong, irealBookLink, irealLink, scramble, swingSong, waltzSong, type PlainSong } from "./fixtures/ireal";

/** Bars of a chord string, for token tests. */
const bars = (music: string) => parseMusic(music).measures.map((m) => m.bar);
const song = (music: string, extra: Partial<PlainSong> = {}): PlainSong => ({ title: "T", style: "Medium Swing", key: "C", music, ...extra });
const problems = validateChart;

describe("iReal scrambling", () => {
  it("unscrambles what scramble made, at any length", () => {
    for (const n of [0, 1, 49, 50, 51, 52, 99, 100, 101, 163, 400]) {
      const plain = Array.from({ length: n }, (_, i) => "ABCDEFGabcdefg0123456789|{}[]"[(i * 7) % 29]).join("");
      expect(unscramble(scramble(plain))).toBe(plain);
    }
  });

  it("matches a hand-checked block: 0 to 4 and 10 to 23 swap with their mirror", () => {
    const plain = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwx";
    const scrambled = "xwvutFGHIJnmlkjihgfedcbaYZXWVUTSRQPONMLKopqrsEDCBA";
    expect(unscramble(scrambled + "TAIL")).toBe(plain + "TAIL");
    // A last block with fewer than 2 characters after it stays as it is.
    expect(unscramble(plain + "T")).toBe(plain + "T");
  });

  it("leaves a short string alone and scrambles a long one", () => {
    expect(scramble("short")).toBe("short");
    const long = "0123456789".repeat(8);
    expect(scramble(long)).not.toBe(long);
    expect(scramble(long)).toHaveLength(long.length);
  });

  it("spells out the shorthand", () => {
    expect(expandShorthand("CXyQD")).toBe("C   D");
    expect(expandShorthand("CLZD")).toBe("C |D");
    expect(expandShorthand("C|KclD")).toBe("C|| x D");
  });
});

describe("iReal links", () => {
  it("reads a single song", () => {
    const [s] = decodeLink(irealLink([swingSong]));
    expect(s).toMatchObject({ title: "Made Up Swing", style: "Medium Swing", key: "F", tempo: 150, music: swingSong.music });
  });

  it("reads every song in a playlist and drops the playlist name", () => {
    const songs = decodeLink(irealLink([swingSong, bossaSong, waltzSong], "My Made Up List"));
    expect(songs.map((s) => s.title)).toEqual(["Made Up Swing", "Made Up Bossa", "Made Up Waltz"]);
    expect(songs[1].music).toBe(expandShorthand(bossaSong.music));
  });

  it("reads the older unscrambled form", () => {
    const songs = decodeLink(irealBookLink([swingSong, waltzSong], "Old List"));
    expect(songs.map((s) => s.title)).toEqual(["Made Up Swing", "Made Up Waltz"]);
    expect(songs[0].music).toBe(swingSong.music);
  });

  it("explains links it can't read", () => {
    expect(() => decodeLink("https://example.com")).toThrow(/irealb:\/\//);
    expect(() => decodeLink("irealb://nonsense")).toThrow(/readable iReal Pro song/);
  });
});

describe("iReal charts", () => {
  it("builds a swing chart with intro, endings and sections", () => {
    const { chart, warnings } = songToChart(decodeLink(irealLink([swingSong]))[0]);
    expect(warnings).toEqual([]);
    expect(chart).toMatchObject({ id: "made-up-swing", title: "Made Up Swing", key: "F", tempo: 150, beatsPerBar: 4, style: "swing" });
    expect(chart.intro).toEqual({ label: "Intro", bars: ["Gm7 C7", "Gm7 C7"] });
    expect(chart.form.map((s) => s.label)).toEqual(["A", "A", "B"]);
    expect(chart.form[0].bars).toEqual(["Fmaj7", "Dm7 G7", "Cm7 F7"]);
    expect(chart.form[1].bars).toEqual(["Fmaj7", "Dm7 G7", "Bbmaj7 / Em7b5 A7alt", "Fmaj7"]);
    expect(chart.form[2].bars).toEqual(["Dm7", "G7sus4", "Cmaj7", "%", "Dm7b5 G7b9"]);
    expect(problems(chart)).toEqual([]);
  });

  it("builds a bossa chart in a minor key", () => {
    const { chart } = songToChart(decodeLink(irealLink([bossaSong]))[0]);
    expect(chart).toMatchObject({ key: "Am", style: "bossa", tempo: 120, beatsPerBar: 4 });
    expect(chart.form.map((s) => s.label)).toEqual(["A", "B"]);
    expect(chart.form[0].bars).toEqual(["Am7", "Dm7", "Bm7b5 E7#9", "AmMaj7 Am7"]);
    expect(chart.form[1].bars).toEqual(["Fmaj7", "E7", "Am7", "%"]);
    expect(problems(chart)).toEqual([]);
  });

  it("builds a waltz chart with three cells a bar", () => {
    const { chart, warnings } = songToChart(decodeLink(irealLink([waltzSong]))[0]);
    expect(chart).toMatchObject({ key: "G", style: "waltz", beatsPerBar: 3, tempo: 150 });
    expect(warnings[0]).toMatch(/No tempo/);
    expect(chart.form[0].bars).toEqual(["Gmaj7", "Em7 / A7", "Dm7", "G7"]);
    expect(chart.form[1].bars).toEqual(["Cmaj7", "Cdim7", "Gmaj7/B", "Bb7 / D7alt"]);
    expect(problems(chart)).toEqual([]);
  });

  it("imports a playlist and lists songs it can't read", () => {
    const bad = song("[T54C7 |D7 Z", { title: "Five Four" });
    const { results, skipped } = importIReal(irealLink([swingSong, bad, waltzSong], "List"));
    expect(results.map((r) => r.chart.id)).toEqual(["made-up-swing", "made-up-waltz"]);
    expect(skipped).toEqual(["Five Four: Only 3/4 and 4/4 charts are supported (this one is 5/4)."]);
    expect(() => importIReal(irealLink([bad]))).toThrow(/5\/4/);
  });

  it("maps iReal styles", () => {
    expect(styleFor("Bossa Nova", 4)).toBe("bossa");
    expect(styleFor("Latin", 4)).toBe("bossa");
    expect(styleFor("Ballad Swing", 4)).toBe("ballad");
    expect(styleFor("Medium Up Swing", 4)).toBe("swing");
    expect(styleFor("Even 8ths", 4)).toBe("swing");
    expect(styleFor("Jazz Waltz", 4)).toBe("waltz");
    expect(styleFor("Bossa Nova", 3)).toBe("waltz");
  });
});

describe("iReal tokens", () => {
  it("places chords by cell, with commas and spaces as separators", () => {
    expect(bars("T44C7 |D7 |E7  F7 |G7 ,A7 |B7,,C7 |D7 E7 F7 G7 |C7 ,,D7 Z")).toEqual(["C7", "D7", "E7 F7", "G7 A7", "B7 C7", "D7 E7 F7 G7", "C7 / / D7"]);
  });

  it("reads time signatures T44 and T34 and rejects the rest", () => {
    expect(parseMusic("T44C7 |").beatsPerBar).toBe(4);
    expect(parseMusic("T34C7 |").beatsPerBar).toBe(3);
    for (const t of ["T24", "T54", "T64", "T74", "T22", "T32", "T58", "T68", "T78", "T98", "T12"]) expect(() => parseMusic(`${t}C7 |`)).toThrow(/Only 3\/4 and 4\/4/);
  });

  it("reads section marks *A *B *C *i *v", () => {
    const { measures } = parseMusic("T44*vC7 |*iD7 |*AE7 |*BF7 |*CG7 Z");
    expect(measures.map((m) => m.mark)).toEqual(["Verse", "Intro", "A", "B", "C"]);
  });

  it("reads barlines | [ ] { } Z", () => {
    const { measures } = parseMusic("[T44{C7 |D7 }E7 ]F7 |G7 Z");
    expect(measures.map((m) => m.bar)).toEqual(["C7", "D7", "E7", "F7", "G7"]);
    expect(measures[0].forward).toBe(true);
    expect(measures[1].backward).toBe(2);
    expect(measures[2].backward).toBeUndefined();
  });

  it("reads endings N1 N2 N3", () => {
    const { measures } = parseMusic("T44{C7 |N1D7 }N2E7 }N3F7 |G7 Z".replace("}N2E7 }N3F7", "}N2E7 }N3F7"));
    expect(measures.map((m) => m.endings)).toEqual([undefined, [1], [2], [3], [3]]);
    const played = songToChart(song("T44{C7 |N1D7 }N2E7 |F7 ]G7 Z")).chart.form.map((s) => s.bars);
    expect(played).toEqual([["C7", "D7"], ["C7", "E7", "F7", "G7"]]);
  });

  it("reads repeat bars x and Kcl", () => {
    expect(bars("T44C7 |x |D7 G7 |x |E7 Z")).toEqual(["C7", "%", "D7 G7", "D7 G7", "E7"]);
    const kcl = parseMusic(expandShorthand("T44C7 |D7 LZKcl LZE7 Z")).measures.map((m) => m.bar);
    expect(kcl).toEqual(["C7", "D7", "%", "E7"]);
  });

  it("reads r, repeat two bars", () => {
    expect(bars("T44C7 |D7 G7 |r|  |E7 Z")).toEqual(["C7", "D7 G7", "C7", "D7 G7", "E7"]);
  });

  it("holds the chord for n (no chord), p (slash) and W (invisible root)", () => {
    expect(bars("T44C7 |n |p |W7 |D7 Z")).toEqual(["C7", "%", "%", "%", "D7"]);
    expect(bars("T44C7 p ,D7 |Wp D7 Z")).toEqual(["C7 / / D7", "/ D7"]);
  });

  it("ignores size marks, spacers, markers and comments", () => {
    expect(bars("T44sC7 |lD7 |YYQ|S|U|f<13 bars>E7 |<D.C. al Fine>F7 Z")).toEqual(["C7", "D7", "E7", "F7"]);
  });

  it("drops alternate chords in parentheses", () => {
    expect(bars("T44C7 (Db7) |D7 ,(G7)A7 Z")).toEqual(["C7", "D7 A7"]);
  });

  it("drops leading bars with no chord and starts a late first chord on the downbeat", () => {
    expect(songToChart(song("T44n |x |C7 Z")).chart.form[0].bars).toEqual(["C7"]);
    const { chart } = songToChart(song("T44 ,,D7 |G7 Z"));
    expect(chart.form[0].bars).toEqual(["D7 D7", "G7"]);
  });
});

describe("iReal chord qualities", () => {
  const cases: [string, string][] = [
    ["", ""], ["-", "m"], ["^7", "maj7"], ["^", "maj7"], ["-7", "m7"], ["7", "7"], ["h7", "m7b5"], ["h", "m7b5"], ["o7", "dim7"], ["o", "dim"], ["+", "aug"],
    ["+7", "7#5"], ["7b9", "7b9"], ["7#9", "7#9"], ["7b5", "7b5"], ["7#11", "7#11"], ["7b13", "7b13"], ["7alt", "7alt"], ["alt", "7alt"], ["-^7", "mMaj7"],
    ["sus", "sus4"], ["7sus", "7sus4"], ["9sus", "9sus4"], ["6", "6"], ["-6", "m6"], ["69", "69"], ["-69", "m69"], ["9", "9"], ["-9", "m9"], ["^9", "maj9"], ["11", "11"],
    ["-11", "m11"], ["13", "13"], ["^13", "maj13"], ["2", "sus2"], ["5", "5"], ["^7#11", "maj7#11"], ["7b9#9", "7b9#9"],
  ];
  it.each(cases)("%s reads as %s", (ireal, ours) => {
    const got = qualityOf(ireal);
    expect(got).toBe(ours);
    expect(() => parseChord("C" + got)).not.toThrow();
  });

  it("falls back to something playable for what tonal can't read", () => {
    for (const q of ["7susadd3", "h9", "7b9sus", "-7b5", "13b9", "^7#5", "-b6", "7#9b13"]) expect(() => parseChord("C" + qualityOf(q)), q).not.toThrow();
  });
});
