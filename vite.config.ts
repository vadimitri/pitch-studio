import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base: the same build runs under vadimitri.github.io/pitch-studio/ and on localhost (booth).
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2022", assetsInlineLimit: 0 },
  server: { host: "localhost", port: 5173 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
