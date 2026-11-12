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
  if (chart.beatsPerBar !== 4) errors.push("only 4/4 is supported");
  if (!chart.form?.length) errors.push("form has no sections");
  const sections = [...(chart.intro ? [chart.intro] : []), ...(chart.form ?? []), ...(chart.ending ?? [])];
  let first = true;
  for (const section of sections) {
    if (!section.bars?.length) errors.push(`section ${section.label} has no bars`);
    section.bars?.forEach((text, i) => {
      const bar = parseBar(text, chart.beatsPerBar);
      if (bar.repeat && first) errors.push(`section ${section.label} bar ${i + 1}: "%" with no chord before it`);
      const tokens = barTokens(text);
      if (tokens[0] === BEAT && first) errors.push(`section ${section.label} bar ${i + 1}: "/" with no chord before it`);
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
  }
  for (const track of chart.band ?? []) if (!["bass", "guitar", "piano", "drums"].includes(track)) errors.push(`"band" has an unknown part "${track}"`);
  const plays = chart.form?.map((s) => s.play) ?? [];
  if (plays.some((p) => p !== undefined && p !== "head" && p !== "solos")) errors.push(`"play" must be "head" or "solos"`);
  if (plays.some((p) => p) && (!plays.some((p) => p !== "solos") || !plays.some((p) => p !== "head")))
    errors.push(`with "play" set, some form sections must play in the head and some in the solos`);
  return errors;
}
