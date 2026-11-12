import type { TimelineBar } from "../engine/timeline";

/**
 * How a band shapes a whole performance and places its notes in time, shared by the
 * styles. Measured against full reference tracks and records (context/whole-track-comparison.md):
 * - Choruses arc: the head is lighter, the solo choruses build to a peak about two
 *   thirds of the way through, and the last chorus comes back to the head's texture.
 * - Timing is never on the grid: each part sits in its own pocket (bass a little
 *   ahead of the ride, piano a little behind), the band drifts together by a few
 *   milliseconds over bars, and every note has its own small error.
 */

export type Role = "intro" | "head" | "solo" | "peak" | "outhead";

export interface ChorusPlan {
  role: Role;
  /** Velocity factor for the chorus, about 0.9 to 1.12. */
  energy: number;
  /** Half steps the piano's register moves up (0 for the head, up to 5 at the peak). */
  register: number;
  /** How busy the comping and drums are, about 0.85 (head) to 1.15 (peak). */
  density: number;
  /** Added to the swing ratio: the band swings a little harder as it builds. */
  swing: number;
  /** True for the last chorus of a performance that ends (more fills and crashes). */
  last: boolean;
}

const INTRO: ChorusPlan = { role: "intro", energy: 0.88, register: 0, density: 0.8, swing: 0, last: false };

/**
 * The plan for each chorus number in `bars` (0 is the intro and ending). When the
 * schedule repeats until stopped (no final bar), chorus 2 is the one that repeats, so
 * it gets a middle solo chorus.
 */
export function chorusPlans(bars: TimelineBar[], random: () => number): Map<number, ChorusPlan> {
  const numbers = [...new Set(bars.map((b) => b.chorus).filter((c) => c > 0))].sort((a, b) => a - b);
  const open = !bars.some((b) => b.final);
  const n = numbers.at(-1) ?? 0;
  const plans = new Map<number, ChorusPlan>([[0, INTRO]]);
  const wobble = () => (random() - 0.5) * 0.03;
  const solo = (energy: number, role: Role = "solo"): ChorusPlan => ({
    role,
    energy,
    register: Math.max(0, Math.min(5, Math.round((energy - 0.98) * 40))),
    density: Math.max(0.9, Math.min(1.15, energy + 0.03)),
    swing: Math.max(0, Math.min(0.025, (energy - 0.98) * 0.18)),
    last: false,
  });
  const head = (last: boolean): ChorusPlan => ({ role: last ? "outhead" : "head", energy: last ? 0.96 : 0.92, register: 0, density: 0.85, swing: -0.004, last });
  // The peak sits about two thirds of the way through the solo choruses.
  const peak = n >= 3 ? 2 + Math.round((n - 3) * 0.66) : 2;
  const reach = Math.max(1, (n - 2) / 2);
  for (const c of numbers) {
    if (c === 1) plans.set(c, n === 1 && !open ? { ...head(true), role: "head" } : head(false));
    else if (open) plans.set(c, solo(1.03 + wobble()));
    else if (c === n && n >= 3) plans.set(c, head(true));
    else {
      const closeness = Math.max(0, 1 - Math.abs(c - peak) / reach);
      const energy = 0.99 + 0.11 * closeness + wobble();
      plans.set(c, solo(energy, c === peak ? "peak" : "solo"));
    }
  }
  if (n >= 2 && !open && n < 3) plans.set(n, { ...plans.get(n)!, last: true });
  return plans;
}

/** A normally distributed number (mean 0, SD 1), from a uniform generator. */
export function gauss(random: () => number): number {
  const u = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export type Pocket = { offset: number; jitter: number };

/**
 * Where each part sits against the beat, in milliseconds: `offset` early (negative)
 * or late (positive), `jitter` the SD of each note's own error.
 */
export const POCKETS: Record<string, Pocket> = {
  ride: { offset: 0, jitter: 10 },
  hat: { offset: 0, jitter: 10 },
  pedal: { offset: 1, jitter: 4 },
  kick: { offset: -1, jitter: 5 },
  snare: { offset: 4, jitter: 7 },
  fill: { offset: 0, jitter: 5 },
  bass: { offset: -5, jitter: 10 },
  piano: { offset: 7, jitter: 10 },
  guitar: { offset: 3, jitter: 6 },
};

/** No note moves more than this far from the grid (ms). */
const LIMIT = 18;

/**
 * Timing for one performance: call `bar()` at the start of each bar, then `at(part)`
 * for each note's offset in beats. The band's shared drift is a slow random walk
 * (about ±12 ms), each part drifts a little on its own, and each note adds jitter.
 */
export function timing(random: () => number, bpm: number) {
  const beats = (ms: number) => (ms / 1000) * (bpm / 60);
  let band = 0;
  const own: Record<string, number> = {};
  return {
    bar() {
      band = Math.max(-12, Math.min(12, band * 0.8 + gauss(random) * 3.5));
      for (const k of Object.keys(POCKETS)) own[k] = Math.max(-4, Math.min(4, (own[k] ?? 0) * 0.7 + gauss(random) * 1.5));
    },
    at(part: keyof typeof POCKETS) {
      const p = POCKETS[part];
      const jitter = Math.max(-2, Math.min(2, gauss(random))) * p.jitter;
      const ms = Math.max(-LIMIT, Math.min(LIMIT, band + (own[part] ?? 0) + p.offset + jitter));
      return beats(ms);
    },
  };
}

/**
 * Per-note velocity factors and onset offsets (seconds) for a piano chord: the top
 * note voiced louder, the bottom a little under it, the inner notes softest, and the
 * notes spread low to high by a few milliseconds, as a pianist's hand never lands flat.
 * `roll` spreads them wider, for held chords.
 */
export function pianoTouch(notes: number[], random: () => number, roll = false): { levels: number[]; offsets: number[] } {
  const top = notes.length - 1;
  const levels = notes.map((_, i) => (i === top ? 1.12 : i === 0 ? 0.97 : 0.9) * (0.96 + random() * 0.08));
  const step = roll ? 0.01 + random() * 0.008 : 0.0015 + random() * 0.003;
  const offsets = notes.map((_, i) => i * step);
  return { levels, offsets };
}
