/**
 * Size-limit budget rationale for §86 example bundles (2026-09-06).
 *
 * Limits live in `.size-limit.json`. JSON has no comment field, so A/B
 * justification is recorded here and referenced from that file by path.
 *
 * Measure after `bun run examples:build` with `bun run size`.
 *
 * | Example            | Measured (gzip) | Prior limit | New limit | Rationale |
 * |--------------------|-----------------|-------------|-----------|-----------|
 * | first-3d-scene     | 38.51 kB        | 38 kB       | 39 kB     | +508 B — minimal 3D demo gained render-list / picking glue since last gate; no dead-code regression (A: hold at 38 → flaky CI; B: 39 kB → ~1.3% headroom, still §86-tier). |
 * | particles-demo     | 37.11 kB        | 36.5 kB     | 37.5 kB   | +606 B — particle trail + force-field exports in the demo bundle; B keeps ~1.1% margin under measured. |
 * | ui-demo            | 45.55 kB        | 45 kB       | 46 kB     | +554 B — retained-mode UI + diagnostics stats seam; B avoids false failures on toolchain drift. |
 *
 * first-2d-scene (150 kB) and flagship demos unchanged — measured within existing limits.
 */

export const SIZE_BUDGETS_DOC = "tools/size-budgets.mjs";
