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

- **2026-08-04 (later) — ZERO-FINDINGS SWEEP (owner-directed: "resolve all issues the
  tools report; defer nothing"): all 5 baselined duplicates consolidated, both type-only
  cycles broken, all 21 unused exports resolved; every docs/Architecture report is now 0
  and duplicate-baseline.json is empty.** Standing homes: `SeededRandom` →
  `@four/core/src/random.ts` (WP-8.2 original verbatim; motion/particles re-export;
  streams bit-identical, motion's known-answer suite moved to core, particles'
  BigInt-oracle suite still pins stream identity); `JsonValue`+`cloneJsonValue` →
  `core/src/json.ts` carrying serialization's `__proto__` refusal — this is the "owner
  decision" the serialization module note was waiting on, and it CHANGES diagnostics
  behavior: a payload with a `__proto__` own key is now refused with TypeError instead of
  silently re-parenting the copy; `DEFAULT_GRAVITY_Y` → `core/src/conventions.ts`;
  `ColorRGBA` → `math/src/color.ts`. Cycle breaks: scene's `warnAuthorityConflict` takes
  structural `AuthorityNode` (exported from the barrel; every Node satisfies it);
  physics' `RigidBodyCollisionEvent` lives in `collider.ts` and the three §29 collision
  keys merge into `RigidBodyEventMap` via `declare module "./rigid-body.js"` declaration
  merging (the @four/input→NodeEventMap pattern) — public surface unchanged, but the
  type's DECLARING file moved (deep-importers of `../src/rigid-body.js` must use
  `../src/collider.js`). physics-rapier's 21 transcribed-subset interfaces are no longer
  exported (in-file type contracts only). Gotchas: (1) the interface-merging
  augmentation must NOT carry a doc comment — TypeDoc emits "multiple declarations with
  a comment" once per package that re-exports the map (12 warnings); (2) typedoc
  baseline is now 123 warnings (was 125). Verified: 24/24 build, 2,985 unit, coverage
  ≥95% everywhere (core 99.01 with new json.test.ts at 100%), suites 174, browser 32,
  size 32.13 kB unchanged, all four graph gates + check-spec green.
