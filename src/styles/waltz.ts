import { SWING_RANGE, voiceChord } from "../engine/voicing";
import { pianoTouch } from "./feel";
import { seededRandom } from "./random";
import { shapeBars } from "./shape";
import { endsSection, isFormEnd, nearest, swingRatio, walk } from "./swing";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * A basic jazz waltz in 3/4 (a first version to build on):
 * - Bass: a dotted half on the root in the first chorus (the fifth or an approach on 3 in some bars),
 *   a walking quarter line from the second chorus and in contrasting sections.
 * - Piano: short rootless chords on 2 and 3, or on the and of 1 and on 3, or one on 2.
 * - Drums: ride on 1, 2, the and of 2 and 3, hi-hat foot on 2 and 3, a feathered kick on 1,
 *   a snare now and then, a small fill at phrase and section ends, a crash after the form.
 * Every event starts inside its bar and ends by the bar's end (except the final chord).
 */
const BAR = 3;

export const waltz: Style = {
  id: "waltz",
  name: "Jazz waltz",
  band: ["bass", "piano", "drums"],
  meters: [3],
  mix: { bass: 9, piano: 2.5, drums: 2.5 },
  generate(bars, seed, feel) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    /** A small late nudge in beats, never early, so nothing leaves its bar. */
    const late = () => random() * 0.015;
    const events: NoteEvent[] = [];
    const sw = swingRatio(feel.tempo);
    const music = bars.filter((b) => !b.countIn);
    const shapes = shapeBars(music, random, true);

    /** A note length that ends inside the bar starting at `start`. */
    const inBar = (start: number, time: number, duration: number) => Math.max(0.05, Math.min(duration, start + BAR - time - 0.04));
    const drum = (start: number, at: number, sound: DrumSound, velocity: number, spread = 0.08) => {
      events.push({ track: "drums", drum: sound, time: start + at + late(), duration: 0.25, velocity: human(velocity, spread) });
    };

    let piano: number[] | null = null;
    let bassNote = 40;

    music.forEach((bar, i) => {
      const t = bar.startBeat;
      const next = music[i + 1];
      const shape = shapes[i];
      const level = shape.intensity;

      if (bar.final) {
        const chord = bar.chords[0]?.chord;
        if (!chord) return;
        piano = voiceChord(chord, piano, SWING_RANGE);
        events.push({ track: "piano", time: t, duration: 5, velocity: 0.55, notes: piano, ...pianoTouch(piano, random, true) });
        events.push({ track: "bass", time: t, duration: 5, velocity: 0.8, notes: [nearest(chord.bass, bassNote)] });
        drum(t, 0, "ride", 0.6, 0);
        drum(t, 0, "crash", 0.34, 0);
        return;
      }

      // Bass.
      const waltzing = bar.chorus <= 1 && !bar.contrast;
      bar.chords.forEach((c, k) => {
        const following = bar.chords[k + 1] ?? next?.chords[0];
        const target = following && following.chord !== c.chord ? nearest(following.chord.bass, bassNote) : null;
        const at = t + c.beat;
        if (waltzing && c.length >= 3) {
          const root = nearest(c.chord.bass, bassNote);
          const second = random() < 0.4;
          events.push({ track: "bass", time: at + late(), duration: second ? 1.95 : 2.9, velocity: human(0.8 * level), notes: [root] });
          bassNote = root;
          if (second) {
            const step = c.chord.intervalNames.includes("5d") ? 6 : 7;
            const n = target !== null && random() < 0.5 ? target + (random() < 0.5 ? -1 : 1) : nearest((c.chord.root + step) % 12, root);
            events.push({ track: "bass", time: at + 2 + late(), duration: 0.9, velocity: human(0.7 * level), notes: [n] });
            bassNote = n;
          }
          return;
        }
        if (waltzing) {
          const root = nearest(c.chord.bass, bassNote);
          events.push({ track: "bass", time: at + late(), duration: inBar(t, at, c.length * 0.95), velocity: human(0.78 * level), notes: [root] });
          bassNote = root;
          return;
        }
        const line = walk(c.chord, c.length, bassNote, target, random);
        line.forEach((n, b) =>
          events.push({ track: "bass", time: at + b + late(), duration: inBar(t, at + b, 0.95), velocity: human((b === 0 ? 0.8 : 0.7) * level), notes: [n] }),
        );
        bassNote = line.at(-1)!;
      });

      // Piano: short chords after the downbeat. One chord in the bar: 2 and 3, the and of 1 and 3, or only 2.
      const cell = random();
      for (const c of bar.chords) {
        piano = voiceChord(c.chord, piano, SWING_RANGE);
        const soft = !c.attack ? 0.6 : 1;
        const offsets = c.beat === 0 && c.length >= 2 ? (cell < 0.45 ? [1, 2] : cell < 0.8 ? [sw, 2] : [1]) : [0];
        for (const b of offsets) {
          if (b >= c.length) continue;
          const time = t + c.beat + b;
          const notes = piano;
          events.push({
            track: "piano",
            time: time + late(),
            duration: inBar(t, time, b === 1 && offsets.length === 1 ? 1.6 : 0.7),
            velocity: human(0.5 * level * soft),
            notes,
            ...pianoTouch(notes, random),
          });
        }
      }

      // Drums.
      const fill = endsSection(bar, next) && !next?.final;
      const big = isFormEnd(bar, next) && fill;
      const small = shape.phraseEnd && !fill && random() < 0.5;
      const rideEnd = fill ? 2 : BAR;
      const ride: [number, number][] = random() < 0.7 ? [[0, 0.55], [1, 0.6], [1 + sw, 0.36], [2, 0.58]] : [[0, 0.55], [1, 0.6], [2, 0.58], [2 + sw, 0.34]];
      for (const [at, v] of ride) if (at < rideEnd - 0.01) drum(t, at, "ride", v * level, 0.18);
      for (const b of [1, 2]) if (b < rideEnd || random() < 0.5) drum(t, b, "pedal", b === 1 ? 0.32 : 0.26, 0.1);
      drum(t, 0, "kick", 0.1 * level, 0.04);
      if (fill) {
        const hits: [number, DrumSound, number][] = big
          ? [[2, "snare", 0.34], [2 + 1 / 3, "tomHigh", 0.38], [2 + 2 / 3, "tomLow", 0.44]]
          : [[2, "snare", 0.3], [2 + 1 / 3, "snare", 0.34], [2 + 2 / 3, "snare", 0.4]];
        for (const [at, s, v] of hits) drum(t, at, s, v * level, 0.1);
        drum(t, 1, "snare", 0.24 * level, 0.1);
      } else if (small) {
        drum(t, 2 + sw * 0.5, "snare", 0.3 * level, 0.1);
      } else if (random() < 0.25) {
        drum(t, 1 + sw, "snare", 0.18 * level, 0.1);
      }
      const prev = music[i - 1];
      if (prev && isFormEnd(prev, bar) && bar.chorus > 1) drum(t, 0, "crash", 0.24, 0.03);
    });

    return events.sort((a, b) => a.time - b.time);
  },
};
