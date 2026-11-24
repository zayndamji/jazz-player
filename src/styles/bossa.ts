import type { ParsedChord } from "../chart/chords";
import { chordAt, type TimelineBar } from "../engine/timeline";
import { guitarFingers, guitarThumb } from "../engine/guitar";
import { PIANO_RANGE, voicingIntervals, type VoicingRange } from "../engine/voicing";
import { BASS_HIGH, BASS_LOW, bassOnsets, bassStruck, bassUnder, chordAfter, endsSection, isFormEnd, shifted, voiceClear } from "./context";
import { DAMPER, GrooveBook, grooveBar, holdLength, type CompHit, type Groove } from "./comping";
import { drumGain, gauss, pianoTouch, timing } from "./feel";
import { seededRandom } from "./random";
import { shapeBars, steadyBars, weighted } from "./shape";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Bossa nova, straight eighths, in a two-bar cycle. The patterns follow a
 * measured Band-in-a-Box bossa track (context/reference-backing-track.md):
 * - Bass: 1, and of 2, 3, and of 4. The eighths anticipate the next note.
 * - Guitar: plays like a nylon-string bossa guitarist (src/engine/guitar.ts): the thumb on 1 and 3
 *   on the bass player's note and instant (root or 5th, never anticipated), and the fingers plucking
 *   three-note grips in a light roll (about 5 ms a string), neither a block nor a strum, on a two-bar
 *   figure picked per cycle from a few variations, Gilberto's 1, 2, 3, and of 3, and of 4 among them;
 *   each chord rings until the next.
 *   It leads the comping, as on the Getz/Gilberto records (context/original-records.md).
 * - Piano: under the guitar and light: its own sparse two-bar figure of medium-length
 *   chords, so the comping has two voices that answer each other. With the chart's
 *   `comp: "sparse"` it lays out for most of the heads, as Jobim does under the voice,
 *   and plays fewer chords in the solos. A tune whose record has no guitar (Henderson's
 *   Blue Bossa) leaves it out with the chart's `band` and puts the piano back up.
 * - Pushes: chord changes are anticipated on the and of 4 by guitar and piano together, so
 *   they never play different chords at once: most often into a new phrase, now and then inside one.
 * - Drums: light. Straight eighths on the hi-hat, the ands nearly as strong as the beats
 *   and 2 and 4 accented, a soft kick with the bass, cross-stick on 2 and 4 (with `comp:
 *   "sparse"` only in the solos, as on the vocal records), a short fill at most section ends and
 *   at the end of the form, a soft crash at the top of a chorus, the ride cymbal in
 *   the bridge from the second chorus.
 * - Dynamics and texture follow the chorus plan (`shapeBars` with its arc): the head on
 *   lighter hats, the solos building to a peak on the ride, the out-head back on the hats.
 *   The hats play two-bar figures around a home figure picked per chorus.
 * - The piano keeps a groove per section and varies it a little (comping.ts); its register
 *   moves with the chorus and by section, not from bar to bar.
 * - Time: each part in its own pocket with a shared slow drift (feel.ts `timing`).
 * - Straight (`Feel.variation`): the first guitar, piano and hat figures every cycle, no
 *   pushes, one level and register; a short fill and a crash only at the end of the form.
 */

/** Cross-stick on 2 and 4: the records' rim lands there, not on a clave. */
const RIM = [1, 3];

/** Added to the hats' offbeat eighths: on the records the ands sit nearly level with the beats. */
const ANDS = 0.1;

type Hit = [beat: number, length: number, velocity: number];

/**
 * Guitar figures, two bars each. The first follows the reference track; a section keeps one
 * through the chorus (`pick`), so the guitar's rhythm is steady and choruses still differ.
 */
const GUITAR_FIGURES: { weight: number; bars: Hit[][] }[] = [
  {
    weight: 0.35,
    bars: [
      [[0, 0.45, 0.75], [1, 0.4, 0.85], [2.5, 0.45, 0.8], [3, 0.35, 0.55]],
      [[0.5, 0.4, 0.75], [2, 0.45, 0.85], [2.5, 0.4, 0.65], [3, 0.5, 0.8]],
    ],
  },
  {
    weight: 0.2,
    bars: [
      [[0, 0.45, 0.8], [1.5, 0.4, 0.75], [2.5, 0.4, 0.75], [3.5, 0.35, 0.6]],
      [[1, 0.4, 0.8], [2, 0.45, 0.85], [3, 0.5, 0.75]],
    ],
  },
  {
    weight: 0.1,
    bars: [
      [[0, 0.7, 0.75], [1.5, 0.4, 0.7], [3, 0.6, 0.7]],
      [[1, 0.5, 0.7], [2.5, 0.9, 0.75]],
    ],
  },
  {
    // Gilberto on the 1964 records: 1, 2, 3, the and of 3, the and of 4, beat 4 left open.
    weight: 0.35,
    bars: [
      [[0, 0.45, 0.8], [1, 0.45, 0.75], [2, 0.45, 0.8], [2.5, 0.4, 0.7], [3.5, 0.4, 0.72]],
      [[0, 0.45, 0.78], [1, 0.45, 0.75], [2.5, 0.45, 0.78], [3.5, 0.4, 0.72]],
    ],
  },
];
const SPARSE = 2; // the figure for the intro

