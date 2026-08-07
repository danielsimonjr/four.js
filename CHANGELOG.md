# Changelog

All notable changes to this repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Once packages
are published, releases will follow [Semantic Versioning](https://semver.org/) per §90 of the
specification; until then, entries are grouped by date under **Unreleased**.

## [Unreleased]

### 2026-08-07 — A-10 closed, A-13 keyboard half closed: `KeyboardInput` + UI traversal

The gap analysis's A-10 ("`@four/input` has exactly one input source") and the keyboard half
of A-13 ("`WidgetAccessibility` is fully inert") close together, because they are one
feature: keys enter through `@four/input` and land on the focused widget through `@four/ui`.
Focus crosses that boundary as an **injected resolver** (`focusTarget(): Node | null`),
never an import — §3.1's one-way `ui → input` edge stays frozen.

#### Added

- **`KeyboardInput` in `@four/input` (A-10, §70, §72)** — the keyboard analogue of
  `PointerInput`: a duck-typed `KeySurface` (satisfied by `window`, `document`, or a plain
  test object; no DOM lib type named anywhere), `SceneKeyEvent` (`keydown`/`keyup`, `key`,
  `code`, grouped `modifiers`, `repeat`, plus `preventDefault()` forwarded to the platform
  event via `KeyDefaultSuppressor` — Tab and Space mean something to the host), and
  `dispatchKeyEvent`. `NodeEventMap` gains `keydown`/`keyup` + `capture:` pairs by the same
  declaration merging the pointer events use. `keypress` is deliberately absent (documented).
- **`propagation.ts` in `@four/input`** — the three-phase machinery generalized out of
  `pointer-events.ts`: `SceneInputEvent` (abstract `target`/`stopPropagation` base),
  `buildPropagationPath`, `dispatchThreePhase(event, path, type, captureKey)`. Listener keys
  are parameters, not string concatenation, so `emit` stays fully checked with no cast.
  `dispatchPointerEvent` / `ScenePointerEvent` / `buildPropagationPath` keep their exact
  public surface — no import path changed.
- **Keyboard traversal in `@four/ui` (A-13, §75)** — `collectFocusOrder` (prune rules of
  `collectPickables`; ascending `accessibility.tabIndex`, scene order on ties; negative
  `tabIndex` opts out of traversal but stays programmatically focusable),
  `keyboardFocusTarget(root)` (the resolver for `KeyboardInput`; falls back to the root so
  the first Tab is deliverable), `installKeyboardTraversal(root, { wrap })` for
  Tab/Shift-Tab, and `Button` activation on Enter/Space with `source: "keyboard"`
  (`WidgetActivationSource` widened with `"keyboard"`). One stated DOM deviation: `tabIndex`
  sorts plainly ascending — no positive-before-zero rule, which exists only because HTML
  interleaves with a document order this tree can see directly.

#### Changed

- **`UI_STAGED` shrinks by one**: the §75 keyboard-navigation entry is deleted;
  `WidgetAccessibility.tabIndex` is live. DOM mirror, screen-reader/high-contrast/scalable
  text, and reduced-motion entries remain, verbatim.
- **`examples/ui-demo` drops its page-level `keydown` workaround** (20 lines → 2:
  `new KeyboardInput(window, { focusTarget: keyboardFocusTarget(uiRoot) })` +
  `installKeyboardTraversal(uiRoot)`). No visual change; `tests/browser/ui.spec.ts` now
  asserts `source: "keyboard"` and covers Shift-Tab and Space.

Gates: input 115 + ui 128 unit tests (51 new), both packages 100% ×4 coverage; suites 176;
38/38 browser with byte-unchanged visual goldens; TypeDoc 0 warnings; ui-demo
28.1/30 kB.

### 2026-08-06 — PH-17 remainder: shipped `RigidBody` / `Collider` serializers

Closes the follow-up the wave-1 entry below records as "deliberately not done". The §79
component serializers for the two physics components now ship from the package that owns
them, so a scene carrying physics saves and reloads through one umbrella call instead of
through a serializer copied out of a test helper.

#### Added

- **`RIGID_BODY_SERIALIZER` and `COLLIDER_SERIALIZER` from `@four/physics` (PH-17, §23–§25,
  §79)** — with `serializeCollisionShape` / `deserializeCollisionShape` and the
  `RigidBodyDocument` / `ColliderDocument` / `PhysicsMaterialDocument` shapes. Declared
  against `ComponentSerializerShape`, the structural transcription `@four/motion` already
  exports, **imported over the existing `physics → motion` edge** — so registering them into
  `@four/serialization`'s registry needs no cast and adds no §3.1 edge, and the repository
  holds one transcription rather than two that can drift. The same honest cost applies:
  nothing type-checks it against `ComponentSerializer`, so a transcribed-mirror assignability
  test asserts it, as `@four/motion`'s suite does.
- **`registerPhysicsSerializers()` on the umbrella `four` package** — registers both on a
  caller's registry and returns it. `registerSceneNodeTypes()` calls it, so one call now
  covers the §73 widgets, `MotionComponent`, `RigidBody`, and `Collider`; it stays separate
  so a headless simulation need not pull `@four/ui` and `@four/text` into its bundle (§91).

#### Changed

- **A physics scene no longer needs `{ unknownComponents: "skip" }` to save.** That opt-in
  was the loud-but-lossy stopgap the A-15 change left in place for physics components.
- **§25's fallback chain survives as a chain.** The WP-11.5 reference serializer wrote
  `effectiveFriction` / `effectiveRestitution` / `effectiveDensity`, pinning today's defaults
  into every document; the shipped one writes the §24 fields **as authored** and the
  `PhysicsMaterial` by value, so the same chain re-resolves to the same numbers on load and a
  later change to `DEFAULT_FRICTION` moves reloaded scenes exactly as it moves saved ones.
  A material round-trips by value, not by identity — two colliders sharing one material
  reload with one each, because sharing is a §79 _resource_ relationship.
- `RigidBody` documents also carry what the reference dropped: the §23 inertia tensor, the
  §37 initial pose (which outranks the node transform at `addBody`), and §31's
  `ccdPredictionDistance` — each written exactly when `toDescriptor()` emits it, so `mass`
  and `centerOfMass` stay absent for a body that asked the solver to derive them.
- `tests/integration/helpers/roundtrip-scenarios.ts` lost its ~400 lines of duplicate
  serializers and now calls the shipped registration; `scene-roundtrip.test.ts` gains a case
  proving a contact-free save reloads **bit-identically** — the control's §33 checksum stream
  element by element — through `registerSceneNodeTypes()` alone.

### 2026-08-06 — gap-closure wave 1 (A-7, A-9, A-14/PH-17, A-15, A-17, PH-6)

Six verified gaps from `docs/GAP ANALYSIS v0.md` closed, each with regression tests. Three
are correctness defects (a real memory leak, a save that silently lost state, an identity
collision), one is a missing §45 lifecycle method, and two are §34/§79 promises the code
contradicted.

#### Fixed

- **`PointerInput` no longer leaks a `Node`-pinning entry per dead pointer id (A-9, §72,
  §83).** Per-pointer state was inserted on demand and removed only by `dispose()`, so a
  surface that saw N touch or pen contacts — the platform issues a fresh `pointerId` for each
  one — kept N entries alive, each retaining `downTarget` and `captured`, both references to
  nodes the application had already removed from the graph. The entry is now torn down and
  deleted when the pointer ends. A 10 000-gesture regression test asserts
  `trackedPointerCount === 0` throughout.
- **A component with no registered serializer is refused on save instead of silently dropped
  (A-15, §79, §6a).** The writer walked the _serializer_ registry and probed each registered
  class, because `Node` offered no enumeration — so an unregistered component was unsaved and
  the omission could not be detected. `Node.components` (a four-line getter forwarding §6a's
  registry, which had exposed the iterator all along) closed it; `serializeScene` now throws
  `INVALID_APPLICATION_STATE` naming the component, or drops it when the caller opts in with
  `unknownComponents: "skip"`. **Output ordering is unchanged** — the walk is over the node,
  the emission over the registry — so every byte-identical round-trip test still holds.
- **A restored node id can no longer be re-issued to a node built after the load (A-17,
  §79).** `NodeOptions.id` restores an id at construction _and reserves it_ against
  `@four/scene`'s monotonic counter; `restoreNodeId` moved into `@four/scene` (the module
  that owns the field) for the `nodeFactory` path that cannot use the constructor, and
  `instantiateScene` refuses a document producing one id twice with `INVALID_SCENE_GRAPH`.
