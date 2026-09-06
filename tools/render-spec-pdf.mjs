#!/usr/bin/env node
// Optional derived PDF of docs/SPECIFICATION.md.
//
// Does **not** touch docs/archive/four-js-specification.pdf — that file is the
// frozen pre-1.0 original (see docs/ERRATA.md). This tool writes
// docs/SPECIFICATION.generated.pdf when `pandoc` is on PATH, and no-ops with
// a message when it is not. No npm dependency is added: a missing converter
// is not a reason to pull a PDF stack into the workspace.
//
// Usage:
//   bun tools/render-spec-pdf.mjs

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "docs", "SPECIFICATION.md");
const dest = join(root, "docs", "SPECIFICATION.generated.pdf");

if (!existsSync(source)) {
  console.error("render-spec-pdf: docs/SPECIFICATION.md is missing");
  process.exit(1);
}

const probe = spawnSync("pandoc", ["-v"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  console.log(
    "render-spec-pdf: pandoc is not available; skipping. " +
      "Install pandoc to write docs/SPECIFICATION.generated.pdf. " +
      "docs/archive/four-js-specification.pdf is never overwritten.",
  );
  process.exit(0);
}

const result = spawnSync(
  "pandoc",
  [source, "-o", dest, "--from=gfm", "--pdf-engine=xelatex"],
  { encoding: "utf8" },
);

if (result.status !== 0) {
  // A second try without a LaTeX engine: some pandoc builds can emit PDF via
  // context/wkhtmltopdf; if that is also missing, skip rather than fail CI.
  const fallback = spawnSync("pandoc", [source, "-o", dest, "--from=gfm"], {
    encoding: "utf8",
  });
  if (fallback.status !== 0) {
    console.log(
      "render-spec-pdf: pandoc is present but could not write a PDF " +
        `(${(fallback.stderr || result.stderr || "no engine").trim() || "failed"}). ` +
        "Skipping. docs/archive/four-js-specification.pdf is never overwritten.",
    );
    process.exit(0);
  }
}

console.log(`render-spec-pdf: wrote ${dest}`);