- **2026-08-04 — Dependency-graph tooling (CDG/QDG) fully integrated; duplicate-symbol
  gate wired.** Context (2026-08-03, recorded in CHANGELOG but not here until now): the
  MathTS dependency-graph tools were vendored under `tools/` — `pnpm graph` (CDG full
  parse → committed `docs/Architecture/`), `pnpm graph:query`/`graph:check`/`graph:test`
  (QDG), with `graph:check` a CI gate (no `node:` builtin may reach a browser-facing `.`
  entry; 24/24 pass); turbo was replaced by `pnpm -r --workspace-concurrency=4` the same
  day; the vendored tool **code** is eslint-ignored and kept byte-identical with
  `llm-wiki/tools/`. Today's decision closes the last gap: `pnpm graph:duplicates`
  (CDG's `check-duplicates.mjs --no-regen`, reading the report `pnpm graph` regenerates)
  joins the CI architecture-invariants step and fails on any TRUE_DUPLICATE symbol name
  beyond `docs/Architecture/duplicate-baseline.json`. Split applied: **allowlist** (=
  legitimately independent forever, per-repo *data* exempt from the byte-identity rule) got
  per-package `PACKAGE_NAME` and `PARTICLE_INSTANCE_FLOATS` (deliberate duck-typed
  contract, matrix forbids the particles↔render edge — Phase 9 entry below); **baseline**
  (= accepted shrinking backlog, re-seed via `gen-duplicate-baseline.mjs` after
  consolidating) holds `cloneJsonValue`, `JsonValue`, `DEFAULT_GRAVITY_Y`, `SeededRandom`
  (the dated hoist-to-core item), `ColorRGBA`. Gotcha: `duplicate-allowlist.json` is
  hand-formatted — do not round-trip it through `JSON.stringify` (rewraps 500+ lines);
  append entries textually.
- **2026-08-02 — PHASE 11 CLOSED — THE IMPLEMENTATION PLAN IS COMPLETE (final exit
  GREEN; §113a exit TRUE: saved, reloaded, benchmarked; §120 complete at 42/43
  shipped-or-MVP with lighting the single dated staged absence — a traceable
  scheduling gap, never assigned to any phase).** Five packets. Key surfaces:
  @four/serialization (SceneDocument v1, canonical validation, ComponentSerializer
  registry keyed by component CLASS, §80 migrations; byte-identical round trips;
  known boundaries: unregistered components silently unsaved, restored ids can
  collide with the live counter); @four/assets (AssetManager with coalescing
  refcounted cache, ImageAsset disposal wrapper; glTF staged — needs §55 textures +
  non-unlit materials); @four/ui (WidgetSkin seam: layout/state owned, visuals
  app-supplied per the matrix; flex/stack/absolute layout; a11y mirror + keyboard
  staged); benchmarks harness + five suites with committed records (findings:
  contacts+events = ~88% of a physics step; clean scene pass only ~3× cheaper than
  full recompute; recursion-limited scene depth ~8k); docs/AUDIT-120.md. THE §79/§34
  BOUNDARY (WP-11.5): a contact-free save round-trips BIT-IDENTICALLY for 200
  further steps; an in-contact save diverges only through solver warm-start state —
  §34 snapshots carry that, §79 documents don't. Reference RigidBody/Collider
  serializers live in tests/integration/helpers/roundtrip-scenarios.ts. Whole-plan
  audit: all 13 phase sections (§103–§113a) decomposed, dispatched, closed, dated;
  8 goldens 1:1 with determinism specs; §94 release workflow correctly owner-gated.
  Final numbers: **2,971 unit / 172 suite / 32 browser tests; 24/24 build; coverage
  ≥95% everywhere (Phase 11 packages 100%); §86 at 32.13/150 kB; docs 0 errors.**
  Remaining backlog (priority order, verifier G-list): package README sweep (all 24
  say "scaffold only"); UI browser proof (WP-11.5 substituted a node-level §72
  assertion — the one packet-intent shortfall); lighting packet (owner tier
  decision); de-flake blending.spec.ts RECOVER (1 hard fail in 3 full runs,
  retries: 0 — Phase 7 wall-clock thresholds under SwiftShader); §93 quick-start +
  prose guides (the guide half is thin — examples + doc-comments today); gotcha:
  `pnpm size` is a pnpm builtin like `pnpm docs` — always `pnpm run size`.
- **2026-08-02 — PHASE 10 CLOSED (exit GREEN, zero defects; §113 exit sentence TRUE:
  record → bit-identical replay (240/240 checksums; stepChecksumDigest ===
  replayChecksumDigest pinned in golden/phase10.json) → snapshot-seek (cost ≤
  interval−1) → frame-by-frame inspection reading contact geometry at the exact
  recorded steps → exact slow motion).** Five packets. Standing decisions: §34
  envelope in @four/diagnostics (formatVersion 1 exact-match; canonical re-build
  validation → encode(decode(t))===t, prototype-pollution-safe; strict canonical
  base64, hand-rolled, RFC-vector-pinned); ReplayTarget duck-types PhysicsWorld
  (applyInput OPTIONAL — apps wrap world+input-applier, PhysicsReplayTarget in
  tests/integration/helpers/replay-scenarios.ts is the reference pattern; one code
  path applies inputs live AND on replay); ReplayPlayer owns bookkeeping only, host
  supplies stepFn (nothing type-checks the pairing — runtime signal via
  verifyChecksum, deliberately tested); recording is non-perturbing (Rapier
  takeSnapshot is a pure read — tested); DebugDrawBuffer 7-floats/vertex line list +
  duck-typed providers; STAGED with dated notes + DEBUG_DRAW_STAGED export: COM
  display (no seam accessor; Rapier localCom/worldCom exist — unblock verified),
  joint-anchor/constraint viz (seam has no anchors), force vectors (channel is
  write-only), per-segment-colored draw (needs vertex colors — "lines" GeometryDrawMode
  → GL.LINES wiring exists but is undemonstrated; §118 flagship pickup). Known
  boundary: §34 world-CONFIGURATION mismatch is not refused (name/version only —
  pre-existing Phase 5 scope). Exit: 2,766 unit + 159 suite + 32 browser; diagnostics
  210 tests at 100%. Verifier notes: all 24 package READMEs still say "scaffold only"
  (sweep chore); 4 of 6 debug providers exercised via fakes only (one-line rig
  extension would close it).
- **2026-08-02 — PHASE 9 CLOSED (exit GREEN; the plan's honest §112 reading TRUE: 100k
  measured-and-recorded, one-draw-call batching asserted in fake-GL tests, browser demo
  at SwiftShader scale).** Five packets + doc fixes. Key facts: SoA Float32Array pools
  with swap-remove (layout = deterministic function of history — the accepted P9-4
  reading; literal insertion order NOT preserved); fixed 4-draws-per-spawn RNG
  contract (dropped spawns burn none — capacity is part of the stream); SeededRandom
  duplicated from motion (dated, hoist-to-core backlog); §27 fields as factories
  (turbulence = bounded hash-value-noise curl, honestly NOT divergence-free; radial =
  inverse-square, positive-outward); "particles" RenderItem: instanced quads, stride-8
  interleaved, 6 GL calls/frame at any count, straight-alpha blending (first blended
  non-sprite pass); ParticleDrawable + ParticleSystem's SimulationSystem are DUCK-TYPED
  cross-package contracts (matrix forbids the edges; drift caught by tests — plan §6h
  dated note); PRIORITY_PARTICLES = 500. **Benchmark (recorded, NOT a 60fps claim):**
  100k + 3 fields = 16.54 ms/step mean (99.2% of the 60 Hz budget; p95 over), on a
  4-core CI Xeon; integrator alone 1.35 ms — each polymorphic §27 sample() call site
  costs ~5.3 ms/100k; field batching is a scoped future optimization. Exit: 2,585 unit
  + 138 suite + 32 browser tests (five example sites, five webServers); particles/
  render 100%, render-webgl 99.83%; §86 gate 32.13 kB (grew +1.21 kB from the render
  union — verified genuine); particles-demo 18.9 kB gzip non-wasm.
- **2026-08-02 — PHASE 8 CLOSED (exit GREEN; plan-defined criterion TRUE — §111 sets no
  exit, the plan's "PID + steering pass analytic tests, demo composes with the stack"
  stands owner-to-confirm).** Five packets + one doc fix, all in `@four/motion`.
  Shipped: PIDController (§111 sketch verbatim; conditional-integration anti-windup,
  bit-identical to naive while unsaturated; derivative-on-measurement default);
  SpringDamper (exact ZOH matrix-exponential step, memoised per dt, unconditionally
  stable; matched an independent scaling-and-squaring exponential to 1e-12); steering
  (Reynolds set + flocking, acceleration out-params, brute-force neighbors —
  spatial hash staged; the implicit 1 s⁻¹ gain documented); SeededRandom (xorshift128,
  splitmix32 seeding, BigInt oracle known answers); prediction (ballistic + stable-
  quadratic intercept); two-bone analytic IK (positions not angles — no bone-axis
  convention pinned yet). Staged with dated notes: path-planning adapters (RFC),
  CCD/FABRIK, spatial hash, spherical wander, robotic joint commands (MAY declined;
  the PID→setMotor hinge scenario demonstrates the mapping). Integration facts: PID
  actuation = targetVelocity cascade (maxTorque held; on Rapier it is the loop GAIN if
  modulated); a velocity written after world.addBody reaches no solver (author it on
  the descriptor); steering probes (12k overlapSphere calls) provably perturb no
  solver state (checksum-stream identity). Exit: 2,359 unit + 131 suite + 27 browser;
  motion 99.78% (all six new modules 100%); typedoc warnings now 74 (chore count
  stale).
- **2026-08-02 — PHASE 7 CLOSED (exit GREEN, zero defects; §110 criterion TRUE —
  uniquely, both control switches cost LESS than the animation's own per-step motion:
  activation 9.33 mm and retype 2.69 mm vs the wave's 14.63 mm, pinned in
  golden/phase7.json; the chain re-locks onto its animation bit-identically two wave
  periods after a ragdoll cycle).** Eight packets + one doc fix. Standing decisions:
  `PoseTarget` lives in `@four/scene` (position+rotation MVP, no scale — backlog;
  previous* history + capturePrevious); §19 weights on RigidBody (independent,
  normalized at use, defaults 1/0, both-zero warns once and falls back physical);
  transitions retype IN PLACE via SolverBodyAccess.setBodyType (Rapier verified both
  dims — handle/id/colliders/mass survive); velocity inheritance = finite-differenced
  PoseTarget history (world-frame quaternion delta, atan2 form); **no separate
  BlendSystem** — feed and publish live inside PhysicsWorld.step, plus
  createPoseTargetCaptureSystem at 299 (MUST be registered by applications using
  blending/inheritance — an uncaptured animated target inherits ~30× inflated
  velocity, WP-7.3-fix1); kinematic feed is UNWEIGHTED (weights apply once, at
  publish); blending covers every §22 body type; missing-trio throws from the step;
  weight extremes are bit-identical (Object.is-tested) to pure physics/pure target;
  root motion = translation-only mixer option (rotational staged 2026-08-02, seek
  never accumulates); "blended" authority unlocked (WP-2.3 guard removed). Rapier
  note for capability tables: a driven kinematic-position body already carries
  solver-derived velocity, so inheritVelocityFrom is nearly a no-op there (2.4e-7 m
  / 0.5 s) — it matters on solvers that do not derive it. Exit: 2,176 unit + 124
  suite + 27 browser tests (four webServers); scene 99.64, physics/animation 100%
  coverage; first-2d-scene 30.72 kB gzip vs §86; blending example 675.9 kB (wasm,
  ungated).
- **2026-08-02 — PHASE 6 CLOSED (exit verdict: §109 criterion TRUE; one CI-wiring
  defect WP-6.6-fix1 landed by the orchestrator — build all three example sites before
  test:browser — after which the verifier's stated condition for GREEN holds; zero
  engine defects).** Seven packets + two fixes. Standing decisions: joints register on
  the WORLD (`world.addJoint`), not as §6a components (P6-3); anchors/axes authored in
  world space, converted once at addJoint from live solver poses (pose before
  jointing); limits + motors are live (command queues via `SolverJointAccess`
  setJointLimits/setJointMotor); anchors/axis/rope/spring/cone/collisionEnabled frozen
  post-registration (dated staging). `SolverJointAccess` joins SolverBodyAccess as
  required engine surface beyond §37. **Rapier 0.19.3 facts (all measured):** no joint
  reaction getters exist (typings + prototypes + wasm exports) → reportsJointReactions
  false on both adapters, breakable joints refused, §28 breakage proven via scripted
  adapters through the full Application pipeline; motor maxTorque/maxForce is a
  ForceBased GAIN, not §28's hard cap (deviation recorded in the stable API docs with
  cross-references; Box2D could honor a real cap — capability-table item); disabled
  motor = INERT_MOTOR_GAIN 1e-12, measured bit-identical to never-motored over 3600
  steps in BOTH dims (2D initially threw; unified by WP-6.2-fix1 after measurement);
  spherical ships 3D-only WITHOUT limits (per-axis limits do not form a cone — ±0.3
  rad limit lets a diagonal swing reach 1.1247 rad; limited descriptors refused
  quoting the numbers); distance + gear staged loudly (P6-1); FixedJoint with no
  anchor welds origins (documented trap); §28 solver-iterations feature not exposed
  anywhere (recorded gap, TODO). Stability evidence: 3600-step mechanism, hinge
  anchor drift 1.3e-5 m, rope slack 0, slider off-axis ≤1.6e-11, pendulum period
  within 6e-5 of the amplitude-corrected closed form. Exit: 1,998 unit + 95 suite +
  23 browser tests; physics 390 @ 100%, physics-rapier 248 @ 98.14/96.44/100/98.14;
  mechanism example 674 kB gzip (wasm, ungated); first-2d-scene 30.19 kB vs §86.
