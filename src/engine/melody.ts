import type { Chart } from "../chart/types";
import { child, childrenOf, parseXml, textOf } from "../import/xml";
import { gauss } from "../styles/feel";
import { seededRandom } from "../styles/random";
import { EVEN_SWING, swingRatio } from "../styles/swing";
import type { NoteEvent } from "../styles/types";
import { chartBars, type BarRef, type TimelineBar } from "./timeline";
import { GUITAR_RANGE, VOICING_LOW, voicingOptions } from "./voicing";

/** When the band's lead line plays: never, in the head choruses (and the intro and ending), or in every chorus. */
export type MelodyMode = "off" | "head" | "every";
export const MELODY_MODES: MelodyMode[] = ["off", "head", "every"];
export const MELODY_LABELS: Record<MelodyMode, string> = { off: "Off", head: "Head choruses", every: "Every chorus" };

/** One melody note of a printed measure, in concert pitch. Times are beats (quarter notes) from the start of the measure. */
export interface MelodyNote {
  /** MIDI note number, C4 = 60. */
  midi: number;
  start: number;
  /** Sounding length; a note tied over a barline holds its whole length here, so it can pass the measure's end. */
  length: number;
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * The melody of a head (MusicXML) as notes for each printed measure, in order (index 0 is bar 1).
 * Voice 1 only; rests are skipped; a tied note is one note, kept in the measure it starts in; notes in a
 * `<chord/>` group are separate notes at the same start; grace notes are left out. `<duration>` already
 * holds triplets and other tuplets, so it is not scaled again. A part's `<transpose>` (a transposing part
 * written as the player reads it) is added, so the pitches are concert pitch.
 */
export function parseMelody(xml: string): MelodyNote[][] {
  const part = child(parseXml(xml), "part");
  if (!part) return [];
  let divisions = 1;
  let shift = 0;
  const pending = new Map<number, MelodyNote>();
  return childrenOf(part, "measure").map((measure) => {
    for (const attrs of childrenOf(measure, "attributes")) {
      const d = Number(textOf(attrs, "divisions"));
      if (d > 0) divisions = d;
      const t = child(attrs, "transpose");
      if (t) shift = (Number(textOf(t, "chromatic")) || 0) + 12 * (Number(textOf(t, "octave-change")) || 0);
    }
    const notes: MelodyNote[] = [];
    let cursor = 0;
    let lastStart = 0;
    for (const el of measure.children) {
      const amount = Number(textOf(el, "duration")) || 0;
      if (el.name === "backup") cursor = Math.max(0, cursor - amount);
      else if (el.name === "forward") cursor += amount;
      else if (el.name === "note") {
        const chord = !!child(el, "chord");
        const start = chord ? lastStart : cursor;
        if (!chord) {
          lastStart = start;
          cursor += amount;
        }
        const pitch = child(el, "pitch");
        if (!pitch || child(el, "rest") || child(el, "grace") || child(el, "cue") || (textOf(el, "voice") ?? "1") !== "1") continue;
        const step = STEP[textOf(pitch, "step") ?? ""];
        if (step === undefined || amount <= 0) continue;
        const midi = 12 * (Number(textOf(pitch, "octave")) + 1) + step + Math.round(Number(textOf(pitch, "alter")) || 0) + shift;
        const tied = [...childrenOf(el, "tie"), ...childrenOf(child(el, "notations"), "tied")].map((t) => t.attrs.type);
        const length = amount / divisions;
        const held = tied.includes("stop") ? pending.get(midi) : undefined;
        if (held) {
          held.length += length;
          if (!tied.includes("start")) pending.delete(midi);
          continue;
        }
        const note = { midi, start: start / divisions, length };
        notes.push(note);
        if (tied.includes("start")) pending.set(midi, note);
      }
    }
    return notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  });
}

const key = (r: BarRef) => `${r.part}.${r.section}.${r.bar}`;

/** Velocity of a melody note: steady, a little louder on longer notes. */
export const melodyVelocity = (length: number) => 0.56 + 0.12 * Math.min(1, Math.max(0, (length - 0.5) / 2.5));

