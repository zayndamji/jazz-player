import type { Chart } from "../chart/types";
import { readStored, store } from "./storage";

export type Sort = "az" | "recent";

export interface LibraryView {
  query: string;
  style: string;
  sort: Sort;
}

const VIEW_KEY = "jazz-stand.library";
const OPENED_KEY = "jazz-stand.opened";

/** The search, style filter and sort, kept for the visit so going to a tune and back finds the list as it was. */
export function readView(): LibraryView {
  const view: LibraryView = { query: "", style: "", sort: "az" };
  try {
    const raw = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      if (typeof raw.query === "string") view.query = raw.query;
      if (typeof raw.style === "string") view.style = raw.style;
      if (raw.sort === "az" || raw.sort === "recent") view.sort = raw.sort;
    }
  } catch {
    // Unreadable or unavailable: start fresh.
  }
  return view;
}

export function saveView(view: LibraryView) {
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // Private windows may refuse; the list still works.
  }
}

/** When each tune's page was last opened, in ms, by tune id. */
export function readOpened(): Record<string, number> {
  try {
    const raw = JSON.parse(readStored(OPENED_KEY) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) as Record<string, number>;
  } catch {
    return {};
  }
}

export function recordOpened(chartId: string, now = Date.now()) {
  store(OPENED_KEY, JSON.stringify({ ...readOpened(), [chartId]: now }));
}

/** The tunes matching a search and style, in the chosen order (recently opened first, then the rest A to Z). */
export function listTunes(charts: Chart[], view: LibraryView, opened: Record<string, number>): Chart[] {
  const q = view.query.trim().toLowerCase();
  const shown = charts.filter((c) => (!view.style || c.style === view.style) && (!q || c.title.toLowerCase().includes(q)));
  const az = (a: Chart, b: Chart) => a.title.localeCompare(b.title);
  return [...shown].sort(view.sort === "recent" ? (a, b) => (opened[b.id] ?? 0) - (opened[a.id] ?? 0) || az(a, b) : az);
}

/** "11 tunes", or "4 of 11 tunes" when a search or style hides some. */
export function countLabel(shown: number, total: number): string {
  const noun = total === 1 ? "tune" : "tunes";
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}
