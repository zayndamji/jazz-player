import { chordAt, type TimelineBar } from "../engine/timeline";
import { SWING_RANGE, voiceChord, type VoicingRange } from "../engine/voicing";
import { drumTalk, gauss, pianoTouch, timing } from "./feel";
import { seededRandom } from "./random";
import { shapeBars, steadyBars, weighted } from "./shape";
import { endsSection, isFormEnd, nearest, swingRatio, walk } from "./swing";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Jazz in 5/4, felt as 3+2, swung. Modelled on the separated stems of the 1959 Brubeck
 * quartet record of the 5/4 standard and two backing tracks (context/style-five.md):
 * - Bass: an ostinato over a vamp bar (one chord, or two split 3+2): the root on 1 held
 *   through 3, then the second chord's root (or the fifth) on 4 and again on 5. Over bars
 *   that change chords in the bridge it walks in quarters.
 * - Piano: the vamp figure, the same every bar with small changes (the record's bars are
 *   alike, likeness 0.28 bar to bar): the and of 1, the and of 2, 3, and the second chord on
 *   5, sometimes on 1, 4 and the and of 5. In the bridge it comps a cell over each chord.
 * - Drums: the ride on every beat with swung skips after 2 and 4 (now and then after 5),
 *   the hi-hat foot on 2 and 4, the kick on 1, light snare comping in spells (feel.ts),
 *   short triplet fills at section ends and a longer one at the end of the form.
 * - Straight (`Feel.variation`): the vamp's core every bar, one level, no snare comping.
 */

const BAR = 5;

type Hit = [beat: number, length: number, velocity: number];

