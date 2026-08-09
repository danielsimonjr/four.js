# Changelog

All notable changes to this repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Once packages
are published, releases will follow [Semantic Versioning](https://semver.org/) per §90 of the
specification; until then, entries are grouped by date under **Unreleased**.

## [Unreleased]

### 2026-08-09 — R-8 closed: §64 per-view render lists, §87 frustum culling, §66 key 4

#### Added

- **§64 per-view render lists and §87 frustum culling (gap `R-8`).** The frame builds
  **one** render list and each viewport now _derives_ its own from it:
  `buildViewRenderList(source, view, out, { frustum })` in `@four/render` applies §46's
  layer mask (§48's `view.layerMask`-else-`camera.layers` fallback) and §87's frustum
  test, keeping the surviving items in order and sharing the frame list's pooled item
  objects, so a view costs one linear scan and no allocation. The substrate is
  `@four/math`'s new **`Frustum`** — the six normalized clip planes of a view-projection
  matrix, extracted for either `DepthRange` convention, with a conservative
  `intersectsSphere` — and `@four/render`'s **`computeWorldBoundingSphere`**, which turns
  §53's cached local box into a world-space sphere by the absolute-value transform (never
  too small, so a cull can never remove something visible). §49's **`frustumCulled`**
  lands on `Renderable`, defaults to `true`, and round-trips through §79. The WebGL 2
  backend derives and culls per view; §69's shadow map is still built from the _frame's_
  list before the view loop, so a caster no camera can see still occludes.
- **§66 sort key 4 (gap `R-10`).** `sortRenderListByDepth(list, viewMatrix)` sorts a
  view's own list by depth — opaque near-to-far, transparent far-to-near — under keys 1
  and 2 and above key 5. A **verb, not a default**, for key 3's reason: under §61's
  `LEQUAL` a depth sort permutes co-planar opaque draws, and co-planar opaque draws are
  what a 2D scene is made of. It could not have been written before `R-8`: one list
  served every view, so a depth measured along one camera would have misordered the rest.
- `benchmarks/view-culling.mjs` + `benchmarks/results/view-culling.json` — not a §86 row;
  the measurement behind `R-8`'s design decision (derive per view against traverse per
  view, at 10 000–100 000 nodes × 1–4 viewports) and the CPU price of the cull itself.
- `tests/browser/culling.spec.ts` (+ `fixtures/culling-page.ts`) — the pixel half: the
  same scene drawn with §49's flag on and off, compared **exactly**. Measured on
  ANGLE/SwiftShader: **0 of 76 800 pixels differ**, 19 draws → 10.

#### Changed

- `@four/render-webgl`'s view loop no longer tests `item.layers` inline; it draws the list
  `buildViewRenderList` derived. Consequence, stated because it is observable: a batch run
  may now span an item the _frame_ list had between its members — a masked-out or culled
  draw no longer ends a run. This is strictly better batching and exactly as correct, since
  the skipped item is not submitted into that view at all. `RenderBatching.next`'s
  `layerMask` becomes optional and the renderer no longer passes one.
- `RenderItem` carries two new snapshots, `frustumCulled` and `viewDepth`. Hand-built item
  literals need both (a `tsc`-only break — Vitest does not typecheck).
- **Bundle:** +0.77 kB gzip in every bundle carrying `WebglRenderer` (§64 lists culling as
  a _stage_, not an option, so the culler is referenced unconditionally). Budgets bumped
  with the same-tree A/B measurements: first-3d-scene 31.5 → 32.5 kB, particles-demo
  29 → 30 kB, ui-demo 37 → 38 kB. `sortRenderListByDepth` tree-shakes out of bundles that
  do not call it.

#### Fixed

- Three integration harnesses were rendering nothing and asserting draw counts for it.
  `new OrthographicCamera({ height: 4, aspect: 1 })` names two fields
  `OrthographicCameraOptions` does not have, so the object was accepted and every property
  ignored, leaving the default unit box `[-1, 1]²`; `render-batching.test.ts`'s camera sat
  at the origin with content at `z = 0`, in front of its own near plane. Culling made all
  three visible by removing the draws. `frame-statistics.test.ts`,
  `renderer-context-loss.test.ts` and `render-batching.test.ts` now use cameras that can
  see their scenes.

### 2026-08-09 — PH-8 and PH-12 closed: §26/§27 force fields for bodies, §8 space modes

#### Added

- **§26/§27 force fields for rigid bodies (`PH-8`).** `@four/physics` gains `ForceField` — §27's
  interface, transcribed — and `ForceFieldSystem`, the engine occupant of §39's step 5 ("force
  generation") at `PRIORITY_FORCES`. It samples every registered field at every dynamic, awake
  body once per fixed step and applies the sum through §26's `applyForce`. Units are declared per
  field and the argument is **required**: `"force"` (newtons, as authored) or `"acceleration"`
  (m/s², multiplied by the body's mass), because §27's own built-in list mixes the two.
  `PhysicsWorld.forEachActiveBody(visit)` is the §22/§32-filtered, registration-ordered (§33)
  iteration it walks, handing over each body's solver-read world-space centre of mass (§25).
  `ParticleForceField` from `@four/particles` is structurally identical, so every built-in field
  there works here with no adapter, no cast and **no new §3.1 dependency edge**;
  `tests/integration/physics-force-fields.test.ts` is where the two declarations are type-checked
  against each other. `world.step` was not edited — fields reach the solver through the same §26
  command buffer user code uses — so every existing determinism golden is untouched by
  construction. New golden `tests/determinism/golden/force-fields.json` (same-runtime tier, real
  Rapier 2D, 300 steps, twelve bodies, four fields).
- **§8 space modes (`PH-12`).** `@four/core` gains the §8 vocabulary — `SpaceMode`,
  `SPACE_MODES`, `DEFAULT_SPACE_MODE`, `isSimulationSpaceMode` — and `@four/physics` gains
  `RigidBody.space` (also `RigidBodyDescriptor.space`), the frame a body is solved in.
  `PhysicsWorld.addBody` now enforces §8's sentence: the four presentation frames are refused
  because "screen-space UI should not automatically participate in physical simulation unless
  explicitly mapped to a simulation plane", and `"local-plane"` is refused separately because
  §21's plane→XY mapping is unbuilt — two messages, because the fixes differ. The default is
  `"world"` and `toDescriptor()` omits it there, so no existing body, descriptor, document or
  solver call changes. The space round-trips through §79 (written only when non-default, read as
  a defaulted field), because dropping it would turn a body every world refuses into one every
  world accepts after a reload.

### 2026-08-09 — R-10 keys 3–4 and R-9 closed at tier: §66 pipeline grouping and §65 batching

#### Added

- **`groupRenderListByPipeline(list)` (`@four/render`)** — §66's **sort key 3**, pipeline
  and material compatibility, as a **second verb** rather than a mode of `buildRenderList`.
  It re-sorts an already-built list with key 3 inserted between keys 2 and 5, stably, so a
  scene already grouped is unchanged and a scene of one pipeline and one material is left
  exactly as it was. `buildRenderList` is untouched, so every existing scene keeps the order
  it has had since 2026-08-06 — byte for byte. The reason key 3 is offered and never imposed
  is recorded in source and is a **correctness** argument, not a byte-identity one: §61 fixes
  the depth comparison at `LEQUAL`, so of two opaque surfaces at one depth the later draw
  wins, and all of this engine's 2D content sits at one depth. Grouping by material would
  therefore _repaint_ a 2D scene — it is what makes a §58 stroke cover its own fill (R-16)
  and a later sibling cover an earlier one.
- **`RenderItem.materialId` (`@four/render`)** — the material half of key 3, snapshotted at
  generation time; `kind` was already the pipeline half. Two fields rather than one
  concatenated key, because `${kind}:${id}` would allocate a string per item per frame.
  `""` for a particle system, which has no material, and for a structural material double
  predating §57's `id` — `undefined < undefined` is false in both directions, which is not a
  total order.
- **§65 batching (`RenderBatcher` in `@four/render`, `createGlBatching()` in
  `@four/render-webgl`)** — **sprite batching and compatible shape batching**: consecutive
  render items sharing a pipeline **and a material instance** merge into one `drawElements`.
  The planner concatenates a run into one interleaved vertex stream (position, then uv iff
  the material samples, then colour iff it declares `vertexColors`) plus one 32-bit index
  stream, baking each item's world transform into its vertices; the backend owns two buffers
  and one vertex array per layout and issues the single draw. A batch draws through the
  **existing unlit program** — no sixth pipeline is compiled and no shader was edited: a
  sprite batch uploads its tint as `color` and carries uv per vertex, and `tint × texel`
  versus `texel × tint` is bit-identical arithmetic.
- **`WebglRenderer.batching`** — the opt-in field, `null` by default (the
  `WebglRenderer.statistics` precedent). With none assigned the backend issues exactly the
  GL sequence it always did: the field is read once per frame and costs one `null`
  comparison per item. Opt-in because nothing reachable from a class method tree-shakes, and
  three of the six size budgets sit within 1 kB of their limit; the type is imported
  `import type`, so a bundle that never calls `createGlBatching` links neither module and
  pays **0 B** (measured both ways).
- **`benchmarks/render-batching.mjs`** and its record — §86's _batched sprites (100 000)_ and
  _simple batched shapes (50 000)_ rows, preparation half. Both rows leave the **feature**
  column of `benchmarks/README.md` for **half**.
- **`tests/browser/batching.spec.ts`** — the pixel half, against ANGLE/SwiftShader: the same
  scene rendered batched and unbatched into one canvas, read back in the same task.
  **0 of 76 800 pixels differ**, 13 draw calls become 3. The spec bundles its own fixture
  with Vite's JS API rather than adding a tenth example site and a tenth preview server.
- **`tests/integration/render-batching.test.ts`** — the three claims that live only in the
  composition: identical GL transcripts with and without a batcher over a scene that has
  nothing to batch, the merged stream equal to the world-space geometry of the draws it
  replaced, and §66 key 3 turning an interleaved scene from four unbatchable draws into two
  batches (the recorded `R-10 → R-9` dependency, demonstrated).

#### Changed

- **§66 key 4 (depth) is deferred on `R-8`, not on "needs a camera".** The note in
  `render-list.ts` now says why the old reason was too weak: this backend builds one list per
  frame and draws it into every view, so a depth key measured along one camera would order
  the others by the wrong number. A key 4 written today would be _wrong_, not merely
  disruptive.
- **`benchmarks/README.md`** — eight scripts; the batched-sprite and batched-shape rows are
  rewritten from "there is no sprite batching" / "there is no shape system to batch" to
  **half** rows, and the summary sentence moves from "five measured … three feature-blocked"
  to "seven measured or partly measured … one feature-blocked (mesh instancing)".

#### Measured

- **The batcher costs the bundles that do not use it +0.17 kB gzip**, all of it the seam (the
  field, the branch in the draw loop, `materialId`) — the batcher itself tree-shakes away.
  first-2d 42.88 → 43.05, first-3d 31.11 → 31.30, particles 28.55 → 28.70, ui-demo
  36.56 → 36.73, motor-twin 937.81 → 937.99 kB; every budget still met, none moved.
- **100 000 atlas sprites become 7 draw calls and 50 000 rectangles become 4** — one per
  65 536 vertices, which is the only thing that splits a run of one material. On the recorded
  (GPU-less, shared) host their _preparation_ costs 78.4 ms and 38.7 ms per frame, so both
  §86 rows remain unmet as whole rows and are now bounded by CPU preparation rather than by
  draw calls; about half of that is `buildRenderList`, which the unbatched frame pays too.

### 2026-08-09 — R-36 closed (helper tier): §44/§47's `lookAt` and orientation helpers

#### Added

- **`Node.lookAt(target, up?)` (`@four/scene`)** — the §44/§47 helper the tree had nowhere
  at all: aiming a camera or a light meant hand-composing quaternions, which the
  `first-3d-scene` packet recorded as the roughest edge of writing a 3D scene. It turns the
  node so its **−Z axis** points at a **world-space** `target`, with +Y as near `up` as the
  aim allows (`up` defaults to world +Y, §7a). It lives on `Node` rather than on `Camera`
  because −Z is _every_ node's forward, not a camera's privilege — the same call aims a
  `DirectionalLight` or a `SpotLight` (§68). Under a parent the local rotation is derived as
  `conjugate(parentWorldRotation) · worldRotation`, so a node on a rotated, translated, or
  uniformly scaled rig aims correctly; a non-uniformly scaled parent inherits
  `Matrix4.decompose`'s documented closest-rotation limitation, and a zero-scaled one
  decomposes to the identity so the aim lands in world terms.
- **`Node.getWorldDirection(out)` (`@four/scene`)** — the inverse: the world-space unit
  vector a node faces. **Hoisted** from `DirectionalLight` and `SpotLight`, which carried two
  byte-identical copies; both are deleted and both classes inherit it unchanged, so the
  `@four/render` structural light contract is untouched and the bundle is one copy lighter.
- **`Quaternion.setFromLookDirection(direction, up)` (`@four/math`)** — the primitive under
  both. Neither argument need be unit and `up` need not be perpendicular; the basis is
  `z = normalize(−direction)`, `x = normalize(up × z)`, `y = z × x`, converted with
  Shepperd's method. Allocation-free (the basis lives in plain scalars) and the change hook
  fires exactly once.
- **`packages/scene/tests/look-at.test.ts` (28 tests)** and
  **`tests/integration/look-at.test.ts` (8 tests)** — the integration suite pins the four
  claims no single package can: the aim survives the §7 → §47 chain (a lookAt'd camera
  projects its target to the centre of clip space), `@four/render`'s `collectSceneLights`
  reads the same axis, the umbrella barrel exposes it, and it is a `"manual"` write a §42
  owner then drives without either side warning.

#### Changed

- **`Matrix4.decompose` and `Quaternion.setFromLookDirection` share one Shepperd
  implementation** (`setQuaternionFromBasis`, module-internal to `quaternion.ts`, not in the
  barrel). The arithmetic and branch order moved verbatim — every `tests/determinism/*`
  golden is unchanged, bit for bit — and `matrix4.ts` coverage rose 98.58% → 100% because the
  look-at tests reach the branch its own suite never did.

#### Decisions

- **Forward is −Z for every node.** Verified against `Matrix4.setPerspective`,
  `Camera.updateViewMatrix` (`inverse(worldMatrix)`), and §68's light axis rather than
  asserted; a test builds the classic gluLookAt view matrix independently and compares all
  sixteen elements, so `lookAt` produces exactly what `updateViewMatrix` inverts.
- **The target is world-space, always.** It is the only contract under which "point the
  camera at the player" is one call and under which the call keeps meaning the same thing
  when the node is reparented onto a moving rig — §44's follow-rig and spring-arm case.
- **Degenerate aims are refused, not repaired (§85).** `Node.lookAt` throws
  `FourError("INVALID_SCENE_GRAPH")` — the code `Node.add` already uses for §85's
  scene-graph rule — when the target coincides with the node's world position or when `up`
  is zero, non-finite, or parallel to the aim (the top-down aim with the default +Y is
  exactly this case, and wants an explicit `up` such as world −Z). Picking a fallback `up`
  would silently rewrite the orientation the caller asked for; leaving the node unturned
  would be indistinguishable from a frozen rig. The **math** primitive, by contrast,
  validates nothing and leaves its quaternion untouched on degenerate input without firing
  the hook — the layer split `Matrix4.setPerspective` already states.
- **`lookAt` neither checks nor warns about §42 authority.** It is an ordinary _manual_
  transform write, identical to `node.rotation.setFromAxisAngle(...)`, and §42's enforcement
  is writer-side by design. Warning would make it the only self-policing write in the engine
  and would fire on aiming a `"physics"`-owned body at its starting pose.
- **§33 tier: `same-runtime`.** Pure quaternion arithmetic from exact inputs — bit-identical
  across repeated calls and bit-idempotent on re-aim (both asserted with `toBe`) — but
  `sqrt` on the path keeps the claim at §33's initial tier.

#### Known / deferred

- **§44/§47's camera rigs are still unshipped** (orbit, fly, first-person, trackball, follow,
  spring arm, shake, path animation, physics attachment). `lookAt` is the primitive they will
  be built on, not a substitute — `R-36`'s rig half and all of `PH-11` remain open.
