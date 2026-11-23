import { weighted } from "./shape";

/**
 * Comping that a listener can follow: a pianist settles on a rhythm for a section and keeps
 * coming back to it, varying it a little from bar to bar, instead of playing a new figure every bar.
 *
 * Measured on separated piano stems of eleven references at four places each (six swing: two
 * Band-in-a-Box tracks, two backing tracks with real players, a trio, Red Garland on the 1956
 * Tenor Madness; five bossa, context/style-swing.md and context/style-bossa.md): no two bars are
 * often the same, but the hits pile up on one or two places in the bar (the two busiest eighths
 * take 36 to 57% of the hits; the busiest one is in 50 to 100% of bars, Garland's and of 2 in 88%),
 * a bar shares about a third of its hits with the bar before, and the chords are short (median
 * about half a beat). The site's old comping spread its hits evenly over the bar (the two busiest
 * eighths 31 to 38%) and changed figure every bar, which sounded random.
 *
 * A groove is a two-bar figure (the bar and its answer). A section keeps one groove; inside each
 * four-bar phrase the bars play it as A B A B, the first bar of a phrase nearly always as written,
 * the middle bars now and then varied by one small move, and the phrase's last bar more often
 * (a push into the next phrase or a breath). The same section label reuses its groove through the
 * chorus, and the next chorus keeps it or moves on.
 */

/**
 * Seconds a short comping chord fades after it ends: a pianist's damper, not the sampler's long
 * release, which blurred one stab into the next.
 */
export const DAMPER = 0.3;

/** One comping hit: [eighth slot 0 to 7 (odd slots are the ands), length in beats, velocity]. */
export type CompHit = [number, number, number];

export interface Groove {
  id: string;
  weight: number;
  /** Bar A (the home bar) and bar B (its answer). */
  bars: [CompHit[], CompHit[]];
}

export interface VaryOptions {
  /** Slots a new hit may be added on, with their weights. */
  adds: { slot: number; weight: number }[];
  /** Above 1 favours adding a hit, below 1 leaving one out. */
  busier: number;
  /** Length in beats of an added hit. */
  length: number;
  /** Velocity of an added hit. */
  velocity: number;
  /** The slot hits never move past (8 = the bar; 7 lets a hit push to the and of 4). */
  last?: number;
}

/**
 * One small change to a bar of the groove, the kind a pianist makes without leaving the
 * figure: leave a hit out, add one, move one an eighth earlier (an anticipation) or later,
 * or hold the first chord through the bar. A bar of one hit is never emptied.
 */
export function vary(hits: CompHit[], random: () => number, o: VaryOptions): CompHit[] {
  const out = hits.map((h) => [...h] as CompHit);
  const free = (slot: number) => !out.some(([s]) => Math.abs(s - slot) < 1);
  const moves = [
    { weight: out.length >= 2 ? 1 / o.busier : 0, value: "drop" },
    { weight: o.adds.some((a) => free(a.slot)) ? o.busier : 0, value: "add" },
    { weight: 0.8, value: "earlier" },
    { weight: 0.5, value: "later" },
    { weight: out.length >= 2 ? 0.25 : 0, value: "hold" },
  ];
  const move = weighted(moves.filter((m) => m.weight > 0), random);
  if (move === "drop") {
    out.splice(Math.floor(random() * out.length), 1);
  } else if (move === "add") {
    const slot = weighted(o.adds.filter((a) => free(a.slot)).map((a) => ({ weight: a.weight, value: a.slot })), random);
    out.push([slot, o.length, o.velocity]);
  } else if (move === "earlier" || move === "later") {
    const step = move === "earlier" ? -1 : 1;
    const can = out.map((_, k) => k).filter((k) => {
      const s = out[k][0] + step;
      return s >= 0 && s <= (o.last ?? 7) && !out.some(([x], j) => j !== k && Math.abs(x - s) < 1);
    });
    if (can.length) {
      const k = can[Math.floor(random() * can.length)];
      out[k][0] += step;
      // An and is short; a hit moved onto a beat keeps its length.
      if (out[k][0] % 2) out[k][1] = Math.min(out[k][1], 0.5);
    }
  } else {
    out.sort((a, b) => a[0] - b[0]);
    out.splice(1);
    out[0][1] = Math.max(out[0][1], (8 - out[0][0]) / 2 - 0.3);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** How often a bar leaves the groove, by its place in the four-bar phrase. */
export interface VaryChances {
  /** The phrase's first bar. */
  first: number;
  /** Its second and third bars. */
  middle: number;
  /** Its last bar. */
  last: number;
}

/**
 * Keeps one groove per section label for a chorus; a new chorus keeps the label's groove with
 * chance `keep`, else picks another. `pick` gets the weights for the chorus (density, colour).
 */
export class GrooveBook {
  private byLabel = new Map<string, { chorus: number; groove: Groove }>();
  constructor(private readonly random: () => number, private readonly keep: number) {}

  grooveFor(chorus: number, label: string, pick: (avoid?: Groove) => Groove): Groove {
    const held = this.byLabel.get(label);
    if (held && (held.chorus === chorus || this.random() < this.keep)) {
      held.chorus = chorus;
      return held.groove;
    }
    // A different section (the bridge) takes a different groove from the A sections when it can.
    const others = [...this.byLabel.entries()].filter(([l]) => l !== label).map(([, v]) => v.groove);
    const groove = pick(held?.groove ?? others[0]);
    this.byLabel.set(label, { chorus, groove });
    return groove;
  }
}

/**
 * The bar of the groove to play at `inPhrase` (0 to 3): A B A B, varied by one move now and then,
 * more often at the phrase's end.
 */
export function grooveBar(groove: Groove, inPhrase: number, random: () => number, chances: VaryChances, options: VaryOptions): CompHit[] {
  const bar = groove.bars[inPhrase % 2];
  const chance = inPhrase === 0 ? chances.first : inPhrase === 3 ? chances.last : chances.middle;
  return random() < chance ? vary(bar, random, options) : bar.map((h) => [...h] as CompHit);
}
