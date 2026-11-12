// Dev-server endpoint for scripts/record-site.js: saves a recording of what the
// site plays (and its timing) to tunes/<id>/analysis/, so
// scripts/analyze_reference.py can measure our band exactly like a reference track.
// Only active under `npm run dev`.
import fs from "node:fs";
import path from "node:path";

export default function saveRecordings() {
  return {
    name: "save-recordings",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__recording", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const tune = url.searchParams.get("tune") ?? "";
        const name = url.searchParams.get("name") ?? "";
        if (req.method !== "POST" || !/^[a-z0-9-]+$/.test(tune) || !/^[a-z0-9-]+\.(webm|json)$/.test(name)) {
          res.statusCode = 400;
          res.end("POST /__recording?tune=<id>&name=<name>.webm|json");
          return;
        }
        const dir = path.resolve("tunes", tune, "analysis");
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
          res.end(path.join("tunes", tune, "analysis", name));
        });
      });
    },
  };
}
