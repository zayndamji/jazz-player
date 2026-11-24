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
  /**
   * The major key the chart has the chord in (a minor key's relative major), as a pitch class; set by
   * `buildTimeline`. Picks a minor-key dominant's 9th and 13th (`minorKeyTensions`).
   */
  key?: number;
}

const SYMBOL = /^([A-G])([#b♯♭]?)(.*?)(?:\/([A-G])([#b♯♭]?))?$/;

export function pitchClass(letter: string, accidental: string): number {
  const shift = accidental === "#" || accidental === "♯" ? 1 : accidental === "b" || accidental === "♭" ? -1 : 0;
  return (LETTER_PC[letter] + shift + 12) % 12;
}

/** Turn a written quality into a name tonal understands. */
export function normalizeQuality(quality: string): string {
  const q = quality
    .replace(/[()\s,]/g, "")
    .replace(/[△Δ∆^]/g, "maj")
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/[°º]/g, "dim")
    .replace(/^ø(9|11|13)/, "m7b5add$1")
    .replace(/^ø7?/, "m7b5")
    .replace(/^(?:min|mi|-)/, "m")
    .replace(/^m9(?:maj|Maj|MA|Ma|M)7$/, "mMaj9")
    .replace(/^m(?:maj|Maj|MA|Ma|M)(?=\d|$)/, "mMaj")
    .replace(/^(?:Maj|MA|Ma|ma|M)(?=\d|$)/, "maj")
    .replace(/(?<=\d)\+(?=\d)/g, "#")
    .replace(/(?<=\d)-(?=\d)/g, "b")
    .replace(/(\d)\+$/, "$1#5")
    .replace(/^sus4?7/, "7sus4")
    .replace(/6\/9/, "69")
    .replace(/^alt$/, "7alt")
    .replace(/^maj$/, "");
  return q === "mMaj" ? "mMaj7" : q;
}

/** A trailing extension or alteration ("b9", "#11", "add9", "sus4") read on top of a base chord. */
const TAIL = /(?:(add|[b#])?(13|11|9|6|5|4|2)|sus([24])?)$/;
/** Interval quality letter for a written degree and accidental. */
const DEGREE_QUALITY: Record<string, Record<string, string>> = {
  2: { "": "M", b: "m", "#": "A" },
  4: { "": "P", "#": "A" },
  5: { "": "P", b: "d", "#": "A" },
  6: { "": "M", b: "m" },
  9: { "": "M", b: "m", "#": "A" },
  11: { "": "P", "#": "A" },
  13: { "": "M", b: "m" },
};

/**
 * Interval names for a normalized quality: tonal's reading, or, when tonal can't read
 * the whole name ("m7b9", "7#11b9", "m7b5add9"), a base tonal reads with the written
 * alterations applied on top. Null when neither works.
 */
function qualityIntervals(q: string): string[] | null {
  const whole = Chord.get("C" + q);
  if (!whole.empty) return whole.intervals;
  const tails: RegExpExecArray[] = [];
  let base = q;
  for (;;) {
    const m = TAIL.exec(base);
    // A bare number right after a digit belongs to it ("m7b59" is not "m7b5" plus a 9).
    if (!m || (!m[1] && !m[3] && /\d$/.test(base.slice(0, m.index)))) return null;
    tails.unshift(m);
    base = base.slice(0, m.index);
    const chord = Chord.get("C" + base);
    if (!chord.empty) return applyTails(chord.intervals, tails);
  }
}

function applyTails(base: string[], tails: RegExpExecArray[]): string[] | null {
  let names = [...base];
  for (const t of tails) {
    if (t[0].startsWith("sus")) {
      names = names.filter((n) => n !== "3M" && n !== "3m");
      names.push(t[3] === "2" ? "2M" : "4P");
      continue;
    }
    const degree = t[2];
    const quality = DEGREE_QUALITY[degree][t[1] === "add" || !t[1] ? "" : t[1]];
    if (!quality) return null;
    names = names.filter((n) => n.replace(/[A-Za-z]+$/, "") !== degree);
    names.push(degree + quality);
  }
  return names.sort((a, b) => (Interval.semitones(a) ?? 0) - (Interval.semitones(b) ?? 0));
}

export function parseChord(symbol: string): ParsedChord {
  const match = SYMBOL.exec(symbol.trim());
  if (!match) throw new Error(`Can't read chord symbol "${symbol}"`);
  const [, letter, accidental, quality, bassLetter, bassAccidental] = match;
  const root = pitchClass(letter, accidental);
  const names = qualityIntervals(normalizeQuality(quality));
  if (!names) throw new Error(`Unknown chord quality "${quality}" in "${symbol}"`);
  return {
    symbol,
    root,
    quality,
    bass: bassLetter ? pitchClass(bassLetter, bassAccidental) : root,
    intervals: names.map((name) => Interval.semitones(name) ?? 0),
    intervalNames: names,
  };
}

/**
 * True when a dominant seventh resolves down a fifth to a minor chord (G7 to Cm7), the V
 * of a minor key, whose tensions are the flat 9 and flat 13 (Phrygian dominant). Written
 * tensions are not checked here; callers let them win.
 */
export function resolvesToMinor(c: ParsedChord, next: ParsedChord | null | undefined): boolean {
  if (!next) return false;
  const dominant = c.intervalNames.includes("3M") && c.intervalNames.includes("7m");
  return dominant && next.intervalNames.includes("3m") && next.root === (c.root + 5) % 12;
}

/**
 * True when a dominant is heard in a minor key, so it takes the minor key's b9 and b13: it
 * resolves down a fifth to a minor chord (`resolvesToMinor`), or moves deceptively up a half
 * step to a major chord (V7 to VI in minor, G7 to Abmaj7 heard in C minor).
 */
export function minorKeyDominant(c: ParsedChord, next: ParsedChord | null | undefined): boolean {
  if (!next) return false;
  if (resolvesToMinor(c, next)) return true;
  const dominant = c.intervalNames.includes("3M") && c.intervalNames.includes("7m");
  const major = next.intervalNames.includes("3M") && !next.intervalNames.includes("7m");
  return dominant && major && next.root === (c.root + 1) % 12;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

/**
 * The 9th and 13th a dominant heard in a minor key (`minorKeyDominant`) takes, as semitones above its
 * root. When it resolves to a minor chord of the key it's heard in (`ParsedChord.key`), the key's own:
 * the V of the tonic minor (G7 to Cm in C minor) and of iii or vi in major keep the flat 9 and flat 13
 * the key has, while the V of ii in a major key (D7 to Gm7 in F) takes the key's natural 9 with the
 * flat 13 (Mixolydian ♭13), since a flat 9 there is outside the key and sticks out. Otherwise (no key,
 * a borrowed minor chord like Dm7 in D major, a deceptive resolution) the flat 9 and flat 13.
 */
export function minorKeyTensions(c: ParsedChord, next: ParsedChord | null | undefined): { ninth: 1 | 2; thirteenth: 8 | 9 } {
  const key = c.key;
  const inKey = (pc: number) => key !== undefined && MAJOR_SCALE.includes((((pc - key) % 12) + 12) % 12);
  if (!next || !resolvesToMinor(c, next) || !inKey(next.root) || !inKey(next.root + 3)) return { ninth: 1, thirteenth: 8 };
  return { ninth: inKey(c.root + 1) || !inKey(c.root + 2) ? 1 : 2, thirteenth: inKey(c.root + 8) || !inKey(c.root + 9) ? 8 : 9 };
}

/** Holds the chord before it for one slot, as lead sheets write "Am7 / / Fmaj7". */
export const BEAT = "/";

/**
 * Parse one bar string from a chart ("D", "Em7/A A7", "Am7 / / Fmaj7", "%").
 * Tokens split the bar evenly; a "/" token takes a slot without a new chord.
 * In 3/4 a bar has three beat slots, so two tokens are two beats then one (the
 * jazz waltz convention: "Dm7 G7" is Dm7 on 1 and G7 on 3). In 5/4 two tokens are
 * three beats then two, the 3+2 the meter is felt in ("Ebm Bbm7" changes on beat 4).
 */
export function parseBar(text: string, beatsPerBar: number): ParsedBar {
  const tokens = barTokens(text);
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "%")) {
    return { chords: [], repeat: true };
  }
  const step = beatsPerBar / tokens.length;
  const split = tokens.length !== 2 ? 0 : beatsPerBar === 3 ? 2 : beatsPerBar === 5 ? 3 : 0;
  const chords: ChordSlot[] = [];
  tokens.forEach((symbol, i) => {
    if (symbol !== BEAT) chords.push({ symbol, beat: split ? i * split : i * step });
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
