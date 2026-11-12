import type { TimelineBar } from "../engine/timeline";
import { chorusPlans, type ChorusPlan } from "./feel";

/**
 * The shape of a performance, shared by the styles: how hard each bar is played
 * and where the phrase ends fall, so every part breathes together.
 *
 * Reference backing tracks vary their per-bar energy by 2 to 5 dB (standard
 * deviation, context/backing-track-design.md); a band at one level sounds
 * mechanical. Intensity is a velocity factor around 1.
 */

export interface BarShape {
  /** Velocity factor for the bar, about 0.85 to 1.15. */
  intensity: number;
  /** Bars into the current four-bar phrase, from 0. */
  inPhrase: number;
  /** Last bar of a four-bar phrase that doesn't end a section: room for a small fill. */
  phraseEnd: boolean;
  /** The chorus's place in the performance (feel.ts). */
  plan: ChorusPlan;
  /** True in the last eight bars of the last chorus of a performance that ends. */
  shout: boolean;
}

/**
 * Intensity: a lift each chorus (the head is laid back, solos build), a little more in
 * contrasting sections (the bridge), a slow random drift, and a swell into each phrase end.
 * With `arc`, the choruses follow `chorusPlans` instead (head, building solos, a peak, the
 * out-head) and the drift is wider, as the full reference tracks measured.
 */
export function shapeBars(bars: TimelineBar[], random: () => number, arc = false): BarShape[] {
  let drift = 0;
  // Without `arc` the plans don't draw from `random`, so a style's notes stay as they were.
  const plans = chorusPlans(bars, arc ? random : () => 0.5);
  const width = arc ? 0.2 : 0.12;
  const step = arc ? 0.2 : 0.1;
  const lastChorus = Math.max(0, ...bars.map((b) => b.chorus));
  const formBars = bars.filter((b) => b.chorus === lastChorus && b.ref?.part === "form").length;
  return bars.map((bar, i) => {
    drift = Math.max(-width, Math.min(width, drift * 0.75 + (random() - 0.5) * step));
    const plan = plans.get(bar.chorus) ?? plans.get(0)!;
    const steady = bar.ref?.part === "intro" ? 0.88 : bar.chorus <= 1 ? 0.93 : bar.chorus === 2 ? 1 : Math.min(1.1, 1 + 0.04 * (bar.chorus - 2));
    const chorus = arc ? plan.energy : steady;
    const inPhrase = (bar.ref?.bar ?? i) % 4;
    const next = bars[i + 1];
    const sectionEnd = !next?.ref || next.ref.section !== bar.ref?.section || next.ref.part !== bar.ref?.part || next.ref.bar === 0;
    const left = bars.slice(i).filter((b) => b.chorus === lastChorus && b.ref?.part === "form").length;
    const shout = arc && plan.last && bar.chorus === lastChorus && left > 0 && left <= Math.min(8, formBars);
    return {
      intensity: chorus + (bar.contrast ? 0.03 : 0) + drift + (inPhrase === 3 ? 0.02 : 0) + (shout ? 0.04 : 0),
      inPhrase,
      phraseEnd: inPhrase === 3 && !sectionEnd,
      plan,
      shout,
    };
  });
}

/** A neutral chorus plan for the straight feel: every chorus the same. */
export const STEADY: ChorusPlan = { role: "solo", energy: 1, register: 0, density: 1, swing: 0, drums: 0, last: false };

/** The straight feel's shape: one level and one plan throughout, no phrase-end swells or shouts. */
export function steadyBars(bars: TimelineBar[]): BarShape[] {
  return bars.map((bar, i) => ({ intensity: 1, inPhrase: (bar.ref?.bar ?? i) % 4, phraseEnd: false, plan: STEADY, shout: false }));
}

/** Pick one of several weighted options. */
export function weighted<T>(options: { weight: number; value: T }[], random: () => number, avoid?: T): T {
  const pool = options.length > 1 && avoid !== undefined ? options.filter((o) => o.value !== avoid) : options;
  const total = pool.reduce((s, o) => s + o.weight, 0);
  let r = random() * total;
  for (const o of pool) if ((r -= o.weight) < 0) return o.value;
  return pool[0].value;
}
