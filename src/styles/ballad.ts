import type { TimelineBar } from "../engine/timeline";
import { PIANO_RANGE, type VoicingRange } from "../engine/voicing";
import { BASS_HIGH, BASS_LOW, bassUnder, chordAfter, endsSection, isFormEnd, shifted, voiceClear } from "./context";
import { gauss, timing } from "./feel";
import { seededRandom } from "./random";
import { weighted } from "./shape";
import { landing, nearest, twoBeat, walk } from "./swing";
import type { DrumSound, NoteEvent, Style } from "./types";

/**
 * Jazz ballad, slow 4/4 (about 55 to 65 BPM), triplet feel. Modelled on three
 * ballad backing tracks (context/style-ballad.md):
 * - Bass: half notes (root, then the fifth or an approach to the next chord) in
 *   the first chorus's A sections; walks in quarters in the bridge and later choruses.
 * - Piano: the only chord instrument. Rolled rootless voicings held through each
 *   chord, a soft re-attack or a short triplet arpeggio in bars with one chord.
 * - Drums: brushes. A sweep every two beats, a brush stroke and the hi-hat foot
 *   on 2 and 4, a barely-there kick; a triplet of strokes at section ends.
 * - Breathing (whole-take measurements against the three references): every part in its
 *   timing pocket (feel.ts), the top of each rolled chord voiced louder, the piano's
 *   register and level moving with the phrase, the bass picking up into some bars, and
 *   a few comping and brush variations, so no two bars are the same.
 * - Straight (`Feel.variation`): rolled chords on each change and brushes, nothing added,
 *   one level and register.
 */

/** Offbeats fall on the third triplet of the beat. */
const TRIPLET = 1 / 3;
/** Seconds the piano and bass samplers fade after a note ends (src/audio/player.ts): both still sound then. */
export const PIANO_RELEASE = 0.9;
export const BASS_RELEASE = 0.25;
/** Beats between notes of a rolled chord, low to high. */
const ROLL = 0.025;

