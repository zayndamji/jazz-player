import { describe, expect, it } from "vitest";
import { cacheVersion, precacheUrls, renderWorker } from "./precache";

const f = (path: string, content = "x") => ({ path, content });

describe("precache list", () => {
  const files = [
    f("index.html"),
    f("assets/index-abc.js"),
    f("assets/index-abc.js.map"),
    f("sw.js"),
    f("manifest.webmanifest"),
    f("icons/icon-192.png"),
    f("samples/piano/piano.mp3"),
    f("samples/piano/LICENSE.md"),
    f("samples/bass/LICENSE-FluidR3.txt"),
    f(".DS_Store"),
  ];

  it("keeps what the app needs, sorted, with the page first", () => {
    expect(precacheUrls(files)).toEqual([
      "./",
      "assets/index-abc.js",
      "icons/icon-192.png",
      "index.html",
      "manifest.webmanifest",
      "samples/piano/piano.mp3",
    ]);
  });

  it("changes version with paths or content only", () => {
    const v = cacheVersion(files);
    expect(cacheVersion([...files].reverse())).toBe(v);
    expect(cacheVersion([...files, f("notes.txt")])).toBe(v);
    expect(cacheVersion([...files, f("assets/new.js")])).not.toBe(v);
    expect(cacheVersion(files.map((x) => (x.path === "index.html" ? f("index.html", "y") : x)))).not.toBe(v);
  });

  it("fills the worker template", () => {
    const out = renderWorker("const V = __VERSION__; const P = __PRECACHE__;", files);
    expect(out).toContain(`"${cacheVersion(files)}"`);
    expect(out).toContain('"samples/piano/piano.mp3"');
    expect(out).not.toContain("__");
  });
});
