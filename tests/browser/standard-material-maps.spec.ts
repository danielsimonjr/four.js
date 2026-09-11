import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";

// Real pixels are required: mocked GL cannot prove derivative tangent frames or
// distinguish occluding ambient irradiance from multiplying the final colour.
test("standard normal maps perturb lighting and AO attenuates ambient only", async ({
  page,
}) => {
  const result = await build({
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: {
        entry: fileURLToPath(
          new URL("fixtures/standard-material-maps-page.ts", import.meta.url),
        ),
        formats: ["es"],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!("output" in output))
    throw new Error("Missing standard-material fixture bundle");
  const code = output.output
    .filter((chunk) => chunk.type === "chunk")
    .map((chunk) => chunk.code)
    .join("\n");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:4173/");
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ type: "module", content: code });
  await page.waitForSelector("body[data-standard-maps-ready='1']", {
    state: "attached",
  });
  const pixels = await page.evaluate(() => window.fourStandardMapsProbe!());
  expect(errors).toEqual([]);
  for (const sample of Object.values(pixels)) expect(sample[3]).toBe(255);
  for (let channel = 0; channel < 3; channel += 1) {
    const baseline = pixels.geometric[channel];
    expect(baseline).toBeGreaterThan(25);
    expect(baseline).toBeLessThan(45);
    expect(Math.abs(pixels.neutral[channel] - baseline)).toBeLessThanOrEqual(1);
    expect(pixels.sideways[channel]).toBeLessThan(3);
    expect(
      Math.abs(pixels.zeroNormalScale[channel] - baseline),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(pixels.degenerateUvs[channel] - baseline),
    ).toBeLessThanOrEqual(1);
    // Ambient contribution is 0.4 irradiance * 0.5 albedo * 255 = 51 bytes.
    expect(
      Math.abs(pixels.unoccluded[channel] - pixels.fullAo[channel] - 51),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(pixels.unoccluded[channel] - pixels.halfAo[channel] - 25.5),
    ).toBeLessThanOrEqual(1);
    expect(pixels.zeroAo[channel]).toBe(pixels.unoccluded[channel]);
    expect(pixels.directAndEmissionWithAo[channel]).toBe(
      pixels.directAndEmissionWithoutAo[channel],
    );
    expect(pixels.fullAo[channel]).toBe(
      pixels.directAndEmissionWithAo[channel],
    );
    expect(
      Math.abs(pixels.emissionWithAo[channel] - 0.05 * 255),
    ).toBeLessThanOrEqual(1);
  }
});
