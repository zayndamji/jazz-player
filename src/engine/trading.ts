import { gauss } from "../styles/feel";
import { seededRandom } from "../styles/random";
import { EVEN_SWING, swingRatio } from "../styles/swing";
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

/**
 * How the drums solo: the style the band is in, the tempo, and the swing ratio (where the swung
 * and falls in the beat, 0.5 to 0.75; left out, the style's curve for the tempo).
 * Bossa and other straight styles solo on a straight 16th grid, the ballad with brushes,
 * swing, waltz and 5/4 in swung triplets (eighths above `UP_TEMPO_SOLO`).
 */
export interface SoloFeel {
  style: string;
  bpm: number;
  swing?: number;
}

/** Style ids that play straight eighths, so their drum solos do too. */
const STRAIGHT_STYLES = new Set(["bossa", "samba", "latin", "straight", "even", "rock", "funk", "afro", "songo"]);

/** Above this tempo a swing solo plays mostly swung eighths, with only the odd triplet roll. */
export const UP_TEMPO_SOLO = 220;

type Kit = "sticks" | "samba" | "brushes";
/** `steps` per beat: 3 (triplets), 2 (up-tempo eighths) or 4 (straight 16ths). */
interface Grid {
  kit: Kit;
  steps: number;
  ratio: number;
  bpm: number;
}

function gridFor(feel: SoloFeel | undefined, beatsPerBar: number): Grid {
  const style = feel?.style ?? (beatsPerBar === 3 ? "waltz" : beatsPerBar === 5 ? "five" : "swing");
  const bpm = feel?.bpm && feel.bpm > 0 ? feel.bpm : 140;
  const ratio = Math.min(0.75, Math.max(0.5, feel?.swing ?? swingRatio(bpm, style === "waltz" || style === "five" ? EVEN_SWING : undefined)));
  if (STRAIGHT_STYLES.has(style) || (feel?.swing !== undefined && feel.swing < 0.53)) return { kit: "samba", steps: 4, ratio: 0.5, bpm };
  if (style === "ballad") return { kit: "brushes", steps: 3, ratio, bpm };
  return { kit: "sticks", steps: bpm > UP_TEMPO_SOLO ? 2 : 3, ratio, bpm };
}

/**
 * Where each sound sits against the beat in ms (`[offset, jitter SD]`), as in the styles' pockets
 * (src/styles/feel.ts): the snare a hair behind, the kick a hair ahead, the foot steady.
 */
const SOLO_POCKET: Partial<Record<DrumSound, [number, number]>> = {
  snare: [3, 6],
  rim: [3, 6],
  brushTap: [3, 7],
  brush: [2, 8],
  kick: [-1, 5],
  tomHigh: [1, 6],
  tomLow: [1, 6],
  pedal: [1, 3],
  hat: [0, 5],
  crash: [0, 4],
};
/** No solo note moves further than this from the grid (ms). */
const SOLO_LIMIT = 16;

/**
 * Human timing for a solo: a slow shared drift (a few ms over bars) plus each note's own error,
 * in beats. Smaller at fast tempos, where the same ms is a bigger share of the beat.
 */
function soloClock(random: () => number, bpm: number) {
  const scale = Math.min(1, Math.max(0.45, 170 / bpm));
  const beats = (ms: number) => (ms / 1000) * (bpm / 60);
  let drift = 0;
  return {
    bar() {
      drift = Math.max(-6, Math.min(6, drift * 0.7 + gauss(random) * 2.5));
    },
    at(drum: DrumSound) {
      const [offset, jitter] = SOLO_POCKET[drum] ?? [0, 5];
      const ms = (drift + offset + Math.max(-2, Math.min(2, gauss(random))) * jitter) * scale;
      return beats(Math.max(-SOLO_LIMIT, Math.min(SOLO_LIMIT, ms)));
    },
  };
}

/** Positions in a bar are counted in twelfths of a beat, which hold triplets, eighths and 16ths. */
const FINE = 12;
type Role = "accent" | "tap" | "kick" | "both";
/** A hit in a bar's line: accent, ghost tap, kick, or an accent with the kick under it; `tom` is the chance it goes to the toms. */
type Note = { role: Role; tom: number };
type Line = Map<number, Note>;
/** What a bar of the solo does: state the idea, answer or restate it, develop it, build, fill. */
type Kind = "statement" | "answer" | "restate" | "develop" | "build" | "fill";

