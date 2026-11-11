import type { TimelineBar } from "../engine/timeline";
import { voiceChord } from "../engine/voicing";
import { seededRandom } from "./random";
import { endsSection, isFormEnd, nearest, twoBeat, walk } from "./swing";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Jazz ballad, slow 4/4 (about 55 to 65 BPM), triplet feel. Modelled on three
 * ballad backing tracks (context/style-ballad.md):
 * - Bass: half notes (root, then the fifth or an approach to the next chord) in
 *   the first chorus's A sections; walks in quarters in the bridge and later choruses.
 * - Piano: the only chord instrument. Rolled rootless voicings held through each
 *   chord, a soft re-attack or a short triplet arpeggio in bars with one chord.
 * - Drums: brushes. A sweep every two beats, a brush stroke and the hi-hat foot
 *   on 2 and 4, a barely-there kick; a triplet of strokes at section ends.
 */

/** Offbeats fall on the third triplet of the beat. */
const TRIPLET = 1 / 3;
/** Beats between notes of a rolled chord, low to high. */
const ROLL = 0.025;

export const ballad: Style = {
  id: "ballad",
  name: "Ballad",
  mix: { bass: 13, piano: 4, drums: 6 },
  generate(bars, seed) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.06) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const nudge = (ms = 8) => (random() - 0.5) * (ms / 1000);
    const events: NoteEvent[] = [];
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.06) =>
      events.push({ track: "drums", drum: sound, time: time + nudge(4), duration: 0.5, velocity: human(velocity, spread) });
    /** A chord rolled from the bottom up, every note held to the same end. */
    const roll = (time: number, notes: number[], length: number, velocity: number) =>
      notes.forEach((n, k) =>
        events.push({ track: "piano", time: time + k * ROLL, duration: Math.max(0.3, length - k * ROLL), velocity: human(velocity * (1 - k * 0.03)), notes: [n] }),
      );

    let piano: number[] | null = null;
    let bassNote = 39; // Eb2
    const music = bars.filter((b) => !b.countIn);

    music.forEach((bar: TimelineBar, i) => {
      const t = bar.startBeat;
      const next = music[i + 1];
      const lift = bar.chorus <= 1 ? 0.94 : 1.04;

      if (bar.final) {
        const chord = bar.chords[0]?.chord;
        if (!chord) return;
        piano = voiceChord(chord, piano);
        roll(t, piano, 6, 0.5);
        events.push({ track: "bass", time: t, duration: 6, velocity: 0.8, notes: [nearest(chord.bass, bassNote)] });
        drum(t, "brush", 0.55, 0);
        drum(t, "crash", 0.3, 0);
        return;
      }

      // Bass: half notes early on, walking once the tune opens up.
      const twoFeel = bar.chorus <= 1 && !bar.contrast;
      bar.chords.forEach((c, k) => {
        const following = bar.chords[k + 1] ?? next?.chords[0];
        const target = following ? nearest(following.chord.bass, bassNote) : null;
        if (twoFeel) {
          const changing = target !== null && following!.chord !== c.chord;
          const line = twoBeat(c.chord, c.length, bassNote, target, changing, random);
          line.forEach(([beat, n], j) =>
            events.push({ track: "bass", time: t + c.beat + beat + nudge(4), duration: j === 0 ? Math.min(c.length, 2) - 0.1 : 1.9, velocity: human(j === 0 ? 0.8 : 0.72), notes: [n] }),
          );
          bassNote = line.at(-1)![1];
          return;
        }
        const line = walk(c.chord, c.length, bassNote, target, random);
        line.forEach((n, b) => events.push({ track: "bass", time: t + c.beat + b + nudge(4), duration: 0.95, velocity: human(b === 0 ? 0.8 : 0.7), notes: [n] }));
        bassNote = line.at(-1)!;
      });

      // Piano: rolled chords held through each change.
      for (const c of bar.chords) {
        if (!c.attack && c.beat === 0) {
          // A held-over chord ("%"): touch it again softly on 1.
          piano = voiceChord(c.chord, piano);
          roll(t, piano, c.length - 0.1, 0.3 * lift);
          continue;
        }
        piano = voiceChord(c.chord, piano);
        roll(t + c.beat + nudge(6), piano, c.length - 0.05, 0.44 * lift);
      }
      if (bar.chords.length === 1 && piano) {
        const r = random();
        if (r < 0.35) {
          // A triplet arpeggio up the top of the voicing on beat 4.
          piano.slice(-3).forEach((n, k) =>
            events.push({ track: "piano", time: t + 3 + k * TRIPLET, duration: 1 - k * TRIPLET, velocity: human(0.3 * lift), notes: [n] }),
          );
        } else if (r < 0.6) {
          // A soft re-attack on the and of 2.
          roll(t + 1 + 2 * TRIPLET, piano, 2.2, 0.28 * lift);
        }
      }

      // Drums: brushes.
      const fill = endsSection(bar, next) && !next?.final;
      for (const b of [0, 2]) drum(t + b, "brush", 0.5 * lift);
      for (const b of [1, 3]) {
        if (fill && b === 3) continue;
        drum(t + b, "brushTap", 0.42 * lift);
        drum(t + b, "pedal", 0.32);
      }
      for (const b of [0, 2]) drum(t + b, "kick", 0.1, 0.03);
      if (fill) {
        const strength = isFormEnd(bar, next) ? 0.08 : 0;
        [3, 3 + TRIPLET, 3 + 2 * TRIPLET].forEach((b, k) => drum(t + b, "brushTap", 0.36 + strength + k * 0.08));
        drum(t + 3, "pedal", 0.3);
      }
      const prev = music[i - 1];
      if (prev && isFormEnd(prev, bar) && bar.chorus > 1) drum(t, "crash", 0.22, 0.03);
    });

    return events.sort((a, b) => a.time - b.time);
  },
};
