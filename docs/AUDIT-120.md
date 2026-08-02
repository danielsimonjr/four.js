# §120 MVP audit

**Audited 2026-08-02** against the tree on `claude/specification-improvements-iug6pi`
(Phase 11 in progress; WP-11.1 serialization and WP-11.2 assets committed, WP-11.3 UI and
WP-11.4 benchmarks landing with this document).

This is the exit artefact of **plan §6j, P11-5**: _"audit §120 against reality; anything
unshipped gets a dated staged note — the exit's 'complete' reads as
'shipped-or-staged-with-note', consistent with every prior phase."_ §113a closes Phase 11
on, among other things, _"the §120 tooling list is complete"_, and this file is the
evidence for that clause and for the rest of §120 with it.

It is an audit, not a plan. It records what exists, points at the file or command that
proves it, and says plainly where something does not exist. Nothing here is a commitment
to build anything; the staged lines below are dated statements of absence, which is what
§6j asked for.

## Verdict

|                                                                                     |  items |       |
| ----------------------------------------------------------------------------------- | -----: | ----- |
| **Shipped** — implemented, exported, and covered by tests                           | **37** | of 43 |
| **Shipped at a pinned MVP tier** — usable, with a §-level widening staged and dated |  **5** | of 43 |
| **Staged** — not shipped; dated line below                                          |  **1** | of 43 |

**42 of §120's 43 items ship.** The one that does not is **rendering → lighting**, and it
was never scheduled: Phase 3's pinned MVP tier is _"unlit colored geometry, WebGL 2 only"_
(plan §6a) and no later phase widened it. That is a real hole in the §120 MVP and it is
recorded as such below rather than argued away.

Counting note: the 43 items are §120's own bullets, one row each, in §120's order. Rows
are not weighted — "Node" and "one solver adapter" count the same — so the totals are a
coverage census, not a measure of effort or of risk.

### How to read the status column

- **shipped** — the named thing exists in a package's public exports and is exercised by
  the test suites; nothing about it is deferred.
- **shipped (MVP tier)** — the named thing exists and works at the tier the plan pinned
  for it. The specification asks for more in a numbered section, and that widening is
  staged with a date in the notes below. An application can use these today.
- **staged** — not shipped. A dated line says so and says where the decision was made.

---

## Scene

| §120 item | status             | evidence                                                                                  | note                                                                         |
| --------- | ------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Node      | shipped            | `packages/scene/src/node.ts`; `packages/scene/tests/node.test.ts`                         | §6, D1: extends `EventEmitter`, single inheritance                           |
| Group     | shipped            | `packages/scene/src/group.ts`                                                             |                                                                              |
| Scene     | shipped            | `packages/scene/src/scene.ts`                                                             |                                                                              |
| Transform | shipped            | `packages/scene/src/transform.ts`, `world-transforms.ts`                                  | §7; world matrices resolved per fixed step and before render-item generation |
| Cameras   | shipped            | `packages/scene/src/camera.ts` (`PerspectiveCamera`, `OrthographicCamera`), `viewport.ts` | §47–48; cameras and viewports live in `@four/scene` per spec rev 1.3         |
| Layers    | shipped (MVP tier) | `packages/render/src/renderable.ts` (`renderLayer`), `render-list.ts` (primary sort key)  | numeric layers only — see **S-1**                                            |

## Time and Motion

| §120 item            | status  | evidence                                                                                            | note                                                                                                                                                        |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clock                | shipped | `packages/motion/src/clock.ts` (`TimeState`, `createTimeState`), `packages/four/src/application.ts` | §9's five time domains. There is no class literally named `Clock`; §9's model is `TimeState` plus the application's own clock, and that is the shipped form |
| fixed-step scheduler | shipped | `packages/motion/src/scheduler.ts`, `packages/four/src/application.ts`                              | §10; accumulator, `maximumSubSteps` clamp, `droppedTime`, `interpolationAlpha`                                                                              |
| MotionComponent      | shipped | `packages/motion/src/motion-component.ts`                                                           | §6a component, one per node                                                                                                                                 |
| velocity             | shipped | `packages/motion/src/motion-component.ts`                                                           | linear and angular                                                                                                                                          |
| acceleration         | shipped | `packages/motion/src/motion-component.ts`, `integrators.ts`                                         | semi-implicit Euler; acceleration callback                                                                                                                  |
| path motion          | shipped | `packages/motion/src/kinematic-controller.ts` (`PathFollowOptions`), `trajectories.ts`              | §14; nine trajectory types                                                                                                                                  |
| interpolation        | shipped | `packages/scene/src/interpolation.ts` (`PoseBuffer`, `createSnapshotSystem`)                        | §43; render interpolation never feeds back into physics state                                                                                               |

