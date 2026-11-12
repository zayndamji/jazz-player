import { describe, expect, it } from "vitest";
import { parseChord } from "../chart/chords";
import { chordScale } from "../chart/scales";
import { bossaForm } from "../fixtures";
import { bossa } from "../styles/bossa";
import { buildSchedule, clicksOn } from "./schedule";
import { validateChart } from "../charts";
import type { Chart } from "../chart/types";
import { buildTimeline, chartBars, chorusTranspose, navOrder, nextChord, playOrder, rangeBars, stepBar, stepSection, type PlayItem } from "./timeline";
import { SWING_RANGE, VOICING_HIGH, VOICING_LOW, voiceChord, voicingIntervals } from "./voicing";

const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pcs = (notes: number[]) => notes.map((n) => names[n % 12]);
const chart = bossaForm;

/** A made-up blues whose head ends on a different chord from the solo choruses. */
const headAndSolos: Chart = {
  id: "head-and-solos",
  title: "Head and solos (test)",
  key: "F",
  tempo: 120,
  beatsPerBar: 4,
  style: "swing",
  form: [
    { label: "A", play: "head", bars: ["F7", "Bb7", "F7", "%", "Bb7", "%", "F7", "%", "C7", "Bb7", "Db7", "%"] },
    { label: "A", play: "solos", sheetBar: 1, bars: ["F7", "Bb7", "F7", "%", "Bb7", "%", "F7", "%", "C7", "Bb7", "F7", "C7"] },
  ],
  ending: [{ label: "End", bars: ["F7"] }],
};

describe("head and solo sections", () => {
  const sectionsIn = (order: PlayItem[], chorus: number) => [...new Set(order.filter((i) => i.chorus === chorus).map((i) => i.ref.section))];

  it("plays the head first and last, solo changes between", () => {
    const order = playOrder(headAndSolos, 3);
    expect([1, 2, 3].map((c) => sectionsIn(order, c))).toEqual([[0], [1], [0]]);
    expect(order.length).toBe(36 + 1);
    expect(sectionsIn(playOrder(headAndSolos, 1), 1)).toEqual([0]);
  });

  it("goes on with solos when the choruses repeat until stopped", () => {
    const order = playOrder(headAndSolos, 2, true, false);
    expect(sectionsIn(order, 2)).toEqual([1]);
  });

  it("starts a solo bar in a solo chorus", () => {
    const s = buildSchedule(headAndSolos, bossa, { choruses: 3, countIn: false, transpose: 0, start: { ref: { part: "form", section: 1, bar: 0 }, chorus: 1 } });
    expect(s.bars[0].chorus).toBe(2);
    expect(s.bars[0].contrast).toBe(false);
  });

  it("checks the play values", () => {
    expect(validateChart(headAndSolos)).toEqual([]);
    expect(validateChart({ ...headAndSolos, form: [headAndSolos.form[0]] })).not.toEqual([]);
  });
});

describe("timeline", () => {
  it("numbers bars like the sheet", () => {
    const bars = chartBars(chart);
    expect(bars.length).toBe(4 + 32 + 4 + 1);
    expect(bars[4]).toMatchObject({ number: 5, text: "Cmaj7", ref: { part: "form", section: 0, bar: 0 } });
    expect(bars[20].number).toBe(21);
    expect(bars[20].text).toBe("Fm7");
  });

  it("plays intro, each chorus, the tag twice and the final bar", () => {
    const bars = buildTimeline(chart, playOrder(chart, 2), 0, 0);
    expect(bars.length).toBe(4 + 32 * 2 + 4 * 2 + 1);
    expect(bars[4].chorus).toBe(1);
    expect(bars[36].chorus).toBe(2);
    expect(bars.at(-1)!.final).toBe(true);
  });

  it("carries a chord through a repeat bar without a new attack", () => {
    const bars = buildTimeline(chart, playOrder(chart, 1), 0, 0);
    expect(bars[7].chords[0].chord.symbol).toBe("Dm7");
    expect(bars[7].chords[0].attack).toBe(false);
  });

  it("transposes chords", () => {
    const bars = buildTimeline(chart, playOrder(chart, 1), 2, 2);
    expect(bars[5].chords[0].chord.symbol).toBe("F#m7");
  });
});

