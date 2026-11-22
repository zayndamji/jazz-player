import { describe, expect, it } from "vitest";
import type { Chart } from "../chart/types";
import { bossaForm, balladForm, swingForm } from "../fixtures";
import { buildSchedule, type Schedule } from "../engine/schedule";
import type { NoteEvent } from "./types";
import { plane, planeScale, scalePcs, swing } from "./swing";
import { parseChord } from "../chart/chords";
import { POCKETS, jitterAt } from "./feel";

const pc = (n: number) => ((n % 12) + 12) % 12;
const bassOf = (s: Schedule) => s.events.filter((e) => e.track === "bass").sort((a, b) => a.time - b.time);
const onBeat = (e: NoteEvent) => Math.abs(e.time - Math.round(e.time)) < 0.05;
/** The on-beat bass notes of a bar, by beat. */
const beats = (s: Schedule, index: number) => {
  const out: number[] = [];
  for (const e of bassOf(s)) if (onBeat(e) && e.time >= index * 4 - 0.05 && e.time < index * 4 + 3.95) out[Math.round(e.time) - index * 4] = e.notes![0];
  return out;
};

/** A made-up modal chart: long-held minor chords, eight bars each. */
const vamp: Chart = {
  ...swingForm,
  id: "vamp",
  title: "Vamp (test)",
  key: "Dm",
  intro: undefined,
  form: [
    { label: "A", bars: ["Dm7", "%", "%", "%", "%", "%", "%", "%"] },
    { label: "B", bars: ["Ebm7", "%", "%", "%", "%", "%", "%", "%"] },
  ],
  ending: [{ label: "Coda", bars: ["Dm7"] }],
};
/** A made-up minor II-V: D7 into G minor. */
const minor: Chart = {
  ...swingForm,
  id: "minor",
  title: "Minor (test)",
  key: "Gm",
  intro: undefined,
  form: [{ label: "A", bars: ["Am7b5", "D7", "Gm7", "%", "Cm7", "F7", "Bbmaj7", "Ebmaj7", "Am7b5", "D7", "Gm7", "Gm7"] }],
  ending: [{ label: "Coda", bars: ["Am7b5 D7", "Gm7"] }],
};

const takes: [string, Schedule][] = [];
for (const chart of [swingForm, bossaForm, balladForm, vamp, minor])
  for (const twoFeel of [false, true])
    for (const tempo of [chart.tempo, 260])
      for (const variation of ["varied", "straight"] as const)
        takes.push([`${chart.id} two=${twoFeel} ${tempo} ${variation}`, buildSchedule(chart, swing, { choruses: 4, countIn: false, transpose: 0, twoFeel, tempo, variation })]);

describe("swing bass lines", () => {
  it("resolves every chromatic or scale approach by step, never across a leap", () => {
    const check = (name: string, events: NoteEvent[]) => {
      const bass = events.filter((e) => e.track === "bass").sort((a, b) => a.time - b.time);
      for (let k = 0; k + 1 < bass.length; k++) {
        const a = bass[k].notes![0];
        const b = bass[k + 1].notes![0];
        // A half or whole step as pitch classes is a step in the line too, never a seventh or a ninth.
        const step = Math.min(pc(a - b), pc(b - a));
        if (step === 1 || step === 2) expect(Math.abs(a - b), `${name} at ${bass[k].time.toFixed(2)}: ${a} to ${b}`).toBeLessThanOrEqual(2);
      }
    };
    for (const [name, s] of takes) check(name, s.events);
    // More takes at 140 and 280 BPM, as the style generates them for other seeds.
    for (const chart of [swingForm, bossaForm, balladForm, minor])
      for (const tempo of [140, 280])
        for (const twoFeel of [false, true]) {
          const bars = buildSchedule(chart, swing, { choruses: 5, countIn: false, transpose: 0, tempo, twoFeel }).bars;
          for (let seed = 1; seed <= 6; seed++) check(`${chart.id} ${tempo} two=${twoFeel} seed ${seed}`, swing.generate(bars, seed, { tempo, twoFeel, variation: "varied" }));
        }
  });

  it("keeps every bass note between an upright's low E and G3", () => {
    for (const [, s] of takes) for (const e of bassOf(s)) {
      expect(e.notes![0]).toBeGreaterThanOrEqual(28);
      expect(e.notes![0]).toBeLessThanOrEqual(55);
    }
  });

  it("never walks the same four notes two bars running", () => {
    for (const [name, s] of takes) {
      let last = "";
      for (const bar of s.bars.filter((b) => !b.final)) {
        const line = beats(s, bar.index);
        const key = line.length === 4 && line.every((n) => n !== undefined) ? line.join(",") : "";
        if (key) expect(key, `${name} bar ${bar.index}`).not.toBe(last);
        last = key;
      }
    }
  });

  it("walks a long-held chord as one line: other chord tones on the downbeats, climbing above D3", () => {
    const s = buildSchedule(vamp, swing, { choruses: 4, countIn: false, transpose: 0 });
    const held = s.bars.filter((b) => b.chords.length === 1 && !b.chords[0].attack && !b.final);
    const downbeats = held.map((b) => ({ n: beats(s, b.index)[0], root: b.chords[0].chord.root }));
    const off = downbeats.filter(({ n, root }) => pc(n) !== root).length / downbeats.length;
    expect(off).toBeGreaterThan(0.25);
    expect(off).toBeLessThan(0.85);
    const notes = bassOf(s).map((e) => e.notes![0]);
    expect(Math.max(...notes)).toBeGreaterThanOrEqual(52);
    // The downbeats of a section still land on the root.
    for (const b of s.bars.filter((b) => b.ref?.part === "form" && b.ref.bar === 0)) expect(pc(beats(s, b.index)[0])).toBe(b.chords[0].chord.root);
  });

  it("over D7 into G minor walks Phrygian dominant: no B natural", () => {
    const s = buildSchedule(minor, swing, { choruses: 4, countIn: false, transpose: 0 });
    const d7 = s.bars.filter((b) => b.chords.length === 1 && b.chords[0].chord.symbol === "D7");
    expect(d7.length).toBeGreaterThan(4);
    for (const b of d7) for (const e of bassOf(s).filter((e) => e.time >= b.startBeat - 0.05 && e.time < b.startBeat + 3.9)) expect(pc(e.notes![0])).not.toBe(11);
    expect(scalePcs(parseChord("D7"), parseChord("Gm7"))).toEqual([2, 3, 6, 7, 9, 10, 0]);
  });
});