- **§34 replay documents carry the world configuration they were captured under (PH-6).**
  `ReplaySnapshot.configuration` was dropped at record time and never rebuilt at replay time,
  so `PhysicsWorld.restoreSnapshot`'s field-by-field refusal no-oped for every replay: a run
  captured at gravity −9.81 replayed into a world built with gravity 0 ran silently and
  diverged, signalled only by `finalChecksum` at the very end.

#### Added

- **`Application.resize(width, height, resolution?)` (A-7, §45)** — §45's eighth lifecycle
  method. Records the surface size (`app.width` / `app.height` / `app.resolution`), forwards
  to `renderer.resize`, and updates the `aspect` and projection of perspective cameras on
  full-surface viewports. A renderer no-op when headless; the size and cameras are still
  updated. `ApplicationOptions` gained `width`, `height`, `resolution`, and `depthRange`
  (plan D8, for the projection rebuild).
- **`ReplayRecording.worldConfiguration` and a format-version range (PH-6, §34).**
  `REPLAY_FORMAT_VERSION` is `2` and `SUPPORTED_REPLAY_FORMAT_VERSIONS` is `[1, 2]`. **A
  document declares the lowest version that can express its content**, so a recording with no
  configuration is still a version-1 document, byte for byte as before, and every recording on
  disk keeps validating and re-encoding identically. A version-1 document carrying a
  configuration is refused rather than silently upgraded; deleting the field from a version-2
  document and re-validating yields a valid version 1.
