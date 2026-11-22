import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES, swingForm } from "../fixtures";
import { STYLES } from "../styles";
import { swingRatio } from "../styles/swing";
import type { NoteEvent } from "../styles/types";
import { BALLAD_SWING, fitUnderMelody, melodyEvents, melodySwing, parseMelody, type MelodyNote } from "./melody";
import { buildSchedule } from "./schedule";

const xml = readFileSync(fileURLToPath(new URL("../fixtures/swing-head.musicxml", import.meta.url)), "utf8");
const measures = parseMelody(xml);
const swing = STYLES.swing;
const head = { mode: "head" as const, measures };
const every = { mode: "every" as const, measures };
const base = { countIn: false, transpose: 0, melody: head };
const melodyOf = (s: ReturnType<typeof buildSchedule>) => s.events.filter((e) => e.track === "melody");

describe("parseMelody", () => {
  it("reads one list of notes per printed measure and skips rests", () => {
    expect(measures.length).toBe(12);
    expect(measures.slice(0, 4).every((m) => m.length === 0)).toBe(true);
    expect(measures[4]).toEqual([
      { midi: 72, start: 0, length: 1 },
      { midi: 76, start: 1, length: 1 },
      { midi: 79, start: 2, length: 3 },
    ]);
  });

  it("merges a tie over the barline into the first note", () => {
    expect(measures[4].at(-1)).toMatchObject({ midi: 79, length: 3 });
    expect(measures[5].some((n) => n.midi === 79)).toBe(false);
  });

  it("keeps a triplet's own length and places it after the rest", () => {
    expect(measures[5].map((n) => n.midi)).toEqual([74, 76, 77]);
    expect(measures[5].map((n) => n.start)).toEqual([expect.closeTo(2), expect.closeTo(2 + 2 / 3), expect.closeTo(2 + 4 / 3)]);
    expect(measures[5][0].length).toBeCloseTo(2 / 3);
  });

  it("resolves accidentals and plays chord notes at the same start", () => {
    expect(measures[6]).toEqual([
      { midi: 74, start: 0, length: 2 },
      { midi: 78, start: 0, length: 2 },
      { midi: 70, start: 2, length: 2 },
    ]);
  });

  it("plays voice 1 only", () => {
    expect(measures[7]).toEqual([{ midi: 72, start: 0, length: 4 }]);
  });

  it("converts a transposing part to concert pitch", () => {
    // A B-flat part: written C5 sounds B-flat 4 (two half steps down).
    const flat = xml.replace("</attributes>", "<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>");
    expect(parseMelody(flat)[4][0].midi).toBe(70);
    const octave = xml.replace("</attributes>", "<transpose><chromatic>0</chromatic><octave-change>-1</octave-change></transpose></attributes>");
    expect(parseMelody(octave)[4][0].midi).toBe(60);
  });
});

