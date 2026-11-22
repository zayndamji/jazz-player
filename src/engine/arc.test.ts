import { describe, expect, it } from "vitest";
import { FIXTURES, bossaForm, fiveForm, swingForm, waltzForm } from "../fixtures";
import { STYLES, playsMeter } from "../styles";
import { swing } from "../styles/swing";
import { RING_SECONDS, buildSchedule, chorusLayoutChanges, performanceBeats, ringSeconds, ritardAt, ritardDepth, ritardFor } from "./schedule";
import { chorusTranspose, playOrder, tonicChord } from "./timeline";

const base = { countIn: false, transpose: 0 } as const;

describe("ending without the ending", () => {
  it("is in the last chorus's key, and minor keys end on m6", () => {
    const s = buildSchedule(bossaForm, STYLES.bossa, { ...base, choruses: 3, ending: false, keyStep: 5 });
    const last = s.bars.at(-1)!;
    expect(last.transpose).toBe(chorusTranspose(0, 5, 3));
    expect(last.chords[0].chord.root).toBe((0 + chorusTranspose(0, 5, 3) + 12) % 12);
    const minor = buildSchedule(waltzForm, STYLES.waltz, { ...base, choruses: 1, ending: false });
    expect(minor.bars.at(-1)!.chords[0].chord.symbol).toBe("Dm6");
  });

  it("ends a blues on its tonic seventh", () => {
    const blues = { ...swingForm, key: "F", form: [{ label: "A", bars: ["F7", "Bb7", "F7", "%", "Bb7", "%", "F7", "D7", "Gm7", "C7", "F7 D7", "Gm7 C7"] }], ending: undefined };
    expect(tonicChord(blues)).toBe("F7");
    expect(tonicChord({ ...blues, form: [{ label: "A", bars: ["F13", "Bb7"] }] })).toBe("F13");
    expect(tonicChord({ ...blues, form: [{ label: "A", bars: ["Fmaj7", "Bb7"] }] })).toBe("F6");
    expect(tonicChord({ ...blues, form: [{ label: "A", bars: ["Gm7", "C7"] }] })).toBe("F6");
    const s = buildSchedule(blues, swing, { ...base, choruses: 2 });
    expect(s.bars.at(-1)!.tonic && s.bars.at(-1)!.chords[0].chord.symbol).toBe("F7");
  });

  it("is never added to a loop or a song with its ending", () => {
    expect(buildSchedule(bossaForm, STYLES.bossa, { ...base, choruses: 2 }).bars.some((b) => b.tonic)).toBe(false);
    expect(buildSchedule(bossaForm, STYLES.bossa, { ...base, choruses: "loop", ending: false }).bars.some((b) => b.tonic || b.final)).toBe(false);
    expect(buildSchedule(bossaForm, STYLES.bossa, { ...base, choruses: 2, ending: false, loopSection: 0 }).bars.some((b) => b.tonic)).toBe(false);
  });

  it("counts in the readout's length and the progress order, and leaves the chorus layout alone", () => {
    const s = buildSchedule(bossaForm, STYLES.bossa, { ...base, choruses: 2, ending: false, intro: false });
    expect(performanceBeats(bossaForm, { choruses: 2, countInBars: 0, ending: false, intro: false })).toBe(s.totalBeats + 2);
    const order = playOrder(bossaForm, 2, false, false, true);
    expect(order).toHaveLength(s.bars.length);
    expect(order.at(-1)!.tonic).toBe(true);
    expect(chorusLayoutChanges(bossaForm, 2, 3, 2)).toBe(false);
  });

  it("builds in every style that plays the chart, with finite notes", () => {
    for (const chart of FIXTURES) {
      for (const style of Object.values(STYLES).filter((st) => playsMeter(st, chart.beatsPerBar))) {
        const s = buildSchedule(chart, style, { ...base, choruses: 2, ending: false });
        const last = s.bars.at(-1)!;
        expect(last.final && last.tonic).toBe(true);
        expect(s.events.every((e) => Number.isFinite(e.time) && e.time < s.totalBeats + 1)).toBe(true);
        expect(s.events.some((e) => e.time >= last.startBeat)).toBe(true);
      }
    }
  });
});

