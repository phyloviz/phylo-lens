import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  resolve: {
    alias: process.env.PHYLO_LENS_EVAL_PRODUCT_ROOT
      ? {
          "../../../code/client/dist/index.js": resolve(
            process.env.PHYLO_LENS_EVAL_PRODUCT_ROOT,
            "code/client/dist/index.js",
          ),
        }
      : {},
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
