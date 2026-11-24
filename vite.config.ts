import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import saveRecordings from "./scripts/save-recordings.mjs";
import { renderWorker, type PrecacheFile } from "./src/pwa/precache";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Writes sw.js into the build with the list of files to keep for offline use. */
function pwa(): Plugin {
  let publicDir = "";
  return {
    name: "bandstand-pwa",
    apply: "build",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const files: PrecacheFile[] = Object.values(bundle).map((item) => ({
        path: item.fileName,
        content: item.type === "chunk" ? item.code : Buffer.from(item.source).toString("base64"),
      }));
      if (publicDir) {
        for (const file of walk(publicDir)) {
          files.push({ path: relative(publicDir, file).split("\\").join("/"), content: readFileSync(file, "base64") });
        }
      }
      const template = readFileSync(join(import.meta.dirname, "src/pwa/sw.js"), "utf8");
      this.emitFile({ type: "asset", fileName: "sw.js", source: renderWorker(template, files) });
    },
  };
}

export default defineConfig({
  plugins: [react(), saveRecordings(), pwa()],
  // Agent worktrees live in .claude/worktrees: their tests are theirs to run, and a file
  // written there (an index.html) must not reload the page. Nor must a saved recording.
  server: { watch: { ignored: ["**/.claude/worktrees/**", "**/tunes/*/analysis/**"] } },
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
});
