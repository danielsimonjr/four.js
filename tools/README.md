# Tools

Repository tooling (build scripts, code generation, release/CI helpers) supporting the
toolchain baseline of §91: pnpm workspace, Vitest, Playwright, ESLint, Prettier, TypeDoc,
Vite, Changesets (choices recorded in `MEMORY.md`, 2026-07-29).

> §91 also lists **Turborepo**, but this repo no longer uses it. `turbo run build` was
> replaced by `pnpm -r --workspace-concurrency=4 run build` on 2026-08-03 after `turbo.exe`
> terminated a critical system process and bugchecked the build machine. pnpm's default
> recursive walk is already topological over `workspace:*` deps, so ordering is preserved;
> what was lost is turbo's cache. See `CHANGELOG.md`.

## Available now

- `check-spec.mjs` — mechanical consistency checks for `docs/SPECIFICATION.md`: section
  sequence (1–120 + the frozen lettered insertions), duplicate detection, code-fence
  balance, TOC/body agreement, §-reference validity, and banned pre-revision terms
  (`MotionAuthority`, `syncToScene`, positive-Y 2D gravity, …). Run after any spec edit:

  ```sh
  pnpm check-spec
  ```

- `create-dependency-graph/` (**CDG**) — full-parse generator. Walks every workspace
  package and writes `docs/Architecture/` (dependency graph, file inventory, export
  surfaces, duplicate symbols, unused/dormant analysis). Heavy; run it when structure
  changes, not on every edit.

  ```sh
  pnpm graph
  ```

  CDG's directory also carries the **duplicate-symbol gate**:

  ```sh
  pnpm graph:duplicates            # CI gate — fails on NEW TRUE_DUPLICATE names
  ```

  `check-duplicates.mjs` reads `docs/Architecture/duplicate-symbols.json` (fresh after
  `pnpm graph`; the script's `--no-regen` flag skips its own re-parse) and fails if any
  `TRUE_DUPLICATE` name exists beyond `docs/Architecture/duplicate-baseline.json` — the
  accepted, shrinking consolidation backlog (seeded 2026-08-04: `cloneJsonValue`,
  `DEFAULT_GRAVITY_Y`, `SeededRandom`, `ColorRGBA`, `JsonValue`). Legitimately-independent
  duplicates are instead *allowlisted* in `duplicate-allowlist.json` with a reason
  (four.js entries: per-package `PACKAGE_NAME`; `PARTICLE_INSTANCE_FLOATS`, a deliberate
  duck-typed contract because the dependency matrix forbids the particles↔render edge).
  After consolidating a baselined name, shrink the baseline with:

  ```sh
  node tools/create-dependency-graph/gen-duplicate-baseline.mjs
  ```

- `query-dependency-graph/` (**QDG**) — read-only consumer of CDG's JSON. Answers
  structural questions without re-parsing, and emits `dependency-reverse.json` +
  `node-safety.json`.

  ```sh
  pnpm graph:query                 # emit derived artifacts
  pnpm graph:check                 # CI gate — see below
  pnpm graph:test                  # QDG's own unit tests

  node tools/query-dependency-graph/query-dependency-graph.mjs cycles
  node tools/query-dependency-graph/query-dependency-graph.mjs dependents <file>
  node tools/query-dependency-graph/query-dependency-graph.mjs symbol-users <symbol>
  node tools/query-dependency-graph/query-dependency-graph.mjs is-public <pkg> <symbol>
  ```

### Why `graph:check` gates CI

four.js targets the browser. `graph:check` asserts that every package's `.` (main) entry
stays free of `node:` builtins. A `node:` import that reaches a main entry is a shipping
bug — the package breaks in a browser — yet it is invisible to `tsc` and to unit tests,
which run under Node and resolve `node:` happily. As of the initial run all 24 packages
pass, so the gate starts green and catches the first regression rather than documenting an
existing mess.

### Origin

CDG and QDG were written for MathTS and are vendored here rather than published. One
upstream change was required for four.js: CDG discovered workspaces only from
`package.json`'s `workspaces` field, which pnpm does not use, so a pnpm repo looked like a
single package and the scan found zero files. `readWorkspacePatterns()` now also reads
`pnpm-workspace.yaml`'s `packages:` list (and yarn's `{ packages: [...] }` object form),
dropping pnpm's negated globs rather than treating them as literal directory names. Keep
this copy in sync with `llm-wiki/tools/`, which carries the same fix.

The byte-identity rule covers the tool **code** only. `duplicate-allowlist.json` is
per-repo *data* (it ships with MathTS's entries, which are inert here because their file
paths never match) — four.js appends its own entries to it and the two copies are expected
to differ. Likewise `docs/Architecture/duplicate-baseline.json` is generated per repo.
