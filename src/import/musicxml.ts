import { keyName, minorKeyName, noteName, pitchClass, spellingPc, transposeSymbol } from "../chart/chords";
import type { Chart } from "../chart/types";
import { barString, buildSections, chordWorks as works, chartParts, clampTempo, defaultStyle, expand, slug, trimLead, type ImportResult, type Measure } from "./common";
import { child, childrenOf, parseXml, textOf, type XmlNode } from "./xml";

export const MXL_MESSAGE = "Zipped .mxl files aren't supported. Export an uncompressed MusicXML file (.musicxml or .xml) instead.";

/** MusicXML chord kinds as the quality strings the chord parser reads. */
const KINDS: Record<string, string> = {
  major: "",
  minor: "m",
  augmented: "aug",
  diminished: "dim",
  dominant: "7",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  "diminished-seventh": "dim7",
  "augmented-seventh": "7#5",
  "half-diminished": "m7b5",
  "major-minor": "mMaj7",
  "major-sixth": "6",
  "minor-sixth": "m6",
  "dominant-ninth": "9",
  "major-ninth": "maj9",
  "minor-ninth": "m9",
  "dominant-11th": "11",
  "major-11th": "maj11",
  "minor-11th": "m11",
  "dominant-13th": "13",
  "major-13th": "maj13",
  "minor-13th": "m13",
  "suspended-second": "sus2",
  "suspended-fourth": "sus4",
  Neapolitan: "",
  Italian: "7",
  French: "7b5",
  German: "7",
  pedal: "",
  power: "5",
  Tristan: "",
  other: "",
  none: "",
};

const spell = (step: string, alter: number): string => {
  if (alter >= -1 && alter <= 1 && Number.isInteger(alter)) return step + (alter === 1 ? "#" : alter === -1 ? "b" : "");
  return noteName(pitchClass(step, "") + Math.round(alter), alter < 0);
};

/** The quality for a <harmony>'s kind and degrees, falling back to the plain kind when a combination isn't readable. */
function qualityOf(kind: XmlNode | undefined, degrees: XmlNode[]): string {
  const name = kind?.text ?? "major";
  const text = kind?.attrs.text ?? "";
  let base = KINDS[name] ?? "";
  if (/alt/i.test(text) && (name === "dominant" || name === "other")) return "7alt";
  if (name === "other" && text && works(text)) return text;
  let extra = "";
  for (const d of degrees) {
    const value = Number(textOf(d, "degree-value"));
    const alter = Number(textOf(d, "degree-alter") ?? 0);
    const type = textOf(d, "degree-type");
    if (type === "subtract" || !Number.isFinite(value)) continue;
    const accidental = alter > 0 ? "#" : alter < 0 ? "b" : "";
    if (!accidental && type === "add" && (value === 9 || value === 13) && ["7", "m7", "maj7", "6"].includes(base)) {
      base = base === "6" ? "69" : base.replace("7", String(value));
      continue;
    }
    if (accidental || type === "add") extra += `${type === "add" && !accidental ? "add" : accidental}${value}`;
  }
  for (const q of [base + extra, base]) if (works(q)) return q;
  return "";
}

function chordSymbol(h: XmlNode): string | null {
  const kind = child(h, "kind");
  if (kind?.text === "none") return null;
  const root = child(h, "root");
  if (!root) return null;
  const step = textOf(root, "root-step");
  if (!step || !/^[A-G]$/.test(step)) return null;
  let symbol = spell(step, Number(textOf(root, "root-alter") ?? 0)) + qualityOf(kind, childrenOf(h, "degree"));
  const bass = child(h, "bass");
  const bassStep = textOf(bass, "bass-step");
  if (bassStep && /^[A-G]$/.test(bassStep)) symbol += "/" + spell(bassStep, Number(textOf(bass, "bass-alter") ?? 0));
  return symbol;
}

/** Quarter notes per minute from a <metronome>, or undefined. */
function metronome(m: XmlNode): number | undefined {
  const perMinute = Number(textOf(m, "per-minute"));
  if (!(perMinute > 0)) return undefined;
  const unit = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 }[textOf(m, "beat-unit") ?? "quarter"] ?? 1;
  return perMinute * unit * (child(m, "beat-unit-dot") ? 1.5 : 1);
}

const endingNumbers = (text: string) => (text.match(/\d+/g) ?? []).map(Number);

/**
 * Read a MusicXML score (partwise, uncompressed) into a chart: title, concert key,
 * tempo, rehearsal marks as sections, and the chord symbols placed by beat, with
 * repeats and numbered endings played out.
 */
