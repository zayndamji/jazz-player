import { keyName, keyPitchClass, minorKeyName } from "../chart/chords";
import type { Chart } from "../chart/types";
import { barString, buildSections, chartParts, chordWorks, clampTempo, expand, slug, trimLead, type ImportResult, type Measure } from "./common";

/** One song as an iReal Pro link holds it, before its chord string is read. */
export interface IRealSong {
  title: string;
  composer?: string;
  /** iReal's style name, e.g. "Medium Swing". */
  style: string;
  /** iReal's key, e.g. "Bb" or "A-" for A minor. */
  key: string;
  tempo?: number;
  /** The readable chord string (unscrambled). */
  music: string;
}

export interface IRealImport {
  results: ImportResult[];
  /** Songs that couldn't be read, each as "Title: reason". */
  skipped: string[];
}

export const PREFIX = "1r34LbKcu7";

/** Swap the ends of a 50-character block: the first 5 with the last 5, and characters 10 to 23 with their mirror. */
export function swapBlock(block: string): string {
  const c = block.split("");
  for (let i = 0; i < 5; i++) [c[i], c[49 - i]] = [block[49 - i], block[i]];
  for (let i = 10; i < 24; i++) [c[i], c[49 - i]] = [block[49 - i], block[i]];
  return c.join("");
}

/** Undo iReal's scrambling: blocks of 50 characters are swapped, except a final stretch of 50 or fewer left alone. */
export function unscramble(s: string): string {
  let out = "";
  let rest = s;
  while (rest.length > 50) {
    const block = rest.slice(0, 50);
    rest = rest.slice(50);
    out += rest.length < 2 ? block : swapBlock(block);
  }
  return out + rest;
}

/** Spell out iReal's shorthand: "XyQ" is three empty cells, "LZ" a barline, "Kcl" a repeated bar. */
export const expandShorthand = (s: string) => s.replace(/XyQ/g, "   ").replace(/LZ/g, " |").replace(/Kcl/g, "| x ");

const FIELD_ERROR = "That link doesn't hold a readable iReal Pro song.";

/** The songs in an irealb:// or irealbook:// link (a single song or a playlist). */
export function decodeLink(link: string): IRealSong[] {
  const text = link.trim();
  const match = /^(irealb|irealbook):\/\/(.*)$/is.exec(text);
  if (!match) throw new Error("That doesn't look like an iReal Pro link. It should start with irealb://");
  const scrambled = match[1].toLowerCase() === "irealb";
  let data = match[2];
  try {
    data = decodeURIComponent(data);
  } catch {
    // Not percent-encoded, or encoded badly: use as is.
  }
  const parts = data.split("===").filter((p) => p.trim() !== "");
  // A playlist ends with its own name, which has no fields.
  if (parts.length > 1 && !parts[parts.length - 1].includes("=")) parts.pop();
  const songs: IRealSong[] = [];
  for (const part of parts) {
    const fields = part.split("=");
    if (fields.length < 5) continue;
    // Title, composer, an empty field, style, key, an empty field, then the music; older links skip the empty field.
    const shift = fields[2] === "" ? 1 : 0;
    let music: string | undefined;
    let after: string[] = [];
    if (scrambled) {
      const at = fields.findIndex((f) => f.startsWith(PREFIX));
      if (at < 0) continue;
      music = expandShorthand(unscramble(fields[at].slice(PREFIX.length)));
      after = fields.slice(at + 1);
    } else {
      music = fields.slice(4).reduce((a, b) => (b.length > a.length ? b : a), "");
    }
    const tempo = after.map((f) => Number(f)).find((n) => Number.isInteger(n) && n >= 40 && n <= 320);
    songs.push({ title: fields[0].trim(), composer: fields[1].trim(), style: fields[2 + shift].trim(), key: fields[3 + shift].trim(), tempo, music });
  }
  if (songs.length === 0) throw new Error(FIELD_ERROR);
  return songs;
}

/** The backing style for an iReal style name. Edit this to change the mapping. */
export function styleFor(ireal: string, beatsPerBar: number): string {
  const s = ireal.toLowerCase();
  if (beatsPerBar === 3 || /waltz/.test(s)) return "waltz";
  if (/bossa|latin|samba|brazil|afro/.test(s)) return "bossa";
  if (/ballad/.test(s)) return "ballad";
  return "swing";
}

