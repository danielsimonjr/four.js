/**
 * Istanbul coverage reporter: fail the run if any non-empty file is below a
 * per-file floor. Loaded from `vitest.coverage.config.ts` — see that file's
 * header for why this is a reporter rather than `thresholds.perFile`, and for
 * the measured floor.
 *
 * Empty / type-only files (`summary.isEmpty()`, or a metric with `total === 0`)
 * are skipped so a types-only module cannot fail as 0%.
 *
 * Istanbul's `reports.create()` `require()`s this module, so it must stay CJS.
 */
"use strict";

/** Prefer `src/...` when the file sits in a package `src/` tree. */
function displayPath(file) {
  const normalized = String(file).replace(/\\/g, "/");
  const src = normalized.lastIndexOf("/src/");
  return src === -1 ? normalized : normalized.slice(src + 1);
}

class PerFileCoverageFloor {
  constructor(opts = {}) {
    this.lines = opts.lines;
    this.functions = opts.functions;
    this.statements = opts.statements;
    this.branches = opts.branches;
    this.failures = [];
  }

  execute(context) {
    this.failures = [];
    context.getTree().visit(this, context);
    if (this.failures.length === 0) {
      return;
    }
    process.exitCode = 1;
    for (const failure of this.failures) {
      console.error(
        `ERROR: Coverage for ${failure.key} (${failure.pct}%) does not meet per-file threshold (${failure.threshold}%) for ${failure.file}`,
      );
    }
  }

  onDetail(node) {
    const summary = node.getCoverageSummary();
    if (summary.isEmpty()) {
      return;
    }
    const file = displayPath(node.getFileCoverage().path);
    for (const key of ["lines", "functions", "statements", "branches"]) {
      const threshold = this[key];
      if (threshold === undefined) {
        continue;
      }
      const metric = summary[key];
      if (metric.total === 0) {
        continue;
      }
      if (metric.pct < threshold) {
        this.failures.push({
          file,
          key,
          pct: metric.pct,
          threshold,
        });
      }
    }
  }
}

module.exports = PerFileCoverageFloor;
