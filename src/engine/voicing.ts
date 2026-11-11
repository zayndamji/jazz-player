import type { ParsedChord } from "../chart/chords";

/**
 * Four-note jazz piano voicings without the root (the bass has it):
 * 3rd, 5th (or 13th on dominants), 7th (or 6th), and 9th.
 *
 * Spacing: drop-2 shapes (the second voice from the top dropped an octave)
 * spread the chord over about an octave and a half, the open sound of bossa
 * piano and guitar. Close shapes are kept as options, but seconds and thirds
 * below G3 are ruled out because they sound muddy in that register. Each new
 * voicing is the option closest to the previous one, for smooth voice leading.
 */

const has = (c: ParsedChord, name: string) => c.intervalNames.includes(name);

/** Semitones above the root of the four voiced tones. */
export function voicingIntervals(c: ParsedChord): number[] {
  const third = has(c, "3m") ? 3 : has(c, "4P") && !has(c, "3M") ? 5 : 4;
  const fifth = has(c, "5A") ? 8 : has(c, "5d") ? 6 : 7;
  const altered = fifth !== 7;
  const seventh = has(c, "7M") ? 11 : has(c, "7m") ? 10 : has(c, "7d") ? 9 : has(c, "6M") || has(c, "13M") ? 9 : third === 3 ? 10 : 9;
  const ninth = has(c, "9m") ? 1 : has(c, "9A") ? 3 : 2;

  if (third === 3 && fifth === 6) return [third, fifth, seventh, 0]; // half-diminished and diminished
  if (third === 4 && seventh === 10) return [third, altered ? fifth : 9, seventh, ninth]; // dominant: 3, 13, b7, 9
  return [third, fifth, seventh, ninth];
}

export const VOICING_LOW = 48; // C3
export const VOICING_HIGH = 79; // G5
/** Below this note, neighbouring voices must be at least a minor third apart. */
const LOW_INTERVAL_LIMIT = 55; // G3

/** Where an instrument's voicings sit. */
export interface VoicingRange {
  low: number;
  high: number;
  /** The middle of the voicing is pulled toward this note. */
  center: number;
}

export const PIANO_RANGE: VoicingRange = { low: VOICING_LOW, high: VOICING_HIGH, center: 63 };
/** Nylon guitar, written range: sounds around E3 to D5. */
export const GUITAR_RANGE: VoicingRange = { low: 52, high: 74, center: 61 };

function closeShapes(pcs: number[], range: VoicingRange): number[][] {
  const out: number[][] = [];
  for (let start = 0; start < pcs.length; start++) {
    const order = [...pcs.slice(start), ...pcs.slice(0, start)];
    for (let bottom = range.low; bottom < range.low + 24; bottom++) {
      if (bottom % 12 !== order[0]) continue;
      const notes = [bottom];
      for (const pc of order.slice(1)) {
        let n = notes[notes.length - 1] + 1;
        while (n % 12 !== pc) n++;
        notes.push(n);
      }
      out.push(notes);
    }
  }
  return out;
}

const drop2 = (close: number[]) => {
  const v = [...close];
  const [dropped] = v.splice(v.length - 2, 1);
  return [dropped - 12, ...v];
};

function playable(v: number[], range: VoicingRange): boolean {
  if (v[0] < range.low || v[v.length - 1] > range.high) return false;
  for (let i = 1; i < v.length; i++) if (v[i - 1] < LOW_INTERVAL_LIMIT && v[i] - v[i - 1] < 3) return false;
  return true;
}

/** Every voicing shape the piano may use for these pitch classes, lowest note first. */
export function voicingOptions(pcs: number[], range: VoicingRange = PIANO_RANGE): { notes: number[]; drop2: boolean }[] {
  const out: { notes: number[]; drop2: boolean }[] = [];
  for (const close of closeShapes(pcs, range)) {
    if (playable(close, range)) out.push({ notes: close, drop2: false });
    const d = drop2(close);
    if (playable(d, range)) out.push({ notes: d, drop2: true });
  }
  return out;
}

const distance = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0);

/** MIDI notes for a chord, voice-led from the previous voicing. */
export function voiceChord(c: ParsedChord, previous: number[] | null, range: VoicingRange = PIANO_RANGE): number[] {
  const pcs = [...new Set(voicingIntervals(c).map((i) => (c.root + i) % 12))];
  const options = voicingOptions(pcs, range);
  const center = range.center;
  let best = options[0]?.notes ?? [];
  let bestScore = Infinity;
  for (const { notes, drop2: wide } of options) {
    const mid = (notes[0] + notes[notes.length - 1]) / 2;
    const lead = previous && previous.length === notes.length ? distance(notes, previous) : 0;
    const score = lead + Math.abs(mid - center) * 0.4 + (wide ? 0 : 2.5);
    if (score < bestScore) {
      bestScore = score;
      best = notes;
    }
  }
  return best;
}
