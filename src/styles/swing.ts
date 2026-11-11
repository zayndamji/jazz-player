import type { ParsedChord } from "../chart/chords";
import { chordScale } from "../chart/scales";
import { chordAt, sameRef, type TimelineBar } from "../engine/timeline";
import { GUITAR_RANGE, voiceChord } from "../engine/voicing";
import { seededRandom } from "./random";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Medium swing, 4/4. Offbeat eighths fall two thirds of the way through the
 * beat (a 2:1 swing), measured from the reference track (context/style-swing.md).
 * - Bass: walks in quarter notes. Root on the chord's first beat, chord tones and
 *   scale steps in between, and a half-step approach into the next chord.
 * - Piano: rootless voicings on short syncopated figures (Charleston and its
 *   cousins), sometimes pushing the next chord to the and of 4.
 * - Guitar: soft, short chords on every beat (four to the bar).
 * - Drums: ride on 1, 2, and of 2, 3, 4, and of 4; hi-hat foot on 2 and 4; a
 *   feathered kick; light snare comping; fills at section ends; crash after.
 */

const SWING = 2 / 3;
/** Time in beats of an eighth-note slot in a bar (0 to 7), swung. */
const eighth = (n: number) => Math.floor(n / 2) + (n % 2 ? SWING : 0);

/** Piano figures over one bar, as [eighth slot, length in beats, velocity]. */
const COMP: { weight: number; hits: [number, number, number][] }[] = [
  { weight: 0.3, hits: [[0, 0.8, 0.5], [3, 0.5, 0.45]] }, // Charleston: 1, and of 2
  { weight: 0.2, hits: [[1, 0.4, 0.45], [4, 1.2, 0.5]] }, // and of 1, 3
  { weight: 0.2, hits: [[2, 0.5, 0.48], [5, 0.4, 0.42]] }, // 2, and of 3
  { weight: 0.15, hits: [[3, 1.3, 0.5]] }, // a held and of 2
  { weight: 0.15, hits: [[0, 0.35, 0.45], [2, 0.35, 0.4], [5, 0.6, 0.45]] },
];

const PUSH = 0.35;
const BASS_LOW = 28; // E1
const BASS_HIGH = 50; // D3

/** The MIDI note of a pitch class nearest to `near`, inside the bass range. */
function nearest(pc: number, near: number): number {
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
function walk(chord: ParsedChord, beats: number, from: number, target: number | null, random: () => number): number[] {
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

function endsSection(bar: TimelineBar, next: TimelineBar | undefined): boolean {
  if (!bar.ref) return false;
  if (!next?.ref) return true;
  return next.ref.part !== bar.ref.part || next.ref.section !== bar.ref.section || next.ref.bar === 0;
}

const isFormEnd = (bar: TimelineBar, next: TimelineBar | undefined) =>
  bar.ref?.part === "form" && (!next?.ref || next.ref.part !== "form" || next.chorus !== bar.chorus || sameRef(next.ref, { part: "form", section: 0, bar: 0 }));

export const swing: Style = {
  id: "swing",
  name: "Medium swing",
  // Balanced against the second tune reference (a fuller walking bass, the guitar felt more than
  // heard), and 3 dB up overall to match the bossa band's loudness.
  mix: { bass: 7, guitar: -4, piano: 2, drums: 3 },
  generate(bars, seed) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const nudge = (ms = 8) => (random() - 0.5) * (ms / 500);
    const events: NoteEvent[] = [];
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: time + nudge(5), duration: 0.25, velocity: human(velocity, spread) });
    const pickComp = () => {
      let r = random();
      for (const c of COMP) if ((r -= c.weight) < 0) return c.hits;
      return COMP[0].hits;
    };

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

      // Bass: walk each chord, aiming at the next one.
      bar.chords.forEach((c, k) => {
        const following = bar.chords[k + 1] ?? next?.chords[0];
        const target = following ? nearest(following.chord.bass, bassNote) : null;
        const line = walk(c.chord, c.length, bassNote, target, random);
        line.forEach((n, b) => events.push({ track: "bass", time: t + c.beat + b + nudge(4), duration: 0.9, velocity: human(b === 0 ? 0.85 : 0.75), notes: [n] }));
        bassNote = line.at(-1)!;
      });

      // Guitar: four to the bar, short and soft.
      for (let b = 0; b < 4; b++) {
        const slot = chordAt(bar, b);
        if (!slot) continue;
        guitar = voiceChord(slot.chord, guitar, GUITAR_RANGE);
        events.push({ track: "guitar", time: t + b + nudge(6), duration: 0.35, velocity: human((b % 2 ? 0.42 : 0.36) * lift, 0.06), notes: guitar });
      }

      // Piano: a comping figure, re-voiced at each hit; sometimes push the next chord.
      const nextChord = next?.chords[0];
      const push = !!nextChord?.attack && !next?.final && nextChord.chord !== bar.chords.at(-1)?.chord && random() < PUSH;
      for (const [slot, length, velocity] of pickComp()) {
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
      for (let b = 0; b < rideEnd; b++) {
        drum(t + b, "ride", (b % 2 ? 0.62 : 0.5) * lift);
        if (b % 2) drum(t + b + SWING, "ride", 0.36 * lift); // the "a" of the spang-a-lang
      }
      [1, 3].forEach((b) => drum(t + b, "pedal", 0.5));
      for (let b = 0; b < 4; b++) drum(t + b, "kick", 0.16, 0.04); // feathered
      // Light snare comping on a swung offbeat, more often later in the tune.
      if (!fill && random() < 0.35 * lift) drum(t + eighth(1 + 2 * Math.floor(random() * 3)), "snare", 0.22, 0.06);
      if (i > 0 && prev && endsSection(prev, bar)) drum(t, "crash", isFormEnd(prev, bar) ? 0.5 : 0.32, 0.05);

      if (bigFill) {
        // Beats 3 and 4 in triplets: snare, then toms.
        const sounds: DrumSound[] = ["snare", "snare", "snare", "tomHigh", "tomHigh", "tomLow"];
        sounds.forEach((s, k) => drum(t + 2 + k / 3, s, 0.32 + k * 0.05));
      } else if (fill) {
        // Beat 4: a triplet on the snare.
        [3, 3 + 1 / 3, 3 + 2 / 3].forEach((b, k) => drum(t + b, "snare", 0.26 + k * 0.08));
      }
    });

    return events.sort((a, b) => a.time - b.time);
  },
};
