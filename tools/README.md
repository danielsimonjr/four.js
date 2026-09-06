# Tools

Repository tooling (build scripts, code generation, release/CI helpers) supporting the
toolchain baseline of §91 (revision 1.14 / RFC 0006): Bun workspace, Vitest, Playwright,
ESLint, Prettier, TypeDoc, Vite, Changesets (choices recorded in `MEMORY.md`).

> Task orchestration is `bun run --filter './packages/*'` (sequential for `build`,
> parallel for `test`). Library emit remains `tsc -b`. See RFC 0006 and `CHANGELOG.md`.

## Available now

- `check-spec.mjs` — mechanical consistency checks for `docs/SPECIFICATION.md`: section
  sequence (1–120 + the frozen lettered insertions), duplicate detection, code-fence
  balance, TOC/body agreement, §-reference validity, and banned pre-revision terms
  (`MotionAuthority`, `syncToScene`, positive-Y 2D gravity, …). Run after any spec edit:

  ```sh
  bun run check-spec
  ```

- `check-docs.mjs` — doc-truth CI gate (added 2026-08-05): pins mechanically-checkable
  documentation claims — example counts against `git ls-files`, placeholder directories
  docs must not send readers to, and the exact wording of retired claims — so a revert or
  a stale copy-paste fails in CI instead of shipping.

  ```sh
  bun run check-docs
  ```

- `generate-compatibility.mjs` — §90 compatibility-table generator (added 2026-08-07, gap
  A-26; renderer backends added 2026-09-06, A-26 follow-up). Rebuilds the solver-adapter
  and renderer-backend blocks of `docs/COMPATIBILITY.md` between their generated-block
  markers from **live** capability declarations (imports each built `dist/`, constructs
  the adapter or renderer, reads `capabilities`; probes
  `SolverBodyAccess`/`SolverJointAccess` structurally against `@four/physics`'s emitted
  declarations; parses `RendererCapabilities` members from `@four/render`'s emitted
  `renderer.d.ts`). Requires a built tree. Adding an adapter or renderer package adds a
  column with no tool edit.

  ```sh
  bun run check-compat                # CI gate — fails if the committed doc drifted
  node tools/generate-compatibility.mjs   # regenerate in place after an adapter change
  ```

- `render-guides.mjs` — Pages HTML for `docs/guides/*.md` (added 2026-09-06). Pages
  serves files and does not render Markdown, so the docs workflow runs this at
  assemble time into `_site/guides/`. Same CSS as `website/index.html`. Does not
  write into `docs/guides/`.

  ```sh
  bun tools/render-guides.mjs --out=_site/guides
  ```

- `render-spec-pdf.mjs` — optional derived PDF of `docs/SPECIFICATION.md` (added
  2026-09-06). Writes `docs/SPECIFICATION.generated.pdf` when `pandoc` is on
  PATH; no-ops with a message when it is not. Never touches
  `docs/archive/four-js-specification.pdf`.

  ```sh
  bun tools/render-spec-pdf.mjs
  ```

- `apply-publish-names.mjs` — §98 publish-name mapping (added 2026-08-07, gap A-25).
  Rewrites `@four/x` → `@danielsimonjr/fourjs-x` (and `four` → `@danielsimonjr/fourjs`)
  into a **staging copy**, never in place: package manifests, `workspace:*` ranges
  (resolved the way the workspace protocol publishes), and quoted workspace specifiers in emitted `.js`/`.d.ts`
  (tsc writes workspace names straight through, so manifests alone would publish 24
  mutually-unresolvable packages). Check mode by default; `--out=<dir>` stages.

  ```sh
  bun run publish-names               # check mode: verify the mapping, write nothing
  bun run publish-names:test          # its own node --test suite
  bun run release:publish             # staging + npm publish loop (owner-gated; see
                                   # .changeset/README.md)
  ```

- `create-dependency-graph/` (**CDG**) — full-parse generator. Walks every workspace
  package and writes `docs/Architecture/` (dependency graph, file inventory, export
  surfaces, duplicate symbols, unused/dormant analysis). Heavy; run it when structure
  changes, not on every edit.

  ```sh
  bun run graph
  ```

  CDG's directory also carries the **duplicate-symbol gate**:

  ```sh
  bun run graph:duplicates            # CI gate — fails on NEW TRUE_DUPLICATE names
  ```

  `check-duplicates.mjs` reads `docs/Architecture/duplicate-symbols.json` (fresh after
  `bun run graph`; the script's `--no-regen` flag skips its own re-parse) and fails if any
  `TRUE_DUPLICATE` name exists beyond `docs/Architecture/duplicate-baseline.json` — the
  accepted, shrinking consolidation backlog (seeded 2026-08-04: `cloneJsonValue`,
  `DEFAULT_GRAVITY_Y`, `SeededRandom`, `ColorRGBA`, `JsonValue`). Legitimately-independent
  duplicates are instead _allowlisted_ in `duplicate-allowlist.json` with a reason
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
  bun run graph:query                 # emit derived artifacts
  bun run graph:check                 # CI gate — see below
  bun run graph:test                  # QDG's own unit tests

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

CDG and QDG were written for MathTS and are vendored here rather than published. Workspace
discovery reads `package.json`'s `workspaces` field (array form or `{ packages: [...] }`),
which is what Bun uses (RFC 0006). Negated globs are dropped rather than treated as literal
directory names. Keep this copy in sync with `llm-wiki/tools/` when that tree carries the
same fix.

The byte-identity rule covers the tool **code** only. `duplicate-allowlist.json` is
per-repo _data_ (it ships with MathTS's entries, which are inert here because their file
paths never match) — four.js appends its own entries to it and the two copies are expected
to differ. Likewise `docs/Architecture/duplicate-baseline.json` is generated per repo.
