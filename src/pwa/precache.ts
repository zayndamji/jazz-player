import { createHash } from "node:crypto";

export interface PrecacheFile {
  /** Path relative to the site root, like "assets/index-abc.js". */
  path: string;
  /** The file's bytes, used only for the cache version. */
  content: string;
}

const SKIP = /(\.map$|(^|\/)sw\.js$|(^|\/)\.|(^|\/)LICENSE|\.(md|txt)$)/i;

/** Which of the built and public files the app needs offline, sorted. */
export function precacheFiles(files: PrecacheFile[]): PrecacheFile[] {
  const seen = new Map<string, PrecacheFile>();
  for (const f of files) {
    const path = f.path.replace(/^\/+/, "");
    if (!path || SKIP.test(path)) continue;
    seen.set(path, { path, content: f.content });
  }
  return [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The worker's URL list, relative to the worker, with the page itself as "./". */
export function precacheUrls(files: PrecacheFile[]): string[] {
  return ["./", ...precacheFiles(files).map((f) => f.path)];
}

/** Changes whenever a path or a file's content changes. */
export function cacheVersion(files: PrecacheFile[]): string {
  const h = createHash("sha256");
  for (const f of precacheFiles(files)) {
    h.update(f.path).update("\0").update(f.content).update("\0");
  }
  return h.digest("hex").slice(0, 12);
}

/** Fill the worker template's two placeholders. */
export function renderWorker(template: string, files: PrecacheFile[]): string {
  return template
    .replace("__PRECACHE__", JSON.stringify(precacheUrls(files)))
    .replace("__VERSION__", JSON.stringify(cacheVersion(files)));
}
