import { ballad } from "./ballad";
import { bossa } from "./bossa";
import { swing } from "./swing";
import type { Style } from "./types";

export const STYLES: Record<string, Style> = {
  [ballad.id]: ballad,
  [bossa.id]: bossa,
  [swing.id]: swing,
};