- **2026-08-01 — PHASE 5 CLOSED (exit GREEN, zero defects; §108 criterion TRUE on three
  axes: mixed-world integration test, playground demo + browser pixels, cross-process
  determinism golden).** Nine packets + two fix packets. Key decisions/facts:
  **SolverBodyAccess** (per-handle transform/velocity/force/kinematic accessors) is an
  engine seam beyond §37's sketch, defined in `@four/physics` and mirrored
  member-for-member by the adapters — future adapters (Box2D) must implement it and the
  §90/§102 compatibility tables should name it. Rapier pinned `-compat@0.19.3` (base64
  wasm, async init; NodeNext cannot resolve its .d.ts → a verified transcribed subset
  lives in `physics-rapier/src/init.ts`, cleanup backlogged). Mass model: density-derived
  by default (delegated to Rapier; WP-5.2-fix1's authoredness union rule — sticky flag OR
  non-origin — keeps an unauthored origin centerOfMass out of descriptors); three
  MassModes; inertia tensors diagonal-only (off-diagonal throws). Adapters own monotonic
  never-reused ids (Rapier handles are unordered doubles) → §33 checksum order;
  snapshot envelopes F4R2/F4R3 carry the id registry. collisionstay is adapter-derived
  from a touching-pair map (Rapier has only start/stop); restitution combine forced Max
  (Rapier default Average contradicts Appendix A); §32 sleep thresholds have NO Rapier
  binding (only `enabled` maps — honest gap); §31 "speculative" = softCcdPrediction(1.0),
  distance param backlogged. §33 FNV-1a duplicated in world.ts (matrix has no
  physics→diagnostics edge; pinned against a reference impl). Verified: 2D and 3D solvers
  bit-identical on mirrored scenarios (identical scenes hash identically across
  dimensions — checksums include z/quaternion, so divergence must be authored into
  tests). §21 z-plane rule shapes node structure (2D bodies must sit at z=0; visuals go
  on child nodes). Rapier 0.19.3 surprises recorded in the WP-5.4/5.5 reports (world
  retains gravity object; colliders query-invisible until next step; dt/4 substepping;
  shapeCast ≤1 hit in 2D). Exit: 1,827 unit + 60 suite (first §92 integration suite) +
  19 browser tests; physics 100/100/100/100, physics-rapier 97.99/96.94/100/97.99;
  first-2d-scene still 30.19 kB gzip vs §86; playground 1.51 MB gzip (wasm, ungated per
  MEMORY 2026-07-29).