- **The examples still hand-roll their orientations.** `examples/first-3d-scene/main.ts`
  aims its camera and sun with `setFromAxisAngle`; replacing them derives the quaternion
  through `sqrt` where the current code uses `sin`/`cos`, which could move a pixel golden.
  Deferred to a packet that can run the browser gate.
- **Bundle cost**: +0.50 kB gzip in every bundle that carries `@four/scene` (measured A/B:
  first-3d 30.80 → 31.30 against a 31.5 kB budget; ui-demo 36.23 → 36.73 against 37;
  particles 28.20 → 28.70 against 29). All budgets pass; the headroom left is 0.20–0.30 kB
  and a bump is proposed in `TODO.md`.

### 2026-08-09 — R-16 closed: §58 paints, fills and strokes; §50's family complete

#### Added

- **§58's paint model at its solid tier (`@four/render`)** — `Paint`/`SolidPaint` (linear-light
  RGBA plus §50's separate `opacity`, which multiplies the alpha), `ShapeFill`
  (`"inherit"` | a paint | `"none"`, SVG's vocabulary because §50 asks for SVG compatibility),
  and `StrokeStyle`. `Paint` is a **closed one-member tagged union** so the six staged kinds are
  a compile error rather than an object silently ignored at rebuild time (R-6's `ScreenEffect`
  staging mechanism, second application). Reading `shape.fill` / `shape.stroke` gives a
  **resolved** record (`ResolvedPaint`, `ResolvedShapeFill`, `ResolvedStrokeStyle`) — every
  optional filled in, validated and copied, so an in-place edit of the object you passed cannot
  desynchronise the geometry from the style that built it.
- **§52 stroke expansion (`@four/geometry`, `tessellation.ts`)** — `expandStroke` widens
  polylines into §58's band: `inside`/`center`/`outside` alignment, butt/round/square caps,
  miter/round/bevel joins with a miter limit that falls back to a bevel, and dashes with a phase
  offset walked by arc length. §52 puts stroke expansion in that module _by name_, beside the
  fill tessellator, and that is where it went. `Path.polylines(tolerance)` is the flattening it
  takes — `flatten()` plus the one bit a `Point2D[]` cannot carry.
- **§50's last three primitives** — `Line`, `Polyline` and the open `Arc`, whose absence `R-23`
  recorded as deliberate ("a stroke without a join rule is _wrong_ at every corner"). Their
  `stroke` is **required** and their `fill` defaults to `"none"`; the family now covers **all
  fourteen** §50 rows with twelve classes.
- **§79 pairs, additive in both directions** — `render:line`, `render:polyline`, `render:arc`,
  plus `fill`/`stroke` on every shape document. Both fields are written **only when they differ
  from the class's own default**, so a shape naming no paint writes the byte-identical document
  `R-23` wrote, and a pre-`R-16` document restores a fill-only shape with nothing missing.
- **`tests/determinism/stroke.test.ts` + `golden/stroke.json`** — §52's **second** golden,
  labelled `same-runtime` beside the fill tessellator's `cross-platform` one.

#### Decided, and the alternative is recorded

- **A fill and a stroke are two colours in one draw, carried as per-vertex colour.** The §57
  pipelines already multiply `vertexColors` into the material's colour (`R-19`), so a stroked,
  painted shape adds **no render-item kind, no backend pipeline and no frame-path edit** —
  `R-23`'s property, kept, and `render-webgl` was never opened. A material that cannot multiply
  vertex colours is refused (§85) naming `vertexColors: true`, because the alternative is a
  stroke that vanishes into the fill.
- **Gradients are staged, not approximated.** Per-vertex colour is exact for a solid and for a
  two-stop _linear_ gradient and for nothing else §58 lists: a three-stop linear gradient needs
  vertices on its stop lines, and radial and conic are not affine at all. The exact tier is a
  paint pipeline, measured at **~1.9 kB gzip in every bundle carrying `WebglRenderer`** whether
  or not the app draws one, plus a `RenderItemKind` arm `RFC 0001` and `RFC 0003` are both
  queued to own.
- **`ShapeMaterial` stays unshipped** — the answer is unchanged by §58's arrival rather than
  unexamined: the paints live on the _node_, where §50's own example puts them, and a stroke's
  width and joins are geometry rather than shading.
- **The stroke's triangles come last in the index buffer**, which is load-bearing: §61 fixes the
  depth comparison at `LEQUAL`, so equal depths let the later draw through and a stroke paints
  over its fill.

#### Measured

- **Byte-identical for every scene that names no paint** — a full GL transcript plus the
  `positions`/`uvs`/`colors`/`indices` of all nine `R-23` shapes, recorded on the reverted build
  and on this one: identical (md5 `c957ce62…`). Five of six example bundles are hash-identical;
  `motor-digital-twin` is **+3.62 kB gzip** (937.36/1000), paid only by the bundle that calls
  `registerSceneNodeTypes()`.
- **The overlap is documented, not removed.** Joins and caps are drawn on a corner's outer side
  only; the inner side is covered twice by the two quads. Invisible under an opaque paint,
  double-blended under a translucent one, and `alignment: "outside"` on a convex outline avoids
  it entirely. The exact answer is the same planar-subdivision pass §52's self-intersection row
  waits on.
- **A lone point strokes to nothing.** `Path.flatten` says explicitly it is not the operation
  that decides whether a stray `moveTo` is a dot; this is that operation deciding — a dot is a
  `Circle`, and inventing one would make every stray `moveTo` in an imported document sprout a
  blob.

### 2026-08-09 — A-18's abort half and A-9's `pointerType` closed

#### Added

- **§76 cancellation (A-18)** — `assets.load(url, loader, { signal })` takes any
  `AbortSignalLike` (the DOM's `AbortSignal` satisfies it structurally). Three rules, each
  with the test that would fail without it: (1) **an aborted load never holds a reference** —
  a signal that already fired is refused before the cache is consulted, one that fires later
  hands its reference back, so an aborted load must not be released, exactly like a failed
  one; (2) **one waiter's abort is not the others'** — aborting decrements, and the request is
  abandoned only when the last waiter goes, so a coalesced load still delivers to whoever
  stayed; (3) **`release` is not `abort`** — releasing the last reference to a pending load
  still lets it settle, because rejecting a promise the caller is still holding turns an
  orderly teardown into an unhandled rejection in application code. Cancellation rejects with
  `ASSET_LOAD_FAILED` and `context.reason === "aborted"` (§89 has no cancellation code, and a
  discriminating context says it without widening the engine's error vocabulary).
- **Transport-level abort (A-18)** — `AssetManagerOptions.abortController: () => new
AbortController()`, reported by `AssetManager.canAbortTransport`. **Presence is the
  capability**: without it the promise semantics are identical and the socket drains; with it
  the last waiter's abort cancels the request, and so does a load that outruns
  `timeoutSeconds` — the §96 deadline no longer leaves a request running.
- **`pointerType` on every pointer event (A-9 remainder)** — `PointerDeviceType`
  (`"mouse" | "pen" | "touch"`) on `ScenePointerEvent`, fed from
  `SurfacePointerEvent.pointerType` and carried onto synthesized events (`click`, enter,
  leave) too.

#### Fixed

- **A mouse no longer loses its hover when it clicks (A-9).** The A-9 teardown ended hover for
  every device, so a `@four/ui` widget dropped its hover highlight the instant it was clicked
  and regained it on the next move. A release now forgets the pointer _unless_ the device
  outlives its own gesture and has a hover worth keeping — in practice a mouse over a node.
  `pointercancel` still ends every pointer (the platform said it is gone; second-guessing that
  with device knowledge would be a guess), pen is not treated as persistent, and a source that
  reports no device keeps its pre-2026-08-09 behaviour exactly.

#### Measured, and it decided the design

- **The generic `FetchLike<TSignal>` seam works** — `typeof fetch` is assignable to
  `FetchLike<AbortSignal>`, so `{ fetch, abortController }` still needs no adapter and
  `@four/assets` still names no DOM type. The 2026-08-07 finding it replaces (a _concrete_
  `AbortSignalLike` parameter makes the platform `fetch` stop satisfying the seam) is kept in
  source.
- **`TSignal` must not reach the instance type.** With `#fetch: FetchLike<TSignal>`,
  `AssetManager<AbortSignal>` is **not** assignable to `AssetManager` — which would have
  broken `new Application({ assets })` for exactly the managers that gained the capability.
  The seam is therefore erased at the constructor; every instantiation stays mutually
  assignable, asserted in `tests/integration/asset-abort.test.ts`.
- **`SurfacePointerEvent.pointerType` is typed `string`, not the union.** `lib.dom` declares
  `PointerEvent.pointerType: string`, so narrowing the seam makes a real `PointerEvent` stop
  satisfying it. The narrowing happens once inside `@four/input`, and a vendor value or `""`
  becomes an **absent** `pointerType` rather than a refusal: §85's refuse-don't-clamp governs
  configuration the application got wrong, not hardware telemetry arriving mid-gesture, where
  a throw would break input on a device newer than the union.

#### Unchanged, proven

- **No §83 regression from the retained mouse entry**: it exists only to hold a live hover, a
  mouse over nothing is forgotten like any other pointer, and a mouse's `pointerId` is stable —
  10 000 mouse clicks leave `trackedPointerCount` at 1, and A-9's original 10 000-gesture
  touch/cancel test is untouched at 0.
- Coverage stays 100/100/100/100 on both `@four/assets` (77 tests) and `@four/input` (133).
  Bundle: `@four/assets` is in no example bundle; `@four/input` +111 B gzip A/B-measured in
  isolation, `ui-demo` at 36.06/37 kB.

### 2026-08-09 — R-23 closed (solid-fill tier): §50 native 2D shape nodes

#### Added

- **§50's shape family (R-23)** — `Shape2D` plus nine concrete nodes in `@four/render`,
  beside `Renderable` and `Sprite`: `Circle`, `Ellipse`, `Rectangle` (square-cornered or
  rounded — §50's own example passes `radius` to `Rectangle`, so §49's
  `RoundedRectangle` is that class), `RegularPolygon`, `Polygon`, `Star`, `Sector`,
  `Ring`, and `PathShape` (§50's "path" and "Bézier path" alike). **Eleven of §50's
  fourteen primitives ship**, filled in one solid colour, entirely on the R-24/R-25
  substrate: `toPath()` → `Path.fillRings` → `triangulatePolygon`.
- **`Shape2D.toPath()`** — the family's one polymorphic operation, a fresh §51 `Path`
  per call: the seam §50's SVG import/export (`R-26`), §51's booleans, and `A-11`'s
  analytic picking all need, and the reason a consumer of a shape never has to learn
  which shape it is holding.
- **§79 pairs for all nine** (`render:circle` … `render:path`), through a new
  `registerShapeSerializers` split out on the `registerPhysicsSerializers` precedent and
  composed into `registerSceneNodeTypes`. No geometry key — a shape derives and owns its
  fill (§83). A field the class defaults restores its default when corrupt; a parameter
  that _is_ the shape is refused loudly rather than invented. Paths replay through §51's
  builder, which is where the well-formedness invariant lives.

#### Deliberately not shipped, with arguments in source

- **No stroke, and therefore no `Line`, `Polyline`, or open `Arc` node.** §58's paint
  model is `R-16`; §52 puts stroke expansion in `@four/geometry`'s tessellation module by
  name; and a stroke without a join rule is wrong at every corner, not merely plain. A
  node that draws nothing while claiming to draw something is worse than a missing one.
- **No `ShapeMaterial`.** Without §58's paints it is `UnlitMaterial` renamed, and it costs
  either a new `RenderItemKind` arm (a closed union RFC 0001 and RFC 0003 are both queued
  to widen) plus a compiled-at-init pipeline measured at 0.75–1.9 kB gzip in every bundle
  carrying `WebglRenderer`, or a discriminant that lies. Shapes carry a `SurfaceMaterial`
  and draw through the flat-colour pipeline that already existed.

#### Fixed / found

- **`rotation` is not available as a shape parameter** — §6's `Node` publishes it as the
  live alias of its transform quaternion (§15/§97), so an `Ellipse.rotation` shadows the
  node's orientation. `tsc` refuses it; vitest would not have. The family's name is
  `startAngle` throughout: where the outline begins, measured from +X.

#### Unchanged, proven

- **No backend edit, no render-item kind, no frame-path change.** A scene of shapes emits
  the _identical_ GL call sequence as a scene of plain `Renderable`s holding the same
  geometry, asserted call for call in `tests/integration/shape-rendering.test.ts`. Five of
  six example bundles are hash-identical; only `motor-digital-twin` (the one example that
  registers §79 node types) grows, +10.46 kB gzip to 933.34/1000 kB. Goldens unmoved;
  59/59 browser gate.

### 2026-08-09 — R-26 closed (path-data tier): §50 SVG import/export

#### Added

- **§50 SVG path data (R-26)** — `parseSvgPathData(d, options?)` reads an SVG `d`
  attribute into a §51 `Path`, `formatSvgPathData(path)` writes one back out, both in
  `@four/geometry` (§98's placement: the `d` attribute is the serialized form of the
  path model, so it lives beside the model — `render-svg` is a backend, `@four/assets`
  owns SVG as a file). **Grammar coverage is complete**: all ten commands in both cases,
  implicit argument-set repetition, the implicit lineto after a moveto, optional
  separators (`1-2` is two numbers), the greedy scan that reads `1.5.5` as two, and arc
  flags that abut what follows (`a1 1 0 011 1`). `B`/`b` (bearing, an SVG 2 draft removed
  before CR) is refused. **No `fromCommands`** was needed or added — export reads
  `Path.commands` and a cursor; the R-24 decision stands.
- **Coordinates are transcribed, not flipped** — SVG's Y-down user space is not
  reconciled with §7a's Y-up world by the parser, because the transform that would do it
  (`y ↦ height − y`) needs the document's `viewBox`, which is not in the `d` attribute. A
  bare flip would be _half_ a transform performed silently. The correction is one exact
  `Path.transform` at the caller (a reflection is a similarity, so arcs survive it), and
  the document tier will apply it because it is the tier that knows `height`.
- **A format conformance rule is not an §85 clamp** — SVG 1.1 F.6.6 defines what a
  conforming reader does with an out-of-range arc radius, so those rules are honoured
  (negative radii → abs, zero radius → line, coincident endpoints → omitted, radii too
  small → uniform `√Λ` scale-up) while malformed input is refused with a `SyntaxError`
  naming the offset. Unlike an SVG viewer, nothing parsed before an error is kept.
- **§96 hardening, checked rather than asserted** — no regular expressions anywhere (a
  single forward character-code scan: O(n) on _every_ input, so no catastrophic
  backtracking), one finite `maximumTextLength` bound (4 Mi code units, `FourError`
  `UNTRUSTED_INPUT_REJECTED` with `limitName`/`limit`/`observed`), and totality proved by
  30 000 fuzzed strings plus five ReDoS shapes.
- **Second two-tier §33 golden** (`tests/determinism/golden/svg-path.json`) — `text`
  claims cross-platform because ECMA-262 specifies decimal→double and `Number::toString`
  _exactly_, proved mechanically (all 2 408 parsed coordinates are dyadic rationals, and
  every case's text is a byte-for-byte fixed point of parse→format→parse); `arc` claims
  same-runtime. The stated edge is ECMA-262's: a literal with more than 20 significant
  digits may legally round two ways.
- **`tests/integration/svg-path-pipeline.test.ts`** — the §50 → §51 → §52 claim proved
  across packages against analytic areas: rectangle, rounded rectangle, circle, washer
  and a smooth-shorthand blob all parse, group by fill rule, and tessellate.

#### Fixed

- **An arc's start is authoritative over the segment that reaches it.** SVG's `A` begins
  at the current point by definition; §51's arc begins where its centre form lands, and
  no centre makes that hit an arbitrary point exactly (measured: ~83% over 200 000 random
  arcs, because `(a − b) + b` is not an identity in binary floating point). The two ulps
  of disagreement became §51's implicit connecting segment, pointing _back_ along the line
  that just arrived — a zero-area spike §52 correctly refuses, which made the rounded
  rectangle (`L … A …`, four times) unfillable. The reader now holds each line, quadratic
  and cubic back by one command and retargets its endpoint onto a following arc's computed
  start. It is the only coordinate in this module that is not exactly what the document
  said, and it is documented as such. Residual, stated: arc → arc seams still carry the
  implicit segment; they are tangentially continuous and have produced no refusal.

#### Changed

- `packages/geometry/src/path.ts` exports `arcPoint`, `advance`, `newCursor` and
  `PathCursor` **package-internally** (not through the barrel) so the SVG writer shares
  one implementation of "where does a command start" and "a `close` leaves you at the
  subpath's first point". No behaviour change; `golden/path.json` is unmoved.
- `packages/geometry/README.md` corrected in place, dated: it still said the path model
  and tessellation were "staged / not yet implemented" after R-24 and R-25 shipped.

### 2026-08-09 — R-18 closed (directional shadow-map tier): §69 shadows

#### Added

- **§69 directional shadow maps (R-18)** — `DirectionalLight.castShadow` + a validated
  `DirectionalLightShadow` settings object (`mapSize`, `bias`, `normalBias`, `extent`,
  `near`, `far`; refuse-don't-clamp, F14 accessors), §49's `castShadow`/`receiveShadow`
  on `Renderable` (both default `true` — the asymmetry with the light's `false` is the
  point: switching a _light_ on buys a whole pass, switching a _node_ off is an
  exclusion), a seventh depth-only `ShadowProgram`, and a 3×3 PCF comparison in both
  shaded pipelines through one shared `SHADOW_GLSL` chunk. **Two of §69's ten features
  ship**, plus configurable resolution and both bias controls; cascades, point/spot
  shadows, the atlas, transparent masks and contact shadows are staged with named owners
  in `DirectionalLightShadow`.
- **R-4's samplable-depth residue closed** — `RenderTargetOptions.depthTexture` swaps the
  `DEPTH_COMPONENT16` renderbuffer for a `DEPTH_COMPONENT24` texture;
  `{ depth: false, depthTexture: true }` refused (§85); `byteLength` accounts 4 B/texel
  for it. Material-slot sampling of a depth attachment stays staged (needs an attachment
  discriminant + a non-filterable sampler policy).
- **The shadow pass is backend-internal, not a §63 graph pass** — §63's diagram lists
  shadow passes as a renderer stage, and the pass has no camera, viewport or
  application-named target. R-5's transcript-identity property is untouched.
- **Byte-identical for scenes whose light does not cast** — `FRAME_BEFORE_R18` recorded
  on the reverted build at `dab68c9`, and byte-identical to R-17's independently recorded
  transcript; 59/59 browser gate with goldens unmoved.

#### Fixed

- **F13 envelope widened (R-18):** the frame's `finally` unbound its framebuffer only for
  off-screen frames. §69's caster pass binds one on the on-screen path too, so a
  mid-frame throw could have left every later frame rendering into the shadow map. The
  condition is now a flag; two tests pin it.

#### Changed

- §79: `scene:directional-light` gains `castShadow` + a `shadow` record;
  `render:renderable` and `render:sprite` gain both §49 flags. Additive — a document
  written before this build carries none of the keys and restores not-casting with the
  documented defaults. A corrupted shadow value restores that field's default rather than
  failing the scene (`near`/`far` admitted as a pair, since their check is a relation).
- **Bundle:** +2.42 / +1.96 / +1.82 kB gzip (first-3d / particles / ui-demo), A/B
  measured — ~1.9 kB of it is the seventh compiled-at-init pipeline in every bundle
  carrying `WebglRenderer` (R-6's law at scale). Budgets bumped 29 → 31.5 kB,
  27 → 29 kB, 35 → 37 kB with the measurements.

### 2026-08-09 — R-24 closed (model + flatten tier): the §51 path model

#### Added

- **§51 `Path` in `@four/geometry` (R-24)** — §98's own placement ("path model,
  tessellation module"). Six segment kinds as a readable command list behind a fluent
  builder (spec's names — `cubicCurveTo`, not Canvas's; **no `fromCommands`**: the
  builder _is_ the well-formedness invariant, so every reader below can assume it).
  **13 of 17 §51 operations ship**: flatten (adaptive), subdivide (exact de Casteljau/
  angle halving), simplify, reverse, transform (a non-similarity matrix on an
  arc-bearing path is **refused**, not silently squashed), length, arc-length
  `pointAt`/`tangentAt`/`normalAt` (what text-along-path needs), `closestPoint`, and
  both fill rules via `fillRings`. Staged with named owners: offset path → R-16 (an
  offset at a concave corner _is_ §58's join rule — building it first invents that
  rule twice); the four booleans → the planar-subdivision packet §52 also needs, built
  once together. Arcs canonicalize to a **signed sweep** rather than the raw end angle
  — reverse/subdivide/transform become one line each.
- **The first §33 golden pinning two tiers at once**, because §51 has two kinds of
  segment and only one can be exact: Béziers **cross-platform** (de Casteljau at t=½ is
  exact halving — and the claim is _asserted mechanically_: integer control points +
  power-of-two tolerances make every emitted coordinate a dyadic rational, checked as
  `x·2²⁴ ∈ ℤ` for all 25 330 of them), arcs **same-runtime** (a point on an arc _is_
  sin/cos, and the sample _count_ comes from `acos`+`ceil`). Two `_tier` strings, two
  digests — merging them would let a transcendental slipped into the Bézier path hide
  inside the arc half's weaker claim.
- **The flatten → tessellate handoff proven against analytic areas** (no magic
  epsilons — the bound is the flattening's own `tolerance × length`): every fillable
  §50 shape fills across the package boundary, including a three-ring letter "e" —
  `fillRings`' grouping is what makes an **island** expressible (its own region, not a
  hole-in-a-hole §52 refuses). Three real bugs found by the oracles, not by reading:
  an inverted winding sign, a full-turn arc missing its own start by an ulp, an open
  subpath double-counting its closing edge. **R-23 is unblocked for all 14 §50 shape
  fills; R-26 has a model to import SVG into; §119's chart workaround becomes
  retirable when R-23 lands.** Bundle cost: **zero bytes, A/B byte-identical**
  (`Matrix3` is a type-only import). Graph artifacts regenerated.

### 2026-08-09 — R-25 closed (polygon tier): §52 tessellation; the 2D vector stack begins

#### Added

- **§52 polygon tessellation (`packages/geometry/src/tessellation.ts`, R-25)** — the
  load-bearing prerequisite of the entire 2D vector stack: `triangulatePolygon(outline,
holes?)` (ear clipping with bridged holes, O(n²), no dependencies, nothing vendored),
  the `PolygonTessellator` replaceability seam §52 demands, `earClippingTessellator`,
  and `polygonGeometry2D` (§50's "arbitrary polygon" as a standard `BufferGeometry`).
  **The deciding argument for ear clipping over monotone decomposition is determinism,
  not simplicity** — sweep-line equal-y tie-breaking is exactly where a determinism
  claim quietly stops being true; the seam makes the upgrade one export.
- **The repo's first cross-platform-tier §33 claim**: only exactly-rounded IEEE ops
  (`+ - * /`), squared distances, cross-product signs, integer tie-breaks — no
  `atan2`/`sqrt`/`hypot` anywhere (the classic angle-sort tricks are precisely how a
  tessellator acquires a platform dependency). Pinned by
  `tests/determinism/tessellation.test.ts` + `golden/tessellation.json` (8 hand shapes
  - 200 seeded integer-grid stars, refusals recorded too, fresh-process matched). Any
    future edit introducing a transcendental there breaks a committed golden's _stated
    tier_, not just its numbers.
- **Simplicity is proved, not assumed**: ear clipping fed a pentagram succeeds
  _wrongly_ (silently overlapping triangles), so the module proves the input simple
  before clipping and refuses with both rings named (§85). The honest measured limit
  is in-source: 60 000 adversarial fuzz cases against an area/winding oracle —
  hole-free and single-hole inputs **never failed** (26 641 cases); ~2/1000 multi-hole
  configurations are refused, **nothing was ever wrong**. Two real bugs the fuzz found
  (bridge-seam self-veto, stacked bridges) are fixed — found by fuzzing against an
  oracle, not by reasoning, because bridged rings are only weakly simple and the
  two-ears theorem does not apply.
- **`extrudeGeometry` no longer refuses concave capped outlines** — caps are
  tessellated with one index list serving both ends (§52's index-buffer reuse), the
  centroid vertex is gone (`2(n+1) → 2n`), and the superseded refusal is quoted in
  place. Self-intersecting/zero-area outlines still refused pending §52's fill-rule
  tier. Staged with dated notes naming their owners: stroke expansion + AA fringe →
  R-16; adaptive subdivision + incremental rebuild → R-24; extrusion holes → the §50
  shape-node question. **R-24's fill half now has no blocker; R-23 can build fill
  geometry for all 14 §50 shapes via `polygonGeometry2D`.** Graph artifacts
  regenerated (four new exports).

### 2026-08-09 — R-17 closed (eight-lamp forward tier): §68 multi-light

#### Added

- **`PointLight` and `SpotLight` (R-17, §68)** — two new `@four/scene` nodes over a
  shared `PunctualLight` base, collected by the existing `collectSceneLights` walk into
  a bounded uniform-array light set (`MAX_PUNCTUAL_LIGHTS = 8` — a TS constant
  interpolated into the GLSL so the two cannot disagree; a runtime `maxLights` would
  mean recompiling inside a frame, which §61 forbids; 8 fits the GLES 3.0 _guaranteed_
  uniform minimum with no capability query). Attenuation is `KHR_lights_punctual`'s
  inverse-square with an optional range window (a **culling aid, not physics** —
  `range: 0` = unbounded, the honest default); spot cones are glTF's inner/outer
  half-angles in radians, precomputed CPU-side where the division lives (R-13's
  placement rule). **The R-13 irradiance-over-π convention extends to distance**:
  `color × intensity` is the irradiance at unit distance, so a point and a directional
  light of equal intensity agree at 1 m and one scene mixes them — both shaded
  pipelines consume the set through one shared GLSL chunk (~400 B instead of ~700).
  Past the bound the **first eight in scene-graph order** win — authored order, never
  nearest/brightest (both flicker, §33) — with a once-per-root warning (122 B,
  measured). §79 pairs: `scene:point-light`, `scene:spot-light`.
- **Byte-identity, with a new pixel half to the technique** (fourth confirmation of
  the GL half): a directional-only scene issues byte-for-byte its old sequence
  (`FRAME_BEFORE_R17`, **recorded on the reverted build** — a hand-copied transcript
  was wrong in four plausible-looking places, now a recorded rule) — and the pixel
  half requires the new term _added to_ the old expression in source order:
  re-association (`viewProjection * (model * p)`) moves pixels. Deliberately not
  widened: **still exactly one directional light** — a second sun needs a third entry
  kind, which is the clustered/forward-plus path's job. Hemisphere staged (a
  two-colour ambient term, not a punctual light); area lights staged (LTC). R-18
  shadows now needs only R-4's samplable-depth residue.

#### Changed

- **Size budgets: first-3d-scene 28 → 29 kB, particles-demo 25 → 27 kB, ui-demo
  33 → 35 kB** (measured A/B: the light set costs +1.10–1.17 kB gzip per shaded
  bundle; the two tightest budgets had 50 B and 20 B of headroom before the packet, so
  any bundle-touching change was going to overflow them — the bumps restore working
  headroom per the R-13 precedent; §86's 150 kB untouched).

### 2026-08-09 — RFC 0004 drafted: 2D raster painting stack (owner-requested)

#### Documentation

- **`docs/rfcs/0004-raster-painting-stack.md`** — proposes **§77a**: a structural,
  DOM-free `RasterSource` seam (`paint()` takes **no parameter**, deliberately — a
  parameter would be either an engine rasterizer duplicating the R-16/R-24/R-25 stack
  or a named DOM type, both refused) and a `CanvasTexture` satisfying the existing
  `MaterialTexture` contract — **no backend change, no new duck-typed contract, no
  closed union widened** (R-4's seam decision paying off a second time). A
  `CanvasViewWidget` for §73 that needs no drawing API in `@four/ui` and no new skin
  hook — **the recorded §73 blocker is wrong, and the RFC corrects it**: `ImageWidget`
  already established the widget-owns-identity/skin-owns-texture split, and a repaint
  request is content with no layout transition, exactly what A-12's `onContentChange`
  exists for. §33 rule transposed verbatim from §40: painted pixels are display
  content, never simulation input, enforced in the `units-display.test.ts` pattern —
  with the honest limit stated (a reachability rule, not a readability one).
  Constant-size by refusal (the cheap answer to R-29's frame hazard; resize gates on
  R-30, which this RFC makes load-bearing for the first time rather than claiming it
  falls out). §62's Canvas 2D backend delineated as a different concern that stays a
  stub. Alternatives A–F with "do nothing" argued at full strength — and its honest
  consequence named: a "no" means _withdrawing the canvas view from §73 by amendment_,
  because its blocker is wrong either way. **Owner decision pending** — first question
  is whether raster painting is in the product's scope at all (the spec chose retained
  mode; the RFC exists because the owner asked). Register rows 15–17 added to v1 §5.

### 2026-08-08 — Specification revision 1.8: the consolidated amendment pass

#### Documentation

- **Spec revision 1.8** (`docs/SPECIFICATION.md`, one amendments-table row, frozen
  §1–120 numbering untouched, no new lettered sections). **Reversed four statements
  shipping had made false**: §18 + §97a's "`AnimationController` is not implemented"
  (replaced with a compiling shipped-form snippet, the pose-evaluator rationale, and a
  per-feature shipped/scheduled split of §18's nine); §20 + §97a's deferred
  `solver: "auto"`/`renderer: "auto"` (rewritten with the registry semantics —
  including why registration is never an import side effect); §97a's `StandardMaterial`
  row; §97's "a world is built and tracked, not an app option". **Corrected two
  never-implementable statements**: §54's `morphTargetWeights` placement (→ a §6a
  `MorphWeights` scene component with the declared field kept as an accessor — the
  frozen dependency matrix made the original placement impossible) and §17's two
  "missing track types" (binding forms over existing value kinds, not new
  discriminants). **Added**: `LitMaterial` to §57's family (the 2026-08-04 revisit
  note discharged); a _provisionally withdrawn_ marker on §57's `ShaderMaterial` row
  carrying RFC 0001's draft status inline (acceptance makes it permanent, rejection
  restores the row — deliberately not settled while the RFC is a draft); §61's
  deferred-by-decision note on `createTexture`/`createRenderTarget`.
- **Triaged out, with the rule that emerged recorded in MEMORY**: §100, §65, and §55
  are _requirements lists_, never status claims — a spec section is not stale merely
  because its requirement is unbuilt; only implementation-status statements are
  amendment targets. §111's namespace note was already fixed by revision 1.7 (the TODO
  entry was the stale artifact). Code-side follow-up recorded:
  `packages/animation/src/track.ts:40-45` still promises the opposite of §17's new
  text — corrected in the RFC 0003 packet or as a chore.

### 2026-08-08 — R-29 (frame half): §55 sprite frame sub-rectangles

#### Added

- **§55 sprite `frame` sub-rectangles (R-29).** `Sprite.frame`/`setFrame()`/
  `SpriteOptions.frame` select a texture region in **texels, bottom-left origin**
  (forced, not chosen: `MaterialTexture.data` documents row 0 as `v = 0`, §7a puts +Y
  up — and normalized units would make §85's containment check vacuous);
  `SpriteRenderItem.frame` carries it; the WebGL 2 backend resolves it **into the
  existing `quad` uniform**. Many sprites now share one atlas texture, one material,
  one upload — proven end to end: four glyph cells go from 4 `createTexture` +
  4 `texImage2D` to 1 + 1, with identical uv rectangles. §85 refuses out-of-bounds
  frames (validated before the first write; one named hole dated in place — a later
  texture swap is unchecked and samples clamp-to-edge, wanting R-30's §77 change
  notification). A frame write re-uploads nothing — the property §55's animation
  clips and §86's glyph batching need.
- **The 2026-08-07 mechanism prediction is retracted in place, with the derivation
  that disproves it**: a frame is an affine _reparametrization_ of the derived-uv map
  (`quad.zw = w·tw/fw`, `quad.xy = minX − fx·w/fw`), so the unchanged shader samples
  the sub-rectangle exactly — no uv attribute, no new uniform, no new GL call, and
  frameless sprites are byte-identical **by code path** (tenth recorded-sequence run;
  the R-13-era pinned transcript containing a sprite still asserts verbatim). A real
  uv stream remains §65 batching's answer, recorded there. Staged with dated notes:
  the named-frame atlas object (a §77 metadata container for `@four/assets`) and
  sprite animation clips (§14/§17 step tracks — a private timeline inside `Sprite`
  would be a second animation system). §55 now 5 of 11.
- **Diagnostics cost bytes, measured**: five per-component §85 messages were +330 B
  gzip — more than the rest of the feature; collapsed to two whole-value messages.
  ui-demo at 32.98/33 kB (**20 B headroom — effectively exhausted**; flagged). The
  four examples' `cutGlyphCell` workaround and `packages/text`'s one-texture-per-cell
  advisory are now retirable (recorded, not touched). Serializer follow-up recorded:
  `Sprite` documents don't yet carry `frame`.

### 2026-08-08 — A-24 closed: §61's context-loss contract has its suite

#### Tests

- **A-24 — three tiers, 17 tests, no product change needed.** Unit
  (`webgl-renderer.test.ts`, 9): the frame after a restore equals the frame before the
  loss **call for call** (handles normalized to first-appearance); **not one GPU
  handle from before the loss is ever touched again** — programs, shaders, buffers,
  VAOs, textures, framebuffers, renderbuffers, uniform locations, asserted disjoint
  across a full post-restore workload _and_ across a second loss/restore cycle;
  pipelines rebuild eagerly, resources lazily (restore alone: 6 `createProgram`, zero
  resource creations); a texture edited and a target resized _while lost_ come back at
  their new version/size; the F13 envelope closes on a loss delivered mid-frame (from
  inside a material accessor); the §70 effect pipeline survives; dispose-while-lost
  issues zero GL calls. Integration (`renderer-context-loss.test.ts`, 7): an
  `Application` steps to **bit-identical §12 positions** across four contextless
  frames with zero GL calls (loss is invisible above the renderer); the
  `NullRenderer.events` seam finally does the job it was built for; `app.stats` counts
  no draw for a skipped frame; a `RenderGraph` target re-allocates at its post-loss
  size. Browser (`context-loss.spec.ts`, real ANGLE context via `WEBGL_lose_context`):
  the restore arrives **only because the backend calls `preventDefault()`** — the one
  clause a double can only inspect — with an empty error log while the context is
  gone. **The loss path was correct before it was tested** — A-24 was a behavioural
  gap, not a coverage one (the path was already at 100% lines; the four remaining
  uncovered statements are invariant guards unreachable through the public API — do
  not chase them). One §83 corner recorded for the owner: `dispose()` after a
  _failed_ restore leaks the rebuilt programs; the obvious fix would break the tested
  "not one GL call while lost" property, so it is deliberately unmade.

### 2026-08-08 — R-38 closed: §46 symbolic layers

#### Added

- **§46's layer registry (`packages/scene/src/layers.ts`)** — named layers compiled to
  a 32-bit `LayerMask` ("compile to efficient masks internally … preserving
  human-readable names"): `defineLayer`/`layerMask`/`layerMaskNames`/`layerNames`/
  `layersMatch`/`applyLayers`/`resetLayers`, with `Node.layers` (default the
  `"default"` layer), §47's `Camera.layers` (default `ALL_LAYERS` — discharging the
  `TODO(§46/§47)` `camera.ts` carried since WP-3.1), and §48's `Viewport.layerMask`.
  `@four/render` filters during §64 stage-2 traversal (`buildRenderList(root, out,
layerMask?)` + the interpolated form), snapshots each node's mask onto
  `RenderItem.layers`, and resolves §48's fallback once in `viewLayerMask(view)`;
  `@four/render-webgl` skips a filtered item per view before touching a GPU resource —
  **one camera can feed two viewports with no overdraw** (proved: 7 drawables × 2
  disjoint views = 7 draws, not 14). Scene files carry **names, never bits** —
  round-trip is `layerNames()` out, `resetLayers()` + replay in saved order back.
- **Decision — layers do not inherit.** A node's mask gates that node only (a layer is
  _identity, not state_; subtree gating is strictly less expressive, and changing a
  layer can never make something _else_ disappear — §46's editor-only surprise);
  `applyLayers` is the subtree spelling, as Three.js and Unity spell it. Consequence:
  a masked list is a **subsequence** of the unmasked one, never a permutation
  (asserted), and traversal is unchanged. `Camera.layers` overrides `Node.layers`
  (nothing ever reads a camera's membership); the registry is module-level, not
  per-`Scene` (nodes exist, move, and deserialize before their scene is assembled).
- **Byte-identity, ninth run**: a six-pipeline scene emits the identical GL transcript
  with and without layers declared; a masked view emits exactly the GL of the scene
  without the filtered nodes (filtering is indistinguishable from never-having-been);
  all four pre-R-38 pinned transcripts, both goldens, and 58/58 browser unchanged —
  and the new tests are mutation-tested, not vacuous. Cost +120 B gzip on ui-demo: the
  render tier's §85 diagnostic is `DEV`-gated (~115 B, stripped in production; its
  GATED-allowlist §33 argument recorded), while **`@four/scene`'s `assertLayerMask` is
  unconditional** — the dev-build suite holds simulation packages to the blunt rule
  that they may not branch on build mode at all. Unblocks R-8 (the mask parameter
  already tested), R-37 (`ScreenCamera`'s missing half), §71 picking filters
  (`layersMatch` is the whole predicate), and the flagships' viewport follow-up.
  Staged with reasons: §25 physics groups, §70 inclusion, the §71 filter itself.

### 2026-08-08 — A-6 closed: the §45 composition root completed

#### Added

- **§45's absent members (A-6).** `Application` gains: **`physics`** — a `PhysicsWorld`
  instance or a **factory handed `app.poses`** (`physics: ({ poses }) => new
PhysicsWorld({ …, poses })`; the factory form exists because a world built before the
  `Application` can never reach the pose buffer, so an instance-only option would ship
  an `app.physics` that silently cannot interpolate §43), stepped at §39 step 6 and
  disposed only when the application built it (§83: ownership follows construction, in
  both directions — the renderer rule). §45's literal `PhysicsWorldOptions` form is
  deferred for the recorded bundle reason (a static `@four/physics` import would put a
  solver in every UI bundle — the third instance of the deferred-string-selection
  pattern; the import is type-only, zero runtime bytes). **`assets`** (§76's
  `app.assets`, instance form — the manager carries its own host seams).
  **`autoResize`** with an injected `SurfaceObserver` seam (defaults true iff an
  observer was supplied, so one is never accepted-and-ignored). **`reducedMotion`**
  (`"auto" | boolean`) resolved through an injected `reducedMotionSource` **on every
  read, never cached** — a mid-session preference change is honoured with no
  subscription; closes A-13's reduced-motion policy half and PH-22m's policy half.
  `app.input` and `app.diagnostics` are **refused with recorded reasons** (§45 names
  them in prose only, no option, no example reads them — the §40 precedent; §84's
  surface is spelled `app.stats` in the spec's own example and ships).
- **§84 `physicsStepTime` and `activeBodies` are measured** whenever a world is
  attached and stats are on — `physicsStepTime` covers `world.step()` only (not §39
  step 9 event delivery), in a `finally` so a throwing solver still reports;
  `activeBodies` is read once after the frame (a level, the A-5 pattern). `contacts`
  stays staged with its reason recorded: the world publishes §29 _events_, not a live
  manifold count — differencing events answers a different question. Load-bearing
  proof: the same Rapier scene run §97-style and as `physics: () => …` produces
  element-identical checksum sequences over 20 distinct-value frames.
- **`solverStatistics` moved from `debug-draw.ts` to `stats.ts`** (same export, same
  barrel) — naming it used to drag **939 B gzip** of debug-draw module state
  (module-level scratch `Vector3`s, frozen staged lists) into every bundle; now 24 B.
  Third measured instance of the cannot-tree-shake class: producers belong in the
  module of the record they write.

#### Changed

- **ui-demo's budget: 32 → 33 kB, one coordinated bump for both wave-6 packets** —
  HEAD sat at 31 995/32 000 (5 B headroom); A-6's composition-root growth is
  structural (+352 B — nothing reachable from a class method tree-shakes) and the
  in-flight §46-layers packet independently measured +254 B. §86's 150 kB budget
  untouched. Spec-revisit recorded: §97's "a world is built and tracked, not an app
  option" comment is stale after A-6.

### 2026-08-08 — R-15 closed (policy + opt-in-transform tier): §60a colour management

#### Added

- **§60a colour management (R-15)** — v1's highest-leverage open render item.
  `@four/math` gains the colour tier: `ColorRGB` (hoisted from `@four/scene`, exactly
  what R-13's emissive note asked for — the duplicate gate confirms 0), `ColorSpace`,
  the sRGB transfer functions (piecewise IEC 61966-2-1, component + RGB/RGBA
  out-param forms, **odd-extended below zero** so extended-range values round-trip
  rather than clamp — WP-3.3's rule extended to the curves; **alpha is never run
  through a transfer curve** — coverage, not light), and `parseColor`/`parseColorRGB`
  over a documented CSS subset (`#rgb…#rrggbbaa`, all `rgb()/rgba()` syntaxes,
  `transparent`, the sixteen Level 1 keywords) that refuses everything outside it.
  `color.ts` went 0% → 100% coverage. **The working-space policy is written down
  once**, in `color.ts`'s header: material/light/vertex colours _are_ linear-light (a
  per-value tag would have one legal value); §60a's metadata lives on _resources_ —
  `TextureSource.colorSpace` (`SRGB8_ALPHA8` allocation: hardware decodes before
  filtering) and `RenderTarget.colorSpace`, which `validateEffectRenderPass` uses to
  refuse double encodes at setup.
- **The output transform is a pass, never a per-material encode** — §60a's own words
  ("is the final render-graph pass") select the design: `OutputTransformEffect`, the
  fourth `ScreenEffect` member, executed as one `renderEffect`. Tone mapping stays
  staged on R-4's float formats and lands as a field on this effect.
- **Two dated deviations, both opt-in-instead-of-default** (textures default
  `"linear"`, transform off), taken so no golden moved — every authored scene predates
  the pipeline having an output space; the transform ships, a scene opts in, goldens
  move deliberately. Flagged as owner decisions with the CSS-string-options question
  (§101's mapping row pins tuples; `srgbToLinearRGBA(parseColor(css), out)` is the
  one-line path). Eighth run of the recorded-sequence method: the R-6-era pinned
  transcript passes unchanged; a copy-effect frame issues zero `uniform1i`; 58/58
  browser with MD5-identical goldens. ui-demo at 31.99/32 kB — the encode GLSL was
  inlined specifically to fit; A-4's build-time pipeline selection remains the
  structural fix.

### 2026-08-08 — §119 flagship: the motor digital twin (S-8's example program complete)

#### Added

- **`examples/flagship/motor-digital-twin`** — §119's engineering demonstration and the
  positioning demo (`docs/POSITIONING.md`'s first audience): a procedural 3D motor
  (stator frame, end bells, fins, rotor, shaft, coupling — §53 primitives under
  `LitMaterial`), the rotor turned **by the solver** through a §28 hinge motor with
  **two coaxial bearings** (stable on Rapier 3D over 900 steps with a contact fault
  applied and released), **emergent vibration** (an off-axis collider + a
  slider-and-spring mount — ~11.6 mm p-p at 200 rpm), a lumped first-order thermal
  model with a 135 °C trip, waveform charts drawn as **one draw call** via the R-35
  lines+vertex-colour path, two fault injections (bearing rub via a slider-driven
  caliper; drive sag as a second `PIDController` with derated `outputLimits` — §111's
  own anti-windup, after measuring that external clamping + `ki = 0` produces a
  two-step limit cycle), `PIDController` closed on the measured shaft speed, §34
  record/seek/replay with a published verify, and §79 save/load (208 nodes
  round-tripping). **Three firsts**: `app.stats` read in an example (§84 — readable
  only _after_ `app.step` returns, measured), §40's conversion helpers at the display
  edge (RPM/deg/mm/ms), and a deliberate **dev build** (`__FOUR_DEV__` not defined
  false — a page about instrumentation cannot ship the build that strips it; the one
  documented deviation). One-wasm solver path (`new Rapier3dAdapter()` — 917.9 kB gzip
  vs the §118 flagship's 1.54 MB), budget 1.00 MB.
- **`tests/browser/motor-digital-twin.spec.ts`** (9 tests; browser 49 → 58) — measured:
  bearings asserted from the joints, §84 counters (`drawcalls` 158, `contacts` honestly
  `nan`), unit readouts equal to engine values through the declared conversions, two
  page loads publishing the **identical** mark checksum, PID within 4 rpm of setpoint,
  rub and sag behaviours, pause = exactly 0 changed pixels, replay-seek re-simulating
  ≤5 steps with `replayverified` true, save round-trip true.
- §119's residue staged in the file header with v1 citations: real chart primitives
  (R-24/R-23), camera-parented instruments (R-37), _measured_ joint reactions (no
  adapter reports them — the torque/force glyphs are the twin's estimate, labelled),
  glTF model (S-7). **S-8's §118–§119 example program is complete**; only the three §93
  stand-in directories remain (owner retire-or-write).

### 2026-08-08 — A-27 closed (CPU tier): §86 benchmarks for UI layout and glyph layout

#### Added

- **Two new §86 benchmarks + a runner (A-27).** `benchmarks/ui-layout.mjs` measures the
  layout-and-state half of _retained UI nodes: 5 000_ — **11.7 ms cold / 10.1 ms warm**
  per `layout()` on the recorded host, inside a 60 Hz frame (60 Hz stated explicitly as
  an interpretation borrowed from neighbouring rows — §86 gives this row a count, no
  rate). `benchmarks/text-layout.mjs` measures the layout half of _animated glyphs:
  20 000_ — **2.19 ms, 109 ns/glyph**, with a two-term per-call/per-glyph attribution
  (residual 4.3%, published). `run-all.mjs` + `pnpm bench` run all seven scripts
  process-per-script (JIT/heap isolation; a throw cannot take the run's records) and
  write `results/suite.json` — a manifest, **never a gate**: the runner asserts on no
  timing (a threshold would be the back door `benchmarks/README.md` forbids).
- **Both §86 rows stay unmet as whole rows, honestly**: their draw halves are blocked
  on §55 `frame`/§65 batching and on a GPU — the README table gains a third category,
  **`half`**, beside `hardware` and `feature`. Findings recorded, not acted on: §74's
  layout has no dirty tracking (text measurement is only 15–25% of a cold pass — the
  rest is an unconditional walk, the `resolveWorldTransforms` shape in a second
  subsystem); `layoutText`'s per-glyph cost is ~80% allocate-and-freeze, so the future
  optimisation is a flat coordinate buffer, not faster math. The five pre-existing
  records were re-recorded on this (loaded, shared) host — `physics-step`'s +24% is
  explicitly non-attributable (concurrent agents + the PH-22 rebuild) and should be
  re-recorded on a quiet host, not read as a regression. Still absent: the non-gating
  CI trend job (stated in the README, not implied).

### 2026-08-08 — PH-22 sweep: all fourteen roll-ups triaged; four closed or advanced

#### Added

- **§24's remaining collision shapes (PH-22a, closed — 7 of 8 shipped).** 2D gains
  `polyline` (open strip) and `chain` (closed loop); 3D gains `cylinder`, `cone`,
  `convex-hull`, `triangle-mesh`, `height-field` — each §85-validated, with §79
  document forms whose round-trip test asserts the fixture set _equals_ the shape-type
  unions (a future tag cannot ship without a document form), and both Rapier adapters
  converting. Three facts **measured against Rapier 0.19.3, not assumed**: the
  heightfield's column-major `heights` layout and row→Z/column→X axis mapping
  (raycast-verified), the cone's apex at `+halfHeight`, and composite shapes returning
  **zero** intersections from `intersectionsWithShape` — which is why the new
  `validateQueryShape` refuses them as §30 query shapes in all four adapter
  overlap/shapeCast entry points (a composite is a legal collider and an illegal query
  shape, because Rapier answers _wrongly_ rather than failing). `compound` is
  deliberately not a tag: it is several colliders on one body, which PH-5 made
  runtime-assemblable — composition by decision.
- **`PhysicsTuningCapabilities.jointMotorEffortCap` (PH-22e, closed)** — the first
  capability field whose `false` means "applied, _differently_" rather than "not
  applied" (Rapier's `maxTorque`/`maxForce` is a gain, not a cap); `false` on both
  adapters, warn-once on the first **enabled** motor.
- **`Joint.collisionEnabled` is live on a registered joint (PH-22f, partial)** — the
  per-property survey of Rapier's joint surface replaced the blanket freeze claim:
  `setContactsEnabled` lives on the _base_ `ImpulseJoint`, so it queues through the
  new `SolverJointAccess.setJointCollisionEnabled` and drains world-side; it was the
  only mutable-with-throw property in the whole joint surface (the rest are `readonly`
  fields — compile errors, which the header previously mis-described). Anchors
  re-staged with the real reason (the world→local conversion happens once at
  `addJoint`; a live re-anchor needs a which-pose decision).
- **§41 numerical-stability diagnostics (PH-22n, half)** — registration-time warn-once
  for distance-from-origin > 1e5, dynamic collider extents outside [1e-2, 1e3]
  (static/kinematic exempt — a ground slab is not a scale mistake), and cumulative
  dynamic mass ratio > 1000:1; each threshold a decade past the units guide's advice
  so the warning never becomes routine. **Adds no solver call** — mass threaded out of
  the existing refresh. The §10 dropped-time §84 warning is app-tier and moves to that
  backlog.

#### Blocked, re-verified (not closed, honestly)

- PH-22b (distance/gear joints), PH-22c (break force), PH-22d (spherical cone limits):
  re-verified against Rapier 0.19.3's actual declarations — the constraints/getters do
  not exist at this pin; stiff-spring stand-ins would be the "almost right" wrong
  simulation. PH-22j (box2d/soft stubs) stays an owner §102 scope decision.
  PH-22g/h/i/k/l/m are cross-tier items belonging to animation/motion/math/core/four
  packets (recorded per item). Diagnostics' joint-seam prose updated for the sixth
  member.

### 2026-08-08 — R-13 closed (scalar + base-colour-map tier): §59 `StandardMaterial`

#### Added

- **§59 `StandardMaterial` — metallic-roughness PBR (R-13).** `@four/materials` gains
  §57's sixth family member: `baseColor` (+ optional base-colour `map`), `metalness`
  (default 0), `roughness` (default 1), `emissive` (straight RGB; unclamped
  pass-through already gives HDR emissive, so no unnamed `emissiveIntensity` field).
  `@four/render-webgl` gains a sixth pipeline (`StandardProgram`): Cook-Torrance GGX +
  height-correlated Smith + Schlick Fresnel against §68's one directional light and
  the scene ambient, with the **1/π folded out of both lobes** — the engine's
  radiometric convention is now written down (light colour × intensity is an
  irradiance already divided by π), which is what makes a fully-rough dielectric
  reduce to the `LitMaterial` convention and the two families compose in one scene.
  Ambient reaches the diffuse lobe only (no IBL — `metalness: 1` under ambient alone
  renders black, honestly). Roughness floored in the shader (0.045) where the 0/0
  division lives; the material keeps WP-3.3's no-silent-rewrites rule.
  `RenderItemKind` gains `"standard"` as its own union arm; `WebglContext` grew
  `uniform1f` (its first new entry point since the lit packet — three GL doubles had
  to declare it, which is the point of the written-down budget). Staged with named
  prerequisites: `normalMap` (R-19's deliberately-deferred tangents), the other §59
  maps (§77's texture-unit allocator), the seven physical extensions
  (`PhysicalMaterial`). No tone mapping/output transform — §60a/R-15 moves both lit
  families at once.
- **Seventh run of the recorded-sequence method**: a scene using every pre-R-13
  pipeline emits the transcript recorded at `e0ddd3b` call for call (pinned in
  `tests/integration/standard-material.test.ts`); browser 49/49, goldens
  byte-unchanged. The duplicate-symbol gate refused a second `ColorRGB` export —
  the shared RGB alias belongs in `@four/math` with R-15's colour packet (inline
  tuple + dated note instead).

#### Changed

- **ui-demo's size budget: 31 → 32 kB (orchestrator decision on the agent's proof).**
  The sixth pipeline costs ~1.18 kB gzip per bundle (a BRDF, not a blit); with the
  draw branch stripped, compile-at-init alone measures 31.547 kB — §61's
  no-compile-in-a-frame rule and the 31 kB budget were provably incompatible. ui-demo
  has now absorbed two consecutive pipeline additions; A-4's build-time
  pipeline-selection seam remains the structural fix (recorded).

### 2026-08-07 — A-4 closed (build-mode tier): development/production builds

#### Added

- **§85 development/production builds (A-4).** `@four/core` exports `DEV`, `devWarn`,
  `devWarnOnce`, `devAssert`, `resetDevWarnings`, resolved from an optional
  `__FOUR_DEV__` global (`typeof … ? … : true` — read only under `typeof`, so an
  unaware host cannot crash). **Dev is the default; you opt out**: bare consumption,
  Vitest, and the determinism suites are development builds automatically; a bundler
  `define: { __FOUR_DEV__: "false" }` folds the guarded paths away. `devAssert` skips
  its check entirely in production — and every `FourError` stays unconditional (§85's
  "essential safety checks" asymmetry, deliberate). `@four/diagnostics` gains
  `auditResourceLeaks` — §83's first development warning, an **audit you call, not a
  watcher that runs** (only the caller knows which span was supposed to balance;
  `FinalizationRegistry` rejected again for the A-5 reason).
- **The flag may remove work, never change a number (§33) — enforced mechanically**:
  `tests/integration/dev-build-mode.test.ts` allowlists the five files permitted to
  import the dev channel (each with its §33 argument recorded; a sixth fails the
  suite), refuses the simulation packages outright, asserts every example config
  carries the define, and proves the stripping with a real bundler. Pixel goldens
  passed against the production ui-demo bundle — independent evidence the flag moved
  no pixel.

#### Changed

- §84's statistics wiring, §6a's duplicate-component warning, and §83's leak audit are
  gated on `DEV`; `app.stats` is `null` in a production build even with `stats: true`
  (declared types unchanged). All eight example Vite configs define the flag false, so
  `pnpm run size` now measures what a user ships: **0.46–0.52 kB gzip saved per
  example** (ui-demo 30.96 → **30.46 kB** — headroom 40 B → ~540 B; `.size-limit.json`
  deliberately unchanged, nothing loosened). Two enabling fixes recorded:
  `monotonicNowSeconds` carries `/* @__PURE__ */` (a bare top-level call otherwise
  survives tree-shaking), and `Application` stores `options.now` as given rather than
  pre-resolved (the default lives in a package production drops). Deliberately NOT
  gated: R-6's effect pipeline — `renderEffect` is a production feature; its 0.75 kB
  needs an opt-in registry split (recorded), not a dev flag.

### 2026-08-07 — §118 flagship: "One Scene, Everything Moves" (gap A-21, second half)

#### Added

- **`examples/flagship/one-scene-everything-moves` — the §118 flagship demonstration.**
  Every item on §118's list in one scene graph, one `Application`, one `PhysicsWorld`,
  one frame: a textured lit cube on a `MotionComponent`, a 2D vector orbit, a
  `SpringJoint` pendulum (spring period 0.5 s inside a 2.9 s swing, so it bounces
  _and_ swings), a bouncing body whose §29 landings drive a particle burst and a
  re-launch impulse, a motorised `HingeJoint`, two world-space labels (one rides the
  body), a `@four/ui` panel parented to the camera (screen-space until §46 layers land
  — a second viewport would draw the whole scene twice; documented), a §16 `Timeline`
  with a lap marker, and pause / slow-motion / single-step controls, keyboard-operable.
  **First example to use the §62/§37 registries** (`renderer: "auto"`,
  `solver: "auto"`) and **first to assemble the §113 debug overlay** from the R-35
  streams. Eighth Vite site and Playwright server (port 4180); budget 1.65 MB gzip
  (measured 1.54 — `registerRapierSolver()` carries both wasm images; a per-dimension
  registration is the recorded fix).
- **`tests/browser/one-scene-everything-moves.spec.ts`** (6 tests; browser 43 → 49) —
  measures rather than asserts: a hue census of six objects in one frame; ~27 000
  changed pixels running vs **exactly 0 paused** (the strongest available proof that
  §10's pause is `timeScale = 0` and nothing else writes); one single step advancing
  `sim` by exactly 1/60 s; the overlay's colours 0 → 315; the slider's minimum
  accruing 0.05 s of simulation per wall-clock second vs 1.000 at full speed;
  Tab/Home/End/Enter through §75 with `source: "keyboard"`.
- **`check-compat` CI fix**: the generator treated every export ending in "Adapter" as
  a constructor, so 191ee41's factory `createRapierAdapter` turned the gate red;
  adapter detection now also requires an upper-case initial. Found by this packet's
  gate run.

#### Changed

- `docs/AUDIT-120.md` examples row 7 → 8; S-8 narrowed to the three §93 stand-in
  scenes and §119's motor twin. `examples/README.md`, root `README.md`,
  `website/README.md` + `website/index.html` (which also gained the missing
  `first-3d-scene` row and now leads with the flagship), and `docs.yml`'s EXAMPLES
  list updated; `tools/check-docs.mjs` pins move to 8 runnable / 4 placeholders.

### 2026-08-07 — A-5 (accounting tier): §83 resource accounting; two §84 counters live

#### Added

- **§83 resource accounting (gap A-5).** `BufferGeometry.byteLength`,
  `Texture.byteLength`, `RenderTarget.byteLength` (colour + the backend's real
  `DEPTH_COMPONENT16` when `depth`), and process-wide live totals:
  `geometryMemoryBytes()`/`liveGeometryCount()` (`@four/geometry`),
  `textureMemoryBytes()`/`liveTextureCount()`/`liveRenderTargetCount()`
  (`@four/render`). **Leak-safe by holding numbers, not references** (a tracker
  retaining its resources would _be_ the leak; a `WeakRef` registry answers "was this
  collected?", not §83's "was this disposed?"). A resource dropped without `dispose()`
  stays billed — a counter that healed itself on GC would hide the only thing it
  exists to show. One rule ("a disposed resource holds nothing": `byteLength → 0`)
  makes double-dispose, resurrection-by-setter, and delta arithmetic fall out with no
  call-site special cases. `recordResourceMemory` in `@four/diagnostics` is the §84
  bridge — deliberately two numbers, not a transcribed record (no producer-owned shape
  exists, so the seam is allocation-free by construction; the duck-typed-contract
  count stays at five).

#### Changed

- **`app.stats.textureMemory` and `.bufferMemory` are measured** rather than staged
  `NaN`; staged counters drop five → three. Both are **levels** (the first
  `FrameStats` fields describing the engine, not the frame), reported with or without
  a renderer, and are an accounting of what the engine _holds and would upload_, not a
  driver query — stated on the fields. No backend file changed; the GL sequence is
  byte-identical (structural: `render-webgl` untouched; also proven by the recording
  rig). Size: +0.22 kB gzip; ui-demo at 30.96/31 kB — A-4's `__FOUR_DEV__` define is
  now the practical blocker for the next `four`/`ui`-touching packet.

### 2026-08-07 — §79 drawing-tier node types (A-16 remainder)

#### Added

- **`registerRenderSerializers()` in `four` (§47/§49/§55/§68, §79)** — node-type pairs
  for `Renderable` (`render:renderable`), `Sprite` (`render:sprite`),
  `PerspectiveCamera`/`OrthographicCamera` (`scene:perspective-camera`/
  `scene:orthographic-camera`), and `DirectionalLight` (`scene:directional-light`),
  chained into `registerSceneNodeTypes()` by the new exported `composeSceneNodeTypes()`.
  Cameras and the light serialize completely (projection parameters only — the matrices
  are derived, and `depthRange` is deliberately absent because it belongs to the
  renderer, so a document is not pinned to the backend that saved it); a sprite carries
  no geometry key because it derives and owns its quad. Type names follow
  `<package>:<class>` (the `ui:*` precedent) — the prefix is a namespace, not an import
  path.
- **`SceneResourceCatalog<T>` + `resourceCatalog(entries)` (§79 "referenced by logical
  key")** — geometry and material cross the boundary as **keys**, resolved by an
  injected catalog (`keyOf` out, `get` in; a bare `Map` satisfies the read half —
  proven). §79's manifest document (key → URL + content hash) stays staged behind A-18
  content hashing and will sit behind this seam, not replace it.
  `unknownResources: "throw" | "skip"` relaxes the **write side only** — there is
  deliberately no read-side skip (a `Renderable` cannot default its resources without
  inventing ones the application must dispose, §83). Material `kind` is checked for
  `Sprite` only — a read-side whitelist would make a consumer's `Renderable<GlowMaterial>`
  savable and unloadable; dispatch is on the §57 discriminant, never `instanceof`.
- All 14 `*_NODE_TYPE` constants are now re-exported from `four` (the six A-12 control
  names were missed when they shipped). No format change: `SCENE_FORMAT_VERSION` is
  unmoved and documents without these node types encode byte for byte as before.

### 2026-08-07 — RFCs 0001–0003 drafted (R-14, A-3, PH-10/R-22)

#### Added

- **`docs/rfcs/0001-shader-and-node-material-system.md` (§60, gap R-14)** — a
  serializable shader graph in `@four/materials` as the unit of extension; **no user
  GLSL/WGSL at any tier**. The argument is R-5/R-6's opacity principle, not only §96: a
  source string makes every user §70 pass unvalidatable exactly where feedback and
  ordering mistakes live, while a graph keeps `RenderGraph.validate()` able to
  enumerate what a pass samples. Node materials are their own `RenderItemKind`,
  compiled lazily on first draw (R-19 byte-identity preserved) behind an explicit
  `registerNodeMaterialPipeline()`; `ScreenEffect` gains one member, `GraphEffect`.
  Status draft, owner decision pending.
- **`docs/rfcs/0002-plugin-system.md` (§81, gap A-3)** — `PluginContext` as a typed
  capability bag (`defineCapability<T>` tokens exported by each registry's owning
  package, since §3.1 gives `core` no dependencies and five of six registries live
  downstream). Five of §81's eleven extension points are real today, one partial, five
  absent — tabulated rather than stubbed. §96's plugin half answered narrowly: **no
  sandbox**, but untrusted content can never become a plugin (objects only, never
  specifiers), enforced by an integration test in the A-23 CSP-test style. Alternative
  E (do nothing; the registries stay ordinary package APIs) is argued as genuinely
  defensible and flagged for the owner rather than argued away. Status draft, owner
  decision pending.
- **`docs/rfcs/0003-skinning-and-skeletal-animation.md` (§54/§14/§17, gaps PH-10 +
  R-22)** — the §3.1 matrix decides the split: joints/weights as `BufferGeometry`
  attributes at locations 4/5 (continuing R-19's numbering), `Bone`/`Skeleton` as
  scene-graph nodes (§42 authority, §19 blending, and §79 serialization then need no
  new mechanism), skinned draws as a separate lazily-compiled pipeline (a vertex-stage
  branch would tax every unskinned draw). Two findings: §54's `morphTargetWeights` on
  `Mesh` is **unanimatable under §3.1** and becomes a `@four/scene` component; §17's
  two "missing track types" are binding gaps, not `ValueKind` gaps. Status draft,
  owner decision pending — bone-axis convention is the named question.

### 2026-08-07 — A-8/R-2/PH-19 closed: `renderer: "auto"` and `solver: "auto"`

#### Added

- **§62 renderer registry and §37 solver registry (A-8/R-2/PH-19, closed together).**
  Backends and solvers register themselves into a neutral host via an **explicit call**
  (`registerWebglRenderer()`, `registerRapierSolver()`) — never a side-effect import,
  which `"sideEffects": false` on all 24 packages makes _correctly deletable_ by any
  bundler; `four` and `@four/physics` still import no backend and no solver. `"auto"`
  walks §62's WebGPU → WebGL 2 → Canvas 2D → SVG order for renderers (registration
  order deliberately not consulted — §33; the headless tier is never auto-selected;
  fallback past a rejecting `initialize` disposes what it built and reports each skip
  through `onFallback` — §62's diagnostics event as a callback, since §3.1 gives
  `render` no diagnostics edge) and **registration order filtered by §37 capabilities**
  for solvers (§37 fixes no preference; inventing one would editorialize). A named
  backend/solver fails fast; every failure names what _is_ registered (§85), with
  structured `context.tried`. `ApplicationOptions` gains `antialias` (its TODO said it
  belonged with this packet), `onRendererFallback`, `rendererRegistry`;
  `PhysicsWorldInit` gains `solver`/`solverRegistry`/`onSolverReject` with `adapter`
  becoming the optional alternative (xor, both refusals loud).
- **Tree-shaking is a stated discipline, measured both ways**: `resolveRenderer`/
  `resolveSolver` never statically reference their registry class (a lazily-created
  module `let`), so an app naming a concrete instance keeps an eight-line resolver
  (+0.2–0.3 kB gzip) and drops the registry, the §62 order, the probes, and every
  backend (grep-proven: zero hits in all four bundles); `"auto"` costs 0.78 kB gzip,
  paid only by the app that asks (controlled A/B in the packet report).
- `isSupported` probes never touch the caller's canvas — a canvas serves one context
  per type, so a probing `getContext` would fix the attributes the backend later
  acquires, silently disabling `antialias`. The probe is an environment question;
  `initialize` is the real gate.

#### Changed

- `Application.renderer` is a **getter** — `null` until `initialize()` resolves a
  string selection; unchanged for an instance. The WP-3.6/§45 departure is **retired,
  not reversed**: §45's string form now works, and `four` still never imports a
  backend.

### 2026-08-07 — PH-9 closed (state-machine tier): §18 `AnimationController`

#### Added

- **`AnimationController` in `@four/animation` (PH-9, §18)** — declarative states over
  clips; transitions with **typed conditions** (`{parameter, is, value}` — all six
  numeric comparisons, Booleans, latched triggers; the string DSL `"speed > 0.1"` was
  deliberately not built: a parser is a second §33 surface, staged as optional sugar),
  cross-fade `duration`, `exitTime` in **seconds of source-state time** (§7a — a gate,
  not a trigger instant), and transition interruption (the outgoing pose is frozen per
  channel through the same blend path, so the frozen pose is exactly what the next
  write would have produced). Seven of §18's nine features ship; blend trees and
  layered/additive animation are staged with dated notes, with clip events and
  "any state" transitions.
- **The controller is a pose evaluator, not a mixer scheduler** — §18's cross-fade
  needs two clips writing one property at once, which the mixer's claim semantics
  define as a conflict; so the controller owns one _channel_ per animated path,
  samples source and destination into scratch, mixes through the channel's
  `ValueAdapter`, and writes once under one claim in the **same** §16 registry
  (controller-vs-tween still resolves by the single rule). A state with no track for a
  channel contributes the baseline captured at `play()` — the pose is a pure function
  of (state, time, weight), and fades over partially-animated channels don't snap.
  Consequence stated: a controller pins every channel it owns. No `seek` — a machine's
  pose is a function of history; §34 replays it by replaying deltas.
- **New determinism golden** `tests/determinism/golden/animation-controller.json` —
  600 fixed steps, four states, six transitions, scripted parameter schedule; two
  in-process runs and a fresh child process all byte-identical; all-`"linear"` tracks
  keep the arithmetic transcendental-free so a mismatch means the controller changed.
  **No existing golden touched.**

### 2026-08-07 — R-6 closed (full-screen effect tier): §70 post-processing

#### Added

- **§70 post-processing at the full-screen effect tier (R-6).** `@four/render` gains
  `EffectRenderPass` — a **third `RenderGraph` pass kind**, not an escape-hatch pass:
  a pass whose sampling is a _field_ (`source`) is validated exactly with no traversal,
  the inverse of the `CustomRenderPass` opacity problem — plus the **closed**
  `ScreenEffect` union (`"copy"`, `"grade"`: exposure → contrast → saturation),
  `COPY_EFFECT`, `COLOR_GRADE_DEFAULTS`, `validateEffectRenderPass`,
  `supportsScreenEffects`, and the optional `Renderer.renderEffect` (presence is the
  capability, the A-1 stance). `@four/render-webgl` gains `EffectProgram` — a
  full-screen-triangle pipeline compiled at initialization beside the other four (§61
  forbids compiling inside a frame) — and `WebglRenderer.renderEffect`, with all state
  borrowing inside the F13 envelope. Ping-pong chains between two `RenderTarget`s are
  the supported form; copy is **bit-exact** (a chain of copies issues zero uniform
  traffic), which is what makes the blit usable as §63's future debug view. Closed
  unions are the staging mechanism: `{ kind: "bloom" }` is a compile error today, and
  the backend _skips_ an unknown kind rather than quietly copying. Eight §70 effects
  are staged, each naming the resource it waits on (tone mapping → §60a + float
  targets; bloom → transient pool; AA/DoF/motion blur/SSAO → MSAA/samplable
  depth/MRT; outlines → R-7/§71; user shaders → R-14's RFC; distortion → second input).
- **The no-post GL path is unchanged** — `renderEffect` is a separate entry point, so
  `render`'s body was not edited at all; the steady-state frame transcript is
  call-for-call identical to the pre-R-6 build (pinned as a literal in
  `tests/integration/render-effects.test.ts`, handle-aliased) modulo the constant
  serial shift of the six objects the fifth program mints.

#### Changed

- **ui-demo's size budget: 30 → 31 kB (owner-recorded cost).** A fifth
  compiled-at-init pipeline costs 0.75 kB gzip per example bundle, and the conflict is
  structural, measured, not code golf: **even a stubbed `renderEffect` exceeds the old
  limit by 99 B** — "compile at init" (§61) and the 30 kB budget were provably
  incompatible; ui-demo sat at 98.9% of budget before this packet. `@four/render`'s
  half tree-shakes completely (grep-verified: zero effect bytes in bundles); the GL
  half cannot (nothing reachable from a class method tree-shakes — second instance of
  A-1's cannot-tree-shake class; A-4's `__FOUR_DEV__`/opt-in seam is the recorded
  eventual fix). The §86 spec budget (150 kB) is untouched and distant.

### 2026-08-07 — A-2/PH-13 closed: §40 `UnitSystem` (display/authoring conversion only)

#### Added

- **§40 `UnitSystem` in `@four/core`** — `UnitSystem`, `SI_UNITS`, `resolveUnitSystem`
  (returns the shared frozen `SI_UNITS` with zero allocation when given nothing),
  `{angle,time,length,mass}{To,From}Display`, the SI accessors §101 will read
  (`worldLengthToMeters` …), `unitSymbol`, and `format{Length,Mass,Time,Angle}`.
  **Declaring a unit system changes nothing the engine computes** — every API signature
  stays radians, seconds, and world units (spec rev 1.3's narrowing, quoted in the
  module header). §85 validation refuses selectors outside §40's unions and non-finite/
  non-positive scale factors — refused, not clamped. The two under-specified points
  were decided, not guessed: `"custom"` means "the display unit _is_ the world unit"
  (exact identity) and gets no symbol (§40 supplies no label field).
- **The display-only rule is enforced mechanically**:
  `tests/integration/units-display.test.ts` fails if any package source outside
  `@four/core` imports the module (visible `ALLOWED` allowlist), and proves authoring
  through the helpers is **bit-identical** to authoring in engine units on a real
  motion command — because the conversions are measurably inexact in their last bits
  (8.8% of degree round trips, 2.5% of millisecond ones), a solver calling them would
  diverge from its own replay (§33–§34). Closes gap items **A-2 and PH-13** (one item,
  filed twice). No `ApplicationOptions.units` — §45 does not list one, and adding it
  would be inventing API. Staged with dates: §101 unit application in physics, §79
  header serialization (after A-16), text parsing. The units guide's "no `UnitSystem`
  API has shipped" honest-state paragraph is corrected in place, dated.

### 2026-08-07 — R-5 closed (linear-pass tier): the §63 render graph

#### Added

- **`RenderGraph` in `@four/render` (R-5, §63)** — an ordered, named, individually
  enableable list of render passes executed by one `execute(renderer, interpolation?)`
  call, each pass one `renderer.render(root, views, interpolation, target)` over R-4's
  seam — asserted **transcript-identical** to the hand-written calls it replaces, which
  is what makes adopting the graph a refactor rather than a rendering change. Ships
  §63's pass dependencies (declared `inputs` validated at `addPass` — **acyclicity by
  construction**: an input must name an already-added pass and insertion order is
  execution order, so cycles are unconstructable — plus a discovered sampled-target
  check: `validate()` runs the real `buildRenderList` and reads the
  `isRenderTargetTexture` marker, seeing exactly what the backend sees), pass
  enable/disable (a disabled pass issues zero GL), per-pass viewports, and a textual
  `describe()`. Clear policy stays on `Viewport.clearColor` (§48) — which is exactly
  what makes a compositing pass expressible. The `CustomRenderPass` escape hatch always
  reports an `"opaque"` validation issue, so an unchecked graph says so instead of
  returning a clean bill it did not earn. Transient targets, resource lifetimes, and
  barriers staged with dated reasons; the module tree-shakes out of every example
  bundle (byte-identical md5s, `RenderGraph` absent from all seven).
- **R-6 (§70 post-processing) is now unblocked** — effects are graph passes.
- Correction recorded against the R-4 note: "feedback loops are refused, not drawn"
  holds for **sprites** (draw skipped); an `UnlitMaterial`/`LitMaterial` sampling its
  own target has the `map` refused but the draw survives untextured — one rule for the
  sample, two outcomes for the draw. The `"feedback"` issue documentation states this
  accurately.

### 2026-08-07 — PH-5 closed: runtime collider add/remove

#### Added

- **`PhysicsWorld.addCollider(collider)` / `removeCollider(collider)` (PH-5)** —
  register and unregister **one** `Collider` on a body the world already holds, without
  re-creating the body: its solver handle, monotonic id, §33 checksum position, joints,
  and pose all survive (which `removeBody` + `addBody` destroyed). Which body a collider
  joins is `Collider.requireBody()` — §24's own resolution, the same predicate
  `addBody`'s subtree scan applies, so there is no second rule and no `node` parameter.
  Explicit by design (the `refreshCollider` precedent; a diffing `refreshBody` would be
  a second rule _and_ a per-step cost). `removeCollider` returns `false` like
  `removeBody`/`removeJoint` (unconditional teardown); `addCollider` throws with §85
  refusals that all run before the adapter is touched.
- **Mass is re-established in both directions**, proven against the structural double
  and against real Rapier in both dimensions: a derived-mass body gains and loses
  collider contributions and, left with no collider, stops reporting a mass at all
  (`derivedMass` clears **only at zero colliders** — §23 forbids reading a solver's 0 as
  "no mass"); an authored mass survives, carried by PH-3's heir when its collider goes,
  created massless on the new collider. **The adapters needed nothing** — F8's kept
  `destroyCollider` mass refresh was written for exactly this body-survives case — and
  **§34 snapshots needed nothing**: the envelope's collider table already re-derives
  each body's collider list, proven by bit-identical restore + replay checksum streams
  across a runtime add and a runtime remove.
- Determinism: goldens unchanged; a world that never adds or removes makes the
  identical solver calls (deep-equal call sequences + identical 40-step checksum
  streams). PH-1's "refreshCollider refuses a post-registration collider" blocker is
  lifted; a pending refresh is dropped with its collider; `#warnUnhonouredMaterials`
  split per collider so `addCollider` warns for the new one only.

### 2026-08-07 — PH-1 stage 2: §37 property changes reach the solver

#### Added

- **`SolverBodyTuningAccess` (`@four/physics`)** — the §37 seam for post-registration
  property changes: `setBodyMassProperties`, `setBodyDamping`, `setBodyGravityScale`,
  `setBodyCcdMode`, `setColliderMaterial`, `setColliderFilter`. Optional and
  **structurally detected** (`supportsSolverBodyTuning` / `missingSolverBodyTuning`),
  **all-or-nothing** across the six methods, on the `SolverJointAccess` precedent —
  `PhysicsCapabilities` stays frozen and an adapter implementing none of it is still a
  legal `PhysicsWorldAdapter`. Both Rapier adapters implement all six (the live mass
  write re-runs `resolveMassMode` and rewrites `BodyRecord.massMode`, so a live `mass`
  and a re-registration converge and PH-3's heir logic keeps working).
- **`PhysicsWorld.supportsLiveProperties`** (readable before registration — a tuning UI
  can disable sliders instead of learning from a warn), **`refreshCollider(collider)`**
  (explicit by design — §24/§25 fields are plain public data that cannot be
  intercepted), **`teleport(node, position, rotation?, wake?)`** (§37's "teleports"
  finally has a stable-API route), **`RigidBody.markMassPropertiesChanged()`**,
  **`pendingSolverWrites`** (a bit set — §23's triple is one bit, the damping pair one),
  **`liveSolverWriteWorldCount`** (a body in two worlds where one can't carry the write
  still warns, because that is the truth).

#### Fixed

- **`mass`, `linearDamping`, `angularDamping`, `gravityScale`, and `ccdMode` written
  after `world.addBody` now reach the solver** at the top of the next fixed step —
  before commands and kinematic feed, so a force applied the same frame as a mass change
  acts on the new mass — and a `Collider`'s §25 material / §24 filter does too via
  `refreshCollider`. The `rigid-body.ts` truth table is now a two-column table (adapter
  with seam / without), dated; warn-once machinery stays exactly where a write is still
  unreachable. `mass = undefined` is documented as **permanently** unreachable (not
  staged): un-authoring means restoring collider densities only the registration path
  holds.

#### Changed

- Determinism: the drain walks ascending body id, ascending collider id within a body,
  seam-declaration order per body; draining clears, so a body in two worlds hands its
  writes to whichever steps first (§26's command-buffer semantics). **A quiet world makes
  no extra solver call** — asserted by deep-equalling adapter call sequences — so every
  §33 golden is byte-identical.

### 2026-08-07 — A-1 closed (measurable tier): §84 runtime statistics

#### Added

- **§84 runtime statistics (gap A-1).** `@four/diagnostics` gains `FrameStats` — §84's
  **eleven** counters (the gap entry said twelve; the spec lists eleven, pinned by a
  test) — with `createFrameStats`/`resetFrameStats`/`copyFrameStats` (out-param),
  `recordRenderStatistics`, `recordSolverStatistics`, and `createMonotonicClock`.
  `@four/render` gains `RenderStatistics` and an **optional `Renderer.statistics`
  capability — presence is the capability** (the `RendererCapabilities` stance applied
  to counters; a backend that cannot count omits the member instead of reporting
  zeros); `@four/render-webgl` counts the draw calls, triangles, and instances it
  actually **submits** (a skipped geometry, disposed texture, zero-particle system, or
  lost-context frame counts nothing). `Application` gains `stats: FrameStats | null`,
  opt-in via `ApplicationOptions.stats` (default off) with an injectable `now` clock —
  closing the `app.stats` slice of A-6. Renderer counters reach diagnostics through a
  structural transcription (fifth duck-typed-contract instance), no §3.1 edge.
- **A field reading `NaN` was not measured; `0` was measured zero** — the rule that let
  §84 ship before all its producers: `gpuFrameTime` (§62 timestamp queries),
  `physicsStepTime` + `contacts` (`PhysicsWorld.step`'s to report), `textureMemory` +
  `bufferMemory` (A-5's ownership tracking) are staged as `NaN`-with-a-reason and
  test-asserted to stay `NaN` so none can quietly start reading 0. `Date.now` is banned
  repo-wide (§33), so the clock has **no fallback** — a host without `performance`
  measures nothing rather than measuring badly.
- **Statistics off is byte-identical in GL calls and allocation-free** — proven at unit
  and application level (recorded-sequence equality, the F13/R-4 method's third
  survival) plus determinism traces with stats on vs off. Cost when off: one `!== null`
  per fixed step, frame, and draw. Honest size note: `Application`'s unconditional
  references cost ~0.3–0.5 kB gzip per example bundle (ui-demo at 29.68/30 kB) — A-4's
  `__FOUR_DEV__` define is the recorded fix.

### 2026-08-07 — R-4 closed: render targets, render-to-texture

#### Added

- **Render targets (R-4, §61/§48/§63)** — `RenderTarget`, `RenderTargetOptions`,
  `RenderTargetFormat` (one-member `"rgba8"` union — unsupported formats are a compile
  error), `RenderTargetTexture`, and `isRenderTargetTexture` in `@four/render`;
  `Renderer.render` takes an optional fourth `target` argument; `RenderTargetCache`
  (FBO + RGBA8 colour texture + optional `DEPTH_COMPONENT16` renderbuffer,
  completeness-checked, version-keyed, loss-aware) in `@four/render-webgl`.
  **`RenderTarget.colorTexture` satisfies `MaterialTexture`**, so an off-screen pass is
  sampled by assigning it to any material's `map`/`texture` — no adapter, and
  `@four/materials` was not touched at all. Target depth defaults **on** (a depth-less
  target would composite the same scene differently off-screen than on). Feedback loops
  are refused, not drawn (a material sampling the target being rendered into is skipped;
  ping-pong between two targets is the supported form). `bindFramebuffer` lives inside
  the F13 `try`/`finally` envelope — a throwing target pass cannot leave the FBO bound —
  and every pre-existing exception-safety test now also asserts it.
- **A frame with no target issues no framebuffer call at all**: the on-screen GL
  sequence is byte-identical (449-call recorded comparison, the F13 method) and every
  pixel golden is unchanged; a permanent regression test pins the zero-framebuffer-call
  property. **R-5 (§63 render graph) and R-6 (§70 post-processing) are now unblocked.**
  Staged with dated notes: stencil (R-7), MRT, multisample, float formats, samplable
  depth (§69), `readPixels` (needs `Rectangle2` in `@four/math`; §92 first consumer).
  Deviations from the gap doc's sketch, documented in source: the target rides on
  `render` rather than `Viewport.renderTarget` (scene was outside the change's file
  set), and §61's `createRenderTarget` factory stays deferred **by decision** — a render
  target is a CPU-side descriptor and the framebuffer a backend cache, the
  `GeometryCache`/`TextureCache` pattern.

### 2026-08-07 — A-12 cheap tier closed: six new §73 controls

#### Added

- **Six §73 controls in `@four/ui` (gap A-12, the unblocked half)** — `Toggle`,
  `Checkbox`, `RadioButton` (exclusive by **group name scoped to the tree**, the same
  scope `focusedWidget` uses; enforced on the transition to checked only, never at
  construction or attach, so a §79 document reloads exactly as saved), `Slider` (§72
  pointer drag via `worldPoint` + inverse world matrix — what moves is a number, not the
  transform, so `DragManager` was deliberately not used; §75 arrows/Home/End; clamp →
  snap → step-back resolve rule), `ProgressIndicator`, and `ImageWidget` (named with the
  suffix because `Image` is a browser global; the widget owns box + §79 `source` key,
  the skin decodes and draws). Each ships complete: §72 pointer state, §75 keyboard
  activation, a `WidgetSkin` hook, §79 node-type pair (`ui:toggle` … `ui:image`) from
  `registerUISerializers`. **Nine of §73's sixteen controls now ship.**
- **`WidgetStateSnapshot.checked`** (`boolean | null` — `null` for non-checkable
  controls, ARIA's absent-vs-false distinction) and **`WidgetSkin.onContentChange`** (a
  fifth hook for value/`indeterminate`/`source` changes — neither layout nor §75 state).
  `UIWidget.captureState`/`publishState` are now `protected`; `Button.willActivate()` is
  the pre-emit hook so `uiactivate` listeners read post-flip state (DOM order). All
  additive.

#### Changed

- **`UI_STAGED[0]` narrowed** to the genuinely blocked names, each with its blocker:
  text input (§56 selection/caret), scroll view + virtual list (§74 overflow + §67
  clipping), embedded 3D viewport (§48), canvas view, menu + tooltip (a hover delay is a
  §9 time reading widgets cannot reach), list (selection model + overflow).

### 2026-08-07 — R-35 closed: the §84/§113 debug overlay draws (+ review F7)

#### Added

- **`@four/diagnostics`: `debugDrawStreams(buffer, out?)` + `applyDebugDrawStreams`
  (R-35)** — de-interleaves a `DebugDrawBuffer`'s 7-float layout into exactly-sized
  `positions`/`colors` `Float32Array`s whose field names spread straight into
  `BufferGeometryOptions` (`new BufferGeometry({ ...streams, mode: "lines" })` is the
  whole bridge — no new §3.1 edge; the duck-typed-contract pattern's third instance,
  after `ParticleDrawable` and `ReplayTarget`). With R-19's `colors` attribute and
  `vertexColors` material flag, the whole overlay is **one draw call** at any segment
  count — proven end to end in `tests/integration/debug-overlay-render.test.ts`.
  Supporting surface: `writeColors`, `colorFloatLength`, `DEBUG_COLOR_FLOATS_PER_SEGMENT`,
  `DebugGeometrySink`. `DEBUG_DRAW_STAGED` loses `"per-segment-colored-draw"`; the two
  survivors are still genuinely seam-blocked.

#### Changed

- **`REPLAY_FORMAT_VERSION` renamed (review F7)** — `LATEST_REPLAY_FORMAT_VERSION` (2)
  and `MINIMUM_REPLAY_FORMAT_VERSION` (1) say what became true when PH-6's
  lowest-version-that-expresses rule landed; the old name stays as a deprecated alias.
  **No document bytes changed** — asserted by a test, not assumed; goldens bit-identical.
  Doc mentions across Architecture/COMPATIBILITY/guides updated.

### 2026-08-07 — Render-tier review fixes: exception-safe GL state, validated material writes

The remaining four findings from the adversarial closure review (F13–F16), re-verified
against HEAD after R-19/R-20 moved the code around them.

#### Fixed

- **`@four/render-webgl`: a mid-frame exception no longer corrupts rendering permanently
  (F13).** The §57 GL state mirror moved from module scope onto each `WebglRenderer`, and
  `render` wraps its draw work in `try`/`finally` so the state restore, texture unbind,
  and vertex-array unbind always run. Previously any throw from application code (a
  material or geometry accessor, a disposed texture) abandoned the borrowed GL state while
  every later frame asserted the defaults — one transient error left the scene drawing
  blended, masked, or depth-testless, silently and forever. R-19 had widened the leak (a
  bound texture and selected unit also escaped). The happy-path GL sequence is
  **byte-identical, proven** — 449 recorded calls across all four pipelines compared
  against the previous implementation — and the new regression tests fail on the old code
  (verified against a baseline copy). The R-19 program-lifetime uniform mirrors were
  audited and deliberately left alone: they belong to the program object, as does the
  uniform they track, so they survive a throw correctly.
- **`@four/materials`: `opacity` and `blendMode` validate on assignment, not only at
  construction (F14).** `material.opacity = NaN` used to reach `uniform4fv`; `blendMode`
  was never validated at all. Both are now accessors applying the constructor's rules
  (§85 finite; §57's modes), rejecting before the first write. Out-of-range opacity still
  passes unclamped and neither bumps `Material.version` — both unchanged, deliberate,
  with the superseded doc wording quoted in place.
- `restoreGlState` no longer passes a blend mode its helper ignores (F15); the dead
  `BLEND_FUNCTIONS` fallback is removed now that `blendMode` is provably total, and the
  remaining defensive material reads are documented as guarding structurally-typed test
  doubles and the material-less particles path (F16).

### 2026-08-07 — S-8 half-closed: `examples/first-3d-scene`, the first 3D browser proof

#### Added

- **`examples/first-3d-scene`** — §93's first 3D scene and the first example of any kind
  to construct a `PerspectiveCamera` or draw a `LitMaterial`: two **identical** spheres
  (one geometry instance, one material instance — the projection is the only variable) at
  different depths, a torus spun by a §38 `MotionComponent`, a capsule bobbed by a §15
  tween, and a ground plane, all under one `DirectionalLight` plus `Scene.ambientLight`
  (§47, §53, §57, §68). Non-wasm, 23.31 kB gzip; seventh Vite site and preview server
  (port 4179), `.size-limit.json` budget 28 kB.
- **`tests/browser/first-3d-scene.spec.ts`** (5 tests; browser total 38 → 43) — measures
  rather than asserts: the near sphere covers **4.04×** the pixels of the identical far
  one (an orthographic camera scores exactly 1.0; the §47 prediction was 4.1), and each
  sphere's lit quadrant is 3.0–3.7× brighter than its shadowed one with the §68 ambient
  term keeping the dark side above the background.

#### Changed

- `docs/AUDIT-120.md` examples row 6 → 7; **S-8** restated as partially closed (five
  placeholder directories remain) with its superseded wording quoted and dated;
  `examples/README.md`, root `README.md`, `website/README.md`, `docs.yml`'s deploy list,
  `docs/guides/README.md`, and `docs/guides/cameras-and-coordinate-conversion.md`
  corrected in place — "no example exercises a perspective camera" stopped being true on
  this date. `tools/check-docs.mjs`'s retired-claim reason updated to match (now pins
  seven).

### 2026-08-07 — Closure-review fixes: 24 findings from the adversarial pass over the wave commits

An adversarial code review of the five landed closure batches (93cda8d, ab13840, fe8eb6f,
c843e2d, b48f053) produced 25 verified findings; the 24 whose files were free are fixed
here (the render-tier `glState` findings land separately). Each behavioral fix carries a
regression test; each doc contradiction now has doc and code agreeing, with dated in-place
corrections.

#### Fixed

- **`KinematicController` has a §79 serializer** and `registerSceneNodeTypes` registers it
  — a scene using the component could not be saved at all after A-15's throw-by-default
  (the right default, which obliges the umbrella to cover every shipped component). The
  payload is deliberately empty (`{}`): the class has no constructor options, in-flight
  commands are §79-excluded simulation state, and `followPath` holds a live `Trajectory`
  no document can name. **Registry completeness is now enforced mechanically**: an
  enumerating test walks every umbrella barrel for `static typeName` classes and requires
  each to be registered — a sixth component must be registered or the suite fails.
- **Physics teardown no longer does O(N·M) discarded work**: `#destroyRegistration` issues
  one `destroyBody` (§37: "destroys a body and everything attached to it") instead of N
  per-collider destroys each running a full-world heir scan and a doomed mass
  recomputation; Rapier `BodyRecord`s keep a per-body `colliderIds` list so the heir
  lookup is O(1) anyway. Snapshot bytes unchanged; goldens bit-identical.
- **`wrap: false` keyboard traversal really leaves the widget tree** (it was a focus trap
  with an extra step: the next Tab re-entered via the root fallback and suppressed the
  host default). Leaving now costs the documented two keystrokes.
- **`Button` suppresses the platform default only when it consumed the key** — a disabled
  focused button no longer swallows Space's scroll while emitting nothing.
- **`PointerInput` no longer erases a gesture started from inside a `pointerleave`**
  (ending-state flag; a re-press during teardown mints a fresh entry, as the doc claimed).
- **`KeyboardInput` is inert after `dispose()`** (a retained surface listener no longer
  reaches the scene).
- **`Application` validates `options.resolution` on the resolution-only path**
  (`resolution: 0` reached `renderer.resize` unchecked).
- **`reserveNodeId` no longer saturates at `MAX_SAFE_INTEGER`** (a hostile id then handed
  every subsequent node the same id — the exact collision the guard exists to prevent).
- **A malformed `inertiaTensor` in a §79 document is refused loudly** instead of silently
  switching the body to collider-derived rotational inertia (a §33 checksum divergence
  with nothing to point at).
- Doc corrections: the fabricated §61 quotation about camera aspect is restated as the
  A-7 decision it was (citing §47/§48), and `resize` is §45's seventh method, not eighth.

#### Changed

- `RigidBodyDocument.sleeping` is now optional on the read side (write side still emits it
  — bytes unchanged); it is write-only diagnostics and says so.
- `dispatchThreePhase` type-pairs its two listener keys (`capture:pointerup` with
  `keydown` no longer type-checks); drift warnings fire only on real value changes
  (self-assignment no longer burns the one-shot warn slot); `RigidBody.#massAuthored`
  deleted (derived from `#mass !== undefined`); keyboard traversal allocates its focus
  order per keystroke, matching `PointerInput`'s stated re-entrancy discipline.

### 2026-08-07 — A-23 closed: §96 untrusted-content limits enforced and tested

Asset loads and document decoders now enforce input-size limits and a deadline, and the
CSP posture is documented and mechanically tested. `grep -rn "§96"` went from zero source
citations to 40+.

#### Security

- **`@four/assets`**: `AssetManagerOptions.maximumBytes` (default 64 MiB) checked against
  `content-length` **before** the body is read _and_ against the body a loader actually
  reads (a lying header is caught by the second check — tested), and `timeoutSeconds`
  (default 30, injectable `TimerLike`; seconds per repo convention — milliseconds appear
  only at the platform boundary parameter) covering transport and decode together.
  Refusals are `ASSET_LOAD_FAILED` with `context.limitName`/`.limit`/`.observed`, uncached
  and retryable. This closes the **deadline half of A-18** (a stalled load can no longer
  pin a refcount forever); caller-driven abort remains, with its compatible design
  (`FetchLike<TSignal>` + injected abort handle) recorded in `asset-manager.ts` — the
  naive `signal` widening is proven incompatible with `typeof fetch`.
- **`@four/serialization` / `@four/diagnostics`**: new `decodeSceneDocument(text, limits?)`
  (§79) and `decodeReplayRecording(text, limits?)` (§34) route through `@four/core`'s new
  `parseUntrustedJson` — `maximumTextLength` (32 Mi code units) and `maximumDepth` (1024
  levels, walked **iteratively**: a recursive checker would overflow on exactly the input
  it refuses; the vulnerability is proven by tests showing the unguarded validators
  stack-overflow at 50 000 nesting generations). New §89 error code
  `UNTRUSTED_INPUT_REJECTED` separates "hostile input" from the validators' "malformed
  input". Guards live at the text boundary only — `validateSceneDocument` /
  `validateReplayRecording` are unchanged by design, which is what kept every golden
  byte-identical.
- **New guide `docs/guides/security-and-untrusted-content.md`** (§96 requirement table —
  met/partial/absent, honestly — and the CSP posture) and
  **`tests/integration/security-csp.test.ts`**, which fails if any shipped source gains
  `eval`, `new Function`, a string-argument timer, `innerHTML`/`document.write`, or
  `style.cssText`; each matcher self-tests against a positive example so it cannot rot
  into a no-op.

### 2026-08-07 — R-19 + R-20 closed: §53 vertex attributes, textured meshes, nine 3D primitives

The render tier's two keystone gaps close together. Until now a mesh could not be textured
at all (only `Sprite` sampled a texture, deriving uv from position) and the 3D primitive
set stopped at box/plane.

#### Added

- **`BufferGeometry.uvs` / `.colors` (R-19, §53)** — on the `normals` precedent exactly:
  optional, index-aligned, §85-validated on assignment, version-bumping setters, dropped by
  `dispose()`. Uvs now ship from `boxGeometry` (per-face), `planeGeometry`, and
  `circleGeometry2D`. The remaining §53 attributes (tangents, second uv, joints/weights,
  instance transform) stay deferred with the existing notes.
- **`UnlitMaterial.map` / `.vertexColors`, `LitMaterial.map`** — the texture contract is
  the new `MaterialTexture` (`packages/materials/src/texture.ts`); `SpriteTexture` stays
  exported as an alias, so `@four/render`'s `Texture` is untouched. The lit map multiplies
  the base colour **before** the lighting term.
- **Nine 3D primitives (R-20, §53)** — `sphere`, `cylinder`, `cone`, `capsule`, `torus`,
  `lathe`, `extrude`, `tube`, `heightField`: Y-up, centred, CCW, analytic normals, uvs.
  `capsule.height` measures the cylindrical section only (§24's collider convention);
  `tube` uses a parallel-transported frame (Frenet flips at straight runs); `extrude`
  **rejects concave outlines when `capped`** (§85 — centroid-fan caps would draw folded;
  §52's tessellation module lifts this). Tests recompute face normals from positions as an
  independent oracle.
- **Vertex-colour unlit path (unblocks R-35)** — a `"lines"` geometry with per-endpoint
  colours draws as one call with `useVertexColors=1`; the §84/§113 debug-overlay data path
  now exists end to end.

#### Changed

- **Untextured scenes issue a byte-identical GL sequence.** The unlit/lit pipelines sample
  the map through a uniform switch on one program (`useMap`/`useVertexColors`, CPU mirror
  seeded at GL's initial `0`), not shader variants — a material naming neither feature
  issues no extra GL call. That property is what let this land under the pixel-golden
  gate. Attribute locations are now fixed: 0 position, 1 normal, 2 uv, 3 colour.
- `Sprite`'s derived-uv path is deliberately unchanged (the rewrite belongs to §55's atlas
  packet, which can retire `SpriteProgram`'s `quad` uniform with it — dated note in
  `sprite.ts`).

Gates: geometry/materials/render/render-webgl 96/57/130/211 unit tests; geometry and
materials at 100% coverage (kept), render 99.65 / render-webgl 99.55; suites 183
bit-exact; 38/38 browser with byte-unchanged visual goldens; TypeDoc 0; sizes within
limits (ui-demo 28.1/30 kB — 1.9 kB headroom left).

### 2026-08-07 — A-25: §94 release machinery built (publish stays owner-gated)

#### Added

- **Changesets, initialized by hand** (no `changeset init`, no lockfile change):
  `.changeset/config.json` (`baseBranch: main`, `access: public`, `linked` groups for the
  render and physics families) plus a README recording the repo-specific rules — including
  the discovered blocker that **the five reserved stubs cannot be `ignore`d** while the
  umbrella `four` depends on and re-exports them (Changesets validation refuses it,
  reproduced); they will publish unless the owner decides otherwise.
- **`tools/apply-publish-names.mjs`** + `node --test` suite — applies the §98 `@four/*` →
  `@danielsimonjr/fourjs-*` mapping into a staging copy, never in place. It must (and
  does) rewrite **emitted code**, not just manifests: `dist/*.js`/`.d.ts` carry
  `from "@four/core"` workspace specifiers (405 rewrite sites), and `workspace:*` ranges
  are resolved the way pnpm would. A test asserts the umbrella's 25 subpath exports
  survive the rewrite (§91 tree-shaking).
- **`.github/workflows/release.yml`** — reuses the whole of `ci.yml` via a new
  `workflow_call` trigger (a release clears exactly the PR gates), then `changesets/action`
  with publish inert unless `NPM_TOKEN` exists. **`.github/workflows/docs.yml`** — TypeDoc
  plus the six example sites (built with `--base=/four.js/examples/<name>/`, honoring the
  recorded subpath-hosting gotcha) to GitHub Pages. `website/` gains an honest README and
  a minimal static index.
- **`check-compat` wired** (A-26 follow-up): root script + a `ci.yml` step after
  check-docs, failing when an adapter capability declaration changes without
  `docs/COMPATIBILITY.md` being regenerated. `tools/README.md` now documents
  `check-docs.mjs`, `generate-compatibility.mjs`, and `apply-publish-names.mjs`.

### 2026-08-07 — A-26 closed: §90 compatibility tables published

#### Added

- **`docs/COMPATIBILITY.md`** — §90's five compatibility tables, published for the first
  time (gap A-26): browser/runtime support split into _verified_ versus _expected_ (Firefox
  and Safari are explicitly marked untested), §62 render-backend tiers, the physics solver
  adapters, scene/replay/snapshot format versions with the PH-6 lowest-version rule, and
  the plugin API (n/a — §81 unimplemented, gap A-3).
- **`tools/generate-compatibility.mjs`** — emits the solver-adapter block of that document
  from the adapters' own §37 capability declarations, read off constructed instances of the
  built packages, with `SolverBodyAccess` / `SolverJointAccess` probed structurally against
  `@four/physics`'s emitted declarations. `--check` fails when the committed document has
  drifted; adding a third adapter adds a column with no tool edit.

#### Changed

- `docs/Architecture/ARCHITECTURE.md`, `docs/guides/custom-solver-adapters.md`, and
  `docs/rfcs/0000-template.md` now point at the published tables instead of anticipating
  them; `README.md` and `docs/guides/README.md` index the document.

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

### 2026-08-08 — docs: GAP ANALYSIS v1 (supersedes v0) + tracking-hole repair

#### Added

- **`docs/GAP ANALYSIS v1.md`** — the current-state re-analysis after the 2026-08-07
  closure campaign: 97 filings → **42 closed · 14 partially closed · 4 RFC-drafted ·
  37 open**, with verifiable pointers per claim, a re-prioritized attack order
  (§4.6), and a consolidated owner-decision register (§5, 14 questions with
  recommendations). Headline: the application tier is largely closed, simulation
  almost entirely, and **the rendering tier is now the project** (26 of 37 open items
  are `R-*` — every render keystone closed, almost no render feature). v0 stays as
  the historical record with a superseded pointer at its top.
- **Tracking-hole repair (v1's "tracking integrity" finding):** the two 2026-08-06
  batches below landed code with no CHANGELOG entry, no gap banner, and no TODO/MEMORY
  line — the analysis's own A-28 failure mode aimed at itself. Recorded now, verified
  in source by the v1 pass:

### 2026-08-06 — physics wave 1 (recorded 2026-08-08): PH-2/3/4/7/14/15/16 + PH-1 stage 1

Commit `ab13840`, previously unrecorded here. Both Rapier adapters' collider teardown
mass fix (PH-3: `#forgetCollider` decrements and re-homes authored mass to the
lowest-id heir), the 3D `#rebuildRegistries` §34 validity check (PH-7),
`#massAuthored`/`derivedMass` authority split (PH-4), `PhysicsTuningCapabilities` +
warn-once for accepted-but-unhonoured §25 fields (PH-14/15), the registered-body
`type`-setter warn (PH-16), `getBodyHandle`/`getColliderHandle` (PH-2), and
`rigid-body.ts`'s property truth table (PH-1 stage 1).

### 2026-08-06 — Material base (recorded 2026-08-08): §57 abstract `Material`, R-11, R-12/R-10 base tier

Commit `fe8eb6f`, previously unrecorded here. The §57 abstract `Material` base
(opacity/transparent/blendMode/depthTest/depthWrite/colorWrite, shared id counter,
abstract `kind`); `Renderable<M extends Material>`; the backend honouring render state
via CPU-mirrored change-only GL issuance (R-12 base tier); §66 key 2
(opaque-before-transparent) in `compareRenderItems` with default-opaque scenes
byte-identical (R-10 base tier); alpha/blending live for unlit materials (R-11 — the
dead `color[3]` field).

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