/** Each beat's cells (steps that sound) per grid, weighted by the bar's density. */
const CELLS: Record<number, { steps: number[]; weight: (d: number) => number }[]> = {
  3: [
    { steps: [], weight: (d) => (1 - d) * 2.5 },
    { steps: [0], weight: () => 1.6 },
    { steps: [0, 2], weight: (d) => 1.4 + d },
    { steps: [2], weight: () => 0.8 },
    { steps: [0, 1, 2], weight: (d) => 0.3 + d * 1.6 },
    { steps: [1, 2], weight: (d) => 0.5 + d },
  ],
  2: [
    { steps: [], weight: (d) => (1 - d) * 2.5 },
    { steps: [0], weight: () => 1.5 },
    { steps: [0, 1], weight: (d) => 1.2 + d * 1.5 },
    { steps: [1], weight: () => 1 },
  ],
  4: [
    { steps: [], weight: (d) => (1 - d) * 2 },
    { steps: [0], weight: () => 1.2 },
    { steps: [0, 2], weight: () => 1.2 },
    { steps: [0, 3], weight: () => 1 },
    { steps: [0, 2, 3], weight: (d) => 0.6 + d },
    { steps: [2, 3], weight: () => 0.6 },
    { steps: [0, 1, 2, 3], weight: (d) => 0.2 + d * 1.2 },
    { steps: [1, 3], weight: (d) => 0.4 + d * 0.5 },
    { steps: [3], weight: () => 0.6 },
    { steps: [0, 1, 3], weight: (d) => 0.4 + d * 0.5 },
  ],
};

function pickCell(random: () => number, steps: number, density: number): number[] {
  const cells = CELLS[steps];
  const weights = cells.map((c) => Math.max(0, c.weight(density)));
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cells.length; i++) {
    r -= weights[i];
    if (r < 0) return cells[i].steps;
  }
  return cells[1].steps;
}

/** Puts a cell on a beat of a line: the first hit accented, the rest ghosted, a lone off-beat now and then on the kick. */
function addCell(line: Line, beat: number, cell: number[], steps: number, tom: number, random: () => number) {
  const unit = FINE / steps;
  cell.forEach((k, i) => {
    let role: Role = i === 0 ? "accent" : "tap";
    // A cell starting off the beat leans on its last note (the swung and).
    if (cell[0] !== 0 && cell.length > 1) role = i === cell.length - 1 ? "accent" : "tap";
    if (cell.length === 1 && k !== 0 && random() < 0.4) role = "kick";
    else if (cell.length === 2 && k === steps - 1 && i === 1 && random() < 0.3) role = "kick";
    line.set(beat * FINE + k * unit, { role, tom });
  });
}

/** A line of cells over beats `from` to `to`. */
function cellLine(grid: Grid, from: number, to: number, density: number, tom: number, random: () => number, line: Line = new Map()): Line {
  for (let beat = from; beat < to; beat++) addCell(line, beat, pickCell(random, grid.steps, density), grid.steps, tom, random);
  return line;
}

/**
 * One-bar samba and partido-alto figures for a straight solo (16ths): X accent, x ghost, k kick.
 * Most group the bar 3 + 3 + 2, as bossa and samba drummers phrase.
 */
const SAMBA = ["X..X..X...X..X..", "X.xX.xX.x.X.xX.x", "X..x.X.x..X..x.X", "X.x.X..xX.x.X..x", "X..X.x.XX..X.x.X", "X.kX..X.k.X.X..x"];

/**
 * The idea the solo starts from: a full, confident bar, on the downbeat with the kick under it,
 * at least `minHits` hits.
 */
