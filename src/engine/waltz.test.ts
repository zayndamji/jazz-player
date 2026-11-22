import { describe, expect, it } from "vitest";
import { parseBar, parseChord } from "../chart/chords";
import type { Chart } from "../chart/types";
import { validateChart } from "../charts";
import { swingForm, waltzForm } from "../fixtures";
import { loadSettings, tuneKey } from "../pages/settings";
import { STYLES, playableStyle, playsMeter, stylesFor } from "../styles";
import { quartal, waltz } from "../styles/waltz";
import { buildSchedule, clickLabel, clicksOn, performanceBeats } from "./schedule";
import { SWING_RANGE } from "./voicing";
import { chartBars, itemAtFraction, nextChord, performanceFraction, playOrder, rangeOrder, stepBar } from "./timeline";

const play = { choruses: 2, countIn: true, transpose: 0 } as const;

describe("3/4 bars", () => {
  it("splits two chords as 2 beats then 1", () => {
    expect(parseBar("Dm7 G7", 3).chords).toEqual([{ symbol: "Dm7", beat: 0 }, { symbol: "G7", beat: 2 }]);
  });
  it("gives three tokens a beat each and holds with slashes", () => {
    expect(parseBar("Dm7 G7 C7", 3).chords.map((c) => c.beat)).toEqual([0, 1, 2]);
    expect(parseBar("Dm7 / G7", 3).chords).toEqual([{ symbol: "Dm7", beat: 0 }, { symbol: "G7", beat: 2 }]);
    expect(parseBar("Dm7 / /", 3).chords).toEqual([{ symbol: "Dm7", beat: 0 }]);
    expect(parseBar("Dm7 /", 3).chords).toEqual([{ symbol: "Dm7", beat: 0 }]);
    expect(parseBar("%", 3).repeat).toBe(true);
  });
  it("keeps 4/4 bars as they were", () => {
    expect(parseBar("Dm7 G7", 4).chords.map((c) => c.beat)).toEqual([0, 2]);
    expect(parseBar("Dm7 / / G7", 4).chords.map((c) => c.beat)).toEqual([0, 3]);
  });
});

describe("validateChart meters", () => {
  const chart = (beatsPerBar: number, bars = ["Dm7"]): Chart => ({ ...waltzForm, beatsPerBar, intro: undefined, ending: undefined, form: [{ label: "A", bars }] });
  it("accepts 3, 4 and 5, rejects others", () => {
    expect(validateChart(waltzForm)).toEqual([]);
    expect(validateChart(chart(3))).toEqual([]);
    expect(validateChart(chart(4))).toEqual([]);
    expect(validateChart(chart(5))).toEqual([]);
    expect(validateChart(chart(6))).toContain("beatsPerBar must be 3, 4 or 5");
    expect(validateChart(chart(2))).toContain("beatsPerBar must be 3, 4 or 5");
  });
  it("rejects a 3/4 bar with four slots", () => {
    expect(validateChart(chart(3, ["Dm7 G7 C7 F7"])).length).toBe(1);
  });
});

