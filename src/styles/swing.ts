import type { ParsedChord } from "../chart/chords";
import { chordScale } from "../chart/scales";
import { chordAt, sameRef, type TimelineBar } from "../engine/timeline";
import { GUITAR_RANGE, SWING_RANGE, voiceChord } from "../engine/voicing";
import { seededRandom } from "./random";
import { shapeBars, weighted } from "./shape";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Swing, 4/4, from slow-medium to up-tempo. Offbeat eighths fall two thirds of the
 * way through the beat at a medium 140 BPM (a 2:1 swing, measured from a reference
 * track, context/style-swing.md), straighter as the tempo rises (`swingRatio`).
 * - Bass: walks in quarter notes. Root on the chord's first beat, chord tones and
 *   scale steps in between, and a half-step approach into the next chord.
 *   Now and then a ghosted note before a beat.
 * - Piano: the only chord instrument (a piano trio, like the reference tracks).
 *   Close rootless voicings with the 3rd or 7th at the bottom, on one-bar comping
 *   cells (2 and 4, Charleston, 1 3 4, pushes on the ands...) that change every bar,
 *   two to three hits a bar. A hit on the and of 4 anticipates the next chord.
 * - Guitar (only when a chart's `band` adds it): soft four to the bar.
 * - Drums: ride spang-a-lang with variations (straight quarters, an extra skip),
 *   hi-hat foot on 2 and 4, a feathered kick with an occasional accent, snare
 *   comping that grows through the tune, and fills picked from a vocabulary at
 *   phrase ends (small), section ends (medium) and the end of the form (big).
 * - Dynamics: every part follows `shapeBars` (a lift per chorus, the bridge, a drift).
 * - Up-tempo (from `UP_TEMPO`): sparser, longer piano hits with bars left empty,
 *   the guitar fades out, eighth-note fills instead of triplets.
 * - Two-feel (`Feel.twoFeel`): the intro and first chorus with the bass in half
 *   notes (with a pickup now and then), cross-stick on 4 and sparse comping; the
 *   last bar of the chorus walks into the second.
 */

/**
 * Where the swung offbeat eighth falls in the beat, by tempo. Drummers swing
 * harder when slow and straighter when fast (measured ride ratios run from
 * about 3:1 at slow tempos toward 1:1 near 300 BPM); 2:1 at a medium 140, as the
 * reference track measured.
 */
export function swingRatio(bpm: number): number {
  const points: [number, number][] = [[60, 0.71], [140, 2 / 3], [200, 0.62], [280, 0.57]];
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

const BASS_LOW = 28; // E1
const BASS_HIGH = 50; // D3

/** The MIDI note of a pitch class nearest to `near`, inside the bass range. */
export function nearest(pc: number, near: number): number {
  let best = BASS_LOW + ((pc - BASS_LOW + 120) % 12);
  for (let n = best; n <= BASS_HIGH; n += 12) if (Math.abs(n - near) < Math.abs(best - near)) best = n;
  return best;
}

/** Pitch classes of a chord's scale, from its root. */
function scalePcs(chord: ParsedChord): number[] {
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
 */
export function walk(chord: ParsedChord, beats: number, from: number, target: number | null, random: () => number): number[] {
  const root = nearest(chord.bass, from);
  const notes = [root];
  const tones = chord.intervals.map((i) => (chord.root + i) % 12);
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
      const pool = random() < 0.6 ? tones : scale;
      let n = current + dir;
      for (let k = 0; k < 12 && !pool.includes(((n % 12) + 12) % 12); k++) n += dir;
      if (n < BASS_LOW || n > BASS_HIGH) n = nearest(tones[1] ?? chord.root, current);
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
  ];
  const medium: Fill[] = [
    { start: 3, hits: [[0, "snare", 0.26], [t, "snare", 0.32], [2 * t, "snare", 0.4]] },
    { start: 2, hits: [[sw, "snare", 0.26], [1, "snare", 0.3], [1 + sw, "tomHigh", 0.36], [1 + (fast ? sw : 2 / 3), "tomLow", 0.4]] },
    { start: 3, hits: [[0, "snare", 0.3], [t, "tomHigh", 0.34], [2 * t, "tomLow", 0.4]] },
    { start: 2, hits: [[0, "snare", 0.24], [sw, "snare", 0.3], [1, "kick", 0.34], [1 + sw, "snare", 0.4]] },
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
  ];
  return { small, medium, big };
}

export const swing: Style = {
  id: "swing",
  name: "Swing",
  twoFeel: true,
  // A piano trio, like the reference tracks: rhythm guitar only when a chart asks for it.
  band: ["bass", "piano", "drums"],
  // Balanced against the references (context/backing-track-design.md): the bass leads,
  // the piano sits just under it, the cymbals well down.
  mix: { bass: 9, guitar: -6, piano: 2.5, drums: 2.5 },
  generate(bars, seed, feel) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const nudge = (ms = 8) => (random() - 0.5) * (ms / 500);
    const events: NoteEvent[] = [];
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: time + nudge(5), duration: 0.25, velocity: human(velocity, spread) });

    const sw = swingRatio(feel.tempo);
    /** Time in beats of an eighth-note slot in a bar (0 to 7), swung. */
    const eighth = (n: number) => Math.floor(n / 2) + (n % 2 ? sw : 0);
    const fast = feel.tempo >= UP_TEMPO;
    const slow = feel.tempo < 110;
    const vocab = fills(sw, fast);

    let piano: number[] | null = null;
    let guitar: number[] | null = null;
    let bassNote = 40;
    let pushedIn = false;
    let lastCell: Figure["hits"] | undefined;
    let lastFill: Fill | undefined;
    const music = bars.filter((b) => !b.countIn);
    const shapes = shapeBars(music, random);

    music.forEach((bar, i) => {
      const t = bar.startBeat;
      const next = music[i + 1];
      const prev = music[i - 1];
      const { intensity: lift, phraseEnd } = shapes[i];
      // In two through the intro and first chorus; the chorus's last bar walks into the next.
      const inTwo = feel.twoFeel && bar.chorus <= 1 && bar.ref?.part !== "ending" && !(isFormEnd(bar, next) && !!next && !next.final);

      if (bar.final) {
        const chord = bar.chords[0]?.chord;
        if (!chord) return;
        piano = voiceChord(chord, piano, SWING_RANGE);
        events.push({ track: "piano", time: t, duration: 4, velocity: 0.55, notes: piano });
        guitar = voiceChord(chord, guitar, GUITAR_RANGE);
        events.push({ track: "guitar", time: t, duration: 3, velocity: 0.4, notes: guitar });
        events.push({ track: "bass", time: t, duration: 3.5, velocity: 0.85, notes: [nearest(chord.bass, bassNote)] });
        drum(t, "kick", 0.75);
        drum(t, "crash", 0.55, 0);
        return;
      }

      // Bass: walk each chord, aiming at the next one; or half notes in two.
      bar.chords.forEach((c, k) => {
        const following = bar.chords[k + 1] ?? next?.chords[0];
        const target = following ? nearest(following.chord.bass, bassNote) : null;
        if (inTwo) {
          const changing = target !== null && following!.chord !== c.chord;
          const line = twoBeat(c.chord, c.length, bassNote, target, changing, random);
          const halves = line.map(([b, n], j): NoteEvent => {
            const end = line[j + 1]?.[0] ?? c.length;
            return { track: "bass", time: t + c.beat + b + nudge(4), duration: Math.min(2, end - b) - 0.1, velocity: human((j === 0 ? 0.82 : 0.74) * lift), notes: [n] };
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
              events.push({ track: "bass", time: t + at + nudge(4), duration: 0.25, velocity: human(0.6 * lift), notes: [into + (random() < 0.5 ? -1 : 1)] });
            }
          }
          return;
        }
        const line = walk(c.chord, c.length, bassNote, target, random);
        line.forEach((n, b) => {
          const note: NoteEvent = { track: "bass", time: t + c.beat + b + nudge(4), duration: 0.9, velocity: human((b === 0 ? 0.85 : 0.76) * lift), notes: [n] };
          events.push(note);
          // A ghosted note on the swung eighth before the next beat, now and then (not when fast).
          if (!fast && b < line.length - 1 && random() < 0.06) {
            note.duration = sw - 0.05;
            events.push({ track: "bass", time: t + c.beat + b + sw + nudge(4), duration: 1 - sw - 0.05, velocity: human(0.4), notes: [n] });
          }
        });
        bassNote = line.at(-1)!;
      });

      // Guitar (only heard when the chart's band has it): four to the bar, short and soft.
      for (let b = 0; b < 4; b++) {
        const slot = chordAt(bar, b);
        if (!slot || inTwo) continue;
        guitar = voiceChord(slot.chord, guitar, GUITAR_RANGE);
        events.push({ track: "guitar", time: t + b + nudge(6), duration: 0.35, velocity: human((b % 2 ? 0.4 : 0.34) * lift, 0.06), notes: guitar });
      }

      // Piano: a comping cell, a different one each bar; a hit on the and of 4 anticipates
      // the next chord (and that chord's downbeat isn't played again).
      const nextChord = next?.chords[0];
      const changes = !!nextChord?.attack && !next?.final && nextChord.chord !== bar.chords.at(-1)?.chord;
      const cell = inTwo
        ? weighted(COMP_TWO.map((c) => ({ weight: c.weight, value: c.hits })), random)
        : weighted((fast ? COMP_FAST : COMP).map((c) => ({ weight: c.weight, value: c.hits })), random, lastCell);
      lastCell = cell;
      let pushes = false;
      for (const [slot, length, velocity] of cell) {
        const beat = eighth(slot);
        if (pushedIn && beat < 0.5) continue;
        const ahead = slot === 7 && changes;
        const c = ahead ? nextChord! : chordAt(bar, beat);
        if (!c) continue;
        piano = voiceChord(c.chord, piano, SWING_RANGE);
        // Anticipations are accented a little, as pianists push them.
        events.push({ track: "piano", time: t + beat + nudge(10), duration: length, velocity: human((velocity + (slot % 2 ? 0.04 : 0)) * lift, 0.1), notes: piano });
        if (ahead) pushes = true;
      }
      pushedIn = pushes;

      // Drums
      const fill = endsSection(bar, next) && !next?.final;
      const bigFill = isFormEnd(bar, next) && !!next;
      const smallFill = phraseEnd && !inTwo && random() < 0.55;
      const pickFill = (list: Fill[]) => {
        const f = weighted(list.map((x) => ({ weight: 1, value: x })), random, lastFill);
        lastFill = f;
        return f;
      };
      const theFill = bigFill ? pickFill(vocab.big) : fill ? pickFill(vocab.medium) : smallFill ? pickFill(vocab.small) : null;
      const rideEnd = theFill && theFill.start <= 2 && (bigFill || fill) ? theFill.start : 4;
      const ride = (inTwo ? 0.85 : fast ? 0.95 : 1) * lift;
      // Ride: mostly spang-a-lang; sometimes straight quarters, sometimes an extra skip.
      const variant = fast ? 0 : weighted([{ weight: 0.72, value: 0 }, { weight: 0.14, value: 1 }, { weight: 0.14, value: 2 }], random);
      for (let b = 0; b < rideEnd; b++) {
        drum(t + b, "ride", (b % 2 ? 0.62 : 0.5) * ride);
        const skip = variant === 1 ? false : b % 2 === 1 || (variant === 2 && b === 2);
        if (skip && b + sw < rideEnd) drum(t + b + sw, "ride", (fast ? 0.3 : 0.36) * ride); // the "a" of the spang-a-lang
      }
      [1, 3].forEach((b) => drum(t + b, "pedal", 0.5));
      // A feathered kick (only 1 and 3 when fast), with an accent on the and of 4 now and then.
      for (let b = 0; b < 4; b += fast ? 2 : 1) drum(t + b, "kick", fast ? 0.13 : 0.16, 0.04);
      if (!theFill && !inTwo && bar.chorus >= 2 && random() < 0.08) drum(t + 3 + sw, "kick", 0.38);
      if (inTwo) {
        if (!fill) drum(t + 3, "rim", 0.34, 0.05); // cross-stick on 4
      } else if (!theFill) {
        // Snare comping on swung offbeats and triplet partials: more as the tune builds.
        const chances = (slow ? 0.45 : fast ? 0.25 : 0.38) * lift * lift;
        for (let n = 0; n < 2; n++) {
          if (random() >= chances) continue;
          const beat = Math.floor(random() * 4);
          const where = random() < 0.7 ? beat + sw : beat + 1 / 3;
          drum(t + where, "snare", n === 0 ? 0.2 : 0.14, 0.06);
        }
      }
      // Crash where a section starts: always at the top of a chorus, often elsewhere.
      if (i > 0 && prev && endsSection(prev, bar) && (isFormEnd(prev, bar) || random() < 0.6)) drum(t, "crash", isFormEnd(prev, bar) ? 0.48 : 0.3, 0.05);
      if (theFill) for (const [at, sound, velocity] of theFill.hits) drum(t + theFill.start + at, sound, velocity * (0.9 + 0.2 * (lift - 0.9)));
    });

    return events.sort((a, b) => a.time - b.time);
  },
};
