import type { TimelineBar } from "../engine/timeline";

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
}

/**
 * Intensity: a lift each chorus (the head is laid back, solos build), a little more in
 * contrasting sections (the bridge), a slow random drift, and a swell into each phrase end.
 */
export function shapeBars(bars: TimelineBar[], random: () => number): BarShape[] {
  let drift = 0;
  return bars.map((bar, i) => {
    drift = Math.max(-0.12, Math.min(0.12, drift * 0.75 + (random() - 0.5) * 0.1));
    const chorus = bar.ref?.part === "intro" ? 0.88 : bar.chorus <= 1 ? 0.93 : bar.chorus === 2 ? 1 : Math.min(1.1, 1 + 0.04 * (bar.chorus - 2));
    const inPhrase = (bar.ref?.bar ?? i) % 4;
    const next = bars[i + 1];
    const sectionEnd = !next?.ref || next.ref.section !== bar.ref?.section || next.ref.part !== bar.ref?.part || next.ref.bar === 0;
    return {
      intensity: chorus + (bar.contrast ? 0.03 : 0) + drift + (inPhrase === 3 ? 0.02 : 0),
      inPhrase,
      phraseEnd: inPhrase === 3 && !sectionEnd,
    };
  });
}

/** Pick one of several weighted options. */
export function weighted<T>(options: { weight: number; value: T }[], random: () => number, avoid?: T): T {
  const pool = options.length > 1 && avoid !== undefined ? options.filter((o) => o.value !== avoid) : options;
  const total = pool.reduce((s, o) => s + o.weight, 0);
  let r = random() * total;
  for (const o of pool) if ((r -= o.weight) < 0) return o.value;
  return pool[0].value;
}
