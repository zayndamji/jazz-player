/**
 * Lead sheets (the head) hold the melody, so each is a personal transcription
 * kept out of git: local/heads/<chart id>.musicxml. Edit it in MuseScore or any
 * MusicXML editor. When the file is missing the site has no lead sheet view.
 */
const files = import.meta.glob("../../local/heads/*.musicxml", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

export function hasHead(chartId: string): boolean {
  return `../../local/heads/${chartId}.musicxml` in files;
}

export function loadHead(chartId: string): Promise<string> | null {
  const load = files[`../../local/heads/${chartId}.musicxml`];
  return load ? load() : null;
}