- **2026-08-01 — PHASE 4 CLOSED (exit GREEN, zero defects; §107 criterion TRUE per value
  kind with unit + golden + browser-pixel evidence).** Ten packets. API surface:
  34-key easing registry (§15 families, pinned constants incl. damped-spring closed form);
  `ValueAdapter` with `mutatesInPlace` split (primitives return, references mutate `out`);
  `PropertyBinding` (paths resolved once, in-place writes preserve identity + change
  hooks); `Tween` builder (repeat = extra cycles) with a writer-agnostic last-started-wins
  claim registry shared by tween AND mixer (internal exports, not in the barrel);
  `Timeline` (elapsed-space markers, `(from, to]` crossing shared with clip events,
  seek suppresses + per-marker/per-play replayOnSeek, loop = total iterations —
  documented divergence from tween.repeat); `AnimationTrack`/`AnimationClip` (§17 shape;
  cubic = motion's Catmull-Rom convention; quaternion linear = slerp, cubic/hermite
  rejected; morph/skeletal staged per P4-3); `AnimationMixer` (`prepare()`+`play()`,
  satisfies TimelineChild, seek in elapsed time); `AnimationSystem` (priority 300 <
  MotionSystem 400, fixed scaled delta = `fixedDeltaTime` (timeScale already applied by
  the accumulator), auto-untracks finished/stopped). **Renderer findings (WP-4.7):**
  unlit draws run with GL_BLEND off (alpha animation invisible — §60a/blending backlog);
  material color is read per draw (no version cache), so in-place tuple animation works.
  **Frozen behavior:** the fixed-step accumulator's ULP drift fires boundary-sitting
  markers one step late (step 199 not 198) — pinned in golden/phase4.json. WP-4.0 made
  the ≥95% coverage gate tooling-enforced (package-level thresholds; per-file granularity
  noted as a future hardening) + typecheck:examples in CI; barrel-wiring test took the
  umbrella to truthful 100%. Exit: 1,363 unit + 26 suite + 15 browser tests, animation
  100/100/100/100, example 30.19 kB gzip (21% of §86). Verifier notes adopted: §15's
  `node.position` snippet is not copy-pasteable (scene has `node.transform.position` —
  existing ergonomics backlog item); §17's slerp is folded into the quaternion adapter
  rather than named as a mode; 8 new cosmetic typedoc link warnings (cleanup chore).
