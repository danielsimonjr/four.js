import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";

export function registerGpuReadbackTest(): void {
  test("RFC 0009 refresh then CanvasTexture upload preserves target pixels", async ({
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
            new URL("gpu-readback-page.ts", import.meta.url),
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
    await page.waitForSelector("body[data-readback-ready='1']", {
      state: "attached",
    });
    const backend = info.project.name === "webgpu" ? "webgpu" : "webgl";
    const resultBytes = await page.evaluate(
      async (b) => window.fourReadbackProbe!(b as "webgl" | "webgpu"),
      backend,
    );
    const expected = Array.from({ length: 16 * 16 * 4 }, (_, i) =>
      i % 4 === 0 || i % 4 === 3 ? 255 : 0,
    );
    expect(resultBytes.snapshot).toEqual(expected);
    expect(resultBytes.sampled).toEqual(expected);
  });
}
