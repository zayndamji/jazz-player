import type { ParsedChord } from "../chart/chords";
import { chordAt, type TimelineBar } from "../engine/timeline";
import { SWING_RANGE, VOICING_LOW } from "../engine/voicing";
import { placeBass } from "./bossa";
import { BASS_HIGH, BASS_LOW, bassOnsets, bassStruck, chordAfter, endsSection, isFormEnd, keepInRange, moveOn, shifted, type VoicingContext } from "./context";
import { DAMPER } from "./comping";
import { drumGain, drumTalk, pianoTouch, timing } from "./feel";
import { seededRandom } from "./random";
import { shapeBars, steadyBars, weighted } from "./shape";
import type { DrumSound, NoteEvent, Style } from "./types";
import { voiceFor } from "./waltz";

/**
 * Latin waltz, 3/4 in straight eighths: a two-bar figure that lilts two against three, as on
 * Yusef Lateef's "Love Theme from Spartacus" (Eastern Sounds, 1961; Barry Harris, Ernie Farrow,
 * Lex Humphries), measured on its separated stems (context/style-latin-waltz.md).
 * Bars pair up from each section's first bar; eighth slots are 0 to 5 (1, and of 1, 2, and of 2, 3, and of 3).
 * - Bass: roots in one octave. The first bar of a pair plays 1 and 3; the second 1, the and of 2
 *   (the two dotted quarters) and the and of 3, which anticipates the next bar's root (now and
 *   then a whole or half step under it). The head plays the second figure in most pairs, not all.
 *   A chord on beat 3 takes beat 3 (or the and of 2, anticipated); three chords each take their beat.
 * - Piano: the ostinato on the and of 1 and beat 3, every bar, the chord held between; in the
 *   head, held chords on 1 (or the and of 1) with a soft hit on 3 now and then. In the solos it
 *   strolls for about a third of the four-bar phrases, as Barry Harris does. Quartal voicings on
 *   the modal chords, as the waltz.
 * - Drums: the ride in the record's two-bar figure (1, and of 1, 2, and of 2, 3 | 1, 2, and of 2,
 *   3, and of 3, the last accented), the cross-stick answering on the and of 1 and 3, then on 2
 *   and the and of 3; the kick with the bass's second-bar figure; in the head the ride on the
 *   beats with 2 accented. Eighth-note tom fills at section ends, a crash into some sections.
 * - Straight (`Feel.variation`): the two-bar figure every pair, the piano ostinato every bar; a
 *   short fill and a crash only at the end of the form.
 */

const BAR = 3;

/** The bar's place in its pair, counted from its section's first bar: 0 the first bar, 1 the second. */
export const pairOf = (bar: TimelineBar, i: number) => (bar.ref?.bar ?? i) % 2;

type Hits = [number, number][];
/** The ride per bar of the pair, [eighth slot, velocity], as measured in the record's solos (the and of 3 of the second bar strongest). */
export const RIDE: Hits[] = [
  [[0, 0.5], [1, 0.54], [2, 0.56], [3, 0.42], [4, 0.5]],
  [[0, 0.58], [2, 0.6], [3, 0.42], [4, 0.36], [5, 0.7]],
];
/** The head's lighter ride: the beats, 2 accented, and the and of 3 in the second bar. */
const RIDE_HEAD: Hits[] = [
  [[0, 0.46], [2, 0.58], [4, 0.44]],
  [[0, 0.46], [2, 0.58], [4, 0.38], [5, 0.46]],
];
/** Every eighth, the record's accents kept: for a building solo chorus. */
const RIDE_EIGHTHS: Hits[] = [
  [[0, 0.52], [1, 0.5], [2, 0.56], [3, 0.4], [4, 0.5], [5, 0.34]],
  [[0, 0.58], [1, 0.34], [2, 0.6], [3, 0.42], [4, 0.38], [5, 0.64]],
];
/** The cross-stick's answers: the and of 1 and 3, then 2 and the and of 3. */
export const STICK: Hits[] = [
  [[1, 0.32], [4, 0.3]],
  [[2, 0.33], [5, 0.36]],
];
const STICK_HEAD: Hits[] = [[[2, 0.26]], [[2, 0.27], [5, 0.24]]];

