import { resolve } from "node:path";

import { defineConfig } from "vite";

// Library-mode build. Keeps the demo build (vite.config.ts + index.html)
// untouched: `npm run build` still emits the demo app, while `npm run
// build:lib` emits the consumable package from src/index.ts.
//
// The rendering stack is installed as normal package dependencies so consumers
// do not need to know the implementation details, but it remains externalized
// from this ESM bundle so host bundlers can process the upstream packages once.
const EXTERNAL_RUNTIME_DEPENDENCIES = [
  "sigma",
  "graphology",
  "graphology-layout-forceatlas2",
  "@sigma/node-border",
  "@sigma/node-piechart",
];

// Externalize runtime deps and any of their subpath imports (e.g. "sigma/...").
function isExternal(id: string): boolean {
  return EXTERNAL_RUNTIME_DEPENDENCIES.some(
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
    sourcemap: false,
    rollupOptions: {
      external: isExternal,
    },
  },
});