describe("melody on the timeline", () => {
  // swing-form: intro bars 1-4, then A (5-12), A (13-20), B, A, coda. Notes are printed for bars 5-12 only.
  it("takes the notes of the printed measure each playing bar is numbered as", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: 1, ending: false });
    expect(melodyOf(s).filter((e) => e.time < 16)).toEqual([]); // the intro measures are rests
    const bar5 = melodyOf(s).filter((e) => e.time >= 16 && e.time < 20);
    // Close, not equal: the melody may sit a few ms behind the beat.
    expect(bar5.map((e) => [e.notes![0], e.time - 16])).toEqual([
      [72, expect.closeTo(0, 1)],
      [76, expect.closeTo(1, 1)],
      [79, expect.closeTo(2, 1)],
    ]);
    // The tie holds into the next bar, which is the next printed measure.
    expect(bar5.at(-1)!.duration).toBeCloseTo(3.05);
  });

  it("stops a tied note at the end of its bar when the next bar isn't the next measure", () => {
    const bar = { part: "form" as const, section: 0, bar: 0 };
    const s = buildSchedule(swingForm, swing, { ...base, melody: every, choruses: 1, loopRange: { from: bar, to: bar } });
    const tied = melodyOf(s).find((e) => e.notes![0] === 79)!;
    expect(tied.duration).toBeCloseTo(2.05);
  });

  it("uses each bar's own key", () => {
    const up = buildSchedule(swingForm, swing, { ...base, transpose: 2, choruses: 1, ending: false });
    expect(melodyOf(up)[0].notes![0]).toBe(74);
    // Chorus 2 is a half step above chorus 1; its first printed notes are the ones of bar 5 again, so use every-chorus mode.
    const keyed = buildSchedule(swingForm, swing, { ...base, melody: every, keyStep: 1, choruses: 2, intro: false, ending: false });
    const inChorus2 = melodyOf(keyed).filter((e) => e.time >= 32 * 4);
    // Chorus 2's first bar is chart bar 5 + 0 again, which has the same printed notes a half step higher.
    expect(inChorus2[0].notes![0]).toBe(73);
  });

  it("plays nothing in a solo chorus, and the last chorus is a head when the song ends", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: 3, intro: false, ending: false });
    const chorus = (c: number) => melodyOf(s).filter((e) => e.time >= (c - 1) * 32 * 4 && e.time < c * 32 * 4);
    expect(chorus(1).length).toBeGreaterThan(0);
    expect(chorus(2)).toEqual([]);
    expect(chorus(3).length).toBeGreaterThan(0);
  });

  it("plays only the first chorus when the choruses repeat until stopped", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: "loop", intro: false });
    expect(melodyOf(s).filter((e) => e.time < 32 * 4).length).toBeGreaterThan(0);
    expect(melodyOf(s).filter((e) => e.time >= 32 * 4)).toEqual([]);
  });

  it("plays every chorus when asked", () => {
    const s = buildSchedule(swingForm, swing, { ...base, melody: every, choruses: 3, intro: false, ending: false });
    expect(melodyOf(s).some((e) => e.time >= 32 * 4 && e.time < 64 * 4)).toBe(true);
  });

  it("is off by default and lists the melody in the band only when it plays", () => {
    const s = buildSchedule(swingForm, swing, { countIn: false, transpose: 0, choruses: 1 });
    expect(melodyOf(s)).toEqual([]);
    expect(s.band).not.toContain("melody");
    expect(buildSchedule(swingForm, swing, { ...base, choruses: 1 }).band).toContain("melody");
    expect(melodyOf(buildSchedule(swingForm, swing, { ...base, choruses: 1, melody: { mode: "off", measures } }))).toEqual([]);
  });

  it("stays out of a looped section in head mode", () => {
    const s = buildSchedule(swingForm, swing, { ...base, choruses: 1, loopSection: 0 });
    expect(melodyOf(s)).toEqual([]);
  });

  it("stays silent on the drums' turns when trading", () => {
    const s = buildSchedule(swingForm, swing, { ...base, melody: every, choruses: 3, intro: false, ending: false, trade: "fours" });
    // Chorus 2 bars 4 to 7 (the first A's bars 5 to 8) are the drums' four: no melody there.
    const drums = melodyOf(s).filter((e) => e.time >= (32 + 4) * 4 && e.time < (32 + 8) * 4);
    expect(drums).toEqual([]);
  });
});

// Made-up notes on printed measure 5 (the first playing bar after swing-form's four intro bars, at beat 16).
const onBar5 = (notes: MelodyNote[]) => Array.from({ length: 12 }, (_, k) => (k === 4 ? notes : []));
const formBars = buildSchedule(swingForm, swing, { countIn: false, transpose: 0, choruses: 1, ending: false }).bars;
const bar5Of = (events: NoteEvent[]) => events.map((e) => ({ at: e.time - 16, length: e.duration - 0.05, midi: e.notes![0] }));
const n = (start: number, length: number, midi = 72): MelodyNote => ({ midi, start, length });

