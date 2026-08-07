# four.js compatibility tables

§90 requires the project to publish compatibility tables for five things:
browser support, WebGPU/WebGL feature tiers, physics solver adapters, scene
format versions, and plugin API versions. This document is those five, and it
is the first time they have been published — until 2026-08-07 every reference
to them in the repository was forward-looking (`docs/GAP ANALYSIS v0.md`,
A-26).

Two rules govern everything below.

**A row says what is true today, not what is planned.** Where a §90 row has no
implementation behind it, the row says so and names the gap item, rather than
describing an intention in the present tense. "Supported" is reserved for
things something in this repository actually exercises.

**The solver-adapter table is generated.** §37 says capability declarations
"drive `solver: "auto"` selection (§20) and the compatibility tables of §90",
so section 3 is emitted from the shipped adapters' own declarations by
`tools/generate-compatibility.mjs` and verified by its `--check` mode. A
hand-maintained copy of a declaration that already exists is exactly how a
compatibility table goes quietly wrong.

Nothing is published to npm yet: all 24 workspace packages sit at version
`0.0.0`. §90's semantic-versioning contract (section 6) therefore governs
releases that have not happened; the format and API versions in sections 3–4
exist today and are the ones a document on disk has to match.

---

## 1. Browser and runtime support (§90)

Split deliberately into what is **verified** — something in this repository
runs it and fails when it breaks — and what is **expected**, which is an
engineering judgement with no gate behind it.

| Target                                    | Status             | What backs the claim                                                                                                                                                                                              |
| ----------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node >= 20                                | verified           | Root `engines.node`. The unit suites, `tests/integration`, `tests/determinism` and every `tools/` script run here, headless and with no GPU.                                                                      |
| Headless Chromium, ANGLE over SwiftShader | verified           | `playwright.config.ts` launches with `--use-gl=angle --use-angle=swiftshader` and drives six built example sites (`pnpm test:browser`); the `visual` project additionally compares committed SwiftShader goldens. |
| Chromium on a real GPU                    | expected           | The same code path with a different rasteriser. No gate runs it, which is why the browser suite asserts thresholds rather than pixels in the `chromium` project.                                                  |
| Firefox, Safari, other evergreen browsers | expected, untested | Nothing in the engine is Chromium-specific and the requirements below are all standard, but there is no Playwright project and no CI job for them. Do not read this row as support.                               |
| Browsers with WebGL 1 only                | not supported      | §120 fixes the MVP renderer tier at WebGL 2, and `@four/render-webgl` is the only backend (section 2). There is no WebGL 1 fallback and none is planned.                                                          |
| Deno, Bun, other non-Node runtimes        | untested           | The packages are plain ESM with no Node built-ins in the browser-safe set, so they are likely to work; nothing checks it.                                                                                         |

What an application needs at runtime:

- **ES2022 and ESM.** `tsconfig.base.json` targets `ES2022` with
  `module: "NodeNext"`; every package declares `"type": "module"` and an
  `exports` map with an `import` condition and **no `require` condition**.
  There is no CommonJS entry point and no bundled UMD build.
- **WebGL 2**, for anything that draws. Headless _simulation_ needs no GPU at
  all — run the scene, motion and physics with `NullRenderer` or with no
  renderer (§62, §104).
- **WebAssembly**, for physics. Both Rapier adapters load a
  `@dimforge/rapier{2,3}d-compat` wasm image (base64-embedded, so no separate
  fetch and no MIME configuration).
- **No cross-origin isolation.** Everything shipped runs in §88's main-thread
  mode, so `SharedArrayBuffer` is not required and COOP/COEP headers are not
  needed. See `docs/guides/workers-and-cross-origin-isolation.md` for what
  changes if split-simulation mode lands.
- **pnpm 10** (`packageManager` pins `pnpm@10.33.0`) to build from source,
  which is the only way to consume the packages until first publish.

## 2. Render backends and capability tiers (§62)

§62 lists five backends. One ships, one headless tier ships, and three are
reserved package directories — `RendererBackend` names all five so that the
interface does not change when a backend lands.

