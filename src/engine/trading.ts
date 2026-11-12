import { seededRandom } from "../styles/random";
import type { DrumSound, NoteEvent } from "../styles/types";
import type { TimelineBar } from "./timeline";

/** Trading with the drums in the solo choruses: off, fours or eights with a drum solo between, or fours with the whole band out. */
export type TradeMode = "off" | "fours" | "eights" | "fours-out";
export const TRADE_MODES: TradeMode[] = ["off", "fours", "eights", "fours-out"];

export const TRADE_LABELS: Record<TradeMode, string> = {
  off: "Off",
  fours: "Fours with drums",
  eights: "Eights with drums",
  "fours-out": "Fours, band out",
};

/** What a traded bar is: the soloist's (the band plays), the drums' turn, or the band out. */
export type TradeTurn = "you" | "drums" | "out";

/** Bars in each turn. */
export const tradeLength = (mode: TradeMode) => (mode === "eights" ? 8 : mode === "off" ? 0 : 4);

/** What the readout calls a bar of a turn. */
export const tradeLabel = (mode: TradeMode, turn: TradeTurn) =>
  turn === "drums" ? "Drums" : turn === "out" ? "Band out" : mode === "eights" ? "Your eight" : "Your four";

/**
 * Marks each bar of the solo choruses with its turn: the first turn of a chorus is the
 * soloist's (the band plays), the next the drums', and so on to the chorus's end.
 * `isSolo` says which choruses are solo ones; the head, intro and ending are never traded.
 */
export function markTrading(bars: TimelineBar[], mode: TradeMode, isSolo: (chorus: number) => boolean): void {
  const n = tradeLength(mode);
  if (n === 0) return;
  let pos = 0;
  let chorus = -1;
  for (const b of bars) {
    if (b.countIn || b.ref?.part !== "form" || !isSolo(b.chorus)) {
      pos = 0;
      chorus = -1;
      continue;
    }
    if (b.chorus !== chorus) {
      chorus = b.chorus;
      pos = 0;
    }
    b.trade = Math.floor(pos / n) % 2 === 0 ? "you" : mode === "fours-out" ? "out" : "drums";
    pos++;
  }
}

const clamp = (v: number) => Math.min(0.7, Math.max(0.2, v));
const hit = (time: number, drum: DrumSound, velocity: number, duration = 0.25): NoteEvent => ({ track: "drums", time, duration, velocity: clamp(velocity), drum });

/** A beat's pattern on the triplet grid: the slots (thirds of a beat) that sound. Slot 2 is the swung off-beat. */
const CELLS: number[][] = [[], [0], [0, 2], [2], [0, 1, 2], [1, 2]];

/** A random cell for a beat; busier bars rest less and play more triplets. */
function pickCell(random: () => number, density: number): number[] {
  const weights = [(1 - density) * 3, 1.6, 1.4 + density, 0.8, 0.4 + density * 2, 0.6 + density];
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return CELLS[i];
  }
  return CELLS[1];
}

/**
 * A drum solo for consecutive bars (their start beats), in swung triplets, which also suits the other styles.
 * Every two bars state an idea and answer it; the playing gets busier and louder bar by bar, from snare and kick
 * to toms, and the last bar fills into the soloist's bars. The hi-hat foot keeps the backbeats (2 and 4, or 2 and 3 in 3/4) throughout.
 */