## Animation

| §120 item        | status  | evidence                                                 | note                                                                    |
| ---------------- | ------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Tween            | shipped | `packages/animation/src/tween.ts`                        | §15; seconds throughout (§7a)                                           |
| easing           | shipped | `packages/animation/src/easing.ts`                       | the full §15 table, plus spring/bounce/elastic                          |
| Timeline         | shipped | `packages/animation/src/timeline.ts`                     | §16 incl. markers and replay/restore semantics                          |
| transform tracks | shipped | `packages/animation/src/track.ts`, `clip.ts`, `mixer.ts` | §17; number/vector/quaternion/color/discrete adapters, §42-gated writes |

## Physics

| §120 item                             | status             | evidence                                                                                | note                                                                                                                    |
| ------------------------------------- | ------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| PhysicsWorld                          | shipped            | `packages/physics/src/world.ts`                                                         | §20                                                                                                                     |
| 2D and 3D world descriptors           | shipped            | `packages/physics/src/descriptors.ts`                                                   | §21; Y-up in both, 2D gravity is negative Y                                                                             |
| static, dynamic, and kinematic bodies | shipped            | `packages/physics/src/rigid-body.ts`                                                    | §22–23 incl. both kinematic modes                                                                                       |
| basic colliders                       | shipped (MVP tier) | `packages/physics/src/shapes.ts`, `collider.ts`                                         | §24's remaining shapes are staged — see **S-2**                                                                         |
| gravity                               | shipped            | `packages/physics/src/descriptors.ts` (`resolveGravity`)                                | Appendix A default `(0, −9.81, 0)`                                                                                      |
| forces                                | shipped            | `packages/physics/src/rigid-body.ts` (`applyForce`, `applyForceAtPoint`, `applyTorque`) | §26; commands buffered and drained at the top of the step                                                               |
| impulses                              | shipped            | `packages/physics/src/rigid-body.ts` (`applyImpulse`, `applyImpulseAtPoint`)            | §26                                                                                                                     |
| collision events                      | shipped            | `packages/physics/src/events.ts`, `world.ts` (`dispatchEvents`)                         | §29; dispatched after each fixed step (§39 step 9)                                                                      |
| ray casting                           | shipped            | `packages/physics/src/queries.ts`, `world.raycast`                                      | §30; plus shape casts, overlaps and point queries                                                                       |
| one solver adapter                    | shipped            | `packages/physics-rapier/src/rapier2d-adapter.ts`, `rapier3d-adapter.ts`                | §37; two adapters, one per §21 dimension. `physics-box2d` and `physics-soft` are scaffolds, which is what §120 asks for |
| debug drawing                         | shipped (MVP tier) | `packages/diagnostics/src/debug-draw.ts`                                                | data providers ship; the render wiring is staged — see **S-3**                                                          |

## Rendering

| §120 item       | status             | evidence                                                                                                         | note                                                                                                        |
| --------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| WebGL 2         | shipped            | `packages/render-webgl/src/webgl-renderer.ts`; `tests/browser/*.spec.ts` under Chromium/SwiftShader              | §62; the other four backends are scaffolds, per §120's "WebGL 2 only"                                       |
| 2D primitives   | shipped (MVP tier) | `packages/geometry/src/primitives.ts` (`circleGeometry2D`, `planeGeometry`), `packages/render/src/sprite.ts`     | §50's shape catalogue and §51's `Path` are staged — see **S-4**                                             |
| basic 3D meshes | shipped            | `packages/geometry/src/primitives.ts` (`boxGeometry`), `buffer-geometry.ts`, `packages/render/src/renderable.ts` | §53–54                                                                                                      |
| **lighting**    | **staged**         | —                                                                                                                | **not shipped** — see **S-5**                                                                               |
| sprites         | shipped            | `packages/render/src/sprite.ts`, `packages/materials/src/sprite-material.ts`                                     | §55; batched                                                                                                |
| text            | shipped (MVP tier) | `packages/text/src/{bitmap-font,glyph-atlas,text-layout}.ts`                                                     | §56's MVP tier: a built-in 6 × 12 bitmap ASCII face, atlas and layout. Shaping and SDF staged — see **S-6** |