describe("swing piano over a vamp", () => {
  const s = buildSchedule(vamp, swing, { choruses: 4, countIn: false, transpose: 0 });
  const hits = s.events.filter((e) => e.track === "piano" && e.notes!.length >= 3).sort((a, b) => a.time - b.time);
  const dm = hits.filter((e) => {
    const bar = s.bars[Math.floor((e.time + 0.1) / 4)];
    const after = s.bars[Math.floor((e.time + 0.1) / 4) + 1];
    return bar && bar.chords[0].chord.symbol === "Dm7" && !bar.final && after?.chords[0]?.chord.symbol === "Dm7";
  });

  it("planes the voicing along the scale instead of repeating one shape", () => {
    expect(new Set(dm.map((e) => e.notes!.join(","))).size).toBeGreaterThanOrEqual(8);
    const dorian = [2, 4, 5, 7, 9, 11, 0];
    for (const e of dm) for (const n of e.notes!) expect(dorian).toContain(pc(n));
  });

  it("never plays one voicing three hits running", () => {
    for (let k = 2; k < hits.length; k++) {
      const [a, b, c] = [hits[k - 2], hits[k - 1], hits[k]].map((e) => e.notes!.slice(0, 4).join(","));
      expect(a === b && b === c, `hits at ${hits[k].time.toFixed(2)}`).toBe(false);
    }
  });

  it("moves a shape by scale steps", () => {
    expect(plane([53, 57, 60, 64], [2, 4, 5, 7, 9, 11, 0], 1)).toEqual([55, 59, 62, 65]);
    expect(plane([53, 57, 60, 64], [2, 4, 5, 7, 9, 11, 0], -1)).toEqual([52, 55, 59, 62]);
  });
});

describe("swing ending", () => {
  const ends: Chart = { ...swingForm, ending: [{ label: "Coda", bars: ["C6", "Fm6 C6"] }] };
  const s = buildSchedule(ends, swing, { choruses: 1, countIn: false, transpose: 0 });
  const last = s.bars.at(-1)!;
  const inLast = (track: string) => s.events.filter((e) => e.track === track && e.time >= last.startBeat - 0.1);

  it("plays each chord of the last bar and holds the last one as a fermata", () => {
    const bass = inLast("bass").sort((a, b) => a.time - b.time);
    expect(bass.map((e) => pc(e.notes![0]))).toEqual([5, 0]);
    const piano = inLast("piano").sort((a, b) => a.time - b.time);
    const final = piano.at(-1)!;
    expect(final.time).toBeGreaterThan(last.startBeat + 1.9);
    expect(final.duration).toBeGreaterThanOrEqual(4);
    // C6 voiced: E, G, A, D (the 6/9).
    for (const n of final.notes!) expect([4, 7, 9, 2, 0]).toContain(pc(n));
    expect(bass.at(-1)!.duration).toBeGreaterThanOrEqual(4);
    expect(inLast("drums").some((e) => e.drum === "crash" && e.time > last.startBeat + 1.9)).toBe(true);
  });
});

