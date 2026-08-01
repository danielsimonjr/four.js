# Changelog

All notable changes to this repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Once packages
are published, releases will follow [Semantic Versioning](https://semver.org/) per §90 of the
specification; until then, entries are grouped by date under **Unreleased**.

## [Unreleased]

### 2026-08-01 (later)

#### Added (Phase 3 — Renderer Foundation, §106; packets WP-3.1…WP-3.9)
- `@four/scene`: §47 cameras (D8 depth ranges) + §48 viewport. `@four/geometry`/
  `@four/materials`: BufferGeometry + primitives, UnlitMaterial. `@four/render`: §61
  Renderer interface (context-loss contract) + NullRenderer, render lists incl. the §43
  interpolated builder. `@four/render-webgl`: WebGL 2 backend over a structural GL seam
  (fake-GL unit tests, 90 tests). `four`: renderer integration with RenderInterpolation.
- Real moving example (14.88 kB gzip vs the 150 kB §86 gate) + Playwright browser gate
  (headless Chromium/SwiftShader; caught and fixed a real rAF-seed defect) + smoothness
  exit spec proving interpolated draws between simulation states.
- Phase 3 exit GREEN, zero defects; coverage ≥95% statements everywhere
  (geometry/materials/render at 100%).

### 2026-08-01

#### Added (Phase 2 — Motion Foundation, §105; packets WP-2.1…WP-2.7)
- `@four/motion`: five §38 integrators, MotionComponent + MotionSystem (pinned
  semi-implicit update, §42 enforcement), eight §13 trajectories with pinned constructors,
  KinematicController (moveTo/rotateTo/followPath, channel state machines) — 200 tests.
- `@four/scene`: TransformAuthority (§42, `blended` reserved via NOT_IMPLEMENTED),
  PoseBuffer interpolation store (§43/§37 single owner, no write-back) — 114 tests.
- Phase 2 exit: §105 demos vs independently derived closed forms (worst deviation
  3.1e-13), cross-process golden determinism; coverage ≥95% statements everywhere.
- Fixes: CI Node 22 (type-strip test children), `four/application` subpath export.

#### Added (Phase 1 — Math, Scene, and Time, §104; packets WP-1.1…WP-1.14)
- `@four/math`: mutable Vector2/3/4, Quaternion (shortest-arc slerp), column-major
  Matrix3/4 with §7 pivot compose, D8 projections, change-hooks, allocation counter —
  154 tests incl. zero-allocation proofs.
- `@four/core`: typed EventEmitter (§6b), typeName-keyed component model (§6a),
  FourError (§89 + INVALID_APPLICATION_STATE) and Disposable — 57 tests.
- `@four/scene`: Transform with the D3 dirty channel, Node/Group/Scene (D1 single
  inheritance, §46 lookups, cycle prevention), version-cached world-transform resolver —
  84 tests.
- `@four/motion`: TimeState/Clock, the §10 fixed-step scheduler (clamp, droppedTime,
  pause semantics), §39 SimulationSystem registry — 56 tests.
- `@four/diagnostics`: D6 FNV-1a checksum with cross-checked immutable known-answer
  vectors — 28 tests. `four`: §45 Application composition root (headless) — 25 tests.
- Phase 1 exit (`tests/determinism/`): 100-node/1000-frame golden-digest scenario, green
  in-process and in a fresh node process; coverage ≥95% statements in every package.
  Tooling: `tests/tsconfig.json`, `@types/node`, `@vitest/coverage-v8`.

### 2026-07-31

#### Added (Phase 0 — Project Foundation, §103; plan packets WP-0.1…WP-0.15)
- Working monorepo: root manifests with the pinned §3.2 toolchain, `tsconfig.base.json`,
  Turborepo pipeline, all 24 `@four/*`/`four` packages scaffolded per the §3.4 template
  (split dev/build tsconfigs, `tsc -b`, types-first exports; umbrella with per-package
  subpaths and a 23-package integration test), ESLint/Prettier config (type-checked,
  determinism bans per §33, named-exports rule), Vite example (`examples/first-2d-scene`),
  §86 size gate (425 B / 150 kB gzip), TypeDoc (`docs/api`), root vitest suite wiring,
  GitHub Actions CI, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `ROADMAP.md`.
- Phase 0 exit verified independently: all gates green twice (cold + warm), zero defects.
- Plan corrections discovered in execution (dated in place): WP-0.2 Done check, WP-0.4/0.5
  Files lines, `pnpm run docs` builtin pitfall, `*.tsbuildinfo` gitignore, WP-0.7-fix1.

### 2026-07-29

#### Changed (spec revision 1.6)
- npm publish names decided by the owner: umbrella `@danielsimonjr/fourjs`, sub-packages
  `@danielsimonjr/fourjs-<name>`, published from the personal scope (no org claim or
  dispute). §98 note updated; workspace names remain `four`/`@four/*`; TODO owner item
  closed.

#### Added (gap-closure pass)
- `docs/POSITIONING.md` — outward-facing why-exist case: the integration-is-the-product
  bet, audience order (engineering/digital-twins first), migration story, demo-first
  principle, and plainly stated risks.
- `docs/rfcs/` — RFC home (`README.md` process + `0000-template.md`), backing the §95 /
  implementation-plan governance gate.

#### Changed (spec revision 1.5 + plan revision 2.1)
- `docs/SPECIFICATION.md` → **revision 1.5**: added §106a (Phase 3a — input, picking,
  dragging, sprites, MVP-tier text) and §113a (Phase 11 — assets, serialization, UI,
  benchmark harness, docs), closing the hole where Part IX never scheduled the §120 MVP's
  interaction/content/tooling scope; §56 gains an MVP text tier (full shaping staged behind
  a shaping-engine decision); §98 gains a publish-names note (npm `four`/`four-js`
  occupied; `fourjs`/`@fourjs` free 2026-07-29). `tools/check-spec.mjs` allows the new
  lettered sections.
- `docs/plans/IMPLEMENTATION_PLAN.md` → **revision 2.1**: Phase −1 smoke ran the full
  pinned toolchain together successfully; template corrected to split dev/build tsconfigs,
  `pnpm.onlyBuiltDependencies`, validated ESLint config, example wiring, gzip size gate;
  phase table gains 3a and 11 rows, the CI packet gains a non-blocking `pnpm audit` step,
  and Phase 3 records the Playwright + SwiftShader GPU-in-CI strategy.
- `MEMORY.md` — compaction convention added; naming/scope-cut/demo-first decisions
  recorded. `TODO.md` — owner items: merge PR, secure npm names before 0.1; milestone
  items for demo-first, shaping RFC, release workflow.

#### Changed (plan revision 2 + spec revision 1.4)
- `docs/plans/IMPLEMENTATION_PLAN.md` rewritten as **revision 2** after a five-way stress
  test (Haiku dry-run + executability/spec-fidelity/orchestration/design reviews, ~85
  findings): exact toolchain pins (TS 5.9.3, not 7.x), frozen 24-package dependency matrix
  with dispatch waves, `tsc -b` build template with `types`-first exports and `.js` import
  suffixes, design decisions D1–D8 (Node inheritance, component identity, Transform dirty
  channel, Application in `four`, §39 system registry, checksum utility, out-policy,
  projections/slerp), Phase 0 regrown to 15 packets (adds umbrella integration, lockfile
  refresh, Vite example, TypeDoc, root suite wiring), Phase 1 to 14 (adds system registry,
  Application, checksum utility), Phase 2 in full packet format with pinned constructors,
  and a real orchestration protocol (per-packet commits, orchestrator-only installs,
  retries/escalation, independent [S] review, fix-packet convention, RFC gate).
- `docs/SPECIFICATION.md` bumped to **revision 1.4**: §98 Application composition root
  moved from `core` to the `four` umbrella (dependency-direction inversion found by the
  stress test); AGENTS.md package map updated.

#### Added
- `docs/plans/IMPLEMENTATION_PLAN.md` — Phase 0 deliverable (§103; created at the root,
  moved to `docs/plans/` the same day by owner direction), written for subagent-driven
  execution: work packets `WP-N.M` with mechanical Done-checks and [H]aiku/[S]tronger model
  tiers; §1 ground rules distilled from the spec's conventions (§6a/§6b/§7a/§7b, §33, §42);
  Phase 0 (11 packets) and Phases 1–2 (19 packets) fully decomposed; Phases 3–10 held at
  milestone level for rolling-wave decomposition; verification stack table (build/test/
  lint/check-spec/size/determinism). Directory tree verified complete against §98 — no new
  directories needed.

#### Changed (spec revision 1.3)
- `docs/SPECIFICATION.md` bumped to **revision 1.3** after a two-lens adversarial
  verification pass over the 1.1 material (16 unique findings, all fixed): world matrices
  resolve per fixed step, not per frame (§7); pause semantics defined (§10); the replay
  format now records per-frame step counts and dropped time, and §10 cites §34 rather than
  §113; §39 sensor update moved before collision-event dispatch (§6b now step 9);
  previous-pose capture for interpolation defined in §37; collider density authoritative
  over material density (§25); checksum visits existing bodies (incl. sleeping) in monotonic
  body-id order (§33); local-plane→XY mapping stated (§21); marker behavior under
  replay/snapshot-restore defined (§16); reduced motion added to §14; §40 unit options
  restricted to display/authoring conversion; `ForceField.sample` gains `out` (§27); §97
  field of view converted to radians; cameras/viewports assigned to `@four/scene` (§98,
  package README updated); Part VII group renamed "Renderables and 2D Vector Graphics";
  §6 audio marked plugin-provided.

#### Added
- `tools/check-spec.mjs` — mechanical consistency checker for `docs/SPECIFICATION.md`
  (section sequence with frozen 1–120 numbering, duplicates, fence balance, TOC/body
  agreement, §-reference validity, banned pre-revision terms). Intended as the docs job of
  the future Phase 0 CI workflow.
- Phase 0 toolchain decisions recorded in `MEMORY.md` (proposed at owner direction,
  overridable): Turborepo; evergreen browsers + Safari ≥ 16.4, WebGL 2 required, Node ≥ 20;
  Rapier via `@dimforge/rapier2d`/`rapier3d` wasm loaded in `initialize()`, version pinned at
  Phase 5, excluded from the §86 payload budget; size-limit CI gate as a Phase 0
  deliverable; TypeDoc for API docs.

#### Changed
- Scaffold docs synced to specification revision 1.2: `CLAUDE.md`, `AGENTS.md`, `README.md`,
  `docs/ERRATA.md` (scope note — amendments live in the spec's table; the archived PDF is
  formally frozen at the pre-1.0 text), `website/README.md`, and the `core`/`motion`/
  `physics`/`geometry` package READMEs (transform authority incl. `blended`, seconds
  convention, Y-up in both dimensions, component model, revised adapter contract, camera
  rigs in `@four/motion`, unit system in `@four/core`, tessellation as a geometry module).
  Also fixed a pre-existing AGENTS.md error (phase order is Part IX, not VIII).
- `docs/SPECIFICATION.md` bumped to **revision 1.2**: the §86 payload budget (minimal 2D
  application ≤ 150 kB gzip) was confirmed by the owner and its provisional marker removed;
  amendments table updated. `docs/SPEC-REVIEW.md` disposition note updated to match.

### 2026-07-28

#### Added
- `docs/SPEC-REVIEW.md` — technical review of `SPECIFICATION.md` proposing improvements
  R-1…R-35 (contradictions, underspecified designs, missing topics, structure), with a
  suggested disposition order keyed to the implementation phases. Proposals only; the
  specification itself is unchanged.
- `AGENTS.md` — detailed orientation for AI agents and new contributors (repo state,
  architecture reference, package map, implementation phases, guardrails).
- `CLAUDE.md` — guidance for Claude Code sessions.
- `TODO.md`, `CHANGELOG.md`, `MEMORY.md` — root tracking files.
- `docs/archive/` — archive location for the original specification PDF.
- `.claude/settings.json` — registers the `local-marketplace` plugin marketplace
  (`danielsimonjr/skills` on GitHub) and enables three portable skill plugins as project
  defaults: `rfl`, `dev-workflow`, `honest-claude`.
- Directory tree built out from the specification: every `packages/*` package gained a
  `README.md` (responsibilities + spec references) plus `src/` and `tests/` placeholders;
  `examples/` gained the §93 quick-start examples and the two flagship demos (§118–119);
  `tests/` gained `integration/`, `visual/`, and `determinism/` per the §92 taxonomy;
  `benchmarks/`, `tools/`, and `website/` gained purpose READMEs.

#### Changed
- `docs/SPECIFICATION.md` revised to **revision 1.1**, applying all 35 review items from
  `docs/SPEC-REVIEW.md` (owner-directed): contradictions resolved (force API §23/§26,
  authority enums §19/§42 merged into `TransformAuthority` + `"blended"`, 2D gravity sign,
  ms→s time units, `TimeState` completed, accumulator substep clamp); new lettered sections
  6a (Component Model), 6b (Eventing), 7a (Coordinate and Unit Conventions), 7b (Math Type
  Conventions), 60a (Color Management); solver adapter contract extended (destroy/query/
  `drainEvents`, `PhysicsCapabilities` defined); scope settled (audio and networking added
  to §5 non-goals); context-loss handling, precision-at-scale, COOP/COEP, per-backend visual
  baselines, package responsibilities for all 24 packages, Part VII group headings, RFC 2119
  conformance note, Amendments table, and Appendices A (Normative Defaults) and B (Glossary).
  §1–120 numbering unchanged.
- `docs/SPEC-REVIEW.md` header updated with the disposition (all items applied in 1.1;
  §86 payload budget provisional).
- `docs/SPECIFICATION.md` typeset for readability: all 96 code snippets and ASCII diagrams
  fenced (`ts`/`json`/`text`) with indentation restored, `•` bullets converted to Markdown
  lists, the §86 performance targets converted to a real table, and a parts table of
  contents added. Word-for-word equivalence with the pre-typeset text was machine-verified
  (7,257 words preserved exactly); no wording changed.
- `docs/SPECIFICATION.md` rewritten as the **corrected working rendering** of the
  specification (by owner decision): the duplicated `Part VII` became `Part VIII` with later
  parts shifted to IX–XIII (E-1); the twice-assigned section range 45–67 renumbered +53 to
  §98–120, giving one sequence 1–120 (E-2); §102 (Solver Packages) aligned with the monorepo
  tree — `physics-rapier` and `physics-box2d` only (E-3); extraction artifacts repaired
  (kerning splits, ligature, mid-word line-break hyphens); Markdown headings added.
- `docs/ERRATA.md` rewritten as a correction log with a PDF→Markdown numbering map; all
  three defects (E-1, E-2, E-3) marked resolved.
- `README.md` updated to present `SPECIFICATION.md` as the working reference and the PDF as
  the archived original.
- `docs/four-js-specification.pdf` moved unchanged to `docs/archive/`.

### Earlier
- Initial commit: directory scaffold (24 empty `@four/*` package directories, empty
  `examples/`, `benchmarks/`, `tests/`, `tools/`, `website/`), specification PDF and
  extracted Markdown, `ERRATA.md`, `README.md`, MIT `LICENSE`.
