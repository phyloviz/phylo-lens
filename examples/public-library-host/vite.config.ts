import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": process.env.VITE_PHYLO_LENS_PROXY_TARGET ?? "http://localhost:8000",
      "/health": process.env.VITE_PHYLO_LENS_PROXY_TARGET ?? "http://localhost:8000",
    },
  },
  build: {
    outDir: "dist",
  },
});
