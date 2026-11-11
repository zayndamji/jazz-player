/**
 * Lead sheets (the head) hold the melody: tunes/<id>/head.musicxml next to the
 * tune's chart (gitignored, like the chart), made from head.txt with
 * scripts/make_head.py or exported from MuseScore. Without the file the tune
 * has no lead sheet view.
 */
const files = import.meta.glob(["../../tunes/*/head.musicxml", "../../examples/*/head.musicxml"], { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

const byId = new Map(Object.entries(files).map(([path, load]) => [path.split("/").at(-2)!, load]));

export function hasHead(chartId: string): boolean {
  return byId.has(chartId);
}

export function loadHead(chartId: string): Promise<string> | null {
  const load = byId.get(chartId);
  return load ? load() : null;
}
