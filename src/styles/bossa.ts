import type { ParsedChord } from "../chart/chords";
import { chordAt, type TimelineBar } from "../engine/timeline";
import { GUITAR_RANGE, PIANO_RANGE, voicingIntervals, type VoicingRange } from "../engine/voicing";
import { BASS_HIGH, BASS_LOW, bassUnder, chordAfter, endsSection, isFormEnd, shifted, voiceClear } from "./context";
import { drumGain, gauss, pianoTouch, timing } from "./feel";
import { seededRandom } from "./random";
import { shapeBars, steadyBars, weighted } from "./shape";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Bossa nova, straight eighths, in a two-bar cycle. The patterns follow a
 * measured Band-in-a-Box bossa track (context/reference-backing-track.md):
 * - Bass: 1, and of 2, 3, and of 4. The eighths anticipate the next note.
 * - Guitar: short syncopated chords on a two-bar figure, picked per cycle from a
 *   few variations, Gilberto's 1, 2, 3, and of 3, and of 4 among them. It leads the
 *   comping, as on the Getz/Gilberto records (context/original-records.md).
 * - Piano: under the guitar and light: its own sparse two-bar figure of medium-length
 *   chords, so the comping has two voices that answer each other. With the chart's
 *   `comp: "sparse"` it lays out for most of the heads, as Jobim does under the voice,
 *   and plays fewer chords in the solos. A tune whose record has no guitar (Henderson's
 *   Blue Bossa) leaves it out with the chart's `band` and puts the piano back up.
 * - Pushes: about half the chord changes are anticipated on the and of 4, by
 *   guitar and piano together, so they never play different chords at once.
 * - Drums: light. Straight eighths on the hi-hat, the ands nearly as strong as the beats
 *   and 2 and 4 accented, a soft kick with the bass, cross-stick on 2 and 4 (with `comp:
 *   "sparse"` only in the solos, as on the vocal records), a short fill at most section ends and
 *   at the end of the form, a soft crash at the top of a chorus, the ride cymbal in
 *   the bridge from the second chorus.
 * - Dynamics and texture follow the chorus plan (`shapeBars` with its arc): the head on
 *   lighter hats, the solos building to a peak on the ride, the out-head back on the hats.
 *   The hats play two-bar figures around a home figure picked per chorus.
 * - The piano's register and figures move with the chorus, and it sometimes recalls
 *   what it played at the same place in the form.
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
 * Guitar figures, two bars each. The first follows the reference track and is
 * played most often; the others vary it so choruses don't repeat exactly.
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

/** Chance that guitar and piano push a chord change to the and of 4. */
const PUSH = 0.45;

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

/**
 * Piano figures, two bars each, as [beat, length, velocity]: fewer and longer hits
 * than the guitar's, placed between them (the references' comping band hits 1, the
 * and of 1, 2, 3, the and of 3 and 4 between the two instruments).
 */
const PIANO_FIGURES: { weight: number; value: Hit[][] }[] = [
  { weight: 0.4, value: [[[0, 1.4, 0.46], [2.5, 1.3, 0.42]], [[1, 1.4, 0.44], [3, 0.9, 0.4]]] },
  { weight: 0.3, value: [[[0, 3.3, 0.44]], [[1.5, 2.3, 0.42]]] },
  { weight: 0.3, value: [[[0, 0.9, 0.46], [1.5, 0.9, 0.4], [3, 0.9, 0.42]], [[0.5, 1.2, 0.42], [2.5, 1.3, 0.44]]] },
  { weight: 0.2, value: [[[0.5, 1.2, 0.44], [2, 1.4, 0.42]], [[0, 1.2, 0.44], [2.5, 1.3, 0.42]]] },
  { weight: 0.2, value: [[[0, 0.8, 0.44], [1, 0.6, 0.4], [2.5, 1.2, 0.44]], [[1.5, 0.9, 0.42], [3, 0.8, 0.4]]] },
  { weight: 0.15, value: [[[1, 2.4, 0.42]], [[0, 1.4, 0.44], [2.5, 1.3, 0.42]]] },
  { weight: 0.15, value: [[[0, 0.6, 0.44], [1.5, 0.6, 0.42], [2.5, 0.6, 0.42], [3.5, 0.5, 0.4]], [[1, 0.6, 0.42], [2, 0.8, 0.44], [3, 0.8, 0.4]]] },
];

