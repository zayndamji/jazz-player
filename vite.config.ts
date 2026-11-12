import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import saveRecordings from "./scripts/save-recordings.mjs";

export default defineConfig({
  plugins: [react(), saveRecordings()],
});