describe("3/4 timeline and schedule", () => {
  const s = buildSchedule(waltzForm, waltz, play);
  const bars = chartBars(waltzForm).length;

  it("lays bars 3 beats apart with three marks each", () => {
    expect(s.beatsPerBar).toBe(3);
    s.bars.forEach((b, i) => expect(b.startBeat).toBe(i * 3));
    expect(s.beats.length).toBe(s.bars.length * 3);
    expect(s.totalBeats).toBe(s.bars.length * 3);
    expect(s.beats.slice(0, 6).map((b) => [b.bar, b.beat])).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
    expect(bars).toBe(2 + 32 + 2);
    expect(s.bars.length).toBe(2 + 2 + 32 * 2 + 2);
  });

  it("splits a two-chord bar 2 and 1", () => {
    const bar = s.bars.find((b) => b.chords.length === 2)!;
    expect(bar.chords.map((c) => [c.beat, c.length])).toEqual([[0, 2], [2, 1]]);
  });

  it("counts in 1 . . | 1 2 3", () => {
    expect(s.beats.slice(0, 6).map((b) => b.click)).toEqual([true, false, false, true, true, true]);
    const one = buildSchedule(waltzForm, waltz, { ...play, countInBars: 1 });
    expect(one.beats.slice(0, 3).map((b) => b.click)).toEqual([true, true, true]);
  });

  it("applies click modes with 2 and 3 as the backbeats", () => {
    const beats = [0, 1, 2];
    expect(beats.filter((b) => clicksOn("every", b, 3))).toEqual([0, 1, 2]);
    expect(beats.filter((b) => clicksOn("two-four", b, 3))).toEqual([1, 2]);
    expect(beats.filter((b) => clicksOn("one", b, 3))).toEqual([0]);
    expect(clicksOn("two-four", 2)).toBe(false);
    expect(clicksOn("two-four", 3)).toBe(true);
    expect(clickLabel("two-four", 3)).toBe("2 and 3");
    expect(clickLabel("two-four", 4)).toBe("2 and 4");
  });

  it("counts performance length in bars of three", () => {
    for (const countInBars of [0, 1, 2]) {
      const sch = buildSchedule(waltzForm, waltz, { choruses: 3, countIn: true, countInBars: countInBars as 0 | 1 | 2, transpose: 0 });
      expect(performanceBeats(waltzForm, { choruses: 3, countInBars })).toBe(sch.totalBeats + 2);
    }
  });

  it("maps fractions and beats with three beats a bar", () => {
    const order = playOrder(waltzForm, 2);
    const place = order[10];
    expect(performanceFraction(order, place, 1.5, 3)).toBeCloseTo((10 + 0.5) / order.length);
    expect(itemAtFraction(order, 10.2 / order.length)).toBe(place);
    expect(stepBar(order, place, 1)).toBe(order[11]);
  });

  it("loops a range at bar boundaries of 3 beats", () => {
    const range = { from: { part: "form" as const, section: 0, bar: 2 }, to: { part: "form" as const, section: 0, bar: 4 } };
    expect(rangeOrder(waltzForm, range, 2).length).toBe(6);
    const sch = buildSchedule(waltzForm, waltz, { ...play, loopRange: range });
    expect(sch.loop).toEqual({ start: (2 + 3) * 3, end: (2 + 6) * 3 });
  });

  it("finds the next chord within a 3/4 bar", () => {
    const i = s.bars.findIndex((b) => b.chords.length === 2);
    const next = nextChord(s.bars, i, 0);
    expect(next?.chord.symbol).toBe(s.bars[i].chords[1].chord.symbol);
  });

  it("moves the key each chorus", () => {
    const sch = buildSchedule(waltzForm, waltz, { ...play, keyStep: 5 });
    expect(new Set(sch.bars.filter((b) => b.chorus > 0).map((b) => b.transpose)).size).toBe(2);
  });
});

describe("chart mix and pedal", () => {
  it("holds the chart's pedal under every chord, moved with the key", () => {
    const sch = buildSchedule({ ...waltzForm, pedal: "E" }, waltz, { choruses: 2, countIn: false, transpose: 2, intro: false, ending: false });
    // The held tonic that ends a song without an ending is the key's chord, not the pedal's.
    const tonic = sch.bars.find((b) => b.tonic)?.startBeat ?? Infinity;
    const bass = sch.events.filter((e) => e.track === "bass" && e.time < tonic - 0.1).map((e) => e.notes![0] % 12);
    expect(bass.length).toBeGreaterThan(20);
    // F# (E up a whole step), its fifth C#, nothing else.
    expect([...new Set(bass)].sort((a, b) => a - b)).toEqual([1, 6]);
  });

  it("adds the chart's mix to its own style only", () => {
    const chart = { ...waltzForm, mix: { drums: -5 } };
    expect(buildSchedule(chart, waltz, { choruses: 1, countIn: false, transpose: 0 }).mix.drums).toBe((waltz.mix?.drums ?? 0) - 5);
    expect(buildSchedule(chart, STYLES.swing, { choruses: 1, countIn: false, transpose: 0 }).mix.drums).toBe(STYLES.swing.mix?.drums);
    expect(validateChart({ ...chart, mix: { drums: 40 } }).length).toBeGreaterThan(0);
    expect(validateChart({ ...chart, pedal: "H" }).length).toBeGreaterThan(0);
  });
});

