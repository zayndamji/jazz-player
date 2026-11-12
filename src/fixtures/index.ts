import type { Chart } from "../chart/types";
import ballad from "./ballad-form.json";
import bossa from "./bossa-form.json";
import five from "./five-form.json";
import swing from "./swing-form.json";
import waltz from "./waltz-form.json";

/**
 * Made-up charts for the tests, shaped like the forms the styles play (intro,
 * AABA, tag, coda, "%" bars, two-chord bars, 3/4 and 5/4). Not real tunes, and not in the library.
 */
export const bossaForm = bossa as Chart;
export const swingForm = swing as Chart;
export const balladForm = ballad as Chart;
export const waltzForm = waltz as Chart;
export const fiveForm = five as Chart;
export const FIXTURES: Chart[] = [bossaForm, swingForm, balladForm, waltzForm, fiveForm];
