import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";

export function registerTextureUploadTest(): void {
  test("bitmap copy, completed texture preparation, and regional uploads preserve pixels", async ({
    page,
  }, info) => {
    const result = await build({
      logLevel: "error",
      build: {
        write: false,
        minify: false,
        target: "es2022",
        lib: {
          entry: fileURLToPath(
            new URL("texture-upload-page.ts", import.meta.url),
          ),
          formats: ["es"],
        },
      },
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (!("output" in output)) throw new Error("Missing fixture bundle");
    const code = output.output
      .filter((chunk) => chunk.type === "chunk")
      .map((chunk) => chunk.code)
      .join("\n");
    await page.goto("http://localhost:4173/");
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ type: "module", content: code });
    await page.waitForSelector("body[data-texture-ready='1']", {
      state: "attached",
    });
    const backend = info.project.name === "webgpu" ? "webgpu" : "webgl";
    const pixels = await page.evaluate(
      async (b) => window.fourTextureProbe!(b as "webgl" | "webgpu"),
      backend,
    );
    expect(pixels.prepared).toEqual([true, true]);
    expect(pixels.copied).toEqual([
      0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255,
    ]);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const start = (y * 4 + x) * 4;
        expect(pixels.initial.slice(start, start + 4)).toEqual(
          y < 2 ? [0, 0, 255, 255] : [255, 0, 0, 255],
        );
        expect(pixels.changed.slice(start, start + 4)).toEqual(
          y < 2
            ? x < 2
              ? [0, 255, 0, 255]
              : [0, 0, 255, 255]
            : [255, 0, 0, 255],
        );
      }
  });
}
