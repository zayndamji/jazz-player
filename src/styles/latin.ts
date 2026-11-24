import type { ParsedChord } from "../chart/chords";
import { chordAt, type TimelineBar, type TimelineChord } from "../engine/timeline";
import { PIANO_RANGE, type VoicingRange } from "../engine/voicing";
import { otherPc, placeBass } from "./bossa";
import { BASS_HIGH, BASS_LOW, bassUnder, chordAfter, endsSection, isFormEnd, shifted, voiceClear } from "./context";
import { DAMPER, GrooveBook, grooveBar, holdLength, type CompHit, type Groove } from "./comping";
import { drumGain, gauss, pianoTouch, timing } from "./feel";
import { seededRandom } from "./random";
import { shapeBars, steadyBars, weighted } from "./shape";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Afro-Cuban Latin jazz, straight eighths, on a 2-3 son clave over two bars: the A sections of
 * tunes like On Green Dolphin Street or A Night in Tunisia, the Latin choruses of a Latin tune.
 * A section of a swing tune can play in it (`Section.style`), so Latin A's and a swing bridge work.
 * - The clave: bar one of each pair is the 2 side (beats 2 and 3), bar two the 3 side (1, the and of 2, 4),
 *   counted from each section's first bar.
 * - Bass: the tumbao, on the and of 2 and on 4, each note held over to the next: the and of 2 takes
 *   the fifth (or the root of a chord that changes on 3, anticipated), beat 4 the next bar's root,
 *   anticipated and tied over the bar line, so beat 1 isn't struck. In the heads the bass often plays
 *   "1, and of 2, 4" instead (beat 1 struck, beat 4 a chord tone or a half step into the next root),
 *   which a listener can count. The first bar, or the first after another style, strikes beat 1.
 * - Piano: two-bar figures kept for each section (comping.ts), lined up with the clave: mostly comping
 *   on the anticipations (the ands of 2 and 4, held), or on the clave, which leaves the soloist room. Now
 *   and then a section, more often at the peak chorus, plays a montuno: broken eighths, an octave with a
 *   chord tone inside on the beats, a small chord on the ands, softer than the comping. A montuno under
 *   every solo was heard as busy, pulling attention from the soloist (the maintainer, 2026-11-24).
 *   Every and takes the chord of the beat after it, so the piano anticipates with the bass, and the and
 *   of 4 plays the next bar's chord.
 * - Drums: the cáscara on the ride (in the heads) or its bell (in the solos), the clave on the
 *   cross-stick, the kick on the and of 2 and 4 with the bass, the hi-hat foot on 2 and 4. In the
 *   solos the left hand now and then plays the conga's tumbao instead of the clave: the cross-stick
 *   on 2, the low tom on 4 and its and. Tom fills into sections, a crash with the kick on the new section.
 * - Straight (`Feel.variation`): the tumbao, the first montuno, the cáscara on the ride and the clave
 *   every bar; a fill and a crash only at the end of the form.
 * Not yet measured against a reference recording (context/style-latin.md).
 */

/** 2-3 son clave on the cross-stick, eighth slots: the 2 side (beats 2 and 3), then the 3 side (1, the and of 2, 4). */
export const CLAVE = [
  [2, 4],
  [0, 3, 6],
];

/** The cáscara for 2-3 clave, [eighth slot, velocity] per bar: the strokes that fall with the clave a little stronger. */
export const CASCARA: [number, number][][] = [
  [[1, 0.4], [2, 0.54], [4, 0.54], [6, 0.46]],
  [[0, 0.58], [2, 0.44], [4, 0.5], [5, 0.4], [7, 0.46]],
];

/** The conga's tumbao on the kit's left hand: a slap on 2 (cross-stick), open tones on 4 and its and (low tom). */
const CONGA: [number, DrumSound, number][] = [
  [2, "rim", 0.46],
  [6, "tomLow", 0.4],
  [7, "tomLow", 0.36],
];

/** Kick with the bass's tumbao: the and of 2 and 4. */
const KICK: [number, number][] = [
  [3, 0.48],
  [6, 0.44],
];

const g = (id: string, weight: number, a: CompHit[], b: CompHit[], montuno = false): Groove & { montuno: boolean } => ({ id, weight, bars: [a, b], montuno });

/**
 * Piano figures, two bars each (the 2 side, then the 3 side) as [eighth slot, length in beats, velocity]. The
 * comping figures hold their chords; a montuno's notes are short and alternate an octave and a chord.
 * The first montuno is the straight feel's, the anticipations the intro's.
 */
