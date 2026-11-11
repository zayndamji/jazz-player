import type { ParsedChord } from "../chart/chords";
import { chordScale } from "../chart/scales";
import { chordAt, sameRef, type TimelineBar } from "../engine/timeline";
import { GUITAR_RANGE, voiceChord } from "../engine/voicing";
import { seededRandom } from "./random";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Swing, 4/4, from slow-medium to up-tempo. Offbeat eighths fall two thirds of the
 * way through the beat at a medium 140 BPM (a 2:1 swing, measured from a reference
 * track, context/style-swing.md), straighter as the tempo rises (`swingRatio`).
 * - Bass: walks in quarter notes. Root on the chord's first beat, chord tones and
 *   scale steps in between, and a half-step approach into the next chord.
 * - Piano: rootless voicings on short syncopated figures (Charleston and its
 *   cousins), sometimes pushing the next chord to the and of 4.
 * - Guitar: soft, short chords on every beat (four to the bar).
 * - Drums: ride on 1, 2, and of 2, 3, 4, and of 4; hi-hat foot on 2 and 4; a
 *   feathered kick; light snare comping; fills at section ends; crash after.
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

/** Piano figures over one bar, as [eighth slot, length in beats, velocity]. */
const COMP: Figure[] = [
  { weight: 0.3, hits: [[0, 0.8, 0.5], [3, 0.5, 0.45]] }, // Charleston: 1, and of 2
  { weight: 0.2, hits: [[1, 0.4, 0.45], [4, 1.2, 0.5]] }, // and of 1, 3
  { weight: 0.2, hits: [[2, 0.5, 0.48], [5, 0.4, 0.42]] }, // 2, and of 3
  { weight: 0.15, hits: [[3, 1.3, 0.5]] }, // a held and of 2
  { weight: 0.15, hits: [[0, 0.35, 0.45], [2, 0.35, 0.4], [5, 0.6, 0.45]] },
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

const PUSH = 0.35;
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

export const swing: Style = {
  id: "swing",
  name: "Swing",
  twoFeel: true,
  // Balanced against the reference track (a fuller walking bass, the guitar felt more than
  // heard), and 3 dB up overall to match the bossa band's loudness.
  mix: { bass: 7, guitar: -4, piano: 2, drums: 3 },
  generate(bars, seed, feel) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const nudge = (ms = 8) => (random() - 0.5) * (ms / 500);
    const events: NoteEvent[] = [];
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: time + nudge(5), duration: 0.25, velocity: human(velocity, spread) });
    const pick = (figures: Figure[]) => {
      let r = random();
      for (const c of figures) if ((r -= c.weight) < 0) return c.hits;
      return figures[0].hits;
    };

    const sw = swingRatio(feel.tempo);
    /** Time in beats of an eighth-note slot in a bar (0 to 7), swung. */
    const eighth = (n: number) => Math.floor(n / 2) + (n % 2 ? sw : 0);
    const fast = feel.tempo >= UP_TEMPO;
    // The guitar thins out from 180 BPM and is gone by 220, where four to the bar gets in the way.
    const guitarLevel = Math.min(1, Math.max(0, (220 - feel.tempo) / 40));
    /** Fill subdivisions in a beat: triplets, or swung eighths when fast. */
    const subdivision = fast ? [0, sw] : [0, 1 / 3, 2 / 3];

    let piano: number[] | null = null;
    let guitar: number[] | null = null;
    let bassNote = 40;
    let pushedIn = false;
    const music = bars.filter((b) => !b.countIn);

    music.forEach((bar, i) => {
      const t = bar.startBeat;
      const next = music[i + 1];
      const prev = music[i - 1];
      const lift = bar.chorus <= 1 ? 0.92 : bar.chorus === 2 ? 1 : 1.06;
      // In two through the intro and first chorus; the chorus's last bar walks into the next.
      const inTwo = feel.twoFeel && bar.chorus <= 1 && bar.ref?.part !== "ending" && !(isFormEnd(bar, next) && !!next && !next.final);

      if (bar.final) {
        const chord = bar.chords[0]?.chord;
        if (!chord) return;
        piano = voiceChord(chord, piano);
        events.push({ track: "piano", time: t, duration: 4, velocity: 0.55, notes: piano });
        events.push({ track: "bass", time: t, duration: 3.5, velocity: 0.85, notes: [nearest(chord.bass, bassNote)] });
        drum(t, "kick", 0.75);
        drum(t, "crash", 0.6, 0);
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
            return { track: "bass", time: t + c.beat + b + nudge(4), duration: Math.min(2, end - b) - 0.1, velocity: human(j === 0 ? 0.82 : 0.74), notes: [n] };
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
              events.push({ track: "bass", time: t + at + nudge(4), duration: 0.25, velocity: human(0.6), notes: [into + (random() < 0.5 ? -1 : 1)] });
            }
          }
          return;
        }
        const line = walk(c.chord, c.length, bassNote, target, random);
        line.forEach((n, b) => events.push({ track: "bass", time: t + c.beat + b + nudge(4), duration: 0.9, velocity: human(b === 0 ? 0.85 : 0.75), notes: [n] }));
        bassNote = line.at(-1)!;
      });

      // Guitar: four to the bar, short and soft; it drops out at fast tempos.
      if (guitarLevel > 0) {
        for (let b = 0; b < 4; b++) {
          const slot = chordAt(bar, b);
          if (!slot) continue;
          guitar = voiceChord(slot.chord, guitar, GUITAR_RANGE);
          events.push({ track: "guitar", time: t + b + nudge(6), duration: 0.35, velocity: human((b % 2 ? 0.42 : 0.36) * lift * guitarLevel * (inTwo ? 0.9 : 1), 0.06), notes: guitar });
        }
      }

      // Piano: a comping figure, re-voiced at each hit; sometimes push the next chord.
      const nextChord = next?.chords[0];
      const push = !!nextChord?.attack && !next?.final && nextChord.chord !== bar.chords.at(-1)?.chord && random() < PUSH;
      for (const [slot, length, velocity] of pick(inTwo ? COMP_TWO : fast ? COMP_FAST : COMP)) {
        const beat = eighth(slot);
        if (pushedIn && beat < 0.5) continue;
        if (push && beat >= 3) continue;
        const c = chordAt(bar, beat);
        if (!c) continue;
        piano = voiceChord(c.chord, piano);
        events.push({ track: "piano", time: t + beat + nudge(10), duration: length, velocity: human(velocity * lift, 0.1), notes: piano });
      }
      if (push) {
        piano = voiceChord(nextChord!.chord, piano);
        events.push({ track: "piano", time: t + eighth(7) + nudge(10), duration: 0.9, velocity: human(0.5 * lift, 0.1), notes: piano });
      }
      pushedIn = push;

      // Drums
      const fill = endsSection(bar, next) && !next?.final;
      const bigFill = isFormEnd(bar, next) && !!next;
      const rideEnd = bigFill ? 2 : fill ? 3 : 4;
      const ride = inTwo ? 0.85 : fast ? 0.95 : 1;
      for (let b = 0; b < rideEnd; b++) {
        drum(t + b, "ride", (b % 2 ? 0.62 : 0.5) * lift * ride);
        if (b % 2) drum(t + b + sw, "ride", (fast ? 0.3 : 0.36) * lift * ride); // the "a" of the spang-a-lang
      }
      [1, 3].forEach((b) => drum(t + b, "pedal", 0.5));
      // A feathered kick: four to the bar, only 1 and 3 when fast.
      for (let b = 0; b < 4; b += fast ? 2 : 1) drum(t + b, "kick", fast ? 0.13 : 0.16, 0.04);
      if (inTwo) {
        if (!fill) drum(t + 3, "rim", 0.34, 0.05); // cross-stick on 4
      } else if (!fill && random() < (fast ? 0.22 : 0.35) * lift) {
        // Light snare comping on a swung offbeat, more often later in the tune.
        drum(t + eighth(1 + 2 * Math.floor(random() * 3)), "snare", 0.22, 0.06);
      }
      if (i > 0 && prev && endsSection(prev, bar)) drum(t, "crash", isFormEnd(prev, bar) ? 0.5 : 0.32, 0.05);

      if (bigFill) {
        // Beats 3 and 4: snare, then toms.
        const sounds: DrumSound[] = ["snare", "snare", "snare", "tomHigh", "tomHigh", "tomLow"];
        const times = [2, 3].flatMap((b) => subdivision.map((d) => b + d));
        times.forEach((time, k) => drum(t + time, sounds[Math.round((k * (sounds.length - 1)) / Math.max(1, times.length - 1))], 0.32 + k * (0.25 / times.length)));
      } else if (fill) {
        // Beat 4 on the snare.
        subdivision.forEach((d, k) => drum(t + 3 + d, "snare", 0.26 + k * 0.08));
      }
    });

    return events.sort((a, b) => a.time - b.time);
  },
};
