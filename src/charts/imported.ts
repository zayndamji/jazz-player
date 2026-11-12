import type { Chart } from "../chart/types";
import { readStored, store } from "../pages/storage";
import { STYLES } from "../styles";
import { CHARTS, getChart, validateChart } from ".";

/** Charts the user imported, kept in this browser. Ids start with this so they never meet a real tune's. */
export const IMPORTED_PREFIX = "imported-";
export const IMPORTED_KEY = "jazz-player.imported";

export const isImported = (chart: { id: string }) => chart.id.startsWith(IMPORTED_PREFIX);

/** The stored charts that still read as charts; anything else in storage is ignored. */
export function readImported(): Chart[] {
  try {
    const raw = JSON.parse(readStored(IMPORTED_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((c): c is Chart => !!c && typeof c === "object" && typeof c.id === "string" && c.id.startsWith(IMPORTED_PREFIX) && validateChart(c).length === 0)
      .map((c) => (STYLES[c.style] ? c : { ...c, style: "swing" }));
  } catch {
    return [];
  }
}

const write = (charts: Chart[]) => store(IMPORTED_KEY, JSON.stringify(charts));

/** Store charts (a tune with the same id replaces the earlier one) and return them with their final ids. */
export function addImported(charts: Chart[]): Chart[] {
  const added: Chart[] = [];
  for (const chart of charts) {
    const base = IMPORTED_PREFIX + chart.id.replace(new RegExp(`^${IMPORTED_PREFIX}`), "");
    let id = base;
    for (let n = 2; added.some((a) => a.id === id); n++) id = `${base}-${n}`;
    added.push({ ...chart, id });
  }
  const ids = new Set(added.map((c) => c.id));
  write([...readImported().filter((c) => !ids.has(c.id)), ...added]);
  return added;
}

export function removeImported(id: string) {
  write(readImported().filter((c) => c.id !== id));
}

/** Every tune the library lists: the ones shipped with the site, then the imported ones. */
export const allCharts = (): Chart[] => [...CHARTS, ...readImported()];

/** A tune by id, whether shipped or imported. */
export const findChart = (id: string): Chart | undefined => getChart(id) ?? readImported().find((c) => c.id === id);
