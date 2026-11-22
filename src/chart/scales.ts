import { Scale } from "tonal";
import { noteName, prefersFlats, resolvesToMinor, type ParsedChord } from "./chords";

export interface ChordScale {
  /** Short name shown under the chord, e.g. "Dorian". */
  name: string;
  /** Note names from the root, with ♯ and ♭. */
  notes: string[];
}

interface ScaleDef {
  name: string;
  /** tonal's name for seven-note scales spelled by letter; null for symmetric ones. */
  tonal: string | null;
  intervals: number[];
}

const SCALES: Record<string, ScaleDef> = {
  major: { name: "Major", tonal: "major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  lydian: { name: "Lydian", tonal: "lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  dorian: { name: "Dorian", tonal: "dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  melodicMinor: { name: "Melodic minor", tonal: "melodic minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  mixolydian: { name: "Mixolydian", tonal: "mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  lydianDominant: { name: "Lydian dominant", tonal: "lydian dominant", intervals: [0, 2, 4, 6, 7, 9, 10] },
  phrygianDominant: { name: "Phrygian dominant", tonal: "phrygian dominant", intervals: [0, 1, 4, 5, 7, 8, 10] },
  locrian2: { name: "Locrian ♮2", tonal: "locrian #2", intervals: [0, 2, 3, 5, 6, 8, 10] },
  wholeTone: { name: "Whole tone", tonal: null, intervals: [0, 2, 4, 6, 8, 10] },
  altered: { name: "Altered", tonal: null, intervals: [0, 1, 3, 4, 6, 8, 10] },
  halfWhole: { name: "Half-whole", tonal: null, intervals: [0, 1, 3, 4, 6, 7, 9, 10] },
  wholeHalf: { name: "Whole-half", tonal: null, intervals: [0, 2, 3, 5, 6, 8, 9, 11] },
};

/** Written tensions that keep a dominant from taking the minor-key Phrygian dominant. */
const MAJOR_KEY_TENSIONS = ["9M", "9A", "13M", "11A", "5A", "5d"];

/**
 * The usual first-choice scale for a chord, from its intervals. `next`, the chord that
 * follows, lets a dominant resolving down a fifth to minor take Phrygian dominant.
 */
export function scaleKind(c: ParsedChord, next?: ParsedChord | null): keyof typeof SCALES {
  const has = (n: string) => c.intervalNames.includes(n);
  const minor = has("3m");
  const sus = !minor && !has("3M") && (has("4P") || has("11P"));
  const dom7 = has("7m") && (has("3M") || sus);
  if (minor && has("5d")) return has("7m") ? "locrian2" : "wholeHalf";
  if (minor) return has("7M") ? "melodicMinor" : "dorian";
  if (dom7) {
    if (resolvesToMinor(c, next) && !MAJOR_KEY_TENSIONS.some(has)) return "phrygianDominant";
    const flat9 = has("9m");
    const sharp9 = has("9A");
    const flat13 = has("5A") || has("13m");
    if (has("11A") && !flat9 && !sharp9 && !flat13) return "lydianDominant";
    if (has("5A") && !flat9 && !sharp9) return "wholeTone";
    if ((flat9 || sharp9) && flat13) return "altered";
    // A #9 is voiced with the b13 (the altered sound) unless a 13 is written.
    if (sharp9 && !has("13M")) return "altered";
    if (flat9 || sharp9) return "halfWhole";
    return "mixolydian";
  }
  if (sus && !has("7M")) return "mixolydian";
  if (has("11A") || has("5d")) return "lydian";
  return "major";
}

/** Semitones above the root of a chord's scale (see `scaleKind`). */
export function scaleIntervals(c: ParsedChord, next?: ParsedChord | null): number[] {
  return SCALES[scaleKind(c, next)].intervals;
}

const pretty = (n: string) => n.replace(/##/g, "𝄪").replace(/#/g, "♯").replace(/b/g, "♭");

/** Scale for a chord, spelled from the chord's written root. */
export function chordScale(c: ParsedChord, rootName: string, keyPc: number, next?: ParsedChord | null): ChordScale {
  const def = SCALES[scaleKind(c, next)];
  let notes: string[] = [];
  if (def.tonal) notes = Scale.get(`${rootName} ${def.tonal}`).notes;
  if (!notes.length) {
    const flats = rootName.includes("b") || (!rootName.includes("#") && prefersFlats(keyPc));
    notes = def.intervals.map((i) => noteName(c.root + i, flats));
  }
  return { name: def.name, notes: notes.map(pretty) };
}
