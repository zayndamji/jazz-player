import { INSTRUMENTS } from "../chart/instruments";
import type { Repeat } from "../engine/schedule";
import { MELODY_MODES, type MelodyMode } from "../engine/melody";
import { TRADE_MODES, type TradeMode } from "../engine/trading";
import { KEY_STEPS, type KeyStep } from "../engine/timeline";
import type { Variation } from "../styles/types";
import { CHORDS_SHOWN, REPEATS, validStyle, validTempo, validTranspose, type ChordsShown, type CountIn, type TuneSettings } from "./settings";

/** What a shared link can set for one visit: `#/tune/<id>?bpm=120&key=-2&style=bossa&for=Bb&choruses=4`. */
export interface LinkSettings {
  tempo?: number;
  transpose?: number;
  style?: string;
  /** Instrument id. */
  instrument?: string;
  choruses?: Repeat;
  /** Trading with the drums. */
  trade?: TradeMode;
  /** When the chords show. */
  chords?: ChordsShown;
  /** The head's melody along with the band. */
  melody?: MelodyMode;
  /** Choruses until stopped, ended on cue ("choruses=live"). */
  live?: boolean;
  /** Half steps the key moves each chorus. */
  keyStep?: KeyStep;
  /** "groove=steady" for one groove every bar. */
  variation?: Variation;
  countIn?: CountIn;
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
  else if (choruses === "live") {
    out.choruses = "loop";
    out.live = true;
  }
  else if (REPEATS.includes(asNumber)) out.choruses = asNumber;
  const trade = params.get("trade");
  if (TRADE_MODES.includes(trade as TradeMode)) out.trade = trade as TradeMode;
  const chords = params.get("chords");
  if (CHORDS_SHOWN.includes(chords as ChordsShown)) out.chords = chords as ChordsShown;
  const melody = params.get("melody");
  if (MELODY_MODES.includes(melody as MelodyMode)) out.melody = melody as MelodyMode;
  const step = num("step");
  if (KEY_STEPS.includes(step as KeyStep)) out.keyStep = step as KeyStep;
  const groove = params.get("groove");
  if (groove === "steady") out.variation = "straight";
  else if (groove === "varied") out.variation = "varied";
  const countIn = params.get("countin");
  if (countIn === "auto") out.countIn = "auto";
  else if (countIn === "0" || countIn === "1" || countIn === "2") out.countIn = Number(countIn) as 0 | 1 | 2;
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
    ...(link.trade !== undefined && { trade: link.trade }),
    ...(link.chords !== undefined && { chords: link.chords }),
    ...(link.melody !== undefined && { melody: link.melody }),
    ...(link.live !== undefined && { live: link.live }),
    ...(link.keyStep !== undefined && { keyStep: link.keyStep }),
    ...(link.variation !== undefined && { variation: link.variation }),
    ...(link.countIn !== undefined && { countIn: link.countIn }),
  };
}

const LINKED = ["tempo", "transpose", "style", "choruses", "trade", "chords", "melody", "live", "keyStep", "variation", "countIn"] as const;

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
export function shareUrl(
  base: string,
  chartId: string,
  s: { tempo: number; transpose: number; style: string; instrument: string; choruses: Repeat; trade?: TradeMode; chords?: ChordsShown; melody?: MelodyMode; live?: boolean; keyStep?: KeyStep; variation?: Variation; countIn?: CountIn },
): string {
  const params = new URLSearchParams({ bpm: String(s.tempo), key: String(s.transpose), style: s.style });
  if (s.instrument !== "C") params.set("for", s.instrument);
  params.set("choruses", s.live && s.choruses === "loop" ? "live" : String(s.choruses));
  if (s.keyStep) params.set("step", String(s.keyStep));
  if (s.variation === "straight") params.set("groove", "steady");
  if (s.countIn !== undefined && s.countIn !== "auto") params.set("countin", String(s.countIn));
  if (s.trade && s.trade !== "off") params.set("trade", s.trade);
  if (s.chords && s.chords !== "always") params.set("chords", s.chords);
  if (s.melody && s.melody !== "off") params.set("melody", s.melody);
  return `${base}#/tune/${chartId}?${params}`;
}