/** The ballad's laid-back triplet feel: the offbeat eighth a hair before the last triplet. */
export const BALLAD_SWING = 0.66;

/**
 * Where the melody's offbeat eighths fall in the beat (0.5 straight, 2/3 triplet), so the lead
 * swings with the band: swing uses the swing style's tempo curve (`swingRatio`), the waltz and
 * 5/4 the curve their styles use (`EVEN_SWING`), the ballad a laid-back triplet, bossa straight.
 * The band adds a small per-chorus wander on top; the melody takes the base ratio.
 */
export function melodySwing(styleId: string, bpm: number): number {
  switch (styleId) {
    case "swing":
      return swingRatio(bpm);
    case "waltz":
    case "five":
      return swingRatio(bpm, EVEN_SWING);
    case "ballad":
      return BALLAD_SWING;
    default:
      return 0.5;
  }
}

/** How the melody is played rather than printed. */
export interface MelodyFeel {
  /**
   * Where an offbeat eighth falls in the beat: 0.5 (the default) plays it as written, 2/3 a triplet swing;
   * or a ratio per bar, for a tune whose sections play in different styles (Latin A's straight, a swing bridge).
   */
  swing?: number | ((bar: TimelineBar) => number);
  /** Tempo in BPM; with it each note gets a small seeded timing error and sits a little behind the beat. */
  bpm?: number;
  /** Seed for the timing error. */
  seed?: number;
}

const EPS = 1e-6;
const frac = (t: number) => t - Math.floor(t + EPS);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/**
 * A warp of a measure's beat positions for a swing ratio: a point on the offbeat eighth (x.5)
 * moves to x + ratio; everything else stays. Beats holding 16ths (a start or end on x.25 or x.75)
 * stay straight, as a player plays a 16th run evenly. Triplets, quarters and longer are untouched.
 */
function swingWarp(notes: MelodyNote[], ratio: number): (t: number) => number {
  if (near(ratio, 0.5)) return (t) => t;
  const even = new Set<number>();
  const sixteenth = (t: number) => near(frac(t), 0.25) || near(frac(t), 0.75);
  for (const n of notes) {
    if (sixteenth(n.start)) even.add(Math.floor(n.start + EPS));
    const end = n.start + n.length;
    if (sixteenth(end)) even.add(Math.floor(end + EPS));
  }
  return (t) => {
    const beat = Math.floor(t + EPS);
    return near(t - beat, 0.5) && !even.has(beat) ? beat + ratio : t;
  };
}

/**
 * The lead player's timing in beats for each note: laid back 12 ms at 80 BPM down to 5 ms at 240,
 * with a seeded error (SD 5 ms slow to 2.5 ms fast, clamped to two SDs), so the clamp keeps every
 * note within about 2 to 22 ms behind the grid.
 */
function leadTiming(bpm: number, seed: number) {
  const random = seededRandom(seed);
  const fast = Math.max(0, Math.min(1, (bpm - 80) / 160));
  const behind = 12 - 7 * fast;
  const spread = 5 - 2.5 * fast;
  return () => {
    const ms = behind + Math.max(-2, Math.min(2, gauss(random))) * spread;
    return (Math.max(0, ms) / 1000) * (bpm / 60);
  };
}

/**
 * The melody as note events on the timeline. A playing bar takes the notes of the printed measure it
 * is numbered as on the lead sheet (`sheetNumber`, the same mapping the sheet's highlight uses), in the
 * bar's own key. `plays` says which bars sound the melody. A tie over a barline holds only when the next
 * playing bar is the next printed measure; otherwise the note stops at the end of its bar. While trading,
 * the drums' and the band-out turns stay silent. `feel` swings the offbeat eighths (the on-beat eighth
 * before stretches to meet them) and, with a tempo, adds the player's timing.
 */