const DEFAULT_TEMPO: Record<string, number> = { swing: 140, bossa: 130, ballad: 66, waltz: 150 };

/** iReal chord quality as our chord parser reads it. */
export function qualityOf(raw: string): string {
  let q = raw
    .replace(/^-\^/, "mMaj")
    .replace(/^-/, "m")
    .replace(/^h(?=\d|$)/, "m7b5@")
    .replace(/^o(?=\d|$)/, "dim")
    .replace(/\^/g, "maj")
    .replace(/^\+(?=\d)/, "7#5@")
    .replace(/^\+$/, "aug")
    .replace(/sus(?!\d)/g, "sus4")
    .replace(/^2$/, "sus2")
    .replace(/^alt$/, "7alt");
  // "h7" and "+7": the seventh is already in what we wrote.
  q = q.replace(/@7/, "").replace("@", "");
  if (q === "mMaj") q = "mMaj7";
  if (q === "maj") q = "maj7";
  const tries = [q];
  const noAdd = q.replace(/add\d+/g, "");
  tries.push(noAdd);
  let r = noAdd;
  while (/[b#]\d+$/.test(r)) {
    r = r.replace(/[b#]\d+$/, "");
    tries.push(r);
  }
  tries.push(r.replace(/\d+$/, ""), "");
  return tries.find(chordWorks) ?? "";
}

const HOLD = "/";
const CHORD = /^([A-G])([b#]?)((?:sus|alt|add|[0-9]|[ho^\-+#b])*)(?:\/([A-G][b#]?))?/;

interface Draft {
  cells: (string | undefined)[];
  cell: number;
  started: boolean;
  repeat: boolean;
  repeatTwo: boolean;
}

const fresh = (): Draft => ({ cells: [], cell: 0, started: false, repeat: false, repeatTwo: false });

/** Read a chord string into bars with their repeat and ending marks. */
export function parseMusic(music: string): { measures: Measure[]; beatsPerBar: number } {
  const s = music;
  let beatsPerBar = 4;
  let metered = false;
  const measures: Measure[] = [];
  let draft = fresh();
  let mark: string | undefined;
  let forward = false;
  let ending: number[] | undefined;

  const place = (symbol: string) => {
    if (draft.cells[draft.cell] !== undefined) draft.cell++;
    draft.cells[draft.cell] = symbol;
    draft.started = true;
  };

  /** Finish the bar being read; a bar with nothing in it only passes its marks on. */
  const closeBar = (backward = false) => {
    const d = draft;
    draft = fresh();
    const last = measures[measures.length - 1];
    const has = d.started || d.repeat || d.repeatTwo;
    if (!has) {
      if (backward && last) last.backward = 2;
      return;
    }
    const bars = (): string[] => {
      if (d.repeatTwo) {
        const two = measures.slice(-2).map((m) => m.bar);
        return two.length === 2 ? two : ["%", "%"];
      }
      if (d.repeat) return [last && last.bar.split(" ").length > 1 ? last.bar : "%"];
      const cells = d.cells.slice(0, beatsPerBar).map((c) => (c === HOLD ? undefined : c));
      // iReal writes two chords sharing a 4/4 bar with a single space ("Dm7 G7"): half a bar each.
      if (beatsPerBar === 4 && d.cells.length === 2 && cells[0] && cells[1]) [cells[1], cells[2]] = [undefined, cells[1]];
      return [barString(Array.from({ length: beatsPerBar }, (_, i) => cells[i]), beatsPerBar)];
    };
    bars().forEach((bar, i) => {
      const m: Measure = { bar };
      if (i === 0) {
        if (mark) m.mark = mark;
        if (forward) m.forward = true;
      }
      if (ending) m.endings = [...ending];
      measures.push(m);
    });
    mark = undefined;
    forward = false;
    if (backward) measures[measures.length - 1].backward = 2;
  };

  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    const rest = s.slice(i);
    if (ch === "T" && /^T\d\d/.test(rest)) {
      const sig = rest.slice(1, 3);
      if (sig !== "44" && sig !== "34") {
        const shown = sig === "12" ? "12/8" : `${sig[0]}/${sig[1]}`;
        throw new Error(`Only 3/4 and 4/4 charts are supported (this one is ${shown}).`);
      }
      const meter = sig === "44" ? 4 : 3;
      if (metered && meter !== beatsPerBar) throw new Error("The time signature changes partway through, which isn't supported.");
      beatsPerBar = meter;
      metered = true;
      i += 3;
    } else if (ch === "*" && i + 1 < s.length) {
      const m = s[i + 1];
      closeBar();
      mark = m === "i" ? "Intro" : m === "v" ? "Verse" : /[A-Za-z]/.test(m) ? m.toUpperCase() : mark;
      ending = undefined;
      i += 2;
    } else if (ch === "<") {
      const end = s.indexOf(">", i);
      i = end < 0 ? s.length : end + 1;
    } else if (ch === "(") {
      const end = s.indexOf(")", i);
      i = end < 0 ? s.length : end + 1;
    } else if (ch === "|") {
      closeBar();
      i++;
    } else if (ch === "[") {
      closeBar();
      ending = undefined;
      i++;
    } else if (ch === "]" || ch === "Z") {
      closeBar();
      ending = undefined;
      i++;
    } else if (ch === "{") {
      closeBar();
      forward = true;
      ending = undefined;
      i++;
    } else if (ch === "}") {
      closeBar(true);
      ending = undefined;
      i++;
    } else if (ch === "N" && /^N\d/.test(rest)) {
      closeBar();
      const n = Number(rest[1]);
      ending = n > 0 ? [n] : undefined;
      i += 2;
    } else if (ch === " " || ch === ",") {
      // A separator ends a chord's cell, and each extra one is an empty cell. Commas before a bar's first chord are empty cells too.
      if (draft.started || ch === ",") draft.cell++;
      i++;
    } else if (ch === "x") {
      draft.repeat = true;
      i++;
    } else if (ch === "r") {
      draft.repeatTwo = true;
      i++;
    } else if (ch === "n" || ch === "p") {
      // No chord (silence isn't played) or a slash: both leave the chord before ringing.
      place(HOLD);
      i++;
    } else if (ch === "W") {
      // Invisible root: only the quality shows, so it keeps the chord before it.
      place(HOLD);
      i++;
      i += /^(?:sus|alt|add|[0-9]|[ho^\-+#b])*(?:\/[A-G][b#]?)?/.exec(s.slice(i))![0].length;
    } else {
      const m = CHORD.exec(rest);
      if (m && /[A-G]/.test(ch)) {
        place(m[1] + m[2] + qualityOf(m[3]) + (m[4] ? "/" + m[4] : ""));
        i += m[0].length;
      } else i++;
    }
  }
  closeBar();
  return { measures, beatsPerBar };
}

/** An iReal key ("Bb", "A-") as a chart key ("Bb", "Am"). */
function chartKey(key: string): string {
  const m = /^([A-G][b#]?)(-?)/.exec(key);
  if (!m) throw new Error(`Can't read the key "${key}".`);
  const pc = keyPitchClass(m[1]);
  return m[2] ? minorKeyName(pc) + "m" : keyName(pc);
}

export function songToChart(song: IRealSong): ImportResult {
  const { measures, beatsPerBar } = parseMusic(song.music);
  const sections = trimLead(buildSections(expand(measures)));
  if (sections.length === 0) throw new Error("The song has no chords.");
  const style = styleFor(song.style, beatsPerBar);
  const warnings: string[] = [];
  if (song.tempo === undefined) warnings.push(`No tempo in the link; set to ${DEFAULT_TEMPO[style]}.`);
  const chart: Chart = {
    id: slug(song.title),
    title: song.title || "Imported tune",
    key: chartKey(song.key || "C"),
    tempo: clampTempo(song.tempo ?? DEFAULT_TEMPO[style]),
    beatsPerBar,
    style,
    ...chartParts(sections),
  };
  return { chart, warnings };
}

/** Every song in an iReal Pro link as a chart. Songs that can't be read are listed in `skipped`; it throws only when none can. */
export function importIReal(link: string): IRealImport {
  const results: ImportResult[] = [];
  const skipped: string[] = [];
  for (const song of decodeLink(link)) {
    try {
      results.push(songToChart(song));
    } catch (e) {
      skipped.push(`${song.title || "Untitled"}: ${(e as Error).message}`);
    }
  }
  if (results.length === 0) throw new Error(skipped[0]?.replace(/^.*?: /, "") ?? FIELD_ERROR);
  return { results, skipped };
}