- **2026-08-01 — PHASE 3a CLOSED (exit GREEN; §106a criterion TRUE with browser input +
  pixel evidence).** Seven packets: §71 picking (ray/AABB/oriented-box, +Y-up NDC), §72
  subset pointer input (capture:-prefixed capture keys on the four propagating types only;
  `NodeEventMap` augmentation via `declare module "@four/scene"`), DragManager (world-delta
  handoff to app callbacks — @four/input never writes transforms), §55/§77 MVP textures +
  sprites, §56 bitmap-tier text (6×12 font, 95 glyphs, base-32 rows; SDF staged), example
  upgrade (click palettes + drag with the §42 untrack+authority handover pair), 5-test
  browser interaction gate. Exit: 1,015 unit tests, 11 browser tests ×2, goldens untouched,
  example 21.46 kB gzip; coverage 100% on input/text/render/materials, render-webgl 99.42%
  (two defensive branches). **Advisory WP-3a.3-fix1:** §55 frame regions unimplemented —
  sprites map whole textures, so labels cost one texture per glyph cell (already in TODO;
  owner may record a spec-amendment deferral). **Exit-verifier notes adopted as chores:**
  examples are typechecked by nothing in CI (verifier's manual `tsc --noEmit` clean today;
  `typecheck:examples` chore queued for Phase 4), coverage ≥95% is review-enforced (no
  vitest thresholds configured — tooling chore queued), example dist uses base "/" (fine for
  root hosting + preview; subpath deploys need `--base`, a deployment-time flag).
  "Ship the public demo" = demo-ready static artifact confirmed (index.html + hashed asset,
  no dev-server references); actual deployment is the owner's step per POSITIONING.
