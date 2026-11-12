import type { Mixable } from "../audio/player";
import type { MixState } from "../components/Mixer";
import type { View } from "../components/ControlBar";
import { TEMPO, type Chart } from "../chart/types";
import { CLICK_MODES, type ClickMode, type Repeat } from "../engine/schedule";
import { TRADE_MODES, type TradeMode } from "../engine/trading";
import { KEY_STEPS, type KeyStep } from "../engine/timeline";
import { STYLES, playableStyle } from "../styles";
import { forget, readStored, store } from "./storage";

/** The numbers of choruses the Choruses setting offers. */
export const REPEATS: Repeat[] = [1, 2, 3, 4, 5, 6, 8, "loop"];

/** BPM added to the tempo on each pass of a loop: off, or a step. */
export const SPEED_UPS = [0, 1, 2, 5, 10] as const;
export type SpeedUp = (typeof SPEED_UPS)[number];

/** The tempo after a pass of a loop: a step faster, never past the top tempo. */
export const raisedTempo = (tempo: number, step: number) => Math.min(TEMPO.max, tempo + step);

/** When the chart shows its chords: always, hidden after the first chorus (to play from memory), or never. */
export type ChordsShown = "always" | "after-first" | "hidden";
export const CHORDS_SHOWN: ChordsShown[] = ["always", "after-first", "hidden"];

export const MIXABLES: Mixable[] = ["bass", "guitar", "piano", "drums", "metronome"];

export const initialMix = (): Record<Mixable, MixState> => ({
  bass: { level: 1, mute: false, solo: false },
  guitar: { level: 1, mute: false, solo: false },
  piano: { level: 1, mute: false, solo: false },
  drums: { level: 1, mute: false, solo: false },
  metronome: { level: 1, mute: false, solo: false },
});

/** What a tune remembers between visits: everything More and the player bar can change, except the global Mute and instrument. */
export interface TuneSettings {
  tempo: number;
  /** Half steps from the original key, -6 to 5. */
  transpose: number;
  style: string;
  choruses: Repeat;
  /** Bars of count-in. */
  countIn: 0 | 1 | 2;
  twoFeel: boolean;
  intro: boolean;
  ending: boolean;
  view: View;
  click: ClickMode;
  showScales: boolean;
  speedUp: SpeedUp;
  /** Half steps the key moves each chorus. */
  keyStep: KeyStep;
  /** Trading with the drums in the solo choruses. */
  trade: TradeMode;
  chords: ChordsShown;
  mix: Record<Mixable, MixState>;
}

export const tuneKey = (chartId: string) => `jazz-player.tune.${chartId}`;

export function defaultSettings(chart: Chart): TuneSettings {
  return {
    tempo: chart.tempo,
    transpose: 0,
    style: chart.style,
    choruses: 3,
    countIn: 2,
    twoFeel: chart.twoFeel ?? false,
    intro: true,
    ending: true,
    view: "chords",
    click: "every",
    showScales: false,
    speedUp: 0,
    keyStep: 0,
    trade: "off",
    chords: "always",
    mix: initialMix(),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export const validTempo = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= TEMPO.min && v <= TEMPO.max;
export const validTranspose = (v: unknown): v is number => isInt(v, -6, 5);
export const validStyle = (v: unknown): v is string => typeof v === "string" && Object.prototype.hasOwnProperty.call(STYLES, v);
export const validChoruses = (v: unknown): v is Repeat => REPEATS.includes(v as Repeat);

function parseMix(raw: unknown): Record<Mixable, MixState> | undefined {
  if (!isObject(raw)) return undefined;
  const mix = initialMix();
  let any = false;
  for (const track of MIXABLES) {
    const m = raw[track];
    if (!isObject(m)) continue;
    if (typeof m.level === "number" && m.level >= 0 && m.level <= 1.5) {
      mix[track].level = m.level;
      any = true;
    }
    if (isBool(m.mute)) {
      mix[track].mute = m.mute;
      any = true;
    }
    if (isBool(m.solo) && track !== "metronome") {
      mix[track].solo = m.solo;
      any = true;
    }
  }
  return any ? mix : undefined;
}

/** The valid fields of a stored value; anything else is ignored. */
export function parseSettings(raw: unknown): Partial<TuneSettings> {
  if (!isObject(raw)) return {};
  const out: Partial<TuneSettings> = {};
  if (validTempo(raw.tempo)) out.tempo = Math.round(raw.tempo);
  if (validTranspose(raw.transpose)) out.transpose = raw.transpose;
  if (validStyle(raw.style)) out.style = raw.style;
  if (validChoruses(raw.choruses)) out.choruses = raw.choruses;
  if (raw.countIn === 0 || raw.countIn === 1 || raw.countIn === 2) out.countIn = raw.countIn;
  // Entries from before the count-in had a length.
  else if (isBool(raw.countIn)) out.countIn = raw.countIn ? 2 : 0;
  if (isBool(raw.twoFeel)) out.twoFeel = raw.twoFeel;
  if (isBool(raw.intro)) out.intro = raw.intro;
  if (isBool(raw.ending)) out.ending = raw.ending;
  if (raw.view === "chords" || raw.view === "sheet") out.view = raw.view;
  if (CLICK_MODES.includes(raw.click as ClickMode)) out.click = raw.click as ClickMode;
  if (SPEED_UPS.includes(raw.speedUp as SpeedUp)) out.speedUp = raw.speedUp as SpeedUp;
  if (KEY_STEPS.includes(raw.keyStep as KeyStep)) out.keyStep = raw.keyStep as KeyStep;
  if (TRADE_MODES.includes(raw.trade as TradeMode)) out.trade = raw.trade as TradeMode;
  if (CHORDS_SHOWN.includes(raw.chords as ChordsShown)) out.chords = raw.chords as ChordsShown;
  if (isBool(raw.showScales)) out.showScales = raw.showScales;
  const mix = parseMix(raw.mix);
  if (mix) out.mix = mix;
  return out;
}

const parseJson = (text: string | null): unknown => {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The stored settings of a tune, as a partial; empty when there are none or they're unreadable. */
export const storedSettings = (chartId: string): Partial<TuneSettings> => parseSettings(parseJson(readStored(tuneKey(chartId))));

export const loadSettings = (chart: Chart): TuneSettings => {
  const s = { ...defaultSettings(chart), ...storedSettings(chart.id) };
  return { ...s, style: playableStyle(chart, s.style) };
};

/** Remember a tune's settings; when they all match the defaults, the entry is removed instead. */
export function saveSettings(chart: Chart, settings: TuneSettings) {
  const key = tuneKey(chart.id);
  if (JSON.stringify(settings) === JSON.stringify(defaultSettings(chart))) forget(key);
  else store(key, JSON.stringify(settings));
}

export const clearSettings = (chartId: string) => forget(tuneKey(chartId));
