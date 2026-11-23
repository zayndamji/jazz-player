import { resolvesToMinor, type ParsedChord } from "../chart/chords";
import { scaleIntervals } from "../chart/scales";
import { chordAt, type TimelineBar, type TimelineChord } from "../engine/timeline";
import { GUITAR_RANGE, SWING_RANGE, type VoicingRange } from "../engine/voicing";
import { BASS_HIGH, BASS_LOW, BASS_TOP, bassStruck, bassUnder, chordAfter, endsSection, inBassRange, isFormEnd, shifted, voiceClear } from "./context";
import { DAMPER, GrooveBook, grooveBar, holdLength, type CompHit, type Groove } from "./comping";
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
 *   Each chord's first note is worked out once (`landing`) and the approach aims at it, so a
 *   half-step approach always resolves by a half step. A chord held over several bars is one
 *   line: the downbeats of the held bars take other chord tones along an arch that climbs
 *   toward G3, and no two bars running walk the same four notes. Every note stays in E1 to G3.
 *   Passing tones come from the chord's scale given the next chord (Phrygian dominant into minor).
 * - Piano: the only chord instrument (a piano trio, like the reference tracks).
 *   Close rootless voicings with the 3rd or 7th at the bottom, on one-bar comping
 *   cells that change every bar (busier ones as the band builds), with the register,
 *   the size of the voicing (shells to two-hand chords) and the note lengths changing
 *   with the chorus. Each chord is touched like a pianist's: top note louder, notes a
 *   few milliseconds apart. The piano sometimes recalls what it played at the same
 *   place in the form. A hit on the and of 4 anticipates the next chord. Each voicing knows the
 *   next chord and the bass note under it. Over a chord held four bars or more the shape planes
 *   up and down the chord's scale, never one voicing three hits running.
 * - Guitar (only when a chart's `band` adds it): soft four to the bar.
 * - Drums: the ride plays two-bar figures around a home pattern picked per chorus (the
 *   head sometimes on closed hi-hat), with the accent moving between choruses; hi-hat
 *   foot on 2 and 4; feathered kick; snare comping in the piano's gaps; crashes and
 *   kick-and-crash set-ups into sections; fills picked from a vocabulary at phrase ends
 *   (small), section ends (medium) and the end of the form (big).
 * - The ride follows the chorus level through a smoothed gain, rising over a few bars into
 *   the solos and about 4 to 6 dB from head to peak.
 * - The last bar plays each of its chords on its beat and holds the last as a fermata.
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

type Figure = { weight: number; hits: CompHit[] };

const g = (id: string, weight: number, a: CompHit[], b: CompHit[]): Groove => ({ id, weight, bars: [a, b] });

/**
 * Comping grooves, two bars each as [eighth slot (0 to 7, swung), length in beats, velocity]
 * (`comping.ts`: a section keeps one and varies it a little). After the references' piano stems:
 * Garland and the Miyashita trio sit on the and of 2 and the and of 4, the Band-in-a-Box and
 * real-player tracks on 2, 3 and 4, Nardis on 1 and 3 or 2 and 4; about a third of the hits on an
 * and. A chord rings until about the next hit (`holdLength`) unless it is written as a stab (0.3,
 * the short half of a short-long figure). Slot 7 (the and of 4) anticipates the next chord.
 */
const GROOVES: Groove[] = [
  g("ands", 0.18, [[3, 0.3, 0.5], [7, 0.5, 0.52]], [[3, 0.3, 0.5], [6, 0.45, 0.48]]),
  g("charleston", 0.16, [[0, 0.3, 0.5], [3, 0.6, 0.48]], [[0, 0.3, 0.5], [3, 0.4, 0.48], [7, 0.5, 0.5]]),
  g("two-four", 0.16, [[2, 0.45, 0.5], [6, 0.3, 0.5]], [[2, 0.45, 0.5], [5, 0.4, 0.48]]),
  g("three", 0.14, [[2, 0.4, 0.48], [4, 0.6, 0.5]], [[4, 0.5, 0.5], [6, 0.4, 0.48]]),
  g("one-three", 0.1, [[0, 0.6, 0.5], [4, 0.5, 0.47], [6, 0.4, 0.47]], [[4, 0.6, 0.5], [7, 0.5, 0.5]]),
  g("reverse", 0.1, [[1, 0.4, 0.48], [4, 0.7, 0.5]], [[1, 0.4, 0.48], [4, 0.45, 0.48], [6, 0.4, 0.47]]),
  g("answer", 0.08, [[0, 1.5, 0.46]], [[3, 0.4, 0.5], [6, 0.45, 0.48]]),
  g("quarters", 0.08, [[2, 0.4, 0.48], [4, 0.4, 0.45], [6, 0.4, 0.48]], [[0, 0.4, 0.46], [2, 0.4, 0.48], [4, 0.4, 0.45], [6, 0.4, 0.48]]),
];

/** Up-tempo grooves: fewer, longer hits, and bars left empty for the soloist. */
const GROOVES_FAST: Groove[] = [
  g("held", 0.3, [[0, 1.6, 0.5]], [[3, 1.4, 0.48]]),
  g("pushed", 0.25, [[3, 1.4, 0.48]], []),
  g("one-and", 0.25, [[0, 0.5, 0.45], [5, 1.0, 0.45]], [[1, 0.9, 0.45]]),
  g("space", 0.2, [[0, 1.6, 0.5]], []),
];

/**
 * Busy grooves (chart `comp: "busy"`): three to five short hits a bar, as the busier references
 * comp (4 a bar on the real-player Autumn Leaves track, mostly on 2, 3 and 4): pushes on the ands,
 * the and of 4 anticipating the next chord more often, and one lighter bar in each pair.
 */
const GROOVES_BUSY: Groove[] = [
  g("ands", 0.2, [[2, 0.35, 0.48], [3, 0.3, 0.44], [6, 0.35, 0.48], [7, 0.6, 0.5]], [[2, 0.35, 0.48], [3, 0.3, 0.44], [6, 0.4, 0.48]]),
  g("quarters", 0.2, [[0, 0.35, 0.46], [2, 0.35, 0.48], [4, 0.35, 0.44], [6, 0.35, 0.48]], [[2, 0.35, 0.48], [4, 0.3, 0.44], [5, 0.3, 0.46], [6, 0.35, 0.48]]),
  g("charleston", 0.18, [[0, 0.5, 0.47], [3, 0.3, 0.46], [4, 0.3, 0.43], [7, 0.6, 0.5]], [[0, 0.35, 0.46], [2, 0.3, 0.46], [3, 0.3, 0.44], [5, 0.35, 0.46]]),
  g("every-and", 0.16, [[1, 0.3, 0.45], [3, 0.3, 0.47], [5, 0.3, 0.47], [7, 0.6, 0.5]], [[1, 0.3, 0.45], [3, 0.3, 0.47], [6, 0.4, 0.48]]),
  g("two-four", 0.14, [[1, 0.3, 0.45], [2, 0.35, 0.47], [4, 0.3, 0.44], [6, 0.35, 0.47], [7, 0.6, 0.5]], [[2, 0.4, 0.47], [5, 0.4, 0.47], [6, 0.3, 0.44]]),
];

/** Two-feel grooves: sparse and on the beat more often, under a melody. */
const GROOVES_TWO: Groove[] = [
  g("held", 0.4, [[0, 1.5, 0.45]], [[0, 0.8, 0.45], [3, 0.5, 0.4]]),
  g("charleston", 0.35, [[0, 0.8, 0.45], [3, 0.5, 0.4]], [[3, 1.4, 0.45]]),
  g("space", 0.25, [[0, 1.5, 0.45]], []),
];

/**
 * The straight feel's comping, the same every bar: the Charleston (1 and the and of 2)
 * over one chord, otherwise a hit where each chord starts.
 */
export function straightCell(bar: TimelineBar): Figure["hits"] {
  if (bar.chords.length <= 1) return [[0, 0.8, 0.5], [3, 0.5, 0.48]];
  return bar.chords.map((c): [number, number, number] => [Math.round(c.beat * 2), Math.min(0.8, c.length * 0.5), c.beat === 0 ? 0.5 : 0.48]);
}

/** A groove's weight for the chorus: busier grooves when the band builds, sparser in the head. */
const forDensity = (f: Groove, density: number) => f.weight * density ** ((f.bars[0].length + f.bars[1].length - 4.6) * 1.5);

/** Where a varied bar may add a hit: 2, 4 and the ands before them most, as the references comp. */
const ADDS = [1, 2, 3, 4, 5, 6, 7].map((slot) => ({ slot, weight: slot === 2 || slot === 6 ? 1 : slot === 3 || slot === 4 ? 0.9 : slot === 7 ? 0.6 : 0.55 }));

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

/**
 * Where a walking line centres: F#2. The records' walking bass sits at a median of MIDI 40 to 43
 * (Chambers, Ware, Morin's bassist); without a pull the line drifted to 34 to 37 for whole choruses.
 */
const WALK_HOME = 42;

/** The MIDI note of a pitch class nearest to `near`, inside the bass range (up to `high`, D3 unless given). */
export function nearest(pc: number, near: number, high = BASS_HIGH): number {
  let best = BASS_LOW + ((pc - BASS_LOW + 120) % 12);
  for (let n = best; n <= high; n += 12) if (Math.abs(n - near) < Math.abs(best - near)) best = n;
  return best;
}

const pc12 = (n: number) => ((n % 12) + 12) % 12;

/** A half step above or below `target` (whichever is nearer `from`, inside the bass range). */
export function halfStep(target: number, from: number): number {
  const below = target - 1;
  const above = target + 1;
  if (below < BASS_LOW) return above;
  if (above > BASS_TOP) return below;
  return Math.abs(below - from) <= Math.abs(above - from) ? below : above;
}

/**
 * Where a walking line lands on the next chord's bass note `pc`, from the note `from` it
 * starts the current chord on: the octave nearest the line's home (pulled 0.6 of the way,
 * `lean` half steps higher). Work it out once and pass it to both the approach (`walk`'s
 * target) and the next chord's walk (`start`), so the approach always resolves by a half step.
 */
export const landing = (pc: number, from: number, lean = 0, high = BASS_HIGH) => nearest(pc, from + lean + (WALK_HOME - from) * 0.6, high);

/** Pitch classes of a chord's scale, from its root. `next` (the chord that follows) gives a dominant resolving to minor its Phrygian dominant. */
export function scalePcs(chord: ParsedChord, next?: ParsedChord | null): number[] {
  return scaleIntervals(chord, next).map((s) => (chord.root + s) % 12);
}

/**
 * The scale a voicing planes along over a held chord: the chord's scale without its avoid notes,
 * so the moving shape never sounds them against the chord. No 3rd on a sus chord (C7sus4, C11);
 * no natural 11 over a major 3rd (major and dominant chords); no flat 9 unless the chord has one
 * or resolves down a fifth to minor (`resolvesToMinor`, Phrygian dominant).
 */
export function planeScale(chord: ParsedChord, next?: ParsedChord | null): number[] {
  const has = (n: string) => chord.intervalNames.includes(n);
  const sus = !has("3M") && !has("3m") && (has("4P") || has("11P") || has("2M"));
  const avoid = new Set<number>();
  if (sus) [3, 4].forEach((i) => avoid.add(i));
  if (has("3M")) avoid.add(5);
  if (!has("9m") && !resolvesToMinor(chord, next)) avoid.add(1);
  return scaleIntervals(chord, next)
    .filter((i) => !avoid.has(i))
    .map((i) => (chord.root + i) % 12);
}

export interface WalkOptions {
  /** The note to start on, when the previous chord's approach aimed at it (see `landing`). Else the root near the line's home. */
  start?: number | null;
  /** The chord after this one, for the scale (a dominant into minor walks Phrygian dominant). */
  next?: ParsedChord | null;
  /** The highest note the line may reach (D3 unless given; up to `BASS_TOP` through a long held chord). */
  high?: number;
  /**
   * 0 to 1 (0 unless given): how often the line takes another way to the same target, so a bar
   * walks differently from chorus to chorus: out and back instead of straight at the target, or
   * the half-step approach from the farther side.
   */
  vary?: number;
}

/**
 * Walking line for `beats` beats of one chord, from `from` (the previous note)
 * toward `target` (the next chord's bass note). Returns MIDI notes.
 * `lean` (half steps) pulls the root toward a higher octave; `tones` is the chance of
 * a chord tone rather than a scale step between the root and the approach.
 */
export function walk(chord: ParsedChord, beats: number, from: number, target: number | null, random: () => number, lean = 0, tones = 0.6, options: WalkOptions = {}): number[] {
  const high = Math.min(BASS_TOP, options.high ?? BASS_HIGH);
  // Each root leans back toward the line's home register, so the walk doesn't sink and stay low.
  const root = options.start ?? landing(chord.bass, from, lean, high);
  const notes = [root];
  const chordTones = chord.intervals.map((i) => (chord.root + i) % 12);
  const scale = scalePcs(chord, options.next);
  const vary = options.vary ?? 0;
  // Out and back: the first step leads away from the target (when the target is near enough to come back to).
  const outward = vary > 0 && beats >= 4 && target !== null && random() < 0.4 * vary;
  let current = root;
  for (let b = 1; b < beats; b++) {
    const last = b === beats - 1;
    if (last && target !== null) {
      // Approach the next chord by a half step, from whichever side is closer (now and then the
      // other side, a leap of up to a fourth); or from its fifth.
      const short = beats <= 2;
      if (random() < (short && vary > 0 ? 0.68 : 0.75)) {
        current = halfStep(target, current);
        const other = 2 * target - current;
        if (vary > 0 && random() < (short ? 0.5 : 0.35) * vary && other >= BASS_LOW && other <= Math.min(BASS_TOP, Math.max(high, target + 1)) && Math.abs(other - notes[b - 1]) <= 5 && other !== notes[b - 1]) current = other;
      } else {
        const fifth = nearest((target + 7) % 12, current, Math.max(high, target));
        current = Math.abs(fifth - target) <= 7 ? fifth : nearest((target + 7) % 12, target, Math.max(high, target));
      }
    } else {
      // A chord tone or a scale step, moving toward the target; a leap to a chord tone when the
      // target is too far to reach by steps.
      const goal = target ?? root + 7;
      const left = beats - b;
      const far = target !== null && Math.abs(goal - current) > 3 * left + 1;
      const toward = goal >= current ? 1 : -1;
      const dir = outward && b === 1 && !far && Math.abs(goal - current) <= 3 ? -toward : toward;
      const pool = far || random() < tones ? chordTones : scale;
      let n = current + dir;
      for (let k = 0; k < 12 && !pool.includes(((n % 12) + 12) % 12); k++) n += dir;
      if (far) {
        const aim = current + (goal - current) / left;
        for (let m = n; Math.abs(m - current) <= 9; m += dir) if (pool.includes(((m % 12) + 12) % 12) && Math.abs(m - aim) < Math.abs(n - aim)) n = m;
      }
      if (n < BASS_LOW || n > high) {
        // Out of range that way: step the other way instead, to the nearest tone of the pool.
        const back = n > high ? -1 : 1;
        let m = current + back;
        for (let k = 0; k < 12 && !pool.includes(pc12(m)); k++) m += back;
        n = m >= BASS_LOW && m <= high ? m : nearest(chordTones[1] ?? chord.root, current, high);
      }
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
 * `start` is the note the previous chord aimed at (see `landing`), else the root nearest `from`.
 * Returns [beat in the chord, MIDI note] pairs.
 */
export function twoBeat(chord: ParsedChord, beats: number, from: number, target: number | null, changing: boolean, random: () => number, start?: number | null): [number, number][] {
  const root = start ?? nearest(chord.bass, from);
  const out: [number, number][] = [[0, root]];
  if (beats >= 4) {
    const step = chord.intervalNames.includes("5d") ? 6 : chord.intervalNames.includes("5A") ? 8 : 7;
    // A fifth a half step from the next note (Eb over Am7b5 into D) resolves to it like an approach.
    const fifthPc = (chord.root + step) % 12;
    const d = target === null ? 0 : (((fifthPc - target) % 12) + 12) % 12;
    const leading = target !== null && (d === 1 || d === 11) ? target + (d === 1 ? 1 : -1) : null;
    // Otherwise the octave between the root and the next note, so the line moves on by step or a fourth.
    const fifth = leading !== null && leading >= BASS_LOW && leading <= BASS_TOP ? leading : nearest(fifthPc, target === null ? root : (root + target) / 2, target === null ? BASS_HIGH : Math.min(BASS_TOP, Math.max(BASS_HIGH, target + 2)));
    const third = changing && target !== null && random() < 0.5 ? (random() < 0.5 ? halfStep(target, target - 2) : halfStep(target, target + 2)) : fifth;
    out.push([2, third]);
  }
  return out;
}

/**
 * The next diatonic step of a voicing: every note moved `steps` notes along `scale` (pitch
 * classes), the parallel planing modal pianists use over a long-held chord (the "So What" chords).
 */
export function plane(notes: number[], scale: number[], steps: number): number[] {
  const inScale = (n: number) => scale.includes(((n % 12) + 12) % 12);
  return notes.map((n) => {
    let m = n;
    const dir = Math.sign(steps);
    for (let left = Math.abs(steps); left > 0; ) {
      m += dir;
      if (inScale(m)) left--;
    }
    return m;
  });
}

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
    // The ride and hats follow the chorus level through `rideDb` (below), smoothed and scaled down.
    let cymbalLevel = 1;
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: time + clock.at(DRUM_POCKET[sound]), duration: 0.25, velocity: human(velocity, spread), gain: sound === "ride" || sound === "hat" ? CYMBALS * cymbalLevel : drumLevel });

    const base = swingRatio(feel.tempo);
    const fast = feel.tempo >= UP_TEMPO;
    const slow = feel.tempo < 110;
    // Straight: one groove and one comping figure all through; only the form's end is marked.
    const straight = feel.variation === "straight";

    let piano: number[] | null = null;
    let guitar: number[] | null = null;
    let bassNote = 40;
    // The note the next chord's first beat will play, chosen when the line approaches it.
    let planned: number | null = null;
    // The last walked bar's notes on the beat, so no two bars running walk the same line.
    let lastLine = "";
    let pushedIn = false;
    // One comping groove per section label, kept through the chorus (comping.ts).
    const book = new GrooveBook(random, 0.5);
    let strolling = false;
    const talk = drumTalk(random);
    let lastFill: Fill | undefined;
    let ridePrev: RideCell | undefined;
    let touch: BassTouch | undefined;
    let crashAhead = false; // a set-up crash on the and of 4 already marked this bar's downbeat
    const music = bars.filter((b) => !b.countIn);
    const shapes = straight ? steadyBars(music) : shapeBars(music, random, true);
    // Per chorus: the ride's home pattern and accent; the head now and then on closed hi-hat (the
    // backing tracks do it often; the records measured, Nardis, So What, Sonnymoon and Autumn Leaves, keep the ride).
    const headHat = !fast && random() < 0.2;
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
    let registerDrift = 0;
    let phraseDb = 0;
    let phraseSlope = 0;
    let crashRide = false; // riding on the crash for a phrase at the peak
    let feathering = true;
    // Ride level (dB of gain, and a velocity factor), moving toward each chorus's level a little a bar.
    let rideDb: number | null = null;
    let rideVelocity: number | null = null;
    // Modal planing over a long-held chord: steps along the scale, and the last voicings played.
    let planeStep = 0;
    const recent: string[] = [];
    // The lowest note of the piano's last hit: the bass climbs above D3 only while the piano sits
    // a minor third or more over it, in its own register (or lays out).
    let pianoLow: number | null = null;

    // A chord held over several bars ("%" or the same chord again) is one span: the bass walks it as
    // one line and the piano planes its voicing when it lasts four bars or more.
    const continues = (a: TimelineBar, b: TimelineBar) =>
      !b.final && b.chords.length === 1 && a.chords.length > 0 && (!b.chords[0].attack || b.chords[0].chord.symbol === a.chords.at(-1)!.chord.symbol);
    const span = music.map(() => ({ pos: 0, length: 1 }));
    for (let i = 0; i < music.length; ) {
      let j = i + 1;
      while (j < music.length && continues(music[j - 1], music[j])) j++;
      for (let k = i; k < j; k++) span[k] = { pos: k - i, length: j - i };
      i = j;
    }
    // In two through the intro, the first chorus and the out-head (as Cannonball's 1958 Autumn
    // Leaves plays its heads); the first chorus's last bar walks into the solos.
    const twoAt = (i: number) => {
      const bar = music[i];
      const next = music[i + 1];
      const plan = shapes[i].plan;
      return feel.twoFeel && (bar.chorus <= 1 || plan.role === "outhead") && bar.ref?.part !== "ending" && !(isFormEnd(bar, next) && !!next && !next.final);
    };
    /** The next different chord after `c` (in bar `i`), looking a few bars ahead; null at the end. */
    const after = (i: number, c: TimelineChord): ParsedChord | null => chordAfter(music, i, c.beat, 8);
    /** True when the hit's chord is held for four bars or more: a modal vamp. */
    const vampAt = (i: number, c: TimelineChord) => !!music[i] && span[i].length >= 4 && c === music[i].chords.at(-1);
    /**
     * The note a walking line lands on at the downbeat of bar `i + 1`, which goes on holding the
     * chord: not always the root but the 3rd, 5th or 7th, along an arch that climbs toward G3 over
     * the span (in arches of up to eight bars), and never the note it started this bar on.
     */
    const spanNote = (i: number, chord: ParsedChord, start: number, lean: number, top = BASS_TOP): number => {
      const { pos, length } = span[i + 1];
      const arcLength = length <= 8 ? length : length / Math.ceil(length / 8);
      // Peaked (sine squared) from a little under home, so the line touches the top of the arch and
      // spends most of the span near home: a median of about 43 to 45 over a modal chorus (the records 40 to 43).
      const arch = Math.sin((Math.PI * (pos % arcLength)) / arcLength) ** 2;
      const climb = Math.min(BASS_TOP - WALK_HOME + 4, 3 + 1.4 * arcLength);
      const aim = WALK_HOME - 4 + lean * 0.5 + climb * arch + (random() - 0.5) * 3;
      const phraseStart = shapes[i + 1].inPhrase === 0;
      const sectionStart = endsSection(music[i], music[i + 1]);
      const options: { weight: number; value: number }[] = [];
      chord.intervals.forEach((iv) => {
        const degree = ((iv % 12) + 12) % 12;
        const kind = degree === 0 ? (sectionStart ? 6 : phraseStart ? 2.5 : 1) : sectionStart ? 0 : degree === 3 || degree === 4 ? 0.7 : degree === 6 || degree === 7 || degree === 8 ? 0.8 : degree === 10 || degree === 11 ? 0.35 : 0.15;
        if (!kind) return;
        for (let n = BASS_LOW + ((chord.root + iv - BASS_LOW + 120) % 12); n <= top; n += 12) {
          const near = Math.exp(-(((n - aim) / 3.5) ** 2));
          // Within a ninth of where the bar starts, so three steps can walk there.
          const reach = Math.abs(n - start) > 9 ? 0.002 : 1;
          options.push({ weight: kind * near * reach * (n === start ? 0.03 : 1) + 1e-9, value: n });
        }
      });
      return weighted(options, random);
    };

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
      const inTwo = twoAt(i);

      // The last bar: every chord on its beat, the last one held as a fermata with a crash.
      if (bar.final) {
        bar.chords.forEach((c, k) => {
          const last = k === bar.chords.length - 1;
          const at = t + c.beat;
          const following = bar.chords[k + 1]?.chord ?? null;
          const low = k === 0 && planned !== null ? planned : landing(c.chord.bass, bassNote);
          events.push({ track: "bass", time: at, duration: last ? 4.5 : c.length - 0.1, velocity: last ? 0.85 : 0.78, notes: [inBassRange(low)] });
          bassNote = low;
          piano = voiceClear(c.chord, piano, SWING_RANGE, following, low);
          events.push({ track: "piano", time: at + clock.at("piano"), duration: last ? 5 : c.length - 0.05, velocity: last ? 0.55 : 0.5, notes: piano, ...pianoTouch(piano, random, last) });
          guitar = voiceClear(c.chord, guitar, GUITAR_RANGE, following, low);
          events.push({ track: "guitar", time: at, duration: last ? 4 : c.length - 0.1, velocity: 0.4, notes: guitar });
          drum(at, "kick", last ? 0.75 : 0.5);
          if (last) drum(at, "crash", 0.6, 0);
          else drum(at, "snare", 0.34, 0.04);
        });
        planned = null;
        return;
      }

      // Bass: walk each chord, aiming at the next one; or half notes in two.
      // The bassist's touch holds for a while and changes most often at a phrase start.
      if (straight) touch = BASS_TOUCH[0].value;
      else if (!touch || random() < (inPhrase === 0 ? 0.6 : 0.2)) touch = weighted(BASS_TOUCH, random, touch);
      const barTouch = touch;
      const ornamentChance = fast ? 0.15 : plan.role === "peak" ? 0.72 : plan.role === "solo" ? 0.62 : plan.role === "outhead" ? 0.46 : 0.4;
      const walked: { at: number; note: number; ev: NoteEvent }[] = [];
      // Where each chord's line lineStarts and what it aims at, worked out once: the approach note
      // and the next chord's first note are always a half step (or a fifth) apart.
      const lean = inTwo ? 0 : plan.register * 1.2;
      // Room under the piano: a chord still ringing into this bar caps the line a minor third under
      // its lowest note; above D3 the line climbs only as far as a minor third under the piano's last hit.
      const bassFrom = events.length;
      let ringLow = Infinity;
      const ringing: { end: number; low: number }[] = [];
      for (let e = events.length - 1; e >= 0 && e >= events.length - 80; e--) {
        const ev = events[e];
        if (ev.track === "piano" && ev.notes!.length > 1 && ev.time + ev.duration > t - 0.05) {
          ringLow = Math.min(ringLow, ...ev.notes!);
          ringing.push({ end: ev.time + ev.duration, low: Math.min(...ev.notes!) });
        }
      }
      /** True when a bass note at `time` would sit within a minor third of a piano chord still ringing from the bar before. */
      const crowds = (time: number, pitch: number) => ringing.some((r) => time < r.end + 0.06 && pitch > r.low - 3);
      /** A two-feel note an octave down when it would crowd a ringing chord. */
      const clearOf = (time: number, pitch: number) => (crowds(time, pitch) && pitch - 12 >= BASS_LOW ? pitch - 12 : pitch);
      const ringRoof = Number.isFinite(ringLow) ? ringLow - 3 : BASS_TOP;
      // The piano's own register (not its last hit, which the bass may have pushed up): its voicings'
      // lowest notes sit about 8 half steps under the range's centre.
      const pianoHome = SWING_RANGE.center - 8 + (straight ? 0 : plan.register + registerDrift);
      const climbRoof = Math.max(BASS_HIGH, strolling || pianoLow === null ? BASS_TOP : Math.min(BASS_TOP, pianoHome - 3, pianoLow - 3));
      // Which octave a new chord lands in moves a little from chorus to chorus, so the same bar
      // doesn't start every chorus on the same note (the register stays home on average).
      // The same bass note again stays where it is; after a chord of two beats or less (one step to
      // get there) the landing stays within a fifth of the line.
      const land = (pc: number, from: number, extra: number, beats = 4) => {
        if (pc12(from) === pc && from <= BASS_TOP) return from;
        const reach = beats <= 2 ? 7 : 9;
        let steady = landing(pc, from, extra);
        if (Math.abs(steady - from) > reach) steady = nearest(pc, from, Math.min(BASS_TOP, Math.max(BASS_HIGH, from + reach)));
        if (straight) return steady;
        const moved = landing(pc, from, extra + gauss(random) * 3);
        return Math.abs(moved - from) <= reach ? moved : steady;
      };
      const lineStarts: number[] = [];
      bar.chords.forEach((c, k) => {
        lineStarts.push(k === 0 ? (planned ?? land(c.chord.bass, bassNote, lean)) : land(c.chord.bass, lineStarts[k - 1], lean, inTwo ? 2 : bar.chords[k - 1].length));
      });
      const lastStart = lineStarts.at(-1) ?? bassNote;
      // Into the next bar: a held chord walks on to a chord tone along the span, a new one lands on its bass note.
      const nextFirst = !next?.chords[0]
        ? null
        : span[i + 1].pos > 0 && !twoAt(i + 1) && !next.final
          ? spanNote(i, next.chords[0].chord, lastStart, plan.register * 1.2, climbRoof)
          : next.final
            ? landing(next.chords[0].chord.bass, lastStart)
            : land(next.chords[0].chord.bass, lastStart, lean, inTwo ? 2 : bar.chords.at(-1)?.length);
      const targets = bar.chords.map((_, k) => (k + 1 < bar.chords.length ? lineStarts[k + 1] : nextFirst));
      // Through a long span the line may climb above D3, toward G3.
      const ceiling = (k: number) =>
        Math.min(ringRoof, span[i].length > 1 || span[i + 1]?.pos ? Math.min(climbRoof, Math.max(BASS_HIGH, lineStarts[k] + 3, (targets[k] ?? 0) + 3)) : BASS_HIGH);
      /** The bass note sounding at a beat of this bar (for the piano to keep clear of). */
      const onsets: [number, number][] = [];
      if (inTwo) {
        bar.chords.forEach((c, k) => {
          const target = targets[k];
          const following = bar.chords[k + 1] ?? next?.chords[0];
          const changing = target !== null && following!.chord !== c.chord;
          const line = twoBeat(c.chord, c.length, bassNote, target, changing, random, lineStarts[k]);
          const halves = line.map(([b, n], j): NoteEvent => {
            const end = line[j + 1]?.[0] ?? c.length;
            const note = clearOf(t + c.beat + b, inBassRange(n));
            onsets.push([c.beat + b, note]);
            return { track: "bass", time: t + c.beat + b + clock.at("bass"), duration: Math.min(2, end - b) - 0.1, velocity: human((j === 0 ? 0.82 : 0.74) * lift, 0.1), notes: [note] };
          });
          events.push(...halves);
          bassNote = line.at(-1)![1];
          // Now and then a swung pickup a half step from the next note, as two-feel bassists do (from the side the line comes from).
          if (random() < 0.3) {
            const j = Math.floor(random() * line.length);
            const end = line[j + 1]?.[0] ?? c.length;
            const into = line[j + 1]?.[1] ?? target;
            if (into !== null && end - line[j][0] >= 2 && !crowds(t + c.beat + end - 1 + sw, into + 1)) {
              const at = c.beat + end - 1 + sw;
              halves[j].duration = Math.min(halves[j].duration, at - c.beat - line[j][0] - 0.05);
              events.push({ track: "bass", time: t + at + clock.at("bass"), duration: 0.25, velocity: human(0.6 * lift), notes: [halfStep(into, line[j][1])] });
            }
          }
        });
        lastLine = "";
      } else {
        // Higher and more stepwise as the band builds; never the same four notes as the bar before.
        const tones = plan.role === "head" || plan.role === "outhead" ? 0.6 : 0.5;
        const walkBar = () => bar.chords.map((c, k) => walk(c.chord, c.length, k === 0 ? bassNote : lineStarts[k - 1], targets[k], random, lean, tones, { start: lineStarts[k], next: after(i, c), high: ceiling(k), vary: straight ? 0 : 1 }));
        let lines = walkBar();
        for (let tries = 0; tries < 6 && lines.flat().join(",") === lastLine; tries++) lines = walkBar();
        if (lines.flat().join(",") === lastLine) {
          // Still the same: move the middle note to another tone of the chord.
          const line = lines[0];
          const m = Math.min(2, line.length - 2);
          if (m >= 1) {
            const tones = bar.chords[0].chord.intervals.map((iv) => (bar.chords[0].chord.root + iv) % 12);
            const pc = tones.find((p) => p !== ((line[m] % 12) + 12) % 12 && p !== ((line[m - 1] % 12) + 12) % 12) ?? bar.chords[0].chord.root;
            line[m] = nearest(pc, line[m], ceiling(0));
          }
        }
        // An approach under a piano chord still ringing from the bar before takes the other half step
        // or the fifth (whichever stays clear and nearest the line), so it never crowds the chord.
        lines.forEach((line, k) => {
          const target = targets[k];
          const at = t + bar.chords[k].beat + line.length - 1;
          if (target === null || line.length < 2 || !crowds(at, line.at(-1)!)) return;
          const from = line.at(-2)!;
          const options = [target - 1, target + 1, target - 5, target + 7].filter((n) => n >= BASS_LOW && n <= BASS_TOP && n !== from && !crowds(at, n));
          if (options.length) line[line.length - 1] = options.reduce((a, b) => (Math.abs(b - from) < Math.abs(a - from) ? b : a));
        });
        lastLine = lines.flat().join(",");
        lines.forEach((line, k) => {
          const c = bar.chords[k];
          line.forEach((raw, b) => {
            const n = inBassRange(raw);
            const at = c.beat + b;
            const beat = Math.round(at) % 4;
            const length = Math.min(0.97, barTouch.length(beat) * (0.92 + random() * 0.14));
            const velocity = human((0.78 + (at === 0 ? 0.04 : 0) + barTouch.lean[beat] + gauss(random) * (straight ? 0.03 : 0.085)) * lift, 0.06);
            const ev: NoteEvent = { track: "bass", time: t + at + clock.at("bass"), duration: length, velocity, notes: [n] };
            events.push(ev);
            walked.push({ at, note: n, ev });
            onsets.push([at, n]);
          });
          bassNote = line.at(-1)!;
        });
      }
      planned = nextFirst;
      const bassAt = (beat: number) => bassStruck(onsets, beat, 0.01, undefined);

      // Ornaments over the quarters: a swung skip, a triplet rake into the next note, a
      // dead (muted) note, or a triplet turn. The quarters themselves stay on every beat.
      if (walked.length) {
        const intoNext = planned;
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
            // A rake walks into a note a step or two away, never across a leap.
            { weight: into !== null && !fast && Math.abs(into - note) <= 5 ? 0.28 : 0, value: "rake" },
            { weight: at % 2 === 1 ? 0.42 : 0.14, value: "dead" },
            { weight: fast ? 0 : 0.1, value: "turn" },
          ], random);
          // An ornament note that would crowd a piano chord still ringing from the bar before is left out.
          const add = (offset: number, pitch: number, velocity: number, duration: number) => {
            if (!crowds(t + at + offset, inBassRange(pitch))) events.push({ track: "bass", time: t + at + offset + clock.at("bass"), duration, velocity: human(velocity * lift, 0.06), notes: [inBassRange(pitch)] });
          };
          const c = chordAt(bar, at);
          const scale = c ? scalePcs(c.chord, after(i, c)) : [];
          const inScale = (n: number) => !scale.length || scale.includes(pc12(n));
          if (kind === "skip") {
            ev.duration = Math.min(ev.duration, sw - 0.06);
            const approach = into !== null && Math.abs(into - note) <= 5 && random() < 0.5;
            add(sw, approach ? halfStep(into!, note) : note, approach ? 0.52 : 0.38, 1 - sw - 0.06);
          } else if (kind === "rake" && into !== null) {
            // Two ghosted triplets into the next note: a scale tone, then the half step (from inside the range).
            const side = into + 2 > BASS_TOP ? -1 : into - 2 < BASS_LOW ? 1 : into > note ? -1 : 1;
            const dir = inScale(into + 2 * side) ? side : inScale(into - 2 * side) && into - 2 * side >= BASS_LOW && into - 2 * side <= BASS_TOP ? -side : 0;
            ev.duration = Math.min(ev.duration, 1 / 3 - 0.04);
            if (dir) {
              add(1 / 3, into + 2 * dir, 0.36, 0.26);
              add(2 / 3, into + dir, 0.46, 0.28);
            } else add(2 / 3, halfStep(into, note), 0.46, 0.28);
          } else if (kind === "dead") {
            ev.duration = 0.16;
            ev.velocity *= 0.62;
          } else if (kind === "turn") {
            ev.duration = 1 / 3 - 0.04;
            // The scale step above or below (so a dominant into minor turns on its flat 13, not the 13).
            const step = (dir: number) => {
              let m = note + dir;
              while (scale.length && !scale.includes(((m % 12) + 12) % 12) && Math.abs(m - note) < 2) m += dir;
              return m;
            };
            add(1 / 3, step(note + 2 > BASS_TOP ? -1 : note - 2 < BASS_LOW ? 1 : random() < 0.5 ? 1 : -1), 0.42, 0.28);
            add(2 / 3, note, 0.44, 0.3);
          }
        }
      }

      // Guitar (only heard when the chart's band has it): four to the bar, short and soft.
      for (let b = 0; b < 4; b++) {
        const slot = chordAt(bar, b);
        if (!slot || inTwo) continue;
        guitar = voiceClear(slot.chord, guitar, GUITAR_RANGE, after(i, slot), bassAt(b) ?? null);
        events.push({ track: "guitar", time: t + b + clock.at("guitar"), duration: 0.35, velocity: human((b % 2 ? 0.4 : 0.34) * lift, 0.06), notes: guitar });
      }

      // Piano: the section's groove (comping.ts); a hit on the and of 4 anticipates the next
      // chord (and that chord's downbeat isn't played again).
      const nextChord = next?.chords[0];
      const changes = !!nextChord?.attack && !next?.final && nextChord.chord !== bar.chords.at(-1)?.chord;
      // The chart's comping colour: sparse cells and strolled phrases, busy ones, or blues riffs
      // (a groove on the ands of 2 and 4, where Kelly-style blues comping sits, varied less).
      const colour = feel.comp;
      // Sparse: in the solos the pianist strolls (lays out) for whole four-bar phrases, often two
      // or three running, as Evans does on the 1959 modal record (piano in 30 to 40% of solo bars,
      // out for 7 to 13 bars at a time): about 45% of the solo bars, runs of about nine bars.
      if (inPhrase === 0) strolling = !straight && colour === "sparse" && (plan.role === "solo" || plan.role === "peak") && random() < (strolling ? 0.55 : 0.35);
      // Busy comps lighter under the head's melody than in the solos.
      const busy = plan.role === "head" || plan.role === "outhead" || plan.role === "intro" ? 0.86 : 1.15;
      const density = plan.density * (colour === "sparse" ? 0.82 : colour === "busy" ? busy : colour === "blues" ? 1.08 : 1);
      const bluesWeight = (gr: Groove) => (colour === "blues" && gr.bars[0].some(([slot]) => slot === 3 || slot === 7) ? 1.6 : 1);
      // The groove for this section (two-feel and up-tempo have their own), played A B A B through
      // each phrase: the phrase's first bar as written, the others now and then moved a little,
      // the last most often (a push into the next phrase, or a breath).
      const pool = inTwo ? GROOVES_TWO : fast ? GROOVES_FAST : colour === "busy" ? GROOVES_BUSY : GROOVES;
      const kind = inTwo ? "two" : fast ? "fast" : "";
      const groove = book.grooveFor(bar.chorus * 4 + (inTwo ? 1 : fast ? 2 : 0), `${kind}${bar.label}`, (avoid) =>
        weighted(pool.map((gr) => ({ weight: (inTwo || fast ? gr.weight : forDensity(gr, density)) * bluesWeight(gr), value: gr })), random, avoid && pool.includes(avoid) ? avoid : undefined),
      );
      const settled = plan.role === "head" || plan.role === "outhead" || plan.role === "intro" || inTwo;
      const loose = colour === "blues" ? 0.6 : 1;
      const chances = settled ? { first: 0.04, middle: 0.14 * loose, last: 0.3 * loose } : plan.role === "peak" ? { first: 0.1, middle: 0.34 * loose, last: 0.5 * loose } : { first: 0.08, middle: 0.26 * loose, last: 0.45 * loose };
      const cell: CompHit[] = straight
        ? straightCell(bar)
        : strolling
          ? []
          : grooveBar(groove, inPhrase, random, chances, { adds: ADDS, busier: density * 1.3, length: 0.4, velocity: 0.47 });
      // The register moves with the chorus and drifts by section, by voice leading in between
      // (no jumps from bar to bar: a hand that moves without a reason sounds unsure).
      if (!straight && inPhrase === 0 && ((bar.ref?.bar ?? 0) % 8 === 0 || bar.ref?.bar === undefined))
        registerDrift = weighted([{ weight: 0.6, value: -2 }, { weight: 1, value: -1 }, { weight: 1.4, value: 0 }, { weight: 1, value: 1 }, { weight: 0.7, value: 2 }, { weight: 0.3, value: 3 }], random, registerDrift);
      const shift = straight ? 0 : Math.max(-3, Math.min(7, plan.register + registerDrift));
      // Comping dynamics: each four-bar phrase holds, swells or falls back, and every bar
      // has its own touch, in dB (references vary the mid band 2 to 3 dB bar to bar).
      if (!straight && inPhrase === 0) {
        phraseDb = gauss(random) * 0.9;
        phraseSlope = weighted([{ weight: 0.4, value: 0 }, { weight: 0.35, value: 0.9 }, { weight: 0.25, value: -0.9 }], random);
      }
      const touchDb = straight ? 0 : phraseDb + phraseSlope * (inPhrase - 1.5) + gauss(random) * 1.0;
      const pianoGain = 10 ** (touchDb / 20);
      const range: VoicingRange = shifted(SWING_RANGE, shift);
      // How much of the room to the next hit a chord holds: more in the head, less as the band drives.
      const legato = plan.role === "peak" ? 0.75 : plan.role === "solo" ? 0.82 : 0.9;
      // A chord that starts inside the bar is heard: an and just before it anticipates it, and when
      // no hit falls on it or an eighth either side, one is added on its beat.
      if (!straight && cell.length)
        for (const c of bar.chords)
          if (c.attack && c.beat >= 1 && !cell.some(([slot]) => Math.abs(slot - c.beat * 2) <= 1)) cell.push([Math.round(c.beat * 2), 0.45, 0.46]);
      cell.sort((a, b) => a[0] - b[0]);
      const barBass = events.slice(Math.max(0, bassFrom - 40)).filter((e) => e.track === "bass");
      const pianoBeats: number[] = [];
      let pushes = false;
      cell.forEach(([slot, length, velocity], h) => {
        const beat = eighth(slot);
        if (pushedIn && beat < 0.5) return;
        const ahead = slot === 7 && changes;
        // An and just before a chord that starts inside the bar takes that chord.
        const inside = slot % 2 && slot < 7 ? bar.chords.find((x) => x.attack && Math.abs(x.beat - (slot + 1) / 2) < 0.01) : undefined;
        const c = ahead ? nextChord! : (inside ?? chordAt(bar, beat));
        if (!c) return;
        const following = ahead ? after(i + 1, c) : after(i, c);
        // Don't ring into a different chord.
        const change = ahead ? 4 + nextChord!.length : (bar.chords.find((x) => x.beat > Math.max(beat, c.beat) + 0.01)?.beat ?? (changes ? (pushes ? 3.5 : 4) : beat + 4));
        // Held until about the next hit (or a little past the barline, the chord change stops it first); stabs stay short.
        // An anticipation rings into the bar it belongs to.
        const gap = (ahead ? 5.5 : h + 1 < cell.length ? eighth(cell[h + 1][0]) : 4.25) - beat;
        const held = holdLength(length, gap, legato) * (straight ? 1 : 0.94 + random() * 0.06);
        const duration = Math.max(0.25, Math.min(held, 2.5, change - beat - 0.05));
        // The highest bass note sounding while the chord rings (the next bar's first note when it rings over the barline).
        const struck = bassUnder(barBass, t + beat - 0.06, t + beat + duration + 0.06);
        const over = beat + duration > 3.9 && planned !== null ? planned : null;
        const top = struck === null ? over : over === null ? struck : Math.max(struck, over);
        const under = top ?? undefined;
        const base: number[] = voiceClear(c.chord, piano, range, following, top);
        piano = base;
        // Over a modal vamp the hand planes the shape up and down the chord's scale, as Evans and
        // Kelly do over the long D minor of the 1959 record, never one voicing three hits running.
        let voiced = base;
        if (!straight && (ahead ? vampAt(i + 1, c) : vampAt(i, c))) {
          const scale = planeScale(c.chord, following);
          const key = (v: number[]) => v.join(",");
          const fits = (v: number[]) =>
            v[0] >= Math.max(52, range.low - 1) && v.at(-1)! <= range.high + 3 && (under === undefined || v[0] >= under + 3) && v.every((n, j) => j === 0 || v[j - 1] >= 55 || n - v[j - 1] >= 3);
          const options = [-3, -2, -1, 0, 1, 2, 3]
            .map((k) => ({ k, notes: plane(base, scale, k) }))
            .filter((o) => fits(o.notes) && !(recent.length >= 2 && recent.every((r) => r === key(o.notes))));
          if (options.length) {
            // Steps of one or two from the last shape, pulled back toward the unplaned one (the low
            // shapes fail the register check more often, which would let the hand creep up).
            const move = (o: { k: number }) => (o.k === planeStep ? 0.3 : Math.abs(o.k - planeStep) === 1 ? 1 : Math.abs(o.k - planeStep) === 2 ? 0.5 : 0.15);
            const pick = weighted(options.map((o) => ({ weight: move(o) / (1 + 0.6 * Math.max(0, o.k) + 0.2 * Math.max(0, -o.k)), value: o })), random);
            planeStep = pick.k;
            voiced = pick.notes;
          }
        } else planeStep = 0;
        recent.push(voiced.join(","));
        if (recent.length > 2) recent.shift();
        // Voicing size: a shell for a light stab, a two-hand chord (the second note doubled an
        // octave up, on top) for a held or building one.
        let notes = voiced;
        if (straight) notes = voiced;
        else if (!fast && duration < 0.5 && plan.density < 1 && random() < 0.2) notes = [voiced[0], voiced[2], voiced[3]];
        else if (plan.energy >= 1 && duration >= 0.6 && random() < 0.28 * plan.density && voiced[1] + 12 > voiced[3] && voiced[1] + 12 <= 84) notes = [...voiced, voiced[1] + 12];
        // Anticipations are accented a little, as pianists push them.
        // Blues: laid back a few milliseconds more, and now and then a crushed note, the
        // minor third struck just before the major third of a dominant chord.
        const time = t + beat + clock.at("piano") + (colour === "blues" ? (0.006 * feel.tempo) / 60 : 0);
        const hitVelocity = human((velocity + (slot % 2 ? 0.04 : 0)) * lift * pianoGain, 0.12);
        if (!straight && colour === "blues" && c.chord.intervalNames.includes("3M") && c.chord.intervalNames.includes("7m") && random() < 0.22) {
          const third = notes.find((n) => (((n - c.chord.root) % 12) + 12) % 12 === 4);
          if (third !== undefined && (under === undefined || third - 1 >= under + 3)) events.push({ track: "piano", time: time - 0.05, duration: 0.07, velocity: hitVelocity * 0.75, notes: [third - 1] });
        }
        // Short chords end on the damper; held ones ring out with the sampler's release.
        events.push({ track: "piano", time, duration, velocity: hitVelocity, notes, ...pianoTouch(notes, random, !straight && duration >= 1.5 && random() < 0.3), ...(duration < 1.2 ? { release: DAMPER } : {}) });
        pianoLow = notes[0];
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
      // The ride follows the chorus's level through a smoothed gain (three quarters of the drums'
      // chorus level in dB) and a velocity factor from the chorus energy, each moving a little a
      // bar, so it rises into the solos over a few bars instead of jumping at the barline, and
      // rises about 5 to 6 dB from head to peak (the bass and piano about 2), not 9.
      const rideDbTarget = 0.75 * 20 * Math.log10(drumLevel);
      const rideVelocityTarget = Math.max(0.9, Math.min(1.1, 1 + (plan.energy - 0.99))) * (inTwo ? 0.95 : 1) * (fast ? 0.95 : 1);
      rideDb = rideDb === null ? rideDbTarget : rideDb + Math.max(-2.5, Math.min(1.5, rideDbTarget - rideDb));
      rideVelocity = rideVelocity === null ? rideVelocityTarget : rideVelocity + Math.max(-0.05, Math.min(0.03, rideVelocityTarget - rideVelocity));
      cymbalLevel = 10 ** (rideDb / 20);
      const level = rideVelocity * (lift / plan.energy) * (onHat ? 0.85 : 1);
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
