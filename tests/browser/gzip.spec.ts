import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { build } from "vite";

test("gzip host adapter validates stream integrity and decoded limits in Chromium", async ({
  page,
}) => {
  const result = await build({
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: {
        entry: fileURLToPath(new URL("fixtures/gzip-page.ts", import.meta.url)),
        formats: ["es"],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!("output" in output)) throw new Error("Missing gzip fixture bundle");
  const code = output.output
    .filter((chunk) => chunk.type === "chunk")
    .map((chunk) => chunk.code)
    .join("\n");
  await page.goto("http://localhost:4173/");
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ type: "module", content: code });
  await page.waitForSelector("body[data-gzip-ready='1']", {
    state: "attached",
  });
  const bytes = Array.from(gzipSync("fourJS — 世界"));
  expect(
    await page.evaluate((input) => window.fourGzipProbe!(input, 100), bytes),
  ).toBe("fourJS — 世界");
  expect(
    await page.evaluate((input) => window.fourGzipProbe!(input, 2), bytes),
  ).toBe("UNTRUSTED_INPUT_REJECTED");
  bytes[bytes.length - 8] ^= 255;
  expect(
    await page.evaluate((input) => window.fourGzipProbe!(input, 100), bytes),
  ).toBe("UNTRUSTED_INPUT_REJECTED");
});
