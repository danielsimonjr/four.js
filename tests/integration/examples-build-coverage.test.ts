/**
 * Every example Playwright previews must be one `examples:build` builds.
 *
 * `playwright.config.ts` starts a `vite preview` per `webServer` entry, and
 * preview serves a **prebuilt** `dist` — it does not build. So an example added
 * to the config without a matching build step fails at run time with
 *
 *     Error: The directory "dist" does not exist. Did you build your project?
 *
 * which names vite, not the missing step. That is exactly what happened: `blending`
 * and `particles-demo` joined the webServer array in e6072ee, CI kept building the
 * original three, and the browser job was red from then on. The failure looked like
 * a Playwright problem, so it survived.
 *
 * This test compares the two lists directly, so the drift fails in unit tests —
 * seconds — instead of after an install, a full monorepo build and a Chromium
 * download.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");

/** Example directories Playwright will `vite preview`, read from the real config. */
function previewedExamples(): string[] {
  const cfg = readFileSync(join(root, "playwright.config.ts"), "utf8");
  // `npx vite preview examples/<name> --port ...`
  return [...cfg.matchAll(/vite preview examples\/([a-z0-9-]+)/g)].map((m) => m[1]).sort();
}

/** Example directories `pnpm examples:build` actually builds. */
function builtExamples(): string[] {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const agg = pkg.scripts["examples:build"];
  expect(agg, "package.json must define an examples:build script").toBeTruthy();

  // examples:build chains the individual `<x>:build` scripts; resolve each to the
  // directory its `vite build` targets, rather than trusting the script names.
  return [...agg.matchAll(/pnpm ([a-z0-9:-]+)/g)]
    .map((m) => pkg.scripts[m[1]])
    .filter((cmd): cmd is string => Boolean(cmd))
    .flatMap((cmd) => [...cmd.matchAll(/vite build examples\/([a-z0-9-]+)/g)].map((m) => m[1]))
    .sort();
}

describe("examples build coverage", () => {
  it("builds every example Playwright previews", () => {
    const previewed = previewedExamples();
    const built = builtExamples();

    expect(previewed.length, "playwright.config.ts should preview at least one example").toBeGreaterThan(0);

    const missing = previewed.filter((e) => !built.includes(e));
    expect(
      missing,
      `playwright.config.ts previews ${missing.join(", ")} but examples:build does not build them — ` +
        `vite preview will fail with "The directory dist does not exist"`,
    ).toEqual([]);
  });

  it("does not build examples nothing previews", () => {
    // The cheap direction, but it catches a rename: if an example is renamed in the
    // config and the build script keeps the old name, the test above still passes
    // only if the new name happens to be built. This closes that.
    const previewed = previewedExamples();
    const orphans = builtExamples().filter((e) => !previewed.includes(e));
    expect(orphans, `examples:build builds ${orphans.join(", ")}, which no webServer entry previews`).toEqual([]);
  });
});