describe("swing ride level", () => {
  // The ride's level in each bar, in dB: gain times the kit's velocity curve (drumkit.ts).
  const level = (s: Schedule, index: number) => {
    const v = s.events.filter((e) => (e.drum === "ride" || e.drum === "hat") && e.time >= index * 4 - 0.1 && e.time < index * 4 + 3.9).map((e) => (e.gain ?? 1) * (0.45 + 0.55 * e.velocity));
    return v.length ? 20 * Math.log10(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const chorusLevel = (s: Schedule, chorus: number) => {
    const l = s.bars.filter((b) => b.chorus === chorus && b.ref?.part === "form").map((b) => level(s, b.index)).filter((x): x is number => x !== null);
    return l.reduce((a, b) => a + b, 0) / l.length;
  };

  for (const twoFeel of [false, true]) {
    it(`rises into the solos over a few bars, not at one barline${twoFeel ? " (two-feel head)" : ""}`, () => {
      const s = buildSchedule(swingForm, swing, { choruses: 5, countIn: false, transpose: 0, twoFeel });
      const first = s.bars.find((b) => b.chorus === 2)!.index;
      const before = [level(s, first - 2), level(s, first - 1)].filter((x): x is number => x !== null);
      const after = [level(s, first), level(s, first + 1)].filter((x): x is number => x !== null);
      const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
      expect(mean(after) - mean(before)).toBeLessThan(3);
      const peak = Math.max(...[2, 3, 4].map((c) => chorusLevel(s, c)));
      expect(peak - chorusLevel(s, 1)).toBeLessThan(6.5);
      expect(peak - chorusLevel(s, 1)).toBeGreaterThan(2);
    });
  }
});

/** A made-up eight-bar vamp on one chord. */
const held = (symbol: string): Chart => ({
  ...swingForm,
  id: `held-${symbol}`,
  title: "Held (test)",
  intro: undefined,
  form: [{ label: "A", bars: [symbol, "%", "%", "%", "%", "%", "%", "%"] }],
  ending: [{ label: "Coda", bars: [symbol] }],
});

describe("swing planing leaves out avoid notes", () => {
  it("keeps the 3rd off sus chords, the 11 off chords with a 3rd, and the b9 off unless called for", () => {
    const pcs = (s: string, next?: string) => planeScale(parseChord(s), next ? parseChord(next) : null);
    expect(pcs("C7sus4")).not.toContain(4);
    expect(pcs("C11")).not.toContain(4);
    expect(pcs("Cmaj7")).not.toContain(5);
    expect(pcs("C7")).not.toContain(5);
    expect(pcs("C7")).not.toContain(1);
    expect(pcs("C7b9")).toContain(1);
    expect(pcs("C7", "Fm7")).toContain(1); // Phrygian dominant into minor
    expect(pcs("Dm7")).toEqual([2, 4, 5, 7, 9, 11, 0]);
  });

  for (const [symbol, avoid] of [["C7sus4", [4]], ["C11", [4]], ["Cmaj7", [5]], ["C7", [5, 1]], ["Bb7", [3, 11]]] as const) {
    it(`never sounds ${avoid.join(" or ")} over a held ${symbol}`, () => {
      const s = buildSchedule(held(symbol), swing, { choruses: 4, countIn: false, transpose: 0 });
      const hits = s.events.filter((e) => e.track === "piano" && e.notes!.length >= 3);
      expect(new Set(hits.map((e) => e.notes!.join())).size).toBeGreaterThanOrEqual(6); // it still planes
      for (const e of hits) for (const n of e.notes!) expect(avoid as readonly number[], `${symbol} at ${e.time.toFixed(2)}: ${e.notes}`).not.toContain(pc(n));
    });
  }
});

describe("swing bass and piano", () => {
  it("keeps the bass a minor third or more under the piano chord sounding over it", () => {
    for (const [name, s] of [...takes, ...["C7sus4", "Dm7"].map((c): [string, Schedule] => [c, buildSchedule(held(c), swing, { choruses: 4, countIn: false, transpose: 0 })])]) {
      const bass = bassOf(s);
      for (const p of s.events.filter((e) => e.track === "piano" && e.notes!.length > 1)) {
        const low = Math.min(...p.notes!);
        for (const b of bass)
          if (b.time < p.time + p.duration && b.time + b.duration > p.time) expect(b.notes![0], `${name}: bass ${b.notes} at ${b.time.toFixed(2)} under piano ${p.notes} at ${p.time.toFixed(2)}`).toBeLessThanOrEqual(low - 3);
      }
    }
  });

  it("still climbs above D3 through a long held chord", () => {
    const s = buildSchedule(vamp, swing, { choruses: 4, countIn: false, transpose: 0 });
    expect(Math.max(...bassOf(s).map((e) => e.notes![0]))).toBeGreaterThan(50);
  });
});

describe("swing bass from chorus to chorus", () => {
  // The share of distinct lines among the choruses at each place in the form (1: every chorus differs).
  // Before the lines varied their landing octave, contour and approach side, these fixtures measured 0.56 to 0.68.
  const variety = (s: Schedule) => {
    const lines = new Map<string, string[]>();
    for (const b of s.bars.filter((b) => b.ref?.part === "form")) {
      const line = beats(s, b.index);
      if (line.length !== 4 || line.some((n) => n === undefined)) continue;
      const key = `${b.ref!.section}.${b.ref!.bar}`;
      lines.set(key, [...(lines.get(key) ?? []), line.join()]);
    }
    const all = [...lines.values()];
    return all.reduce((a, x) => a + new Set(x).size / x.length, 0) / all.length;
  };
  for (const chart of [swingForm, bossaForm, balladForm])
    it(`walks the same bar differently in most choruses over ${chart.id}`, () => {
      expect(variety(buildSchedule(chart, swing, { choruses: 8, countIn: false, transpose: 0 }))).toBeGreaterThan(0.7);
    });
});

describe("swing ride timing", () => {
  // Each ride hit's error from its bar's own mean (taking out the band's slow drift), in ms.
  const spread = (bpm: number) => {
    const s = buildSchedule(swingForm, swing, { choruses: 4, countIn: false, transpose: 0, tempo: bpm });
    const ms = 60000 / bpm;
    const errors: number[] = [];
    for (const b of s.bars) {
      const off = s.events
        .filter((e) => e.drum === "ride" && e.time >= b.startBeat - 0.2 && e.time < b.startBeat + 3.8 && Math.abs(e.time - Math.round(e.time)) < 0.15)
        .map((e) => (e.time - Math.round(e.time)) * ms);
      if (off.length < 3) continue;
      const mean = off.reduce((a, x) => a + x, 0) / off.length;
      errors.push(...off.map((x) => x - mean));
    }
    return Math.sqrt(errors.reduce((a, x) => a + x * x, 0) / errors.length);
  };

  it("tightens with the tempo: about half the error at 260 BPM as at 140", () => {
    expect(jitterAt(POCKETS.ride, 260)).toBeCloseTo((10 * 140) / 260, 5);
    expect(jitterAt(POCKETS.ride, 600)).toBe(3);
    const medium = spread(140);
    const fast = spread(260);
    expect(medium).toBeGreaterThan(6.5);
    expect(fast).toBeLessThan(6);
    expect(fast / medium).toBeLessThan(0.7);
  });
});

describe("swing busy comping", () => {
  // Piano hits per bar in the head (first and last chorus) and the solos, over ten takes.
  const bars = buildSchedule(swingForm, swing, { choruses: 6, countIn: false, transpose: 0 }).bars;
  const perBar = (comp?: "busy" | "blues" | "sparse") => {
    let head = 0, headBars = 0, solo = 0, soloBars = 0;
    const solos: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const hits = swing.generate(bars, seed, { tempo: 140, twoFeel: false, comp, variation: "varied" }).filter((e) => e.track === "piano" && e.notes!.length > 1);
      for (const b of bars.filter((b) => b.ref?.part === "form")) {
        const n = hits.filter((e) => e.time >= b.startBeat - 0.1 && e.time < b.startBeat + 3.9).length;
        if (b.chorus === 1 || b.chorus === 6) (head += n), headBars++;
        else (solo += n), soloBars++, solos.push(n);
      }
    }
    return { head: head / headBars, solo: solo / soloBars, solos };
  };
  const busy = perBar("busy");
  const plain = perBar();

  it("comps clearly busier than the default: 3.5 to 4.5 hits a bar in the solos, a little less in the head", () => {
    expect(busy.solo).toBeGreaterThan(plain.solo * 1.4);
    expect(busy.solo).toBeGreaterThan(3.5);
    expect(busy.solo).toBeLessThan(4.5);
    expect(busy.head).toBeLessThan(busy.solo);
    expect(busy.head).toBeGreaterThan(plain.head);
  });

  it("still breathes: a busy bar is more often followed by a lighter one", () => {
    const a = busy.solos.slice(0, -1);
    const b = busy.solos.slice(1);
    const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
    const ma = mean(a), mb = mean(b);
    const corr = a.reduce((x, y, i) => x + (y - ma) * (b[i] - mb), 0) / Math.sqrt(a.reduce((x, y) => x + (y - ma) ** 2, 0) * b.reduce((x, y) => x + (y - mb) ** 2, 0));
    expect(corr).toBeLessThan(0);
  });
});
