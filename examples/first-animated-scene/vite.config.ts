import { defineConfig } from "vite";

export default defineConfig({
  // Thin §93 entry over examples/first-2d-scene. Same §85 production define
  // so a Pages build of this directory tree-shakes the same author-facing
  // paths as the stand-in it re-exports.
  define: { __FOUR_DEV__: "false" },
  build: {
    outDir: "dist",
  },
});