- **`MOTION_COMPONENT_SERIALIZER` from `@four/motion` (PH-17, §11, §79)** — declared against
  a structural `ComponentSerializerShape` so no `motion → serialization` dependency edge is
  needed (the `ParticleDrawable` / `ReplayTarget` duck-typing pattern).
- **`registerSceneNodeTypes()` / `registerUISerializers()` from the umbrella `four` package
  (A-14, §73, §79).** §73 promises UI objects "share … serialization"; a `Panel`/`Label`/
  `Button` tree previously round-tripped as bare `Node` state. It now round-trips completely
  — §74 box model and layout, interaction flags, §75 accessibility record — through the one
  package allowed to see both `@four/ui` and `@four/serialization`.
- **`SceneNodeDocument.data` and `SerializeSceneOptions.nodeDataOf` (§79).** One opaque JSON
  value per node, written by the application and handed back verbatim to `nodeFactory` — the
  seam subclass state needed and the format did not have. Distinct from §6's `metadata`,
  which belongs to whoever authored the scene. Absent unless a writer produces one, so
  `SCENE_FORMAT_VERSION` is unmoved and existing documents encode identically.
- **`pointercancel` as a propagating scene event (§72)**, with `DragManager` ending a drag on
  it, plus `PointerInput.trackedPointerCount` and `Node.components`.

#### Changed

- **`tests/determinism/golden/phase10.json` was amended — envelope only, with proof.**
  `recordingDigest` 2642391973 → 1754656889 and `recordingLength` 46822 → 47008 (+186 bytes),
  because the §34 document now carries `worldConfiguration` and therefore declares
  `formatVersion: 2`. **Nothing else moved:** `initialSnapshotDigest`, `stepChecksumDigest`,
  `replayChecksumDigest`, `seekTailDigest`, the first/last/final checksums, the adapter
  identity and every contact count are bit-identical to the 2026-08-02 record — so the
  simulation, Rapier's snapshot bytes and the replay path are all unchanged. The claim was
  verified rather than assumed: re-running the scenario with the new capture neutralized (a
  `ReplayTarget` wrapper that drops `ReplaySnapshot.configuration`) reproduces the previous
  digest and length exactly. The golden records that verification in a new `_amended` field,
  and gained `formatVersion` and `worldConfigurationKeys` so the §34 configuration is pinned
  from now on.
- **Behaviour change, stated rather than hidden (A-9):** a `pointerup` now ends the pointer's
  hover, so a mouse press-and-release fires `pointerleave` and the next `pointermove` fires
  `pointerenter` again. That is correct for touch and pen, where the contact really ceased to
  exist, and is a regression for the mouse, whose pointer persists. Telling them apart needs
  `pointerType` on the structural `SurfacePointerEvent`, which this change did not widen.
