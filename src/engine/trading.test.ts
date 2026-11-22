import { describe, expect, it } from "vitest";
import { swingForm, waltzForm } from "../fixtures";
import { STYLES } from "../styles";
import { seededRandom } from "../styles/random";
import { buildSchedule } from "./schedule";
import { drumSolo, tradeLabel, type SoloFeel } from "./trading";

const base = { countIn: false, transpose: 0, intro: false, ending: false } as const;
const swing = STYLES.swing;
const waltz = STYLES.waltz;
const inBars = (bpb: number, from: number, to: number) => (e: { time: number }) => e.time >= from * bpb && e.time < to * bpb;
// Notes sit a few ms off the grid, so a traded run (and the bar after it) starts just before its downbeat.
const inSolo = (bpb: number, from: number, to: number) => (e: { time: number }) => e.time >= from * bpb - 0.06 && e.time < to * bpb - 0.06;
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) < tol;

describe("trading with the drums", () => {
  it("leaves the schedule alone when off", () => {
    const a = buildSchedule(swingForm, swing, { ...base, choruses: 3 });
    const b = buildSchedule(swingForm, swing, { ...base, choruses: 3, trade: "off" });
    expect(b.events).toEqual(a.events);
    expect(b.bars.some((x) => x.trade)).toBe(false);
  });

  it("trades fours in the solo choruses only", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: 3, trade: "fours" });
    const turn = (n: number) => s.bars[n].trade;
    // Chorus 1 and 3 are heads: untouched. Chorus 2 (bars 32 to 63): four, four.
    expect(s.bars.slice(0, 32).some((b) => b.trade)).toBe(false);
    expect(s.bars.slice(64).some((b) => b.trade)).toBe(false);
    expect([turn(32), turn(35), turn(36), turn(39), turn(40), turn(44)]).toEqual(["you", "you", "drums", "drums", "you", "drums"]);
    expect(s.bars.slice(32, 64).filter((b) => b.trade === "drums")).toHaveLength(16);
  });

  it("drops the band in the drums' bars and plays a solo with the foot on 2 and 4", () => {
    const plain = buildSchedule(swingForm, swing, { ...base, choruses: 3 });
    const s = buildSchedule(swingForm, swing, { ...base, choruses: 3, trade: "fours" });
    const traded = inSolo(4, 36, 40);
    expect(plain.events.some((e) => e.track === "bass" && traded(e))).toBe(true);
    for (const t of ["bass", "piano", "guitar"] as const) expect(s.events.some((e) => e.track === t && traded(e))).toBe(false);
    const drums = s.events.filter((e) => e.track === "drums" && inSolo(4, 36, 40)(e));
    expect(drums.length).toBeGreaterThan(10);
    expect(drums.every((e) => e.velocity >= 0.2 && e.velocity <= 0.7)).toBe(true);
    for (let bar = 36; bar < 40; bar++) {
      expect(drums.some((e) => e.drum === "pedal" && near(e.time, bar * 4 + 1))).toBe(true);
      expect(drums.some((e) => e.drum === "pedal" && near(e.time, bar * 4 + 3))).toBe(true);
    }
    // The soloist's bars keep the band, and the downbeat back has a crash.
    expect(s.events.some((e) => e.track === "bass" && inBars(4, 40, 44)(e))).toBe(true);
    expect(s.events.some((e) => e.drum === "crash" && near(e.time, 40 * 4))).toBe(true);
    // The last bar fills with toms.
    expect(drums.some((e) => e.drum === "tomLow" && e.time >= 39 * 4 + 2)).toBe(true);
  });

  it("shortens a note that would ring into a traded bar", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: 3, trade: "fours" });
    const start = 36 * 4;
    for (const e of s.events) if (e.track !== "drums" && e.time < start) expect(e.time + e.duration).toBeLessThanOrEqual(start + 1e-9);
  });

  it("is the same each time", () => {
    const a = buildSchedule(swingForm, swing, { ...base, choruses: 3, trade: "eights" });
    const b = buildSchedule(swingForm, swing, { ...base, choruses: 3, trade: "eights" });
    expect(b.events).toEqual(a.events);
  });

  it("trades eights, and leaves the band out in fours with no drums", () => {
    const e = buildSchedule(swingForm, swing, { ...base, choruses: 3, trade: "eights" });
    const expected = [...Array(8).fill("you"), ...Array(8).fill("drums"), ...Array(8).fill("you"), ...Array(8).fill("drums")];
    expect(e.bars.slice(32, 64).map((b) => b.trade)).toEqual(expected);
    const out = buildSchedule(swingForm, swing, { ...base, choruses: 3, trade: "fours-out" });
    expect(out.bars[36].trade).toBe("out");
    expect(out.events.filter(inSolo(4, 36, 40))).toHaveLength(0);
    expect(tradeLabel("fours-out", "out")).toBe("Band out");
  });

  it("follows the head and solos in choruses until stopped and in loops", () => {
    const loop = buildSchedule(swingForm, swing, { ...base, choruses: "loop", trade: "fours" });
    expect(loop.bars.slice(0, 32).some((b) => b.trade)).toBe(false);
    expect(loop.bars[36].trade).toBe("drums");
    const sec = buildSchedule(swingForm, swing, { ...base, choruses: 1, loopSection: 0, trade: "fours" });
    expect(sec.bars[4].trade).toBe("drums");
  });

  it("leaves the intro and ending alone", () => {
    const s = buildSchedule(swingForm, swing, { ...base, intro: true, ending: true, choruses: 3, trade: "fours" });
    expect(s.bars.filter((b) => b.ref?.part !== "form").some((b) => b.trade)).toBe(false);
  });

  it("works in 3/4 with the foot on 2 and 3", () => {
    const s = buildSchedule(waltzForm, waltz, { ...base, choruses: 3, trade: "fours" });
    const drumsBars = s.bars.filter((b) => b.trade === "drums");
    expect(drumsBars.length).toBeGreaterThan(0);
    const first = drumsBars[0].startBeat;
    const bar = s.events.filter((e) => e.time >= first && e.time < first + 3 - 0.05);
    expect(bar.every((e) => e.track === "drums")).toBe(true);
    expect(bar.some((e) => e.drum === "pedal" && near(e.time, first + 1))).toBe(true);
    expect(bar.some((e) => e.drum === "pedal" && near(e.time, first + 2))).toBe(true);
  });

  it("builds a solo that gets louder and fills at the end", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const hits = drumSolo([0, 4, 8, 12], 4, seededRandom(seed), { style: "swing", bpm: 160 });
      const mean = (a: number, b: number) => {
        const v = hits.filter((h) => h.time >= a - 0.05 && h.time < b - 0.05 && h.drum !== "pedal").map((h) => h.velocity);
        return v.reduce((x, y) => x + y, 0) / v.length;
      };
      expect(mean(14, 16)).toBeGreaterThan(mean(0, 14));
      // The fill: two beats of triplets, the kick on the last.
      const fill = hits.filter((h) => h.time >= 14 - 0.05 && h.drum !== "pedal");
      expect(fill.length).toBeGreaterThanOrEqual(6);
      expect(fill.some((h) => h.drum === "kick" && near(h.time, 15 + 2 / 3))).toBe(true);
    }
  });
});

