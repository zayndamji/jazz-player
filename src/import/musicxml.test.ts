import { describe, expect, it } from "vitest";
import { parseChord } from "../chart/chords";
import { validateChart } from "../charts";
import { importMusicXml, MXL_MESSAGE } from "./musicxml";
import { parseXml } from "./xml";
import swing from "./fixtures/rehearsal-and-endings.musicxml?raw";
import waltz from "./fixtures/waltz-in-g-minor.musicxml?raw";
import trumpet from "./fixtures/transposed-part.musicxml?raw";

describe("xml reader", () => {
  it("reads elements, attributes, text and entities", () => {
    const root = parseXml(`<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><!-- c --><a k='1' j="&lt;2&gt;"><b>Tom &amp; Jerry &#65;&#x42;</b><c/><![CDATA[<raw>]]></a>`);
    expect(root.attrs).toEqual({ k: "1", j: "<2>" });
    expect(root.children.map((c) => c.name)).toEqual(["b", "c"]);
    expect(root.children[0].text).toBe("Tom & Jerry AB");
    expect(root.text).toBe("<raw>");
  });

  it("rejects broken markup", () => {
    expect(() => parseXml("<a><b></a>")).toThrow(/not valid XML/);
    expect(() => parseXml("")).toThrow(/not valid XML/);
  });
});

describe("MusicXML import", () => {
  it("reads title, key, tempo, marks, endings and beat-3 changes", () => {
    const { chart } = importMusicXml(swing);
    expect(chart.title).toBe("Made Up Swing");
    expect(chart.id).toBe("made-up-swing");
    expect(chart.key).toBe("Eb");
    expect(chart.tempo).toBe(140);
    expect(chart.beatsPerBar).toBe(4);
    expect(chart.style).toBe("swing");
    expect(chart.form.map((s) => s.label)).toEqual(["A", "A", "B"]);
    expect(chart.form[0].bars).toEqual(["Ebmaj7", "Cm7", "Dm7b5 G7b9", "Ebmaj7"]);
    expect(chart.form[1].bars).toEqual(["Ebmaj7", "Cm7", "Dm7b5 G7b9", "Eb/G"]);
    expect(chart.form[2].bars).toEqual(["Ab6 Bb7", "%", "Gm7 C7alt", "Fm7 Bb9 / /", "Eb6"]);
    expect(validateChart(chart)).toEqual([]);
  });

  it("reads 3/4, a minor key, an offset chord and a metronome tempo", () => {
    const { chart } = importMusicXml(waltz);
    expect(chart.key).toBe("Gm");
    expect(chart.beatsPerBar).toBe(3);
    expect(chart.style).toBe("waltz");
    expect(chart.tempo).toBe(100);
    expect(chart.form).toHaveLength(1);
    expect(chart.form[0].bars).toEqual(["Gm", "Cm7 D7 /", "Gm", "/ D7 /", "Ebmaj7", "Am7b5 D7b9 /", "Gm"]);
    expect(validateChart(chart)).toEqual([]);
  });

  it("converts a transposed part to concert pitch", () => {
    const { chart } = importMusicXml(trumpet);
    expect(chart.key).toBe("C");
    expect(chart.form[0].bars).toEqual(["Cmaj7", "Dm7 G7", "Cmaj7", "Fmaj7/A"]);
    expect(validateChart(chart)).toEqual([]);
  });

  it("rejects zipped files and other meters", () => {
    expect(() => importMusicXml("PK\u0003\u0004zip")).toThrow(MXL_MESSAGE);
    expect(() => importMusicXml(swing, "tune.mxl")).toThrow(/mxl/);
    expect(() => importMusicXml(swing.replace("<beats>4</beats>", "<beats>6</beats>").replace("<beat-type>4", "<beat-type>8"))).toThrow(/6\/8/);
    expect(() => importMusicXml("<html/>")).toThrow(/MusicXML/);
  });

  it("maps every MusicXML chord kind to a chord the parser reads", () => {
    const kinds = [
      "major", "minor", "augmented", "diminished", "dominant", "major-seventh", "minor-seventh", "diminished-seventh", "augmented-seventh", "half-diminished",
      "major-minor", "major-sixth", "minor-sixth", "dominant-ninth", "major-ninth", "minor-ninth", "dominant-11th", "major-11th", "minor-11th", "dominant-13th",
      "major-13th", "minor-13th", "suspended-second", "suspended-fourth", "Neapolitan", "Italian", "French", "German", "pedal", "power", "Tristan", "other",
    ];
    const bars = kinds.map((k) => importMusicXml(wrap(`<measure number="1"><harmony><root><root-step>C</root-step></root><kind>${k}</kind></harmony><note><rest/><duration>4</duration></note></measure>`)).chart.form[0].bars[0]);
    for (const bar of bars) expect(() => parseChord(bar), bar).not.toThrow();
    expect(bars.slice(0, 10)).toEqual(["C", "Cm", "Caug", "Cdim", "C7", "Cmaj7", "Cm7", "Cdim7", "C7#5", "Cm7b5"]);
  });

  it("adds degrees to a kind and falls back when they can't be read", () => {
    const one = (kind: string, degrees: string) =>
      importMusicXml(wrap(`<measure number="1"><harmony><root><root-step>F</root-step><root-alter>1</root-alter></root><kind>${kind}</kind>${degrees}</harmony><note><rest/><duration>4</duration></note></measure>`)).chart.form[0].bars[0];
    const d = (v: number, a: number, t: string) => `<degree><degree-value>${v}</degree-value><degree-alter>${a}</degree-alter><degree-type>${t}</degree-type></degree>`;
    expect(one("dominant", d(9, 1, "alter"))).toBe("F#7#9");
    expect(one("dominant", d(5, -1, "alter"))).toBe("F#7b5");
    expect(one("dominant", d(9, 0, "add"))).toBe("F#9");
    expect(one("minor-seventh", d(11, 0, "add"))).toMatch(/^F#m7/);
    expect(one("major", d(7, 0, "subtract"))).toBe("F#");
  });
});

/** A minimal score around some measures. */
function wrap(measures: string) {
  return `<score-partwise><work><work-title>T</work-title></work><part-list/><part id="P1">${measures.replace("<measure number=\"1\">", '<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>')}</part></score-partwise>`;
}
