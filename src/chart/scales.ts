import { Scale } from "tonal";
import { noteName, prefersFlats, type ParsedChord } from "./chords";

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
  locrian2: { name: "Locrian ♮2", tonal: "locrian #2", intervals: [0, 2, 3, 5, 6, 8, 10] },
  wholeTone: { name: "Whole tone", tonal: null, intervals: [0, 2, 4, 6, 8, 10] },
  altered: { name: "Altered", tonal: null, intervals: [0, 1, 3, 4, 6, 8, 10] },
  halfWhole: { name: "Half-whole", tonal: null, intervals: [0, 1, 3, 4, 6, 7, 9, 10] },
  wholeHalf: { name: "Whole-half", tonal: null, intervals: [0, 2, 3, 5, 6, 8, 9, 11] },
};

/** The usual first-choice scale for a chord, from its intervals. */
export function scaleKind(c: ParsedChord): keyof typeof SCALES {
  const has = (n: string) => c.intervalNames.includes(n);
  const minor = has("3m");
  const dom7 = has("7m") && (has("3M") || has("4P"));
  if (minor && has("5d")) return has("7d") ? "wholeHalf" : "locrian2";
  if (minor) return has("7M") ? "melodicMinor" : "dorian";
  if (dom7) {
    if (has("5A") && !has("9m") && !has("9A")) return "wholeTone";
    if ((has("9m") || has("9A")) && (has("5A") || has("13m"))) return "altered";
    if (has("9m")) return "halfWhole";
    return "mixolydian";
  }
  if (has("11A") || has("5d")) return "lydian";
  return "major";
}

const pretty = (n: string) => n.replace(/##/g, "𝄪").replace(/#/g, "♯").replace(/b/g, "♭");

/** Scale for a chord, spelled from the chord's written root. */
export function chordScale(c: ParsedChord, rootName: string, keyPc: number): ChordScale {
  const def = SCALES[scaleKind(c)];
  let notes: string[] = [];
  if (def.tonal) notes = Scale.get(`${rootName} ${def.tonal}`).notes;
  if (!notes.length) {
    const flats = rootName.includes("b") || (!rootName.includes("#") && prefersFlats(keyPc));
    notes = def.intervals.map((i) => noteName(c.root + i, flats));
  }
  return { name: def.name, notes: notes.map(pretty) };
}