function statementLine(grid: Grid, bpb: number, random: () => number, minHits: number): Line {
  let line: Line = new Map();
  if (grid.kit === "samba" && bpb === 4) {
    const figure = SAMBA[Math.floor(random() * SAMBA.length)];
    [...figure].forEach((c, k) => {
      if (c === "X") line.set(k * 3, { role: "accent", tom: 0.05 });
      else if (c === "x" && random() < 0.85) line.set(k * 3, { role: "tap", tom: 0 });
      else if (c === "k") line.set(k * 3, { role: "kick", tom: 0 });
    });
  } else line = cellLine(grid, 0, bpb, grid.kit === "brushes" ? 0.3 : 0.55, 0.05, random);
  line.set(0, { role: "both", tom: 0 });
  const unit = FINE / grid.steps;
  for (let guard = 0; line.size < minHits && guard < 60; guard++) {
    const beat = Math.floor(random() * bpb);
    // Triplet fillers on the beat or the swung and, not a lone middle triplet.
    const k = grid.steps === 3 ? (random() < 0.6 ? 0 : 2) : Math.floor(random() * grid.steps);
    const key = beat * FINE + k * unit;
    if (!line.has(key)) line.set(key, { role: k === 0 ? "accent" : "tap", tom: 0.05 });
  }
  return line;
}

/** The statement again with some beats played anew, those leaning to the toms: the answer to the idea, or its restatement. */
function varyLine(statement: Line, grid: Grid, beats: number[], random: () => number): Line {
  const density = grid.kit === "brushes" ? 0.4 : 0.75;
  const line: Line = new Map([...statement].map(([k, n]) => [k, { ...n, tom: 0.12 }]));
  for (const beat of beats) {
    for (const k of [...line.keys()]) if (Math.floor(k / FINE) === beat) line.delete(k);
    addCell(line, beat, pickCell(random, grid.steps, density), grid.steps, 0.55, random);
  }
  return line;
}

/** Bars of the solo as a phrase: a statement and its answer, development in the middle, a build into the fill. */
function planBars(n: number, random: () => number): Kind[] {
  if (n === 1) return ["fill"];
  const kinds: Kind[] = Array(n).fill("develop");
  kinds[0] = "statement";
  kinds[n - 1] = "fill";
  if (n >= 3) kinds[1] = random() < 0.75 ? "answer" : "develop";
  if (n >= 6) {
    kinds[2] = random() < 0.6 ? "restate" : "answer";
    kinds[3] = "answer";
    kinds[n - 2] = "build";
  } else if (n >= 4 && random() < 0.35) kinds[n - 2] = "build";
  return kinds;
}

/** The fill into the soloist's bars, from beat `from`: streams down the kit or accent groups, growing, the kick on the last note. */
function fillHits(grid: Grid, from: number, beats: number, random: () => number): { at: number; drum: DrumSound; v: number }[] {
  const out: { at: number; drum: DrumSound; v: number }[] = [];
  if (grid.kit === "brushes") {
    // Soft brush taps in triplets, thinning the early ones, with a sweep under them.
    out.push({ at: from, drum: "brush", v: 0.4 });
    const total = beats * 3;
    for (let i = 0; i < total; i++) {
      if (i < total - 3 && i % 3 === 1) continue;
      const t = i / Math.max(1, total - 1);
      out.push({ at: from + i / 3, drum: i === total - 1 && random() < 0.5 ? "tomLow" : "brushTap", v: 0.32 + 0.22 * t });
    }
    return out;
  }
  const S = grid.steps;
  const total = beats * S;
  const variant = Math.floor(random() * 3);
  const group = S === 2 ? 3 : S === 3 ? 2 : 3;
  const down: DrumSound[] = ["snare", "snare", "tomHigh", "tomHigh", "tomLow", "tomLow"];
  for (let i = 0; i < total; i++) {
    const k = i % S;
    const at = from + Math.floor(i / S) + (S === 2 ? (k ? grid.ratio : 0) : k / S);
    const t = i / Math.max(1, total - 1);
    let drum: DrumSound;
    let accent: boolean;
    if (variant === 0) {
      // Down the kit.
      drum = down[Math.min(down.length - 1, Math.floor(t * down.length))];
      accent = k === 0;
    } else if (variant === 1) {
      // A snare build, then the toms.
      drum = t < 0.5 ? "snare" : i % 2 ? "tomLow" : "tomHigh";
      accent = t >= 0.5 && i % 2 === 0;
    } else {
      // Accents in groups across the beat (quarter-note triplets, dotted eighths), ghosts between.
      accent = i % group === 0;
      drum = accent ? (Math.floor(i / group) % 2 ? "tomLow" : "tomHigh") : "snare";
    }
    if (i === total - 1) drum = "kick";
    out.push({ at, drum, v: 0.48 + 0.2 * t + (accent ? 0.04 : -0.02) });
    if (i === total - 1 && variant === 1) out.push({ at, drum: "snare", v: 0.66 });
  }
  return out;
}

