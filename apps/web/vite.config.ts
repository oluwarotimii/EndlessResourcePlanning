import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = { "/api": "http://localhost:4010" };
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: api },
  preview: { port: 4173, proxy: api },
  // The service worker reads this list so every screen chunk is cached on first visit and the till opens offline.
  build: { sourcemap: true, manifest: "asset-manifest.json" },
});