- `application.ts`'s module header no longer says input, assets and physics "arrive with the
  phases that build them (§103)" — those phases all landed and wired none of them in. It is
  now a dated post-plan note pointing at A-6.
- `UIWidgetOptions` extends `NodeOptions`, so every widget accepts a restored `id`.

#### Deliberately not done

- `RigidBody` / `Collider` component serializers (the rest of PH-17). They belong in
  `@four/physics`, which this change could not touch; they are tracked in `TODO.md`.

### 2026-08-05 — documentation-truth sweep

No behaviour changed; a set of verified-false claims in the repository's prose were
corrected in place, each with the date and the superseded wording kept. Corrected:
`ROADMAP.md` ("nothing on this roadmap has shipped yet" — the plan completed 2026-08-02);
`README.md` ("42/43 … lighting is the single staged absence" — 43/43 since 2026-08-04);
`docs/AUDIT-120.md` (the examples count, `tests/visual/` "an empty placeholder", and the
sprites "batched" note, plus a new staged line **S-8** for the missing §93/§118–119
examples); `tests/README.md` (rewritten from §92's taxonomy to the suites that exist, with
a per-category "not yet covered" list); `playwright.config.ts` ("There are no golden
images", now scoped to the `chromium` project); `docs/guides/materials-and-render-graph.md`
(the render-list sort keys, the batching row, and the post-lighting material/lighting
rows); `docs/guides/custom-shaders.md` ("three" internal programs → four);
`benchmarks/README.md` (a blocked-by column separating §86 rows that need hardware from the
four that need engine features); `docs/guides/cameras-and-coordinate-conversion.md` (an
empty example cited as exercising the 3D path); `examples/README.md` and
`docs/guides/README.md` (placeholder directories now marked as such).

**Correction to the Phase 0 entry below (dated 2026-08-05).** That entry says
`examples/` "gained the §93 quick-start examples and the two flagship demos (§118–119)".
It gained **directories**, each holding a `.gitkeep` and nothing else, and four of them
plus both flagship directories are still empty today (`git ls-files examples/`). Six
runnable examples exist — `first-2d-scene`, `physics-playground`, `mechanism`, `blending`,
`particles-demo`, `ui-demo` — and none of them is a flagship demo. The historical entry is
left as written, per this file's convention of not rewriting history; `docs/AUDIT-120.md`
**S-8** is the dated statement of what is absent.

#### Added

- `tools/check-docs.mjs` and `pnpm check-docs`, wired into CI next to `check-spec`: a
  mechanical doc-truth gate that fails if a doc references an empty `examples/*` directory
  without a placeholder marker, if `docs/AUDIT-120.md`'s example count drifts from
  `git ls-files`, or if any of the false claims listed above reappears verbatim.

### 2026-08-05 — team code review + simplification sweep

Owner-directed: a five-agent review of all 24 packages, applying
behavior-preserving simplifications along the way. Confirmed bugs, all fixed
with regression tests: torn material color state on rejected `setColor`/
`setTint` (all three materials now validate before writing); UI ancestors
stuck `pressed` forever via bubbled downs (state reactions are target-only
now; ancestors still observe events) and focus surviving reparenting into a
stale scope (attachment blurs, as in the DOM); `RigidBody` silently dropping
`ccdPredictionDistance` on the component path; the adapters' CCD resolver
diverging from the pinned WP-5.2 table for `true` + `"disabled"`; time-0
marker/event double-fire on zero-delta advance in `Timeline` and
`AnimationMixer`. Simplifications: shared `resolveCcdMode` (physics-rapier),
render-webgl program machinery consolidated (~120 lines, GL sequence
byte-identical), `requireNonNegativeSeconds` de-triplicated, `hashFloats`
now composes the checksum primitives, assorted allocation and doc-truth
cleanups. PLAUSIBLE findings recorded for follow-up: pointer-state map
growth over dead pointer ids; first-collider mass loss on direct-adapter
collider destruction; 3D joint-registry mismatch not detected on corrupt
§34 envelopes. Verified: 3,083 unit + 174 suite + 38 browser/visual tests,
coverage gates ≥95% everywhere (physics/diagnostics/animation/materials/ui
at 100%), determinism goldens bit-exact, lint, TypeDoc 0 warnings.

### 2026-08-04 (lighting)

#### Added — Lighting MVP (§68, §120's last unshipped bullet; owner-directed tier)

The minimal defensible tier: one directional light, Lambert diffuse plus a scene
ambient term. No shadows, no point/spot lights, no PBR — each staged with a dated
note where its design will land (§69, §59, §60a; see `docs/AUDIT-120.md` S-5).

- `@four/scene`: `DirectionalLight` node (color + intensity, shines along its node's
  −Z world axis — the camera look convention; `getWorldDirection(out)` resolves on
  demand) and `Scene.ambientLight`, §68's "ambient" as a scene-wide term.
- `@four/materials`: `LitMaterial` mirroring `UnlitMaterial` (color-only, same §60a
  no-color-space/no-clamp stance); both surface materials now carry a `kind`
  pipeline discriminant.
- `@four/geometry`: optional `normals` vertex attribute on `BufferGeometry`
  (index-aligned with positions, §85-validated); `boxGeometry` now emits 24
  vertices with per-face normals (same 12 triangles), `planeGeometry` +Z normals;
  2D shapes stay position-only and unlit.
- `@four/render`: `"lit"` render-item kind chosen from `material.kind`;
  backend-independent `collectSceneLights` with duck-typed light discovery
  (first light in scene-graph order; render-list-identical visibility pruning).
- `@four/render-webgl`: fourth GL program (`LitProgram`; normal matrix derived
  in-shader, no-light frames upload black and need no shader variant), normal
  stream at fixed attribute location 1, `uniform3fv` added to the GL seam.

The unlit path is untouched — a scene with no lit items issues the same GL call
sequence as before, and every browser spec and pixel golden passes unchanged.
On the merged tree (this packet landed alongside the backlog burn-down below):
3,077 unit + 174 suite + 38 browser/visual tests, coverage ≥95% everywhere,
TypeDoc 0 warnings, payload gate 33.28/150 kB; §120 audit amended to 43/43
shipped-or-MVP.

### 2026-08-04 (backlog burn-down)

Owner-directed: implement the recorded backlog, deferring nothing. One batch:

#### Added

- **UI browser proof** — `examples/ui-demo` (a `@four/ui` panel of buttons and
  labels, app-supplied `WidgetSkin`s, real pointer + keyboard interaction,
  25 kB gzip) and `tests/browser/ui.spec.ts` (4 tests). Closes the plan's one
  recorded packet-intent shortfall (WP-11.5). `.size-limit.json` gains the
  missing particles-demo entry (19.36/25 kB) and ui-demo (25/30 kB).
- **§92 visual regression category seeded** — `tests/visual/ui-demo.spec.ts`
  under a new Playwright `visual` project with committed
  SwiftShader-to-SwiftShader pixel goldens (2 tests; stability verified across
  repeated runs). The browser suite's "no golden images" doctrine concerns
  SwiftShader-vs-GPU drift and does not apply to same-rasteriser comparison.
- **`Node.position` / `Node.rotation` / `Node.scale`** alias getters onto the
  live `transform.*` members — the §15/§97 idiom (`camera.position.set(0, 2, 8)`)
  now works; 11 new scene tests.
- **`SolverBodyAccess.getBodyCenterOfMass`** (+ both Rapier adapters via
  `RigidBody.worldCom()`, the fake and scripted adapters) and diagnostics'
  **`collectCentersOfMass`** provider — §113's centre-of-mass display, unstaged
  from `DEBUG_DRAW_STAGED`. All seven debug providers now run against a live
  Rapier adapter in the integration suites (previously 4 of 6 were
  fake-exercised only).
- **`PhysicsWorldOptions.solverIterations`** (§28) → Rapier's
  `World.numSolverIterations`, proven behaviourally: 1 vs 4 iterations diverge
  on a contact stack; an explicit 4 is bit-identical to omitting the option,
  so every recorded checksum and replay stands.
- **`RigidBodyDescriptor.ccdPredictionDistance`** (§31) replaces the WP-5.4
  pinned 1 m speculative-CCD constant per body, proven at the boundary it
  controls (0.001 m tunnels a thin wall at 200 m/s; 10 m catches it);
  contradictory non-speculative use is refused.
- **§34 world-configuration refusal** — `PhysicsSnapshot` gains an optional
  `configuration` record (dimension, resolved gravity, resolved sleeping,
  determinism, solverIterations-if-set); `restoreSnapshot` refuses a mismatch
  field by field. Absent configuration (pre-existing envelopes, §34 replay
  documents) restores exactly as before.

#### Added — documentation

- **The thirteen §93 prose guides** (`docs/guides/`, + index): §93's own list,
  one file per item, every code sample cross-checked against
  `docs/Architecture/package-export-surfaces.json` and the source doc
  comments; staged/unshipped surfaces stated honestly (custom shaders, §40
  units record, workers, lighting). 1,853 lines.

#### Fixed — tooling and docs hygiene

- **TypeDoc: 123 warnings → 0.** Stale links repointed, unexported-symbol
  links backticked, cross-package links qualified for the umbrella
  conversion, declaration-merging comments demoted on the augmenting side
  (`NodeEventMap`, `RigidBodyEventMap`), `@inheritDoc` blocks that carried
  extra paragraphs rewritten as own summaries, `TypeError` mapped to MDN via
  `externalSymbolLinkMappings`, and `physics-rapier`'s transcribed `Rapier*`
  types declared `intentionallyNotExported` in a package-level typedoc.json.
- `eslint` no longer descends into `.claude/worktrees/**` (agent worktrees
  are full second checkouts; linting one from the root produces phantom
  project-service errors).

#### Fixed

- **`blending.spec.ts` RECOVER de-flaked** (1-in-3 hard fail, recorded since
  Phase 11): the sweep clock started _after_ a SwiftShader screenshot that
  could swallow 500+ ms of the 1.5 s sweep, tripping the ≥1 s lower bound. The
  clock now starts before the click that starts the sweep (a strict superset
  of the sweep interval — deterministic), and the collapse wait is a poll
  rather than a fixed pause.
- **All 24 package READMEs** rewritten truthfully (they still said "scaffold
  only"); key exports verified against `docs/Architecture/`; the five
  placeholder packages (box2d, soft, webgpu, canvas, svg) now say "interface
  reserved; not yet implemented". Root README rewritten with the §93
  quick-start, examples table, and dev-commands reference — every identifier
  in the snippet checked against the real API.

### 2026-08-04 (later)

#### Changed — every dependency-graph finding resolved: 0 duplicates, 0 cycles, 0 unused exports

Owner-directed sweep ("resolve all issues the tools report; defer nothing"):
every issue in `docs/Architecture/` is now zero, and the gates hold it there.

- **All 5 baselined TRUE_DUPLICATE names consolidated** —
  `duplicate-baseline.json` re-seeded to empty:
  - `SeededRandom` → `@four/core` (`core/src/random.ts`, the WP-8.2 original
    verbatim; both copies carried this exact hoist as their dated plan).
    `@four/motion` and `@four/particles` re-export it; streams are unchanged
    for every seed. Motion's known-answer tests moved to `core/tests/`;
    particles' independent BigInt-oracle suite stays put and still pins
    stream identity.
  - `JsonValue` + `cloneJsonValue` → `@four/core` (`core/src/json.ts`),
    keeping `@four/serialization`'s `__proto__` refusal — the strengthening
    both files' notes wanted shared. Behavior change in `@four/diagnostics`:
    a recorded payload with a `__proto__` own key is now refused with a
    `TypeError` instead of silently re-parenting the copy (the original
    contradicted its own "never carry a `__proto__` into the player"
    contract at the payload level). New `core/tests/json.test.ts` covers
    every branch; diagnostics/serialization re-export both names.
  - `DEFAULT_GRAVITY_Y` → `@four/core` (`core/src/conventions.ts`, the
    Appendix A normative default); `@four/physics` and `@four/particles`
    re-export.
  - `ColorRGBA` → `@four/math` (`math/src/color.ts`, the value-type home
    below both consumers); `@four/animation` and `@four/materials`
    re-export.
- **Both type-only import cycles broken** (graph now reports 0 of any kind):
  - `scene/authority.ts ⇄ scene/node.ts`: `warnAuthorityConflict` now takes
    a structural `AuthorityNode` (id, name, transformAuthority — the slice it
    reads) instead of importing `Node`; every `Node` satisfies it, callers
    unchanged. `AuthorityNode` is exported from the barrel.
  - `physics/collider.ts ⇄ physics/rigid-body.ts`: `RigidBodyCollisionEvent`
    moved to `collider.ts`, and the three §29 collision keys of
    `RigidBodyEventMap` are merged in from there by declaration merging
    (the `@four/input` → `NodeEventMap` pattern); `rigid-body.ts` keeps the
    two §32 sleep keys and no longer imports `Collider`. The `@four/physics`
    public surface is unchanged.
- **All 21 "potentially unused exports" resolved**: the transcribed Rapier
  type subset in `physics-rapier/src/init.ts` had 21 interfaces exported but
  referenced only in-file — now plain (un-exported) interfaces.
- TypeDoc: 123 warnings vs 125 before the sweep (the merged-interface
  augmentation deliberately carries a plain comment, not a doc comment —
  TypeDoc warns when two declarations of one merged interface are both
  documented).
- Verified green end-to-end: 24/24 build, 2,985 unit tests (core 91,
  incl. the moved RNG pins and the new JSON suite), coverage thresholds
  ≥95% everywhere, lint, check-spec, suites 174, browser 32, size gate
  32.13 kB unchanged, `graph` + `graph:check` + `graph:duplicates` +
  `graph:test` all green.

### 2026-08-04

#### Added — duplicate-symbol gate (`pnpm graph:duplicates`) — CDG/QDG integration complete

The last unwired piece of the vendored dependency-graph toolkit,
`tools/create-dependency-graph/check-duplicates.mjs`, is now a script and a CI
gate. It reads the `duplicate-symbols.json` that `pnpm graph` regenerates
(`--no-regen`, matching the repo's graph-generates/`graph:*`-consumes
convention) and fails on any `TRUE_DUPLICATE` symbol name beyond
`docs/Architecture/duplicate-baseline.json`, so new copy-paste duplicates
cannot accumulate while the accepted backlog shrinks deliberately.

- Baseline seeded with the 5 current TRUE_DUPLICATE names, all pre-recorded
  backlog: `cloneJsonValue` + `JsonValue` (diagnostics/serialization — no
  matrix edge between them), `DEFAULT_GRAVITY_Y` (particles/physics),
  `SeededRandom` (the dated Phase 9 hoist-to-core item), `ColorRGBA`
  (animation/materials).
- Two four.js entries added to `duplicate-allowlist.json` for
  legitimately-independent names that must never be "consolidated":
  per-package `PACKAGE_NAME` (23 packages, the analog of MathTS's per-package
  `VERSION`) and `PARTICLE_INSTANCE_FLOATS` (deliberate duck-typed contract;
  the dependency matrix forbids the particles↔render edge — MEMORY
  2026-08-02, Phase 9). The allowlist is per-repo **data**, exempt from the
  vendored-code byte-identity rule with llm-wiki (noted in `tools/README.md`);
  MathTS's entries stay in place, inert, so code diffs against llm-wiki stay
  clean.
- CI runs `pnpm graph:duplicates` inside the architecture-invariants step,
  right after `pnpm graph`.
- Re-seed after consolidating a name:
  `node tools/create-dependency-graph/gen-duplicate-baseline.mjs`.

### 2026-08-03

#### Fixed — `Lint` was red in CI since bfa0cb9

Two separate causes, both introduced by earlier commits in this same effort and
neither caught because CI was not checked after pushing:

- `tests/integration/examples-build-coverage.test.ts` (added in bfa0cb9) used
  four `!` non-null assertions that `@typescript-eslint/no-unnecessary-type-assertion`
  rejects — the types were already narrowed. Removed; the guard still passes and
  still fails on build/preview drift.
- The vendored `tools/create-dependency-graph/**` and `tools/query-dependency-graph/**`
  are now eslint-ignored. They come from MathTS and are kept byte-identical with
  the copies in llm-wiki, so restyling them here would guarantee the two copies
  drift. They are verified by being run (`pnpm graph`) and by QDG's own unit
  tests (`pnpm graph:test`), not by this repo's lint config.

`pnpm lint` is green again, along with build, test, typecheck:examples,
check-spec, graph, graph:check and graph:test.

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
  - 172 suite + 32 browser tests; 24/24 packages; coverage ≥95% everywhere; §86 at
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
  seek-suppression determinism test, and a 4-test browser animation spec (browser total 15) incl. a standing cluster-isolation invariant.
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