/** Each kind of bar's level before accents: the statement firm, the answer a little back, the build growing. */
const BASE: Record<Kind, number> = { statement: 0.46, answer: 0.43, restate: 0.45, develop: 0.44, build: 0.48, fill: 0.46 };

/** The drum for a note: kicks stay kicks, accents go to the toms by the note's chance; brushes play taps. */
function drumFor(note: Note, grid: Grid, early: boolean, random: () => number): DrumSound {
  if (note.role === "kick") return "kick";
  const toms = note.role !== "tap" && random() < note.tom;
  if (grid.kit === "brushes") return toms && random() < 0.5 ? "tomLow" : "brushTap";
  if (toms) return random() < 0.55 ? "tomHigh" : "tomLow";
  // Bossa drummers start on the cross-stick and move to the snare.
  if (grid.kit === "samba" && random() < (early ? 0.45 : 0.15)) return "rim";
  return "snare";
}

const clamp = (v: number) => Math.min(0.7, Math.max(0.2, v));
const hit = (time: number, drum: DrumSound, velocity: number, duration = 0.25, gain?: number): NoteEvent => ({
  track: "drums",
  time,
  duration,
  velocity: clamp(velocity),
  drum,
  ...(gain === undefined ? {} : { gain }),
});

/** Where a line's position falls in the beat: a lone swung and at the swing ratio, triplets and 16ths on their grid. */
function place(line: Line, key: number, grid: Grid): number {
  const beat = Math.floor(key / FINE);
  const r = key % FINE;
  if (grid.kit !== "samba" && (r === 6 || (r === 8 && !line.has(beat * FINE + 4)))) return beat + grid.ratio;
  return key / FINE;
}

/**
 * A drum solo for consecutive bars (their start beats), shaped as a phrase: a confident first
 * bar (the downbeat with the kick, a full idea), an answer and restatements, development in the middle
 * (the idea displaced or a figure tiled across the bar line, moving to the toms), a build, and a fill
 * that sets up the soloist's return. Accents, ghost notes and the build shape the velocities; every hit
 * has human timing. Swing, waltz and 5/4 play swung triplets (the ands at the swing ratio, eighths
 * when up-tempo), bossa and straight styles 16th-note samba figures with the cross-stick and hi-hat
 * eighths, the ballad a soft, sparse brush solo. The hi-hat foot keeps the backbeats (2 and 4, or
 * 2 and 3 in 3/4) throughout. `gain` is the chorus's drum level, as the styles set it.
 */