/** Chance that guitar and piano push a chord change to the and of 4, by the bar's place in the phrase: into a new phrase most. */
const PUSH = [0.12, 0.25, 0.12, 0.6];

/** Hi-hat velocity on each eighth: 2 and 4 strongest, offbeats soft. Light, like the references. */
const HAT = [0.46, 0.28, 0.6, 0.3, 0.48, 0.34, 0.6, 0.28];

/**
 * Two-bar hi-hat figures (velocity per eighth, 0 leaves it out). The references alternate
 * figures like these every two bars rather than repeating one bar all through.
 */
const HAT_FIGURES: { weight: number; bars: number[][] }[] = [
  { weight: 0.4, bars: [HAT, HAT] },
  { weight: 0.2, bars: [HAT, [0.46, 0.28, 0.6, 0.42, 0.48, 0.3, 0.6, 0.42]] }, // the ands of 2 and 4 lifted in bar 2
  { weight: 0.15, bars: [[0.5, 0.22, 0.56, 0.24, 0.5, 0.22, 0.56, 0.24], [0.5, 0.22, 0.56, 0.24, 0.5, 0.26, 0.56, 0.3]] }, // on the beat, offbeats very soft
  { weight: 0.15, bars: [[0.36, 0.5, 0.44, 0.5, 0.36, 0.5, 0.44, 0.5], HAT] }, // offbeats leaning
  { weight: 0.1, bars: [[0.46, 0, 0.6, 0.3, 0.48, 0, 0.6, 0.3], [0.46, 0.28, 0.6, 0, 0.48, 0.34, 0.6, 0]] }, // gaps on the ands
  { weight: 0.12, bars: [[0.56, 0.3, 0.46, 0.3, 0.56, 0.3, 0.46, 0.3], [0.56, 0.3, 0.46, 0.34, 0.56, 0.3, 0.46, 0.44]] }, // 1 and 3 leaning, a lift into the next bar
  { weight: 0.1, bars: [[0.44, 0.34, 0.52, 0.36, 0.48, 0.38, 0.56, 0.42], [0.48, 0.4, 0.56, 0.44, 0.52, 0.44, 0.6, 0.48]] }, // a two-bar swell
  { weight: 0.08, bars: [HAT, [0.46, 0.28, 0.6, 0.3, 0.48, 0, 0.62, 0.46]] }, // a space on the and of 3, the and of 4 pushed
];

const KICK = [
  { beat: 0, velocity: 0.6 },
  { beat: 1.5, velocity: 0.42 },
  { beat: 2, velocity: 0.55 },
  { beat: 3.5, velocity: 0.42 },
];

const g = (id: string, weight: number, a: CompHit[], b: CompHit[]): Groove => ({ id, weight, bars: [a, b] });

/**
 * Piano grooves, two bars each as [eighth slot (0 to 7), length in beats, velocity]: fewer hits than
 * the guitar's, placed between them, kept through a section and varied a little (`comping.ts`).
 * After the references' piano stems (context/style-bossa.md): about two hits a bar, beat 3 the
 * busiest place, the and of 1, the and of 2 and beat 4 next; the trio on the Ipanema track plays the
 * and of 1 and the and of 2, then 3 and 4, over and over; chords about half a beat to a beat long.
 * Both bars of a groove share a place (the busiest eighth is in 53 to 71% of the references' bars).
 * The first is the straight feel's; the second, held, the intro's.
 */