| §62 backend | `RendererBackend` | Package               | Status                                                           |
| ----------- | ----------------- | --------------------- | ---------------------------------------------------------------- |
| WebGL 2     | `"webgl2"`        | `@four/render-webgl`  | **shipped** — `WebglRenderer`; the §120 MVP tier                 |
| headless    | `"null"`          | `@four/render`        | **shipped** — `NullRenderer`, alongside the `Renderer` interface |
| WebGPU      | `"webgpu"`        | `@four/render-webgpu` | reserved stub — the package builds and exports `PACKAGE_NAME`    |
| Canvas 2D   | `"canvas2d"`      | `@four/render-canvas` | reserved stub — the package builds and exports `PACKAGE_NAME`    |
| SVG         | `"svg"`           | `@four/render-svg`    | reserved stub — the package builds and exports `PACKAGE_NAME`    |

What the WebGL 2 tier actually carries:

| Feature                        | State                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| Pipelines                      | four — unlit, lit, sprite, particles (`gl-program.ts`, `gl-particles.ts`)                          |
| Geometry                       | one vertex array object per geometry, cached and evicted (`gl-geometry.ts`)                        |
| Clip depth                     | `"negative-one-to-one"` (plan D8) — the WebGL convention, not WebGPU's                             |
| Context loss and restore (§61) | implemented; `contextlost`/`contextrestored` are emitted on `Renderer.events`                      |
| Lighting                       | one directional light plus scene ambient, first light in scene-graph DFS order (§33-deterministic) |
| Sprite batching (§65)          | absent — one draw call per sprite                                                                  |
| Anti-aliasing                  | `RendererOptions.antialias` is a hint; a backend that cannot honour it never fails initialization  |

§62's capability-reporting clause lists eleven fields. `RendererCapabilities`
carries **two** of them — `backend` and `maxTextureSize` — and that is
deliberate rather than incomplete: the WP-3.4 decision is that a backend
reports only what it has queried, because "capability negotiation is precisely
the place where a confident wrong answer costs a crash". The remaining nine
fields (texture formats, multisampling, floating-point targets, timestamp
queries, storage buffers, compute shaders, indirect draw, compressed textures,
shader precision, uniform and binding limits) arrive with the packets that can
query them, and §62's "applications may declare required and optional
capabilities" has no API yet.

§62's `renderer: "auto"` selection — and the string backend form generally —
is **not implemented**: `ApplicationOptions.renderer` takes a `Renderer`
instance (gap A-8). An application therefore chooses its backend by importing
it, which is also why the umbrella package does not statically pull in every
backend.

## 3. Physics solver adapters (§37, §102)

§102 defines the solver package set as `@four/physics-rapier` and
`@four/physics-box2d`; `@four/physics-soft` is §35's soft-body package on the
same seam. The table below is generated from the adapters' own
`PhysicsCapabilities` records, read off constructed instances before
`initialize`, plus the two structural access seams
(`SolverBodyAccess`, `SolverJointAccess`) probed member by member against
`@four/physics`'s emitted declarations. Regenerate with
`node tools/generate-compatibility.mjs` after any adapter change.

<!-- BEGIN GENERATED: solver-adapters -->

<!-- Generated by tools/generate-compatibility.mjs from the adapters' own §37
     capability declarations. Do not edit by hand: run
     `node tools/generate-compatibility.mjs`, and
     `node tools/generate-compatibility.mjs --check` to verify. -->

| Declaration                     | `rapier2d`                                         | `rapier3d`                                                      |
| ------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Package (§98)                   | `@four/physics-rapier`                             | `@four/physics-rapier`                                          |
| Exported class                  | `Rapier2dAdapter`                                  | `Rapier3dAdapter`                                               |
| Underlying solver               | `@dimforge/rapier2d-compat` 0.19.3                 | `@dimforge/rapier3d-compat` 0.19.3                              |
| `dimensions` (§21)              | `2d`                                               | `3d`                                                            |
| `determinism` (§33)             | `same-runtime`                                     | `same-runtime`                                                  |
| `snapshots` (§34)               | yes                                                | yes                                                             |
| `ccdModes` (§31)                | `disabled`, `speculative`, `swept`                 | `disabled`, `speculative`, `swept`                              |
| `jointTypes` (§28)              | `fixed`, `spring`, `revolute`, `prismatic`, `rope` | `fixed`, `spring`, `revolute`, `prismatic`, `spherical`, `rope` |
| `queries.raycast` (§30)         | yes                                                | yes                                                             |
| `queries.shapeCast` (§30)       | yes                                                | yes                                                             |
| `queries.overlap` (§30)         | yes                                                | yes                                                             |
| `queries.point` (§30)           | yes                                                | yes                                                             |
| `tuning.rollingFriction` (§25)  | no                                                 | no                                                              |
| `tuning.spinningFriction` (§25) | no                                                 | no                                                              |
| `tuning.sleepThresholds` (§32)  | no                                                 | no                                                              |
| `reportsJointReactions` (§28)   | no                                                 | no                                                              |
| `SolverBodyAccess` implemented  | yes                                                | yes                                                             |
| `SolverJointAccess` implemented | yes                                                | yes                                                             |