## Interaction

| §120 item      | status  | evidence                                                                | note                                                                      |
| -------------- | ------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| pointer events | shipped | `packages/input/src/pointer-events.ts`, `pointer-input.ts`              | §71–72                                                                    |
| 2D picking     | shipped | `packages/input/src/pick.ts`                                            | §72                                                                       |
| 3D ray casting | shipped | `packages/input/src/pick.ts` (`createPickRay`) + `PhysicsWorld.raycast` | picking ray and solver ray are separate paths, both shipped               |
| dragging       | shipped | `packages/input/src/drag.ts` (`DragManager`)                            | §120's own description: down on node → move deltas in world → up releases |

## Tooling — §113a's named exit clause

| §120 item                      | status  | evidence                                                                                                                                             | note                                                                                                                                                                                                                                     |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tests                          | shipped | 113 package unit suites, 13 root suites (`tests/integration` 5, `tests/determinism` 8), 8 Playwright specs (`tests/browser`)                         | §92; `pnpm turbo run test`, `pnpm test:suites`, `pnpm test:browser`. `tests/visual/` is an empty placeholder: §92's visual-regression tier is served by the browser specs, and per-backend perceptual baselines wait on a second backend |
| examples                       | shipped | 10 example applications under `examples/`                                                                                                            | incl. the five §93 guide scenes and the flagship                                                                                                                                                                                         |
| API documentation              | shipped | `typedoc.json` → `docs/api/`; `pnpm run docs` (CI job from Phase 0)                                                                                  | §93's reference half. The guides/website half is in-repo documentation per §6j                                                                                                                                                           |
| benchmark harness              | shipped | `benchmarks/harness.mjs` + `math-ops`, `scene-propagation`, `physics-step`, `animation-sampling`, `particles-100k`; records in `benchmarks/results/` | §92's performance tests, §86's targets where honestly measurable. **Recorded, never gated** — see `benchmarks/README.md`                                                                                                                 |
| deterministic simulation tests | shipped | `tests/determinism/*.test.ts` with 8 committed goldens (`golden/phase{1,2,4,5,6,7,9,10}.json`)                                                       | §33–34 at the `same-runtime` tier; fresh-process double runs vs committed hashes                                                                                                                                                         |

---

## Staged lines (dated)

Each line states what is absent, on what date, and where the decision that left it absent
was made. None of them is a promise.

**S-1 — Named layers (§46). Staged 2026-08-02.**
`Renderable.renderLayer` is a plain `number` and is the render list's primary sort key.
§46 requires human-readable layer _names_ that "compile to efficient masks internally",
shared between render, camera visibility, physics interaction groups and picking. That
shared mapping is a packet of its own and was never scheduled; the numeric field is the
slot it will resolve to. Recorded in `packages/render/src/renderable.ts`.

**S-2 — §24's remaining collider shapes. Staged 2026-08-02** (pre-existing; carried from
the Phase 5 backlog, `TODO.md`).
Shipped: `circle`, `rectangle`, `polygon` (convex, validated) and `capsule` in 2D;
`sphere`, `box` and `capsule` in 3D. Staged: polyline, chain, cylinder, cone, convex hull,
trimesh, heightfield, compound — `{ type: "cylinder" }` is deliberately a compile error
rather than a runtime surprise. Cut by plan P5-6 and never widened.

**S-3 — Debug-overlay render wiring. Staged 2026-08-02** (pre-existing; carried from the
Phase 10 backlog, `TODO.md`).
The §113 debug-draw _data_ path ships — `DebugDrawSource` providers emit line and point
primitives for contacts, joint anchors, centre of mass and velocity vectors, and the
determinism and unit suites cover them. Drawing them through the WebGL backend needs a
per-segment vertex-colour attribute that the `GL.LINES` path does not yet carry, so the
overlay is not demonstrated end-to-end in a browser. §120's "debug drawing" is therefore
honest as _data_, not yet as _pixels_.