describe("melody swing", () => {
  it("plays as written without a swing ratio", () => {
    const notes = [n(0, 0.5), n(0.5, 0.5, 74), n(1, 1)];
    const ev = bar5Of(melodyEvents(swingForm, formBars, onBar5(notes), () => true));
    expect(ev.map((e) => e.at)).toEqual([0, 0.5, 1]);
  });

  it("moves offbeat eighths to the ratio and stretches the on-beat eighth before", () => {
    const notes = [n(0, 0.5), n(0.5, 0.5, 74), n(1, 1, 76), n(2, 0.5, 77), n(2.5, 1.5, 79)];
    const ev = bar5Of(melodyEvents(swingForm, formBars, onBar5(notes), () => true, { swing: 0.7 }));
    expect(ev.map((e) => e.at)).toEqual([0, expect.closeTo(0.7), 1, 2, expect.closeTo(2.7)]);
    expect(ev.map((e) => e.length)).toEqual([expect.closeTo(0.7), expect.closeTo(0.3), expect.closeTo(1), expect.closeTo(0.7), expect.closeTo(1.3)]);
  });

  it("moves a note's end when it ends on an offbeat", () => {
    const ev = bar5Of(melodyEvents(swingForm, formBars, onBar5([n(0, 1.5), n(1.5, 0.5, 74)]), () => true, { swing: 2 / 3 }));
    expect(ev[0].length).toBeCloseTo(1 + 2 / 3);
    expect(ev[1].at).toBeCloseTo(1 + 2 / 3);
  });

  it("leaves triplets, quarters and beats of 16ths alone", () => {
    const t = 1 / 3;
    const notes = [n(0, t), n(t, t, 74), n(2 * t, t, 76), n(1, 0.25), n(1.25, 0.25, 74), n(1.5, 0.25, 76), n(1.75, 0.25, 77), n(2, 1), n(3, 1)];
    const ev = bar5Of(melodyEvents(swingForm, formBars, onBar5(notes), () => true, { swing: 0.7 }));
    expect(ev.map((e) => e.at)).toEqual(notes.map((x) => expect.closeTo(x.start)));
    expect(ev.map((e) => e.length)).toEqual(notes.map((x) => expect.closeTo(x.length)));
  });

  it("gives each style the band's ratio", () => {
    expect(melodySwing("swing", 140)).toBe(swingRatio(140));
    expect(melodySwing("swing", 140)).toBeGreaterThan(0.69);
    expect(melodySwing("swing", 280)).toBeCloseTo(0.57);
    expect(melodySwing("waltz", 140)).toBeCloseTo(2 / 3);
    expect(melodySwing("five", 140)).toBeCloseTo(2 / 3);
    expect(melodySwing("ballad", 60)).toBe(BALLAD_SWING);
    expect(melodySwing("bossa", 140)).toBe(0.5);
    expect(melodySwing("unknown", 140)).toBe(0.5);
  });
});

describe("melody timing", () => {
  const notes = [n(0, 0.5), n(0.5, 0.5, 74), n(1, 1, 76), n(2, 1, 72), n(2, 1, 76), n(3, 1, 79)];
  const lagsMs = (bpm: number, seed?: number) => {
    const ev = melodyEvents(swingForm, formBars, onBar5(notes), () => true, { bpm, seed });
    return ev.map((e, k) => ((e.time - 16 - notes[k].start) * 60 * 1000) / bpm);
  };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it("sits a few ms behind the beat, a little differently each note", () => {
    const ms = lagsMs(140);
    expect(ms.every((x) => x >= 0 && x <= 22)).toBe(true);
    expect(mean(ms)).toBeGreaterThan(5);
    expect(mean(ms)).toBeLessThan(15);
    expect(new Set(ms.map((x) => x.toFixed(3))).size).toBeGreaterThan(3);
  });

  it("is the same for the same seed and plays a chord together", () => {
    expect(lagsMs(140)).toEqual(lagsMs(140));
    expect(lagsMs(140, 5)).not.toEqual(lagsMs(140, 6));
    const ms = lagsMs(140);
    expect(ms[3]).toBeCloseTo(ms[4]);
  });

  it("lays back less at fast tempos", () => {
    const many = (bpm: number) => [1, 2, 3, 4, 5, 6, 7, 8].flatMap((seed) => lagsMs(bpm, seed));
    expect(mean(many(240))).toBeLessThan(mean(many(80)));
    expect(Math.max(...many(240))).toBeLessThanOrEqual(10.01);
  });
});