export function melodyEvents(chart: Chart, bars: TimelineBar[], measures: MelodyNote[][], plays: (bar: TimelineBar) => boolean, feel: MelodyFeel = {}): NoteEvent[] {
  const sheet = new Map(chartBars(chart).map((b) => [key(b.ref), b.sheetNumber]));
  const sounding = (bar: TimelineBar | undefined) => !!bar && !!bar.ref && !bar.countIn && bar.trade !== "drums" && bar.trade !== "out" && plays(bar);
  const numberOf = (bar: TimelineBar) => sheet.get(key(bar.ref!));
  const lag = feel.bpm ? leadTiming(feel.bpm, feel.seed ?? 23) : () => 0;
  const events: NoteEvent[] = [];
  bars.forEach((bar, i) => {
    if (!sounding(bar)) return;
    const n = numberOf(bar);
    const notes = n === undefined ? undefined : measures[n - 1];
    if (!notes) return;
    const next = bars[i + 1];
    const continues = sounding(next) && numberOf(next!) === n! + 1;
    const warp = swingWarp(notes, typeof feel.swing === "function" ? feel.swing(bar) : (feel.swing ?? 0.5));
    let last: { start: number; time: number } | undefined;
    for (const note of notes) {
      const length = continues ? note.length : Math.min(note.length, chart.beatsPerBar - note.start);
      if (length <= 0) continue;
      const start = warp(note.start);
      const played = warp(note.start + length) - start;
      // Notes of one chord group share the player's timing.
      const time = last && near(last.start, note.start) ? last.time : bar.startBeat + start + lag();
      last = { start: note.start, time };
      // Slightly legato: each note runs a little into the next.
      events.push({ track: "melody", time, duration: played + 0.05, velocity: melodyVelocity(length), notes: [note.midi + bar.transpose] });
    }
  });
  return events;
}

/** A comping gesture: one event with all its notes, or a roll written as single-note events a few ms apart. */
type Gesture = { idx: number[]; track: NoteEvent["track"]; start: number; end: number };

/** Beats between the notes of a roll written as separate events, at most (the ballad's is 0.025). */
const ROLL_GAP = 0.04;
/** Less overlap than this (beats) is a legato tail or a pocket offset, not sounding together. */
const MIN_OVERLAP = 0.06;

const endOf = (e: NoteEvent) => e.time + e.duration;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) >= MIN_OVERLAP;

/** The comping gestures of a list of events, in time order. */
function gestures(events: NoteEvent[]): Gesture[] {
  const order = events.map((_, k) => k).filter((k) => (events[k].track === "piano" || events[k].track === "guitar") && events[k].notes?.length);
  order.sort((a, b) => events[a].time - events[b].time);
  const out: Gesture[] = [];
  const open = new Map<string, Gesture>();
  for (const k of order) {
    const e = events[k];
    const g = e.notes!.length === 1 ? open.get(e.track) : undefined;
    const last = g && events[g.idx.at(-1)!];
    if (g && last && e.time - last.time <= ROLL_GAP && e.notes![0] > last.notes![0] && Math.abs(endOf(e) - g.end) <= 0.05) {
      g.idx.push(k);
      g.end = Math.max(g.end, endOf(e));
      continue;
    }
    const next: Gesture = { idx: [k], track: e.track, start: e.time, end: endOf(e) };
    out.push(next);
    if (e.notes!.length === 1) open.set(e.track, next);
    else open.delete(e.track);
  }
  return out;
}

/** A sorted list of events by time, and the ones that sound within a span. */
function sounding(list: NoteEvent[]) {
  const sorted = list.filter((e) => e.notes?.length).sort((a, b) => a.time - b.time);
  const longest = sorted.reduce((x, e) => Math.max(x, e.duration), 0);
  return (start: number, end: number): NoteEvent[] => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].time < start - longest) lo = mid + 1;
      else hi = mid;
    }
    const out: NoteEvent[] = [];
    for (let k = lo; k < sorted.length && sorted[k].time < end; k++) if (overlap(start, end, sorted[k].time, endOf(sorted[k]))) out.push(sorted[k]);
    return out;
  };
}

/** How far a voicing is from another, note by note (or to the nearest note when the sizes differ). */
function voicingDistance(a: number[], b: number[]): number {
  if (a.length === b.length) return a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0);
  return a.reduce((sum, n) => sum + Math.min(...b.map((m) => Math.abs(n - m))), 0) + 6 * Math.abs(a.length - b.length);
}

