import type { ParsedChord } from "../chart/chords";
import { chordScale } from "../chart/scales";
import { chordAt, sameRef, type TimelineBar } from "../engine/timeline";
import { GUITAR_RANGE, SWING_RANGE, voiceChord, type VoicingRange } from "../engine/voicing";
import { drumGain, drumTalk, gauss, pianoTouch, timing, type ChorusPlan } from "./feel";
import { seededRandom } from "./random";
import { shapeBars, steadyBars, weighted } from "./shape";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Swing, 4/4, from slow-medium to up-tempo. Offbeat eighths fall two thirds of the
 * way through the beat at a medium 140 BPM (a 2:1 swing, measured from a reference
 * track, context/style-swing.md), straighter as the tempo rises (`swingRatio`), a
 * little harder as the solos build.
 * - The performance arcs (feel.ts `chorusPlans`): a lighter head, solo choruses that
 *   build to a peak, and an out-head back in the head's texture with a shout at the end.
 * - Bass: walks in quarter notes. Root on the chord's first beat, chord tones and
 *   scale steps in between, and a half-step approach into the next chord. Ghosted
 *   notes and chromatic pickups between beats, more as the band builds; higher at the peak.
 * - Piano: the only chord instrument (a piano trio, like the reference tracks).
 *   Close rootless voicings with the 3rd or 7th at the bottom, on one-bar comping
 *   cells that change every bar (busier ones as the band builds), with the register,
 *   the size of the voicing (shells to two-hand chords) and the note lengths changing
 *   with the chorus. Each chord is touched like a pianist's: top note louder, notes a
 *   few milliseconds apart. The piano sometimes recalls what it played at the same
 *   place in the form. A hit on the and of 4 anticipates the next chord.
 * - Guitar (only when a chart's `band` adds it): soft four to the bar.
 * - Drums: the ride plays two-bar figures around a home pattern picked per chorus (the
 *   head sometimes on closed hi-hat), with the accent moving between choruses; hi-hat
 *   foot on 2 and 4; feathered kick; snare comping in the piano's gaps; crashes and
 *   kick-and-crash set-ups into sections; fills picked from a vocabulary at phrase ends
 *   (small), section ends (medium) and the end of the form (big).
 * - Time: every part in its own pocket (bass on the ride or a hair behind, piano behind) with a shared
 *   slow drift and per-note error (feel.ts `timing`), instead of the grid.
 * - Up-tempo (from `UP_TEMPO`): sparser, longer piano hits with bars left empty,
 *   the guitar fades out, eighth-note fills instead of triplets.
 * - Straight (`Feel.variation`): spang-a-lang and the Charleston every bar, one bass
 *   touch, one level and register, no snare comping; a short fill and a crash only at
 *   the end of the form.
 * - Two-feel (`Feel.twoFeel`): the intro, the first chorus and the out-head with the
 *   bass in half notes (with a pickup now and then), cross-stick on 4 and sparse
 *   comping; the last bar of a chorus in two walks into the next.
 */

const RECORD_SWING: [number, number][] = [[60, 0.7], [100, 0.7], [120, 0.715], [160, 0.7], [185, 0.685], [220, 0.64], [280, 0.57]];

/**
 * The waltz and 5/4 curve: 2:1 at 140, which Coltrane's and Brubeck's rides match
 * (0.66 to 0.67 at 168 to 170).
 */
export const EVEN_SWING: [number, number][] = [[60, 0.71], [140, 2 / 3], [200, 0.62], [280, 0.57]];

/**
 * Where the swung offbeat eighth falls in the beat, by tempo. The rides on the tunes'
 * original records put it at 0.68 to 0.77 of the beat from 110 to 175 BPM, harder than
 * backing tracks (2:1, 0.67), and about 0.69 at 80 to 90 (context/original-records.md);
 * straighter as the tempo rises toward 1:1 near 300 BPM.
 */
export function swingRatio(bpm: number, points: [number, number][] = RECORD_SWING): number {
  if (bpm <= points[0][0]) return points[0][1];
  for (let k = 1; k < points.length; k++) {
    const [b1, r1] = points[k];
    const [b0, r0] = points[k - 1];
    if (bpm <= b1) return r0 + ((bpm - b0) / (b1 - b0)) * (r1 - r0);
  }
  return points.at(-1)![1];
}

/** At and above this tempo the band plays its up-tempo feel. */
export const UP_TEMPO = 190;

type Figure = { weight: number; hits: [number, number, number][] };

/**
 * Piano comping cells over one bar, as [eighth slot (0 to 7, swung), length in beats, velocity].
 * Measured references comp two to four times a bar with their weight on 2 and 4 and on
 * the swung ands before beats (context/backing-track-design.md); the cells mix those
 * with the classic Charleston figures. Slot 7 (the and of 4) anticipates the next chord.
 * Busier cells are picked more as the band builds (`density`).
 */
const COMP: Figure[] = [
  { weight: 0.15, hits: [[2, 0.45, 0.5], [6, 0.45, 0.5]] }, // 2 and 4
  { weight: 0.13, hits: [[0, 0.8, 0.5], [3, 0.5, 0.48]] }, // Charleston: 1, and of 2
  { weight: 0.1, hits: [[1, 0.5, 0.48], [4, 1.1, 0.5]] }, // and of 1, 3
  { weight: 0.12, hits: [[0, 0.6, 0.5], [4, 0.6, 0.45], [6, 0.5, 0.48]] }, // 1, 3, 4
  { weight: 0.1, hits: [[3, 0.6, 0.5], [7, 0.8, 0.52]] }, // and of 2, and of 4
  { weight: 0.1, hits: [[2, 0.5, 0.48], [5, 0.6, 0.5]] }, // 2, and of 3
  { weight: 0.08, hits: [[1, 0.5, 0.48], [4, 0.5, 0.45], [7, 0.8, 0.5]] }, // and of 1, 3, and of 4
  { weight: 0.08, hits: [[0, 0.35, 0.42], [2, 0.35, 0.45], [4, 0.35, 0.42], [6, 0.35, 0.45]] }, // light quarters
  { weight: 0.08, hits: [[2, 0.45, 0.48], [5, 0.4, 0.45], [7, 0.8, 0.5]] }, // 2, and of 3, and of 4
  { weight: 0.06, hits: [[0, 1.8, 0.45]] }, // held: space
  { weight: 0.07, hits: [[1, 0.45, 0.48], [2, 0.6, 0.46]] }, // and of 1, 2
  { weight: 0.07, hits: [[3, 0.4, 0.48], [4, 0.5, 0.45], [7, 0.8, 0.5]] }, // and of 2, 3, and of 4
  { weight: 0.07, hits: [[0, 0.4, 0.46], [3, 0.4, 0.46], [5, 0.5, 0.47]] }, // 1, and of 2, and of 3
  { weight: 0.06, hits: [[2, 0.3, 0.46], [3, 0.3, 0.44], [6, 0.6, 0.5]] }, // 2, and of 2, 4
  { weight: 0.05, hits: [[5, 1.6, 0.48]] }, // held from the and of 3
  { weight: 0.05, hits: [[1, 0.4, 0.45], [3, 0.4, 0.47], [5, 0.4, 0.47], [7, 0.7, 0.5]] }, // every and
  { weight: 0.06, hits: [[0, 0.3, 0.45], [1, 0.3, 0.47], [4, 1.2, 0.48]] }, // 1, and of 1, 3
];

/** Up-tempo figures: fewer, longer hits, and some bars left empty for the soloist. */
const COMP_FAST: Figure[] = [
  { weight: 0.25, hits: [[0, 1.6, 0.5]] }, // held on 1
  { weight: 0.25, hits: [[3, 1.4, 0.48]] }, // held on the and of 2
  { weight: 0.15, hits: [[1, 0.9, 0.45]] }, // and of 1
  { weight: 0.15, hits: [[0, 0.5, 0.45], [5, 1.0, 0.45]] }, // 1, and of 3
  { weight: 0.2, hits: [] }, // lay out
];

/** Two-feel figures: sparse and on the beat more often, under a melody. */
const COMP_TWO: Figure[] = [
  { weight: 0.3, hits: [[0, 1.5, 0.45]] },
  { weight: 0.25, hits: [[0, 0.8, 0.45], [3, 0.5, 0.4]] }, // Charleston
  { weight: 0.2, hits: [[3, 1.4, 0.45]] },
  { weight: 0.25, hits: [] },
];

/**
 * The straight feel's comping, the same every bar: the Charleston (1 and the and of 2)
 * over one chord, otherwise a hit where each chord starts.
 */
export function straightCell(bar: TimelineBar): Figure["hits"] {
  if (bar.chords.length <= 1) return [[0, 0.8, 0.5], [3, 0.5, 0.48]];
  return bar.chords.map((c): [number, number, number] => [Math.round(c.beat * 2), Math.min(0.8, c.length * 0.5), c.beat === 0 ? 0.5 : 0.48]);
}

/**
 * Pianists breathe in two-bar units: a busy bar is more often followed by a sparser one and
 * the other way round (the records' hits per bar correlate -0.1 to -0.16 with the bar before).
 */
const breathe = (hits: Figure["hits"], last: Figure["hits"] | undefined) =>
  !last ? 1 : last.length >= 3 ? (hits.length <= 2 ? 1.25 : 0.8) : last.length <= 1 ? (hits.length >= 3 ? 1.25 : 0.9) : 1;

/** A cell's weight for the chorus: busier cells when the band builds, sparser in the head. */
const forDensity = (f: Figure, density: number) => f.weight * density ** ((f.hits.length - 2) * 3) * (f.hits.length >= 3 ? 1.25 : 1);

/**
 * Ride cells over one bar, as [beat, where in the beat, velocity]: 0 on the beat, 1 the
 * swung skip after it, 2 the middle triplet (a "ding-da-da" figure).
 */
type RideCell = { id: string; hits: [number, 0 | 1 | 2, number][] };
const SPANG: RideCell = { id: "spang", hits: [[0, 0, 0.5], [1, 0, 0.62], [1, 1, 0.36], [2, 0, 0.5], [3, 0, 0.62], [3, 1, 0.36]] };
/** Variations around the home pattern; the full references play 4 to 16 distinct cymbal bars per 32 (context/whole-track-comparison.md). */
const RIDE: RideCell[] = [
  SPANG,
  { id: "quarters", hits: [[0, 0, 0.52], [1, 0, 0.58], [2, 0, 0.52], [3, 0, 0.58]] },
  { id: "skip4", hits: [[0, 0, 0.5], [1, 0, 0.62], [2, 0, 0.5], [3, 0, 0.62], [3, 1, 0.38]] },
  { id: "skip2", hits: [[0, 0, 0.5], [1, 0, 0.62], [1, 1, 0.38], [2, 0, 0.5], [3, 0, 0.62]] },
  { id: "extra", hits: [[0, 0, 0.5], [1, 0, 0.62], [1, 1, 0.36], [2, 0, 0.5], [2, 1, 0.32], [3, 0, 0.62], [3, 1, 0.36]] },
  { id: "lead", hits: [[0, 0, 0.5], [0, 1, 0.32], [1, 0, 0.62], [1, 1, 0.36], [2, 0, 0.5], [3, 0, 0.62], [3, 1, 0.36]] },
  { id: "skip3", hits: [[0, 0, 0.5], [1, 0, 0.62], [2, 0, 0.52], [2, 1, 0.38], [3, 0, 0.62]] },
  { id: "skip1", hits: [[0, 0, 0.52], [0, 1, 0.36], [1, 0, 0.6], [2, 0, 0.5], [3, 0, 0.62], [3, 1, 0.34]] },
  { id: "triplet", hits: [[0, 0, 0.5], [1, 0, 0.62], [1, 2, 0.3], [1, 1, 0.36], [2, 0, 0.5], [3, 0, 0.62], [3, 1, 0.36]] },
  { id: "space3", hits: [[0, 0, 0.52], [1, 0, 0.64], [1, 1, 0.34], [2, 1, 0.4], [3, 0, 0.62], [3, 1, 0.36]] },
  { id: "push", hits: [[0, 0, 0.5], [1, 0, 0.6], [1, 1, 0.34], [2, 0, 0.5], [3, 0, 0.56], [3, 1, 0.5]] },
];
/** Swung eighths all through: only at the peak. */
const DOUBLE: RideCell = { id: "double", hits: [0, 1, 2, 3].flatMap((b): [number, 0 | 1, number][] => [[b, 0, b % 2 ? 0.6 : 0.52], [b, 1, 0.36]]) };
/** Rings through 3 and leaves beat 4 open: a phrase end without a fill. */
const LONG: RideCell = { id: "long", hits: [[0, 0, 0.56], [1, 0, 0.6], [1, 1, 0.36], [2, 0, 0.58]] };

/**
 * How the bassist touches a bar: note length per beat (in beats) and how much each beat
 * leans. Players change this from bar to bar (legato, bouncing, pulling on 2 and 4), which
 * is most of what makes a recorded walking line vary (sub-band onset novelty 0.6 to 0.8 in
 * the references against 0.26 for a flat line).
 */
type BassTouch = { length: (beat: number) => number; lean: number[] };
const BASS_TOUCH: { weight: number; value: BassTouch }[] = [
  { weight: 0.3, value: { length: () => 0.92, lean: [0.08, -0.06, 0.03, -0.05] } }, // legato, on 1
  { weight: 0.2, value: { length: () => 0.55, lean: [0.05, -0.02, 0.04, -0.02] } }, // short, bouncing
  { weight: 0.2, value: { length: (b) => (b % 2 ? 0.5 : 0.95), lean: [-0.02, 0.1, -0.05, 0.1] } }, // long-short, 2 and 4 pulled
  { weight: 0.15, value: { length: () => 0.8, lean: [0.15, -0.09, 0.08, -0.07] } }, // heavy downbeats
  { weight: 0.15, value: { length: (b) => (b === 3 ? 0.45 : 0.9), lean: [0.02, -0.03, 0.02, 0.12] } }, // into the barline
];

/** Things a walking bassist adds on top of the quarters, at most once or twice a bar. */
type BassOrnament = "skip" | "rake" | "dead" | "turn";

type Accent = "twoFour" | "even" | "skip";

const BASS_LOW = 28; // E1
const BASS_HIGH = 50; // D3

/** The MIDI note of a pitch class nearest to `near`, inside the bass range. */
export function nearest(pc: number, near: number): number {
  let best = BASS_LOW + ((pc - BASS_LOW + 120) % 12);
  for (let n = best; n <= BASS_HIGH; n += 12) if (Math.abs(n - near) < Math.abs(best - near)) best = n;
  return best;
}

/** Pitch classes of a chord's scale, from its root. */
export function scalePcs(chord: ParsedChord): number[] {
  const steps: Record<string, number[]> = {
    Major: [0, 2, 4, 5, 7, 9, 11],
    Lydian: [0, 2, 4, 6, 7, 9, 11],
    Dorian: [0, 2, 3, 5, 7, 9, 10],
    "Melodic minor": [0, 2, 3, 5, 7, 9, 11],
    Mixolydian: [0, 2, 4, 5, 7, 9, 10],
    "Locrian ♮2": [0, 2, 3, 5, 6, 8, 10],
    "Whole tone": [0, 2, 4, 6, 8, 10],
    Altered: [0, 1, 3, 4, 6, 8, 10],
    "Half-whole": [0, 1, 3, 4, 6, 7, 9, 10],
    "Whole-half": [0, 2, 3, 5, 6, 8, 9, 11],
  };
  const name = chordScale(chord, "C", 0).name;
  return (steps[name] ?? steps.Major).map((s) => (chord.root + s) % 12);
}

/**
 * Walking line for `beats` beats of one chord, from `from` (the previous note)
 * toward `target` (the next chord's bass note). Returns MIDI notes.
 * `lean` (half steps) pulls the root toward a higher octave; `tones` is the chance of
 * a chord tone rather than a scale step between the root and the approach.
 */
export function walk(chord: ParsedChord, beats: number, from: number, target: number | null, random: () => number, lean = 0, tones = 0.6): number[] {
  const root = nearest(chord.bass, from + lean);
  const notes = [root];
  const chordTones = chord.intervals.map((i) => (chord.root + i) % 12);
  const scale = scalePcs(chord);
  let current = root;
  for (let b = 1; b < beats; b++) {
    const last = b === beats - 1;
    if (last && target !== null) {
      // Approach the next chord by a half step, from whichever side is closer.
      const below = target - 1;
      const above = target + 1;
      const pick = Math.abs(below - current) <= Math.abs(above - current) ? below : above;
      current = Math.min(BASS_HIGH, Math.max(BASS_LOW, random() < 0.75 ? pick : nearest((target + 7) % 12, current)));
    } else {
      // A chord tone or a scale step, moving toward the target.
      const goal = target ?? root + 7;
      const dir = goal >= current ? 1 : -1;
      const pool = random() < tones ? chordTones : scale;
      let n = current + dir;
      for (let k = 0; k < 12 && !pool.includes(((n % 12) + 12) % 12); k++) n += dir;
      if (n < BASS_LOW || n > BASS_HIGH) n = nearest(chordTones[1] ?? chord.root, current);
      current = n;
    }
    notes.push(current);
  }
  return notes;
}

/**
 * A two-feel bass part for one chord lasting `beats`: the root, then on a chord
 * of four beats or more the fifth (the chord's own, flat on half-diminished)
 * or, when the harmony moves on, a half step into the next chord on beat 3.
 * Returns [beat in the chord, MIDI note] pairs.
 */
export function twoBeat(chord: ParsedChord, beats: number, from: number, target: number | null, changing: boolean, random: () => number): [number, number][] {
  const root = nearest(chord.bass, from);
  const out: [number, number][] = [[0, root]];
  if (beats >= 4) {
    const step = chord.intervalNames.includes("5d") ? 6 : chord.intervalNames.includes("5A") ? 8 : 7;
    const fifth = nearest((chord.root + step) % 12, root);
    const third = changing && target !== null && random() < 0.5 ? (random() < 0.5 ? target - 1 : target + 1) : fifth;
    out.push([2, third]);
  }
  return out;
}

export function endsSection(bar: TimelineBar, next: TimelineBar | undefined): boolean {
  if (!bar.ref) return false;
  if (!next?.ref) return true;
  return next.ref.part !== bar.ref.part || next.ref.section !== bar.ref.section || next.ref.bar === 0;
}

export const isFormEnd = (bar: TimelineBar, next: TimelineBar | undefined) =>
  bar.ref?.part === "form" && (!next?.ref || next.ref.part !== "form" || next.chorus !== bar.chorus || sameRef(next.ref, { part: "form", section: 0, bar: 0 }));

/** A drum fill: hits as [beat offset from the fill's start, sound, velocity]. */
type Fill = { start: number; hits: [number, DrumSound, number][] };

/**
 * Fill vocabulary. `t` is a triplet or (fast) swung-eighth step. Small fills mark
 * four-bar phrases, medium ones section ends, big ones the end of the form.
 */
function fills(sw: number, fast: boolean) {
  const t = fast ? sw : 1 / 3;
  const step = (k: number) => (fast ? Math.floor(k / 2) + (k % 2 ? sw : 0) : k / 3);
  const small: Fill[] = [
    { start: 3, hits: [[sw, "snare", 0.32]] }, // a snare on the and of 4
    { start: 3, hits: [[0, "snare", 0.22], [sw, "snare", 0.34]] },
    { start: 3, hits: [[0, "kick", 0.3], [sw, "snare", 0.36]] }, // a set-up into the next phrase
    { start: 2, hits: [[sw, "snare", 0.24], [1 + sw, "kick", 0.32]] },
    { start: 3, hits: [[0, "kick", 0.28], [t, "snare", 0.26], [2 * t, "snare", 0.34]] },
    { start: 2, hits: [[sw, "snare", 0.22], [1 + sw, "snare", 0.3]] },
  ];
  const medium: Fill[] = [
    { start: 3, hits: [[0, "snare", 0.26], [t, "snare", 0.32], [2 * t, "snare", 0.4]] },
    { start: 2, hits: [[sw, "snare", 0.26], [1, "snare", 0.3], [1 + sw, "tomHigh", 0.36], [1 + (fast ? sw : 2 / 3), "tomLow", 0.4]] },
    { start: 3, hits: [[0, "snare", 0.3], [t, "tomHigh", 0.34], [2 * t, "tomLow", 0.4]] },
    { start: 2, hits: [[0, "snare", 0.24], [sw, "snare", 0.3], [1, "kick", 0.34], [1 + sw, "snare", 0.4]] },
    { start: 2, hits: [[0, "snare", 0.24], [t, "snare", 0.26], [2 * t, "tomHigh", 0.3], [1, "tomHigh", 0.32], [1 + t, "tomLow", 0.36], [1 + 2 * t, "tomLow", 0.4]] },
    { start: 2, hits: [[sw, "kick", 0.32], [1, "snare", 0.3], [1 + sw, "kick", 0.36]] },
  ];
  const run = (sounds: DrumSound[], from: number): Fill => ({
    start: from,
    hits: sounds.map((sd, k) => [step(k), sd, 0.3 + (k * 0.22) / sounds.length]),
  });
  const big: Fill[] = [
    run(["snare", "snare", "snare", "tomHigh", "tomHigh", "tomLow"], 2),
    run(["snare", "tomHigh", "snare", "tomHigh", "tomLow", "tomLow"], 2),
    run(["tomHigh", "tomHigh", "tomHigh", "snare", "tomLow", "tomLow"], 2),
    run(["snare", "snare", "tomHigh", "snare", "tomLow", "kick"], 2),
    run(["snare", "kick", "snare", "tomHigh", "kick", "tomLow"], 2),
  ];
  return { small, medium, big };
}

/** Snare (and kick) comping figures over one bar, as [beat, sound, velocity]; `sw` is the swung offbeat. */
const SNARE_COMP: ((sw: number) => [number, DrumSound, number][])[] = [
  (sw) => [[1 + sw, "snare", 0.2]],
  (sw) => [[3 + sw, "snare", 0.2]],
  (sw) => [[1 + sw, "snare", 0.16], [3 + sw, "snare", 0.22]],
  () => [[2 + 1 / 3, "snare", 0.14], [2 + 2 / 3, "snare", 0.2]],
  (sw) => [[sw, "snare", 0.16], [2 + sw, "snare", 0.2]],
  () => [[1 + 2 / 3, "snare", 0.16], [2, "kick", 0.24]],
  () => [[3, "snare", 0.14], [3 + 1 / 3, "snare", 0.13], [3 + 2 / 3, "snare", 0.22]],
  (sw) => [[2 + sw, "kick", 0.28], [3 + sw, "snare", 0.22]],
];

/** Level factor for the swing ride and hats (2 dB). */
const CYMBALS = 10 ** (2 / 20);

/** Which timing pocket (feel.ts) each drum sits in. */
const DRUM_POCKET: Record<DrumSound, "ride" | "hat" | "pedal" | "kick" | "snare" | "fill"> = {
  ride: "ride", hat: "hat", pedal: "pedal", kick: "kick", snare: "snare", rim: "snare",
  tomHigh: "fill", tomLow: "fill", crash: "fill", brush: "snare", brushTap: "snare",
};

export const swing: Style = {
  id: "swing",
  name: "Swing",
  twoFeel: true,
  // A piano trio, like the reference tracks: rhythm guitar only when a chart asks for it.
  band: ["bass", "piano", "drums"],
  // The bass leads and the piano sits under it (context/backing-track-design.md); the drums
  // 3.5 dB nearer the bass than the backing tracks have them, as on the original records
  // (drums 3 to 7 dB nearer in the solos, context/original-records.md).
  mix: { bass: 9, guitar: -6, piano: 1.5, drums: 6 },
  generate(bars, seed, feel) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const clock = timing(random, feel.tempo);
    const events: NoteEvent[] = [];
    // The ride and closed hats 2 dB up: eleven swing backing tracks average -25.4 dB in the hat band, the site measured -28.5.
    // The chorus's drum level (feel.ts `ChorusPlan.drums`), as a gain that leaves the sample layer alone.
    let drumLevel = 1;
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: time + clock.at(DRUM_POCKET[sound]), duration: 0.25, velocity: human(velocity, spread), gain: (sound === "ride" || sound === "hat" ? CYMBALS : 1) * drumLevel });

    const base = swingRatio(feel.tempo);
    const fast = feel.tempo >= UP_TEMPO;
    const slow = feel.tempo < 110;
    // Straight: one groove and one comping figure all through; only the form's end is marked.
    const straight = feel.variation === "straight";

    let piano: number[] | null = null;
    let guitar: number[] | null = null;
    let bassNote = 40;
    let pushedIn = false;
    let lastCell: Figure["hits"] | undefined;
    let twoBack: Figure["hits"] | undefined;
    let strolling = false;
    const talk = drumTalk(random);
    let lastFill: Fill | undefined;
    let ridePrev: RideCell | undefined;
    let touch: BassTouch | undefined;
    let crashAhead = false; // a set-up crash on the and of 4 already marked this bar's downbeat
    const music = bars.filter((b) => !b.countIn);
    const shapes = straight ? steadyBars(music) : shapeBars(music, random, true);
    // Per chorus: the ride's home pattern and accent; the head sometimes on closed hi-hat.
    const headHat = !fast && random() < 0.35;
    const rideHome = new Map<number, { home: RideCell; accent: Accent }>();
    const homeFor = (chorus: number, plan: ChorusPlan) => {
      if (!rideHome.has(chorus)) {
        const home = fast ? SPANG : weighted([{ weight: 0.7, value: SPANG }, { weight: 0.15, value: RIDE[2] }, { weight: 0.15, value: RIDE[4] }], random);
        const accent = weighted<Accent>([
          { weight: plan.role === "peak" ? 0.35 : 0.6, value: "twoFour" },
          { weight: plan.role === "peak" ? 0.45 : 0.2, value: "even" },
          { weight: 0.2, value: "skip" },
        ], random);
        rideHome.set(chorus, { home, accent });
      }
      return rideHome.get(chorus)!;
    };
    // What the piano played at each place in the form, to recall now and then.
    const memory = new Map<string, Figure["hits"]>();
    let registerDrift = 0;
    let phraseDb = 0;
    let phraseSlope = 0;
    let crashRide = false; // riding on the crash for a phrase at the peak
    let feathering = true;

    music.forEach((bar, i) => {
      const t = bar.startBeat;
      const next = music[i + 1];
      const prev = music[i - 1];
      const { intensity: lift, phraseEnd, plan, shout, inPhrase } = shapes[i];
      drumLevel = drumGain(bar, plan);
      clock.bar();
      // The swing breathes: harder as the solos build, a little different every bar.
      const sw = straight ? base : Math.min(0.75, Math.max(0.55, base + plan.swing * (fast ? 0.5 : 1) + gauss(random) * 0.006));
      /** Time in beats of an eighth-note slot in a bar (0 to 7), swung. */
      const eighth = (n: number) => Math.floor(n / 2) + (n % 2 ? sw : 0);
      const vocab = fills(sw, fast);
      // In two through the intro, the first chorus and the out-head (as Cannonball's 1958 Autumn
      // Leaves plays its heads); the first chorus's last bar walks into the solos.
      const inTwo = feel.twoFeel && (bar.chorus <= 1 || plan.role === "outhead") && bar.ref?.part !== "ending" && !(isFormEnd(bar, next) && !!next && !next.final);

      if (bar.final) {
        const chord = bar.chords[0]?.chord;
        if (!chord) return;
        piano = voiceChord(chord, piano, SWING_RANGE);
        events.push({ track: "piano", time: t + clock.at("piano"), duration: 4, velocity: 0.55, notes: piano, ...pianoTouch(piano, random, true) });
        guitar = voiceChord(chord, guitar, GUITAR_RANGE);
        events.push({ track: "guitar", time: t, duration: 3, velocity: 0.4, notes: guitar });
        events.push({ track: "bass", time: t, duration: 3.5, velocity: 0.85, notes: [nearest(chord.bass, bassNote)] });
        drum(t, "kick", 0.75);
        drum(t, "crash", 0.6, 0);
        return;
      }

      // Bass: walk each chord, aiming at the next one; or half notes in two.
      // The bassist's touch holds for a while and changes most often at a phrase start.
      if (straight) touch = BASS_TOUCH[0].value;
      else if (!touch || random() < (inPhrase === 0 ? 0.6 : 0.2)) touch = weighted(BASS_TOUCH, random, touch);
      const barTouch = touch;
      const ornamentChance = fast ? 0.15 : plan.role === "peak" ? 0.72 : plan.role === "solo" ? 0.62 : plan.role === "outhead" ? 0.46 : 0.4;
      const walked: { at: number; note: number; ev: NoteEvent }[] = [];
      bar.chords.forEach((c, k) => {
        const following = bar.chords[k + 1] ?? next?.chords[0];
        const target = following ? nearest(following.chord.bass, bassNote) : null;
        if (inTwo) {
          const changing = target !== null && following!.chord !== c.chord;
          const line = twoBeat(c.chord, c.length, bassNote, target, changing, random);
          const halves = line.map(([b, n], j): NoteEvent => {
            const end = line[j + 1]?.[0] ?? c.length;
            return { track: "bass", time: t + c.beat + b + clock.at("bass"), duration: Math.min(2, end - b) - 0.1, velocity: human((j === 0 ? 0.82 : 0.74) * lift, 0.1), notes: [n] };
          });
          events.push(...halves);
          bassNote = line.at(-1)![1];
          // Now and then a swung pickup a half step from the next note, as two-feel bassists do.
          if (random() < 0.3) {
            const j = Math.floor(random() * line.length);
            const end = line[j + 1]?.[0] ?? c.length;
            const into = line[j + 1]?.[1] ?? target;
            if (into !== null && end - line[j][0] >= 2) {
              const at = c.beat + end - 1 + sw;
              halves[j].duration = Math.min(halves[j].duration, at - c.beat - line[j][0] - 0.05);
              events.push({ track: "bass", time: t + at + clock.at("bass"), duration: 0.25, velocity: human(0.6 * lift), notes: [into + (random() < 0.5 ? -1 : 1)] });
            }
          }
          return;
        }
        // Higher and more stepwise as the band builds.
        const line = walk(c.chord, c.length, bassNote, target, random, plan.register * 1.2, plan.role === "head" || plan.role === "outhead" ? 0.6 : 0.5);
        line.forEach((n, b) => {
          const at = c.beat + b;
          const beat = Math.round(at) % 4;
          const length = Math.min(0.97, barTouch.length(beat) * (0.92 + random() * 0.14));
          const velocity = human((0.78 + (at === 0 ? 0.04 : 0) + barTouch.lean[beat] + gauss(random) * (straight ? 0.03 : 0.085)) * lift, 0.06);
          const ev: NoteEvent = { track: "bass", time: t + at + clock.at("bass"), duration: length, velocity, notes: [n] };
          events.push(ev);
          walked.push({ at, note: n, ev });
        });
        bassNote = line.at(-1)!;
      });

      // Ornaments over the quarters: a swung skip, a triplet rake into the next note, a
      // dead (muted) note, or a triplet turn. The quarters themselves stay on every beat.
      if (walked.length) {
        const intoNext = next?.chords[0] ? nearest(next.chords[0].chord.bass, bassNote) : null;
        const count = straight ? 0 : random() < ornamentChance ? (plan.role === "peak" && random() < 0.3 ? 2 : 1) : 0;
        const used = new Set<number>();
        for (let o = 0; o < count; o++) {
          const k = Math.floor(random() * walked.length);
          if (used.has(k)) continue;
          used.add(k);
          const { at, note, ev } = walked[k];
          const into = walked[k + 1]?.note ?? intoNext;
          const kind = weighted<BassOrnament>([
            { weight: 0.3, value: "skip" },
            { weight: into !== null && !fast ? 0.28 : 0, value: "rake" },
            { weight: at % 2 === 1 ? 0.42 : 0.14, value: "dead" },
            { weight: fast ? 0 : 0.1, value: "turn" },
          ], random);
          const clamp = (p: number) => Math.min(BASS_HIGH, Math.max(BASS_LOW, p));
          const add = (offset: number, pitch: number, velocity: number, duration: number) =>
            events.push({ track: "bass", time: t + at + offset + clock.at("bass"), duration, velocity: human(velocity * lift, 0.06), notes: [clamp(pitch)] });
          if (kind === "skip") {
            ev.duration = Math.min(ev.duration, sw - 0.06);
            const approach = into !== null && random() < 0.5;
            add(sw, approach ? into! + (into! > note ? -1 : 1) : note, approach ? 0.52 : 0.38, 1 - sw - 0.06);
          } else if (kind === "rake" && into !== null) {
            // Two ghosted triplets walking chromatically into the next note.
            const dir = into > note ? -1 : 1;
            ev.duration = Math.min(ev.duration, 1 / 3 - 0.04);
            add(1 / 3, into + 2 * dir, 0.36, 0.26);
            add(2 / 3, into + dir, 0.46, 0.28);
          } else if (kind === "dead") {
            ev.duration = 0.16;
            ev.velocity *= 0.62;
          } else if (kind === "turn") {
            ev.duration = 1 / 3 - 0.04;
            add(1 / 3, note + (random() < 0.5 ? 2 : -1), 0.42, 0.28);
            add(2 / 3, note, 0.44, 0.3);
          }
        }
      }

      // Guitar (only heard when the chart's band has it): four to the bar, short and soft.
      for (let b = 0; b < 4; b++) {
        const slot = chordAt(bar, b);
        if (!slot || inTwo) continue;
        guitar = voiceChord(slot.chord, guitar, GUITAR_RANGE);
        events.push({ track: "guitar", time: t + b + clock.at("guitar"), duration: 0.35, velocity: human((b % 2 ? 0.4 : 0.34) * lift, 0.06), notes: guitar });
      }

      // Piano: a comping cell, a different one each bar; a hit on the and of 4 anticipates
      // the next chord (and that chord's downbeat isn't played again).
      const nextChord = next?.chords[0];
      const changes = !!nextChord?.attack && !next?.final && nextChord.chord !== bar.chords.at(-1)?.chord;
      const place = bar.ref ? `${bar.ref.part}.${bar.ref.section}.${bar.ref.bar}` : "";
      const recalled = bar.chorus >= 2 ? memory.get(place) : undefined;
      // The chart's comping colour: sparse cells and strolled phrases, busy ones, or blues riffs
      // (a cell repeated, weighted to the ands of 2 and 4 where Kelly-style blues comping sits).
      const colour = feel.comp;
      // Sparse: in the solos the pianist strolls (lays out) for whole four-bar phrases, often two
      // or three running, as Evans does on the 1959 modal record (piano in 30 to 40% of solo bars,
      // out for 7 to 13 bars at a time): about 45% of the solo bars, runs of about nine bars.
      if (inPhrase === 0) strolling = !straight && colour === "sparse" && (plan.role === "solo" || plan.role === "peak") && random() < (strolling ? 0.55 : 0.35);
      const density = plan.density * (colour === "sparse" ? 0.82 : colour === "busy" ? 1.15 : colour === "blues" ? 1.08 : 1);
      const bluesWeight = (hits: Figure["hits"]) => (colour === "blues" && hits.some(([slot]) => slot === 3 || slot === 7) ? 1.4 : 1);
      const cell = straight
        ? straightCell(bar)
        : inTwo
        ? weighted(COMP_TWO.map((c) => ({ weight: c.weight, value: c.hits })), random)
        : strolling
          ? []
          : colour === "blues" && lastCell && inPhrase !== 0 && random() < 0.4
            ? lastCell
            : recalled && recalled !== lastCell && random() < 0.3
              ? recalled
              : !fast && twoBack && twoBack !== lastCell && random() < 0.12
                ? twoBack
                : weighted((fast ? COMP_FAST : COMP).map((c) => ({ weight: fast ? c.weight : forDensity(c, density) * bluesWeight(c.hits) * breathe(c.hits, lastCell), value: c.hits })), random, lastCell);
      twoBack = lastCell;
      lastCell = cell;
      if (place && cell.length) memory.set(place, cell);
      // The register moves with the chorus and drifts every eight bars, often every four
      // (the references' comping register spreads 2.6 to 3.4 dB bar to bar).
      if (!straight && inPhrase === 0 && ((bar.ref?.bar ?? 0) % 8 === 0 || random() < 0.5))
        registerDrift = weighted([{ weight: 0.4, value: -3 }, { weight: 0.7, value: -2 }, { weight: 1, value: -1 }, { weight: 1.2, value: 0 }, { weight: 1, value: 1 }, { weight: 0.8, value: 2 }, { weight: 0.5, value: 3 }, { weight: 0.3, value: 4 }], random, registerDrift);
      // ...and the hand moves a little from bar to bar.
      const shift = straight ? 0 : Math.max(-3, Math.min(7, plan.register + registerDrift + weighted([{ weight: 0.25, value: -2 }, { weight: 0.5, value: 0 }, { weight: 0.25, value: 2 }], random)));
      // Comping dynamics: each four-bar phrase holds, swells or falls back, and every bar
      // has its own touch, in dB (references vary the mid band 2 to 3 dB bar to bar).
      if (!straight && inPhrase === 0) {
        phraseDb = gauss(random) * 0.9;
        phraseSlope = weighted([{ weight: 0.4, value: 0 }, { weight: 0.35, value: 0.9 }, { weight: 0.25, value: -0.9 }], random);
      }
      const touchDb = straight ? 0 : phraseDb + phraseSlope * (inPhrase - 1.5) + gauss(random) * 1.0;
      const pianoGain = 10 ** (touchDb / 20);
      const range: VoicingRange = { ...SWING_RANGE, low: SWING_RANGE.low + shift, high: SWING_RANGE.high + shift, center: SWING_RANGE.center + shift };
      // Longer, more legato chords in the head; shorter as the band drives.
      const legato = plan.role === "peak" ? 1.05 : plan.role === "solo" ? 1.25 : 1.5;
      const starts = cell.map(([slot]) => eighth(slot));
      const pianoBeats: number[] = [];
      let pushes = false;
      cell.forEach(([slot, length, velocity], h) => {
        const beat = eighth(slot);
        if (pushedIn && beat < 0.5) return;
        const ahead = slot === 7 && changes;
        const c = ahead ? nextChord! : chordAt(bar, beat);
        if (!c) return;
        piano = voiceChord(c.chord, piano, range);
        // Don't ring into a different chord.
        const change = ahead ? 4 + nextChord!.length : (bar.chords.find((x) => x.beat > beat + 0.01)?.beat ?? (changes ? (pushes ? 3.5 : 4) : beat + 4));
        const nextHit = starts[h + 1] ?? (ahead ? 8 : 4 + 0.5);
        const held = straight ? length * legato : random() < 0.3 ? nextHit - beat - 0.05 : length * legato * (0.85 + random() * 0.3);
        const duration = Math.max(0.25, Math.min(held, 2.5, change - beat - 0.05));
        // Voicing size: a shell for a light stab, a two-hand chord (the second note doubled an
        // octave up, on top) for a held or building one.
        let notes = piano;
        if (straight) notes = piano;
        else if (!fast && duration < 0.5 && plan.density < 1 && random() < 0.2) notes = [piano[0], piano[2], piano[3]];
        else if (plan.energy >= 1 && duration >= 0.6 && random() < 0.28 * plan.density && piano[1] + 12 > piano[3] && piano[1] + 12 <= 84) notes = [...piano, piano[1] + 12];
        // Anticipations are accented a little, as pianists push them.
        // Blues: laid back a few milliseconds more, and now and then a crushed note, the
        // minor third struck just before the major third of a dominant chord.
        const time = t + beat + clock.at("piano") + (colour === "blues" ? (0.006 * feel.tempo) / 60 : 0);
        const hitVelocity = human((velocity + (slot % 2 ? 0.04 : 0)) * lift * pianoGain, 0.12);
        if (!straight && colour === "blues" && c.chord.intervalNames.includes("3M") && c.chord.intervalNames.includes("7m") && random() < 0.22) {
          const third = notes.find((n) => (((n - c.chord.root) % 12) + 12) % 12 === 4);
          if (third !== undefined) events.push({ track: "piano", time: time - 0.05, duration: 0.07, velocity: hitVelocity * 0.75, notes: [third - 1] });
        }
        events.push({ track: "piano", time, duration, velocity: hitVelocity, notes, ...pianoTouch(notes, random, !straight && duration >= 1.5 && random() < 0.3) });
        pianoBeats.push(beat);
        if (ahead) pushes = true;
      });
      pushedIn = pushes;

      // Drums
      const fill = !straight && endsSection(bar, next) && !next?.final;
      const bigFill = isFormEnd(bar, next) && !!next;
      // Real drummers mark most phrase ends by comping into them (below), not with a fill:
      // busy fills at under 5% of the records' phrase ends.
      const smallChance = shout ? 0.85 : plan.role === "peak" ? 0.3 : plan.role === "solo" ? 0.2 : 0.12;
      const smallFill = phraseEnd && !inTwo && random() < smallChance;
      const pickFill = (list: Fill[]) => {
        const f = weighted(list.map((x) => ({ weight: 1, value: x })), random, lastFill);
        lastFill = f;
        return f;
      };
      // Section ends: a full fill about half the time, else a short set-up (the records' drummers
      // mark most of them with one or two notes and a crash); the end of the form always fills.
      const sectionFill = fill && !bigFill && random() < (shout ? 0.9 : plan.role === "peak" ? 0.7 : plan.role === "solo" ? 0.55 : 0.4);
      const theFill = straight ? (bigFill ? vocab.medium[0] : null) : bigFill ? pickFill(plan.role === "solo" && random() < 0.35 ? vocab.medium : vocab.big) : sectionFill ? pickFill(vocab.medium) : fill || smallFill ? pickFill(shout ? vocab.medium : vocab.small) : null;
      const rideEnd = theFill && theFill.start <= 2 && (bigFill || sectionFill || shout) ? theFill.start : 4;

      // Crash where a section starts: always at the top of a chorus, often elsewhere; at the
      // peak and in the shout, on phrase starts too. A crash on 1 takes the ride's place.
      let crash = 0;
      if (crashAhead) crashAhead = false;
      else if (straight) crash = i > 0 && prev && isFormEnd(prev, bar) ? 0.6 : 0;
      else if (i > 0 && prev && endsSection(prev, bar)) crash = isFormEnd(prev, bar) ? 0.66 : random() < 0.45 ? 0.5 : 0;
      else if ((plan.role === "peak" || shout) && inPhrase === 0 && random() < 0.2) crash = 0.4;
      if (crash) {
        drum(t, "crash", crash, 0.05);
        if (crash > 0.4 || random() < 0.5) drum(t, "kick", crash * 0.7);
      }

      // Ride: a two-bar figure around the chorus's home pattern, accented its own way.
      const { home, accent } = straight ? { home: SPANG, accent: "twoFour" as Accent } : homeFor(bar.chorus, plan);
      let ride: RideCell;
      if (fast || straight) ride = SPANG;
      // In two: quarters with a skip only into 1, as on the So What head.
      else if (inTwo) ride = RIDE[2];
      else if (phraseEnd && !theFill && random() < 0.25) ride = LONG;
      else if (plan.role === "peak" && random() < 0.1) ride = DOUBLE;
      else if (random() < (ridePrev && ridePrev !== home ? 0.42 : 0.25)) ride = home;
      else ride = weighted(RIDE.filter((r) => r !== home && r !== ridePrev).map((r) => ({ weight: r.id === "quarters" ? 0.12 : 0.2, value: r })), random);
      ridePrev = ride;
      const onHat = !straight && headHat && (plan.role === "head" || plan.role === "outhead") && !bar.contrast && !inTwo;
      // At the peak a phrase now and then rides on the crash, the wash drummers build with
      // (rarely: the records crash in 5 to 8% of bars in all).
      if (inPhrase === 0) crashRide = !straight && !fast && !onHat && (plan.role === "peak" || shout) && random() < 0.1;
      const level = (inTwo ? 0.85 : fast ? 0.95 : plan.role === "peak" ? 1.08 : plan.role === "solo" ? 1 : 0.9) * lift * (onHat ? 0.85 : 1);
      // An edge accent on the ride: a phrase start, or one beat a bar in the solos.
      const edge = !straight && !onHat && !fast && (inPhrase === 0 ? random() < 0.35 : plan.role !== "head" && random() < 0.15) ? (inPhrase === 0 ? 0 : 1 + Math.floor(random() * 3)) : -1;
      for (const [b, kind, v] of ride.hits) {
        const at = b + (kind === 1 ? sw : kind === 2 ? 1 / 3 : 0);
        if (at >= rideEnd - 0.01) continue;
        if (crash && at < 0.01) continue;
        const accented = accent === "even" && !kind ? 0.57 : accent === "skip" && kind === 1 ? v * 1.3 : v;
        const hit = accented * (kind && fast ? 0.83 : 1) * level * (kind === 0 && b === edge ? 1.3 : 1);
        if (crashRide) drum(t + at, "crash", hit * (kind ? 0.45 : 0.6), 0.1);
        else drum(t + at, onHat ? "hat" : "ride", hit, 0.22);
      }
      [1, 3].forEach((b) => drum(t + b, "pedal", 0.5, 0.12));
      // A feathered kick (only 1 and 3 when fast), heavier as the band builds; accents later on.
      const feather = (plan.role === "peak" ? 0.19 : plan.role === "solo" ? 0.16 : 0.13) * (fast ? 0.85 : 1);
      // Feathering is felt more than heard, and not every drummer keeps it up: often off in the head.
      if (straight) feathering = true;
      else if (inPhrase === 0) feathering = random() < (plan.role === "head" || plan.role === "outhead" ? 0.5 : 0.75);
      if (feathering) for (let b = 0; b < 4; b += fast ? 2 : 1) if (!(crash && b === 0) && (straight || random() > 0.15)) drum(t + b, "kick", straight ? feather : feather * (0.75 + random() * 0.4), 0.06);
      // A "bomb" now and then in the solos: a kick on an offbeat or on 3.
      if (!straight && !theFill && !inTwo && bar.chorus >= 2 && random() < (plan.role === "peak" ? 0.2 : 0.12) * plan.density)
        drum(t + weighted([{ weight: 0.5, value: 3 + sw }, { weight: 0.3, value: 1 + sw }, { weight: 0.2, value: 2 }], random), "kick", 0.34 + random() * 0.08);

      // How much the snare comps this bar: the spell goes on through fills and two-feel bars.
      // The records' snare comping stays near one hit a bar through the solos instead of
      // climbing with the band (context/original-records.md).
      const talkBase = (slow ? 1.15 : fast ? 0.7 : 1) * (plan.role === "head" || plan.role === "outhead" ? 0.8 : 1) * Math.sqrt(plan.density * lift);
      const figures = straight ? 0 : talk(bar.ref?.bar ?? i, talkBase) + (plan.role === "peak" && random() < 0.1 ? 1 : 0);
      if (inTwo) {
        if (!fill && colour !== "sparse") drum(t + 3, "rim", 0.34, 0.05); // cross-stick on 4 (none under a sparse head)
      } else if (!theFill && !straight) {
        // Snare comping in spells that build into each phrase end (`drumTalk`), mostly in the
        // piano's gaps; into a phrase end the figures lean to the back of the bar.
        for (let n = 0; n < figures; n++) {
          const late = inPhrase === 3 && n === 0 && random() < 0.6;
          const figure = SNARE_COMP[late ? weighted([{ weight: 1, value: 1 }, { weight: 1, value: 6 }, { weight: 1, value: 7 }], random) : Math.floor(random() * SNARE_COMP.length)](sw);
          for (const [at, sound, v] of figure) {
            if (pianoBeats.some((p) => Math.abs(p - at) < 0.12) && random() < 0.6) continue;
            drum(t + at, sound, v * (0.9 + 0.3 * (lift - 0.9)), 0.06);
          }
        }
      }
      if (theFill) for (const [at, sound, velocity] of theFill.hits) drum(t + theFill.start + at, sound, velocity * (0.9 + 0.2 * (lift - 0.9)));
      // A kick-and-crash set-up on the and of 4 when the piano pushes into a new section.
      if (!straight && pushes && next && endsSection(bar, next) && !next.final && random() < 0.4) {
        drum(t + 3 + sw, "kick", 0.42);
        drum(t + 3 + sw, "crash", isFormEnd(bar, next) ? 0.64 : 0.5, 0.05);
        crashAhead = true;
      }
    });

    return events.sort((a, b) => a.time - b.time);
  },
};
