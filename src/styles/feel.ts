import type { TimelineBar } from "../engine/timeline";

/**
 * How a band shapes a whole performance and places its notes in time, shared by the
 * styles. Measured against full reference tracks and records (context/whole-track-comparison.md):
 * - Choruses arc: the head is lighter (the drums 4 dB under the solos), the solo choruses build to a peak about two
 *   thirds of the way through, and the last chorus comes back to the head's texture.
 * - Timing is never on the grid: each part sits in its own pocket (bass on the ride
 *   or a hair behind, piano a little behind), the band drifts together by a few
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
  /** Added to the swing ratio: the band swings a little harder as it builds, and each chorus a little differently. */
  swing: number;
  /**
   * The drums' level for the chorus in dB, on top of velocity: the records play the head 6 to 8 dB
   * under the solos and build through them (context/original-records.md).
   */
  drums: number;
  /** True for the last chorus of a performance that ends (more fills and crashes). */
  last: boolean;
}

const INTRO: ChorusPlan = { role: "intro", energy: 0.88, register: 0, density: 0.8, swing: 0, drums: -3, last: false };

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
  // The records' swing moves from chorus to chorus (SD about 0.03 of the beat over a take).
  const wander = () => (random() - 0.5) * 0.03;
  const solo = (energy: number, role: Role = "solo"): ChorusPlan => ({
    role,
    energy,
    register: Math.max(0, Math.min(5, Math.round((energy - 0.98) * 40))),
    density: Math.max(0.9, Math.min(1.15, energy + 0.03)),
    swing: Math.max(0, Math.min(0.025, (energy - 0.98) * 0.18)) + wander(),
    // Level with the solos at 0.99, about +2 dB at the peak.
    drums: Math.max(-0.5, (energy - 0.99) * 18),
    last: false,
  });
  const head = (last: boolean): ChorusPlan => ({ role: last ? "outhead" : "head", energy: last ? 0.96 : 0.92, register: 0, density: 0.85, swing: -0.004 + wander(), drums: last ? -2.5 : -4, last });
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

/** The chorus's drum level as a gain; the ending plays at the solos' level (its plan is the intro's). */
export const drumGain = (bar: TimelineBar, plan: ChorusPlan) => (bar.ref?.part === "ending" ? 1 : 10 ** (plan.drums / 20));

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
  // On the ride or a hair behind it, as on the records (0 to +14 ms; backing tracks push ahead).
  bass: { offset: 2, jitter: 10 },
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
 * How much the drummer comps on the snare, bar by bar: call once a bar with the bar's place in
 * its eight bars and the chorus's density (about 1); returns how many comping figures to play
 * (0 to 2). Measured on separated drum stems of four records (context/style-swing.md): comping
 * comes in spells (the snare count correlates 0.3 to 0.5 with the bar before and 0.2 to 0.5 with
 * the bar four back; a busy bar is followed by another 1.6 to 2 times more often than chance),
 * leans into each phrase end (bar 4 about 1.4 times the average, bar 8 about 1.2) and eases off
 * in the bar after the mid-section turn (bar 5 at about half), instead of single bars picked at random.
 */
export function drumTalk(random: () => number) {
  let heat = 1;
  return (inEight: number, base: number): number => {
    heat = TALK.hold * heat + (1 - TALK.hold) + gauss(random) * TALK.spread;
    const level = (heat + TALK.bump[inEight % 8]) * base;
    return level < TALK.one ? 0 : level < TALK.two ? 1 : 2;
  };
}
const TALK = { hold: 0.88, spread: 0.3, bump: [0.05, 0, 0, 0.25, -0.35, -0.1, 0, 0.2], one: 0.8, two: 1.6 };

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