describe("schedule", () => {
  it("adds a two-bar count-in that clicks 1, 2, 1 2 3 4", () => {
    const s = buildSchedule(chart, bossa, { choruses: 1, countIn: true, transpose: 0 });
    expect(s.bars.length).toBe(2 + 4 + 32 + 8 + 1);
    expect(s.bars[1].countIn).toBe(true);
    expect(s.beats.slice(0, 8).map((b) => b.click)).toEqual([true, false, true, false, true, true, true, true]);
    expect(s.beats.length).toBe(s.totalBeats);
    expect(s.loop).toBeNull();
  });

  it("starts from a chosen bar", () => {
    const s = buildSchedule(chart, bossa, {
      choruses: 2,
      countIn: true,
      transpose: 0,
      start: { ref: { part: "form", section: 2, bar: 0 }, chorus: 2 },
    });
    expect(s.bars[2].ref).toEqual({ part: "form", section: 2, bar: 0 });
    expect(s.bars[2].chorus).toBe(2);
    expect(s.bars.length).toBe(2 + 16 + 8 + 1);
  });

  it("loops the form after the intro", () => {
    const s = buildSchedule(chart, bossa, { choruses: "loop", countIn: false, transpose: 0 });
    expect(s.bars.length).toBe(4 + 64);
    expect(s.loop).toEqual({ start: (4 + 32) * 4, end: 68 * 4 });
  });

  it("loops one section, starting part way through", () => {
    const s = buildSchedule(chart, bossa, {
      choruses: 3,
      countIn: true,
      transpose: 0,
      loopSection: 2,
      start: { ref: { part: "form", section: 2, bar: 4 }, chorus: 1 },
    });
    expect(s.bars[2].ref).toEqual({ part: "form", section: 2, bar: 4 });
    expect(s.loop).toEqual({ start: (2 + 4) * 4, end: (2 + 4 + 8) * 4 });
  });
});

describe("voicing", () => {
  it("voices a flat 13 as the flat 13, not the natural 13", () => {
    const iv = voicingIntervals(parseChord("E7b13"));
    expect(iv).toContain(8);
    expect(iv).not.toContain(9);
  });

  it("puts a guide tone at the bottom of swing voicings", () => {
    for (const s of ["Bb7", "Eb7", "Cm7", "F7", "Dm7", "G7", "Cmaj7", "Ab7"]) {
      const c = parseChord(s);
      const v = voiceChord(c, null, SWING_RANGE);
      const bottom = (v[0] - c.root + 120) % 12;
      expect([3, 4, 10, 11], s).toContain(bottom);
    }
  });

  it("leaves out the root and keeps guide tones", () => {
    expect(pcs(voiceChord(parseChord("Em7"), null)).sort()).toEqual(["B", "D", "F#", "G"]);
    expect(voicingIntervals(parseChord("A7"))).toEqual([4, 9, 10, 2]);
    expect(voicingIntervals(parseChord("B7(#5)"))).toEqual([4, 8, 10, 2]);
    expect(voicingIntervals(parseChord("D"))).toEqual([4, 7, 9, 2]);
  });

  it("stays in range, avoids low clusters, and moves smoothly", () => {
    let prev: number[] | null = null;
    for (const symbol of ["D", "B7(#5)", "E7", "Em7", "A7", "Dmaj7", "Am7", "D7", "G6", "Bm7", "Em7/A", "D6/9"]) {
      const v = voiceChord(parseChord(symbol), prev);
      expect(Math.min(...v)).toBeGreaterThanOrEqual(VOICING_LOW);
      expect(Math.max(...v)).toBeLessThanOrEqual(VOICING_HIGH);
      for (let i = 1; i < v.length; i++) if (v[i - 1] < 55) expect(v[i] - v[i - 1]).toBeGreaterThanOrEqual(3);
      if (prev) expect(v.reduce((s, n, i) => s + Math.abs(n - prev![i]), 0)).toBeLessThanOrEqual(12);
      prev = v;
    }
  });

  it("spreads chords wider than an octave", () => {
    const v = voiceChord(parseChord("Em7"), null);
    expect(v[3] - v[0]).toBeGreaterThan(12);
  });
});

