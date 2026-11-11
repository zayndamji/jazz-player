import type { ParsedChord } from "../chart/chords";
import { chordAt, sameRef, type TimelineBar } from "../engine/timeline";
import { GUITAR_RANGE, voiceChord } from "../engine/voicing";
import { seededRandom } from "./random";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Bossa nova, straight eighths, in a two-bar cycle. The patterns follow a
 * measured Band-in-a-Box bossa track (context/reference-backing-track.md):
 * - Bass: 1, and of 2, 3, and of 4. The eighths anticipate the next note.
 * - Guitar: the rhythmic engine, short syncopated chords on a two-bar figure.
 * - Piano: sparse, held chords on the changes, under the guitar.
 * - Drums: eighths on the hi-hat with 2 and 4 accented, kick with the bass,
 *   cross-stick on the bossa clave, a fill at the end of each section and a
 *   bigger one at the end of the form, a soft crash where a section starts.
 */

const CLAVE: number[][] = [
  [0, 1.5, 3],
  [1, 2.5],
];

/** Guitar figure, bar one then bar two: beat, length, velocity. */
const GUITAR: [number, number, number][][] = [
  [
    [0, 0.45, 0.75],
    [1, 0.4, 0.85],
    [2.5, 0.45, 0.8],
    [3, 0.35, 0.55],
  ],
  [
    [0.5, 0.4, 0.75],
    [2, 0.45, 0.85],
    [2.5, 0.4, 0.65],
    [3, 0.5, 0.8],
  ],
];

/** Hi-hat velocity on each eighth: 2 and 4 strongest, offbeats soft. */
const HAT = [0.45, 0.26, 0.58, 0.28, 0.46, 0.33, 0.58, 0.26];

const KICK = [
  { beat: 0, velocity: 0.75 },
  { beat: 1.5, velocity: 0.55 },
  { beat: 2, velocity: 0.7 },
  { beat: 3.5, velocity: 0.55 },
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

/** True when the bar after this one starts a new section (or the song ends). */
function endsSection(bar: TimelineBar, next: TimelineBar | undefined): boolean {
  if (!bar.ref) return false;
  if (!next?.ref) return true;
  return next.ref.part !== bar.ref.part || next.ref.section !== bar.ref.section || next.ref.bar === 0;
}

const isFormEnd = (bar: TimelineBar, next: TimelineBar | undefined) =>
  bar.ref?.part === "form" && (!next?.ref || next.ref.part !== "form" || next.chorus !== bar.chorus || sameRef(next.ref, { part: "form", section: 0, bar: 0 }));

export const bossa: Style = {
  id: "bossa",
  name: "Bossa nova",
  generate(bars, seed) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const nudge = (ms = 10) => (random() - 0.5) * (ms / 500); // in beats, about ±ms at 150 BPM
    const events: NoteEvent[] = [];
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: time + nudge(6), duration: 0.25, velocity: human(velocity, spread) });

    let piano: number[] | null = null;
    let guitar: number[] | null = null;
    const music = bars.filter((b) => !b.countIn);
    music.forEach((bar, i) => {
      const t = bar.startBeat;
      const cycle = i % 2;
      const next = music[i + 1];
      const prev = music[i - 1];

      if (bar.final) {
        const chord = bar.chords[0]?.chord;
        if (!chord) return;
        piano = voiceChord(chord, piano);
        guitar = voiceChord(chord, guitar, GUITAR_RANGE);
        events.push({ track: "piano", time: t, duration: 4, velocity: 0.5, notes: piano });
        events.push({ track: "guitar", time: t + 0.02, duration: 4, velocity: 0.6, notes: guitar });
        events.push({ track: "bass", time: t, duration: 3.5, velocity: 0.85, notes: [bassNote(chord.bass)] });
        drum(t, "kick", 0.8);
        drum(t, "crash", 0.55, 0);
        return;
      }

      // Bass
      const mains = mainBassNotes(bar);
      const nextMains = next ? mainBassNotes(next) : [null, null];
      const pickups = [mains[1], nextMains[0] ?? mains[0]];
      for (let half = 0; half < 2; half++) {
        const main = mains[half];
        const pickup = pickups[half];
        if (main !== null) events.push({ track: "bass", time: t + half * 2, duration: 1.4, velocity: human(0.85), notes: [main] });
        if (pickup !== null) events.push({ track: "bass", time: t + half * 2 + 1.5, duration: 0.45, velocity: human(0.65), notes: [pickup] });
      }

      // Guitar: the two-bar figure, re-voiced at each hit so changes land where they fall.
      for (const [beat, length, velocity] of GUITAR[cycle]) {
        const slot = chordAt(bar, beat);
        if (!slot) continue;
        guitar = voiceChord(slot.chord, guitar, GUITAR_RANGE);
        events.push({ track: "guitar", time: t + beat + nudge(8), duration: length, velocity: human(velocity * 0.7, 0.1), notes: guitar });
      }

      // Piano: held chords where the harmony changes, soft, with a re-touch on beat 3 of long chords.
      for (const c of bar.chords) {
        // A chord held over a "%" bar is touched again at the start of a two-bar cycle.
        const retouch = !c.attack && c.beat === 0 && cycle === 0;
        if (!c.attack && !retouch) continue;
        piano = voiceChord(c.chord, piano);
        events.push({ track: "piano", time: t + c.beat + nudge(12), duration: Math.min(c.length, 4) - 0.15, velocity: human(0.38, 0.1), notes: piano });
      }

      // Drums
      const fill = endsSection(bar, next) && !next?.final;
      const bigFill = isFormEnd(bar, next) && !!next;
      const hatEnd = bigFill ? 4 : fill ? 6 : 8; // hats stop for the fill
      for (let e = 0; e < hatEnd; e++) drum(t + e * 0.5, "hat", HAT[e]);
      for (const k of KICK) if (!(bigFill && k.beat >= 2)) drum(t + k.beat, "kick", k.velocity);
      for (const beat of CLAVE[cycle]) if (beat < (bigFill ? 2 : fill ? 3 : 4)) drum(t + beat, "rim", 0.65);

      // Section start: a soft crash with the kick, except at the very top.
      if (i > 0 && prev && endsSection(prev, bar)) drum(t, "crash", bigFillBefore(prev, bar) ? 0.5 : 0.32, 0.05);

      if (bigFill) {
        // Beats 3 and 4 in sixteenths: snare, then high and low toms.
        const sounds: DrumSound[] = ["snare", "snare", "snare", "snare", "tomHigh", "tomHigh", "tomLow", "tomLow"];
        sounds.forEach((s, k) => drum(t + 2 + k * 0.25, s, 0.35 + k * 0.05));
      } else if (fill) {
        // Beat 4: a short snare figure.
        [3, 3.5, 3.75].forEach((b, k) => drum(t + b, "snare", 0.3 + k * 0.08));
      }
    });

    function bigFillBefore(prevBar: TimelineBar, bar: TimelineBar) {
      return isFormEnd(prevBar, bar);
    }

    return events.sort((a, b) => a.time - b.time);
  },
};