Solver packages that declare no adapter:

- `@four/physics-box2d` — reserved stub (§102): the package builds and exports `PACKAGE_NAME` only.
- `@four/physics-soft` — reserved stub (§102): the package builds and exports `PACKAGE_NAME` only.

<!-- END GENERATED: solver-adapters -->

### The two access seams

§37's `PhysicsCapabilities` has six fields (plus the later `tuning` record) and
no room for the question "can the engine talk to a body or a joint at all",
so that is answered structurally instead of being declared:

- **`SolverBodyAccess`** — the per-handle body seam: transforms, velocities,
  forces and impulses, kinematic targets, mass and centre of mass, in-place
  body re-typing (§19), sleep state, and the monotonic `getBodyId` /
  `forEachBody` visit order §33's checksum depends on. `PhysicsWorld` requires
  it: `PhysicsWorldAdapter` is `PhysicsSolverAdapter & SolverBodyAccess`, so an
  adapter without it cannot back a world.
- **`SolverJointAccess`** — the joint seam: ids and visit order, live limit and
  motor reconfiguration, and `getJointReaction` for §28 breakage. Its one
  _declared_ member is `reportsJointReactions`, which appears as a row in the
  table above.

### Deviations the capability record cannot express

Honest differences that no field of `PhysicsCapabilities` can carry, recorded
here because §90 tables are where a user looks for them (each is documented at
its source in `packages/physics-rapier/src`):

- **Break thresholds do not work on either Rapier adapter.** Rapier 0.19.3
  exposes no joint reaction, so `reportsJointReactions` is `false` and
  `PhysicsWorld.addJoint` **refuses** a joint carrying `breakForce` or
  `breakTorque` rather than accepting a threshold that could never fire.
- **A motor's `maxTorque` / `maxForce` is a gain, not §28's hard cap.** Rapier
  parameterises its motors by force-based gains; the value reaches the solver
  but does not clamp the way §28 describes.
- **A 3D `spherical` joint ships without limit support.** A limited one is
  refused loudly rather than simulated unlimited.
- **Restitution combine is forced to `Max`.** Rapier's default is `Average`,
  which contradicts Appendix A.
- **`SleepingConfig.enabled` is honoured; the three thresholds are not.** The
  thresholds are the `tuning.sleepThresholds` row above; `enabled` maps to
  `RigidBodyDesc.setCanSleep` and is deliberately not part of that flag.
- **`shapeCast` has a multiplicity limit** on both adapters — see each
  adapter's `shapeCast` documentation for what `maxHits` and `sorted` can ask
  for. The capability stays `true` because the query is implemented.

`determinism: "same-runtime"` on both adapters is Appendix A's target and no
more: the same build on the same engine reproduces a run exactly (proven by
the §92 determinism goldens). Nothing stronger is claimed, because the
adapters' own conversions use `Math.atan2` / `Math.sin` / `Math.cos`, whose
results are not specified across JavaScript engines — which is exactly what
`"same-platform"` would forbid.

## 4. Scene, replay and snapshot format versions (§34, §79, §80)

§80 makes format versioning **independent of package semantic versioning**: a
number here moves only when a document's _shape_ changes, never because a
package released.

| Format                         | Constant                                                     | Writes | Reads    | Where                  |
| ------------------------------ | ------------------------------------------------------------ | ------ | -------- | ---------------------- |
| Scene document (§79)           | `SCENE_FORMAT_VERSION`                                       | `1`    | `1`      | `@four/serialization`  |
| Replay recording (§34)         | `REPLAY_FORMAT_VERSION` / `SUPPORTED_REPLAY_FORMAT_VERSIONS` | `2`    | `1`, `2` | `@four/diagnostics`    |
| Rapier snapshot envelope (§34) | `SNAPSHOT_FORMAT_VERSION` (module-private, not exported)     | `2`    | `2`      | `@four/physics-rapier` |
| `.four` binary package (§79)   | —                                                            | —      | —        | not implemented (A-16) |

