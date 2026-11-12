import type { Chart } from "../chart/types";
import { child, childrenOf, parseXml, textOf } from "../import/xml";
import type { NoteEvent } from "../styles/types";
import { chartBars, type BarRef, type TimelineBar } from "./timeline";

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

/**
 * The melody as note events on the timeline. A playing bar takes the notes of the printed measure it
 * is numbered as on the lead sheet (`sheetNumber`, the same mapping the sheet's highlight uses), in the
 * bar's own key. `plays` says which bars sound the melody. A tie over a barline holds only when the next
 * playing bar is the next printed measure; otherwise the note stops at the end of its bar. While trading,
 * the drums' and the band-out turns stay silent.
 */
export function melodyEvents(chart: Chart, bars: TimelineBar[], measures: MelodyNote[][], plays: (bar: TimelineBar) => boolean): NoteEvent[] {
  const sheet = new Map(chartBars(chart).map((b) => [key(b.ref), b.sheetNumber]));
  const sounding = (bar: TimelineBar | undefined) => !!bar && !!bar.ref && !bar.countIn && bar.trade !== "drums" && bar.trade !== "out" && plays(bar);
  const numberOf = (bar: TimelineBar) => sheet.get(key(bar.ref!));
  const events: NoteEvent[] = [];
  bars.forEach((bar, i) => {
    if (!sounding(bar)) return;
    const n = numberOf(bar);
    const notes = n === undefined ? undefined : measures[n - 1];
    if (!notes) return;
    const next = bars[i + 1];
    const continues = sounding(next) && numberOf(next!) === n! + 1;
    for (const note of notes) {
      const length = continues ? note.length : Math.min(note.length, chart.beatsPerBar - note.start);
      if (length <= 0) continue;
      // Slightly legato: each note runs a little into the next.
      events.push({ track: "melody", time: bar.startBeat + note.start, duration: length + 0.05, velocity: melodyVelocity(length), notes: [note.midi + bar.transpose] });
    }
  });
  return events;
}