/**
 * The voicing of these notes' pitch classes, close or drop-2 and playable (`voicingOptions`: no seconds
 * low down), between `low` and `high` and nearest the original; failing that, the same with one pitch
 * class left out; failing that, the original without the notes outside the span (so no new intervals).
 */
function revoice(original: number[], low: number, high: number): number[] {
  const pcs = [...new Set(original.map((n) => n % 12))];
  const best = (sets: number[][]) => {
    let pick: number[] | null = null;
    let score = Infinity;
    for (const set of sets) {
      for (const o of voicingOptions(set, { low, high, center: (low + high) / 2 })) {
        const d = voicingDistance(o.notes, original) - 0.5 * o.notes.at(-1)! / 100;
        if (d < score) [pick, score] = [o.notes, d];
      }
    }
    return pick;
  };
  return best([pcs]) ?? (pcs.length > 2 ? best(pcs.map((_, k) => pcs.filter((__, j) => j !== k))) : null) ?? original.filter((n) => n >= low && n <= high);
}

/**
 * Keeps the piano's and guitar's voicings under the melody. A comping gesture (an event's chord, or a roll
 * written as single-note events) that sounds with a melody note and reaches a half step under the lowest
 * such melody note, or higher, is re-voiced whole: its pitch classes as the playable close or drop-2 voicing
 * (`voicingOptions`) nearest the original with its top at least a whole step under the melody and its lowest
 * note at least a minor third over the bass sounding with it (and not below C3, or E3 on guitar, unless the
 * original was). When nothing fits, one pitch class is left out; failing that, the notes over the melody
 * (or on the bass) are dropped. The new notes take the original's slots in order, low to high (offsets,
 * roll times), the top note the original top's level or velocity. Other tracks pass through. Returns new
 * events; a gesture left with no notes is removed.
 */
export function fitUnderMelody(events: NoteEvent[], melody: NoteEvent[]): NoteEvent[] {
  const lead = sounding(melody);
  const bass = sounding(events.filter((e) => e.track === "bass"));
  const replaced = new Map<number, NoteEvent[]>();
  for (const g of gestures(events)) {
    const tops = lead(g.start, g.end);
    if (!tops.length) continue;
    const ceiling = Math.min(...tops.flatMap((m) => m.notes!)) - 2;
    const parts = g.idx.map((k) => events[k]);
    const single = parts.length > 1 || parts[0].notes!.length === 1;
    // The notes low to high with where each came from: [pitch, event, note index].
    const slots = parts.flatMap((e, p) => e.notes!.map((n, j) => [n, p, j] as const)).sort((a, b) => a[0] - b[0]);
    const original = slots.map((s) => s[0]);
    if (original.at(-1)! <= ceiling) continue;
    const under = bass(g.start, g.end).flatMap((b) => b.notes!);
    const low = Math.max(under.length ? Math.max(...under) + 3 : 0, Math.min(original[0], g.track === "guitar" ? GUITAR_RANGE.low : VOICING_LOW));
    const notes = revoice(original, low, ceiling).sort((a, b) => a - b);
    const m = notes.length;
    // Note i takes slot i; the top note keeps the original top's level.
    const from = (i: number) => (i === m - 1 ? slots.length - 1 : i);
    if (single) {
      replaced.set(
        g.idx[0],
        notes.map((n, i) => {
          const at = parts[slots[i][1]];
          const voice = parts[slots[from(i)][1]];
          return { ...at, velocity: voice.velocity, notes: [n], ...(voice.levels ? { levels: [...voice.levels] } : {}) };
        }),
      );
      for (const k of g.idx.slice(1)) replaced.set(k, []);
      continue;
    }
    const e = parts[0];
    // Slots of one event: its offsets low to high as written, its levels with the voice.
    const offsets = e.offsets && slots.map((s) => e.offsets![s[2]]);
    const levels = e.levels && slots.map((s) => e.levels![s[2]]);
    const next: NoteEvent = { ...e, notes };
    if (offsets) next.offsets = notes.map((_, i) => offsets[i]);
    if (levels) next.levels = notes.map((_, i) => levels[from(i)]);
    replaced.set(g.idx[0], m ? [next] : []);
  }
  return events.flatMap((e, k) => replaced.get(k) ?? [e]);
}