export function drumSolo(starts: number[], beatsPerBar: number, random: () => number): NoteEvent[] {
  const out: NoteEvent[] = [];
  const last = starts.length - 1;
  const third = 1 / 3;
  const fillBeats = beatsPerBar === 3 ? 1 : 2;
  let idea: number[][] = [];
  starts.forEach((start, p) => {
    const progress = last > 0 ? p / last : 1;
    const density = 0.25 + 0.5 * progress;
    const base = 0.3 + 0.22 * progress;
    // The time stays clear: the foot on the backbeats.
    for (let beat = 1; beat < beatsPerBar; beat += beatsPerBar === 3 ? 1 : 2) out.push(hit(start + beat, "pedal", 0.34));
    // The first bar of a pair states a new idea; the second answers it, changing its last beat.
    if (p % 2 === 0 || idea.length === 0) idea = Array.from({ length: beatsPerBar }, () => pickCell(random, density));
    const cells = idea.map((c, beat) => (p % 2 === 1 && beat === beatsPerBar - 1 ? pickCell(random, density + 0.2) : c));
    const filling = p === last;
    const solid = filling ? beatsPerBar - fillBeats : beatsPerBar;
    for (let beat = 0; beat < solid; beat++) {
      for (const slot of cells[beat]) {
        const time = start + beat + slot * third;
        const accent = beat === 0 && slot === 0 ? 0.06 : 0;
        const wild = progress > 0.45 && random() < progress * 0.5;
        let drum: DrumSound;
        if (slot === 2) drum = random() < 0.45 + progress * 0.2 ? "kick" : "snare";
        else if (cells[beat].length === 3 && wild) drum = slot === 0 ? "tomHigh" : "tomLow";
        else if (slot === 0 && wild && random() < 0.4) drum = "tomLow";
        else drum = random() < 0.2 && progress < 0.5 ? "rim" : "snare";
        const ghost = drum === "snare" && slot !== 0 ? -0.08 : 0;
        out.push(hit(time, drum, base + accent + ghost + (random() - 0.5) * 0.08));
      }
    }
    if (filling) {
      // Triplets down the kit, growing, ending on the beat before the downbeat.
      const from = beatsPerBar - fillBeats;
      const total = fillBeats * 3;
      const order: DrumSound[] = ["snare", "snare", "tomHigh", "tomHigh", "tomLow", "tomLow"];
      for (let i = 0; i < total; i++) {
        const drum: DrumSound = i === total - 1 ? "kick" : order[Math.min(order.length - 1, Math.floor((i * order.length) / total))];
        out.push(hit(start + from + i * third, drum, 0.4 + (0.3 * i) / (total - 1)));
      }
    }
  });
  return out;
}

/**
 * Applies the turns marked by `markTrading` to the band's notes: bass, piano and guitar stop
 * in the drums' and out bars (a note that began before rings no further than the bar's start), the
 * drums play a solo in place of the groove (nothing in a band-out bar), and a crash marks the downbeat
 * where the soloist comes back. `seed` keeps the solos the same each time.
 */
export function applyTrading(events: NoteEvent[], bars: TimelineBar[], beatsPerBar: number, mode: TradeMode, seed: number, drums = true): NoteEvent[] {
  if (mode === "off" || !bars.some((b) => b.trade === "drums" || b.trade === "out")) return events;
  const quiet = (b: TimelineBar | undefined) => b?.trade === "drums" || b?.trade === "out";
  // Runs of consecutive quiet bars.
  const runs: TimelineBar[][] = [];
  bars.forEach((b, i) => {
    if (!quiet(b)) return;
    if (quiet(bars[i - 1]) && bars[i - 1].trade === b.trade) runs[runs.length - 1].push(b);
    else runs.push([b]);
  });
  const inRun = (t: number) => runs.some((r) => t >= r[0].startBeat - 1e-6 && t < r[r.length - 1].startBeat + beatsPerBar - 1e-6);
  const kept: NoteEvent[] = [];
  for (const e of events) {
    if (inRun(e.time)) continue;
    // A note that began earlier stops where the next quiet run starts.
    const stop = e.track === "drums" ? undefined : runs.find((r) => r[0].startBeat >= e.time && r[0].startBeat < e.time + e.duration);
    kept.push(stop ? { ...e, duration: stop[0].startBeat - e.time } : e);
  }
  for (const run of runs) {
    const first = run[0];
    if (drums && first.trade === "drums") {
      const key = (first.chorus * 53 + (first.ref ? first.ref.section * 31 + first.ref.bar : 0)) * 17;
      kept.push(...drumSolo(run.map((b) => b.startBeat), beatsPerBar, seededRandom(seed * 1000 + key)));
      const after = first.startBeat + run.length * beatsPerBar;
      if (bars.some((b) => b.startBeat === after && b.trade === "you")) kept.push(hit(after, "crash", 0.6, 1.5));
    }
  }
  return kept.sort((a, b) => a.time - b.time);
}