/** A figure's weight for the chorus: busier figures when the band builds, sparser in the head. */
const forDensity = (f: { weight: number; value: Hit[][] }, density: number) => f.weight * density ** ((f.value.flat().length - 3.5) * 2.5);

/** The line leans back toward A#1 so the roots stay low, where the old fixed roots sat (E1 to D#2). */
const BASS_HOME = 34;
/** The widest leap between two bass notes: an octave. */
const LEAP = 12;

/**
 * The bass note of pitch class `pc` nearest `from` (and `to`, when given), never more than an
 * octave from either, leaning toward `home`; `avoid` (a repeated note) is taken only when nothing else fits.
 */
function placeBass(pc: number, from: number, to: number | null = null, home: number | null = BASS_HOME, avoid: number | null = null): number {
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
function otherPc(chord: ParsedChord, next: ParsedChord | null): number {
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
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const clock = timing(random, feel?.tempo ?? 150);
    const pocket: Record<DrumSound, "hat" | "ride" | "kick" | "snare" | "pedal" | "fill"> = {
      hat: "hat", ride: "ride", kick: "kick", rim: "snare", snare: "snare", pedal: "pedal", crash: "fill", tomHigh: "fill", tomLow: "fill", brush: "snare", brushTap: "snare",
    };
    const events: NoteEvent[] = [];
    // The chorus's drum level (feel.ts `ChorusPlan.drums`), as a gain that leaves the sample layer alone.
    let drumLevel = 1;
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: time + clock.at(pocket[sound]), duration: 0.25, velocity: human(velocity, spread), gain: drumLevel });

    let piano: number[] | null = null;
    let guitar: number[] | null = null;
    let figure = 0;
    let pianoFigure = PIANO_FIGURES[0].value;
    let pushedIn = false; // this bar's first chord was already played on the and of 4
    const music = bars.filter((b) => !b.countIn);
    const straight = feel?.variation === "straight";
    const pick = () => {
      let r = random();
      for (let f = 0; f < GUITAR_FIGURES.length; f++) if ((r -= GUITAR_FIGURES[f].weight) < 0) return f;
      return 0;
    };
    const shapes = straight ? steadyBars(music) : shapeBars(music, random, true);
    const line = bassLine(music);
    // The hats' home figure per chorus; the piano's figures by place in the form.
    const hatHome = new Map<number, number>();
    const memory = new Map<string, Hit[][]>();
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
        pianoFigure = PIANO_FIGURES[bar.ref?.part === "intro" ? 1 : 0].value;
        hatFigure = 0;
      } else if (cycle === 0) {
        figure = bar.ref?.part === "intro" ? SPARSE : pick();
        const place = bar.ref ? `${bar.ref.part}.${bar.ref.section}.${bar.ref.bar}` : "";
        const recalled = bar.chorus >= 2 ? memory.get(place) : undefined;
        // Sparse: the piano lays out for most of the head (two bars at a time) and comps less in the solos.
        layOut = sparse && !solos && random() < 0.65;
        pianoFigure =
          bar.ref?.part === "intro"
            ? PIANO_FIGURES[1].value
            : recalled && recalled !== pianoFigure && random() < 0.3
              ? recalled
              : weighted(PIANO_FIGURES.map((f) => ({ weight: forDensity(f, plan.density * (sparse ? 0.75 : 1)), value: f.value })), random, pianoFigure);
        if (place) memory.set(place, pianoFigure);
        if (!hatHome.has(bar.chorus)) hatHome.set(bar.chorus, weighted(HAT_FIGURES.map((f, k) => ({ weight: k === 0 ? 0.6 : f.weight, value: k })), random));
        const home = hatHome.get(bar.chorus)!;
        // The intro keeps the plain figure; elsewhere mostly the home figure, sometimes another.
        hatFigure = bar.ref?.part === "intro" ? 0 : random() < 0.38 ? home : weighted(HAT_FIGURES.map((f, k) => ({ weight: f.weight, value: k })), random, hatFigure === home ? home : hatFigure);
      }
      // The piano's register moves with the chorus, drifts by phrase and a little by bar (the
      // references spread it 3.2 to 4.7 dB bar to bar); its level holds, swells or falls back
      // over each four bars (their mid band varies 3.2 to 4.5 dB).
      const inPhrase = (bar.ref?.bar ?? i) % 4;
      if (!straight && inPhrase === 0) {
        if ((bar.ref?.bar ?? 0) % 8 === 0 || random() < 0.5)
          registerDrift = weighted([{ weight: 0.5, value: -3 }, { weight: 0.8, value: -1 }, { weight: 1.2, value: 0 }, { weight: 1, value: 2 }, { weight: 0.6, value: 4 }], random, registerDrift);
        phraseDb = gauss(random) * 1.1;
        phraseSlope = weighted([{ weight: 0.4, value: 0 }, { weight: 0.35, value: 1.1 }, { weight: 0.25, value: -1.1 }], random);
      }
      const shift = straight ? 0 : Math.max(-3, Math.min(7, plan.register + registerDrift + weighted([{ weight: 0.25, value: -2 }, { weight: 0.5, value: 0 }, { weight: 0.25, value: 2 }], random)));
      const pianoGain = straight ? 1 : 10 ** ((phraseDb + phraseSlope * (inPhrase - 1.5) + gauss(random) * 1.1) / 20);
      const range: VoicingRange = shifted(PIANO_RANGE, shift);

      const barBass: NoteEvent[] = [];
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
          guitar = voiceClear(c.chord, guitar, GUITAR_RANGE, after, n);
          events.push({ track: "piano", time: t + c.beat, duration: last ? length : length - 0.1, velocity: last ? 0.5 : 0.46, notes: piano, ...pianoTouch(piano, random, true) });
          events.push({ track: "guitar", time: t + c.beat + 0.02, duration: last ? length : length - 0.1, velocity: last ? 0.6 : 0.55, notes: guitar });
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
      const push = !!nextChord?.attack && !next?.final && nextChord.chord !== bar.chords.at(-1)?.chord && !straight && random() < PUSH;
      const pushTo = push ? chordAfter(music, i + 1, 0) : null;

      // Guitar: the two-bar figure, re-voiced at each hit so changes land where they fall.
      for (const [beat, length, velocity] of GUITAR_FIGURES[figure].bars[cycle]) {
        if (push && beat >= 3) continue;
        if (pushedIn && beat < 1) continue;
        const slot = chordAt(bar, beat);
        if (!slot) continue;
        guitar = voiceClear(slot.chord, guitar, GUITAR_RANGE, chordAfter(music, i, beat), under(beat, length * 0.85));
        events.push({ track: "guitar", time: t + beat + clock.at("guitar"), duration: length * 0.85, velocity: human(velocity * 0.55 * lift, 0.1), notes: guitar });
      }
      if (push) {
        guitar = voiceClear(nextChord!.chord, guitar, GUITAR_RANGE, pushTo, under(3.5, 1));
        events.push({ track: "guitar", time: t + 3.5 + clock.at("guitar"), duration: 0.8, velocity: human(0.48 * lift, 0.1), notes: guitar });
      }

      // Piano: its own two-bar figure; every hit takes the chord sounding then, so a change
      // inside the bar is played where it falls, and pushes match the guitar's.
      const hits = layOut ? [] : [...pianoFigure[cycle]];
      if (!layOut) for (const c of bar.chords) if (c.attack && c.beat > 0 && !hits.some(([b]) => Math.abs(b - c.beat) < 0.6)) hits.push([c.beat, Math.min(c.length, 1.5), 0.42]);
      for (const [beat, length, velocity] of hits) {
        if (push && beat >= 3) continue;
        if (pushedIn && beat < 1) continue;
        const slot = chordAt(bar, beat);
        if (!slot) continue;
        // Don't ring past the next chord change.
        const until = bar.chords.find((c) => c.beat > beat + 0.01)?.beat ?? (push ? 3.5 : 4.5);
        const duration = Math.max(0.4, Math.min(length, until - beat) - 0.1);
        piano = voiceClear(slot.chord, piano, range, chordAfter(music, i, beat), under(beat, duration));
        events.push({ track: "piano", time: t + beat + clock.at("piano"), duration, velocity: human(velocity * lift * pianoGain, 0.12), notes: piano, ...pianoTouch(piano, random, !straight && duration >= 2 && random() < 0.3) });
      }
      if (push && !layOut) {
        piano = voiceClear(nextChord!.chord, piano, range, pushTo, under(3.5, 1.4));
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

    return events.sort((a, b) => a.time - b.time);
  },
};
