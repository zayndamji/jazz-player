import { chordAt, type TimelineBar } from "../engine/timeline";
import { SWING_RANGE, VOICING_LOW, voiceChord } from "../engine/voicing";
import { BASS_HIGH, BASS_LOW, bassOnsets, bassStruck, chordAfter, isFormEnd, keepInRange, marksSection, moveOn, shifted, type VoicingContext } from "./context";
import { DAMPER, GrooveBook, grooveBar, holdLength, type CompHit, type Groove } from "./comping";
import { drumGain, drumTalk, gauss, pianoTouch, timing } from "./feel";
import { seededRandom } from "./random";
import { shapeBars, steadyBars, weighted } from "./shape";
import { EVEN_SWING, landing, nearest, swingRatio, walk } from "./swing";
import type { DrumSound, NoteEvent, Style } from "./types";
import { phrygianLine } from "./waltz";

/**
 * Jazz in 5/4, felt as 3+2, swung. Modelled on the separated stems of the 1959 Brubeck
 * quartet record of the 5/4 standard and two backing tracks (context/style-five.md):
 * - Bass: an ostinato on every bar of one chord or two split 3+2, vamp and bridge alike (the
 *   record keeps the rhythm on the bridge's roots): the root on 1 held through 3, then the
 *   second chord's root (or the fifth) on 4 and again on 5. Bars split any other way are walked.
 * - Piano: the vamp figure as a two-bar groove kept per section and varied a little (comping.ts;
 *   the record's bars are alike, likeness 0.28 bar to bar): the and of 1, the and of 2, 3, and the
 *   second chord on 5, sometimes 1, 4 and the and of 5. Over changing bars (the bridge) it comps
 *   each chord, the same way through a section. Chords ring until about the next hit.
 * - Drums: the ride on every beat with swung skips after 2 and 4 (now and then after 5),
 *   the hi-hat foot on 2 and 4, the kick on 1, light snare comping in spells (feel.ts),
 *   short triplet fills at section ends and a longer one at the end of the form.
 * - The last bar plays each of its chords on its beat and holds the last.
 * - Straight (`Feel.variation`): the vamp's core every bar, one level, no snare comping.
 */

const BAR = 5;

type Hit = [beat: number, length: number, velocity: number];

const g = (id: string, weight: number, a: CompHit[], b: CompHit[]): Groove => ({ id, weight, bars: [a, b] });

/**
 * Vamp grooves, two bars each as [eighth slot 0 to 9 (swung), length in beats, velocity]: Brubeck's
 * core (the and of 1, the and of 2, 3 and 5) with 1, 4 or the and of 5 added in one bar or the
 * other, about 4.5 hits a bar as on the record (context/original-records.md). The and of 1 is a stab.
 */
const VAMP: Groove[] = [
  g("core", 0.35, [[1, 0.3, 0.44], [3, 0.5, 0.5], [4, 0.6, 0.46], [8, 0.55, 0.5]], [[1, 0.3, 0.44], [3, 0.5, 0.5], [4, 0.6, 0.46], [6, 0.4, 0.42], [8, 0.55, 0.5]]),
  g("one", 0.25, [[0, 0.3, 0.4], [1, 0.3, 0.44], [3, 0.5, 0.5], [8, 0.55, 0.5]], [[1, 0.3, 0.44], [3, 0.5, 0.5], [4, 0.6, 0.46], [8, 0.55, 0.5]]),
  g("four", 0.2, [[1, 0.3, 0.44], [3, 0.5, 0.5], [4, 0.6, 0.46], [6, 0.4, 0.42]], [[1, 0.3, 0.44], [4, 0.6, 0.46], [6, 0.4, 0.42], [8, 0.55, 0.5]]),
  g("light", 0.2, [[1, 0.3, 0.44], [3, 0.5, 0.5], [8, 0.55, 0.5]], [[3, 0.5, 0.5], [4, 0.6, 0.46], [8, 0.55, 0.5]]),
];

