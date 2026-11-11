import { Chord, Interval } from "tonal";
import type { ChordSlot, ParsedBar } from "./types";

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Keys whose chords are spelled with flats. */
const FLAT_KEYS = new Set([1, 3, 5, 8, 10]);

export interface ParsedChord {
  symbol: string;
  /** Root pitch class, 0 = C. */
  root: number;
  /** Quality as written after the root, e.g. "m7", "7(#5)". */
  quality: string;
  /** Bass pitch class for slash chords, otherwise the root. */
  bass: number;
  /** Chord tones as semitones above the root, from tonal. */
  intervals: number[];
  /** Names of the chord's intervals, from tonal, e.g. ["1P", "3M", "5A", "7m"]. */
  intervalNames: string[];
}

const SYMBOL = /^([A-G])([#b♯♭]?)(.*?)(?:\/([A-G])([#b♯♭]?))?$/;

export function pitchClass(letter: string, accidental: string): number {
  const shift = accidental === "#" || accidental === "♯" ? 1 : accidental === "b" || accidental === "♭" ? -1 : 0;
  return (LETTER_PC[letter] + shift + 12) % 12;
}

/** Turn a written quality into a name tonal understands. */
export function normalizeQuality(quality: string): string {
  return quality
    .replace(/[()]/g, "")
    .replace(/[△Δ∆]/g, "maj")
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/^-/, "m")
    .replace(/^6\/9/, "69")
    .replace(/^maj$/, "");
}

export function parseChord(symbol: string): ParsedChord {
  const match = SYMBOL.exec(symbol.trim());
  if (!match) throw new Error(`Can't read chord symbol "${symbol}"`);
  const [, letter, accidental, quality, bassLetter, bassAccidental] = match;
  const root = pitchClass(letter, accidental);
  const tonalName = "C" + normalizeQuality(quality);
  const chord = Chord.get(tonalName);
  if (chord.empty) throw new Error(`Unknown chord quality "${quality}" in "${symbol}"`);
  return {
    symbol,
    root,
    quality,
    bass: bassLetter ? pitchClass(bassLetter, bassAccidental) : root,
    intervals: chord.intervals.map((name) => Interval.semitones(name) ?? 0),
    intervalNames: chord.intervals,
  };
}

/** Holds the chord before it for one slot, as lead sheets write "Am7 / / Fmaj7". */
export const BEAT = "/";

/**
 * Parse one bar string from a chart ("D", "Em7/A A7", "Am7 / / Fmaj7", "%").
 * Tokens split the bar evenly; a "/" token takes a slot without a new chord.
 */
export function parseBar(text: string, beatsPerBar: number): ParsedBar {
  const tokens = barTokens(text);
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "%")) {
    return { chords: [], repeat: true };
  }
  const step = beatsPerBar / tokens.length;
  const chords: ChordSlot[] = [];
  tokens.forEach((symbol, i) => {
    if (symbol !== BEAT) chords.push({ symbol, beat: i * step });
  });
  return { chords, repeat: false };
}

/** The tokens of a bar string, chords and "/" placeholders, in order. */
export function barTokens(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function prefersFlats(keyPc: number): boolean {
  return FLAT_KEYS.has(((keyPc % 12) + 12) % 12);
}

export function noteName(pc: number, flats: boolean): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12];
}

export function keyName(pc: number): string {
  return KEY_NAMES[((pc % 12) + 12) % 12];
}

/** Pitch class of a key's tonic, from a name like "D", "Bb" or "Em" (minor). */
export function keyPitchClass(key: string): number {
  const accidental = key.slice(1, 2);
  return pitchClass(key[0], accidental === "b" || accidental === "#" ? accidental : "");
}

/** True for minor keys, written with a trailing "m" ("Em", "F#m"). */
export const isMinorKey = (key: string) => key.endsWith("m");

/**
 * The major key whose spelling a key uses: the key itself, or the relative
 * major for a minor key (E minor is spelled like G major, with sharps).
 */
export const spellingPc = (tonicPc: number, minor: boolean) => (tonicPc + (minor ? 3 : 0)) % 12;

const MINOR_KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];

/** Name of a minor key's tonic, spelled as minor keys usually are (C#, not Db). */
export function minorKeyName(pc: number): string {
  return MINOR_KEY_NAMES[((pc % 12) + 12) % 12];
}

/** Transpose a chord symbol by semitones, spelling roots for the target key. */
export function transposeSymbol(symbol: string, semitones: number, targetKeyPc: number): string {
  if (semitones % 12 === 0) return symbol;
  const match = SYMBOL.exec(symbol.trim());
  if (!match) return symbol;
  const [, letter, accidental, quality, bassLetter, bassAccidental] = match;
  const flats = prefersFlats(targetKeyPc);
  const root = noteName(pitchClass(letter, accidental) + semitones, flats);
  const bass = bassLetter ? "/" + noteName(pitchClass(bassLetter, bassAccidental) + semitones, flats) : "";
  return root + quality + bass;
}

/** Pieces for drawing a chord symbol: root, superscript quality, slash bass. */
export function displayParts(symbol: string): { root: string; quality: string; bass: string } {
  const match = SYMBOL.exec(symbol.trim());
  if (!match) return { root: symbol, quality: "", bass: "" };
  const [, letter, accidental, quality, bassLetter, bassAccidental] = match;
  const pretty = (s: string) => s.replace(/#/g, "♯").replace(/b/g, "♭");
  const prettyQuality = quality
    .replace(/^maj7/, "Δ7")
    .replace(/^maj9/, "Δ9")
    .replace(/#/g, "♯")
    .replace(/(?<![a-z])b(?=\d)/g, "♭");
  return {
    root: letter + pretty(accidental),
    quality: prettyQuality,
    bass: bassLetter ? bassLetter + pretty(bassAccidental) : "",
  };
}