export function drumSolo(starts: number[], beatsPerBar: number, random: () => number, feel?: SoloFeel, gain?: number): NoteEvent[] {
  const bpb = beatsPerBar;
  const grid = gridFor(feel, bpb);
  const n = starts.length;
  const clock = soloClock(random, grid.bpm);
  const kinds = planBars(n, random);
  const long = n >= 8;
  const fillBeats = Math.min(bpb, grid.kit === "brushes" ? (long ? 2 : 1) : bpb === 3 ? (long ? 2 : 1) : long ? 3 : 2);
  const minHits = grid.kit === "brushes" ? 3 : bpb === 3 ? 4 : bpb + 1;
  const statement = statementLine(grid, bpb, random, minHits);
  // How the middle develops the idea, different from turn to turn.
  const unit = FINE / grid.steps;
  const tiled = random() < 0.5;
  const periods = grid.kit === "samba" ? [3, 6] : grid.steps === 2 ? [3] : bpb === 4 ? [4, 2] : [6, 4];
  const period = periods[Math.floor(random() * periods.length)];
  const motif = new Set([0]);
  for (let k = 1; k < period; k++) if (grid.kit !== "brushes" && random() < 0.3) motif.add(k);
  const shiftBy = grid.kit === "samba" || grid.steps === 2 ? 6 : random() < 0.5 ? FINE : 8;
  let developed = 0;

  const out: NoteEvent[] = [];
  const push = (time: number, drum: DrumSound, v: number, duration = 0.25) => out.push(hit(time + clock.at(drum), drum, v, duration, gain));
  starts.forEach((start, p) => {
    clock.bar();
    const kind = kinds[p];
    const progress = n > 1 ? p / (n - 1) : 1;
    const early = progress < 0.5;
    // The time stays clear: the foot on the backbeats.
    for (let beat = 1; beat < bpb; beat += bpb === 3 ? 1 : 2) push(start + beat, "pedal", 0.34 + gauss(random) * 0.015);
    const solid = kind === "fill" ? bpb - fillBeats : bpb;
    let line: Line;
    if (kind === "statement") line = statement;
    else if (kind === "answer") line = varyLine(statement, grid, bpb >= 4 && random() < 0.4 ? [bpb - 2, bpb - 1] : [bpb - 1], random);
    else if (kind === "restate") line = varyLine(statement, grid, [1 + Math.floor(random() * (bpb - 1))], random);
    else if (kind === "develop") {
      line = new Map();
      if (tiled) {
        // A figure repeating across the bar line (quarter-note triplets, dotted quarters, hemiola in 3).
        for (let k = 0; k * unit < bpb * FINE; k++) {
          const at = (developed * bpb * grid.steps + k) % period;
          if (motif.has(at)) line.set(k * unit, { role: at === 0 ? (random() < 0.25 ? "both" : "accent") : random() < 0.25 ? "kick" : "tap", tom: at === 0 ? 0.5 : 0.1 });
        }
      } else {
        // The idea displaced, further each bar, with more ghosts.
        const shift = (shiftBy * (developed + 1)) % (bpb * FINE);
        for (const [k, note] of statement) line.set((k + shift) % (bpb * FINE), { ...note, role: note.role === "both" ? "accent" : note.role, tom: 0.4 });
        for (let i = 0; i < 2; i++) {
          const key = Math.floor(random() * bpb * grid.steps) * unit;
          if (!line.has(key)) line.set(key, { role: "tap", tom: 0 });
        }
      }
      developed++;
    } else line = cellLine(grid, 0, solid, grid.kit === "brushes" ? 0.45 : kind === "build" ? 0.85 : 0.6, kind === "build" ? 0.6 : 0.4, random);

    const hits: { at: number; drum: DrumSound; v: number }[] = [];
    for (const [key, note] of line) {
      if (key >= solid * FINE) continue;
      // Brushes leave out half the ghost notes: the ballad solo stays sparse.
      if (grid.kit === "brushes" && note.role === "tap" && random() < 0.5) continue;
      const at = place(line, key, grid);
      const drum = drumFor(note, grid, early, random);
      let v = BASE[kind] + 0.05 * progress;
      if (kind === "build" || kind === "fill") v += 0.08 * (at / bpb);
      if (note.role === "accent" || note.role === "both") v += 0.12 + (key === 0 ? 0.04 : 0);
      else if (note.role === "tap") v = 0.22 + 0.05 * progress + random() * 0.04;
      else v -= 0.04;
      if (drum === "rim") v *= 0.85;
      if (grid.kit === "brushes") v *= 0.75;
      hits.push({ at, drum, v: v + gauss(random) * 0.02 });
      if (note.role === "both") hits.push({ at, drum: "kick", v: (grid.kit === "brushes" ? 0.3 : 0.52) + 0.05 * progress });
    }
    if (kind === "fill") hits.push(...fillHits(grid, solid, fillBeats, random));
    if (grid.kit === "brushes") {
      // The brush keeps sweeping under the taps, less as it builds.
      for (const beat of kind === "build" || kind === "fill" ? [0] : bpb === 3 ? [0] : [0, 2]) if (beat < solid) hits.push({ at: beat, drum: "brush", v: 0.38 });
    }
    if (grid.kit === "samba") {
      // The hi-hat keeps eighths under the hands, until the right hand moves to the toms.
      const toms = hits.filter((h) => h.drum === "tomHigh" || h.drum === "tomLow").map((h) => h.at);
      for (let e = 0; e < solid * 2; e++) if (!toms.some((t) => Math.abs(t - e / 2) < 0.13)) hits.push({ at: e / 2, drum: "hat", v: e % 2 ? 0.22 : 0.3 });
      // The surdo beat on 3 in the opening bars.
      if ((kind === "statement" || kind === "answer" || kind === "restate") && bpb === 4 && !hits.some((h) => h.drum === "kick" && Math.abs(h.at - 2) < 0.01)) hits.push({ at: 2, drum: "kick", v: 0.36 });
    }
    for (const h of hits) push(start + h.at, h.drum, h.v, h.drum === "brush" ? 0.5 : 0.25);
  });
  return out.sort((a, b) => a.time - b.time);
}

