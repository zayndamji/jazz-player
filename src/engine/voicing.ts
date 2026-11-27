import { minorKeyDominant, minorKeyTensions, type ParsedChord } from "../chart/chords";

/**
 * Four-note jazz piano voicings without the root (the bass has it):
 * 3rd, 5th (or 13th on dominants), 7th (or 6th), and 9th.
 *
 * No two voices a minor ninth apart (`hasMinorNinth`), unless no shape fits without one.
 * Spacing: drop-2 shapes (the second voice from the top dropped an octave)
 * spread the chord over about an octave and a half, the open sound of bossa
 * piano and guitar. Close shapes are kept as options, but seconds and thirds
 * below G3 are ruled out because they sound muddy in that register, and below E3
 * the lowest voice is a guide tone (3rd or 7th). Each new voicing is the option
 * closest to the previous one, for smooth voice leading. An optional context gives
 * the next chord (a V7 into minor takes b9 and b13), a ceiling (stay under the
 * melody) and the bass note (stay a minor third above it).
 */

const has = (c: ParsedChord, name: string) => c.intervalNames.includes(name);

/** Written tensions that keep a dominant from taking the minor-key b9 and b13. */
const DOMINANT_TENSIONS = ["9m", "9M", "9A", "13m", "13M", "5A", "5d", "11A"];

/**
 * Semitones above the root of the four voiced tones, in the order 3rd (or 4th),
 * 5th or colour tone, 7th (or 6th), 9th; the first and third are the guide tones.
 * `next` is the chord that follows: a dominant heard in a minor key (`minorKeyDominant`:
 * down a fifth to a minor chord, or deceptively up a half step to a major one) takes the
 * b9 and b13 (3, b13, b7, b9) when nothing or only the b9 is written, or the natural 9 where the key
 * has it and not the b9 (a V of ii in major, `minorKeyTensions`). Other written tensions win.
 */
export function voicingIntervals(c: ParsedChord, next?: ParsedChord | null): number[] {
  const h = (name: string) => has(c, name);
  const minor = h("3m");
  const major = h("3M");
  const sus = !minor && !major && (h("4P") || h("11P"));
  const ninth = h("9m") ? 1 : h("9A") ? 3 : 2;

  if (minor && h("5d")) {
    if (h("7m")) return [3, 6, 10, 0]; // half-diminished
    return [3, 6, 9, h("7M") ? 11 : 2]; // diminished: b3, b5, bb7, and the 9th (or a written major 7th)
  }
  // A flat 13 is voiced like a raised fifth.
  const flat13 = h("5A") || h("13m") || h("6m");
  const sharp11 = h("11A") || h("5d");
  const seventh = h("7M") ? 11 : h("7m") ? 10 : h("6M") || h("13M") ? 9 : null;

  if (minor) {
    const fifth = flat13 ? 8 : 7;
    // A plain minor triad keeps the root on top instead of a 7th (m add9), so a line
    // cliché (m, mMaj7, m7, m6) moves one voice by half steps from the root down.
    return [3, fifth, seventh ?? 0, ninth];
  }
  if (sus) return [5, h("13M") ? 9 : 7, seventh ?? 9, ninth]; // 4, 5 or 13, b7, 9: no 3rd under the 11th
  if (major && seventh === 10) {
    if (minorKeyDominant(c, next) && DOMINANT_TENSIONS.filter(h).every((t) => t === "9m")) {
      // The key's own 9th and 13th (`minorKeyTensions`); a written b9 stays.
      const t = minorKeyTensions(c, next);
      return [4, t.thirteenth, 10, h("9m") ? 1 : t.ninth];
    }
    // Colour tone: a written 13 or b13, else the #11 or b5, else b13 under a #9 (altered), else 13.
    const colour = h("13M") ? 9 : flat13 ? 8 : sharp11 ? 6 : h("9A") ? 8 : 9;
    // A written 13 with #11 voices the #11 in place of an unaltered 9th.
    const top = colour === 9 && h("11A") && ninth === 2 ? 6 : ninth;
    return [4, colour, 10, top];
  }
  const fifth = flat13 ? 8 : sharp11 ? 6 : 7;
  return [4, fifth, seventh ?? 9, ninth];
}

export const VOICING_LOW = 48; // C3
export const VOICING_HIGH = 79; // G5
/** Below this note, neighbouring voices must be at least a minor third apart. */
const LOW_INTERVAL_LIMIT = 55; // G3

/** Where an instrument's voicings sit. */
export interface VoicingRange {
  low: number;
  high: number;
  /** The middle of the voicing is pulled toward this note. */
  center: number;
  /**
   * Only shapes with the 3rd or 7th at the bottom (the jazz pianist's rootless "A" and "B"
   * voicings), close or drop-2. Keeps the 9th and 13th out of the bass register.
   */
  guideBottom?: boolean;
}