type Hit = [number, DrumSound, number];
/** Comping figures in the spells (feel.ts `drumTalk`), as [eighth slot, sound, velocity]. */
const TALK: Hit[][] = [
  [[3, "tomLow", 0.26]],
  [[5, "snare", 0.22]],
  [[1, "tomLow", 0.24], [3, "tomLow", 0.22]],
  [[4, "snare", 0.2], [5, "tomHigh", 0.24]],
];
/** Straight eighth fills: small on the last beat, medium over the last two, big over the bar. */
const SMALL: Hit[][] = [
  [[4, "tomHigh", 0.3], [5, "tomLow", 0.34]],
  [[5, "snare", 0.32]],
  [[4, "snare", 0.26], [5, "tomLow", 0.34]],
];
const run = (sounds: DrumSound[], from: number): Hit[] => sounds.map((s, k) => [from + k, s, 0.26 + (k * 0.12) / sounds.length]);
const MEDIUM: Hit[][] = [run(["snare", "snare", "tomHigh", "tomLow"], 2), run(["tomHigh", "tomHigh", "tomLow", "tomLow"], 2), run(["snare", "tomHigh", "snare", "tomLow"], 2)];
const BIG: Hit[][] = [run(["snare", "snare", "snare", "tomHigh", "tomHigh", "tomLow"], 0), run(["tomHigh", "snare", "tomHigh", "tomLow", "snare", "tomLow"], 0)];

const POCKET: Record<DrumSound, "ride" | "hat" | "pedal" | "kick" | "snare" | "fill"> = {
  ride: "ride", bell: "ride", hat: "hat", pedal: "pedal", kick: "kick", snare: "snare", rim: "snare",
  tomHigh: "fill", tomLow: "fill", crash: "fill", brush: "snare", brushTap: "snare",
};

type Figure = "one-three" | "push";