/** Where a varied vamp bar may add a hit: 1, 4 and the and of 5 as on the record. */
const ADDS = [{ slot: 0, weight: 0.8 }, { slot: 6, weight: 1 }, { slot: 9, weight: 0.5 }, { slot: 5, weight: 0.3 }];

export const five: Style = {
  id: "five",
  name: "Jazz in 5",
  band: ["bass", "piano", "drums"],
  meters: [5],
  // Against Brubeck's 1959 record (piano-solo window, rhythm section only): the piano 9.5 dB under
  // the bass in the mid band and the cymbals about 3 dB louder than the backing tracks had them.
  mix: { bass: 9, piano: -4, drums: 5.5 },
  generate(bars, seed, feel) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.08) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const clock = timing(random, feel.tempo);
    const events: NoteEvent[] = [];
    const music = bars.filter((b) => !b.countIn);
    if (!music.length) return events;
    const first = music[0].startBeat;
    const place = (time: number, part: Parameters<typeof clock.at>[0]) => Math.max(first, time + clock.at(part));
    const pocket: Record<DrumSound, "ride" | "hat" | "pedal" | "kick" | "snare" | "fill"> = {
      ride: "ride", bell: "ride", hat: "hat", pedal: "pedal", kick: "kick", snare: "snare", rim: "snare", tomHigh: "fill", tomLow: "fill", crash: "fill", brush: "snare", brushTap: "snare",
    };
    // The chorus's drum level (feel.ts `ChorusPlan.drums`), as a gain that leaves the sample layer alone.
    let drumLevel = 1;
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: place(time, pocket[sound]), duration: 0.25, velocity: human(velocity, spread), gain: drumLevel });

    const straight = feel.variation === "straight";
    const shapes = straight ? steadyBars(music) : shapeBars(music, random, true);
    const base = swingRatio(feel.tempo, EVEN_SWING);
    const talk = drumTalk(random);
    let piano: number[] | null = null;
    let bassNote = 39;
    /** The bass note sounding at the end of the previous bar. */
    let lastBass = 39;
    /** How many piano hits in a row have struck the current voicing (a vamp moves on after three at most). */
    let run = 0;
    /** The note the previous bar aimed at, where this bar's bass starts (see swing.ts `landing`). */
    let planned: number | null = null;
    let pushedIn = false;
    let registerDrift = 0;
    // One vamp groove per section label, and the bridge's way of comping per section (comping.ts).
    const book = new GrooveBook(random, 0.5);
    const bridgeWays = new Map<string, { early: boolean; inside: boolean }>();

    /** The chords of a bar as text, to tell a vamp (bars repeating the same chords) from changes. */
    const shape = (bar: TimelineBar | undefined) => (bar ? bar.chords.map((c) => `${c.beat}:${c.chord.symbol}`).join(" ") : "");
    /**
     * A vamp bar repeats the chords of the bar before or after it (write a two-chord vamp out in every bar: "%" carries only the last chord): the bass plays the
     * ostinato there and the piano the vamp figure. Bars that change, like a bridge's, are walked and comped.
     */
    const isVamp = (i: number) => {
      const own = shape(music[i]);
      const split = music[i].chords.length === 1 || (music[i].chords.length === 2 && music[i].chords[1].beat === 3);
      return split && (own === shape(music[i - 1]) || own === shape(music[i + 1]));
    };

    music.forEach((bar, i) => {
      const t = bar.startBeat;
      const next = music[i + 1];
      const prev = music[i - 1];
      const { intensity: lift, plan, inPhrase, phraseEnd } = shapes[i];
      drumLevel = drumGain(bar, plan);
      clock.bar();
      const sw = straight ? base : Math.min(0.72, Math.max(0.56, base + plan.swing * 0.6 + gauss(random) * 0.006));
      const solo = plan.role === "solo" || plan.role === "peak";

      if (bar.final) {
        // Each chord of the last bar on its beat; the last one held, ringing like a fermata.
        bar.chords.forEach((c, k) => {
          const end = k === bar.chords.length - 1;
          const at = t + c.beat;
          const low = k === 0 && planned !== null ? planned : landing(c.chord.bass, bassNote);
          piano = voiceChord(c.chord, piano, shifted(SWING_RANGE, 0, VOICING_LOW), { next: bar.chords[k + 1]?.chord ?? null, bass: low });
          events.push({ track: "piano", time: place(at, "piano"), duration: end ? 5 : c.length - 0.05, velocity: end ? 0.55 : 0.5, notes: piano, ...pianoTouch(piano, random, end) });
          events.push({ track: "bass", time: at, duration: end ? 4.5 : c.length - 0.05, velocity: 0.85, notes: [low] });
          bassNote = low;
          drum(at, "kick", end ? 0.7 : 0.4);
          if (end) drum(at, "crash", 0.58, 0);
        });
        return;
      }

      const vamp = isVamp(i);
      const firstChord = bar.chords[0] ?? chordAt(bar, 0);
      const second = bar.chords.find((c) => c.beat === 3) ?? firstChord;

      // Bass: the ostinato on every bar of one chord or two split 3+2, the bridge included (the record
      // keeps the rhythm there on the chord roots); bars with other splits are walked.
      const split = bar.chords.length === 1 || (bar.chords.length === 2 && bar.chords[1].beat === 3);
      const bassFrom = events.length;
      if (split && firstChord) {
        const root = planned ?? nearest(firstChord.chord.bass, 33);
        const two = second !== firstChord;
        const four = two ? nearest(second!.chord.bass, root + 5) : nearest((firstChord.chord.root + 7) % 12, root + 5);
        events.push({ track: "bass", time: place(t, "bass"), duration: 2.85, velocity: human(0.84 * lift, 0.06), notes: [root] });
        events.push({ track: "bass", time: place(t + 3, "bass"), duration: 0.9, velocity: human(0.8 * lift, 0.06), notes: [four] });
        // The next bar's root: home, near A1, unless it sits a step from beat 5's note, then the octave next to it.
        const nextBass = next?.chords[0]?.chord.bass;
        const step = nextBass === undefined ? 12 : Math.min((nextBass - four + 120) % 12, (four - nextBass + 120) % 12);
        planned = nextBass === undefined ? null : step <= 2 ? nearest(nextBass, four) : nearest(nextBass, 33);
        // Beat 5: the same note, or (in the solos, now and then) a step into the next bar's root.
        const target = planned ?? root;
        const five = !straight && solo && random() < 0.25 ? target + (target > four ? -1 : 1) : four;
        events.push({ track: "bass", time: place(t + 4, "bass"), duration: 0.85, velocity: human(0.74 * lift, 0.06), notes: [Math.max(BASS_LOW, Math.min(BASS_HIGH, five))] });
        bassNote = root;
      } else {
        // Each chord's first note and what it aims at, worked out once (as in swing.ts), so an approach
        // always resolves by a half or whole step.
        const lean = plan.register;
        const starts: number[] = [];
        bar.chords.forEach((c, k) => starts.push(k === 0 ? (planned ?? landing(c.chord.bass, bassNote, lean)) : landing(c.chord.bass, starts[k - 1], lean)));
        planned = next?.chords[0] ? landing(next.chords[0].chord.bass, starts.at(-1)!, next.final ? 0 : lean) : null;
        bar.chords.forEach((c, k) => {
          const target = k + 1 < bar.chords.length ? starts[k + 1] : planned;
          const following = chordAfter(music, i, c.beat, 2, 0.01);
          const line = phrygianLine(walk(c.chord, c.length, bassNote, target, random, lean, 0.55, { start: starts[k], next: following }), c.chord, following, target !== null);
          line.forEach((n, b) =>
            events.push({ track: "bass", time: place(t + c.beat + b, "bass"), duration: 0.8 + random() * 0.15, velocity: human((b === 0 ? 0.84 : 0.74) * lift + gauss(random) * 0.05, 0.06), notes: [n] }),
          );
          bassNote = line.at(-1)!;
        });
      }

      // The bass under each beat of the bar, for the piano to keep clear of.
      const bassHere = bassOnsets(events.slice(bassFrom), t);
      const bassAt = (beat: number) => bassStruck(bassHere, beat, 0.1, lastBass);
      lastBass = bassHere.at(-1)?.[1] ?? lastBass;

      // Piano.
      // The register drifts by section and moves by voice leading in between.
      if (!straight && inPhrase === 0 && (bar.ref?.bar ?? 0) % 8 === 0)
        registerDrift = weighted([{ weight: 0.6, value: -2 }, { weight: 1, value: 0 }, { weight: 0.8, value: 2 }, { weight: 0.3, value: 3 }], random, registerDrift);
      const shift = straight ? 0 : Math.max(-3, Math.min(5, plan.register + registerDrift));
      const range = shifted(SWING_RANGE, shift, VOICING_LOW);
      const nextChord = next?.chords[0];
      const changes = !!nextChord?.attack && !next?.final && nextChord.chord !== bar.chords.at(-1)?.chord;
      let hits: Hit[];
      const eighth = (slot: number) => Math.floor(slot / 2) + (slot % 2 ? sw : 0);
      if (vamp) {
        // The vamp: the section's groove, A B A B through the phrase, the first bar as written and the
        // others now and then moved a little, the phrase's last most often.
        const groove = straight ? VAMP[0] : book.grooveFor(bar.chorus, bar.label, (avoid) => weighted(VAMP.map((v) => ({ weight: v.weight, value: v })), random, avoid));
        const chances = straight ? { first: 0, middle: 0, last: 0 } : solo ? { first: 0.08, middle: 0.26, last: 0.45 } : { first: 0.04, middle: 0.14, last: 0.3 };
        hits = grooveBar(straight ? { ...groove, bars: [groove.bars[0], groove.bars[0]] } : groove, inPhrase, random, chances, { adds: ADDS, busier: plan.density, length: 0.45, velocity: 0.46, slots: 10 }).map(
          ([slot, length, velocity]): Hit => [eighth(slot), length, velocity],
        );
      } else {
        // The bridge: a hit near each chord's start and one more inside a long chord; whether the hit
        // comes a swung and early and whether the extra one plays is chosen once a section.
        const key = `${bar.chorus}.${bar.label}`;
        if (!bridgeWays.has(key)) bridgeWays.set(key, { early: !straight && random() < 0.35, inside: !straight && random() < 0.6 });
        const way = bridgeWays.get(key)!;
        hits = [];
        for (const c of bar.chords) {
          const early = way.early && c.beat > 0;
          hits.push([early ? c.beat - 1 + sw : c.beat, Math.min(c.length - 0.2, 1.2), 0.48]);
          if (way.inside && c.length >= 3) hits.push([c.beat + 1 + sw, 0.5, 0.44]);
        }
        hits.sort((a, b) => a[0] - b[0]);
      }
      let pushes = false;
      // How much of the room to the next hit a chord holds.
      const share = solo ? 0.82 : 0.9;
      for (const [h, [beat, length, velocity]] of hits.entries()) {
        if (pushedIn && beat < 0.5) continue;
        // A hit on the and of 5 takes the next bar's chord when it changes (and that downbeat isn't played again).
        const ahead = beat > 4.2 && changes;
        const c = ahead ? nextChord! : chordAt(bar, beat);
        if (!c) continue;
        // Voiced toward the chord after it, clear of the bass under it (the next bar's root, for a push).
        const context: VoicingContext = ahead ? { next: chordAfter(music, i + 1, 0, 2, 0.01), bass: nearest(c.chord.bass, 33) } : { next: chordAfter(music, i, beat, 2, 0.01), bass: bassAt(beat) };
        const last = piano;
        const voiced = voiceChord(c.chord, last, range, context);
        // The vamp's bars are alike but not identical: the voicing moves on now and then, never more than three hits on one shape.
        const repeat = !!last && voiced.join() === last.join();
        piano = moveOn(voiced, last, repeat && (run >= 3 || (!straight && run >= 2 && random() < 0.35)), (from) => voiceChord(c.chord, from, range, context));
        run = last && piano.join() === last.join() ? run + 1 : 1;
        const until = ahead ? BAR + 2 : (bar.chords.find((x) => x.beat > beat + 0.01)?.beat ?? (changes ? (pushes ? BAR - 0.5 : BAR) : BAR + 0.5));
        const gap = (ahead ? BAR + 1.5 : (hits[h + 1]?.[0] ?? BAR + 0.25)) - beat;
        const duration = Math.max(0.25, Math.min(holdLength(length, gap, share), until - beat - 0.05));
        events.push({ track: "piano", time: place(t + beat, "piano"), duration, velocity: human((velocity + (beat % 1 ? 0.03 : 0)) * lift, 0.1), notes: piano, ...pianoTouch(piano, random), ...(duration < 1.2 ? { release: DAMPER } : {}) });
        if (ahead) pushes = true;
      }
      pushedIn = pushes;

      // Drums.
      const fill = !straight && marksSection(bar, next) && !next?.final;
      const bigFill = isFormEnd(bar, next) && !!next;
      const sectionFill = fill && !bigFill && random() < (solo ? 0.5 : 0.35);
      const smallFill = !straight && phraseEnd && random() < (solo ? 0.15 : 0.08);
      const trip = (from: number, sounds: DrumSound[]) => sounds.map((s, k): [number, DrumSound, number] => [from + k / 3, s, 0.24 + (k * 0.18) / sounds.length]);
      const theFill: [number, DrumSound, number][] | null =
        bigFill
          ? trip(3, ["snare", "snare", "tomHigh", "snare", "tomLow", "tomLow"])
          : sectionFill
            ? trip(4, ["snare", "tomHigh", "tomLow"])
            : fill || smallFill
              ? [[4 + sw, "snare", 0.3]]
              : null;
      const rideEnd = theFill ? Math.min(...theFill.map(([at]) => at)) : BAR;
      let crash = 0;
      if (prev && isFormEnd(prev, bar)) crash = 0.6;
      else if (!straight && prev && marksSection(prev, bar) && random() < 0.5) crash = 0.48;
      if (crash) drum(t, "crash", crash, 0.05);
      // The ride: every beat, swung skips after 2 and 4, sometimes after 5.
      const ride: [number, number][] = [[0, 0.56], [1, 0.6], [1 + sw, 0.4], [2, 0.54], [3, 0.6], [3 + sw, 0.4], [4, 0.56]];
      if (!straight && random() < 0.5) ride.push([4 + sw, 0.36]); // in about half the record's bars
      const level = (plan.role === "peak" ? 1.08 : solo ? 1 : 0.92) * lift;
      for (const [at, v] of ride) if (at < rideEnd - 0.01 && !(crash && at < 0.01)) drum(t + at, "ride", v * level, 0.2);
      for (const b of [1, 3]) drum(t + b, "pedal", 0.46, 0.1);
      if (!crash) drum(t, "kick", (solo ? 0.24 : 0.2) * lift, 0.06);
      else drum(t, "kick", crash * 0.7);
      const figures = straight ? 0 : talk(bar.ref?.bar ?? i, 0.7 * plan.density * lift * lift);
      if (theFill) for (const [at, sound, v] of theFill) drum(t + at, sound, v * (0.9 + 0.2 * (lift - 0.9)));
      else
        for (let n = 0; n < figures; n++) {
          const at = weighted([{ weight: 1, value: 1 + sw }, { weight: 1, value: 2 + sw }, { weight: 0.8, value: 3 + sw }, { weight: 0.6, value: sw }, { weight: 0.5, value: 4 + sw }], random);
          drum(t + at, "snare", 0.17 + random() * 0.06, 0.05);
        }
    });

    return keepInRange(events).sort((a, b) => a.time - b.time);
  },
};