export const PIANO_RANGE: VoicingRange = { low: VOICING_LOW, high: VOICING_HIGH, center: 63 };
/** Swing comping: left-hand rootless voicings around middle C, guide tone at the bottom. */
export const SWING_RANGE: VoicingRange = { low: 50, high: 76, center: 61, guideBottom: true };
/** Nylon guitar, written range: sounds around E3 to D5. */
export const GUITAR_RANGE: VoicingRange = { low: 52, high: 74, center: 61 };

function closeShapes(pcs: number[], range: VoicingRange): number[][] {
  const out: number[][] = [];
  for (let start = 0; start < pcs.length; start++) {
    const order = [...pcs.slice(start), ...pcs.slice(0, start)];
    for (let bottom = range.low; bottom < range.low + 24; bottom++) {
      if (bottom % 12 !== order[0]) continue;
      const notes = [bottom];
      for (const pc of order.slice(1)) {
        let n = notes[notes.length - 1] + 1;
        while (n % 12 !== pc) n++;
        notes.push(n);
      }
      out.push(notes);
    }
  }
  return out;
}

const drop2 = (close: number[]) => {
  const v = [...close];
  const [dropped] = v.splice(v.length - 2, 1);
  return [dropped - 12, ...v];
};

function playable(v: number[], range: VoicingRange): boolean {
  if (v[0] < range.low || v[v.length - 1] > range.high) return false;
  for (let i = 1; i < v.length; i++) if (v[i - 1] < LOW_INTERVAL_LIMIT && v[i] - v[i - 1] < 3) return false;
  return true;
}

/**
 * True when two voices sit a minor ninth apart (13 half steps, or two octaves and a half step): the
 * harshest interval inside a voicing (the 13th under the 7th, the 9th under a minor 3rd), which
 * arrangers keep out of a chord. A b9 tension is still fine against the root, which the bass plays.
 */
export const hasMinorNinth = (notes: number[]) => notes.some((a, i) => notes.some((b, j) => j > i && (Math.abs(b - a) === 13 || Math.abs(b - a) === 25)));

/** Every voicing shape the piano may use for these pitch classes, lowest note first. */
export function voicingOptions(pcs: number[], range: VoicingRange = PIANO_RANGE): { notes: number[]; drop2: boolean }[] {
  const out: { notes: number[]; drop2: boolean }[] = [];
  for (const close of closeShapes(pcs, range)) {
    if (playable(close, range)) out.push({ notes: close, drop2: false });
    const d = drop2(close);
    if (playable(d, range)) out.push({ notes: d, drop2: true });
  }
  return out;
}

const distance = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0);

/** What the piano knows about the music around a chord. All optional. */
export interface VoiceContext {
  /** The chord that follows, for the tensions a resolution asks for (V7 to a minor chord). */
  next?: ParsedChord | null;
  /** MIDI note the top voice should stay at or under, such as the melody note. */
  ceiling?: number;
  /** The bass's MIDI note: the lowest voice stays at least a minor third above it. */
  bass?: number;
}

/** Below this note (E3) the lowest voice must be a guide tone (3rd or 7th), never the 9th or 13th. */
const LOW_GUIDE_LIMIT = 52;

/** MIDI notes for a chord, voice-led from the previous voicing. */
export function voiceChord(
  c: ParsedChord,
  previous: number[] | null,
  range: VoicingRange = PIANO_RANGE,
  context: VoiceContext = {},
): number[] {
  const intervals = voicingIntervals(c, context.next);
  const pcs = [...new Set(intervals.map((i) => (c.root + i) % 12))];
  let options = voicingOptions(pcs, range);
  const guides = [intervals[0], intervals[2]].filter((i) => i !== 0).map((i) => (c.root + i) % 12);
  // Each rule narrows the options, unless it would leave none.
  const keep = (rule: (notes: number[]) => boolean) => {
    const kept = options.filter((o) => rule(o.notes));
    if (kept.length) options = kept;
  };
  keep((notes) => notes[0] >= LOW_GUIDE_LIMIT || guides.includes(notes[0] % 12));
  const bass = context.bass;
  if (bass !== undefined) keep((notes) => notes[0] >= bass + 3);
  if (range.guideBottom) keep((notes) => guides.includes(notes[0] % 12));
  keep((notes) => !hasMinorNinth(notes));
  const ceiling = context.ceiling;
  if (ceiling !== undefined && options.length) {
    const lowestTop = Math.min(...options.map((o) => o.notes[o.notes.length - 1]));
    const limit = Math.max(ceiling, lowestTop);
    options = options.filter((o) => o.notes[o.notes.length - 1] <= limit);
  }
  const center = range.center;
  let best = options[0]?.notes ?? [];
  let bestScore = Infinity;
  for (const { notes, drop2: wide } of options) {
    const mid = (notes[0] + notes[notes.length - 1]) / 2;
    const lead = previous && previous.length === notes.length ? distance(notes, previous) : 0;
    // Bossa prefers the open drop-2 sound; swing comping prefers close shapes.
    const score = lead + Math.abs(mid - center) * 0.4 + (range.guideBottom ? (wide ? 2.5 : 0) : wide ? 0 : 2.5);
    if (score < bestScore) {
      bestScore = score;
      best = notes;
    }
  }
  return best;
}
