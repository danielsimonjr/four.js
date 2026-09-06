import { defineConfig } from "vite";

export default defineConfig({
  // Thin §93 entry over examples/physics-playground.
  define: { __FOUR_DEV__: "false" },
  build: {
    outDir: "dist",
  },
});
