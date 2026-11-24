import { describe, expect, it } from "vitest";
import type { Chart } from "../chart/types";
import { bossaForm, latinForm, swingForm } from "../fixtures";
import { bandFor, buildSchedule, type Schedule } from "../engine/schedule";
import type { TimelineBar } from "../engine/timeline";
import { STYLES } from ".";
import { CASCARA, CLAVE, claveSide, latin } from "./latin";
import { isFormEnd } from "./context";
import type { NoteEvent } from "./types";

const play = (chart: Chart, styleId = chart.style, extra = {}) => buildSchedule(chart, STYLES[styleId], { choruses: 3, countIn: false, transpose: 0, ...extra });

/** The events that start in a bar (a note played a little early belongs to the bar after). */
const inBar = (s: Schedule, bar: TimelineBar, track: NoteEvent["track"]) =>
  s.events.filter((e) => e.track === track && e.time >= bar.startBeat - 0.12 && e.time < bar.startBeat + s.beatsPerBar - 0.12);

/** Eighth slot of an event in its bar. */
const slotOf = (bar: TimelineBar, e: NoteEvent) => Math.round((e.time - bar.startBeat) * 2);

/** Bars of the form away from section ends (no fills there) and not the final hit. */
const middleBars = (s: Schedule) =>
  s.bars.filter((b, i) => b.ref?.part === "form" && !b.final && !isFormEnd(b, s.bars[i + 1]) && s.bars[i + 1]?.ref?.section === b.ref.section && !(i > 0 && isFormEnd(s.bars[i - 1], b)));

describe("latin style", () => {
  it("plays the clave on the cross-stick and the cascara on the ride or bell", () => {
    const s = play(bossaForm, "latin");
    for (const bar of middleBars(s)) {
      const side = claveSide(bar, bar.index);
      const drums = inBar(s, bar, "drums");
      const cymbal = drums.filter((e) => e.drum === "ride" || e.drum === "bell").map((e) => slotOf(bar, e));
      expect(cymbal.every((slot) => CASCARA[side].some(([c]) => c === slot)), `bar ${bar.index}: ${cymbal}`).toBe(true);
      const rims = drums.filter((e) => e.drum === "rim").map((e) => slotOf(bar, e));
      // The clave, or the conga's slap on 2 when the left hand plays the tumbao.
      expect(rims.join() === CLAVE[side].join() || rims.join() === "2", `bar ${bar.index}: ${rims}`).toBe(true);
    }
  });

  it("plays the bass on the and of 2 and 4, with beat 1 only when nothing anticipated it", () => {
    const s = play(bossaForm, "latin");
    let tumbao = 0;
    for (const bar of middleBars(s)) {
      if (bar.chords.some((c) => c.attack && (c.beat === 1 || c.beat === 3))) continue;
      const slots = inBar(s, bar, "bass").map((e) => slotOf(bar, e));
      expect(slots.filter((x) => x !== 0)).toEqual([3, 6]);
      if (!slots.includes(0)) tumbao++;
    }
    expect(tumbao).toBeGreaterThan(10);
  });

  it("anticipates the next bar's root on beat 4 in the tumbao", () => {
    const s = play(bossaForm, "latin", { variation: "straight" });
    for (const bar of middleBars(s)) {
      const next = s.bars[bar.index + 1];
      const four = inBar(s, bar, "bass").find((e) => slotOf(bar, e) === 6)!;
      expect(four.notes![0] % 12).toBe(next.chords[0].chord.bass);
    }
  });

  it("anticipates chords with the piano on the and of 4", () => {
    const s = play(bossaForm, "latin", { variation: "straight" });
    for (const bar of middleBars(s)) {
      const next = s.bars[bar.index + 1];
      const pushed = inBar(s, bar, "piano").find((e) => slotOf(bar, e) === 7);
      if (!pushed) continue;
      // The pushed hit plays the next bar's chord (its tones, 9th and 13th), not this one's, when it changes.
      const chord = next.chords[0].chord;
      if (chord.symbol === bar.chords.at(-1)!.chord.symbol) continue;
      const allowed = new Set([...chord.intervals, 2, 9].map((iv) => (chord.root + iv) % 12));
      expect(pushed.notes!.every((n) => allowed.has(n % 12)), `bar ${bar.index} ${chord.symbol} ${pushed.notes}`).toBe(true);
    }
  });

  it("ends on the final chord, held", () => {
    const s = play(latinForm);
    const last = s.bars.at(-1)!;
    expect(last.final).toBe(true);
    const bass = inBar(s, last, "bass");
    expect(bass.at(-1)!.time + bass.at(-1)!.duration).toBeGreaterThan(last.startBeat + 3);
    expect(inBar(s, last, "drums").some((e) => e.drum === "crash")).toBe(true);
  });
});

