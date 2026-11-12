import { describe, expect, it } from "vitest";
import { swingForm, waltzForm } from "../fixtures";
import { STYLES } from "../styles";
import { seededRandom } from "../styles/random";
import { buildSchedule } from "./schedule";
import { drumSolo, tradeLabel } from "./trading";

const base = { countIn: false, transpose: 0, intro: false, ending: false } as const;
const swing = STYLES.swing;
const waltz = STYLES.waltz;
const inBars = (bpb: number, from: number, to: number) => (e: { time: number }) => e.time >= from * bpb && e.time < to * bpb;

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
    const traded = inBars(4, 36, 40);
    expect(plain.events.some((e) => e.track === "bass" && traded(e))).toBe(true);
    for (const t of ["bass", "piano", "guitar"] as const) expect(s.events.some((e) => e.track === t && traded(e))).toBe(false);
    const drums = s.events.filter((e) => e.track === "drums" && traded(e));
    expect(drums.length).toBeGreaterThan(10);
    expect(drums.every((e) => e.velocity >= 0.2 && e.velocity <= 0.7)).toBe(true);
    for (let bar = 36; bar < 40; bar++) {
      expect(drums.some((e) => e.drum === "pedal" && e.time === bar * 4 + 1)).toBe(true);
      expect(drums.some((e) => e.drum === "pedal" && e.time === bar * 4 + 3)).toBe(true);
    }
    // The soloist's bars keep the band, and the downbeat back has a crash.
    expect(s.events.some((e) => e.track === "bass" && inBars(4, 40, 44)(e))).toBe(true);
    expect(s.events.some((e) => e.drum === "crash" && e.time === 40 * 4)).toBe(true);
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
    expect(out.events.filter(inBars(4, 36, 40))).toHaveLength(0);
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
    const bar = s.events.filter((e) => e.time >= first && e.time < first + 3);
    expect(bar.every((e) => e.track === "drums")).toBe(true);
    expect(bar.some((e) => e.drum === "pedal" && e.time === first + 1)).toBe(true);
    expect(bar.some((e) => e.drum === "pedal" && e.time === first + 2)).toBe(true);
  });

  it("builds a solo that gets louder and fills at the end", () => {
    const hits = drumSolo([0, 4, 8, 12], 4, seededRandom(3));
    const mean = (a: number, b: number) => {
      const v = hits.filter((h) => h.time >= a && h.time < b && h.drum !== "pedal").map((h) => h.velocity);
      return v.reduce((x, y) => x + y, 0) / v.length;
    };
    expect(mean(12, 16)).toBeGreaterThan(mean(0, 4));
    expect(hits.filter((h) => h.time >= 14 && h.time < 16 && h.drum !== "pedal")).toHaveLength(6);
  });
});