export const latinWaltz: Style = {
  id: "latin-waltz",
  name: "Latin waltz",
  band: ["bass", "piano", "drums"],
  meters: [3],
  // Matched to the record's bass, drums and piano stems mixed without the oboe (solos, band share within 2 dB);
  // the piano plays soft, so its tone stays as dark as the 1961 record's.
  mix: { bass: 9, piano: 1.5, drums: 4 },
  generate(bars, seed, feel) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const clock = timing(random, feel.tempo);
    const events: NoteEvent[] = [];
    const music = bars.filter((b) => !b.countIn);
    if (!music.length) return events;
    const first = music[0].startBeat;
    const place = (time: number, part: Parameters<typeof clock.at>[0]) => Math.max(first, time + clock.at(part));
    let drumLevel = 1;
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: place(time, POCKET[sound]), duration: 0.25, velocity: human(velocity, spread), gain: drumLevel });

    const straight = feel.variation === "straight";
    const shapes = straight ? steadyBars(music) : shapeBars(music, random, true);
    const talk = drumTalk(random);

    let piano: number[] | null = null;
    let runs = 0;
    let lastBass = 40;
    let ringing = 40;
    let stroll = false;
    let pushedIn = false;
    let lastFill: Hit[] | undefined;
    /** The chord sounding, for a bar that only holds it ("/ /"). */
    let held: ParsedChord | null = null;
    const rides = new Map<number, Hits[]>();
    const rideFor = (chorus: number, peak: boolean) => {
      if (!rides.has(chorus)) rides.set(chorus, weighted([{ weight: 0.7, value: RIDE }, { weight: peak ? 0.45 : 0.2, value: RIDE_EIGHTHS }], random));
      return rides.get(chorus)!;
    };

    music.forEach((bar, i) => {
      const t = bar.startBeat;
      const next = music[i + 1];
      const prev = music[i - 1];
      const { intensity: lift, inPhrase, phraseEnd, plan, shout } = shapes[i];
      drumLevel = drumGain(bar, plan);
      clock.bar();
      const pair = pairOf(bar, i);
      const solo = plan.role === "solo" || plan.role === "peak";
      const intro = bar.ref?.part === "intro";
      // The ostinato plays in the solos and the intro (the record's intro already has it); the head is lighter.
      const groove = straight || solo || intro;

      if (bar.final) {
        // Each chord of the last bar on its beat, the last held like a fermata, with a crash.
        bar.chords.forEach((c, k) => {
          const end = k === bar.chords.length - 1;
          const at = t + c.beat;
          const low = (lastBass = placeBass(c.chord.bass, lastBass));
          const range = shifted(SWING_RANGE, 0, VOICING_LOW);
          const context = { next: bar.chords[k + 1]?.chord ?? null, bass: low };
          const voiced = voiceFor(c.chord, piano, range, context);
          piano = moveOn(voiced, piano, runs >= 3, (from) => voiceFor(c.chord, from, range, context));
          events.push({ track: "piano", time: place(at, "piano"), duration: end ? 5 : c.length - 0.05, velocity: end ? 0.55 : 0.5, notes: piano, ...pianoTouch(piano, random, end) });
          events.push({ track: "bass", time: at, duration: end ? 4.5 : c.length - 0.05, velocity: 0.85, notes: [low] });
          drum(at, "kick", end ? 0.7 : 0.4);
          if (end) drum(at, "crash", 0.58, 0);
        });
        return;
      }

      // Bass.
      const bassFrom = events.length;
      const bass = (beat: number, note: number, length: number, velocity: number) =>
        events.push({ track: "bass", time: place(t + beat, "bass"), duration: length, velocity: human(velocity * (0.94 + 0.06 * lift), 0.08), notes: [note] });
      const nextFirst = next && !next.final ? chordAt(next, 0) : undefined;
      const onThree = bar.chords.find((c) => c.attack && Math.abs(c.beat - 2) < 0.01);
      const odd = bar.chords.some((c) => c.attack && c.beat > 0.01 && Math.abs(c.beat - 2) > 0.01);
      let figure: Figure = pair === 1 ? "push" : "one-three";
      if (!groove && pair === 1 && random() < 0.3) figure = "one-three";
      if (odd) {
        // Three chords, or one on beat 2: each root on its beat.
        for (const c of bar.chords) bass(c.beat, (lastBass = placeBass(c.chord.bass, lastBass)), Math.max(0.45, c.length - 0.1), c.beat ? 0.76 : 0.84);
      } else {
        const one = chordAt(bar, 0)?.chord ?? held ?? bar.chords[0]?.chord;
        if (!one) return;
        const root = (lastBass = placeBass(one.bass, lastBass));
        const three = onThree ? placeBass(onThree.chord.bass, root) : root;
        // Where the next bar's root goes: anticipated on the and of 3, now and then from a step under it.
        const into = () => {
          if (!nextFirst) return root;
          const goal = placeBass(nextFirst.chord.bass, three);
          const step = straight ? 0 : weighted([{ weight: 0.82, value: 0 }, { weight: 0.12, value: -2 }, { weight: 0.06, value: -1 }], random);
          return goal + step >= BASS_LOW && goal + step <= BASS_HIGH ? goal + step : goal;
        };
        if (figure === "push") {
          bass(0, root, 1.4, 0.84);
          bass(1.5, onThree ? three : root, 0.95, 0.74);
          const n = into();
          bass(2.5, n, 0.45, 0.72);
          lastBass = n;
        } else {
          const approach = !straight && !!nextFirst && random() < (groove ? 0.15 : 0.1);
          bass(0, root, 1.9, 0.84);
          bass(2, three, approach ? 0.45 : 0.9, 0.72);
          lastBass = three;
          if (approach) bass(2.5, (lastBass = into()), 0.45, 0.66);
        }
      }
      held = bar.chords.at(-1)?.chord ?? held;
      const bassHere = bassOnsets(events.slice(bassFrom), t);
      const bassAt = (beat: number) => bassStruck(bassHere, beat, 0.1, ringing);
      ringing = bassHere.at(-1)?.[1] ?? ringing;

      // Piano.
      if (!straight && solo && inPhrase === 0) stroll = plan.role !== "peak" && random() < 0.3;
      if (!solo) stroll = false;
      const range = shifted(SWING_RANGE, straight ? 0 : Math.max(-2, Math.min(5, plan.register)), VOICING_LOW);
      const changes = !!nextFirst && nextFirst.attack && nextFirst.chord !== bar.chords.at(-1)?.chord;
      // [eighth slot, length, velocity].
      let cell: [number, number, number][];
      if (groove) {
        cell = [[1, 1.4, 0.44], [4, 0.9, 0.4]];
        if (!straight) {
          if (random() < 0.1) cell = [[1, 2.4, 0.44]];
          else if (random() < 0.12) cell.splice(1, 0, [2, 0.45, 0.37]);
          if (pair === 1 && changes && random() < 0.25) cell[cell.length - 1] = [5, 1, 0.44];
        }
      } else {
        // Under the melody: a chord on 1 (or the and of 1), and in most bars a second, softer one later in
        // the bar; the record's head piano spreads its hits over the bar.
        const start = pair === 0 && random() < 0.4 ? 1 : 0;
        cell = [[start, 2.6, 0.41]];
        if (random() < 0.6) cell.push(changes && random() < 0.4 ? [5, 1, 0.39] : [weighted([{ weight: start ? 0 : 0.6, value: 2 }, { weight: 1, value: 3 }, { weight: 1, value: 4 }], random), 1, 0.36]);
      }
      if (stroll) cell = [];
      let pushes = false;
      cell.forEach(([slot, length, velocity], h) => {
        const beat = slot / 2;
        if (pushedIn && beat < 0.5) return;
        const ahead = slot === 5 && changes;
        const found = ahead ? nextFirst! : chordAt(bar, beat);
        const c = found ?? (held ? { chord: held, beat: 0, length: BAR, attack: false } : undefined);
        if (!c) return;
        const context: VoicingContext = ahead ? { next: chordAfter(music, i + 1, 0, 2, 0.01), bass: placeBass(c.chord.bass, lastBass) } : { next: chordAfter(music, i, beat, 2, 0.01), bass: bassAt(beat) };
        const last = piano;
        const voiced = voiceFor(c.chord, last, range, context);
        const repeat = !!last && voiced.join() === last.join();
        piano = moveOn(voiced, last, repeat && (runs >= 3 || (!straight && runs >= 2 && random() < 0.4)), (from) => voiceFor(c.chord, from, range, context));
        runs = last && piano.join() === last.join() ? runs + 1 : 1;
        // Held until the next hit or chord change, never past it.
        const change = ahead ? BAR + nextFirst!.length : (bar.chords.find((x) => x.attack && x.beat > beat + 0.01)?.beat ?? (changes ? BAR : BAR + 1));
        const nextHit = cell[h + 1] ? cell[h + 1][0] / 2 : BAR + 0.5;
        const duration = Math.max(0.3, Math.min(length, nextHit - beat - 0.05, change - beat - 0.05));
        events.push({
          track: "piano",
          time: place(t + beat, "piano"),
          duration,
          velocity: human(velocity * lift, 0.1),
          notes: piano,
          ...pianoTouch(piano, random, !groove && duration >= 1.5),
          ...(duration < 1.2 ? { release: DAMPER } : {}),
        });
        if (ahead) pushes = true;
      });
      pushedIn = pushes;

      // Drums.
      const formEnd = isFormEnd(bar, next) && !!next;
      const sectionEnd = endsSection(bar, next) && !next?.final;
      const pick = (list: Hit[][]) => (lastFill = weighted(list.map((x) => ({ weight: 1, value: x })), random, lastFill));
      let fill: Hit[] | null = null;
      if (straight) fill = formEnd ? SMALL[0] : null;
      else if (formEnd) fill = pick(solo && random() < 0.4 ? MEDIUM : BIG);
      else if (sectionEnd) fill = random() < (shout ? 0.9 : solo ? 0.6 : 0.4) ? pick(MEDIUM) : random() < 0.5 ? pick(SMALL) : null;
      else if (phraseEnd && random() < (solo ? 0.25 : 0.12)) fill = pick(SMALL);
      const stopAt = fill ? Math.min(...fill.map(([slot]) => slot)) : 6;

      let crash = 0;
      if (prev && !intro && endsSection(prev, bar)) crash = isFormEnd(prev, bar) ? 0.6 : !straight && random() < (solo ? 0.45 : 0.25) ? 0.48 : 0;
      if (crash) {
        drum(t, "crash", crash, 0.05);
        drum(t, "kick", crash * 0.75);
      }
      const level = (plan.role === "peak" ? 1.06 : solo ? 1 : 0.94) * lift;
      const ride = straight || solo ? (straight ? RIDE : rideFor(bar.chorus, plan.role === "peak")) : RIDE_HEAD;
      for (const [slot, v] of ride[pair]) {
        if (slot >= stopAt || (crash && slot === 0)) continue;
        // Now and then a weak stroke drops out, as a drummer's hand breathes.
        if (!straight && v < 0.45 && random() < 0.12) continue;
        drum(t + slot / 2, "ride", v * level, 0.12);
      }
      for (const [slot, v] of (straight || groove ? STICK : STICK_HEAD)[pair]) if (slot < stopAt) drum(t + slot / 2, "rim", v * level, 0.08);
      // The hi-hat foot on the dotted quarters (not measured: the stems can't tell it from the ride).
      for (const slot of [0, 3]) drum(t + slot / 2, "pedal", 0.3, 0.06);
      // The kick with the bass: softly on 1, and with the second bar's push.
      if (!crash) drum(t, "kick", (solo ? 0.2 : 0.15) * lift, 0.06);
      if (figure === "push" && !odd) for (const slot of [3, 5]) if (slot < stopAt) drum(t + slot / 2, "kick", (solo ? 0.24 : 0.17) * lift, 0.06);
      if (fill) for (const [slot, sound, v] of fill) drum(t + slot / 2, sound, v * (0.9 + 0.2 * (lift - 0.9)));
      else if (!straight && solo) {
        // The left hand talks in spells that lean into the phrase ends.
        const n = talk(bar.ref?.bar ?? i, 0.85 * plan.density * lift);
        for (let k = 0; k < n; k++) for (const [slot, sound, v] of TALK[Math.floor(random() * TALK.length)]) drum(t + slot / 2, sound, v * lift);
      }
    });

    return keepInRange(events).sort((a, b) => a.time - b.time);
  },
};
