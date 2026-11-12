import type { TimelineBar } from "../engine/timeline";
import { PIANO_RANGE, voiceChord, type VoicingRange } from "../engine/voicing";
import { gauss, timing } from "./feel";
import { seededRandom } from "./random";
import { weighted } from "./shape";
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
 * - Breathing (whole-take measurements against the three references): every part in its
 *   timing pocket (feel.ts), the top of each rolled chord voiced louder, the piano's
 *   register and level moving with the phrase, the bass picking up into some bars, and
 *   a few comping and brush variations, so no two bars are the same.
 */

/** Offbeats fall on the third triplet of the beat. */
const TRIPLET = 1 / 3;
/** Beats between notes of a rolled chord, low to high. */
const ROLL = 0.025;

export const ballad: Style = {
  id: "ballad",
  name: "Ballad",
  band: ["bass", "piano", "drums"],
  // Bass leads; the upper band (piano brightness, brushes) measured 4 dB over the references.
  mix: { bass: 13, piano: 2.5, drums: 3.5 },
  generate(bars, seed, feel) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.06) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const clock = timing(random, feel?.tempo ?? 62);
    const events: NoteEvent[] = [];
    const music = bars.filter((b) => !b.countIn);
    const first = music[0]?.startBeat ?? 0;
    const place = (time: number, part: Parameters<typeof clock.at>[0]) => Math.max(first, time + clock.at(part));
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.06) =>
      events.push({ track: "drums", drum: sound, time: place(time, sound === "kick" ? "kick" : sound === "pedal" ? "pedal" : "snare"), duration: 0.5, velocity: human(velocity, spread) });
    /** A chord rolled from the bottom up, every note held to the same end; the top note sings out a little, the inner notes sit under it. */
    const roll = (time: number, notes: number[], length: number, velocity: number) => {
      const start = place(time, "piano");
      const top = notes.length - 1;
      notes.forEach((n, k) =>
        events.push({ track: "piano", time: start + k * ROLL, duration: Math.max(0.3, length - k * ROLL), velocity: human(velocity * (k === top ? 1.1 : k === 0 ? 0.98 : 0.9)), notes: [n] }),
      );
    };

    let piano: number[] | null = null;
    let bassNote = 39; // Eb2
    let register = 0;
    let phraseDb = 0;
    let slope = 0;

    music.forEach((bar: TimelineBar, i) => {
      const t = bar.startBeat;
      const next = music[i + 1];
      clock.bar();
      // The phrase breathes: each four bars hold, swell or fall back a little, and the
      // piano's hand moves up or down now and then.
      const inPhrase = (bar.ref?.bar ?? i) % 4;
      if (inPhrase === 0) {
        phraseDb = gauss(random) * 0.7;
        slope = weighted([{ weight: 0.45, value: 0 }, { weight: 0.35, value: 0.6 }, { weight: 0.2, value: -0.6 }], random);
        if (random() < 0.5) register = weighted([{ weight: 0.6, value: -3 }, { weight: 1, value: 0 }, { weight: 0.8, value: 3 }, { weight: 0.3, value: 5 }], random, register);
      }
      const lift = (bar.chorus <= 1 ? 0.94 : 1.04) * 10 ** ((phraseDb + slope * (inPhrase - 1.5) + gauss(random) * 0.5) / 20);
      const range: VoicingRange = { ...PIANO_RANGE, low: PIANO_RANGE.low + register, high: PIANO_RANGE.high + register, center: PIANO_RANGE.center + register };

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
          // Now and then a pickup into the next chord on the last triplet of 4, the second half note shortened for it.
          const pickup = changing && target !== null && c.length >= 4 && line.length === 2 && random() < 0.22;
          line.forEach(([beat, n], j) =>
            events.push({ track: "bass", time: place(t + c.beat + beat, "bass"), duration: j === 0 ? Math.min(c.length, 2) - 0.1 : pickup ? 1.55 : 1.9, velocity: human(j === 0 ? 0.8 : 0.72), notes: [n] }),
          );
          if (pickup) events.push({ track: "bass", time: place(t + c.beat + 3 + 2 * TRIPLET, "bass"), duration: TRIPLET - 0.03, velocity: human(0.56), notes: [target! + (target! > line[1][1] ? -1 : 1)] });
          bassNote = line.at(-1)![1];
          return;
        }
        const line = walk(c.chord, c.length, bassNote, target, random);
        line.forEach((n, b) => {
          // A triplet skip before the next note now and then, the ballad's swing.
          const skip = b < line.length - 1 && random() < 0.1;
          events.push({ track: "bass", time: place(t + c.beat + b, "bass"), duration: skip ? 2 * TRIPLET - 0.04 : 0.95, velocity: human((b === 0 ? 0.8 : 0.7) + gauss(random) * 0.04), notes: [n] });
          if (skip) events.push({ track: "bass", time: place(t + c.beat + b + 2 * TRIPLET, "bass"), duration: TRIPLET - 0.03, velocity: human(0.5), notes: [n] });
        });
        bassNote = line.at(-1)!;
      });

      // Piano: rolled chords held through each change.
      for (const c of bar.chords) {
        if (!c.attack && c.beat === 0) {
          // A held-over chord ("%"): touch it again softly on 1, or let it ring into the bar.
          piano = voiceChord(c.chord, piano, range);
          if (random() < 0.75) roll(t + (random() < 0.3 ? 2 * TRIPLET : 0), piano, c.length - 0.1, 0.3 * lift);
          continue;
        }
        piano = voiceChord(c.chord, piano, range);
        roll(t + c.beat, piano, c.length - 0.05, 0.44 * lift);
      }
      if (bar.chords.length === 1 && piano) {
        const chord = piano;
        const r = random();
        if (r < 0.3) {
          // A triplet arpeggio up the top of the voicing on beat 4 (or 2).
          const at = random() < 0.75 ? 3 : 1;
          chord.slice(-3).forEach((n, k) =>
            events.push({ track: "piano", time: place(t + at + k * TRIPLET, "piano"), duration: 1 - k * TRIPLET, velocity: human(0.3 * lift), notes: [n] }),
          );
        } else if (r < 0.52) {
          // A soft re-attack on the and of 2.
          roll(t + 1 + 2 * TRIPLET, chord, 2.2, 0.28 * lift);
        } else if (r < 0.64) {
          // A soft re-attack on 3.
          roll(t + 2, chord, 1.9, 0.27 * lift);
        } else if (r < 0.72) {
          // The top two notes answered an octave down on the and of 3.
          chord.slice(-2).forEach((n, k) =>
            events.push({ track: "piano", time: place(t + 2 + 2 * TRIPLET + k * ROLL, "piano"), duration: 1.2, velocity: human(0.24 * lift), notes: [n - 12 >= 55 ? n - 12 : n] }),
          );
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
      // A swung tap before 2 or 4 now and then (the last triplet), the brush player's lilt.
      if (!fill && random() < 0.3) drum(t + (random() < 0.5 ? 2 * TRIPLET : 2 + 2 * TRIPLET), "brushTap", 0.26 * lift);
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
