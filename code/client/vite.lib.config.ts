import { resolve } from "node:path";

import { defineConfig } from "vite";

// Library-mode build. Keeps the demo build (vite.config.ts + index.html)
// untouched: `npm run build` still emits the demo app, while `npm run
// build:lib` emits the consumable package from src/index.ts.
//
// The rendering stack (sigma / graphology / @sigma/*) is externalized so the
// package declares them as peerDependencies and a host app supplies a single
// shared copy rather than bundling a duplicate Sigma/Graphology.
const PEER_DEPENDENCIES = [
  "sigma",
  "graphology",
  "graphology-layout-force",
  "graphology-layout-forceatlas2",
  "@sigma/node-border",
  "@sigma/node-piechart",
];

// Externalize peer deps and any of their subpath imports (e.g. "sigma/...").
function isExternal(id: string): boolean {
  return PEER_DEPENDENCIES.some(
    (dep) => id === dep || id.startsWith(`${dep}/`),
  );
}

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: isExternal,
    },
  },
});