describe("the waltz style", () => {
  for (const tempo of [90, 168, 260]) {
    it(`keeps notes in range and near their bars at ${tempo} BPM`, () => {
      const s = buildSchedule(waltzForm, waltz, { choruses: 3, countIn: true, transpose: 2, tempo });
      expect(s.events.length).toBeGreaterThan(s.bars.length * 4);
      const finalStart = s.bars.find((b) => b.final)!.startBeat;
      const firstMusic = s.bars.find((b) => !b.countIn)!.startBeat;
      for (const e of s.events) {
        for (const n of e.notes ?? []) expect(n >= 24 && n <= 96, `note ${n}`).toBe(true);
        expect(Number.isFinite(e.time) && e.duration > 0).toBe(true);
        expect(e.time).toBeGreaterThanOrEqual(firstMusic);
        // The final chord can sit a few milliseconds early, in its timing pocket.
        if (e.time >= finalStart - 0.1) continue;
        // A note starts within its timing pocket of a bar and rings at most a beat past it
        // (an anticipation on the and of 3 carries into the next bar).
        const bar = Math.floor((e.time + 0.1) / 3);
        if (e.track !== "drums") expect(e.time + e.duration, JSON.stringify(e)).toBeLessThanOrEqual(bar * 3 + 4.2);
      }
    });
  }
  it("is deterministic", () => {
    expect(buildSchedule(waltzForm, waltz, play).events).toEqual(buildSchedule(waltzForm, waltz, play).events);
  });

  it("voices minor, major and sus chords in fourths from their scale", () => {
    const em11 = parseChord("Em11");
    const v = quartal(em11, null, SWING_RANGE)!;
    expect(v.length).toBeGreaterThanOrEqual(3);
    const dorian = [4, 6, 7, 9, 11, 1, 2];
    for (const n of v) expect(dorian).toContain(n % 12);
    expect(v[1] - v[0]).toBe(5);
    expect(v[2] - v[1]).toBe(5);
    const emaj7 = quartal(parseChord("Emaj7"), null, SWING_RANGE)!;
    expect(emaj7.map((n) => n % 12)).not.toContain(5); // no F over E
  });

  it("plays pedal figures over a long run on one bass note", () => {
    const vamp = { ...waltzForm, id: "vamp", key: "Em", intro: undefined, ending: undefined, form: [{ label: "A", bars: Array.from({ length: 8 }, (_, i) => (i % 2 ? "F#m11/E" : "Em11")) }] };
    const s = buildSchedule(vamp, waltz, { choruses: 2, countIn: false, transpose: 0 });
    const bass = s.events.filter((e) => e.track === "bass");
    const pcs = new Set(bass.map((e) => e.notes![0] % 12));
    for (const pc of pcs) expect([4, 11]).toContain(pc); // E and its fifth
    // The bass leans on the and of 3 into the next bar.
    expect(bass.some((e) => Math.abs((e.time % 3) - (2 + 2 / 3)) < 0.08)).toBe(true);
  });
});

describe("styles by meter", () => {
  it("offers only styles that play the chart's meter", () => {
    expect(stylesFor(waltzForm).map((s) => s.id)).toEqual(["waltz"]);
    expect(stylesFor(swingForm).map((s) => s.id)).not.toContain("waltz");
    expect(stylesFor(swingForm).map((s) => s.id)).not.toContain("five");
    expect(stylesFor(swingForm).length).toBe(Object.keys(STYLES).length - 2);
    expect(playsMeter(STYLES.swing, 4)).toBe(true);
    expect(playsMeter(STYLES.swing, 3)).toBe(false);
  });
  it("falls back to the chart's own style", () => {
    expect(playableStyle(waltzForm, "swing")).toBe("waltz");
    expect(playableStyle(swingForm, "waltz")).toBe("swing");
    expect(playableStyle(swingForm, "bossa")).toBe("bossa");
    expect(playableStyle(swingForm, "nope")).toBe("swing");
  });
  it("loads a remembered style that can't play the chart as the chart's own", () => {
    const store = new Map<string, string>([[tuneKey(waltzForm.id), JSON.stringify({ style: "swing" })]]);
    const g = globalThis as unknown as { localStorage?: unknown };
    const before = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} };
    try {
      expect(loadSettings(waltzForm).style).toBe("waltz");
    } finally {
      g.localStorage = before;
    }
  });
});

describe("4/4 is unchanged", () => {
  it("keeps the swing fixture's schedule", () => {
    const s = buildSchedule(swingForm, STYLES.swing, { choruses: 2, countIn: true, transpose: 0 });
    expect(s.beatsPerBar).toBe(4);
    expect(s.beats.slice(0, 8).map((b) => b.click)).toEqual([true, false, true, false, true, true, true, true]);
    expect([s.bars.length, s.totalBeats, s.beats.length]).toEqual([72, 288, 288]);
    expect(s.beats.map((b) => b.time)).toEqual(Array.from({ length: 288 }, (_, i) => i));
  });
});