const PIANO_GROOVES: Groove[] = [
  g("home", 0.25, [[0, 0.9, 0.46], [5, 0.8, 0.42]], [[2, 0.8, 0.44], [5, 0.7, 0.42]]),
  g("long", 0.12, [[0, 2.4, 0.44]], [[3, 1.6, 0.42]]),
  g("answer", 0.25, [[1, 0.6, 0.44], [4, 0.8, 0.44]], [[4, 0.8, 0.46], [6, 0.6, 0.42]]),
  g("three", 0.2, [[0, 0.8, 0.46], [4, 0.8, 0.44]], [[1, 0.6, 0.42], [4, 0.8, 0.44]]),
  g("ands", 0.15, [[3, 0.7, 0.44], [6, 0.7, 0.42]], [[1, 0.6, 0.42], [3, 0.6, 0.42], [6, 0.6, 0.42]]),
  g("busy", 0.13, [[0, 0.6, 0.44], [3, 0.6, 0.42], [6, 0.6, 0.42]], [[1, 0.6, 0.42], [4, 0.6, 0.44], [6, 0.5, 0.4]]),
];

/** A groove's weight for the chorus: busier grooves when the band builds, sparser in the head. */
const forDensity = (f: Groove, density: number) => f.weight * density ** ((f.bars[0].length + f.bars[1].length - 4) * 2);

/** Where a varied bar may add a hit (the and of 4 is the push's). */
const ADDS = [1, 2, 3, 4, 5, 6].map((slot) => ({ slot, weight: slot === 4 ? 1 : slot === 1 || slot === 3 ? 0.9 : 0.7 }));

/** A groove bar in beats. */
const inBeats = (hits: CompHit[]): Hit[] => hits.map(([slot, length, velocity]) => [slot / 2, length, velocity]);

/** The line leans back toward A#1 so the roots stay low, where the old fixed roots sat (E1 to D#2). */
const BASS_HOME = 34;
/** The widest leap between two bass notes: an octave. */
const LEAP = 12;

/**
 * The bass note of pitch class `pc` nearest `from` (and `to`, when given), never more than an
 * octave from either, leaning toward `home`; `avoid` (a repeated note) is taken only when nothing else fits.
 */
export function placeBass(pc: number, from: number, to: number | null = null, home: number | null = BASS_HOME, avoid: number | null = null): number {
  let best = from;
  let bestScore = Infinity;
  for (let n = BASS_LOW + ((pc - BASS_LOW + 120) % 12); n <= BASS_HIGH; n += 12) {
    const leap = Math.max(Math.abs(n - from), to === null ? 0 : Math.abs(n - to));
    const score =
      Math.abs(n - from) + (to === null ? 0 : Math.abs(n - to)) + (home === null ? 0 : 1.5 * Math.abs(n - home)) + (leap > LEAP ? 100 : 0) + (n === avoid ? 20 : 0);
    if (score < bestScore) [best, bestScore] = [n, score];
  }
  return best;
}

/** True when a pitch class sits a half step from one of the comping's voiced tones. */
const rubs = (pc: number, chord: ParsedChord, next: ParsedChord | null) =>
  voicingIntervals(chord, next).some((iv) => [1, 11].includes((((chord.root + iv - pc) % 12) + 12) % 12));

/**
 * The bar's other chord tone, after the bass note: the fifth; the flat fifth on half-diminished and
 * diminished chords (Dm7b5 plays D then Ab); the chord's own root over a slash bass. When the comping's
 * voicing (with `next`, the chord after, as the piano and guitar voice it) has a tone a half step from
 * the fifth, a b13 or #5 (written, or a dominant into minor) or a #11 or b5 on a dominant, the root again.
 */
export function otherPc(chord: ParsedChord, next: ParsedChord | null): number {
  if (chord.bass !== chord.root) return chord.root;
  const fifth = (chord.root + (chord.intervalNames.includes("5d") && chord.intervalNames.includes("3m") ? 6 : 7)) % 12;
  return rubs(fifth, chord, next) ? chord.root : fifth;
}

/**
 * Beat 3 when the chord holds: the fifth above the root (the octave on a b13 or #5), or below
 * when above would sit high or leave the next root more than a fifth or so away. An octave that
 * doesn't fit either way takes the 3rd instead.
 */
function fifthNote(chord: ParsedChord, root: number, nextPc: number | null, next: ParsedChord | null): number {
  const pc = otherPc(chord, next);
  const above = root + ((((pc - root) % 12) + 12) % 12 || 12);
  const below = above - 12;
  const reach = (n: number) => (nextPc === null ? 0 : Math.abs(placeBass(nextPc, n) - n));
  if (above <= 45 && reach(above) <= 9) return above;
  if (below >= BASS_LOW && below !== root) return below;
  if (above <= BASS_HIGH && above !== root + 12) return above;
  const third = (chord.root + (chord.intervalNames.includes("3m") ? 3 : 4)) % 12;
  if (chord.bass === chord.root && !rubs(third, chord, next)) return placeBass(third, root, null, null);
  return above <= BASS_HIGH ? above : root;
}

