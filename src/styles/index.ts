import { ballad } from "./ballad";
import { bossa } from "./bossa";
import { five } from "./five";
import { swing } from "./swing";
import { waltz } from "./waltz";
import type { Chart } from "../chart/types";
import type { Style } from "./types";

export const STYLES: Record<string, Style> = {
  [ballad.id]: ballad,
  [bossa.id]: bossa,
  [swing.id]: swing,
  [waltz.id]: waltz,
  [five.id]: five,
};

/** True when the style can play bars of this many beats (4 unless it lists `meters`). */
export const playsMeter = (style: Style, beatsPerBar: number) => (style.meters ?? [4]).includes(beatsPerBar);

/** The styles that can play a chart's meter, in menu order. */
export const stylesFor = (chart: Chart): Style[] => Object.values(STYLES).filter((s) => playsMeter(s, chart.beatsPerBar));

/** A remembered or shared style id when it exists and plays the chart's meter, else the chart's own style. */
export const playableStyle = (chart: Chart, id: string): string => (STYLES[id] && playsMeter(STYLES[id], chart.beatsPerBar) ? id : chart.style);
