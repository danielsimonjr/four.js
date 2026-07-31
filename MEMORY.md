# MEMORY

Persistent memory for agents and contributors working across sessions: decisions made, facts
that are easy to lose, and conventions in force. Append new entries with a date; never silently
rewrite a recorded decision — supersede it with a new entry. Tasks go in `TODO.md`; released
changes in `CHANGELOG.md`. **Compaction convention (2026-07-29):** at each phase close (see
the implementation plan), the orchestrator may collapse superseded/expired entries into a
one-line pointer at their original position ("superseded by <date> entry") so this file stays
readable; never delete the pointer itself.

## Standing facts

- The repository is **scaffold + specification only** — no implementation, no `package.json`,
  no tooling. There are no build/lint/test commands; don't invent any.
- `docs/SPECIFICATION.md` is the working reference, currently **revision 1.2** (amendments
  table at its top; § numbering 1–120 frozen, lettered sections for insertions).
  `docs/archive/four-js-specification.pdf` is the unmodified original, frozen at the pre-1.0
  text, and still contains the old duplicate numbering — translate its references via the map
  in `docs/ERRATA.md`. Run `node tools/check-spec.mjs` after any spec edit.
- Plain "§N" citations mean `SPECIFICATION.md` numbering. Cite the PDF explicitly when meant
  ("PDF §49, second range").
- All 24 packages under `packages/` are `@four/`-scoped; `four` is the umbrella package.
  Layering: stable `@four/physics` API above solver adapters; backend-independent `@four/render`
  above `render-*` backends; the logical scene never depends on a concrete backend.

## Decisions

- **2026-07-28 — Spec corrected in place (owner decision).** E-1/E-2/E-3 from `ERRATA.md`
  resolved directly in `SPECIFICATION.md`: second `Part VII` → `Part VIII` (later parts
  IX–XIII); second §45–67 range renumbered +53 to §98–120; §102 lists only `physics-rapier`
  and `physics-box2d` as solver packages. The PDF was left unmodified.
- **2026-07-28 — PDF archived.** Original spec PDF moved to `docs/archive/`; the corrected
  Markdown is the working reference for the repository.