- **2026-08-01 — PHASE 3 CLOSED (exit GREEN, zero defects; §106 criterion met with
  browser-pixel evidence).** Nine packets: cameras/viewport (§47-48, D8 depth ranges),
  geometry/materials/renderable lite + render lists (WeakMap-keyed pools, §43 interpolated
  builder), §61 Renderer interface + NullRenderer, WebGL 2 backend (33-method structural GL
  seam, fake-GL units, 99.66%), Application renderer integration (injected Renderer
  INSTANCE, RenderInterpolation plumbing), real example (14.88 kB gzip vs 150 kB §86),
  Playwright browser gate (ANGLE/SwiftShader pinned; caught a real rAF-seed defect =
  WP-3.7-fix1), exit with centroid-tracked smoothness + a virtual-clock test proving
  alpha-0.5 interpolated draws. **Deferral recorded (spec §45 departure):**
  `ApplicationOptions.renderer` takes a Renderer instance, not §45's string union —
  string/"auto" selection deferred to a §62 registry packet so `four` never imports
  backends at runtime (payload evidence: 14.88 kB). Informational: §106 "textures" deferred
  to §106a/§55 tier; tests/integration+visual still empty (§92 backlog);
  four-package barrel coverage artifact persists (cosmetic). Repo: 813 unit tests +
  17 suite + 6 browser.
