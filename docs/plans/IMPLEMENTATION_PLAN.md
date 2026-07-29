# four.js Implementation Plan

Phase 0 deliverable per §103 of [`docs/SPECIFICATION.md`](../SPECIFICATION.md)
(revision 1.3). This plan is **designed for subagent-driven execution**: an orchestrator
session dispatches small, self-contained **work packets** to worker agents. Packets marked
**[H]** are pre-decided and mechanical — a Haiku-class agent can execute them by following
the steps; packets marked **[S]** need judgment (integration, test design, API surface) and
should go to a stronger model. Every packet ends with a mechanical check; a packet is done
only when its check passes.

The §98 directory tree already exists and is verified (24 `@four/*` packages with
`src/`+`tests/`, `examples/` incl. flagship demos, `tests/{integration,visual,determinism}/`,
`benchmarks/`, `tools/`, `website/`). No packet creates package directories; packets fill
them.

---

## 1. Ground rules (include verbatim in every worker prompt)

Constraints from the specification. Violating any of these fails review, even if tests pass.

1. **Conventions (§7a):** world is right-handed, **Y-up in both 2D and 3D** (2D gravity is
   negative Y). All angles are **radians**. All times are **seconds** — durations too;
   nothing takes milliseconds.
2. **Math (§7b):** math types are mutable. Instance methods mutate in place and return
   `this`. Only `clone()` and static factories allocate. Hot-path methods take an optional
   `out` parameter and return it. Never allocate math objects in steady-state per-frame code.
3. **Components (§6a):** one component per type per node. `RigidBody`, colliders, and
   `MotionComponent` are components, not Node subclasses. Lifecycle: `onAttach` /
   `onDetach` / `dispose`.
4. **Events (§6b):** `on` returns an unsubscribe function. Listeners fire in registration
   order. Physics events dispatch after the fixed step (§39 step 9), never during it.
5. **Determinism (§33):** no `Math.random`, `Date.now`, or wall-clock reads in simulation
   code — inject time, use the seeded RNG. Iterate collections in insertion order only.
6. **Authority (§42):** exactly one system writes a node's transform; conflicts warn in
   development builds.
7. **Toolchain (§91 + MEMORY.md 2026-07-29):** strict TypeScript (no implicit `any`), ESM
   only, named exports only, pnpm workspace, Turborepo, Vitest, TypeDoc. Node ≥ 20.
8. **Dependency direction (AGENTS.md §7):** `math`/`core` at the bottom; `scene`, `motion`,
   `animation` above; `physics` above `physics-*` adapters; `render` above `render-*`
   backends; the logical scene never imports a concrete backend; `four` aggregates.
9. **Do not edit `docs/SPECIFICATION.md`** (amendments are owner decisions), do not add
   packages (§98 is frozen; see ERRATA E-3), do not add dependencies beyond a packet's
   allowlist. § numbering 1–120 is frozen.
10. Update nothing outside the files your packet names. If a packet seems to require more,
    stop and report instead of improvising.

## 2. Work-packet format

```
WP-<phase>.<n> [H|S] <title>
Depends: <packet ids or ->
Reads:   <files/§ to read first>
Files:   <exact files to create or edit>
Steps:   <numbered, imperative>
Done:    <shell commands that must succeed, and what they must print>
```

Orchestration protocol:
- Dispatch one packet per worker agent. Give the worker: §1 ground rules, the packet
  verbatim, and nothing else to decide.
- Packets with no dependency edge between them may run in parallel **only if their `Files`
  sets are disjoint**; otherwise serialize or use worktree isolation.
- On a failed `Done` check: return the failure output to the same worker, max two retries,
  then escalate to the orchestrator.
- After each phase: run the phase's exit packet, commit, push. Never start phase N+1 before
  phase N's exit packet passes.

---

## 3. Phase 0 — Project Foundation (§103)

Exit criteria: monorepo installs; all packages compile; tests run; docs build; example
application starts (a placeholder page is acceptable until Phase 3).

