import { bossa } from "./bossa";
import { swing } from "./swing";
import type { Style } from "./types";

export const STYLES: Record<string, Style> = {
  [bossa.id]: bossa,
  [swing.id]: swing,
};