- **2026-07-28 — Plugin marketplace registered (owner decision).** `.claude/settings.json`
  registers `local-marketplace` (GitHub `danielsimonjr/skills`, a **private** repo — sessions
  need the owner's GitHub auth to clone it) and enables `rfl`, `dev-workflow`, and
  `honest-claude` as project defaults. Machine-bound plugins from that marketplace (Windows
  automation, Outlook, local symlink/junction sources, personal MCP servers) are deliberately
  NOT project defaults — they belong in the owner's user-level settings. The settings file
  was created by the owner directly; agent writes to `.claude/settings.json` are blocked by
  the permission classifier in this environment.
- **2026-07-28 — Repository layout conventions.** Per package: `README.md` + `src/`
  (strict TS, ESM) + `tests/` (unit tests colocated, §92). Cross-package suites live in
  `tests/{integration,visual,determinism}/`; performance tests in `benchmarks/`. Examples
  follow §93 naming (`first-*-scene`, `mixed-scene`) with flagship demos under
  `examples/flagship/`. Still no `package.json`/toolchain — that remains Phase 0 (§103).
- **Pre-existing (recorded in ERRATA E-3):** the scaffold follows the monorepo tree —
  `physics-matter` and `physics-cannon` are deliberately absent and must not be added without
  a spec amendment.
- **From the spec (not yet revisited):** first physics adapter is Rapier (§108); MVP renders
  with WebGL 2 only (§120); toolchain baseline is strict TS + ESM + pnpm + Vitest +
  Playwright + ESLint + Prettier + Vite + Changesets (§91).

- **2026-07-28 — Specification review recorded, not applied.** `docs/SPEC-REVIEW.md` proposes
  improvements R-1…R-35 (P1 = internal contradictions, e.g. §23 vs §26 force signatures,
  §19 vs §42 authority enums, §52 tessellator package missing from §98; P2 = underspecified
  load-bearing designs, e.g. component model, event system, coordinate conventions, adapter
  interface gaps; P3 = structural/editorial). Cite items as "R-N" (same style as ERRATA
  "E-N"). *Superseded the same day by the revision-1.1 entry below.*
- **2026-07-28 — Spec revision 1.1 applied (owner-directed).** All 35 review items applied to
  `SPECIFICATION.md`; Amendments table added at the top of the spec. Key standing rules the
  revision established: **§ numbering 1–120 is frozen** — new sections use letter suffixes
  (now 6a Component Model, 6b Eventing, 7a Coordinate/Unit Conventions, 7b Math Conventions,
  60a Color Management) and appendices (A Normative Defaults, B Glossary); world space is
  right-handed **Y-up in both 2D and 3D** (2D gravity is negative Y); **all engine times are
  seconds** (tween/timeline durations included — no milliseconds anywhere); the single
  authority enum is `TransformAuthority` (§42, now includes `"blended"`; `MotionAuthority`
  no longer exists); force APIs use explicit `…AtPoint` names; `RigidBody`/colliders are
  *components* (§6a); the solver adapter contract (§37) includes destroy/query/drainEvents
  methods and a defined `PhysicsCapabilities`. §86 payload budget (≤150 kB gzip) was
  confirmed by the owner on 2026-07-29 (revision 1.2; no longer provisional). The `dev-workflow` plugin could not load in this
  remote session (private `danielsimonjr/skills` marketplace repo is outside the session's
  GitHub scope), so the revision was done inline.

- **2026-07-29 — Phase 0 toolchain decisions (proposed by Claude at owner direction to
  "close the open decisions"; each overridable by a superseding entry before Phase 0
  starts):**
  - **Task runner: Turborepo** (§91 permitted either). Rationale: simpler config surface for
    a pnpm workspace with uniform package shapes; no need for Nx's generator/plugin layer.
    Revisit via RFC (§95) only if remote caching/constraints prove insufficient.
  - **Browser/Node baseline** (feeds §90 compatibility tables): evergreen last-2 versions of
    Chrome/Edge/Firefox and Safari ≥ 16.4; **WebGL 2 required** for the MVP (§120); WebGPU
    is an optional tier. Node ≥ 20 (LTS) for tooling and headless simulation.
  - **Rapier strategy** (§108): official `@dimforge/rapier2d` + `@dimforge/rapier3d` wasm
    packages; the wasm loads asynchronously inside `PhysicsSolverAdapter.initialize()` (§37
    permits a Promise); exact version pinned when Phase 5 starts (tracked in TODO). Solver
    wasm is **outside** the §86 payload budget, which by its wording covers only
    core + math + scene + render-webgl.
  - **Budget enforcement**: a size-limit check in CI is a **Phase 0 deliverable**, gating
    the §86 payload row from the first compilable package onward.
  - **API docs: TypeDoc** for generated reference docs (§93). API Extractor deferred;
    revisit before 1.0 if API-report/compat gating is wanted (§90).
- **2026-07-29 — Implementation plan written for subagent execution.**
  `docs/plans/IMPLEMENTATION_PLAN.md` (Phase 0 deliverable, §103; moved from the root to
  `docs/plans/` by owner direction the same day — §103's deliverable list names the file
  without a path, so this is a location choice, not a spec deviation) structures all work
  as **work packets** `WP-<phase>.<n>` with a fixed format (Depends/Reads/Files/Steps/Done). Packets
  are tiered: **[H]** = mechanical, pre-decided, Haiku-executable; **[S]** = needs judgment,
  stronger model. Conventions in force: §1 ground rules go verbatim into every worker
  prompt; parallel packets need disjoint `Files` sets; two retries then escalate; a phase's
  exit packet must pass before the next phase starts; Phases 0–2 are fully decomposed,
  Phases 3–10 are deliberately rolling-wave (decomposed only when their predecessor exits
  green). The §98 directory tree was verified complete — packets fill directories, never
  create packages.
- **2026-07-29 — Gap-closure pass (spec 1.5, plan 2.1) after the "what else are we
  missing" review.** (1) **Naming:** npm `four` (0.0.1-a, unrelated) and `four-js` are
  occupied; `fourjs`/`@fourjs` were free 2026-07-29 (org pages bot-blocked — claiming needs
  the owner's npm account). Workspace names stay `four`/`@four/*`; rename-or-dispute is an
  owner decision due before release 0.1 (TODO). (2) **MVP coverage hole closed:** Part IX
  never scheduled §120's interaction/content/tooling scope — spec 1.5 adds §106a (Phase 3a:
  input, picking, dragging, sprites, MVP-tier text) and §113a (Phase 11: assets,
  serialization, UI, benchmark harness, docs); §56 gains an MVP text tier with full shaping
  staged behind a shaping-engine RFC (HarfBuzz-wasm the likely route). (3) **Phase −1
  smoke passed:** the full §3.2 pin set installed and ran together (build/test/lint/docs/
  vite/size-limit); template corrections folded into plan 2.1 — split dev/build tsconfigs
  per package, `pnpm.onlyBuiltDependencies: ["esbuild"]`, validated ESLint config, example
  needs a root `four` workspace devDep, size-limit set to gzip. (4) **Process homes:**
  `docs/rfcs/` created (template + process, backing the plan's RFC gate);
  `docs/POSITIONING.md` states the why-exist case, audience order (engineering/digital-twin
  first), migration story, demo-first principle (public demo ships at Phase 3a exit), and
  plain-language risks; CI gains a non-blocking `pnpm audit` step; visual tests will run
  Playwright + Chromium/SwiftShader in CI (plan Phase 3 note); MEMORY compaction convention
  added to this file's header. Release (Changesets) workflow deliberately deferred to first
  publish (§94 0.1).
- **2026-07-29 — Implementation plan stress-tested; revision 2 written.** Five independent
  passes (Haiku dry-run of WP-0.1 in a worktree — succeeded, logged 5 forced guesses;
  executability review with empirical probes; spec-fidelity review; Sonnet orchestration
  red-team; Opus technical-design red-team) produced ~85 findings, all applied in plan
  revision 2. Standing outcomes: **toolchain pins are exact** (TypeScript 5.9.3 — never
  7.x; eslint 9.39.5; typescript-eslint 8.65.0; vitest 3.2.7; turbo 2.10.7; full table in
  plan §3.2, orchestrator-adjusts-only); **frozen dependency matrix** (plan §3.1, 6 waves);
  build is **`tsc -b`** with `types`-first exports maps and `.js` relative-import suffixes;
  design decisions **D1–D8** pre-decided (Node = single inheritance extending
  EventEmitter, no mixins; `typeName`-keyed components; Transform dirty via math
  change-hooks + `markDirty`; Application composition root in `four` (spec rev 1.4);
  §39 system registry — nothing edits the scheduler; diagnostics checksum utility with
  fresh-process golden-hash determinism tests; `out?`-optional allocation policy;
  depth-range-parameterized projections, shortest-arc slerp). Orchestration now specifies:
  per-packet orchestrator commits scoped to Files, orchestrator-only installs/lockfile,
  worktree merge order, retry-with-failure-output then validate-the-Done-check escalation,
  in-place packet revisions, independent second-agent review for [S] packets,
  `WP-N.M-fixK` defect convention, orchestrator-owned tracking files, RFC gate for
  rolling-wave API surfaces. **Spec revision 1.4** (found by this pass): §98 Application
  composition root moved from `core` to `four`.
- **2026-07-29 — Spec revision 1.3 (verification pass).** Two independent adversarial
  re-reads of the 1.1 material (time/physics-semantics lens and cross-reference lens)
  surfaced 16 unique findings — 7 confirmed, 9 plausible — all fixed in revision 1.3 (see
  the spec's amendments table and CHANGELOG). Notable standing corrections: world matrices
  resolve **per fixed step**; §39 order is now …7 constraint solve, **8 sensor update,
  9 collision event dispatch**…; `Collider.density` beats `PhysicsMaterial.density`;
  checksums visit existing bodies (incl. sleeping) in monotonic body-id order; cameras and
  viewports belong to `@four/scene` (rigs stay in `@four/motion`); §40's degree/millisecond
  options are display/authoring conversion only.
- **2026-07-29 — Scaffold docs synced to revision 1.2.** CLAUDE.md, AGENTS.md, README.md,
  ERRATA.md (scope note: amendments live in the spec's table, ERRATA covers only PDF
  defects), website/README.md, and the core/motion/physics/geometry package READMEs were
  updated to match the revised spec (transform authority incl. `blended`, seconds, Y-up,
  components, adapter contract, camera rigs in `@four/motion`, units in `@four/core`,
  tessellation as a geometry module). `tools/check-spec.mjs` added as the mechanical spec
  checker (future CI docs job).

## Open questions

- Whether/when to regenerate the PDF from the corrected Markdown (it is now formally frozen
  at the pre-1.0 text — regeneration is optional, not blocking).

## Gotchas

- The ERRATA "non-defects" list exists so known false alarms aren't rediscovered: §118's
  title starts with a typographic quote (easy to miss in heading scans), and low repeated
  numbers (1., 2., 3., …) in the spec body are lists, not sections.
- The spec body text is hard-wrapped plain text under Markdown headings; code snippets have
  been fenced since 2026-07-28.