describe("sections in their own style", () => {
  const bridge = (b: TimelineBar) => b.ref?.part === "form" && b.ref.section === 2;
  const aSection = (b: TimelineBar) => b.ref?.part === "form" && b.ref.section !== 2 && !b.final;

  it("plays the bridge in swing and the A sections in Latin", () => {
    const s = play(latinForm);
    expect(s.bars.filter(bridge).every((b) => b.style === "swing")).toBe(true);
    expect(s.bars.filter(aSection).every((b) => b.style === "latin")).toBe(true);
    // The swing bridge walks: a bass note on most beats, none of the tumbao's ands.
    for (const bar of s.bars.filter(bridge)) {
      const slots = inBar(s, bar, "bass").map((e) => slotOf(bar, e));
      expect(slots.length, `bar ${bar.index}`).toBeGreaterThanOrEqual(3);
      expect(slots.includes(3), `bar ${bar.index}: ${slots}`).toBe(false);
      expect(inBar(s, bar, "drums").some((e) => e.drum === "bell" || (e.drum === "rim" && slotOf(bar, e) === 3))).toBe(false);
    }
    // The Latin A's never walk on 2.
    for (const bar of s.bars.filter(aSection)) {
      if (bar.chords.some((c) => c.attack && (c.beat === 1 || c.beat === 3))) continue;
      expect(inBar(s, bar, "bass").some((e) => slotOf(bar, e) === 2), `bar ${bar.index}`).toBe(false);
    }
  });

  it("strikes beat 1 of the first Latin bar after the swing bridge", () => {
    const s = play(latinForm);
    for (const bar of s.bars.filter((b, i) => aSection(b) && i > 0 && bridge(s.bars[i - 1])))
      expect(inBar(s, bar, "bass").some((e) => slotOf(bar, e) === 0), `bar ${bar.index}`).toBe(true);
  });

  it("stops notes ringing from one style into the other", () => {
    const s = play(latinForm);
    for (const bar of s.bars.filter((b, i) => bridge(b) && i > 0 && !bridge(s.bars[i - 1]))) {
      const ringing = s.events.filter((e) => e.track !== "drums" && e.time < bar.startBeat - 0.12 && e.time + e.duration > bar.startBeat + 0.1);
      expect(ringing).toEqual([]);
    }
  });

  it("brings the other style's notes to the chosen style's mix", () => {
    const s = play(latinForm);
    const bar = s.bars.find(bridge)!;
    const swingBass = inBar(s, bar, "bass");
    const expected = 10 ** (((STYLES.swing.mix?.bass ?? 0) - (latin.mix?.bass ?? 0)) / 20);
    for (const e of swingBass) expect(e.gain).toBeCloseTo(expected, 6);
  });

  it("plays the whole tune in another style when one is chosen", () => {
    const s = play(latinForm, "swing");
    expect(s.bars.filter((b) => !b.countIn).every((b) => b.style === "swing")).toBe(true);
    expect(s.events.some((e) => e.drum === "bell")).toBe(false);
  });

  it("brings a section style's parts into the band", () => {
    const withBossa: Chart = { ...swingForm, form: swingForm.form.map((sec, k) => (k === 2 ? { ...sec, style: "bossa" } : sec)) };
    expect(bandFor(withBossa, STYLES.swing)).toContain("guitar");
    expect(bandFor(withBossa, STYLES.ballad)).not.toContain("guitar");
    const s = play(withBossa);
    const guitar = s.events.filter((e) => e.track === "guitar");
    expect(guitar.length).toBeGreaterThan(0);
    expect(guitar.every((e) => s.bars[Math.floor(e.time / 4 + 0.03)].style === "bossa")).toBe(true);
  });

  it("trades in the style of the bars traded over", () => {
    const s = play(latinForm, "latin", { choruses: 3, trade: "fours" });
    const traded = s.bars.filter((b) => b.trade === "drums");
    expect(traded.length).toBeGreaterThan(0);
    // The swing bridge's drum solo swings (offbeats late), the Latin bars' is on the straight sixteenth grid.
    const offsets = (bars: TimelineBar[]) =>
      bars.flatMap((b) => inBar(s, b, "drums").map((e) => ((e.time - b.startBeat) * 4) % 1)).filter((x) => x > 0.22 && x < 0.78);
    const latinTraded = traded.filter((b) => b.style === "latin");
    expect(latinTraded.length).toBeGreaterThan(0);
    expect(offsets(latinTraded).length).toBe(0);
  });
});
