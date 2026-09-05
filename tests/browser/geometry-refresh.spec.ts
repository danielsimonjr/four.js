/** Compare reused buffers with independently allocated buffers on a real driver. */
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";

let code = "";
test.beforeAll(async () => {
  const result = await build({
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: {
        entry: fileURLToPath(
          new URL("fixtures/geometry-refresh-page.ts", import.meta.url),
        ),
        formats: ["es"],
        fileName: "geometry-refresh-page",
      },
    },
  });
  const output: unknown = Array.isArray(result) ? result[0] : result;
  if (typeof output === "object" && output !== null && "output" in output) {
    for (const chunk of (output as { output: unknown[] }).output) {
      if (typeof chunk === "object" && chunk !== null && "code" in chunk)
        code += `${String(chunk.code)}\n`;
    }
  }
  if (code === "") throw new Error("geometry fixture bundled to nothing");
});

for (const indexed of [false, true]) {
  test(`geometry refresh preserves queued pixels (${indexed ? "indexed" : "unindexed"})`, async ({
    page,
  }) => {
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-geometry-refresh-ready='1']", {
      state: "attached",
    });
    const result = await page.evaluate((useIndices) => {
      const probe = window.fourGeometryRefreshProbe;
      if (probe === undefined) throw new Error("missing geometry probe");
      const fresh = probe(false, useIndices);
      const reused = probe(true, useIndices);
      let differing = 0;
      const drawnPerStep = new Array<number>(7).fill(0);
      for (let i = 0; i < fresh.pixels.length; i++) {
        if (fresh.pixels[i] !== reused.pixels[i]) differing++;
        if (i % 4 === 0 && fresh.pixels[i] > 8)
          drawnPerStep[Math.floor(((i / 4) % 448) / 64)]++;
      }
      return {
        differing,
        drawnPerStep,
        errors: [fresh.error, reused.error],
        fresh: fresh.reused,
        reused: reused.reused,
      };
    }, indexed);
    expect(result.errors).toEqual([0, 0]);
    expect(result.differing).toBe(0);
    // Every queued version must actually draw; two blank frames prove nothing.
    for (const drawn of result.drawnPerStep) expect(drawn).toBeGreaterThan(200);
    expect(result.fresh).toEqual([false, false, false, false, false, false]);
    expect(result.reused).toEqual([true, true, true, false, true, false]);
  });
}
