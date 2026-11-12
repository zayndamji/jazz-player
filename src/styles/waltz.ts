import type { ParsedChord } from "../chart/chords";
import { chordAt, type TimelineBar } from "../engine/timeline";
import { SWING_RANGE, voiceChord, type VoicingRange } from "../engine/voicing";
import { gauss, pianoTouch, timing } from "./feel";
import { seededRandom } from "./random";
import { shapeBars, steadyBars, weighted } from "./shape";
import { endsSection, isFormEnd, nearest, scalePcs, swingRatio, walk } from "./swing";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Jazz waltz, 3/4. Modelled on measured references (context/style-waltz.md): a
 * Band-in-a-Box jazz waltz at 175 BPM, and John Coltrane's quartet and a backing track
 * in its style (167 to 173 BPM):
 * - Bass: in the head, a dotted half on 1, or 1 and 3, or 1 with a pickup on the and of
 *   3; walking quarters in the solos. Over a pedal (a long run of bars on one bass note,
 *   like a vamp written with slash chords) it plays two-bar pedal figures on that note,
 *   its fifth and octave, leaning on the and of 3 into the next bar as the records do.
 * - Piano: comping cells over the bar weighted to 1, the swung and of 1, 2 and 3, with an
 *   anticipation on the and of 3. Minor, major and sus chords take quartal voicings
 *   (stacked fourths from the chord's scale, the sound of the modal records); dominants
 *   and half-diminished chords keep the swing style's rootless voicings. Over a pedal the
 *   piano plays riff cells on the and of 1 and doubles the pedal with an open fifth now and then.
 * - Drums: the ride in figures around a home pattern per chorus ("1, 2 and 3", "1, 2,
 *   3 and", a triplet roll, a two-against-three figure), hi-hat on 2 and 3 or on 2, a
 *   feathered kick on 1 and a kick with the bass on the and of 3, snare comping in the
 *   piano's gaps, triplet fills at phrase, section and form ends, crashes into sections.
 * - The performance arcs and every part sits in its timing pocket, as in swing (feel.ts).
 * - Straight (`Feel.variation`): walking quarters (root and fifth over a pedal), piano on 2
 *   and 3, the "1, 2 and 3" ride every bar; a short fill and a crash only at the end of the form.
 */

const BAR = 3;

/** At and above this tempo the comping thins out and the ride keeps simple. */
const UP = 220;

type Cell = { weight: number; hits: [number, number, number][] };

/** Comping cells as [eighth slot 0 to 5 (swung), length in beats, velocity]; slot 5 (the and of 3) anticipates the next chord. */
const COMP: Cell[] = [
  { weight: 0.17, hits: [[2, 0.5, 0.5], [4, 0.5, 0.48]] }, // 2 and 3
  { weight: 0.09, hits: [[1, 1.1, 0.5]] }, // the and of 1, held
  { weight: 0.08, hits: [[1, 0.45, 0.49], [4, 0.6, 0.48]] }, // and of 1, 3
  { weight: 0.11, hits: [[0, 0.45, 0.48], [2, 0.4, 0.45], [4, 0.4, 0.46]] }, // 1, 2, 3, light
  { weight: 0.1, hits: [[0, 0.6, 0.5], [4, 0.5, 0.48]] }, // 1 and 3
  { weight: 0.08, hits: [[0, 0.7, 0.5], [3, 0.5, 0.48]] }, // 1, and of 2
  { weight: 0.07, hits: [[2, 1.3, 0.48]] }, // 2, held
  { weight: 0.08, hits: [[3, 0.5, 0.48], [5, 0.7, 0.5]] }, // and of 2, and of 3
  { weight: 0.05, hits: [[1, 0.4, 0.48], [3, 0.4, 0.47]] }, // and of 1, and of 2
  { weight: 0.05, hits: [[0, 1.9, 0.48]] }, // held on 1
  { weight: 0.05, hits: [[0, 0.4, 0.48], [1, 0.4, 0.48], [4, 0.5, 0.47]] }, // 1, and of 1, 3
  { weight: 0.05, hits: [[4, 0.4, 0.46], [5, 0.7, 0.5]] }, // 3, and of 3
  { weight: 0.01, hits: [] }, // space
];

/** Over a pedal: riff cells on the and of 1, the vamp's figure. */
const VAMP: Cell[] = [
  { weight: 0.3, hits: [[1, 1.2, 0.56], [4, 0.45, 0.48]] }, // and of 1 held, 3
  { weight: 0.22, hits: [[0, 0.35, 0.46], [1, 0.9, 0.56], [4, 0.5, 0.5]] }, // 1, and of 1, 3
  { weight: 0.18, hits: [[1, 0.4, 0.55], [2, 0.4, 0.5], [4, 0.6, 0.5]] }, // and of 1, 2, 3
  { weight: 0.16, hits: [[0, 0.4, 0.5], [1, 0.5, 0.56], [5, 0.6, 0.5]] }, // 1, and of 1, and of 3
  { weight: 0.14, hits: [[1, 1.8, 0.54]] }, // and of 1, rung through
];

/** Sparse cells for the up tempo. */
const COMP_FAST: Cell[] = [
  { weight: 0.3, hits: [[1, 1.6, 0.5]] },
  { weight: 0.25, hits: [[0, 1.8, 0.48]] },
  { weight: 0.2, hits: [[2, 0.8, 0.48]] },
  { weight: 0.25, hits: [] },
];

const forDensity = (c: Cell, density: number) => c.weight * density ** ((c.hits.length - 2) * 3);

/** Pedal figures as [eighth slot, interval above the pedal (0, 7, 12), length, velocity]; `tie` ends on the and of 3, ringing into the next bar. */
type PedalFigure = { weight: number; hits: [number, number, number, number][]; tie?: boolean };
const PEDAL: PedalFigure[] = [
  { weight: 0.32, hits: [[0, 0, 1.6, 0.86], [5, 0, 0.85, 0.72]], tie: true }, // 1 ... and of 3
  { weight: 0.18, hits: [[0, 0, 0.9, 0.84], [2, 7, 0.9, 0.68], [4, 0, 0.9, 0.72]] }, // root, fifth, root
  { weight: 0.14, hits: [[0, 0, 2.7, 0.86]] }, // the drone
  { weight: 0.2, hits: [[0, 0, 1.3, 0.82], [3, 12, 0.5, 0.62], [4, 7, 0.9, 0.7]] }, // 1, octave on the and of 2, fifth on 3
  { weight: 0.16, hits: [[0, 0, 0.9, 0.84], [2, 12, 0.6, 0.66], [5, 0, 0.8, 0.7]], tie: true }, // 1, octave on 2, and of 3
];
/** After a tie the next bar doesn't strike 1 again. */
const PEDAL_AFTER_TIE: PedalFigure[] = [
  { weight: 0.5, hits: [[2, 7, 0.9, 0.66], [4, 12, 0.6, 0.7], [5, 0, 0.5, 0.6]] }, // fifth on 2, octave on 3, and of 3
  { weight: 0.5, hits: [[2, 0, 0.9, 0.68], [4, 7, 0.9, 0.7]] }, // root on 2, fifth on 3
];

/** Ride figures as [beat, place in the beat, velocity]: 0 on the beat, 1 the swung skip, 2 and 3 the second and third triplet. */
type Ride = { id: string; hits: [number, 0 | 1 | 2 | 3, number][] };
const RIDES: Ride[] = [
  { id: "two-and", hits: [[0, 0, 0.52], [1, 0, 0.62], [1, 1, 0.48], [2, 0, 0.58]] }, // 1, 2 and 3
  { id: "three-and", hits: [[0, 0, 0.52], [1, 0, 0.62], [2, 0, 0.58], [2, 1, 0.52]] }, // 1, 2, 3 and
  { id: "both", hits: [[0, 0, 0.52], [1, 0, 0.62], [1, 1, 0.46], [2, 0, 0.58], [2, 1, 0.5]] }, // 1, 2 and 3 and
  { id: "quarters", hits: [[0, 0, 0.54], [1, 0, 0.6], [2, 0, 0.58]] },
  { id: "roll", hits: [[0, 0, 0.56], [0, 2, 0.28], [0, 3, 0.34], [1, 0, 0.6], [2, 0, 0.56], [2, 1, 0.48]] }, // a triplet roll off 1
  { id: "cross", hits: [[0, 0, 0.6], [0, 1, 0.4], [1, 0, 0.4], [1, 1, 0.56], [2, 0, 0.42], [2, 1, 0.44]] }, // two dotted quarters against the three
  { id: "lead", hits: [[0, 0, 0.52], [0, 1, 0.44], [1, 0, 0.62], [2, 0, 0.58], [2, 1, 0.48]] }, // 1 and, 2, 3 and
  { id: "triplets", hits: [[0, 0, 0.54], [1, 0, 0.6], [1, 2, 0.28], [1, 3, 0.36], [2, 0, 0.58], [2, 3, 0.36]] },
];
/** A phrase end without a fill: rings on 1 and 2 and leaves 3 open. */
const LONG: Ride = { id: "long", hits: [[0, 0, 0.58], [1, 0, 0.6], [1, 1, 0.34]] };

type Hit = [number, DrumSound, number];

/** Snare comping in the piano's gaps, as [beat, sound, velocity]. */
const SNARE: ((sw: number) => Hit[])[] = [
  (sw) => [[sw, "snare", 0.16]],
  (sw) => [[1 + sw, "snare", 0.18]],
  () => [[2 + 1 / 3, "snare", 0.13], [2 + 2 / 3, "snare", 0.2]],
  () => [[1 + 2 / 3, "snare", 0.15], [2, "kick", 0.22]],
  (sw) => [[2 + sw, "snare", 0.2]],
  () => [[1 / 3, "snare", 0.12], [2 / 3, "snare", 0.17]],
];

/** Triplet fills: small on the last beat, medium over the last two, big over the bar. */
function waltzFills(sw: number) {
  const t = (k: number) => k / 3;
  const small: Hit[][] = [
    [[2 + t(1), "snare", 0.26], [2 + t(2), "snare", 0.34]],
    [[2 + sw, "snare", 0.32]],
    [[2, "kick", 0.3], [2 + t(2), "snare", 0.34]],
    [[2, "snare", 0.22], [2 + t(1), "snare", 0.26], [2 + t(2), "tomHigh", 0.34]],
  ];
  const run = (sounds: DrumSound[], from: number): Hit[] => sounds.map((s, k) => [from + t(k), s, 0.26 + (k * 0.2) / sounds.length]);
  const medium: Hit[][] = [
    run(["snare", "snare", "snare", "tomHigh", "tomHigh", "tomLow"], 1),
    run(["snare", "tomHigh", "snare", "tomHigh", "tomLow", "tomLow"], 1),
    run(["kick", "snare", "snare", "kick", "snare", "tomLow"], 1),
  ];
  const big: Hit[][] = [
    run(["snare", "snare", "snare", "snare", "tomHigh", "tomHigh", "tomHigh", "tomLow", "tomLow"], 0),
    run(["snare", "kick", "snare", "tomHigh", "kick", "tomHigh", "tomLow", "kick", "tomLow"], 0),
  ];
  return { small, medium, big };
}

const DRUM_POCKET: Record<DrumSound, "ride" | "hat" | "pedal" | "kick" | "snare" | "fill"> = {
  ride: "ride", hat: "hat", pedal: "pedal", kick: "kick", snare: "snare", rim: "snare",
  tomHigh: "fill", tomLow: "fill", crash: "fill", brush: "snare", brushTap: "snare",
};

const has = (c: ParsedChord, name: string) => c.intervalNames.includes(name);
/** Chords the modal records voice in fourths: minor (not half-diminished), major sevenths and sixths, sus. */
const modal = (c: ParsedChord) => (has(c, "3m") && !has(c, "5d")) || (has(c, "3M") && !has(c, "7m")) || (has(c, "4P") && !has(c, "3M") && !has(c, "3m"));

/**
 * A quartal voicing: three or four notes stacked in fourths (a third on top when the
 * next fourth leaves the scale) from the chord's scale, holding the 3rd or the 7th,
 * placed nearest the previous top note. Returns null when no stack fits.
 */
export function quartal(chord: ParsedChord, previous: number[] | null, range: VoicingRange): number[] | null {
  const scale = new Set(scalePcs(chord));
  const pc = (n: number) => ((n % 12) + 12) % 12;
  const third = pc(chord.root + (has(chord, "3m") ? 3 : has(chord, "3M") ? 4 : 5));
  const seventh = pc(chord.root + (has(chord, "7M") ? 11 : has(chord, "7m") ? 10 : 9));
  const options: number[][] = [];
  for (const start of scale) {
    const stack = [start, start + 5, start + 10];
    if (!stack.every((n) => scale.has(pc(n)))) continue;
    const top = scale.has(pc(start + 15)) ? start + 15 : scale.has(pc(start + 14)) ? start + 14 : scale.has(pc(start + 13)) ? start + 13 : null;
    const notes = top === null ? stack : [...stack, top];
    const pcs = notes.map(pc);
    if (!pcs.includes(third) && !pcs.includes(seventh)) continue;
    if (pcs.includes(pc(chord.root + 1))) continue; // no flat nine on a modal chord
    options.push(notes);
  }
  if (!options.length) return null;
  const target = previous ? previous.reduce((a, n) => a + n, 0) / previous.length : range.center;
  let best: number[] | null = null;
  let bestScore = Infinity;
  for (const o of options) {
    for (let shift = -24; shift <= 36; shift += 12) {
      const notes = o.map((n) => n + 36 + shift);
      if (notes[0] < range.low || notes.at(-1)! > range.high + 2) continue;
      const mid = notes.reduce((a, n) => a + n, 0) / notes.length;
      const score = Math.abs(mid - target) + Math.abs(mid - range.center) * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = notes;
      }
    }
  }
  return best;
}

/** For each bar, the pedal note when it sits in a run of bars on one bass note: eight or more bars, or four or more with a slash chord. */
function pedals(music: TimelineBar[]): (number | null)[] {
  const single = music.map((b) => (b.chords.length && b.chords.every((c) => c.chord.bass === b.chords[0].chord.bass) ? b.chords[0].chord.bass : null));
  const out: (number | null)[] = music.map(() => null);
  for (let i = 0; i < music.length; ) {
    let j = i;
    while (j < music.length && single[j] !== null && single[j] === single[i] && !music[j].final) j++;
    const run = j - i;
    const slash = music.slice(i, j).some((b) => b.chords.some((c) => c.chord.bass !== c.chord.root));
    if (single[i] !== null && (run >= 8 || (run >= 4 && slash))) for (let k = i; k < j; k++) out[k] = single[i];
    i = Math.max(j, i + 1);
  }
  return out;
}

export const waltz: Style = {
  id: "waltz",
  name: "Jazz waltz",
  band: ["bass", "piano", "drums"],
  meters: [3],
  // Like swing (the bass leads, the piano just under it), the cymbals a little more up:
  // the waltz references have them at -23 to -25 dB of the band.
  mix: { bass: 9, piano: 2.5, drums: 4 },
  generate(bars, seed, feel) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const clock = timing(random, feel.tempo);
    const events: NoteEvent[] = [];
    const music = bars.filter((b) => !b.countIn);
    if (!music.length) return events;
    const first = music[0].startBeat;
    /** A time in beats with its pocket, never before the first bar. */
    const place = (time: number, part: Parameters<typeof clock.at>[0]) => Math.max(first, time + clock.at(part));
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: place(time, DRUM_POCKET[sound]), duration: 0.25, velocity: human(velocity, spread) });

    const base = swingRatio(feel.tempo);
    const fast = feel.tempo >= UP;
    const straight = feel.variation === "straight";
    const shapes = straight ? steadyBars(music) : shapeBars(music, random, true);
    const pedalOf = pedals(music);

    let piano: number[] | null = null;
    let bassNote = 40;
    let tied = false;
    let pushedIn = false;
    let lastCell: Cell["hits"] | undefined;
    let lastFill: Hit[] | undefined;
    let ridePrev: Ride | undefined;
    let registerDrift = 0;
    let phraseDb = 0;
    let phraseSlope = 0;
    let crashRide = false;
    let crashAhead = false;
    const homes = new Map<number, { ride: Ride; accent: "one" | "twoThree" | "even"; hat: number[] }>();
    const homeFor = (chorus: number, peak: boolean) => {
      if (!homes.has(chorus)) {
        const ride = fast ? RIDES[0] : weighted([{ weight: 0.35, value: RIDES[0] }, { weight: 0.3, value: RIDES[1] }, { weight: 0.15, value: RIDES[2] }, { weight: 0.2, value: RIDES[4] }], random);
        const accent = weighted<"one" | "twoThree" | "even">([{ weight: 0.4, value: "one" }, { weight: peak ? 0.4 : 0.35, value: "twoThree" }, { weight: 0.25, value: "even" }], random);
        homes.set(chorus, { ride, accent, hat: random() < 0.6 ? [1, 2] : [1] });
      }
      return homes.get(chorus)!;
    };

    music.forEach((bar, i) => {
      const t = bar.startBeat;
      const next = music[i + 1];
      const prev = music[i - 1];
      const { intensity: lift, phraseEnd, plan, shout, inPhrase } = shapes[i];
      clock.bar();
      const sw = straight ? base : Math.min(0.72, Math.max(0.55, base + plan.swing * 0.8 + gauss(random) * 0.006));
      const eighth = (n: number) => Math.floor(n / 2) + (n % 2 ? sw : 0);
      const pedal = pedalOf[i];
      const solo = plan.role === "solo" || plan.role === "peak";

      if (bar.final) {
        const chord = bar.chords[0]?.chord;
        if (!chord) return;
        piano = (modal(chord) && quartal(chord, piano, SWING_RANGE)) || voiceChord(chord, piano, SWING_RANGE);
        events.push({ track: "piano", time: place(t, "piano"), duration: 5, velocity: 0.55, notes: piano, ...pianoTouch(piano, random, true) });
        events.push({ track: "bass", time: t, duration: 4.5, velocity: 0.85, notes: [nearest(chord.bass, bassNote)] });
        drum(t, "kick", 0.7);
        drum(t, "crash", 0.58, 0);
        return;
      }

      // Bass.
      if (pedal !== null) {
        const root = nearest(pedal, 31);
        const figure = straight ? PEDAL[1] : weighted((tied ? PEDAL_AFTER_TIE : PEDAL).map((f) => ({ weight: f.weight * (f.hits.length > 2 && !solo ? 0.7 : 1), value: f })), random);
        for (const [slot, interval, length, velocity] of figure.hits) {
          const note = interval === 12 && root + 12 > 50 ? root : interval === 7 ? nearest((pedal + 7) % 12, root + 5) : root + interval;
          const at = eighth(slot);
          events.push({ track: "bass", time: place(t + at, "bass"), duration: slot === 5 ? length : Math.min(length, BAR - at - 0.05), velocity: human(velocity * lift, 0.08), notes: [note] });
        }
        tied = !!figure.tie && !!next;
        bassNote = root;
      } else {
        tied = false;
        bar.chords.forEach((c, k) => {
          const following = bar.chords[k + 1] ?? next?.chords[0];
          const target = following ? nearest(following.chord.bass, bassNote) : null;
          const at = c.beat;
          if (!solo && !straight && c.length >= 3) {
            // In one: a dotted half, 1 and 3, or 1 with a pickup into the next chord.
            const root = nearest(c.chord.bass, bassNote);
            const kind = weighted([{ weight: 0.4, value: "one" }, { weight: 0.35, value: "three" }, { weight: target !== null ? 0.25 : 0, value: "pickup" }], random);
            const step = has(c.chord, "5d") ? 6 : 7;
            events.push({ track: "bass", time: place(t + at, "bass"), duration: kind === "one" ? 2.85 : kind === "three" ? 1.9 : 2.0, velocity: human(0.84 * lift, 0.08), notes: [root] });
            bassNote = root;
            if (kind === "three") {
              const n = target !== null && random() < 0.5 ? target + (target > root ? -1 : 1) : nearest((c.chord.root + step) % 12, root);
              events.push({ track: "bass", time: place(t + at + 2, "bass"), duration: 0.9, velocity: human(0.72 * lift, 0.08), notes: [n] });
              bassNote = n;
            } else if (kind === "pickup") {
              const n = target! + (target! > root ? -1 : 1);
              events.push({ track: "bass", time: place(t + at + 2 + sw, "bass"), duration: 1 - sw - 0.04, velocity: human(0.62 * lift, 0.08), notes: [Math.max(28, Math.min(50, n))] });
            }
            return;
          }
          if (!solo && !straight) {
            const root = nearest(c.chord.bass, bassNote);
            events.push({ track: "bass", time: place(t + at, "bass"), duration: c.length * 0.9, velocity: human(0.8 * lift, 0.08), notes: [root] });
            bassNote = root;
            return;
          }
          // Walking: quarters, with a skip or a dead note now and then.
          const line = walk(c.chord, c.length, bassNote, target, random, plan.register, 0.55);
          line.forEach((n, b) => {
            const dead = !straight && b > 0 && random() < 0.08;
            const ev: NoteEvent = { track: "bass", time: place(t + at + b, "bass"), duration: dead ? 0.16 : 0.6 + random() * 0.35, velocity: human((b === 0 ? 0.84 : 0.74) * lift * (dead ? 0.62 : 1) + gauss(random) * 0.06, 0.06), notes: [n] };
            events.push(ev);
            if (!straight && !fast && !dead && b < line.length - 1 && random() < (plan.role === "peak" ? 0.16 : 0.1)) {
              ev.duration = sw - 0.06;
              const into = line[b + 1];
              events.push({ track: "bass", time: place(t + at + b + sw, "bass"), duration: 1 - sw - 0.06, velocity: human(0.48 * lift), notes: [Math.max(28, Math.min(50, into + (into > n ? -1 : 1)))] });
            }
          });
          bassNote = line.at(-1)!;
        });
      }

      // Piano.
      if (!straight && inPhrase === 0 && ((bar.ref?.bar ?? 0) % 8 === 0 || random() < 0.5))
        registerDrift = weighted([{ weight: 0.5, value: -2 }, { weight: 1, value: -1 }, { weight: 1.2, value: 0 }, { weight: 1, value: 1 }, { weight: 0.7, value: 2 }, { weight: 0.4, value: 3 }], random, registerDrift);
      const shift = Math.max(-3, Math.min(6, plan.register + registerDrift));
      const range: VoicingRange = { ...SWING_RANGE, low: SWING_RANGE.low + shift, high: SWING_RANGE.high + shift, center: SWING_RANGE.center + shift };
      if (!straight && inPhrase === 0) {
        phraseDb = gauss(random) * 0.6;
        phraseSlope = weighted([{ weight: 0.4, value: 0 }, { weight: 0.35, value: 0.6 }, { weight: 0.25, value: -0.6 }], random);
      }
      const pianoGain = straight ? 1 : 10 ** ((phraseDb + phraseSlope * (inPhrase - 1.5) + gauss(random) * 0.4) / 20);
      const nextChord = next?.chords[0];
      const changes = !!nextChord?.attack && !next?.final && nextChord.chord !== bar.chords.at(-1)?.chord;
      const pool = fast ? COMP_FAST : pedal !== null ? VAMP : COMP;
      const cell = straight ? COMP[0].hits : weighted(pool.map((c) => ({ weight: fast ? c.weight : forDensity(c, plan.density), value: c.hits })), random, lastCell);
      lastCell = cell;
      const legato = plan.role === "peak" ? 1 : solo ? 1.15 : 1.35;
      const pianoBeats: number[] = [];
      let pushes = false;
      cell.forEach(([slot, length, velocity], h) => {
        const beat = eighth(slot);
        if (pushedIn && beat < 0.5) return;
        const ahead = slot === 5 && changes;
        const c = ahead ? nextChord! : chordAt(bar, beat);
        if (!c) return;
        piano = (modal(c.chord) && quartal(c.chord, piano, range)) || voiceChord(c.chord, piano, range);
        const changeAt = ahead ? BAR + nextChord!.length : (bar.chords.find((x) => x.beat > beat + 0.01)?.beat ?? (changes ? BAR - 0.4 : BAR + 1));
        const nextHit = cell[h + 1] ? eighth(cell[h + 1][0]) : BAR + 0.5;
        const duration = Math.max(0.25, Math.min(!straight && random() < 0.3 ? nextHit - beat - 0.05 : length * legato * (0.85 + random() * 0.3), 2.6, changeAt - beat - 0.05));
        let notes = piano;
        // Over a pedal, the left hand doubles the bass note with an open fifth on the riff's first chord.
        if (!straight && pedal !== null && h === 0 && random() < 0.45) {
          const low = 40 + ((pedal - 4 + 12) % 12); // E2 to D#3
          notes = [low, low + 7, ...piano.filter((n) => n > low + 9)];
        }
        events.push({
          track: "piano",
          time: place(t + beat, "piano"),
          duration,
          velocity: human((velocity + (slot % 2 ? 0.04 : 0)) * lift * pianoGain, 0.12),
          notes,
          ...pianoTouch(notes, random, !straight && duration >= 1.5 && random() < 0.3),
        });
        pianoBeats.push(beat);
        if (ahead) pushes = true;
      });
      pushedIn = pushes;

      // Drums.
      const vocab = waltzFills(sw);
      const fill = !straight && endsSection(bar, next) && !next?.final;
      const bigFill = isFormEnd(bar, next) && !!next;
      const smallFill = phraseEnd && random() < (shout ? 0.85 : plan.role === "peak" ? 0.7 : solo ? 0.55 : 0.4);
      const pick = (list: Hit[][]) => {
        const f = weighted(list.map((x) => ({ weight: 1, value: x })), random, lastFill);
        lastFill = f;
        return f;
      };
      const theFill = straight ? (bigFill ? vocab.small[0] : null) : bigFill ? pick(vocab.big) : fill ? pick(vocab.medium) : smallFill ? pick(shout ? vocab.medium : vocab.small) : null;
      const rideEnd = theFill ? Math.max(1, Math.min(...theFill.map(([at]) => at))) : BAR;

      let crash = 0;
      if (crashAhead) crashAhead = false;
      else if (straight) crash = prev && isFormEnd(prev, bar) ? 0.58 : 0;
      else if (prev && endsSection(prev, bar)) crash = isFormEnd(prev, bar) ? 0.62 : random() < 0.55 ? 0.48 : 0;
      else if ((plan.role === "peak" || shout) && inPhrase === 0 && random() < 0.3) crash = 0.4;
      if (crash) {
        drum(t, "crash", crash, 0.05);
        if (crash > 0.4 || random() < 0.5) drum(t, "kick", crash * 0.7);
      }

      const home = straight ? { ride: RIDES[0], accent: "one" as const, hat: [1, 2] } : homeFor(bar.chorus, plan.role === "peak");
      let ride: Ride;
      if (straight) ride = RIDES[0];
      else if (fast) ride = random() < 0.7 ? RIDES[0] : RIDES[3];
      else if (phraseEnd && !theFill && random() < 0.25) ride = LONG;
      else if (random() < (ridePrev && ridePrev !== home.ride ? 0.36 : 0.22)) ride = home.ride;
      else ride = weighted(RIDES.filter((r) => r !== home.ride && r !== ridePrev).map((r) => ({ weight: r.id === "quarters" ? 0.1 : 0.2, value: r })), random);
      ridePrev = ride;
      if (inPhrase === 0) crashRide = !straight && !fast && (plan.role === "peak" || shout) && random() < 0.25;
      const level = (fast ? 0.95 : plan.role === "peak" ? 1.08 : solo ? 1 : 0.92) * lift;
      const edge = !straight && !fast && inPhrase === 0 && random() < 0.35 ? 0 : -1;
      for (const [b, kind, v] of ride.hits) {
        const at = b + (kind === 1 ? sw : kind === 2 ? 1 / 3 : kind === 3 ? 2 / 3 : 0);
        if (at >= rideEnd - 0.01 || (crash && at < 0.01)) continue;
        const accent = kind ? v : home.accent === "even" ? 0.57 : home.accent === "twoThree" ? (b === 0 ? v * 0.88 : v * 1.06) : b === 0 ? v * 1.12 : v;
        const hit = accent * level * (kind === 0 && b === edge ? 1.3 : 1);
        if (crashRide) drum(t + at, "crash", hit * (kind ? 0.45 : 0.6), 0.1);
        else drum(t + at, "ride", hit, 0.22);
      }
      for (const b of home.hat) drum(t + b, "pedal", b === 1 ? 0.48 : 0.42, 0.12);
      // Feathered kick on 1; with the bass on the and of 3 when it pushes into the bar.
      if (straight) {
        if (!crash) drum(t, "kick", 0.15, 0.06);
      } else if (!crash && random() < 0.65) drum(t, "kick", (solo ? 0.17 : 0.13) * (0.8 + random() * 0.4), 0.06);
      const bassPushes = pedal !== null && tied;
      if (!straight && !theFill && random() < (bassPushes ? (solo ? 0.45 : 0.2) : solo ? 0.08 : 0.03)) drum(t + 2 + sw, "kick", 0.3 + random() * 0.08);
      if (!theFill) {
        const chance = straight ? 0 : (fast ? 0.25 : 0.4) * plan.density * lift * lift;
        for (let n = 0; n < (plan.role === "peak" ? 2 : 1); n++) {
          if (random() >= chance * (n ? 0.5 : 1)) continue;
          for (const [at, sound, v] of SNARE[Math.floor(random() * SNARE.length)](sw)) {
            if (pianoBeats.some((p) => Math.abs(p - at) < 0.12) && random() < 0.6) continue;
            drum(t + at, sound, v * (0.9 + 0.3 * (lift - 0.9)), 0.06);
          }
        }
      } else for (const [at, sound, velocity] of theFill) drum(t + at, sound, velocity * (0.9 + 0.2 * (lift - 0.9)));
      if (!straight && pushes && next && endsSection(bar, next) && !next.final && random() < 0.4) {
        drum(t + 2 + sw, "kick", 0.42);
        drum(t + 2 + sw, "crash", isFormEnd(bar, next) ? 0.6 : 0.48, 0.05);
        crashAhead = true;
      }
    });

    return events.sort((a, b) => a.time - b.time);
  },
};
