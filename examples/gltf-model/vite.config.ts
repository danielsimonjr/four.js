import { defineConfig } from "vite";

export default defineConfig({
  // §85: the example ships as a production build, like every other one here.
  define: { __FOUR_DEV__: "false" },
  build: { outDir: "dist" },
});