const PIANO_GROOVES = [
  g("montuno", 1, [[1, 0.4, 0.46], [3, 0.4, 0.44], [4, 0.4, 0.48], [6, 0.4, 0.44]], [[0, 0.4, 0.48], [2, 0.4, 0.44], [3, 0.4, 0.46], [5, 0.4, 0.44], [7, 0.45, 0.48]], true),
  g("offbeats", 0.75, [[1, 0.4, 0.46], [3, 0.4, 0.46], [5, 0.4, 0.44], [7, 0.4, 0.46]], [[1, 0.4, 0.46], [2, 0.4, 0.44], [4, 0.4, 0.46], [5, 0.4, 0.44], [7, 0.45, 0.48]], true),
  g("anticipate", 1, [[0, 0.5, 0.44], [3, 1.2, 0.46]], [[3, 0.9, 0.44], [7, 1.2, 0.46]]),
  g("clave", 0.9, [[2, 0.5, 0.44], [4, 0.9, 0.46]], [[0, 0.6, 0.46], [3, 0.6, 0.44], [6, 1.2, 0.46]]),
  g("push", 0.6, [[1, 0.6, 0.44], [4, 1.2, 0.46]], [[3, 0.6, 0.44], [7, 1.4, 0.46]]),
];
const INTRO_GROOVE = 2;
/** A montuno's eighths sit under the comping's level, so the figure stays behind the soloist. */
const MONTUNO_LEVEL = 0.82;

/** Where a varied comping bar may add a hit: the ands most. */
const ADDS = [1, 2, 3, 4, 5, 6, 7].map((slot) => ({ slot, weight: slot % 2 ? 1 : 0.6 }));

type BassFigure = "tumbao" | "one";

/** The clave side of a bar: 0 the 2 side, 1 the 3 side, counted from its section's first bar. */
export const claveSide = (bar: TimelineBar, i: number) => (bar.ref?.bar ?? i) % 2;

/** True when the bar before this one played in another style, so nothing in this one was anticipated. */
const afterOtherStyle = (prev: TimelineBar | undefined, bar: TimelineBar) => !prev || prev.countIn || (!!prev.style && !!bar.style && prev.style !== bar.style);

/**
 * The montuno's octave: a chord tone (the 3rd, 5th or root, as a montuno doubles them, never a 9th or 13th)
 * near the voicing's top, doubled an octave down, with another of them inside, nearest a fourth under the top.
 */
function octaveShape(voicing: number[], chord: ParsedChord): number[] {
  const tones = chord.intervals.filter((iv) => [0, 3, 4, 6, 7, 8].includes(iv % 12)).map((iv) => (chord.root + iv) % 12);
  const high = voicing.at(-1)!;
  let top = high;
  while (!tones.includes(((top % 12) + 12) % 12) && top > high - 12) top--;
  const inner: number[] = [];
  for (let n = top - 11; n < top; n++) if (tones.includes(n % 12)) inner.push(n);
  const mid = inner.reduce<number | null>((best, n) => (best === null || Math.abs(n - (top - 5)) < Math.abs(best - (top - 5)) ? n : best), null);
  return mid === null ? [top - 12, top] : [top - 12, mid, top];
}