export const five: Style = {
  id: "five",
  name: "Jazz in 5",
  band: ["bass", "piano", "drums"],
  meters: [5],
  // As swing, with the piano 2 dB further down: the vamp's four or five hits a bar measured about
  // 4 dB over three 5/4 backing tracks in the mid band at swing's level.
  mix: { bass: 9, piano: 0.5, drums: 2.5 },
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
      ride: "ride", hat: "hat", pedal: "pedal", kick: "kick", snare: "snare", rim: "snare", tomHigh: "fill", tomLow: "fill", crash: "fill", brush: "snare", brushTap: "snare",
    };
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.08) =>
      events.push({ track: "drums", drum: sound, time: place(time, pocket[sound]), duration: 0.25, velocity: human(velocity, spread) });

    const straight = feel.variation === "straight";
    const shapes = straight ? steadyBars(music) : shapeBars(music, random, true);
    const base = swingRatio(feel.tempo);
    const talk = drumTalk(random);
    let piano: number[] | null = null;
    let bassNote = 39;
    let pushedIn = false;
    let registerDrift = 0;

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
      clock.bar();
      const sw = straight ? base : Math.min(0.72, Math.max(0.56, base + plan.swing * 0.6 + gauss(random) * 0.006));
      const solo = plan.role === "solo" || plan.role === "peak";

      if (bar.final) {
        const chord = bar.chords[0]?.chord;
        if (!chord) return;
        piano = voiceChord(chord, piano, SWING_RANGE);
        events.push({ track: "piano", time: place(t, "piano"), duration: 5, velocity: 0.55, notes: piano, ...pianoTouch(piano, random, true) });
        events.push({ track: "bass", time: t, duration: 4.5, velocity: 0.85, notes: [nearest(chord.bass, bassNote)] });
        drum(t, "kick", 0.7);
        drum(t, "crash", 0.58, 0);
        return;
      }

      const vamp = isVamp(i);
      const firstChord = bar.chords[0] ?? chordAt(bar, 0);
      const second = bar.chords.find((c) => c.beat === 3) ?? firstChord;

      // Bass.
      if (vamp && firstChord) {
        const root = nearest(firstChord.chord.bass, 33);
        const two = second !== firstChord;
        const four = two ? nearest(second!.chord.bass, root + 5) : nearest((firstChord.chord.root + 7) % 12, root + 5);
        events.push({ track: "bass", time: place(t, "bass"), duration: 2.85, velocity: human(0.84 * lift, 0.06), notes: [root] });
        events.push({ track: "bass", time: place(t + 3, "bass"), duration: 0.9, velocity: human(0.8 * lift, 0.06), notes: [four] });
        // Beat 5: the same note, or (in the solos, now and then) a step toward the next bar's root.
        const target = next?.chords[0] ? nearest(next.chords[0].chord.bass, root) : root;
        const five = !straight && solo && random() < 0.25 ? target + (target > four ? -1 : 1) : four;
        events.push({ track: "bass", time: place(t + 4, "bass"), duration: 0.85, velocity: human(0.74 * lift, 0.06), notes: [Math.max(28, Math.min(50, five))] });
        bassNote = root;
      } else {
        bar.chords.forEach((c, k) => {
          const following = bar.chords[k + 1] ?? next?.chords[0];
          const target = following ? nearest(following.chord.bass, bassNote) : null;
          const line = walk(c.chord, c.length, bassNote, target, random, plan.register, 0.55);
          line.forEach((n, b) =>
            events.push({ track: "bass", time: place(t + c.beat + b, "bass"), duration: 0.8 + random() * 0.15, velocity: human((b === 0 ? 0.84 : 0.74) * lift + gauss(random) * 0.05, 0.06), notes: [n] }),
          );
          bassNote = line.at(-1)!;
        });
      }

      // Piano.
      if (!straight && inPhrase === 0 && ((bar.ref?.bar ?? 0) % 8 === 0 || random() < 0.4))
        registerDrift = weighted([{ weight: 0.6, value: -2 }, { weight: 1, value: 0 }, { weight: 0.8, value: 2 }, { weight: 0.3, value: 3 }], random, registerDrift);
      const shift = straight ? 0 : Math.max(-3, Math.min(5, plan.register + registerDrift));
      const range: VoicingRange = { ...SWING_RANGE, low: SWING_RANGE.low + shift, high: SWING_RANGE.high + shift, center: SWING_RANGE.center + shift };
      const nextChord = next?.chords[0];
      const changes = !!nextChord?.attack && !next?.final && nextChord.chord !== bar.chords.at(-1)?.chord;
      let hits: Hit[];
      if (vamp) {
        // The vamp: the and of 1, the and of 2, 3, and 5 (the core), plus now and then 1, 4 or the and of 5.
        hits = [[sw, 0.4, 0.44], [1 + sw, 0.5, 0.5], [2, 0.6, 0.46], [4, 0.55, 0.5]];
        if (!straight) {
          if (random() < 0.25) hits.unshift([0, 0.3, 0.4]);
          if (random() < 0.35) hits.splice(-1, 0, [3, 0.4, 0.42]);
          if (random() < 0.2 * plan.density) hits[hits.length - 1] = [4 + sw, 0.8, 0.5]; // pushed: the next bar's chord on the and of 5
        }
      } else {
        // The bridge: a hit near each chord's start (a swung and before it now and then) and one more inside.
        hits = [];
        for (const c of bar.chords) {
          const early = !straight && c.beat > 0 && random() < 0.35;
          hits.push([early ? c.beat - 1 + sw : c.beat, Math.min(c.length - 0.2, 1.2), 0.48]);
          if (!straight && c.length >= 3 && random() < 0.6) hits.push([c.beat + 1 + sw, 0.5, 0.44]);
        }
      }
      let pushes = false;
      for (const [beat, length, velocity] of hits) {
        if (pushedIn && beat < 0.5) continue;
        // A hit on the and of 5 takes the next bar's chord when it changes (and that downbeat isn't played again).
        const ahead = beat > 4.2 && changes;
        const c = ahead ? nextChord! : chordAt(bar, beat);
        if (!c) continue;
        piano = voiceChord(c.chord, piano, range);
        const until = ahead ? BAR + 2 : (bar.chords.find((x) => x.beat > beat + 0.01)?.beat ?? BAR + 0.5);
        const duration = Math.max(0.25, Math.min(length * (solo ? 1.1 : 1.3), until - beat - 0.05));
        events.push({ track: "piano", time: place(t + beat, "piano"), duration, velocity: human((velocity + (beat % 1 ? 0.03 : 0)) * lift, 0.1), notes: piano, ...pianoTouch(piano, random) });
        if (ahead) pushes = true;
      }
      pushedIn = pushes;

      // Drums.
      const fill = !straight && endsSection(bar, next) && !next?.final;
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
      else if (!straight && prev && endsSection(prev, bar) && random() < 0.5) crash = 0.48;
      if (crash) drum(t, "crash", crash, 0.05);
      // The ride: every beat, swung skips after 2 and 4, sometimes after 5.
      const ride: [number, number][] = [[0, 0.56], [1, 0.6], [1 + sw, 0.4], [2, 0.54], [3, 0.6], [3 + sw, 0.4], [4, 0.56]];
      if (!straight && random() < 0.35) ride.push([4 + sw, 0.36]);
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

    return events.sort((a, b) => a.time - b.time);
  },
};
