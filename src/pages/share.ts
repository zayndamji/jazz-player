import { INSTRUMENTS } from "../chart/instruments";
import type { Repeat } from "../engine/schedule";
import { REPEATS, validStyle, validTempo, validTranspose, type TuneSettings } from "./settings";

/** What a shared link can set for one visit: `#/tune/<id>?bpm=120&key=-2&style=bossa&for=Bb&choruses=4`. */
export interface LinkSettings {
  tempo?: number;
  transpose?: number;
  style?: string;
  /** Instrument id. */
  instrument?: string;
  choruses?: Repeat;
}

/** The valid parameters in a hash's query; bad ones are ignored. */
export function parseLink(hash: string): LinkSettings {
  const q = hash.indexOf("?");
  if (q < 0) return {};
  const params = new URLSearchParams(hash.slice(q + 1));
  const out: LinkSettings = {};
  const num = (name: string) => {
    const v = params.get(name);
    return v !== null && v.trim() !== "" ? Number(v) : NaN;
  };
  const bpm = num("bpm");
  if (validTempo(bpm)) out.tempo = Math.round(bpm);
  const key = num("key");
  if (validTranspose(key)) out.transpose = key;
  const style = params.get("style");
  if (validStyle(style)) out.style = style;
  const who = params.get("for");
  if (who !== null && INSTRUMENTS.some((i) => i.id === who)) out.instrument = who;
  const choruses = params.get("choruses");
  const asNumber = choruses === null ? NaN : Number(choruses);
  if (choruses === "loop") out.choruses = "loop";
  else if (REPEATS.includes(asNumber)) out.choruses = asNumber;
  return out;
}

/** The tune's settings with a link's parameters on top. */
export function withLink(settings: TuneSettings, link: LinkSettings): TuneSettings {
  return {
    ...settings,
    ...(link.tempo !== undefined && { tempo: link.tempo }),
    ...(link.transpose !== undefined && { transpose: link.transpose }),
    ...(link.style !== undefined && { style: link.style }),
    ...(link.choruses !== undefined && { choruses: link.choruses }),
  };
}

const LINKED = ["tempo", "transpose", "style", "choruses"] as const;

/**
 * What to remember: the current settings, except that a value that still equals what the
 * link set (the user hasn't changed it) keeps the tune's own stored value, so a link only affects the visit.
 */
export function rememberable(current: TuneSettings, stored: TuneSettings, link: LinkSettings): TuneSettings {
  const out = { ...current };
  for (const k of LINKED) if (link[k] !== undefined && current[k] === link[k]) (out as Record<string, unknown>)[k] = stored[k];
  return out;
}

/** A link to a tune with the setup that's on screen. The instrument is left out for a C instrument. */
export function shareUrl(base: string, chartId: string, s: { tempo: number; transpose: number; style: string; instrument: string; choruses: Repeat }): string {
  const params = new URLSearchParams({ bpm: String(s.tempo), key: String(s.transpose), style: s.style });
  if (s.instrument !== "C") params.set("for", s.instrument);
  params.set("choruses", String(s.choruses));
  return `${base}#/tune/${chartId}?${params}`;
}
