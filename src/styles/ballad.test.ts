import { describe, expect, it } from "vitest";
import type { Chart } from "../chart/types";
import { balladForm } from "../fixtures";
import { buildSchedule } from "../engine/schedule";
import { BASS_RELEASE, PIANO_RELEASE, ballad } from "./ballad";

const chart = balladForm;
const schedule = buildSchedule(chart, ballad, { choruses: 2, countIn: false, transpose: 0 });
const inBar = (index: number, track: string) =>
  schedule.events.filter((e) => e.track === track && e.time >= index * 4 - 0.05 && e.time < index * 4 + 3.95);
const formBar = (chorus: number, section: number, bar: number) =>
  schedule.bars.find((b) => b.chorus === chorus && b.ref?.part === "form" && b.ref.section === section && b.ref.bar === bar)!;

describe("ballad style", () => {
  it("plays half notes in the first chorus's A sections and walks later", () => {
    const first = inBar(formBar(1, 0, 0).index, "bass"); // Ebmaj7, a whole bar
    expect(first.map((e) => Math.round(e.time % 4) % 4)).toEqual([0, 2]);
    expect(first[0].notes![0] % 12).toBe(3); // Eb
    // Walking: four quarters on the beats (a triplet skip may sit between them).
    const onBeats = (index: number) => inBar(index, "bass").filter((e) => Math.abs(e.time - Math.round(e.time)) < 0.05).length;
    expect(onBeats(formBar(2, 0, 0).index)).toBe(4);
    expect(onBeats(formBar(1, 2, 0).index)).toBe(4); // the bridge walks
  });

  it("has no guitar", () => {
    expect(schedule.events.some((e) => e.track === "guitar")).toBe(false);
  });

  it("rolls each chord change on the piano from the bottom up", () => {
    const bar = formBar(1, 0, 1); // Gm7 C7
    const onThree = inBar(bar.index, "piano").filter((e) => Math.abs((e.time % 4) - 2) < 0.2);
    const notes = onThree.slice(0, 4).map((e) => e.notes![0]);
    expect(notes).toEqual([...notes].sort((a, b) => a - b));
    expect(onThree[3].time).toBeGreaterThan(onThree[0].time);
  });

  it("sweeps on 1 and 3 and strokes 2 and 4 with brushes", () => {
    const drums = inBar(formBar(1, 0, 1).index, "drums");
    expect(drums.filter((e) => e.drum === "brush").map((e) => Math.round(e.time % 4) % 4)).toEqual([0, 2]);
    expect(drums.filter((e) => e.drum === "brushTap").map((e) => Math.round(e.time % 4))).toEqual([1, 3]);
    expect(drums.some((e) => e.drum === "ride" || e.drum === "snare")).toBe(false);
  });

  it("keeps every piano note more than a whole step above any bass note sounding with it, releases included", () => {
    const beats = (seconds: number) => (seconds * chart.tempo) / 60;
    for (const variation of ["varied", "straight"] as const)
      for (let transpose = -5; transpose <= 6; transpose++) {
        const s = buildSchedule(chart, ballad, { choruses: 3, countIn: false, transpose, variation });
        const bass = s.events.filter((e) => e.track === "bass");
        for (const p of s.events.filter((e) => e.track === "piano"))
          for (const b of bass)
            if (b.time < p.time + p.duration + beats(PIANO_RELEASE) && b.time + b.duration + beats(BASS_RELEASE) > p.time)
              expect(Math.min(...p.notes!)).toBeGreaterThan(b.notes![0] + 2);
      }
  });

  it("plays each chord of the last bar and holds the last, the bass with the piano", () => {
    const twoChordEnd: Chart = { ...chart, id: "ballad-end-test", ending: [{ label: "End", bars: ["Fm7 Bb7", "Bb7 Ebmaj7"] }] };
    const s = buildSchedule(twoChordEnd, ballad, { choruses: 1, countIn: false, transpose: 0 });
    const last = s.bars.at(-1)!;
    const at = (name: string) => s.events.filter((e) => e.track === name && e.time >= last.startBeat - 0.05);
    const piano = at("piano");
    const second = piano.filter((e) => e.time >= last.startBeat + 1.9);
    expect(piano.length).toBe(8); // two rolled chords of four notes
    expect(second.map((e) => e.notes![0] % 12)).toEqual(expect.arrayContaining([2, 7, 10])); // Ebmaj7's D, G, Bb
    expect(Math.min(...second.map((e) => e.duration))).toBeGreaterThanOrEqual(3.5);
    const bass = at("bass");
    expect(bass.map((e) => e.notes![0] % 12)).toEqual([10, 3]);
    // The sampler fades a note longer than its sample inside the sample (src/audio/sprite.ts), so the bass holds as long as the piano.
    expect(bass[1].duration).toBeCloseTo(Math.max(...second.map((e) => e.time + e.duration)) - bass[1].time, 1);
  });

  it("resolves every approach into a chord by a half or whole step", () => {
    for (let transpose = -5; transpose <= 6; transpose++) {
      const s = buildSchedule(chart, ballad, { choruses: 3, countIn: false, transpose });
      const bass = s.events.filter((e) => e.track === "bass");
      const onsets = s.bars.flatMap((b) => b.chords.filter((c) => c.attack).map((c) => b.startBeat + c.beat));
      for (let k = 1; k < bass.length; k++) {
        if (!onsets.some((at) => Math.abs(bass[k].time - at) < 0.2)) continue;
        const [from, to] = [bass[k - 1].notes![0], bass[k].notes![0]];
        const step = (((to - from) % 12) + 12) % 12;
        // A note a half or whole step from the chord's first note (either side) must sit right next to it, not an octave away.
        if (step === 1 || step === 2 || step === 10 || step === 11) expect(Math.abs(to - from)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("walks a different line through the same bar from chorus to chorus", () => {
    const s = buildSchedule(chart, ballad, { choruses: 4, countIn: false, transpose: 0 });
    const bass = s.events.filter((e) => e.track === "bass");
    const lines = new Map<string, string[]>();
    for (const b of s.bars) {
      if (b.ref?.part !== "form" || b.final) continue;
      const key = `${b.ref.section}.${b.ref.bar}`;
      const line = bass.filter((e) => e.time >= b.startBeat - 0.15 && e.time < b.startBeat + 3.85).map((e) => e.notes![0]).join(" ");
      lines.set(key, [...(lines.get(key) ?? []), line]);
    }
    // Places in the form where two choruses play the same line (17 of 32 before the landing noise and `vary`).
    const repeating = [...lines.values()].filter((l) => new Set(l).size < l.length).length;
    expect(lines.size).toBe(32);
    expect(repeating).toBeLessThanOrEqual(8);
  });
});
