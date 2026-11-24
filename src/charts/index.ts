import { BEAT, barTokens, parseBar, parseChord } from "../chart/chords";
import { TEMPO, type Chart } from "../chart/types";

/**
 * Every chart, collected at build time: your tunes in tunes/<id>/chart.json
 * (gitignored: tunes are content you add, not part of the framework) and the
 * examples in examples/<id>/chart.json. Folder name = chart id.
 */
const files = import.meta.glob<Chart>(["../../tunes/*/chart.json", "../../examples/*/chart.json"], { eager: true, import: "default" });

/** The tune's folder name, from a path like ../../tunes/<id>/chart.json. */
export const folderOf = (path: string) => path.split("/").at(-2)!;

export const CHARTS: Chart[] = Object.values(files).sort((a, b) => a.title.localeCompare(b.title));

export function getChart(id: string): Chart | undefined {
  return CHARTS.find((c) => c.id === id);
}

/** Folder name of each chart, for checks. */
export const CHART_FILES: Record<string, Chart> = Object.fromEntries(Object.entries(files).map(([path, chart]) => [folderOf(path), chart]));

/** Problems with a chart, empty when it's fine. Styles are checked by the caller. */
export function validateChart(chart: Chart): string[] {
  const errors: string[] = [];
  if (!chart.id || !/^[a-z0-9-]+$/.test(chart.id)) errors.push(`id "${chart.id}" must be lowercase letters, digits and dashes`);
  if (!chart.title) errors.push("missing title");
  if (!/^[A-G][b#]?m?$/.test(chart.key)) errors.push(`key "${chart.key}" must be a note like C, Bb or F#, with "m" for minor (Em)`);
  if (!(chart.tempo >= TEMPO.min && chart.tempo <= TEMPO.max)) errors.push(`tempo ${chart.tempo} out of range`);
  if (![3, 4, 5].includes(chart.beatsPerBar)) errors.push("beatsPerBar must be 3, 4 or 5");
  if (!chart.form?.length) errors.push("form has no sections");
  if (chart.comp !== undefined && !["sparse", "busy", "blues"].includes(chart.comp)) errors.push(`comp "${chart.comp}" must be sparse, busy or blues`);
  const sections = [...(chart.intro ? [chart.intro] : []), ...(chart.form ?? []), ...(chart.ending ?? [])];
  let first = true;
  for (const section of sections) {
    if (!section.bars?.length) errors.push(`section ${section.label} has no bars`);
    section.bars?.forEach((text, i) => {
      const bar = parseBar(text, chart.beatsPerBar);
      if (bar.repeat && first) errors.push(`section ${section.label} bar ${i + 1}: "%" with no chord before it`);
      const tokens = barTokens(text);
      if (tokens[0] === BEAT && first) errors.push(`section ${section.label} bar ${i + 1}: "/" with no chord before it`);
      if (chart.beatsPerBar === 3 && tokens.length > 3) errors.push(`section ${section.label} bar ${i + 1}: a 3/4 bar has at most three chords or slashes`);
      if (chart.beatsPerBar === 5 && (tokens.length === 3 || tokens.length === 4 || tokens.length > 5)) errors.push(`section ${section.label} bar ${i + 1}: a 5/4 bar has one, two (3+2) or five chords or slashes`);
      if (tokens.length > 1 && tokens.includes("%")) errors.push(`section ${section.label} bar ${i + 1}: "%" must be the whole bar; use "/" to hold a chord for a beat`);
      for (const slot of bar.chords) {
        try {
          parseChord(slot.symbol);
        } catch (e) {
          errors.push(`section ${section.label} bar ${i + 1}: ${(e as Error).message}`);
        }
      }
      first = false;
    });
    if (section.break !== undefined && typeof section.break !== "boolean") errors.push(`section ${section.label}: "break" must be true or false`);
  }
  for (const [track, db] of Object.entries(chart.mix ?? {}))
    if (!["bass", "guitar", "piano", "drums"].includes(track) || typeof db !== "number" || Math.abs(db) > 24) errors.push(`"mix" needs parts (bass, guitar, piano, drums) with a dB change within 24`);
  if (chart.trade !== undefined && !["fours", "eights", "fours-out"].includes(chart.trade)) errors.push(`trade "${chart.trade}" must be fours, eights or fours-out`);
  if (chart.pedal !== undefined && !/^[A-G][b#]?$/.test(chart.pedal)) errors.push(`pedal "${chart.pedal}" must be a note like E or Bb`);
  for (const track of chart.band ?? []) if (!["bass", "guitar", "piano", "drums"].includes(track)) errors.push(`"band" has an unknown part "${track}"`);
  const plays = chart.form?.map((s) => s.play) ?? [];
  if (plays.some((p) => p !== undefined && p !== "head" && p !== "solos")) errors.push(`"play" must be "head" or "solos"`);
  if (plays.some((p) => p) && (!plays.some((p) => p !== "solos") || !plays.some((p) => p !== "head")))
    errors.push(`with "play" set, some form sections must play in the head and some in the solos`);
  return errors;
}
