import type { ParsedChord } from "../chart/chords";
import { voicingIntervals } from "./voicing";

/**
 * Nylon-guitar chords as a bossa guitarist plays them: a bass note under the thumb and three
 * fingers plucking three strings at once (the pinch), one note per string, from the standard grips
 * with the root on the sixth or fifth string (João Gilberto played only four-note chords).
 * The grips are real fingerings, so the chords have the spacing of a guitar (a 3rd, 6th or 7th over
 * the bass, then 3rds to 5ths), never the piano's close clusters. Which grip a chord takes follows
 * the piano's tension choice (`voicingIntervals`: the same 9th, 13th or b13), so guitar and piano
 * never play a 9 against a b9; then the grip nearest the last one, for stepwise voice leading.
 */

/** Open strings, low E to high E, at sounding pitch (MIDI; the guitar sounds an octave below its written part). */
const STRINGS = [40, 45, 50, 55, 59, 64];

/**
 * Grips as frets on strings 6 to 1 ("x" not played), written with a G root on the sixth string or a
 * C root on the fifth. Only the shape matters: each moves up and down the neck.
 */
const GRIPS = [
  // Root on the sixth string (G).
  "3x443x", // maj7: R 7 3 5
  "3x442x", // maj7#11: R 7 3 #11
  "3x243x", // 6: R 6 3 5
  "3x333x", // m7: R b7 b3 5
  "3x233x", // m6: R 6 b3 5
  "3x433x", // m(maj7): R 7 b3 5
  "3x533x", // m: R R b3 5
  "3x343x", // 7: R b7 3 5
  "3x345x", // 13: R b7 3 13
  "3x344x", // 7b13: R b7 3 b13
  "3x342x", // 7#11: R b7 3 #11
  "3x332x", // m7b5: R b7 b3 b5
  "3x232x", // dim7: R 6 b3 b5
  "3x353x", // 7sus4: R b7 4 5
  // Root on the fifth string (C).
  "x3545x", // maj7: R 5 7 3
  "x3243x", // maj9: R 3 7 9
  "x3445x", // maj7#11: R #11 7 3
  "x3223x", // 6/9: R 3 6 9
  "x3534x", // m7: R 5 b7 b3
  "x3133x", // m9: R b3 b7 9
  "x3123x", // m6/9: R b3 6 9
  "x3143x", // m(maj9): R b3 7 9
  "x3103x", // m(add9): R b3 5 9
  "x3535x", // 7: R 5 b7 3
  "x3233x", // 9: R 3 b7 9
  "x3x355", // 13: R b7 3 13
  "x3232x", // 7b9: R 3 b7 b9
  "x3234x", // 7#9: R 3 b7 #9
  "x3434x", // m7b5: R b5 b7 b3
  "x3424x", // dim7: R b5 6 b3
  "x3333x", // 9sus4: R 4 b7 9
];

interface Grip {
  /** The string the root is on: 0 is the sixth (low E), 1 the fifth (A). */
  string: number;
  /** The fingers' notes in semitones above the root, low to high. */
  upper: number[];
}

const parseGrip = (frets: string): Grip => {
  const notes = [...frets].map((f, s) => (f === "x" ? null : STRINGS[s] + Number(f))).filter((n): n is number => n !== null);
  const string = frets[0] === "x" ? 1 : 0;
  return { string, upper: notes.slice(1).map((n) => n - notes[0]) };
};

export const GUITAR_GRIPS: Grip[] = GRIPS.map(parseGrip);

/** Where the fingers' notes sit: never under D3, the top usually B3 to G4 and at most A4. */
export const FINGERS_LOW = 50;
export const FINGERS_TOP = 69;
const TOP_CENTER = 64;
/** The thumb's notes: low E to E3. */
export const THUMB_LOW = 40;
export const THUMB_HIGH = 52;
/** Highest fret for the root: past it the grips are cramped and thin on a nylon guitar. */
const HIGH_FRET = 8;