export const ballad: Style = {
  id: "ballad",
  name: "Ballad",
  band: ["bass", "piano", "drums"],
  // Bass leads; the upper band (piano brightness, brushes) measured 4 dB over the references.
  mix: { bass: 13, piano: 2.5, drums: 3.5 },
  generate(bars, seed, feel) {
    const random = seededRandom(seed);
    const human = (v: number, spread = 0.06) => Math.min(1, Math.max(0.05, v + (random() - 0.5) * spread));
    const clock = timing(random, feel?.tempo ?? 62);
    /** Seconds as beats at the tempo. */
    const beats = (seconds: number) => (seconds * (feel?.tempo ?? 62)) / 60;
    const events: NoteEvent[] = [];
    const music = bars.filter((b) => !b.countIn);
    const first = music[0]?.startBeat ?? 0;
    const place = (time: number, part: Parameters<typeof clock.at>[0]) => Math.max(first, time + clock.at(part));
    const drum = (time: number, sound: DrumSound, velocity: number, spread = 0.06) =>
      events.push({ track: "drums", drum: sound, time: place(time, sound === "kick" ? "kick" : sound === "pedal" ? "pedal" : "snare"), duration: 0.5, velocity: human(velocity, spread) });
    /** A chord rolled from the bottom up, every note held to the same end; the top note sings out a little, the inner notes sit under it. */
    const roll = (time: number, notes: number[], length: number, velocity: number) => {
      const start = place(time, "piano");
      const top = notes.length - 1;
      notes.forEach((n, k) =>
        events.push({ track: "piano", time: start + k * ROLL, duration: Math.max(0.3, length - k * ROLL), velocity: human(velocity * (k === top ? 1.1 : k === 0 ? 0.98 : 0.9)), notes: [n] }),
      );
    };

    const straight = feel?.variation === "straight";
    let piano: number[] | null = null;
    let bassNote = 39; // Eb2
    let register = 0;
    let phraseDb = 0;
    let slope = 0;
    let chorus = -1;
    let pastBridge = false;
    /** The last bass notes of the bar before, which may still ring under the next chord. */
    let recentBass: NoteEvent[] = [];
    /** The next bar's first bass note, as this bar's approach aimed at it. */
    let planned: number | null = null;

    music.forEach((bar: TimelineBar, i) => {
      const t = bar.startBeat;
      const next = music[i + 1];
      clock.bar();
      // The form builds: Garner's 1954 record plays the bridge and the last A loudest (per-bar
      // level -22 to -12 dB), so the bridge lifts 1.5 dB and the section after it 2.5.
      if (bar.chorus !== chorus) [chorus, pastBridge] = [bar.chorus, false];
      if (bar.contrast) pastBridge = true;
      const sectionDb = straight || bar.ref?.part !== "form" ? 0 : bar.contrast ? 1.5 : pastBridge ? 2.5 : 0;
      // The phrase breathes: each four bars hold, swell or fall back a little, and the
      // piano's hand moves up or down now and then.
      const inPhrase = (bar.ref?.bar ?? i) % 4;
      if (!straight && inPhrase === 0) {
        phraseDb = gauss(random) * 1.1;
        slope = weighted([{ weight: 0.45, value: 0 }, { weight: 0.35, value: 0.9 }, { weight: 0.2, value: -0.9 }], random);
        if (random() < 0.5) register = weighted([{ weight: 0.6, value: -3 }, { weight: 1, value: 0 }, { weight: 0.8, value: 3 }, { weight: 0.3, value: 5 }], random, register);
      }
      const lift = straight ? 1 : (bar.chorus <= 1 ? 0.94 : 1.04) * 10 ** ((sectionDb + phraseDb + slope * (inPhrase - 1.5) + gauss(random) * 0.5) / 20);
      const range: VoicingRange = shifted(PIANO_RANGE, register);

      if (bar.final) {
        // Each chord of the last bar on its beat, the last one rolled and held like a fermata, the bass
        // with it (past the sample's length the sampler fades it out inside the sample).
        const notes: number[] = [];
        bar.chords.forEach((c, k) => notes.push((bassNote = k === 0 && planned !== null ? planned : landing(c.chord.bass, bassNote))));
        bar.chords.forEach((c, k) => {
          const last = k === bar.chords.length - 1;
          const n = notes[k];
          const hold = last ? Math.max(6 - c.beat, 3) : c.length - 0.05;
          events.push({ track: "bass", time: t + c.beat, duration: last ? hold : c.length - 0.1, velocity: last ? 0.74 : 0.76, notes: [n] });
          // Clear of this chord's bass and of the next one's, which its release rings over.
          piano = voiceClear(c.chord, piano, PIANO_RANGE, last ? null : bar.chords[k + 1].chord, Math.max(n, notes[k + 1] ?? n));
          roll(t + c.beat, piano, hold, last ? 0.5 : 0.44);
          drum(t + c.beat, "brush", last ? 0.55 : 0.45, 0);
          if (last) drum(t + c.beat, "crash", 0.3, 0);
        });
        return;
      }

      // Bass: half notes early on, walking once the tune opens up.
      const bassFrom = events.length;
      const twoFeel = bar.chorus <= 1 && !bar.contrast;
      // Each chord's first note, worked out once (swing.ts `landing`): the line starts there and the
      // approach before it aims at it, so an approach always resolves by a half or whole step.
      // Which octave a new chord lands in moves a little from chorus to chorus (seeded noise on the
      // landing, as swing.ts does), so the same bar doesn't start every chorus on the same note; the
      // same bass note again stays put, and after a short chord the landing stays within a fifth.
      const land = (pc: number, from: number, beats = 4) => {
        if (((from % 12) + 12) % 12 === pc) return from;
        const reach = beats <= 2 ? 7 : 9;
        let steady = landing(pc, from);
        if (Math.abs(steady - from) > reach) steady = nearest(pc, from);
        if (straight) return steady;
        const moved = landing(pc, from, gauss(random) * 3);
        return Math.abs(moved - from) <= reach ? moved : steady;
      };
      const starts: number[] = [];
      bar.chords.forEach((c, k) => starts.push(k === 0 ? (planned ?? land(c.chord.bass, bassNote)) : land(c.chord.bass, starts[k - 1], bar.chords[k - 1].length)));
      let nextFirst = next?.chords[0] ? land(next.chords[0].chord.bass, starts.at(-1) ?? bassNote, bar.chords.at(-1)!.length) : null;
      bar.chords.forEach((c, k) => {
        const following = bar.chords[k + 1] ?? next?.chords[0];
        let target = k + 1 < bar.chords.length ? starts[k + 1] : nextFirst;
        if (twoFeel) {
          const changing = target !== null && following!.chord !== c.chord;
          const line = twoBeat(c.chord, c.length, bassNote, target, changing, random, starts[k]);
          // The fifth on 3 takes the octave nearer the next chord's first note, so a fifth a step
          // from it moves there by step instead of leaping a seventh.
          if (line.length === 2 && target !== null && Math.abs(line[1][1] - target) > 7) {
            const other = line[1][1] + (target > line[1][1] ? 12 : -12);
            if (other >= BASS_LOW && other <= BASS_HIGH && Math.abs(other - line[0][1]) <= 12) line[1][1] = other;
            else {
              // No room for that octave: the next chord lands an octave nearer the fifth instead.
              const moved = target + (line[1][1] > target ? 12 : -12);
              if (moved >= BASS_LOW && moved <= BASS_HIGH) {
                target = moved;
                if (k + 1 < bar.chords.length) starts[k + 1] = moved;
                else nextFirst = moved;
              }
            }
          }
          // Now and then a pickup into the next chord on the last triplet of 4, the second half note shortened for it.
          const pickup = !straight && changing && target !== null && c.length >= 4 && line.length === 2 && random() < 0.22;
          line.forEach(([beat, n], j) =>
            events.push({ track: "bass", time: place(t + c.beat + beat, "bass"), duration: j === 0 ? Math.min(c.length, 2) - 0.1 : pickup ? 1.55 : 1.9, velocity: human(j === 0 ? 0.8 : 0.72), notes: [n] }),
          );
          if (pickup) events.push({ track: "bass", time: place(t + c.beat + 3 + 2 * TRIPLET, "bass"), duration: TRIPLET - 0.03, velocity: human(0.56), notes: [target! + (target! > line[1][1] ? -1 : 1)] });
          bassNote = line.at(-1)![1];
          return;
        }
        // The scale follows where the chord goes, as the piano's voicing does (a dominant into minor walks Phrygian dominant).
        const line = walk(c.chord, c.length, bassNote, target, random, 0, 0.6, { start: starts[k], next: chordAfter(music, i, c.beat), vary: straight ? 0 : 1 });
        line.forEach((n, b) => {
          // A triplet skip before the next note now and then, the ballad's swing.
          const skip = !straight && b < line.length - 1 && random() < 0.1;
          events.push({ track: "bass", time: place(t + c.beat + b, "bass"), duration: skip ? 2 * TRIPLET - 0.04 : 0.95, velocity: human((b === 0 ? 0.8 : 0.7) + gauss(random) * 0.04), notes: [n] });
          if (skip) events.push({ track: "bass", time: place(t + c.beat + b + 2 * TRIPLET, "bass"), duration: TRIPLET - 0.03, velocity: human(0.5), notes: [n] });
        });
        bassNote = line.at(-1)!;
      });
      planned = nextFirst;

      // Piano: rolled chords held through each change, clear of the bass under them: the lowest
      // note at least a minor third above the highest bass note while the chord sounds (Misty's
      // Bb7 had its 9th at C3 over a Bb2 bass).
      // A chord counts as sounding through its release (the piano sampler's 0.9 s), so it also clears
      // the next bar's first bass note; a bass note counts through its own release (0.25 s).
      const played = events.slice(bassFrom).filter((e) => e.track === "bass");
      const barBass = [...recentBass, ...played];
      if (nextFirst !== null && next) barBass.push({ track: "bass", time: next.startBeat, duration: 1, velocity: 0, notes: [nextFirst] });
      recentBass = [...recentBass, ...played].slice(-4);
      for (const c of bar.chords) {
        const sounding = bassUnder(barBass, t + c.beat - 0.05 - beats(BASS_RELEASE), t + c.beat + c.length + beats(PIANO_RELEASE));
        piano = voiceClear(c.chord, piano, range, chordAfter(music, i, c.beat), sounding);
        if (!c.attack && c.beat === 0) {
          // A held-over chord ("%"): touch it again softly on 1, or let it ring into the bar.
          if (straight) roll(t, piano, c.length - 0.1, 0.3);
          else if (random() < 0.75) {
            // Sometimes a triplet late, still letting go before the next bar's bass.
            const late = random() < 0.3 ? 2 * TRIPLET : 0;
            roll(t + late, piano, c.length - 0.1 - late, 0.3 * lift);
          }
          continue;
        }
        roll(t + c.beat, piano, c.length - 0.05, 0.44 * lift);
      }
      if (!straight && bar.chords.length === 1 && piano) {
        const chord = piano;
        const r = random();
        if (r < 0.3) {
          // A triplet arpeggio up the top of the voicing on beat 4 (or 2).
          const at = random() < 0.75 ? 3 : 1;
          chord.slice(-3).forEach((n, k) =>
            events.push({ track: "piano", time: place(t + at + k * TRIPLET, "piano"), duration: 1 - k * TRIPLET, velocity: human(0.3 * lift), notes: [n] }),
          );
        } else if (r < 0.52) {
          // A soft re-attack on the and of 2.
          roll(t + 1 + 2 * TRIPLET, chord, 2.2, 0.28 * lift);
        } else if (r < 0.64) {
          // A soft re-attack on 3.
          roll(t + 2, chord, 1.9, 0.27 * lift);
        } else if (r < 0.72) {
          // The top two notes answered an octave down on the and of 3.
          chord.slice(-2).forEach((n, k) =>
            events.push({ track: "piano", time: place(t + 2 + 2 * TRIPLET + k * ROLL, "piano"), duration: 1.2, velocity: human(0.24 * lift), notes: [n - 12 >= 55 ? n - 12 : n] }),
          );
        }
      }

      // Drums: brushes.
      const fill = endsSection(bar, next) && !next?.final && (!straight || isFormEnd(bar, next));
      for (const b of [0, 2]) drum(t + b, "brush", 0.5 * lift);
      for (const b of [1, 3]) {
        if (fill && b === 3) continue;
        drum(t + b, "brushTap", 0.42 * lift);
        drum(t + b, "pedal", 0.32);
      }
      // A swung tap before 2 or 4 now and then (the last triplet), the brush player's lilt.
      if (!straight && !fill && random() < 0.3) drum(t + (random() < 0.5 ? 2 * TRIPLET : 2 + 2 * TRIPLET), "brushTap", 0.26 * lift);
      for (const b of [0, 2]) drum(t + b, "kick", 0.1, 0.03);
      if (fill) {
        const strength = isFormEnd(bar, next) ? 0.08 : 0;
        [3, 3 + TRIPLET, 3 + 2 * TRIPLET].forEach((b, k) => drum(t + b, "brushTap", 0.36 + strength + k * 0.08));
        drum(t + 3, "pedal", 0.3);
      }
      const prev = music[i - 1];
      if (prev && isFormEnd(prev, bar) && bar.chorus > 1) drum(t, "crash", 0.22, 0.03);
    });

    return events.sort((a, b) => a.time - b.time);
  },
};
