# Changelog

All notable changes to this repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Once packages
are published, releases will follow [Semantic Versioning](https://semver.org/) per §90 of the
specification; until then, entries are grouped by date under **Unreleased**.

## [Unreleased]

### 2026-08-03

#### Added — dependency-graph tooling (CDG + QDG) wired into the build

Vendored the MathTS dependency-graph tools under `tools/` and integrated them as
real scripts plus a CI gate, rather than leaving them as loose files.

- `pnpm graph` — CDG, the full-parse generator. Writes `docs/Architecture/`:
  dependency graph (JSON/YAML/Markdown), file inventory, package export
  surfaces, duplicate symbols, and unused/dormant analysis.
- `pnpm graph:query` — QDG emits `dependency-reverse.json` and
  `node-safety.json` from CDG's JSON without re-parsing the codebase.
- `pnpm graph:check` — **new CI gate.** Asserts every package's `.` (main) entry
  is free of `node:` builtins.
- `pnpm graph:test` — QDG's own unit tests (6 cases).

`docs/Architecture/` is committed on purpose: QDG and any agent read that JSON
instead of re-running the heavy parse, so it has to be in the tree to be useful.

QDG also gained `--root=<path>` (written test-first in llm-wiki, mirrored here so
the two vendored copies stay byte-identical). It previously resolved
`docs/Architecture/` from its own location two levels up, which is correct for
four.js but breaks wherever the tools do not sit directly above the scanned root.
The flag mirrors the one CDG already had, and is consumed so it is never misread
as a command. QDG's suite goes 6 -> 10 tests.

First run is clean across all **24 workspace packages** — 318 files, 1198 exports,
**0 runtime circular dependencies** (2 type-only, which are safe), 0 orphaned
files, and no `node:` leaks. The census self-check passes: 318 files counted
equals an independent maximal repo walk.

The `graph:check` gate earns its place because a `node:` import reaching a
browser-facing entry is invisible to both `tsc` and the unit tests — those run
under Node, where `node:` resolves happily — and only fails once the package is
loaded in a browser. The gate starts green, so it catches the first regression
rather than documenting an existing mess.

**Upstream fix required to make CDG work here.** It discovered workspaces only
from `package.json`'s `workspaces` field. pnpm does not use that field, so
four.js looked like a single package and the scan reported "Found 0 TypeScript
files". `readWorkspacePatterns()` now also reads `pnpm-workspace.yaml`'s
`packages:` list, plus yarn's `{ packages: [...] }` object form, and drops
pnpm's negated globs (`!packages/legacy`) rather than treating them as literal
directory names. The same fix is mirrored in `llm-wiki/tools/`.

#### Removed — the last `turbo.exe` on disk

`turbo` left `pnpm-lock.yaml` when the build scripts were converted on
2026-08-02, but `node_modules/.pnpm/@turbo+windows-64@2.10.7/.../turbo.exe` was
still present locally. Nothing referenced it — not `package.json`, not
`pnpm-workspace.yaml`, not CI — so it was pure leftover from the build that
bugchecked the machine. Removed; the workspace still builds 24/24.


### 2026-08-02

#### Added (Phase 11 — Assets, Serialization, UI, Tooling, §113a; packets WP-11.1…WP-11.6 — THE FINAL PHASE)
- `@four/serialization`: SceneDocument v1 with canonical validation, a
  component-class-keyed serializer registry, §80 migrations — byte-identical
  round trips; 84 tests, 100% coverage.
- `@four/assets`: AssetManager (coalescing refcounted cache, disposal-aware image
  wrapper) + JSON/text/binary/image loaders; glTF staged with a dated note — 33
  tests, 100% coverage.
- `@four/ui`: retained-mode Panel/Label/Button over a WidgetSkin visuals seam,
  flex/stack/absolute layout, §72-driven state machines, focus management;
  accessibility mirror + keyboard staged — 90 tests, 100% coverage.
- `benchmarks/`: a shared harness + five suites (math, scene, physics, animation,
  particles) with committed measured-not-gated records, and `docs/AUDIT-120.md`
  (42/43 §120 bullets shipped-or-MVP; lighting the single dated staged absence).
- Integration (13 tests): the §79/§34 boundary proven — contact-free scene saves
  reload bit-identically for 200 further steps; in-contact saves diverge only via
  unserialized solver warm-start state. Reference RigidBody/Collider serializers.
- **Final exit GREEN. The implementation plan (§103–§113a) is complete**: 2,971 unit
  + 172 suite + 32 browser tests; 24/24 packages; coverage ≥95% everywhere; §86 at
  32.13/150 kB; docs 0 errors.

#### Added (Phase 10 — Replay, Snapshots, Diagnostics, §33–34/§113; packets WP-10.1…WP-10.5)
- `@four/diagnostics`: the §34 replay format (canonical serialization, strict base64,
  adapter-validity refusal), `ReplayRecorder` + `ReplayPlayer` (host-supplied stepFn,
  periodic-snapshot seeking, slow motion, verify hooks), and `DebugDrawBuffer` with
  duck-typed providers (contacts/normals/impulses, velocities, origins, solver
  statistics; COM/joint-anchor/force-vector display staged with dated seam-gap notes)
  — 210 tests, 100% coverage.
- End-to-end §113 proof on real Rapier: recording is non-perturbing; replay
  bit-identical (240/240 checksums); seek costs ≤ snapshot interval; contact geometry
  appears at exactly the recorded steps under frame stepping; slow-motion arithmetic
  exact; the phase10 golden pins the recording bytes themselves cross-process.
- Phase 10 exit GREEN, zero defects: 2,766 unit + 159 suite + 32 browser tests.

#### Added (Phase 9 — Particles, §27/§36/§112; packets WP-9.1…WP-9.5)
- `@four/particles`: SoA particle core (pool/emitter with seeded 4-draw spawn
  contract, plane collision, over-lifetime ramps), the §27 force-field set
  (gravity/drag/wind/radial/vortex/bounded hash-noise turbulence/volumes), and a
  `ParticleSystem` at priority 500 — 174 tests, 100% coverage.
- Batched particle rendering: a new `"particles"` RenderItem drawn as instanced quads
  (6 GL calls per frame at any count) with straight-alpha blending; duck-typed
  cross-package contracts where the dependency matrix forbids edges (plan-noted).
- `benchmarks/particles-100k.mjs` + committed results: 100k particles + 3 fields at
  16.54 ms/step mean on CI hardware, with per-field cost attribution (integrator
  1.35 ms; ~5.3 ms per polymorphic field) — recorded, not gated.
- `examples/particles-demo` (fifth site, non-wasm, 18.9 kB gzip) + browser spec;
  phase9 determinism golden (cross-process). Suites 138, browser 32.
- Phase 9 exit GREEN per the plan's honest §112 reading; four doc-hygiene defects
  fixed in-line (dated staging notes, plan-level governance note).

#### Added (Phase 8 — Advanced Motion, §111; packets WP-8.1…WP-8.5)
- `@four/motion`: `PIDController` (§111 sketch verbatim, anti-windup, derivative on
  measurement), `SpringDamper` (exact matrix-exponential stepping), the Reynolds
  steering set + flocking with a seeded xorshift128 RNG (BigInt-oracle-pinned),
  ballistic/intercept trajectory prediction, and two-bone analytic IK — six new
  modules, each at 100% coverage with independent analytic test oracles; declined
  §111 components staged with dated notes.
- Integration (7 suite tests): PID speed loop settling a real Rapier motorized hinge
  to exact setpoint in both dimensions; spring-damped camera follow matching its
  exact discrete transfer function to 3e-15; steering agents beside physics with
  checksum-stream-identity proof; ballistic interception vs the substepped solver;
  IK driving the §19 blend pipeline.
- Phase 8 exit GREEN (plan-defined criterion, owner-to-confirm): 2,359 unit + 131
  suite + 27 browser tests; coverage ≥95% everywhere.

#### Added (Phase 7 — Physics-Animation Blending, §19/§42/§110; packets WP-7.1…WP-7.8)
- `@four/scene`: `PoseTarget` component (animation-drivable target poses with
  finite-difference history); the `"blended"` transform authority unlocked (§42's
  reserved value, guarded since Phase 2).
- `@four/physics`: §19 blend weights on `RigidBody`; in-place body retype
  (`setBodyControlMode`) with velocity inheritance; the §19 pipeline inside
  `PhysicsWorld.step` (unweighted kinematic feed → solve → weighted lerp/slerp
  publish under `"blended"`, bit-identical at the weight extremes) plus
  `createPoseTargetCaptureSystem` at priority 299; `SolverBodyAccess.setBodyType`
  implemented on both Rapier adapters (verified in-place on live wasm).
- `@four/animation`: root-motion MVP (loop-aware translation deltas from a designated
  clip track; rotational staged; seek never accumulates).
- Integration: §19's four examples end-to-end on Rapier (17 tests) — the ragdoll
  cycle's kinematic→dynamic switch uses 6 ppm of its derived continuity bound.
- `examples/blending` (fourth example site): a hanging chain cycling
  ANIMATED→RAGDOLL→RECOVERING on click (675.9 kB gzip, wasm, outside §86).
- Gates: phase7 determinism golden (600-step scripted mode cycle, cross-process;
  switch steps pinned BELOW the wave's own per-step motion) + blending browser spec
  (suites 124, browser 27, four webServers).
- Phase 7 exit GREEN, zero defects: 2,176 unit tests, suites ×2, browser ×2,
  coverage ≥95% everywhere (physics/animation at 100%), §86 gate at 30.92/150 kB.

#### Added (Phase 6 — Joints and Constraints, §28/§109; packets WP-6.1…WP-6.7)
- `@four/physics`: §28 joint classes (Fixed/Hinge/Slider/Rope/Spring/Spherical +
  Revolute/Prismatic/Ball aliases) over body-local descriptor unions; world-space
  anchors converted once at `world.addJoint`; live limits/motors via command queues;
  engine-level break monitoring with `jointbreak` events; `SolverJointAccess` seam;
  distance/gear staged with P6-1-citing errors — 109 new tests, still 100% coverage.
- `@four/physics-rapier`: joint mapping in both dimensions (2D five types, 3D six)
  against measured 0.19.3 behavior — `reportsJointReactions: false` (no reaction API
  exists; breakable joints refused rather than faked), motor efforts as documented
  ForceBased gains, disabled motors as a measured-inert gain (bit-identical to
  never-motored), spherical without non-cone "limits"; snapshot envelopes v2 with
  joint tables — 96 new wasm-backed tests.
- `tests/integration/physics-joints.test.ts`: 24 end-to-end tests incl. the §109
  stability core (3600 steps, hinge drift 1.3e-5 m, zero rope slack/limit overshoot)
  and breakage through the full Application pipeline on a scripted adapter.
- `examples/mechanism`: the §109 slider-crank — motorized shaft, hinges, limited
  slider with limit-switch lamps, spring buffer, click-to-coast motor and speed
  plates (674 kB gzip, wasm, outside §86).
- Gates: phase6 determinism golden (two jointed worlds, scripted §28 reconfiguration
  incl. joint removal, cross-process) + mechanism browser spec (suites 95, browser 23,
  three Playwright webServers).
- Phase 6 exit: §109 TRUE; one CI-wiring defect found and fixed (WP-6.6-fix1 — CI now
  builds all three example sites before the browser gate; the playground half predates
  Phase 6) plus stable-API doc caveats for the motor-gain deviation.

### 2026-08-01 (later)

#### Added (Phase 5 — Physics API + Rapier Adapter, §108; packets WP-5.1…WP-5.9)
- `@four/physics`: complete §20–§34 public API — types/shapes/descriptors/materials/
  events/queries + the §37 `PhysicsSolverAdapter` contract with branded handles;
  `RigidBody` + `Collider` components (§26 command buffers, §29 typed events,
  density-derived mass per §23 restored by WP-5.2-fix1's authoredness rule);
  `PhysicsWorld` + `PhysicsSystem` (priority 600; sync → step → publish under
  "physics" authority → dispatch-after-step; §30 queries with §21 2D naming; §33
  FNV-1a checksums; §34 snapshots with adapter validity metadata) and the
  `SolverBodyAccess` per-handle seam — 281 tests, 100% coverage.
- `@four/physics-rapier`: Rapier 2D + 3D adapters on pinned
  `@dimforge/rapier{2d,3d}-compat@0.19.3` wasm — P5-6 shape tier, all four §22 body
  types, sensors, adapter-derived collisionstay, monotonic id registries, snapshot
  envelopes, honest capabilities (joints staged per P5-4) — 185 wasm-backed tests.
- `tests/integration/physics-rapier.test.ts`: first §92 integration suite — 26 tests
  proving gravity/collisions/impulses/sensors/queries/authority/interpolation/
  checksum/snapshot-replay in both dimensions plus the §108 mixed-world shape.
- `examples/physics-playground`: the §108 demonstration — 2D and 3D worlds side by
  side, click impulses, sensor zones; 1.51 MB gzip (wasm; outside the §86 budget).
- Gates (WP-5.8): phase5 determinism golden (600 steps, two worlds, §33 checksums,
  cross-process, same-runtime tier stated) and a 4-test playground browser spec
  (browser total 19; two Playwright webServers).
- Phase 5 exit GREEN, zero defects: 1,827 unit tests, suites ×2 (60), browser ×2 (19),
  coverage gate green repo-wide, first-2d-scene unchanged at 30.19 kB gzip vs §86.

#### Added (Phase 4 — Animation Core, §107; packets WP-4.0…WP-4.9)
- `@four/animation`: §15 easing (12 families × in/out/in-out, 34-key registry, pinned
  constants incl. a normalized damped-spring closed form); value adapters + property
  bindings (§16 resolved-once paths, in-place writes, zero-allocation hot paths);
  `Tween` builder (§15 API, last-started-wins conflict registry shared with the mixer,
  §42 authority gating with all-or-nothing transform writes); `Timeline` (§16 complete:
  nesting, labels, markers with forward-crossing-once + seek suppression + replayOnSeek,
  loop/reverse/scrub/speed); `AnimationTrack`/`AnimationClip` (§17 shape,
  step/linear/cubic/Hermite + quaternion slerp, binary-search sampling);
  `AnimationMixer` (clip playback with §16 event semantics); fixed-step
  `AnimationSystem` at priority 300 — animation poses before kinematics (§19 order) —
  324 tests, 100% coverage on all four metrics.
- Tooling (WP-4.0): `typecheck:examples` (examples now typechecked in CI against built
  d.ts) and a tooling-enforced repo-wide ≥95% coverage gate (`pnpm run coverage`,
  package-level vitest thresholds, wired into CI); umbrella barrel-wiring test.
- Example: beacon + vane animated cluster demonstrating every §107 value kind under a
  looping timeline with a palette-stepping marker; 30.19 kB gzip vs the 150 kB §86 gate.
- Gates (WP-4.8): phase4 determinism golden (21 quantities × 1000 fixed steps,
  in-process + fresh-child-process digests, marker-fire steps pinned), marker
  seek-suppression determinism test, and a 4-test browser animation spec (browser total
  15) incl. a standing cluster-isolation invariant.
- Phase 4 exit GREEN (§107 criterion TRUE): 1,363 unit tests, suites ×2 with goldens
  byte-identical, browser ×2, coverage gate green, docs/spec checks clean.

#### Added (Phase 3a — Interaction, Sprites, Text MVP, §106a; packets WP-3a.1…WP-3a.7)
- `@four/input`: §71 picking (ray from +Y-up NDC, AABB + oriented-box tests), §72-subset
  pointer routing with scene-graph propagation (`capture:`-prefixed capture-phase keys on
  the four propagating types), `NodeEventMap` augmentation, DragManager (near-plane
  unprojected world deltas handed to app callbacks; input never writes transforms) —
  80 tests, 100% coverage.
- `@four/render`/`@four/materials`/`@four/render-webgl`: §55/§77 MVP textures + sprite
  quads (`kind: "sprite"` render items, SpriteMaterial/SpriteTexture contract, GL texture
  uploads). §55 frame regions deferred (whole-texture mapping only; backlogged).
- `@four/text`: §56 bitmap MVP tier — embedded 6×12 monospace font (95 printable ASCII,
  base-32 row encoding), glyph atlas, text layout (Y-up baselines); SDF staged — 48 tests,
  100% coverage.
- Example upgrade: click-to-recolour palettes, pointer dragging with the §42
  untrack + authority handover pair, per-glyph text label; 21.46 kB gzip vs the 150 kB
  §86 gate.
- Browser interaction gate (5 new Playwright tests, 11 total): real Chromium mouse input,
  framebuffer-pixel assertions for click/miss/drag/tumble-resume/label ink/no-errors.
- Phase 3a exit GREEN (§106a criterion TRUE): 1,015 unit tests, browser suite ×2, goldens
  untouched, coverage ≥95% every touched package; demo-ready static build confirmed.

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
