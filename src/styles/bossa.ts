import type { ParsedChord } from "../chart/chords";
import { chordAt, type TimelineBar } from "../engine/timeline";
import { voiceChord } from "../engine/voicing";
import { seededRandom } from "./random";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Bossa nova, straight eighths, in a two-bar cycle.
 * - Bass: root on 1 and the fifth on 3, each anticipated by an eighth note
 *   (on the and of 2, and on the and of 4 into the next bar).
 * - Drums: eighth notes on the hi-hat, kick with the bass figure, cross-stick
 *   on the bossa clave (bar one: 1, and of 2, 4; bar two: 2, and of 3).
 * - Piano: rootless voicings on the same two-bar figure.
 */

const CLAVE: number[][] = [
  [0, 1.5, 3],
  [1, 2.5],
];

const PIANO: { beat: number; length: number }[][] = [
  [
    { beat: 0, length: 1.2 },
    { beat: 1.5, length: 0.4 },
    { beat: 3, length: 0.9 },
  ],
  [
    { beat: 1, length: 0.9 },
    { beat: 2.5, length: 1.3 },
  ],
];

const KICK = [
  { beat: 0, velocity: 0.8 },
  { beat: 1.5, velocity: 0.45 },
  { beat: 2, velocity: 0.75 },
  { beat: 3.5, velocity: 0.45 },
];

const BASS_LOW = 28; // E1

/** Bass note for a pitch class, in the range E1 to D#2. */
function bassNote(pc: number): number {
  return BASS_LOW + ((pc - (BASS_LOW % 12) + 12) % 12);
}

/** The second note of the bar: the fifth, or the root an octave up on altered fifths. */
function fifthNote(chord: ParsedChord): number {
  const bass = bassNote(chord.bass);
  if (chord.bass !== chord.root) return bass + 7;
  if (chord.intervalNames.includes("5A") || chord.intervalNames.includes("5d")) return bass + 12;
  return bass + 7;
}

/** The two main bass notes of a bar, on beats 1 and 3. */
function mainBassNotes(bar: TimelineBar): (number | null)[] {
  const first = chordAt(bar, 0);
  const second = chordAt(bar, 2);
  if (!first || !second) return [null, null];
  if (second !== first) return [bassNote(first.chord.bass), bassNote(second.chord.bass)];
  return [bassNote(first.chord.bass), fifthNote(first.chord)];
}

export const bossa: Style = {
  id: "bossa",
  name: "Bossa nova",
  generate(bars, seed) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const nudge = () => (random() - 0.5) * 0.02; // up to 10 ms at 150 BPM
    const events: NoteEvent[] = [];
    const drum = (time: number, sound: DrumSound, velocity: number) =>
      events.push({ track: "drums", drum: sound, time: time + nudge(), duration: 0.25, velocity: human(velocity) });

    let voicing: number[] | null = null;
    const music = bars.filter((b) => !b.countIn);
    music.forEach((bar, i) => {
      const t = bar.startBeat;
      const cycle = i % 2;

      if (bar.final) {
        const chord = bar.chords[0]?.chord;
        if (!chord) return;
        voicing = voiceChord(chord, voicing);
        events.push({ track: "piano", time: t, duration: 4, velocity: 0.6, notes: voicing });
        events.push({ track: "bass", time: t, duration: 3.5, velocity: 0.85, notes: [bassNote(chord.bass)] });
        drum(t, "kick", 0.8);
        drum(t, "rim", 0.6);
        return;
      }

      // Bass
      const mains = mainBassNotes(bar);
      const nextBar = music[i + 1];
      const nextMains = nextBar ? mainBassNotes(nextBar) : [null, null];
      const pickups = [mains[1], nextMains[0] ?? mains[0]];
      for (let half = 0; half < 2; half++) {
        const main = mains[half];
        const pickup = pickups[half];
        if (main !== null) events.push({ track: "bass", time: t + half * 2, duration: 1.4, velocity: human(0.85), notes: [main] });
        if (pickup !== null && !(nextBar?.final && half === 1)) {
          events.push({ track: "bass", time: t + half * 2 + 1.5, duration: 0.45, velocity: human(0.6), notes: [pickup] });
        }
      }

      // Piano
      for (const hit of PIANO[cycle]) {
        const slot = chordAt(bar, hit.beat);
        if (!slot) continue;
        voicing = voiceChord(slot.chord, voicing);
        events.push({ track: "piano", time: t + hit.beat + nudge(), duration: hit.length, velocity: human(0.5, 0.12), notes: voicing });
      }

      // Drums
      for (let e = 0; e < 8; e++) drum(t + e * 0.5, "hat", e % 2 === 0 ? 0.5 : 0.3);
      for (const k of KICK) drum(t + k.beat, "kick", k.velocity);
      for (const beat of CLAVE[cycle]) drum(t + beat, "rim", 0.7);
    });

    return events.sort((a, b) => a.time - b.time);
  },
};