export function importMusicXml(source: string, fileName = ""): ImportResult {
  if (/\.mxl$/i.test(fileName) || source.startsWith("PK\u0003\u0004")) throw new Error(MXL_MESSAGE);
  const root = parseXml(source);
  if (root.name !== "score-partwise") {
    throw new Error(root.name === "score-timewise" ? "Timewise MusicXML isn't supported. Export a partwise score." : "This doesn't look like a MusicXML score.");
  }
  const warnings: string[] = [];
  const parts = childrenOf(root, "part");
  const part = parts.find((p) => p.children.some((m) => m.children.some((c) => c.name === "harmony"))) ?? parts[0];
  if (!part) throw new Error("The score has no parts.");
  const measuresXml = childrenOf(part, "measure");
  if (!measuresXml.some((m) => m.children.some((c) => c.name === "harmony"))) throw new Error("The score has no chord symbols.");

  const title = textOf(child(root, "work"), "work-title") || textOf(root, "movement-title") || "Imported tune";

  let fifths = 0;
  let minor = false;
  let keyFound = false;
  let chromatic = 0;
  let beats = 0;
  let beatType = 0;
  let tempo: number | undefined;
  let divisions = 1;
  const rows: { measure: Measure; chords: string[] }[] = [];
  let active: number[] | undefined;

  for (const m of measuresXml) {
    const placed: (string | undefined)[] = [];
    let pos = 0;
    const measure: Measure = { bar: "%" };
    let endsHere = false;
    // The meter and divisions may change at the top of any bar; read attributes first in document order below.
    for (const c of m.children) {
      if (c.name === "attributes") {
        const d = Number(textOf(c, "divisions"));
        if (d > 0) divisions = d;
        const key = child(c, "key");
        if (key && !keyFound) {
          fifths = Number(textOf(key, "fifths") ?? 0);
          minor = textOf(key, "mode") === "minor";
          keyFound = true;
        }
        const time = child(c, "time");
        if (time && !beats) {
          beats = Number(textOf(time, "beats"));
          beatType = Number(textOf(time, "beat-type"));
          if (!((beats === 3 || beats === 4 || beats === 5) && beatType === 4)) {
            throw new Error(`Only 3/4, 4/4 and 5/4 charts are supported (this one is ${textOf(time, "beats")}/${textOf(time, "beat-type")}).`);
          }
        }
        const transpose = child(c, "transpose");
        if (transpose && chromatic === 0) chromatic = Number(textOf(transpose, "chromatic") ?? 0) + 12 * Number(textOf(transpose, "octave-change") ?? 0);
      } else if (c.name === "note") {
        if (!child(c, "chord") && !child(c, "grace")) pos += Number(textOf(c, "duration") ?? 0);
      } else if (c.name === "forward") pos += Number(textOf(c, "duration") ?? 0);
      else if (c.name === "backup") pos -= Number(textOf(c, "duration") ?? 0);
      else if (c.name === "harmony") {
        const symbol = chordSymbol(c);
        const per = beats || 4;
        const beat = Math.min(per - 1, Math.max(0, Math.round((pos + Number(textOf(c, "offset") ?? 0)) / divisions)));
        if (symbol) placed[beat] = symbol;
      } else if (c.name === "sound" && tempo === undefined && Number(c.attrs.tempo) > 0) tempo = Number(c.attrs.tempo);
      else if (c.name === "direction") {
        for (const type of childrenOf(c, "direction-type")) {
          const r = textOf(type, "rehearsal");
          if (r && !measure.mark) measure.mark = r;
          const met = child(type, "metronome");
          if (met && tempo === undefined) tempo = metronome(met);
        }
        const sound = child(c, "sound");
        if (sound && tempo === undefined && Number(sound.attrs.tempo) > 0) tempo = Number(sound.attrs.tempo);
      } else if (c.name === "barline") {
        const ending = child(c, "ending");
        const repeat = child(c, "repeat");
        if (ending?.attrs.type === "start") active = endingNumbers(ending.attrs.number ?? "1");
        else if (ending) {
          active ??= endingNumbers(ending.attrs.number ?? "1");
          endsHere = true;
        }
        if (repeat?.attrs.direction === "forward") measure.forward = true;
        if (repeat?.attrs.direction === "backward") measure.backward = Number(repeat.attrs.times) > 0 ? Number(repeat.attrs.times) : 2;
      }
    }
    if (active) measure.endings = [...active];
    if (endsHere) active = undefined;
    if (!beats) {
      beats = 4;
      beatType = 4;
    }
    rows.push({ measure, chords: placed as string[] });
    // A pickup bar at the start doesn't count as a bar of the form.
    if (m.attrs.implicit === "yes" && rows.length === 1) placed.length = 0;
    measure.bar = barString(Array.from({ length: beats }, (_, i) => placed[i]), beats);
  }
  if (!beats) beats = 4;

  // Concert key and chords.
  const tonicWritten = (((fifths * 7 + (minor ? 9 : 0)) % 12) + 12) % 12;
  const tonic = (((tonicWritten + chromatic) % 12) + 12) % 12;
  const key = minor ? minorKeyName(tonic) + "m" : keyName(tonic);
  if (chromatic % 12 !== 0) {
    const target = spellingPc(tonic, minor);
    for (const { measure } of rows) {
      measure.bar = measure.bar
        .split(" ")
        .map((t) => (t === "/" || t === "%" ? t : transposeSymbol(t, chromatic, target)))
        .join(" ");
    }
  }

  const measures = rows.map((r) => r.measure);
  const sections = trimLead(buildSections(expand(measures)));
  if (sections.length === 0) throw new Error("The score has no chord symbols.");
  if (tempo === undefined) warnings.push("No tempo in the file; set to 120.");
  const style = defaultStyle(beats);
  const chart: Chart = {
    id: slug(title),
    title,
    key,
    tempo: clampTempo(tempo ?? 120),
    beatsPerBar: beats,
    style,
    ...chartParts(sections),
  };
  return { chart, warnings };
}