describe("scales", () => {
  it("picks a scale per chord type and spells it", () => {
    expect(chordScale(parseChord("Em7"), "E", 2)).toEqual({ name: "Dorian", notes: ["E", "F♯", "G", "A", "B", "C♯", "D"] });
    expect(chordScale(parseChord("A7"), "A", 2).name).toBe("Mixolydian");
    expect(chordScale(parseChord("B7(#5)"), "B", 2)).toEqual({ name: "Whole tone", notes: ["B", "C♯", "D♯", "F", "G", "A"] });
    expect(chordScale(parseChord("D"), "D", 2).name).toBe("Major");
    expect(chordScale(parseChord("Bb7"), "Bb", 3).notes[0]).toBe("B♭");
  });
});

describe("bossa style", () => {
  const schedule = buildSchedule(chart, bossa, { choruses: 1, countIn: true, transpose: 0 });
  const inBar = (index: number, track: string) =>
    schedule.events.filter((e) => e.track === track && e.time >= index * 4 - 0.1 && e.time < index * 4 + 3.9);

  it("plays nothing in the count-in", () => {
    for (const bar of [0, 1]) for (const t of ["bass", "piano", "guitar", "drums"]) expect(inBar(bar, t).length).toBe(0);
  });

  it("plays root and fifth in the bass", () => {
    const bass = inBar(2, "bass"); // intro bar 1, C
    // Each note sits within a few milliseconds of its place (the bass's timing pocket).
    expect(bass.map((e) => Math.round((e.time - 8) * 4) / 4 + 0)).toEqual([0, 1.5, 2, 3.5]);
    for (const e of bass) expect(Math.abs((e.time - 8) * 4 - Math.round((e.time - 8) * 4))).toBeLessThan(0.2);
    expect(pcs(bass.map((e) => e.notes![0]))).toEqual(["C", "G", "G", "G"]); // next bar is Dm7/G
  });

  it("plays the flat fifth under a half-diminished chord", () => {
    const minor = { ...chart, key: "Cm", intro: undefined, ending: undefined, form: [{ label: "A", bars: ["Dm7b5", "G7(b9)", "Cm7", "%"] }] };
    const s = buildSchedule(minor, bossa, { choruses: 1, countIn: false, transpose: 0 });
    const bass = s.events.filter((e) => e.track === "bass" && e.time < 3.9);
    expect(pcs(bass.slice(0, 2).map((e) => e.notes![0]))).toEqual(["D", "G#"]); // Ab
  });

  it("plays eight hi-hats, 2 and 4 accented, and the clave", () => {
    const drums = inBar(3, "drums");
    const hats = drums.filter((e) => e.drum === "hat");
    expect(hats.length).toBe(8);
    expect(hats[2].velocity).toBeGreaterThan(hats[1].velocity);
    expect(drums.filter((e) => e.drum === "rim").length).toBe(2);
  });

  it("plays guitar on every bar and a light fill at the end of the form", () => {
    for (let b = 2; b < 2 + 36; b++) expect(inBar(b, "guitar").length).toBeGreaterThanOrEqual(2);
    const endOfForm = 2 + 4 + 31;
    const fill = inBar(endOfForm, "drums").filter((e) => ["snare", "rim", "tomHigh", "tomLow"].includes(e.drum!) && e.time % 4 >= 2.95);
    expect(fill.length).toBeGreaterThanOrEqual(3);
    expect(inBar(endOfForm + 1, "drums").some((e) => e.drum === "crash")).toBe(true);
  });

  it("never has guitar and piano on different chords at once", () => {
    const pcSet = (notes: number[]) => [...new Set(notes.map((n) => n % 12))].sort().join(",");
    const piano = schedule.events.filter((e) => e.track === "piano");
    let checked = 0;
    for (const g of schedule.events.filter((e) => e.track === "guitar")) {
      const under = piano.filter((p) => p.time <= g.time + 0.03 && p.time + p.duration > g.time + 0.03);
      for (const p of under) expect(pcSet(p.notes!), `beat ${g.time.toFixed(2)}`).toBe(pcSet(g.notes!));
      checked += under.length;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("sometimes pushes a chord change to the and of 4", () => {
    const pushes = schedule.events.filter((e) => e.track === "guitar" && Math.abs((e.time % 4) - 3.5) < 0.05);
    expect(pushes.length).toBeGreaterThan(3);
  });

  it("varies the guitar figure between two-bar cycles", () => {
    const shape = (b: number) => inBar(b, "guitar").map((e) => Math.round((e.time % 4) * 2) / 2).join(",");
    const shapes = new Set(Array.from({ length: 16 }, (_, k) => shape(6 + k * 2)));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it("moves to the ride in the bridge from the second chorus", () => {
    const two = buildSchedule(chart, bossa, { choruses: 2, countIn: false, transpose: 0 });
    const bridge = (chorus: number) => two.bars.find((b) => b.chorus === chorus && b.contrast)!;
    const cymbals = (bar: { startBeat: number }) =>
      two.events.filter((e) => e.track === "drums" && e.time >= bar.startBeat - 0.1 && e.time < bar.startBeat + 3.9).map((e) => e.drum);
    expect(cymbals(bridge(1))).toContain("hat");
    expect(cymbals(bridge(2))).toContain("ride");
    expect(cymbals(bridge(2))).toContain("pedal");
  });
});

describe("stepping with the arrow keys", () => {
  const order = navOrder(chart, 2, null);
  const at = (part: PlayItem["ref"]["part"], section: number, bar: number, chorus: number): PlayItem => ({ ref: { part, section, bar }, chorus });

  it("walks bars in playing order across choruses and stops at the ends", () => {
    expect(stepBar(order, null, 1)).toEqual(at("intro", 0, 1, 0));
    expect(stepBar(order, at("form", 3, 7, 1), 1)).toEqual(at("form", 0, 0, 2));
    expect(stepBar(order, null, -1)).toEqual(at("intro", 0, 0, 0));
    expect(stepBar(order, order.at(-1)!, 1)).toEqual(order.at(-1));
  });

  it("goes to the start of this section, then the previous one", () => {
    expect(stepSection(order, at("form", 1, 3, 1), -1)).toEqual(at("form", 1, 0, 1));
    expect(stepSection(order, at("form", 1, 0, 1), -1)).toEqual(at("form", 0, 0, 1));
    expect(stepSection(order, at("form", 0, 0, 1), -1)).toEqual(at("intro", 0, 0, 0));
    expect(stepSection(order, at("form", 3, 2, 1), 1)).toEqual(at("form", 0, 0, 2));
    expect(stepSection(order, at("form", 3, 2, 2), 1)).toEqual(at("ending", 0, 0, 0));
  });

  it("wraps inside a looped section", () => {
    const loop = navOrder(chart, 2, 2);
    expect(stepBar(loop, at("form", 2, 7, 1), 1, true)).toEqual(at("form", 2, 0, 1));
    expect(stepBar(loop, at("form", 2, 0, 1), -1, true)).toEqual(at("form", 2, 7, 1));
  });

  it("keeps counting choruses when they repeat until stopped", () => {
    expect(stepBar(navOrder(chart, "loop", null, 5), at("form", 3, 7, 5), 1)).toEqual(at("form", 0, 0, 6));
  });
});

describe("count-in length", () => {
  const first = (countInBars: 0 | 1 | 2) => buildSchedule(chart, bossa, { choruses: 1, countIn: false, countInBars, transpose: 0 });
  it("leads with the asked number of bars", () => {
    for (const n of [0, 1, 2] as const) {
      const s = first(n);
      expect(s.bars.filter((b) => b.countIn).length).toBe(n);
      expect(s.bars[n].ref).not.toBeNull();
    }
  });

  it("clicks every beat in a one-bar count-in and half notes first in a two-bar one", () => {
    const clicks = (n: 1 | 2) => first(n).beats.filter((b) => b.countIn && b.click).length;
    expect(clicks(1)).toBe(4);
    expect(clicks(2)).toBe(6);
  });

  it("still reads the countIn flag as two bars", () => {
    expect(buildSchedule(chart, bossa, { choruses: 1, countIn: true, transpose: 0 }).bars.filter((b) => b.countIn).length).toBe(2);
  });
});

describe("intro and ending switches", () => {
  const partsOf = (items: PlayItem[]) => new Set(items.map((i) => i.ref.part));
  it("leaves them out of the play order", () => {
    expect([...partsOf(playOrder(chart, 2))]).toEqual(["intro", "form", "ending"]);
    expect([...partsOf(playOrder(chart, 2, false, true))]).toEqual(["form", "ending"]);
    expect([...partsOf(playOrder(chart, 2, true, false, true))]).toEqual(["intro", "form"]);
    expect(playOrder(chart, 2, false, false, true).length).toBe(64);
  });

  it("keeps the last chorus a head chorus without the ending", () => {
    const order = playOrder(headAndSolos, 3, true, false, true);
    expect(order.filter((i) => i.chorus === 3).every((i) => i.ref.section === 0)).toBe(true);
  });

  it("builds a schedule without them", () => {
    const s = buildSchedule(chart, bossa, { choruses: 1, countIn: false, transpose: 0, intro: false, ending: false });
    expect(s.bars.length).toBe(32);
    expect(s.bars[0].ref).toEqual({ part: "form", section: 0, bar: 0 });
    expect(s.bars.at(-1)!.final).toBe(false);
    const full = buildSchedule(chart, bossa, { choruses: 1, countIn: false, transpose: 0 });
    expect(full.bars.length).toBe(4 + 32 + 8 + 1);
  });

  it("steps through the same bars with the keys", () => {
    expect(navOrder(chart, 2, null, 1, false, false).length).toBe(64);
    expect(navOrder(chart, 2, null, 1, true, true).length).toBe(4 + 64 + 9);
    expect(navOrder(chart, "loop", null, 1, false).some((i) => i.ref.part === "intro")).toBe(false);
  });
});

describe("click mode", () => {
  const beats = [0, 1, 2, 3];
  it("picks the beats the metronome clicks", () => {
    expect(beats.filter((b) => clicksOn("every", b))).toEqual([0, 1, 2, 3]);
    expect(beats.filter((b) => clicksOn("two-four", b))).toEqual([1, 3]);
    expect(beats.filter((b) => clicksOn("one", b))).toEqual([0]);
  });
});

describe("loop a range of bars", () => {
  const ref = (section: number, bar: number) => ({ part: "form" as const, section, bar });
  const range = { from: ref(0, 2), to: ref(0, 5) };

  it("lists the bars from the first to the last, either way round", () => {
    expect(rangeBars(chart, range).map((b) => b.number)).toEqual([7, 8, 9, 10]);
    expect(rangeBars(chart, { from: range.to, to: range.from }).map((b) => b.number)).toEqual([7, 8, 9, 10]);
  });

  it("plays the range twice and repeats the second copy", () => {
    const s = buildSchedule(chart, bossa, { choruses: 3, countIn: false, transpose: 0, loopRange: range });
    expect(s.bars.length).toBe(8);
    expect(s.loop).toEqual({ start: 16, end: 32 });
    expect(s.bars[0].ref).toEqual(range.from);
    expect(s.bars[3].ref).toEqual(range.to);
    expect(s.bars[4].ref).toEqual(range.from);
    expect(s.bars[4].chorus).toBe(2);
  });

  it("starts inside the range and after a count-in", () => {
    const s = buildSchedule(chart, bossa, { choruses: 3, countIn: true, transpose: 0, loopRange: range, start: { ref: ref(0, 4), chorus: 1 } });
    expect(s.bars.filter((b) => !b.countIn).map((b) => b.ref!.bar)).toEqual([4, 5, 2, 3, 4, 5]);
    expect(s.loop).toEqual({ start: (2 + 2) * 4, end: s.totalBeats });
  });

  it("can span sections", () => {
    const across = { from: ref(0, 7), to: ref(1, 1) };
    const s = buildSchedule(chart, bossa, { choruses: 1, countIn: false, transpose: 0, loopRange: across });
    expect(s.bars.slice(0, 3).map((b) => [b.ref!.section, b.ref!.bar])).toEqual([[0, 7], [1, 0], [1, 1]]);
  });

  it("loops a section instead when both are given", () => {
    const s = buildSchedule(chart, bossa, { choruses: 3, countIn: false, transpose: 0, loopSection: 1, loopRange: range });
    expect(s.bars[0].ref!.section).toBe(1);
  });
});

describe("key cycling", () => {
  const root = (bar: { chords: { chord: { symbol: string } }[] }) => bar.chords[0].chord.symbol;
  const sched = (keyStep: number, extra = {}) => buildSchedule(chart, bossa, { choruses: 3, countIn: false, transpose: 0, keyStep, ...extra });
  const firstOf = (s: ReturnType<typeof sched>, chorus: number) => s.bars.find((b) => b.chorus === chorus && b.ref!.part === "form")!;

  it("moves each chorus up a fourth: chorus 2 is up 5 half steps", () => {
    const s = sched(5);
    expect(root(firstOf(s, 1))).toBe("Cmaj7");
    expect(root(firstOf(s, 2))).toBe("Fmaj7");
    expect(firstOf(s, 2).transpose).toBe(5);
    expect(root(firstOf(s, 3))).toBe("Bbmaj7");
    expect(firstOf(s, 3).transpose).toBe(-2);
  });

  it("adds the base transpose and folds it into -6..5", () => {
    expect(chorusTranspose(0, 5, 1)).toBe(0);
    expect(chorusTranspose(0, 5, 2)).toBe(5);
    expect(chorusTranspose(0, 5, 3)).toBe(-2);
    expect(chorusTranspose(3, 5, 2)).toBe(-4);
    expect(chorusTranspose(2, 1, 12)).toBe(1);
    expect(chorusTranspose(2, 0, 7)).toBe(2);
  });

  it("keeps the intro in the first key and the ending in the last", () => {
    const s = sched(2);
    expect(s.bars[0].transpose).toBe(0);
    expect(s.bars.at(-1)!.transpose).toBe(4);
  });

  it("spells each chorus's chords in its own key", () => {
    const flats = sched(-1);
    expect(root(firstOf(flats, 2))).toBe("Bmaj7");
    expect(firstOf(flats, 2).transpose).toBe(-1);
  });

  it("stays in one key when looping a section or a range, or repeating until stopped", () => {
    expect(sched(5, { loopSection: 0 }).bars.every((b) => b.transpose === 0)).toBe(true);
    expect(sched(5, { loopRange: { from: { part: "form", section: 0, bar: 0 }, to: { part: "form", section: 0, bar: 2 } } }).bars.every((b) => b.transpose === 0)).toBe(true);
    expect(sched(5, { choruses: "loop" }).bars.every((b) => b.transpose === 0)).toBe(true);
  });

  it("starts a count-in in the key of the bar it leads to", () => {
    const s = buildSchedule(chart, bossa, { choruses: 3, countIn: true, transpose: 0, keyStep: 5, start: { ref: { part: "form", section: 0, bar: 0 }, chorus: 2 } });
    expect(s.bars[0].countIn).toBe(true);
    expect(s.bars[0].transpose).toBe(5);
  });
});

describe("next chord", () => {
  const s = buildSchedule(chart, bossa, { choruses: 1, countIn: false, transpose: 0, intro: false });
  const sym = (r: ReturnType<typeof nextChord>) => r?.chord.symbol ?? null;
  it("looks inside the bar first", () => {
    expect(sym(nextChord(s.bars, 1, 0))).toBe("A7");
  });
  it("skips repeated chords and finds one in the next two bars", () => {
    // bar 2 is Dm7, bar 3 is "%", bar 4 is Fmaj7: two bars on.
    expect(sym(nextChord(s.bars, 2, 0))).toBe("Fmaj7");
  });
  it("gives nothing when the next two bars hold the same chord", () => {
    expect(sym(nextChord(s.bars, 2, 0, 1))).toBeNull();
  });
  it("wraps into the repeating copy of a loop", () => {
    const l = buildSchedule(chart, bossa, { choruses: 1, countIn: false, transpose: 0, loopSection: 0 });
    const last = l.bars.length - 1;
    expect(sym(nextChord(l.bars, last, 3, 2, l.bars.length / 2))).toBe("Cmaj7");
  });
  it("gives nothing at the end", () => {
    expect(nextChord(s.bars, s.bars.length - 1, 0)).toBeNull();
  });
});