/**
 * The bass line's main notes for every bar, chosen in order so each sits near the last: beats 1
 * and 3 (the eighths before them anticipate these), or in the final bar one note per chord.
 */
function bassLine(music: TimelineBar[]): (number | null)[][] {
  let last = BASS_HOME;
  return music.map((bar, i) => {
    if (bar.final) return bar.chords.map((c) => (last = placeBass(c.chord.bass, last)));
    const first = chordAt(bar, 0);
    const second = chordAt(bar, 2);
    if (!first || !second) return [null, null];
    const root = placeBass(first.chord.bass, last);
    const nextFirst = music[i + 1] && chordAt(music[i + 1], 0);
    const third = second !== first ? placeBass(second.chord.bass, root) : fifthNote(first.chord, root, nextFirst ? nextFirst.chord.bass : null, chordAfter(music, i, 2));
    last = third;
    return [root, third];
  });
}

export const bossa: Style = {
  id: "bossa",
  name: "Bossa nova",
  band: ["bass", "guitar", "piano", "drums"],
  // Bass in front, the guitar leading the comping and the piano under it, light drums: the
  // Getz/Gilberto records (the guitar 4.5 dB up and the piano 5 dB down from the backing tracks' balance).
  mix: { bass: 3, guitar: -1.5, piano: -3.5, drums: 0 },
  generate(bars, seed, feel) {
    const random = seededRandom(seed);
    // The guitar's pinch and thumb draw on their own sequence, so the rest of the band plays as it would without them.
    const hand = seededRandom(seed + 101);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const clock = timing(random, feel?.tempo ?? 150);
    const pocket: Record<DrumSound, "hat" | "ride" | "kick" | "snare" | "pedal" | "fill"> = {
      hat: "hat", ride: "ride", bell: "ride", kick: "kick", rim: "snare", snare: "snare", pedal: "pedal", crash: "fill", tomHigh: "fill", tomLow: "fill", brush: "snare", brushTap: "snare",
    };
    const events: NoteEvent[] = [];
    // The chorus's drum level (feel.ts `ChorusPlan.drums`), as a gain that leaves the sample layer alone.
    let drumLevel = 1;
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: time + clock.at(pocket[sound]), duration: 0.25, velocity: human(velocity, spread), gain: drumLevel });

    let piano: number[] | null = null;
    let guitar: number[] | null = null;
    // The guitar's finger chords and thumb notes, whose lengths are settled once all are placed.
    const fingers: { event: NoteEvent; until: number }[] = [];
    const thumbs: { event: NoteEvent; until: number }[] = [];
    /**
     * The fingers' chord: a light roll from the lowest string up, about 5 ms a string with a little
     * play (10 to 16 ms in all, how a hand plucks, not a block or a strummed pick), starting `after`
     * seconds in (behind the thumb when both play); the top note a little louder, each string a little uneven.
     */
    const pluck = (notes: number[], after = 0) => ({
      offsets: notes.map((_, k) => after + k * 0.005 + hand() * 0.003),
      levels: notes.map((_, k) => (k === notes.length - 1 ? 1.06 : k === 0 ? 0.94 : 0.97) * (0.95 + hand() * 0.1)),
    });
    let figure = 0;
    const book = new GrooveBook(random, 0.5);
    let pushedIn = false; // this bar's first chord was already played on the and of 4
    const music = bars.filter((b) => !b.countIn);
    const straight = feel?.variation === "straight";
    // The guitar keeps one figure per section label through the chorus, as Gilberto repeats his, and
    // now and then plays another in a phrase's second two bars.
    const guitarBook = new GrooveBook<number>(random, 0.5);
    const pick = (chorus: number, label: string, inPhrase: number) => {
      const home = guitarBook.grooveFor(chorus, label, (avoid) => weighted(GUITAR_FIGURES.map((f, k) => ({ weight: k === SPARSE ? 0 : f.weight, value: k })), random, avoid));
      return inPhrase >= 2 && random() < 0.15 ? weighted(GUITAR_FIGURES.map((f, k) => ({ weight: k === SPARSE ? 0 : f.weight, value: k })), random, home) : home;
    };
    const shapes = straight ? steadyBars(music) : shapeBars(music, random, true);
    const line = bassLine(music);
    // The hats' home figure per chorus.
    const hatHome = new Map<number, number>();
    let hatFigure = 0;
    const sparse = feel?.comp === "sparse";
    let layOut = false;
    let registerDrift = 0;
    let phraseDb = 0;
    let phraseSlope = 0;
    music.forEach((bar, i) => {
      const t = bar.startBeat;
      const cycle = i % 2;
      const next = music[i + 1];
      const prev = music[i - 1];
      const { intensity: lift, plan, shout } = shapes[i];
      drumLevel = drumGain(bar, plan);
      clock.bar();
      const solos = plan.role === "solo" || plan.role === "peak";
      if (cycle === 0 && straight) {
        figure = bar.ref?.part === "intro" ? SPARSE : 0;
        hatFigure = 0;
      } else if (cycle === 0) {
        figure = bar.ref?.part === "intro" ? SPARSE : pick(bar.chorus, bar.label, (bar.ref?.bar ?? i) % 4);
        // Sparse: the piano lays out for most of the head (two bars at a time) and comps less in the solos.
        layOut = sparse && !solos && random() < 0.65;
        if (!hatHome.has(bar.chorus)) hatHome.set(bar.chorus, weighted(HAT_FIGURES.map((f, k) => ({ weight: k === 0 ? 0.6 : f.weight, value: k })), random));
        const home = hatHome.get(bar.chorus)!;
        // The intro keeps the plain figure; elsewhere mostly the home figure, sometimes another.
        hatFigure = bar.ref?.part === "intro" ? 0 : random() < 0.38 ? home : weighted(HAT_FIGURES.map((f, k) => ({ weight: f.weight, value: k })), random, hatFigure === home ? home : hatFigure);
      }
      // The piano's register moves with the chorus and drifts by section, by voice leading in
      // between; its level holds, swells or falls back over each four bars (the references' mid band varies 3.2 to 4.5 dB).
      const inPhrase = (bar.ref?.bar ?? i) % 4;
      if (!straight && inPhrase === 0) {
        if ((bar.ref?.bar ?? 0) % 8 === 0)
          registerDrift = weighted([{ weight: 0.5, value: -2 }, { weight: 1, value: -1 }, { weight: 1.3, value: 0 }, { weight: 1, value: 1 }, { weight: 0.6, value: 2 }, { weight: 0.3, value: 3 }], random, registerDrift);
        phraseDb = gauss(random) * 1.1;
        phraseSlope = weighted([{ weight: 0.4, value: 0 }, { weight: 0.35, value: 1.1 }, { weight: 0.25, value: -1.1 }], random);
      }
      const shift = straight ? 0 : Math.max(-3, Math.min(7, plan.register + registerDrift));
      const pianoGain = straight ? 1 : 10 ** ((phraseDb + phraseSlope * (inPhrase - 1.5) + gauss(random) * 1.1) / 20);
      const range: VoicingRange = shifted(PIANO_RANGE, shift);

      const barBass: NoteEvent[] = [];
      /** The bass's notes on 1 and 3, which the guitar's thumb plays with, at the same instant. */
      const bassMains: (NoteEvent | null)[] = [null, null];
      const bassAt = (e: NoteEvent) => {
        events.push(e);
        barBass.push(e);
      };
      /** The highest bass note under a chord hit from `beat` for `length` beats in this bar. */
      const under = (beat: number, length: number) => bassUnder(barBass, t + beat - 0.05, t + beat + length);

      if (bar.final) {
        // Each chord of the last bar on its beat, the last one held like a fermata.
        const notes = line[i];
        bar.chords.forEach((c, k) => {
          const last = k === bar.chords.length - 1;
          const length = last ? 4 : c.length;
          // Past the sample's length the sampler fades the note inside the sample (src/audio/sprite.ts).
          const bassLength = last ? 3.5 : c.length - 0.1;
          const n = notes[k] ?? placeBass(c.chord.bass, BASS_HOME);
          bassAt({ track: "bass", time: t + c.beat, duration: bassLength, velocity: last ? 0.85 : 0.8, notes: [n] });
          const after = last ? null : bar.chords[k + 1].chord;
          piano = voiceClear(c.chord, piano, PIANO_RANGE, after, n);
          guitar = guitarFingers(c.chord, guitar, { next: after, bass: n });
          events.push({ track: "piano", time: t + c.beat, duration: last ? length : length - 0.1, velocity: last ? 0.5 : 0.46, notes: piano, ...pianoTouch(piano, random, true) });
          events.push({ track: "guitar", time: t + c.beat + 0.02, duration: last ? length : length - 0.1, velocity: last ? 0.6 : 0.55, notes: guitar, ...pluck(guitar) });
          drum(t + c.beat, "kick", last ? 0.8 : 0.6);
          if (last) drum(t + c.beat, "crash", 0.55, 0);
        });
        return;
      }

      // Bass: the line's main notes on 1 and 3, each anticipated an eighth early.
      const mains = line[i];
      const nextMains = next ? line[i + 1] : [null, null];
      const pickups = [mains[1], nextMains[0] ?? mains[0]];
      for (let half = 0; half < 2; half++) {
        const main = mains[half];
        const pickup = pickups[half];
        const mainEvent: NoteEvent | null = main === null ? null : { track: "bass", time: t + half * 2 + clock.at("bass"), duration: 1.4, velocity: human(0.85 * (0.94 + 0.06 * lift), 0.1), notes: [main] };
        if (mainEvent) bassAt(mainEvent);
        bassMains[half] = mainEvent;
        if (pickup === null) continue;
        // In the solos, now and then a half step into a new chord instead of anticipating it
        // (from the side that keeps the line within an octave).
        const newChord = half === 1 && nextMains[0] !== null && nextMains[0] !== mains[0];
        let into = pickup;
        if (newChord && solos && !straight && random() < 0.2) {
          const side = random() < 0.5 ? -1 : 1;
          const fits = (n: number) => n >= BASS_LOW && n <= BASS_HIGH && (main === null || Math.abs(n - main) <= LEAP);
          into = fits(pickup + side) ? pickup + side : fits(pickup - side) ? pickup - side : pickup;
        }
        const pickupEvent: NoteEvent = { track: "bass", time: t + half * 2 + 1.5 + clock.at("bass"), duration: 0.45, velocity: human(0.65 * (0.94 + 0.06 * lift), 0.1), notes: [into] };
        // In the solos the line gets busier, nearer a walk: a chord tone on 2 or 4 between the
        // figure's hits (root, fifth, or the flat fifth on half-diminished), near the notes either
        // side of it (Blue Bossa 1963: about 5.2 notes a bar, beat 4 in 55 to 80% of bars).
        if (solos && !straight && main !== null && mainEvent && random() < (half ? 0.6 : 0.3)) {
          const slot = chordAt(bar, half * 2 + 1)!.chord;
          const cost = (n: number) => Math.abs(n - main) + Math.abs(n - into) + (n === main ? 20 : 0);
          const between = [slot.bass, otherPc(slot, chordAfter(music, i, half * 2 + 1))].map((pc) => placeBass(pc, main, into, null, main)).reduce((a, b) => (cost(b) < cost(a) ? b : a));
          mainEvent.duration = 0.9;
          bassAt({ track: "bass", time: t + half * 2 + 1 + clock.at("bass"), duration: 0.4, velocity: human(0.58 * (0.94 + 0.06 * lift), 0.1), notes: [between] });
        }
        bassAt(pickupEvent);
      }

      // Push: play the next bar's new chord early, on the and of 4, and skip its downbeat.
      const nextChord = next?.chords[0];
      const push = !!nextChord?.attack && !next?.final && nextChord.chord !== bar.chords.at(-1)?.chord && !straight && random() < PUSH[inPhrase];
      const pushTo = push ? chordAfter(music, i + 1, 0) : null;

      // Guitar: the fingers play the two-bar figure, re-voiced at each hit so changes land where they
      // fall; each chord rings until the next hit, never past a change of chord. The thumb plays 1 and
      // 3 on the bass's note, with the fingers when they pluck there; it never anticipates.
      const onsets = bassOnsets(barBass, t);
      /** Where the chord sounding at `beat` stops: the next change in the bar, else the bar's end (the push's and of 4). */
      const changeAfter = (beat: number) => bar.chords.find((c) => c.attack && c.beat > beat + 0.01)?.beat ?? (push ? 3.5 : changesNext ? 4 : 4.5);
      const changesNext = !!nextChord?.attack && nextChord.chord !== bar.chords.at(-1)?.chord;
      const figureHits = GUITAR_FIGURES[figure].bars[cycle].filter(([beat]) => !(push && beat >= 3) && !(pushedIn && beat < 1));
      /** The finger chords of this bar as [beat, notes, time], for the thumb under them. */
      const plucked: [number, number[], NoteEvent][] = [];
      for (const [beat, , velocity] of figureHits) {
        const slot = chordAt(bar, beat);
        if (!slot) continue;
        const at = t + beat + clock.at("guitar");
        guitar = guitarFingers(slot.chord, guitar, { next: chordAfter(music, i, beat), bass: under(beat, 0.5) });
        const event: NoteEvent = { track: "guitar", time: at, duration: 1, velocity: human(velocity * 0.6 * lift, 0.1), notes: guitar, ...pluck(guitar) };
        events.push(event);
        fingers.push({ event, until: t + changeAfter(beat) });
        plucked.push([beat, guitar, event]);
      }
      const thumbFrom = guitar;
      for (const beat of [0, 2]) {
        const slot = chordAt(bar, beat);
        if (!slot) continue;
        const bassNote = bassStruck(onsets, beat, 0.1, null);
        // With the fingers when they pluck on the beat (at the same instant), under the chord sounding then.
        const together = plucked.find(([b]) => Math.abs(b - beat) < 0.01);
        const sounding = together?.[1] ?? plucked.filter(([b]) => b < beat).at(-1)?.[1] ?? thumbFrom ?? guitarFingers(slot.chord, null, { next: chordAfter(music, i, beat) });
        // On the bass's own instant, so the two sound as one note, not a flam; the fingers roll in just behind.
        const time = bassMains[beat / 2]?.time ?? together?.[2].time ?? t + beat + clock.at("guitar");
        const event: NoteEvent = { track: "guitar", time, duration: 1.4, velocity: Math.max(0.05, 0.26 * lift + (hand() - 0.5) * 0.06), notes: [guitarThumb(slot.chord, sounding, bassNote)] };
        events.push(event);
        if (together) {
          const chord = together[2];
          const roll = pluck(chord.notes!, 0.008);
          chord.time = time;
          chord.offsets = roll.offsets;
        }
        thumbs.push({ event, until: t + changeAfter(beat) });
      }
      if (push) {
        guitar = guitarFingers(nextChord!.chord, guitar, { next: pushTo, bass: under(3.5, 1) });
        const event: NoteEvent = { track: "guitar", time: t + 3.5 + clock.at("guitar"), duration: 1, velocity: human(0.52 * lift, 0.1), notes: guitar, ...pluck(guitar) };
        events.push(event);
        // The pushed chord rings into its own bar, until the next hit there.
        fingers.push({ event, until: t + 4 + (next?.chords.find((c) => c.attack && c.beat > 0.01)?.beat ?? 4.5) });
      }

      // Piano: the section's two-bar groove, A B A B through the phrase, the first bar as written and
      // the others now and then moved a little (comping.ts); every hit takes the chord sounding then,
      // so a change inside the bar is played where it falls, and pushes match the guitar's.
      const groove = straight
        ? PIANO_GROOVES[bar.ref?.part === "intro" ? 1 : 0]
        : bar.ref?.part === "intro"
          ? PIANO_GROOVES[1]
          : book.grooveFor(bar.chorus, bar.label, (avoid) => weighted(PIANO_GROOVES.map((f) => ({ weight: forDensity(f, plan.density * (sparse ? 0.75 : 1)), value: f })), random, avoid));
      const settled = straight || plan.role === "head" || plan.role === "outhead" || plan.role === "intro";
      const chances = straight ? { first: 0, middle: 0, last: 0 } : settled ? { first: 0.04, middle: 0.12, last: 0.3 } : { first: 0.08, middle: 0.22, last: 0.4 };
      const hits = layOut ? [] : inBeats(grooveBar(groove, inPhrase, random, chances, { adds: ADDS, busier: plan.density * (sparse ? 0.85 : 1.1), length: 0.6, velocity: 0.42, last: 6 }));
      if (!layOut) for (const c of bar.chords) if (c.attack && c.beat > 0 && !hits.some(([b]) => Math.abs(b - c.beat) < 0.6)) hits.push([c.beat, Math.min(c.length, 0.9), 0.42]);
      hits.sort((a, b) => a[0] - b[0]);
      // How much of the room to the next hit a chord holds: under the guitar's short chords the piano sustains.
      const share = solos ? 0.82 : 0.9;
      hits.forEach(([beat, length, velocity], h) => {
        if (push && beat >= 3) return;
        if (pushedIn && beat < 1) return;
        const slot = chordAt(bar, beat);
        if (!slot) return;
        // Held until about the next hit, never past the next chord change.
        const until = bar.chords.find((c) => c.beat > beat + 0.01)?.beat ?? (push ? 3.5 : changesNext ? 4 : 4.5);
        const gap = (hits[h + 1]?.[0] ?? 4.25) - beat;
        const duration = Math.max(0.4, Math.min(holdLength(length, gap, share), until - beat - 0.08));
        piano = voiceClear(slot.chord, piano, range, chordAfter(music, i, beat), under(beat, duration));
        events.push({ track: "piano", time: t + beat + clock.at("piano"), duration, velocity: human(velocity * lift * pianoGain, 0.12), notes: piano, ...pianoTouch(piano, random, !straight && duration >= 2 && random() < 0.3), ...(duration < 1.2 ? { release: DAMPER } : {}) });
      });
      if (push && !layOut) {
        piano = voiceClear(nextChord!.chord, piano, range, pushTo, under(3.5, 1.4));
        // The pushed chord rings into the bar it belongs to.
        events.push({ track: "piano", time: t + 3.5 + clock.at("piano"), duration: 1.4, velocity: human(0.44 * lift * pianoGain, 0.12), notes: piano, ...pianoTouch(piano, random) });
      }
      pushedIn = push;

      // Drums: light throughout.
      const fillChance = shout ? 0.9 : plan.role === "peak" ? 0.8 : solos ? 0.6 : 0.5;
      const fill = endsSection(bar, next) && !next?.final && (isFormEnd(bar, next) || (!straight && random() < fillChance));
      const bigFill = isFormEnd(bar, next) && !!next;
      const hatEnd = bigFill ? 6 : fill ? 7 : 8; // hats stop for the fill
      // The bridge moves to the ride cymbal from the second chorus, and the whole peak chorus
      // is on the ride, with the hi-hat foot on 2 and 4.
      const ride = !straight && ((bar.contrast && bar.chorus >= 2) || plan.role === "peak");
      const hats = ride ? HAT : HAT_FIGURES[hatFigure].bars[cycle];
      const hatLevel = plan.role === "head" || plan.role === "outhead" || plan.role === "intro" ? 0.94 : 1;
      for (let e = 0; e < hatEnd; e++) if (hats[e] > 0) drum(t + e * 0.5, ride ? "ride" : "hat", (hats[e] + (e % 2 ? ANDS : 0)) * lift * hatLevel * (ride ? 0.85 : 1), 0.16);
      if (ride) [1, 3].forEach((b) => drum(t + b, "pedal", 0.4));
      for (const k of KICK) if (!(bigFill && k.beat >= 3)) drum(t + k.beat, "kick", k.velocity * lift);
      if (!sparse || solos) for (const beat of RIM) if (beat < (bigFill ? 3 : fill ? 3.5 : 4)) drum(t + beat, "rim", 0.5 * lift);

      // A soft crash at the top of each chorus, sometimes at other sections.
      if (i > 0 && prev && endsSection(prev, bar) && (bigFillBefore(prev, bar) || (!straight && random() < (solos ? 0.5 : 0.35)))) drum(t, "crash", bigFillBefore(prev, bar) ? 0.6 : 0.46, 0.05);

      if (bigFill) {
        // Beat 4: soft sixteenths, snare to toms (two variants).
        const sounds: DrumSound[] = straight || random() < 0.5 ? ["snare", "snare", "tomHigh", "tomLow"] : ["rim", "snare", "snare", "tomLow"];
        sounds.forEach((sd, k) => drum(t + 3 + k * 0.25, sd, 0.28 + k * 0.05));
      } else if (fill) {
        // The and of 4: one or two light snare notes, or a short rim-to-snare pickup.
        const r = random();
        if (r < 0.4) drum(t + 3.5, "snare", 0.24);
        else if (r < 0.8) [3.5, 3.75].forEach((b, k) => drum(t + b, "snare", 0.22 + k * 0.06));
        else [3, 3.5, 3.75].forEach((b, k) => drum(t + b, k ? "snare" : "rim", 0.24 + k * 0.04));
      } else if (!straight && shapes[i].phraseEnd && solos && random() < 0.3) {
        drum(t + 3.5, "snare", 0.18); // a light note into the next phrase
      }
    });

    function bigFillBefore(prevBar: TimelineBar, bar: TimelineBar) {
      return isFormEnd(prevBar, bar);
    }

    // The guitar's notes ring as a guitarist's do: a chord until just before the next one (a string
    // plucked again stops first), at most two beats and never past its chord; the thumb until the next thumb note.
    const ring = (list: { event: NoteEvent; until: number }[], most: number) =>
      list.forEach(({ event, until }, k) => {
        const next = list[k + 1]?.event.time ?? Infinity;
        event.duration = Math.max(0.3, Math.min(most, next - event.time - 0.08, until - event.time - 0.06));
      });
    ring(fingers.sort((a, b) => a.event.time - b.event.time), 2);
    ring(thumbs, 1.4);

    return events.sort((a, b) => a.time - b.time);
  },
};