**WP-0.1 [H] Root manifests**
Depends: —
Reads: §91, §103; MEMORY.md "2026-07-29 toolchain decisions"
Files: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.npmrc`
Steps: 1. Root `package.json`: `"private": true`, `"type": "module"`,
`"engines": { "node": ">=20" }`, `packageManager` pinned to current pnpm; scripts
`build|test|lint|format|check-spec` (check-spec = `node tools/check-spec.mjs`); devDeps:
`typescript`, `turbo`, `vitest`, `eslint`, `prettier`, `@changesets/cli`, `size-limit`.
2. `pnpm-workspace.yaml` covering `packages/*`. 3. `.gitignore`: `node_modules`, `dist`,
`coverage`, `.turbo`. 4. `.npmrc`: `engine-strict=true`.
Done: `pnpm install` exits 0; `git status` shows a lockfile.

**WP-0.2 [H] TypeScript base config**
Depends: WP-0.1
Reads: §91
Files: `tsconfig.base.json`
Steps: strict, `target`/`module`/`moduleResolution` for modern ESM (`ES2022`,
`NodeNext`-compatible), `declaration: true`, `composite: true`, `isolatedModules`,
`noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
Done: `npx tsc --showConfig -p tsconfig.base.json` exits 0.

**WP-0.3 [H] Lint and format config**
Depends: WP-0.1
Files: `eslint.config.js`, `.prettierrc.json`, `.prettierignore`
Steps: flat ESLint config, typescript-eslint recommended-type-checked; forbid default
exports and `Date.now`/`Math.random` outside `tests/`; Prettier with repo-wide defaults.
Done: `pnpm lint` exits 0 on the current tree.

**WP-0.4 [H] Turborepo pipeline**
Depends: WP-0.1
Files: `turbo.json`
Steps: tasks `build` (dependsOn `^build`, outputs `dist/**`), `test` (dependsOn `build`),
`lint`; enable local caching only.
Done: `pnpm turbo run build --dry-run` lists all 24 packages.

**WP-0.5 [H] Per-package scaffolding — fan-out ×24**
Depends: WP-0.2, WP-0.4. Template packet; run once per package. Parallel-safe (disjoint
files). Order/batch: `core math` → `scene motion animation physics geometry materials
render input assets text serialization diagnostics particles` → `physics-rapier
physics-box2d physics-soft render-webgpu render-webgl render-canvas render-svg ui four`.
Reads: the package's `README.md`; §98 responsibilities; AGENTS.md dependency direction
Files (per package P): `packages/P/package.json`, `packages/P/tsconfig.json`,
`packages/P/src/index.ts`, `packages/P/tests/smoke.test.ts`
Steps: 1. `package.json`: name `@four/P` (package `four` is plain `four`), `"type":
"module"`, `"sideEffects": false`, exports map pointing at `dist/`, workspace deps **only
downward** per the dependency direction, scripts `build: tsc -p tsconfig.json`,
`test: vitest run`. 2. `tsconfig.json` extends `../../tsconfig.base.json`, `references` to
its workspace deps, `outDir: dist`. 3. `src/index.ts`: export a `const PACKAGE_NAME =
"@four/P"` placeholder (named export). 4. `tests/smoke.test.ts`: import from `../src/index.ts`,
assert the name.
Done: `pnpm --filter <name> build && pnpm --filter <name> test` exits 0.

**WP-0.6 [H] Size-limit budget gate**
Depends: WP-0.5
Reads: §86 payload row; MEMORY.md (Rapier wasm excluded)
Files: `.size-limit.json`, root `package.json` (add `size` script)
Steps: one entry: combined `core + math + scene + render-webgl` dist bundles, limit
`150 kB` gzip. It passes trivially now; it exists to catch growth from the first real
commit onward.
Done: `pnpm size` exits 0.

**WP-0.7 [H] CI workflow**
Depends: WP-0.5, WP-0.6
Files: `.github/workflows/ci.yml`
Steps: on push/PR: checkout, pnpm setup (Node 20), `pnpm install --frozen-lockfile`,
`pnpm turbo run build test lint`, `node tools/check-spec.mjs`, `pnpm size`.
Done: `npx yaml-lint .github/workflows/ci.yml` (or a node YAML parse one-liner) exits 0.

**WP-0.8 [H] Community files**
Depends: —
Reads: §95
Files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
Steps: CONTRIBUTING: repo state, pnpm/turbo commands, packet workflow, RFC/ADR rule for
architectural changes (§95), spec-amendment rule. CODE_OF_CONDUCT: Contributor Covenant 2.1.
Done: both files exist; `pnpm lint` still exits 0.

**WP-0.9 [H] ROADMAP.md**
Depends: —
Reads: §94, §120
Files: `ROADMAP.md`
Steps: table of releases 0.1–1.0 from §94 with one line each; MVP definition pointer to
§120; note that dates are set per-release, not up front.
Done: file exists; every §94 release listed exactly once.

**WP-0.10 [S] Phase 0 exit verification**
Depends: all WP-0.*
Steps: run the full matrix (`pnpm install`, `turbo run build test lint`, `check-spec`,
`size`); fix nothing yourself — file a defect list per failing packet; update TODO.md
(move Phase 0 items to Done) and CHANGELOG.md.
Done: all commands exit 0 twice in a row (cache warm and cold: `turbo run --force`).

---

## 4. Phase 1 — Math, Scene, and Time (§104)

Exit criterion: a scene graph can be deterministically stepped without a renderer.
All APIs below are already specified — workers implement, not design.

**WP-1.1 [H] Vector2 / Vector3 / Vector4** — Depends: Phase 0. Reads: §7b, §104.
Files: `packages/math/src/{vector2,vector3,vector4}.ts` + tests.
Steps: mutable classes; `set/copy/clone/add/sub/scale/dot/lengthSq/length/normalize/lerp`;
cross on Vector3; every method that produces a vector takes `out?` or mutates `this`
(follow §7b exactly); no epsilon-free equality (provide `equalsApprox(v, eps)`).
Done: `pnpm --filter @four/math test` green; no method allocates except `clone` (assert via
test that reuses one scratch object and checks identity).

**WP-1.2 [H] Quaternion** — Depends: WP-1.1. Files: `packages/math/src/quaternion.ts` + tests.
Steps: identity, `setFromAxisAngle` (radians), `multiply`, `conjugate`, `normalize`,
`slerp` (§17/§43 requirement), `rotateVector3(v, out?)`.
Done: package tests green incl. slerp endpoints/midpoint against known values.

**WP-1.3 [H] Matrix3 / Matrix4** — Depends: WP-1.1, WP-1.2.
Files: `packages/math/src/{matrix3,matrix4}.ts` + tests.
Steps: column-major storage; `identity/copy/clone/multiply/invert/determinant`;
Matrix4 `compose(position, rotation, scale, pivot)` implementing §7's
`T · Tp · R · S · Tp⁻¹`, `decompose` (no pivot recovery — document), `perspective` and
`orthographic` helpers (§47; NDC differences live here per §7a).
Done: tests green incl. compose/decompose round-trip and compose-vs-manual-multiply.

**WP-1.4 [H] EventEmitter** — Depends: Phase 0. Reads: §6b.
Files: `packages/core/src/events.ts` + tests.
Steps: typed `EventEmitter<EventMap>` exactly as §6b: `on` returns unsubscriber; `once`;
`off`; registration-order dispatch; mutations during dispatch take effect next dispatch; no
re-entrant dispatch of the same event object.
Done: tests green covering all five §6b rules.

**WP-1.5 [H] Component model** — Depends: Phase 0. Reads: §6a.
Files: `packages/core/src/component.ts` + tests.
Steps: `Component` interface (`node`, `onAttach?`, `onDetach?`, `dispose?`),
`ComponentType<T>`, and a `ComponentHost` mixin implementing
`addComponent/getComponent/removeComponent` with one-per-type + replace-warns semantics
(§6a). Scene's Node will extend this in WP-1.8.
Done: tests green: one-per-type, replacement warning, lifecycle order, detach ≠ dispose.

**WP-1.6 [H] FourError + Disposable** — Depends: Phase 0. Reads: §83, §89.
Files: `packages/core/src/{errors,disposable}.ts` + tests.
Steps: `FourError` (`code`, `context?`, `cause?`) and the §89 code list as a string union
incl. `CONTEXT_LOST`/`DEVICE_LOST`; `Disposable` interface + `disposeAll` helper.
Done: tests green.

**WP-1.7 [H] Transform** — Depends: WP-1.3. Reads: §7 (all semantics bullets).
Files: `packages/scene/src/transform.ts` + tests.
Steps: fields per §7; `version` increments on every local mutation; `matrixAutoUpdate =
false` → user owns `localMatrix`, no TRS back-derivation; local compose via Matrix4
`compose`.
Done: tests green: pivot affects rotation/scale not position; version counting; manual
matrix mode.

**WP-1.8 [S] Node / Group / Scene** — Depends: WP-1.4, WP-1.5, WP-1.7. Reads: §6, §6a, §46.
Files: `packages/scene/src/{node,group,scene}.ts` + tests.
Steps: §6 API; parent/child with cycle prevention (§85 validation: adding an ancestor
throws `INVALID_SCENE_GRAPH`); Node mixes in EventEmitter + ComponentHost; Scene provides
`findById/Name/Tag/Component` (selector syntax `scene.query(...)` is **out of scope until
Phase 7+**; leave unimplemented with a typed TODO).
Done: tests green: hierarchy insert/remove, cycle prevention, id lookup, component lookup.

**WP-1.9 [S] Clock, TimeState, fixed-step scheduler** — Depends: WP-1.4.
Reads: §9, §10 **including the clamp and pause paragraphs**, Appendix A.
Files: `packages/motion/src/{clock,scheduler}.ts` + tests.
Steps: `TimeState` with all §9 fields; scheduler implements the §10 algorithm verbatim:
`timeScale` on accumulation, `maximumSubSteps` clamp (default 5), excess → `droppedTime`,
`paused` freezes accumulation and zeroes `deltaTime` while `unscaledDeltaTime` continues;
emits `fixedUpdate`/`update`/`render` in order; time injected, never read from wall clock.
Done: tests green: substep clamp drops time exactly as §10 code; alpha ∈ [0, 1]; pause vs
`timeScale = 0` per §10; determinism: two runs with the same injected frame times produce
identical `TimeState` sequences.

**WP-1.10 [S] Dirty world-transform propagation** — Depends: WP-1.8. Reads: §7 semantics.
Files: `packages/scene/src/world-transforms.ts` (+ edits to `node.ts`) + tests.
Steps: lazy resolve; explicit `resolveWorldTransforms(scene)` entry point called per fixed
step and before render (per §7); on-demand resolve for single-node queries; version-based
caching.
Done: tests green: child world matrix updates when ancestor moves; untouched subtrees not
recomputed (count resolutions); on-demand query correct mid-frame.

**WP-1.11 [S] Phase 1 exit test** — Depends: all WP-1.*.
Files: `tests/determinism/phase1-headless-stepping.test.ts`
Steps: build a 100-node scene with rotating transforms driven from `fixedUpdate`; run 1000
fixed steps twice with identical injected times; hash all world matrices each step (FNV-1a,
1e-6 quantization per §33).
Done: identical hash sequences across runs; test wired into `pnpm test` at the root.

---

## 5. Phase 2 — Motion Foundation (§105)

Exit criterion: motion is deterministic, renderer-independent, unit tested.
Same packet style; the orchestrator issues these when Phase 1's exit packet is green.

- **WP-2.1 [H]** `MotionComponent` (§11) as a §6a component; fields only + integration in
  the scheduler's fixed step using semi-implicit Euler (§38 default).
- **WP-2.2 [H]** Integrator selection (§38): `explicit-euler`, `semi-implicit-euler`,
  `velocity-verlet`, `rk2`, `rk4` as pure functions over (state, dt).
- **WP-2.3 [S]** Transform authority (§42): the enum incl. `blended`, per-node owner,
  dev-mode conflict warnings; wire `MotionComponent` writes through it.
- **WP-2.4 [H]** Trajectories (§13): linear, circular, elliptical, parabolic, Bézier,
  Catmull-Rom, ballistic, damped spring; `sample*` with `out?`; times in seconds.
- **WP-2.5 [S]** Kinematic controller (§12): `moveTo/rotateTo/followPath` over trajectories;
  authority = `kinematic`.
- **WP-2.6 [H]** Spring motion (§13/§105): damped-spring utility used by trajectories and
  controllers.
- **WP-2.7 [S]** Interpolation buffers (§43): previous/current transform snapshots per node
  keyed off the scheduler; `interpolate(alpha)` producing render poses that are never
  written back (§37/§43).
- **WP-2.8 [S]** Phase 2 exit test: the §105 demonstration set (constant velocity/
  acceleration, circular, spline, damped spring) asserted against closed-form positions at
  t = 1 s, plus a determinism double-run.

---

## 6. Phases 3–10 — rolling-wave planning

Later phases depend on interfaces that Phases 0–2 will pin down. **Do not decompose them
now.** When a phase's predecessor exit packet is green, the orchestrator writes that
phase's packets using the same format, sized so each is one file-cluster with a mechanical
check. Scope, spec anchors, and exit criteria are fixed already:

| Phase | Scope (spec) | Exit criterion | Likely packet seams |
|---|---|---|---|
| 3 | Renderer interface, WebGL 2 backend, cameras, viewports (§61–62, §47–48, §106) | Moving 2D/3D primitives render smoothly under fixed-step simulation | interface / context+loss handling / camera projections / render list / buffers / interpolation-aware draw |
| 4 | Tween, easing, Timeline, clips/tracks, bindings (§15–17, §107) | Any numeric/vector/quaternion/color/transform property animatable | easing table / tween core / timeline+markers (§16 semantics) / clip tracks / binding resolution |
| 5 | Physics API + Rapier adapter (§20–32, §37, §108) | Mixed 2D/3D demo: gravity, collisions, impulses, sensors via common API | descriptors / world+body+collider API / adapter contract (§37 incl. drainEvents) / rapier2d + rapier3d wiring / event normalization / sync + interpolation capture |
| 6 | Joints (§28, §109) | Constraints stable under real-time loads | per-joint-type packets / motors+limits / break thresholds |
| 7 | Physics-animation blending (§19, §42, §110) | Animated↔kinematic↔physical without discontinuities | blended authority / pose pipeline / ragdoll transition |
| 8 | Advanced motion (§111) | PID utility + steering demos | steering / IK / PID |
| 9 | Particles CPU+GPU (§36, §112) | 100k particles interactive | emitter model / CPU sim / GPU compute path |
| 10 | Replay, snapshots, diagnostics (§33–34, §113) | Capture → replay → frame-step a physics defect | snapshot API / replay format (§34 list) / checksums (§33 definition) / overlays |

Standing rule for phases 5+: the §34/§33 formats (replay fields, checksum definition) are
normative — packets cite them rather than inventing formats.

---

## 7. Verification stack (what "Done" means mechanically)

| Level | Command | Gate |
|---|---|---|
| Types | `pnpm turbo run build` | every packet |
| Unit | `pnpm turbo run test` (Vitest) | every packet |
| Lint | `pnpm lint` | every packet |
| Spec integrity | `node tools/check-spec.mjs` | any packet touching docs |
| Payload | `pnpm size` (§86: ≤ 150 kB gzip, core+math+scene+render-webgl) | CI, from Phase 0 on |
| Determinism | `tests/determinism/` double-run hash equality | phase exits from 1 on |

Escalation: a worker that cannot make its `Done` command pass within two retries reports
the failing output and stops. The orchestrator either revises the packet or reassigns it
to a stronger model. Workers never widen their own scope.