**S-4 — §50's 2D shape catalogue and §51's `Path`. Staged 2026-08-02.**
Shipped: circle and rectangle geometry, sprites, and the batching that draws them. Staged:
ellipse, rounded rectangle, regular and arbitrary polygon, star, line, polyline, arc,
sector, ring, and the whole §51 path model (Bézier construction, flatten/subdivide/
simplify, offset, boolean operations) together with §52's stroke generation — joins, caps,
dashes, stroke alignment. Phase 3's pinned MVP tier is unlit colored geometry and no phase
scheduled §50–52; a tessellation packet is the natural home.

**S-5 — Lighting. Staged 2026-08-02. This is the one §120 item that does not ship.**
`@four/materials` publishes `UnlitMaterial` and `SpriteMaterial` and nothing else: there
is no light type, no light list on the scene, no lit shading path in
`@four/render-webgl`, and no §59 PBR tier. The cause is traceable and is not an oversight
in a packet — Phase 3's scope was pinned as _"MVP tier: unlit colored geometry, WebGL 2
only"_ (plan §6a, whose WP-3.3 and WP-3.5 pinned `UnlitMaterial` and one shader pair), and
Phases 4–11 never revisited it, so §120's "lighting" bullet was never assigned to a phase
at all. The seams a lighting packet would build on already exist — the material and
GL-program abstractions, the render list, `BufferGeometry`'s attribute model — but the
geometry primitives are **positions only** and generate no normals
(`packages/geometry/src/primitives.ts` says so explicitly, and a box with per-face normals
needs 24 vertices rather than 8), so a lighting packet has to widen the vertex layouts too.
It is a scheduling gap rather than a design one, but it is not a one-line gap. Shipping it
also needs a decision about the tier — a single directional light with Lambert shading is a
small packet; §57's unified material model and §59's PBR are not — and that decision is the
owner's, not this audit's.

**S-6 — Text beyond the bitmap tier (§56). Staged 2026-07-29** (pre-existing; spec
revision 1.5, for the shaping half).
`@four/text` ships §56's MVP tier as a **bitmap** face: a dependency-free 6 × 12 monospace
ASCII font in source, a glyph atlas packed to one RGBA8 buffer, and world-space quad
layout. Two things are absent and are worth separating. **Shaping** — complex scripts,
bidi, ligatures, kerning from a real font file — is staged in the specification itself
behind a shaping-engine decision (HarfBuzz-wasm the likely route). **SDF** rendering, which
plan §7's phase table named as Phase 3a's likely seam, did not ship either: the atlas is
straight bitmap coverage, so text does not stay crisp when scaled up. Neither is a defect
against §56's MVP tier as written; both are what "MVP tier" costs here.

**S-7 — glTF asset pipeline (§76–78). Staged 2026-08-02** (plan §6j, P11-2).
Not a §120 row — §120's MVP asset list is silent on glTF — but it is the other dated
staged note Phase 11 produced, and a reader auditing MVP coverage will look for it. A real
glTF pipeline needs the §55 texture tier and materials beyond unlit (see **S-5**), so
`@four/assets` ships JSON, text, binary and image loaders and stages glTF rather than
shipping a stub.

---

## What this audit does not cover

- **Anything outside §120.** The specification is much larger than its MVP list; §113a's
  exit is about §120, and widening the audit would turn a coverage census into a spec
  review. The whole-plan completion audit is **WP-11.6**, not this file.
- **Quality.** Every row above is a presence-and-tests statement. "Shipped" does not mean
  "fast", "beautiful", or "complete against its own § section" — where a § section asks
  for more, the MVP-tier rows say so and the staged lines name the gap.
- **Performance targets.** §86 is measured, not gated, by `benchmarks/`. Two of its rows
  now have recorded numbers on this host (100 000 CPU particles; 5 000 active rigid
  bodies) and both are over the 60 Hz fixed-step budget _on a shared CI container that is
  not §86's "suitable modern desktop hardware"_. That is a recorded measurement and is not
  a §120 verdict; see `benchmarks/README.md` before quoting either number.
- **Uncommitted work.** WP-11.3's `@four/ui` sources were present in the working tree when
  this audit was written and are expected to land with it; `@four/ui` is not a §120 row, so
  no row above depends on that commit.