const solo = (feel: SoloFeel, seed: number, bars = 4, bpb = 4) => drumSolo(Array.from({ length: bars }, (_, i) => i * bpb), bpb, seededRandom(seed), feel);
const hands = (h: { drum?: string }) => h.drum !== "pedal" && h.drum !== "hat" && h.drum !== "brush";
const FEELS: [SoloFeel, number][] = [
  [{ style: "swing", bpm: 160 }, 4],
  [{ style: "swing", bpm: 260 }, 4],
  [{ style: "bossa", bpm: 140 }, 4],
  [{ style: "waltz", bpm: 150 }, 3],
  [{ style: "five", bpm: 170 }, 5],
  [{ style: "ballad", bpm: 66 }, 4],
];

describe("the drum solo", () => {
  it("opens with a confident first bar, on the downbeat with the kick", () => {
    for (const [feel, bpb] of FEELS)
      for (let seed = 1; seed <= 20; seed++) {
        for (const bars of [4, 8]) {
          const first = solo(feel, seed, bars, bpb).filter((h) => h.time < bpb - 0.05 && hands(h));
          expect(first.length).toBeGreaterThanOrEqual(feel.style === "ballad" ? 3 : bpb === 3 ? 4 : 5);
          expect(first.some((h) => h.drum === "kick" && near(h.time, 0))).toBe(true);
        }
      }
  });

  it("puts the bossa solo on a straight 16th grid, never triplets, with the hat in eighths", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const hits = solo({ style: "bossa", bpm: 140 }, seed, 8);
      // 25 ms at 140 BPM is 0.058 of a beat; a triplet is 0.083 from the nearest 16th.
      const limit = (25 / 1000) * (140 / 60);
      for (const h of hits) {
        const off = h.time * 4 - Math.round(h.time * 4);
        expect(Math.abs(off / 4)).toBeLessThan(limit);
      }
      expect(hits.filter((h) => h.drum === "hat" && h.time < 4 - 0.05).length).toBeGreaterThanOrEqual(6);
      expect(hits.some((h) => h.drum === "rim")).toBe(true);
    }
  });

  it("has human timing within 25 ms of the grid, tighter at fast tempos", () => {
    const spread = (bpm: number) => {
      const ms: number[] = [];
      for (let seed = 1; seed <= 10; seed++)
        for (const h of solo({ style: "bossa", bpm }, seed, 8)) ms.push(((h.time * 4 - Math.round(h.time * 4)) / 4) * (60 / bpm) * 1000);
      expect(Math.max(...ms.map(Math.abs))).toBeLessThanOrEqual(25);
      expect(ms.filter((m) => Math.abs(m) > 1).length).toBeGreaterThan(ms.length / 2);
      return Math.sqrt(ms.reduce((a, m) => a + m * m, 0) / ms.length);
    };
    expect(spread(260)).toBeLessThan(spread(120));
    // Swing: every hit within 25 ms of a triplet or the swung and.
    for (const bpm of [120, 200]) {
      const ratio = 0.7;
      const beat = (25 / 1000) * (bpm / 60);
      for (let seed = 1; seed <= 10; seed++)
        for (const h of solo({ style: "swing", bpm, swing: ratio }, seed, 8)) {
          const f = h.time - Math.floor(h.time);
          expect(Math.min(...[0, 1 / 3, 2 / 3, ratio, 1].map((g) => Math.abs(f - g)))).toBeLessThan(beat);
        }
    }
  });

  it("puts the swung ands at the swing ratio", () => {
    const ands = (swing: number) => {
      const f: number[] = [];
      for (let seed = 1; seed <= 20; seed++)
        for (const h of solo({ style: "swing", bpm: 140, swing }, seed)) {
          const x = h.time - Math.floor(h.time);
          if (x > 0.6 && x < 0.85 && h.drum !== "kick") f.push(x);
        }
      return f.reduce((a, b) => a + b, 0) / f.length;
    };
    expect(ands(0.74)).toBeGreaterThan(ands(0.62) + 0.03);
  });

  it("plays mostly eighths up-tempo, with few triplets", () => {
    let triplets = 0;
    let all = 0;
    for (let seed = 1; seed <= 20; seed++)
      for (const h of solo({ style: "swing", bpm: 260 }, seed, 8).filter(hands)) {
        const x = h.time - Math.round(h.time);
        all++;
        if (Math.abs(Math.abs(x) - 1 / 3) < 0.04) triplets++;
      }
    expect(triplets / all).toBeLessThan(0.08);
  });

  it("plays the ballad soft and sparse, with brushes", () => {
    let ballad = 0;
    let swingHits = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const b = solo({ style: "ballad", bpm: 66 }, seed);
      expect(b.some((h) => h.drum === "snare" || h.drum === "tomHigh" || h.drum === "rim")).toBe(false);
      expect(b.some((h) => h.drum === "brush")).toBe(true);
      expect(b.filter((h) => h.drum === "brushTap").every((h) => h.velocity <= 0.6)).toBe(true);
      ballad += b.filter(hands).length;
      swingHits += solo({ style: "swing", bpm: 140 }, seed).filter(hands).length;
    }
    expect(ballad).toBeLessThan(swingHits * 0.75);
  });

  it("phrases in 3 in a waltz, the foot on 2 and 3", () => {
    const hits = solo({ style: "waltz", bpm: 150 }, 4, 4, 3);
    expect(hits.every((h) => h.time < 12)).toBe(true);
    for (let bar = 0; bar < 4; bar++) for (const b of [1, 2]) expect(hits.some((h) => h.drum === "pedal" && near(h.time, bar * 3 + b))).toBe(true);
  });

  it("shapes velocities with accents and ghost notes", () => {
    for (const [feel, bpb] of FEELS)
      for (let seed = 1; seed <= 10; seed++) {
        const v = solo(feel, seed, 4, bpb).filter(hands).map((h) => h.velocity);
        expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(0.2);
        expect(v.every((x) => x >= 0.2 && x <= 0.7)).toBe(true);
      }
  });

  it("is the same for one seed and differs between turns", () => {
    for (const [feel, bpb] of FEELS) expect(solo(feel, 5, 4, bpb)).toEqual(solo(feel, 5, 4, bpb));
    const pattern = (seed: number) => solo({ style: "swing", bpm: 160 }, seed).filter(hands).map((h) => `${h.drum}@${Math.round(h.time * 12)}`).join(" ");
    expect(new Set([1, 2, 3, 4, 5].map(pattern)).size).toBe(5);
  });

  it("follows the style passed to trading, and takes the groove's drum level", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: 3, trade: "fours" });
    const solos = s.events.filter((e) => e.track === "drums" && inSolo(4, 36, 40)(e));
    const groove = s.events.find((e) => e.track === "drums" && e.drum === "kick" && inBars(4, 32, 36)(e) && e.gain !== undefined);
    if (groove) expect(solos.every((e) => e.gain !== undefined)).toBe(true);
  });

});