- **2026-08-01 — PHASE 2 CLOSED (exit GREEN; §105 criterion met; coverage ≥95% everywhere).**
  Seven packets: five §38 integrators; MotionComponent+MotionSystem (pinned semi-implicit
  formula, explicit track/untrack, parent-frame angular premultiply); eight §13 trajectories
  (CR antisymmetric-tangent bug caught by symmetry tests); §42 TransformAuthority
  (NOT_IMPLEMENTED added to FourErrorCode; refusals skip whole advance);
  KinematicController (channel state machines, float-safe completion tolerance, refused
  commands freeze); scene-side PoseBuffer (single §37 store, lerp/slerp, no write-back API,
  turbo override orders scene#test after motion#build). Exit verified against independently
  derived closed forms (Barry-Goldman, RK4 ODE, algebraic recurrence; worst dev 3.1e-13),
  golden digests cross-process. Motion 200 tests / 99.63%, scene 114 / 99.55%. Fixes: CI
  Node 20→22 (type-strip children); four/application subpath (renderer-free headless
  composition). Repo: 545 tests. Next: Phase 3 rolling-wave decomposition (renderer
  foundation §106 + §61-62, cameras §47 in @four/scene per spec rev 1.3).
- **2026-08-01 — PHASE 1 CLOSED (exit GREEN; §104 criterion met; coverage ≥95% everywhere).**
  All 14 packets landed (Opus workers, per-packet commits): math (Vector2/3/4, Quaternion,
  Matrix3/4 — 154 tests), core (EventEmitter, component model, FourError+Disposable — 57),
  scene (Transform with D3 dirty channel, Node/Group/Scene, world-transform resolver — 84),
  motion (Clock/TimeState, §10 scheduler, §39 system registry — 56), diagnostics (D6
  checksum with independently cross-checked golden vectors — 28), four (Application root —
  25), plus the WP-1.14 exit: 100-node/1000-frame determinism scenario with committed
  golden digests, proven in-process AND in a fresh node process, with sensitivity evidence.
  Coverage: math 98.9 / core 98.5 / scene 99.3 / motion 99.3 / diagnostics 100 /
  application.ts 100 (% statements). **API decisions recorded from [S] packets:** registry
  re-entrancy throws (protects §34 replay) while EventEmitter queues-and-defers; Node's
  parent setter delegates to add/remove; world resolver's three-part staleness incl.
  parent-identity (catches version-less reparenting); Application wraps
  attachToScheduler's installed callback (registry first, then event), resolves world
  transforms before update/render listeners; `INVALID_APPLICATION_STATE` added to
  FourErrorCode (WP-1.12-fix1); @types/node@22 + tests/tsconfig.json (WP-1.14-fix1);
  @vitest/coverage-v8 pin added — coverage joins phase-exit gates. Node 22 runs .ts
  helpers natively (type-strip) — the determinism child process imports the same .ts
  scenario file Vitest uses.
- **2026-07-31 — PHASE 0 CLOSED (exit verifier: GREEN, zero defects).** All 15 packets
  executed by Opus workers under the plan's protocol; 24/24 packages scaffolded, building
  (`tsc -b`, cold and warm), testing, linting; docs, example, size gate (425 B / 150 kB),
  CI workflow, community files, ROADMAP all landed. Per-packet commits `WP-0.*` on the
  working branch. **Findings folded back into the plan (dated in-place revisions):**
  WP-0.2's original Done check was vacuous (TS18003 with no .ts files); WP-0.4/0.5 Files
  lines omitted `tsconfig.build.json`; **`pnpm docs` without `run` is a pnpm builtin
  no-op** — always `pnpm run docs` (CI updated); `*.tsbuildinfo` needed gitignoring;
  root-level `.ts` files need `allowDefaultProject: "*.ts"` (WP-0.7-fix1); the umbrella's
  root barrel uses namespace re-exports to avoid symbol collisions. Dormant-but-harmless:
  turbo's `lint` task (root eslint is the gate); `test:suites` vacuous until WP-1.14.
  Phase 1 dispatch begins with WP-1.1 (math vectors) and the batched core trio
  (WP-1.4/1.5/1.6 — batched because all three edit core's `src/index.ts`).

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
- **2026-07-29 — npm publish names decided (owner): `@danielsimonjr/fourjs`.** Spec
  revision 1.6. Umbrella publishes as `@danielsimonjr/fourjs`, all other packages as
  `@danielsimonjr/fourjs-<name>`, from the owner's personal npm scope — no org claim or
  dispute needed (supersedes the `fourjs`/`@fourjs` fallback in the 1.5 note below).
  Workspace names stay `four`/`@four/*`; the mechanical rename happens in the release
  workflow at first publish (§94 0.1). Subpath exports (`@danielsimonjr/fourjs/scene`)
  carry the §91 tree-shaking requirement.
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
