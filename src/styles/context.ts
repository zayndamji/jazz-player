import type { ParsedChord } from "../chart/chords";
import { chordAt, sameRef, type TimelineBar } from "../engine/timeline";
import { voiceChord, type VoiceContext, type VoicingRange } from "../engine/voicing";
import type { NoteEvent } from "./types";

/**
 * What every style asks about where a note sits: the next chord, the bass under a hit, the
 * instruments' ranges, and where a bar falls in the form. One implementation each, shared by
 * the styles; a style that needs a different reach or tolerance passes it.
 */

/** E1, an upright's open low string: the lowest bass note, and the bass sample's floor. */
export const BASS_LOW = 28;
/** D3, where a bass line normally turns back. */
export const BASS_HIGH = 50;
/** The top of the bass's range: a line through a long held chord may climb this far (G3). */
export const BASS_TOP = 55;
/** Seconds a bass note rings at most: the bass samples run out and the sampler fades a longer note inside the sample from about 2.7 s (`noteSpan` in src/audio/sprite.ts). */
export const BASS_RING = 2.6;
/** The lowest piano sample (A2): no piano note goes below it. */
export const PIANO_FLOOR = 45;

/** What the piano knows when it voices a chord: the chord after it, and the bass note sounding under it. */
export type VoicingContext = Pick<VoiceContext, "next" | "bass">;

/**
 * The next chord that differs from the one sounding at `beat` of bar `i`, for the voicing's (or the
 * line's) resolution: looking `ahead` bars past bar `i` at most, a chord in bar `i` counting only
 * when it starts more than `slack` beats after `beat`. Null at the end.
 */
export function chordAfter(bars: TimelineBar[], i: number, beat: number, ahead = 3, slack = 1e-6): ParsedChord | null {
  const current = bars[i] && chordAt(bars[i], beat)?.chord;
  for (let k = i; k <= i + ahead && k < bars.length; k++)
    for (const c of bars[k].chords) if ((k > i || c.beat > beat + slack) && c.chord.symbol !== current?.symbol) return c.chord;
  return null;
}

/** The highest bass note sounding between two times (beats), from the bass events given. */
export function bassUnder(bass: NoteEvent[], from: number, to: number): number | null {
  let top: number | null = null;
  for (const e of bass) if (e.time < to && e.time + e.duration > from) top = Math.max(top ?? -Infinity, ...(e.notes ?? []));
  return top;
}

/** The bass events among `events` as [beat in the bar starting at `barStart`, note]. */
export const bassOnsets = (events: NoteEvent[], barStart: number): [number, number][] =>
  events.filter((e) => e.track === "bass").map((e) => [e.time - barStart, e.notes![0]]);

/** The bass note struck last at or before `beat` (up to `slack` beats after it), from `[beat, note]` onsets in order; `fallback` when none has. */
export function bassStruck<T>(onsets: readonly (readonly [number, number])[], beat: number, slack: number, fallback: T): number | T {
  let found: number | T = fallback;
  for (const [at, note] of onsets) if (at <= beat + slack) found = note;
  return found;
}

/**
 * A voicing led from `previous` toward `next`, kept clear of the bass: its lowest note at least a
 * minor third above the highest bass note under it, so the two never crowd or cross.
 */
export function voiceClear(chord: ParsedChord, previous: number[] | null, range: VoicingRange, next: ParsedChord | null, bass: number | null): number[] {
  const context = { next, bass: bass ?? undefined };
  if (bass !== null && range.low <= bass + 2) {
    const clear = voiceChord(chord, previous, { ...range, low: bass + 3 }, context);
    if (clear.length && clear[0] > bass + 2) return clear;
  }
  return voiceChord(chord, previous, range, context);
}

/** A voicing range moved by `shift` half steps; its low end never under `floor` when one is given. */
export const shifted = (range: VoicingRange, shift: number, floor = -Infinity): VoicingRange => ({
  ...range,
  low: Math.max(floor, range.low + shift),
  high: range.high + shift,
  center: range.center + shift,
});

/** A bass note moved by octaves into E1 to G3. */
export const inBassRange = (n: number) => {
  let m = n;
  while (m < BASS_LOW) m += 12;
  while (m > BASS_TOP) m -= 12;
  return m;
};

/** Last safety net for the samples: piano notes at or above A2, bass notes at or above E1 (an octave up). */
export function keepInRange(events: NoteEvent[]): NoteEvent[] {
  for (const e of events) {
    if (!e.notes) continue;
    const floor = e.track === "bass" ? BASS_LOW : e.track === "piano" ? PIANO_FLOOR : -Infinity;
    if (!e.notes.some((n) => n < floor)) continue;
    const lifted = e.notes.map((n) => {
      let m = n;
      while (m < floor) m += 12;
      return m;
    });
    // Drop a note the lift lands on another, keeping each note's level and offset with it.
    const keep = lifted.map((n, k) => lifted.indexOf(n) === k);
    e.notes = lifted.filter((_, k) => keep[k]);
    if (e.levels) e.levels = e.levels.filter((_, k) => keep[k]);
    if (e.offsets) e.offsets = e.offsets.filter((_, k) => keep[k]);
  }
  return events;
}

/**
 * Keeps a held chord from striking one voicing over and over on a long vamp: when `force` is set
 * and `notes` repeats `last`, it moves to the neighbouring shape (`again` voices the chord from a
 * voicing moved a fourth or a third up or down: the next inversion, or in fourths the next stack
 * up or down the scale, as Tyner planes them), or else leaves out the top note.
 */
export function moveOn(notes: number[], last: number[] | null, force: boolean, again: (from: number[]) => number[]): number[] {
  if (!force || !last || notes.join() !== last.join()) return notes;
  for (const step of [5, -5, 3, -3, 8, -8]) {
    const other = again(notes.map((n) => n + step));
    if (other.length && other.join() !== notes.join()) return other;
  }
  return notes.length > 3 ? notes.slice(0, -1) : notes;
}

/** True when the bar after this one starts a new section (or the song ends). */
export function endsSection(bar: TimelineBar, next: TimelineBar | undefined): boolean {
  if (!bar.ref) return false;
  if (!next?.ref) return true;
  return next.ref.part !== bar.ref.part || next.ref.section !== bar.ref.section || next.ref.bar === 0;
}

/** True when this bar ends a pass through the form (the next bar starts the form again, or leaves it). */
export const isFormEnd = (bar: TimelineBar, next: TimelineBar | undefined) =>
  bar.ref?.part === "form" && (!next?.ref || next.ref.part !== "form" || next.chorus !== bar.chorus || sameRef(next.ref, { part: "form", section: 0, bar: 0 }));