export const latin: Style = {
  id: "latin",
  name: "Latin",
  band: ["bass", "piano", "drums"],
  // A piano trio's balance, the bass leading: between the bossa's and the swing's until measured.
  mix: { bass: 7, piano: 1, drums: 3 },
  generate(bars, seed, feel) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const clock = timing(random, feel?.tempo ?? 180);
    const pocket: Record<DrumSound, "hat" | "ride" | "kick" | "snare" | "pedal" | "fill"> = {
      hat: "hat", ride: "ride", bell: "ride", kick: "kick", rim: "snare", snare: "snare", pedal: "pedal", crash: "fill", tomHigh: "fill", tomLow: "fill", brush: "snare", brushTap: "snare",
    };
    const events: NoteEvent[] = [];
    let drumLevel = 1;
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: time + clock.at(pocket[sound]), duration: 0.25, velocity: human(velocity, spread), gain: drumLevel });

    const music = bars.filter((b) => !b.countIn);
    const straight = feel?.variation === "straight";
    const sparse = feel?.comp === "sparse";
    const shapes = straight ? steadyBars(music) : shapeBars(music, random, true);
    const pianoBook = new GrooveBook<(typeof PIANO_GROOVES)[number]>(random, 0.5);
    const bassBook = new GrooveBook<BassFigure>(random, 0.6);
    const handBook = new GrooveBook<"clave" | "conga">(random, 0.5);
    let piano: number[] | null = null;
    let lastBass = 34;
    let pushedIn = false;
    let layOut = false;
    let registerDrift = 0;
    let phraseDb = 0;
    let phraseSlope = 0;
    let prevFigure: BassFigure = "one";

    music.forEach((bar, i) => {
      const t = bar.startBeat;
      const next = music[i + 1];
      const prev = music[i - 1];
      const side = claveSide(bar, i);
      const { intensity: lift, plan, shout } = shapes[i];
      drumLevel = drumGain(bar, plan);
      clock.bar();
      const solos = plan.role === "solo" || plan.role === "peak";
      const head = !solos;
      const intro = bar.ref?.part === "intro";
      const inPhrase = (bar.ref?.bar ?? i) % 4;
      const fresh = afterOtherStyle(prev, bar);

      const barBass: NoteEvent[] = [];
      const bassAt = (e: NoteEvent) => {
        events.push(e);
        barBass.push(e);
      };
      const under = (beat: number, length: number) => bassUnder(barBass, t + beat - 0.05, t + beat + length);

      if (bar.final) {
        // Each chord of the last bar on its beat, the last one held like a fermata, with a crash.
        bar.chords.forEach((c, k) => {
          const last = k === bar.chords.length - 1;
          const n = (lastBass = placeBass(c.chord.bass, lastBass));
          bassAt({ track: "bass", time: t + c.beat, duration: last ? 3.5 : c.length - 0.1, velocity: last ? 0.85 : 0.8, notes: [n] });
          const after = last ? null : bar.chords[k + 1].chord;
          piano = voiceClear(c.chord, piano, PIANO_RANGE, after, n);
          events.push({ track: "piano", time: t + c.beat, duration: last ? 4 : c.length - 0.1, velocity: last ? 0.52 : 0.46, notes: piano, ...pianoTouch(piano, random, true) });
          drum(t + c.beat, "kick", last ? 0.8 : 0.6);
          if (last) drum(t + c.beat, "crash", 0.6, 0);
        });
        return;
      }

      // The piano's register and level move by phrase and chorus, not from bar to bar.
      if (!straight && inPhrase === 0) {
        if ((bar.ref?.bar ?? 0) % 8 === 0) registerDrift = weighted([{ weight: 0.6, value: -1 }, { weight: 1.3, value: 0 }, { weight: 1, value: 1 }, { weight: 0.5, value: 2 }], random, registerDrift);
        phraseDb = gauss(random) * 1.1;
        phraseSlope = weighted([{ weight: 0.4, value: 0 }, { weight: 0.35, value: 1 }, { weight: 0.25, value: -1 }], random);
        layOut = sparse && head && !intro && random() < 0.5;
      }
      const shift = straight ? 0 : Math.max(-2, Math.min(6, plan.register + registerDrift));
      const pianoGain = straight ? 1 : 10 ** ((phraseDb + phraseSlope * (inPhrase - 1.5) + gauss(random) * 1) / 20);

      // Bass: the section's figure, the tumbao or "1, and of 2, 4".
      const figure: BassFigure = straight
        ? "tumbao"
        : intro
          ? "one"
          : bassBook.grooveFor(bar.chorus, bar.label, () => weighted([{ weight: solos ? 0.25 : 0.55, value: "one" as BassFigure }, { weight: solos ? 0.75 : 0.45, value: "tumbao" as BassFigure }], random));
      const first = chordAt(bar, 0)!;
      const third = chordAt(bar, 2)!;
      const nextFirst: TimelineChord | undefined = next && !next.countIn ? chordAt(next, 0) : undefined;
      // A bar that changes chord on 2 or 4 plays each chord's root on its beat.
      const busy = bar.chords.some((c) => c.attack && (Math.abs(c.beat - 1) < 0.01 || Math.abs(c.beat - 3) < 0.01));
      const level = 0.94 + 0.06 * lift;
      if (busy) {
        for (const c of bar.chords) {
          const n = (lastBass = placeBass(c.chord.bass, lastBass));
          bassAt({ track: "bass", time: t + c.beat + clock.at("bass"), duration: Math.max(0.4, c.length - 0.1), velocity: human(0.8 * level, 0.1), notes: [n] });
        }
      } else {
        // Beat 1 sounds unless the bar before anticipated it on its beat 4.
        const strikeOne = figure === "one" || fresh || prevFigure === "one";
        const root = placeBass(first.chord.bass, lastBass);
        if (strikeOne) bassAt({ track: "bass", time: t + clock.at("bass"), duration: 1.4, velocity: human(0.84 * level, 0.1), notes: [root] });
        const changes3 = third.chord.symbol !== first.chord.symbol;
        const and2 = changes3 ? placeBass(third.chord.bass, root) : placeBass(otherPc(first.chord, chordAfter(music, i, 0)), root, null, null, root);
        // Beat 4: the tumbao anticipates the next bar's root (not into the final hit); "one" plays a chord tone, or a half step into a new root.
        const target = nextFirst?.chord.bass ?? third.chord.bass;
        const newRoot = target !== third.chord.bass;
        let four: number;
        const anticipates = figure === "tumbao" && !!nextFirst && !next?.final;
        if (anticipates) four = placeBass(target, and2);
        else if (newRoot && nextFirst) {
          const goal = placeBass(target, and2);
          const step = random() < 0.5 ? -1 : 1;
          four = goal + step >= BASS_LOW && goal + step <= BASS_HIGH ? goal + step : goal - step;
        } else four = placeBass(third.chord.bass, and2, null, null, and2);
        lastBass = four;
        const tie = anticipates && next && !next.final ? 2.45 : 0.9;
        bassAt({ track: "bass", time: t + 1.5 + clock.at("bass"), duration: 1.42, velocity: human((figure === "one" ? 0.72 : 0.78) * level, 0.1), notes: [and2] });
        bassAt({ track: "bass", time: t + 3 + clock.at("bass"), duration: tie, velocity: human((figure === "one" ? 0.66 : 0.84) * level, 0.1), notes: [four] });
        prevFigure = anticipates ? "tumbao" : "one";
      }

      // Piano: the section's figure, lined up with the clave; the ands take the chord of the beat after.
      const groove = straight
        ? PIANO_GROOVES[0]
        : intro
          ? PIANO_GROOVES[INTRO_GROOVE]
          : pianoBook.grooveFor(bar.chorus, bar.label, (avoid) =>
              weighted(PIANO_GROOVES.map((f) => ({ weight: f.weight * (f.montuno ? (plan.role === "peak" ? 0.5 : solos ? 0.2 : 0.12) : 1) * plan.density ** (f.montuno ? 2 : 0), value: f })), random, avoid),
            );
      const settled = straight || head;
      const chances = straight ? { first: 0, middle: 0, last: 0 } : settled ? { first: 0.04, middle: 0.1, last: 0.25 } : { first: 0.06, middle: 0.18, last: 0.35 };
      // A montuno keeps its eighths; only the comping figures are varied.
      const hits = layOut
        ? []
        : groove.montuno
          ? groove.bars[side].map((h) => [...h] as CompHit)
          : grooveBar(groove, side, random, chances, { adds: ADDS, busier: plan.density, length: 0.6, velocity: 0.44 });
      const range: VoicingRange = shifted(PIANO_RANGE, shift + (groove.montuno ? 4 : 0));
      let pushes = false;
      hits.forEach(([slot, length, velocity], h) => {
        if (pushedIn && slot === 0 && !fresh) return;
        const beat = slot / 2;
        // The and of 4 plays the next bar's chord, unless the next bar is the final hit.
        const into = slot === 7 && nextFirst && !next?.final;
        if (slot === 7 && next?.final) return;
        const slotChord = into ? nextFirst! : chordAt(bar, slot % 2 ? (slot + 1) / 2 : beat);
        if (!slotChord) return;
        const after = into ? chordAfter(music, i + 1, 0) : chordAfter(music, i, slot % 2 ? (slot + 1) / 2 : beat);
        if (into) pushes = true;
        const nextHit = hits[h + 1]?.[0];
        const gap = (nextHit === undefined ? 8.5 : nextHit) / 2 - beat;
        // Held until about the next hit, never past the next chord change.
        const change = into ? 4.5 + (next!.chords.find((c) => c.attack && c.beat > 0.01)?.beat ?? 4) : (bar.chords.find((c) => c.attack && c.beat > beat + 0.51)?.beat ?? (nextFirst && nextFirst.chord.symbol !== slotChord.chord.symbol ? 4 : 4.5));
        const duration = groove.montuno ? length : Math.max(0.35, Math.min(holdLength(length, gap, head ? 0.9 : 0.82), change - beat - 0.08));
        const voicing = voiceClear(slotChord.chord, piano, range, after, under(beat, duration));
        piano = voicing;
        const notes = groove.montuno ? (h % 2 === 0 ? octaveShape(voicing, slotChord.chord) : voicing.slice(0, -1)) : voicing;
        events.push({
          track: "piano",
          time: t + beat + clock.at("piano"),
          duration,
          velocity: human(velocity * lift * pianoGain * (groove.montuno ? MONTUNO_LEVEL : 1), 0.1),
          notes,
          ...pianoTouch(notes, random),
          ...(duration < 1.2 ? { release: DAMPER } : {}),
        });
      });
      pushedIn = pushes;

      // Drums.
      const formEnd = isFormEnd(bar, next) && !!next && !next.final;
      const fill = endsSection(bar, next) && !next?.final && (formEnd || (!straight && random() < (shout ? 0.9 : solos ? 0.6 : 0.45)));
      const bigFill = formEnd && (straight || random() < 0.6) ? (random() < 0.5 ? "two" : "one") : null;
      // Where the groove stops for a fill, in eighth slots.
      const stopAt = bigFill === "two" ? 4 : bigFill === "one" ? 6 : fill ? 7 : 8;
      const bell = !straight && (plan.role === "peak" || (solos && bellFor(bar.chorus)));
      for (const [slot, v] of CASCARA[side]) if (slot < stopAt) drum(t + slot / 2, bell ? "bell" : "ride", v * lift * (bell ? 0.9 : 1), 0.14);
      const hand = straight || head ? "clave" : handBook.grooveFor(bar.chorus, bar.label, () => (random() < 0.55 ? "clave" : "conga"));
      if (hand === "clave") for (const slot of CLAVE[side]) if (slot < stopAt) drum(t + slot / 2, "rim", 0.5 * lift);
      if (hand === "conga") for (const [slot, sound, v] of CONGA) if (slot < stopAt) drum(t + slot / 2, sound, v * lift);
      for (const [slot, v] of KICK) if (slot < Math.max(stopAt, 7)) drum(t + slot / 2, "kick", v * lift);
      [1, 3].forEach((b) => drum(t + b, "pedal", 0.36));

      // A crash with the kick on the first beat of a new section: always after the form's end, sometimes elsewhere.
      if (prev && endsSection(prev, bar) && !intro && (isFormEnd(prev, bar) || (!straight && random() < (solos ? 0.45 : 0.25)))) {
        drum(t, "crash", isFormEnd(prev, bar) ? 0.6 : 0.48, 0.05);
        drum(t, "kick", 0.55 * lift);
      }

      if (bigFill === "two") {
        // Beats 3 and 4 in sixteenths, the snare building into the toms, as a timbalero rolls into the section.
        const sounds: DrumSound[] = ["snare", "snare", "snare", "snare", "tomHigh", "tomHigh", "tomLow", "tomLow"];
        sounds.forEach((sd, k) => drum(t + 2 + k * 0.25, sd, 0.26 + k * 0.035));
      } else if (bigFill === "one") {
        const sounds: DrumSound[] = random() < 0.5 ? ["snare", "tomHigh", "tomLow", "tomLow"] : ["tomHigh", "tomHigh", "tomLow", "snare"];
        sounds.forEach((sd, k) => drum(t + 3 + k * 0.25, sd, 0.3 + k * 0.05));
      } else if (fill) {
        // The and of 4: a two-note tom pickup, or the snare.
        if (random() < 0.6) [3.5, 3.75].forEach((b, k) => drum(t + b, k ? "tomLow" : "tomHigh", 0.32 + k * 0.04));
        else [3.5, 3.75].forEach((b, k) => drum(t + b, "snare", 0.26 + k * 0.06));
      } else if (!straight && shapes[i].phraseEnd && solos && random() < 0.3) {
        drum(t + 3.5, "tomLow", 0.28); // a tom note into the next phrase
      }
    });

    /** Whether a solo chorus plays the cáscara on the bell (most do), the same through the chorus. */
    function bellFor(chorus: number) {
      return (chorus * 7919) % 10 < 7;
    }

    return events.sort((a, b) => a.time - b.time);
  },
};