describe("the final chord rings", () => {
  it("holds the last piano, guitar and bass notes under the final ring at any tempo, and leaves the drums alone", () => {
    for (const chart of [swingForm, bossaForm, fiveForm]) {
      for (const tempo of [60, 140, 260]) {
        for (const ending of [true, false]) {
          const s = buildSchedule(chart, STYLES[chart.style], { ...base, choruses: 2, tempo, ending });
          const last = s.bars.at(-1)!;
          for (const track of s.band.filter((t) => ["piano", "guitar", "bass"].includes(t))) {
            const notes = s.events.filter((e) => e.track === track);
            const start = Math.max(...notes.map((e) => e.time));
            const lastNotes = notes.filter((e) => e.time >= start - 0.12);
            expect(lastNotes.length, `${chart.id} ${track} at ${tempo}`).toBeGreaterThan(0);
            for (const e of lastNotes) {
              const seconds = ((e.time + e.duration - last.startBeat) * 60) / tempo;
              expect(seconds, `${chart.id} ${track} at ${tempo}, ending ${ending}`).toBeGreaterThanOrEqual(RING_SECONDS - 1e-6);
            }
          }
          // The drums keep the lengths the style wrote (a hit's sample rings by itself).
          expect(s.events.filter((e) => e.track === "drums" && e.time >= last.startBeat).every((e) => e.duration < 1)).toBe(true);
        }
      }
    }
  });

  it("leaves a looping schedule's notes alone", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: "loop", tempo: 260 });
    expect(s.events.every((e) => e.time + e.duration < s.totalBeats + 3)).toBe(true);
  });
});

describe("the ritard into the final hit", () => {
  const song = (tempo: number, extra: Partial<Parameters<typeof buildSchedule>[2]> = {}) => buildSchedule(swingForm, swing, { ...base, countIn: true, choruses: 2, tempo, ...extra });

  it("slows about 10 percent at ballad tempos and up to 14 at fast ones, with no dip", () => {
    for (const bpm of [40, 56, 60, 70, 80, 90]) {
      expect(ritardDepth(bpm)).toBeGreaterThanOrEqual(0.08);
      expect(ritardDepth(bpm)).toBeLessThanOrEqual(0.12);
    }
    expect(ritardDepth(140)).toBeGreaterThan(0.1);
    expect(ritardDepth(140)).toBeLessThan(0.13);
    expect(ritardDepth(260)).toBeCloseTo(0.14);
    // Never less at a faster tempo, and no jumps.
    for (let bpm = 41; bpm <= 320; bpm += 1) {
      expect(ritardDepth(bpm)).toBeGreaterThanOrEqual(ritardDepth(bpm - 1));
      expect(ritardDepth(bpm) - ritardDepth(bpm - 1)).toBeLessThan(0.002);
    }
  });

  it("covers the bar before the final bar, two bars when fast, and ends on its downbeat", () => {
    for (const [tempo, bars] of [[56, 1], [140, 1], [260, 2]] as const) {
      const s = song(tempo);
      const r = ritardFor(s, tempo)!;
      const last = s.bars.at(-1)!;
      expect(r.to).toBe(last.startBeat);
      expect(r.to - r.from).toBe(bars * 4);
      expect(r.factor).toBeCloseTo(1 - ritardDepth(tempo));
    }
  });

  it("never slows a loop, choruses until stopped or Live before it ends, nor into the count-in", () => {
    expect(ritardFor(song(140, { choruses: "loop" }), 140)).toBeNull();
    expect(ritardFor(song(140, { loopSection: 0 }), 140)).toBeNull();
    expect(ritardFor(song(140, { choruses: "loop", liveEnd: 2 }), 140)).not.toBeNull();
    const ending = song(140).bars.filter((b) => b.ref?.part === "ending");
    const onLast = song(140, { start: { ref: ending.at(-1)!.ref!, chorus: 0 } });
    expect(ritardFor(onLast, 140)).toBeNull();
    const nearEnd = song(260, { start: { ref: ending.at(-2)!.ref!, chorus: 0 } });
    expect(ritardFor(nearEnd, 260)!.from).toBe(2 * 4);
  });

  it("lands the final downbeat where a linear ramp in time takes it, from the start or mid-way", () => {
    for (const tempo of [56, 90, 140, 260]) {
      const r = ritardFor(song(tempo), tempo)!;
      const start = ritardAt(r, tempo, r.from);
      expect(start.bpm).toBe(tempo);
      expect(start.target).toBeCloseTo(tempo * r.factor);
      // Integrate the ramp: tempo linear in time from the start to the target over `seconds`.
      const beatsBy = (t: number) => (t / 60) * (tempo + ((start.target - tempo) * t) / (2 * start.seconds));
      expect(beatsBy(start.seconds)).toBeCloseTo(r.to - r.from, 6);
      // Half way through the beats, the tempo and the time left agree with the same ramp.
      const mid = (r.from + r.to) / 2;
      const m = ritardAt(r, tempo, mid);
      const tMid = ((m.bpm - tempo) / (start.target - tempo)) * start.seconds;
      expect(beatsBy(tMid)).toBeCloseTo(mid - r.from, 6);
      expect(tMid + m.seconds).toBeCloseTo(start.seconds, 6);
      // In the final bar the slowed tempo holds.
      expect(ritardAt(r, tempo, r.to + 1)).toEqual({ bpm: start.target, seconds: 0, target: start.target });
      // The end-of-song wait is still at least the ring, in seconds, at the slowed tempo.
      expect(ringSeconds(4, start.target)).toBeGreaterThanOrEqual(RING_SECONDS);
    }
  });
});