export interface GuitarContext {
  /** The chord after, for the tensions a resolution asks for (as the piano voices it). */
  next?: ParsedChord | null;
  /** The bass's note under the chord: the fingers stay a minor third above it. */
  bass?: number | null;
  /** The melody note sounding, which the top stays under. */
  ceiling?: number;
}

const distance = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0);

/**
 * The fingers' notes for a chord (three, low to high), led from the last chord's. Grips are kept
 * whose tones are all among the chord's (the piano's voiced tones and a plain 5th) and that hold its
 * 3rd (or 4th) and its 7th or 6th; then the nearest to the last grip, near the middle of the neck,
 * with a colour tone when the chord has one.
 */
export function guitarFingers(c: ParsedChord, previous: number[] | null, context: GuitarContext = {}): number[] {
  const voiced = voicingIntervals(c, context.next);
  const allowed = new Set(voiced.map((i) => i % 12));
  // The plain 5th, unless a tone the piano voices replaces it (b5, #5, b13 or #11).
  if (c.intervalNames.includes("5P") && !allowed.has(6) && !allowed.has(8)) allowed.add(7);
  const required = [voiced[0], voiced[2]].filter((i) => i !== 0).map((i) => i % 12);
  const colours = [voiced[1], voiced[3]].map((i) => i % 12).filter((i) => i !== 7 && i !== 0 && !required.includes(i));
  const floor = Math.max(FINGERS_LOW, (context.bass ?? -Infinity) + 3);
  const top = Math.min(FINGERS_TOP, context.ceiling ?? Infinity);

  let best: number[] | null = null;
  let bestScore = Infinity;
  for (const grip of GUITAR_GRIPS) {
    const pcs = grip.upper.map((i) => i % 12);
    if (!pcs.every((pc) => allowed.has(pc)) || !required.every((pc) => pcs.includes(pc))) continue;
    for (let fret = 0; fret <= HIGH_FRET + 2; fret++) {
      const root = STRINGS[grip.string] + fret;
      if (root % 12 !== c.root) continue;
      const upper = grip.upper.map((i) => root + i);
      if (upper[0] < floor || upper[upper.length - 1] > top) continue;
      const lead = previous && previous.length === upper.length ? distance(upper, previous) : 0;
      const score =
        lead +
        Math.abs(upper[upper.length - 1] - TOP_CENTER) * 0.3 +
        (fret > HIGH_FRET ? (fret - HIGH_FRET) * 2 : 0) +
        (fret === 0 ? 1.5 : 0) -
        (pcs.some((pc) => colours.includes(pc)) ? 1.5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = upper;
      }
    }
  }
  if (best) return best;
  // No grip fits the room (a high bass, a low melody): the chord's guide tones and its colour, stacked
  // upward from the floor, still one note per string's reach.
  const tones = [...required, ...colours, 7].filter((pc, k, all) => allowed.has(pc) && all.indexOf(pc) === k).slice(0, 3);
  const out: number[] = [];
  for (const pc of tones) {
    let n = Math.max(floor, (out.at(-1) ?? floor - 1) + 3);
    while ((n - c.root + 120) % 12 !== pc) n++;
    out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The thumb's note: the bass player's note when it is the chord's root, 5th or written bass (the
 * thumb plays root and 5th on 1 and 3, as the bass does), else the chord's bass; on the low strings
 * and under the fingers by at least a minor third.
 */
export function guitarThumb(c: ParsedChord, fingers: number[], bassNote: number | null): number {
  const fifth = c.intervalNames.includes("5d") ? 6 : c.intervalNames.includes("5A") ? 8 : 7;
  const pc = bassNote !== null && [c.root, c.bass, (c.root + fifth) % 12].includes(bassNote % 12) ? bassNote % 12 : c.bass;
  const below = (fingers[0] ?? THUMB_HIGH + 3) - 3;
  let best: number | null = null;
  for (let n = THUMB_LOW; n <= THUMB_HIGH; n++) if (n % 12 === pc && n <= below) best = n;
  if (best !== null) return best;
  let n = THUMB_LOW;
  while (n % 12 !== pc) n++;
  return n;
}
