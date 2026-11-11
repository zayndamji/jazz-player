import type { ParsedChord } from "../chart/chords";

/**
 * Four-note jazz piano voicings without the root (the bass has it):
 * 3rd, 5th (or 13th on dominants), 7th (or 6th), and 9th. Each new voicing is
 * the inversion closest to the previous one, which gives smooth voice leading.
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

export const VOICING_LOW = 50; // D3
export const VOICING_HIGH = 77; // F5

function candidates(pcs: number[]): number[][] {
  const out: number[][] = [];
  for (let start = 0; start < pcs.length; start++) {
    const order = [...pcs.slice(start), ...pcs.slice(0, start)];
    for (let bottom = VOICING_LOW; bottom < VOICING_LOW + 12; bottom++) {
      if (bottom % 12 !== order[0]) continue;
      const notes = [bottom];
      for (const pc of order.slice(1)) {
        let n = notes[notes.length - 1] + 1;
        while (n % 12 !== pc) n++;
        notes.push(n);
      }
      for (const shift of [0, 12]) {
        const shifted = notes.map((n) => n + shift);
        if (shifted[shifted.length - 1] <= VOICING_HIGH) out.push(shifted);
      }
    }
  }
  return out;
}

const distance = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0);

/** MIDI notes for a chord, voice-led from the previous voicing. */
export function voiceChord(c: ParsedChord, previous: number[] | null): number[] {
  const pcs = [...new Set(voicingIntervals(c).map((i) => (c.root + i) % 12))];
  const options = candidates(pcs);
  const center = 62; // around D4
  let best = options[0];
  let bestScore = Infinity;
  for (const v of options) {
    const mid = (v[0] + v[v.length - 1]) / 2;
    const score = previous && previous.length === v.length ? distance(v, previous) + Math.abs(mid - center) * 0.3 : Math.abs(mid - center);
    if (score < bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}
