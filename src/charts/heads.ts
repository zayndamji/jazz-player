/**
 * Lead sheets (the head) hold the melody: tunes/<id>/head.musicxml next to the
 * tune's chart (gitignored, like the chart), made from head.txt with
 * scripts/make_head.py or exported from MuseScore. Without the file the tune
 * has no lead sheet view.
 */
import { parseMelody, type MelodyNote } from "../engine/melody";

const files = import.meta.glob(["../../tunes/*/head.musicxml", "../../examples/*/head.musicxml"], { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

const byId = new Map(Object.entries(files).map(([path, load]) => [path.split("/").at(-2)!, load]));

export function hasHead(chartId: string): boolean {
  return byId.has(chartId);
}

const melodies = new Map<string, Promise<MelodyNote[][] | null>>();

/** The head's melody notes by printed measure (read once per tune), or null without a lead sheet or when the file can't be read. */
export function loadMelody(chartId: string): Promise<MelodyNote[][] | null> {
  let found = melodies.get(chartId);
  if (!found) {
    const xml = loadHead(chartId);
    found = xml ? xml.then(parseMelody).catch(() => null) : Promise.resolve(null);
    melodies.set(chartId, found);
  }
  return found;
}

export function loadHead(chartId: string): Promise<string> | null {
  const load = byId.get(chartId);
  return load ? load() : null;
}
