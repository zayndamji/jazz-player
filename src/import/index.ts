import type { Chart } from "../chart/types";
import { validateChart } from "../charts";
import { importIReal } from "./ireal";
import { importMusicXml, MXL_MESSAGE } from "./musicxml";

/** Charts read from a file or a link, ready to store. */
export interface Imported {
  charts: Chart[];
  /** Songs left out of a playlist, each as "Title: reason". */
  skipped: string[];
}

const IREAL_LINK = /^irealb(ook)?:\/\//i;

/** Check a chart and say what's wrong in one plain sentence. */
function checked(chart: Chart): Chart {
  const [problem] = validateChart(chart);
  if (problem) throw new Error(`${chart.title}: ${problem}.`);
  return chart;
}

/**
 * Read pasted text or a file's text: an iReal Pro link, or MusicXML. `fileName` helps
 * recognise zipped .mxl files, which can't be read here.
 */
export function importSource(text: string, fileName = ""): Imported {
  const trimmed = text.trim();
  if (IREAL_LINK.test(trimmed)) {
    const { results, skipped } = importIReal(trimmed);
    const charts: Chart[] = [];
    for (const { chart } of results) {
      try {
        charts.push(checked(chart));
      } catch (e) {
        skipped.push((e as Error).message);
      }
    }
    if (charts.length === 0) throw new Error(skipped[0]);
    return { charts, skipped };
  }
  if (/\.mxl$/i.test(fileName) || text.startsWith("PK\u0003\u0004")) throw new Error(MXL_MESSAGE);
  if (trimmed.startsWith("<") || /\.(musicxml|xml)$/i.test(fileName)) return { charts: [checked(importMusicXml(text, fileName).chart)], skipped: [] };
  throw new Error("That is not a MusicXML file or an iReal Pro link.");
}