describe("fitUnderMelody", () => {
  const lead = (time: number, midi: number, duration = 1): NoteEvent => ({ track: "melody", time, duration, velocity: 0.6, notes: [midi] });
  const piano = (time: number, notes: number[], duration = 1, extra: Partial<NoteEvent> = {}): NoteEvent => ({ track: "piano", time, duration, velocity: 0.5, notes, ...extra });
  const bassNote = (time: number, midi: number, duration = 1): NoteEvent => ({ track: "bass", time, duration, velocity: 0.8, notes: [midi] });
  const lowSeconds = (notes: number[]) => notes.slice(1).filter((n, i) => notes[i] < 55 && n - notes[i] < 3).length;
  const ascending = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

  it("re-voices the whole chord under the melody, nearest the original", () => {
    // Melody Ab4 over an A-D-F-A voicing: the A4 rubs.
    const levels = [0.9, 0.95, 1, 1.12];
    const offsets = [0, 0.002, 0.004, 0.006];
    const [out] = fitUnderMelody([piano(0, [57, 62, 65, 69], 1, { levels, offsets })], [lead(0, 68)]);
    expect(out.notes).toEqual([57, 62, 65]);
    expect(out.offsets).toEqual([0, 0.002, 0.004]); // low to high, as written
    expect(out.levels).toEqual([0.9, 0.95, 1.12]); // the top voice keeps the top level
  });

  it("keeps the whole chord's pitch classes when a voicing fits", () => {
    const [out] = fitUnderMelody([piano(0, [60, 64, 67, 71])], [lead(0, 72)]);
    expect(out.notes!.map((n) => n % 12).sort((a, b) => a - b)).toEqual([0, 4, 7, 11]);
    expect(Math.max(...out.notes!)).toBeLessThanOrEqual(70);
    expect(ascending(out.notes!)).toBe(true);
    expect(lowSeconds(out.notes!)).toBe(0);
  });

  it("stays a minor third clear of the bass", () => {
    const [out] = fitUnderMelody([piano(0, [50, 55, 59, 64]), bassNote(0, 50)], [lead(0, 64)]);
    expect(Math.min(...out.notes!)).toBeGreaterThanOrEqual(53);
    expect(Math.max(...out.notes!)).toBeLessThanOrEqual(62);
  });

  it("drops top notes instead of making a cluster when nothing fits", () => {
    // Between a bass on A3 and a melody on D4 there is no room for a voicing: only the C4 stays.
    const [out] = fitUnderMelody([piano(0, [60, 64, 67]), bassNote(0, 57)], [lead(0, 62)]);
    expect(out.notes).toEqual([60]);
    // Nothing left at all: the chord goes, the bass stays.
    expect(fitUnderMelody([piano(0, [64, 67]), bassNote(0, 60)], [lead(0, 64)])).toEqual([bassNote(0, 60)]);
  });

  it("re-voices a roll written as single notes and keeps it rolling up", () => {
    const roll = [53, 57, 60, 65].map((n, k) => piano(0.01 + k * 0.025, [n], 2 - k * 0.025, { velocity: k === 3 ? 0.48 : 0.38 }));
    const out = fitUnderMelody(roll, [lead(0.5, 64)]);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(ascending(out.map((e) => e.time))).toBe(true);
    expect(ascending(out.map((e) => e.notes![0]))).toBe(true);
    expect(Math.max(...out.map((e) => e.notes![0]))).toBeLessThanOrEqual(62);
    expect(out.at(-1)!.velocity).toBe(0.48);
    expect(out.map((e) => e.time)).toEqual(roll.slice(0, out.length).map((e) => e.time));
  });

  it("leaves chords that don't sound with the melody or sit under it, other tracks, and its input alone", () => {
    const events: NoteEvent[] = [
      piano(0, [60, 64, 67], 0.97),
      piano(4, [55, 59, 62]),
      { track: "bass", time: 1, duration: 1, velocity: 0.8, notes: [80] },
      { track: "drums", drum: "ride", time: 1, duration: 0.25, velocity: 0.5 },
    ];
    const copy = structuredClone(events);
    const out = fitUnderMelody(events, [lead(1, 62, 2.05), lead(4, 64)]);
    expect(events).toEqual(copy);
    expect(out).toEqual(events); // the first ends as the melody starts (the legato tail doesn't count)
  });

  // A made-up melody, one note a beat, moving around the comping's top.
  const tuneOver = (beats: number) => Array.from({ length: Math.floor(beats) }, (_, k) => lead(k + 0.01, 62 + ((k * 7) % 11), 1.05));

  for (const chart of FIXTURES) {
    it(`keeps ${chart.style}'s comping under the melody, clear of the bass, without new clusters`, () => {
      const s = buildSchedule(chart, STYLES[chart.style], { countIn: false, transpose: 0, choruses: 1 });
      const tune = tuneOver(s.totalBeats);
      const out = fitUnderMelody(s.events, tune);
      const before = new Set(s.events);
      const changed = out.filter((e) => !before.has(e));
      expect(changed.length).toBeGreaterThan(0);
      const bass = s.events.filter((e) => e.track === "bass");
      const with_ = (list: NoteEvent[], e: NoteEvent) => list.filter((m) => Math.min(e.time + e.duration, m.time + m.duration) - Math.max(e.time, m.time) >= 0.06);
      for (const e of out.filter((x) => x.track === "piano" || x.track === "guitar")) {
        for (const m of with_(tune, e)) expect(Math.max(...e.notes!)).toBeLessThanOrEqual(m.notes![0] - 2);
      }
      for (const e of changed) {
        expect(ascending(e.notes!)).toBe(true);
        expect(lowSeconds(e.notes!)).toBe(0);
        for (const b of with_(bass, e)) expect(Math.min(...e.notes!)).toBeGreaterThan(b.notes![0] + 2);
        if (e.levels) expect(e.levels.length).toBe(e.notes!.length);
        if (e.offsets) {
          expect(e.offsets.length).toBe(e.notes!.length);
          const source = s.events.find((x) => x.track === e.track && x.time === e.time && x.offsets)!;
          const rising = source.offsets!.every((o, i) => i === 0 || o >= source.offsets![i - 1]);
          if (rising) expect(e.offsets.every((o, i) => i === 0 || o >= e.offsets![i - 1])).toBe(true);
        }
      }
      // Re-voiced rolls (single notes a few ms apart) still go up, with no seconds low down.
      const singles = changed.filter((e) => e.track === "piano" && e.notes!.length === 1).sort((a, b) => a.time - b.time);
      if (chart.style === "ballad") expect(singles.length).toBeGreaterThan(0);
      let group: NoteEvent[] = [];
      const check = () => {
        const pitches = group.map((e) => e.notes![0]);
        expect(ascending(pitches)).toBe(true);
        expect(lowSeconds(pitches)).toBe(0);
      };
      for (const e of singles) {
        if (group.length && e.time - group.at(-1)!.time > 0.04) {
          check();
          group = [];
        }
        group.push(e);
      }
      if (group.length) check();
      expect(out.filter((x) => x.track === "drums" || x.track === "bass")).toEqual(s.events.filter((x) => x.track === "drums" || x.track === "bass"));
    });
  }
});