/**
 * Applies the turns marked by `markTrading` to the band's notes: bass, piano and guitar stop
 * in the drums' and out bars (a note that began before rings no further than the bar's start), the
 * drums play a solo in place of the groove (nothing in a band-out bar), and a crash marks the downbeat
 * where the soloist comes back. `seed` keeps the solos the same each time. `feel` (the style id, tempo and
 * optionally the swing ratio) sets how the solos are played; left out, they swing at 140 BPM (in 3/4 as
 * a waltz, in 5/4 as the five style). The solo takes the drum level (`gain`) of the groove it replaces.
 */
export function applyTrading(events: NoteEvent[], bars: TimelineBar[], beatsPerBar: number, mode: TradeMode, seed: number, drums = true, feel?: SoloFeel): NoteEvent[] {
  if (mode === "off" || !bars.some((b) => b.trade === "drums" || b.trade === "out")) return events;
  const quiet = (b: TimelineBar | undefined) => b?.trade === "drums" || b?.trade === "out";
  // Runs of consecutive quiet bars.
  const runs: TimelineBar[][] = [];
  bars.forEach((b, i) => {
    if (!quiet(b)) return;
    if (quiet(bars[i - 1]) && bars[i - 1].trade === b.trade) runs[runs.length - 1].push(b);
    else runs.push([b]);
  });
  // The styles play each note a few ms off the grid, so a run (and the bar after it) starts just before its downbeat.
  const EARLY = 0.06;
  const within = (r: TimelineBar[], t: number) => t >= r[0].startBeat - EARLY && t < r[r.length - 1].startBeat + beatsPerBar - EARLY;
  const inRun = (t: number) => runs.some((r) => within(r, t));
  const kept: NoteEvent[] = [];
  const levels = new Map<TimelineBar[], number>();
  for (const e of events) {
    if (inRun(e.time)) {
      // The groove's level, from a drum (the styles lift the cymbals on top of it).
      const level = e.track === "drums" && e.gain !== undefined && e.drum !== "ride" && e.drum !== "hat";
      const run = level ? runs.find((r) => within(r, e.time)) : undefined;
      if (run && !levels.has(run)) levels.set(run, e.gain!);
      continue;
    }
    // A note that began earlier stops where the next quiet run starts.
    const stop = e.track === "drums" ? undefined : runs.find((r) => r[0].startBeat >= e.time && r[0].startBeat < e.time + e.duration);
    kept.push(stop ? { ...e, duration: stop[0].startBeat - e.time } : e);
  }
  for (const run of runs) {
    const first = run[0];
    if (drums && first.trade === "drums") {
      const key = (first.chorus * 53 + (first.ref ? first.ref.section * 31 + first.ref.bar : 0)) * 17;
      const random = seededRandom(seed * 1000 + key);
      const gain = levels.get(run);
      // In a tune whose sections play in different styles, the solo takes the style of the bars it plays over.
      const runFeel = feel && first.style ? { ...feel, style: first.style } : feel;
      kept.push(...drumSolo(run.map((b) => b.startBeat), beatsPerBar, random, runFeel, gain));
      const after = first.startBeat + run.length * beatsPerBar;
      if (bars.some((b) => b.startBeat === after && b.trade === "you")) {
        // The crash back, a touch off the grid like the band's downbeat, softer behind brushes and bossa.
        const grid = gridFor(feel && first.style ? { ...feel, style: first.style } : feel, beatsPerBar);
        const ms = Math.max(-8, Math.min(8, gauss(random) * 3));
        kept.push(hit(after + (ms / 1000) * (grid.bpm / 60), "crash", grid.kit === "brushes" ? 0.42 : grid.kit === "samba" ? 0.5 : 0.6, 1.5, gain));
      }
    }
  }
  return kept.sort((a, b) => a.time - b.time);
}