**The versioning rule, decided 2026-08-06 (PH-6): a document declares the
lowest version that can express its content**, not the version of the build
that wrote it. A replay recording carrying a `worldConfiguration` is a `2`; one
without is still a `1`, byte for byte the same text the format produced before
version 2 existed. That is what makes a bump safe in both directions — old
documents still run and re-encode identically, new documents are refused by old
builds _loudly_ (`SERIALIZATION_VERSION_MISMATCH` naming both numbers) instead
of being silently stripped, and downgrading is a real operation rather than a
hack: delete the field, re-validate, and the version is re-derived from the
content.

Notes per row:

- **Scene documents** are at version `1` and there is exactly one version, so
  `SceneMigrationRegistry` currently holds no steps. §80's requirements —
  explicit, testable, deterministic, warning-capable, composable migrations —
  are implemented in `migration.ts` and waiting for a first bump. A document
  declaring any other version is refused by `validateSceneDocument` and has to
  go through `runSceneMigrations` first.
- **Scene documents carry `Node`'s own fields only.** No camera FOV, no
  geometry reference, no sprite texture key, no light colour, no widget box:
  round-tripping a subclass needs an application-supplied `nodeFactory`
  (gap A-16). This is a compatibility fact, not a defect of the format
  version.
- **The Rapier snapshot envelope is adapter-private.** Its version is not
  exported, so it is not in the generated table; both adapters are at `2`
  (raised from `1` in WP-6.2, when the metadata grew a joints table), and
  `restoreSnapshot` refuses anything else. A snapshot is opaque solver bytes
  plus that envelope — it is not interchangeable between adapters, between
  dimensions, or across a Rapier version bump.
- **§34 replay documents pin an adapter identity**, so a recording made on one
  adapter is refused on another rather than replayed into a mismatched world.

## 5. Plugin API versions (§81)

**n/a — the §81 plugin system is not implemented (gap A-3).** There is no
`FourPlugin`, no `PluginContext`, no install/uninstall lifecycle, and none of
§81's eleven extension points; §98's `@four/core` charter line ("plugin host
(§81)") is unimplemented and no phase §103–§113a scheduled it. There is
therefore no plugin API version to publish and no compatibility range to
honour, and this section will stay a sentence rather than become a table until
that changes.

Worth stating so the absence is not mistaken for a smaller one: the _shape_
§81 needs already exists in several places, independently invented —
`ComponentSerializerRegistry` (§79), `SceneMigrationRegistry` (§80), the
injectable `AssetLoader` value, `WidgetSkin` (§74). Those are ordinary package
APIs governed by section 6's semantic versioning, not a plugin API, and code
built on them is not a plugin in §81's sense.

## 6. Package versioning (§90)

§90's contract for the packages themselves:

| Bump  | Means                        |
| ----- | ---------------------------- |
| patch | compatible defect correction |
| minor | backward-compatible feature  |
| major | breaking API change          |

All 24 workspace packages are at `0.0.0` and none is published. §98 fixes the
publish naming: the umbrella package publishes as `@danielsimonjr/fourjs` and
the sub-packages as `@danielsimonjr/fourjs-<name>`, while the workspace names
stay `four` and `@four/*`. Changesets is the configured release tool (§91);
`docs/GAP ANALYSIS v0.md` A-25 records that the release machinery around it
does not exist yet.

Two things are deliberately _not_ governed by these numbers: the format
versions of section 4 (§80 makes them independent) and a solver adapter's
capability record, which is a declaration about the underlying solver build
rather than about this project's API.

## Regenerating and checking this document

```sh
node tools/generate-compatibility.mjs           # refresh the generated block
node tools/generate-compatibility.mjs --check   # fail if the block is stale
```

The generator imports the built adapters from `dist/`, so run `pnpm build`
first. Everything outside the `BEGIN GENERATED` / `END GENERATED` markers is
hand-written and has to be reviewed against the code the same way any other
document does; `tools/check-spec.mjs` and `tools/check-docs.mjs` are the
sibling checks and neither reads this file.
