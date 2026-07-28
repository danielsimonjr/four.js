# AGENTS.md

Orientation for AI agents (and new contributors) working in this repository. Read this before
making changes. A shorter companion file, `CLAUDE.md`, exists for Claude Code; this document is
the detailed reference.

---

## 1. What this repository is

four.js — "One scene. Every dimension. Everything moves." — is a **proposed** unified
JavaScript/TypeScript framework combining 2D, 2.5D, and 3D graphics with animation, motion
systems, and physics (rigid-body, soft-body, particles) in a single shared scene model.

**Current state: scaffold + specification only. There is no implementation.**

- Every directory under `packages/` contains only a `.gitkeep`.
- There is no root `package.json`, no lockfile, no CI workflow, no tests, no build system.
- `examples/`, `benchmarks/`, `tests/`, `tools/`, and `website/` are empty placeholders.
- Consequently there are **no build, lint, or test commands** to run today. Do not invent or
  claim to run any.

License: MIT (`LICENSE`).

## 2. Documentation inventory

| File | Role |
|---|---|
| `docs/four-js-specification.pdf` | **Authoritative** source (65 pages). Nothing in it has been altered. |
| `docs/SPECIFICATION.md` | Auto-extracted Markdown rendering of the PDF (2,337 lines). Convenience only. |
| `docs/ERRATA.md` | Known internal defects of the spec, plus checked-and-dismissed non-defects. |
| `README.md` | Project summary; points at the spec and errata. |

Extraction artifacts in `SPECIFICATION.md` such as `T agline`, `T arget`, `T ests`,
`W orker-rendering`, `A void`, `AScene` are PDF kerning noise, **not errors** — do not "fix"
quotes of the spec, and do not flag them as defects.

## 3. Specification errata — read before citing any section

The spec has unresolved numbering defects, documented in `docs/ERRATA.md`:

- **E-1: two parts are both labelled `Part VII`.**
  - First `Part VII` — *Complete Graphics, Rendering, Application, and Platform Architecture*
    (§45 Application Model → §67 Clipping, Masks, and Stencils, continuing through §97).
  - Second `Part VII` — *Package Architecture* (§45 Proposed Monorepo → §49 Solver Packages).
  - All other part labels (`Part I` … `Part XII`) are unique and sequential.
- **E-2 (most consequential): section numbers 45–67 are assigned twice.** The second
  `Part VII` restarts numbering at 45, and `Part VIII – Implementation Plan` continues it
  (§50–§60 = Phases 0–10), so bare references like "§49" or "§60" are ambiguous.
  **Repository convention: always qualify citations in the 45–67 range by content**, e.g.
  "§49 (Solver Packages)" vs. "§49 (Renderable Node Hierarchy)"; "§60 (Phase 10)" vs.
  "§60 (Shader and Node-Material System)".
- **E-3 (RESOLVED): scaffold follows the §45 (Proposed Monorepo) tree as written.**
  §49 (Solver Packages) names `physics-matter` and `physics-cannon`, but the project owner
  chose the monorepo tree, so the scaffold deliberately contains only `physics-rapier`,
  `physics-box2d`, and `physics-soft`. **Do not add `physics-matter` or `physics-cannon`
  directories** without an explicit decision to amend the specification.

Non-defects already checked and dismissed (do not "rediscover" them): §65 exists (its title
begins with a typographic quote: `65. "One Scene, Everything Moves"`); repeated low numbers
(1., 2., 3., …) inside sections are numbered *lists*, not sections.

E-1 and E-2 are **unresolved and require the spec author's decision** — do not renumber the
spec, edit the PDF, or resolve them unilaterally. The two editorial notes already embedded in
`SPECIFICATION.md` (at the first `Part VII` §45 and at the second `Part VII`) are repository
additions, clearly marked as not part of the source document.

## 4. Core concept and design principles

Every visible, interactive, animated, or simulated entity lives in **one shared scene**:
static geometry, animated objects, dynamic bodies, constraints/joints, particle systems,
cameras, lights, 2D diagrams, 3D models, and UI all participate in the same lifecycle.

Four coequal **architectural pillars** (§3):

1. **Scene** — hierarchy, transforms, visibility, grouping, ownership.
2. **Render** — logical scene state → pixels via WebGPU, WebGL 2, Canvas 2D, SVG, or headless.
3. **Motion** — deterministic change through time: animation, velocity/acceleration,
   trajectories, interpolation, procedural movement, kinematic control.
4. **Physics** — forces, mass, collisions, constraints, impulses, joints, fields, integration.

Motion vs. physics distinction (recurs throughout the spec):
- *Animation* specifies how something **should** move.
- *Physics* calculates how something **must** move under physical rules.
- *Kinematics* moves objects directly without solving forces.
- *Dynamics* derives motion from forces, mass, and constraints.
All four are supported, with controlled blending between them.

Headline goals (§4): unified 2D/3D scene graph; animation/motion as first-class systems; one
physics API for 2D and 3D; deterministic fixed-step simulation; logical physics state separate
from rendering backends; pluggable solvers under a stable API; interpolated rendering;
worker/GPU simulation; **engineering and scientific applications, not only games**;
serialization, replay, debugging, reproducible simulation.

Non-goals for the initial release (§5): industrial FEM, certified safety-critical simulation,
CFD, CAD geometric kernel, full game editor, exact all-scale real-world simulation.

The defining object model (Part XII): `Object → Transform / Appearance / Motion / Animation /
Physics / Interaction`. Promise: *"Create once. Position anywhere. Animate naturally. Simulate
physically. Render everywhere."*

## 5. Architecture reference by spec part

### Part I — Core Scene Architecture (§6–8)
- **Unified `Node`** (§6): `id`, `name`, `parent`/`children`, `transform`, `visible`,
  `enabled`, `opacity`, `tags`, `metadata`, `add/remove/traverse`. The base Node stays
  lightweight; behavior attaches via **typed components** or subclasses. Nodes optionally
  participate in rendering, animation, input, physics, layout, audio, serialization.
- **Transform** (§7): always full 3D (`position`/`rotation` quaternion/`scale`/`pivot`,
  local/world `Matrix4`, `matrixAutoUpdate`, `version`). 2D nodes simply use `position.z = 0`,
  `scale.z = 1` — one hierarchy serves 2D scenes, 3D scenes, UI, billboards, physics bodies,
  skeletons.
- **Space modes** (§8): `world | screen | viewport | camera | billboard | local-plane`.
  Physics operates in world/local-plane space; screen-space UI does not join simulation unless
  explicitly mapped to a plane.

### Part II — Time and Motion (§9–13)
- **`TimeState`** (§9): `realTime`, `renderTime`, `simulationTime`, `deltaTime`,
  `fixedDeltaTime`, `interpolationAlpha`, `frame`, `simulationStep`. Time domains: real,
  render, simulation, animation, scaled, unscaled. Systems select their time source;
  `app.time.scale` / `app.time.paused` are supported.
- **Main loop** (§10): separate `fixedUpdate` (physics), `update` (animation/controls), and
  `render` events. Canonical fixed-step accumulator:
  `while (accumulator >= fixedDeltaTime) simulate(...); alpha = accumulator/fixedDeltaTime;
  render(interpolate(previous, current, alpha))`. This buys stable physics, smooth rendering,
  deterministic playback, pause/step, slow motion, replay.
- **`MotionComponent`** (§11): linear/angular velocity and acceleration, damping, max speeds —
  non-physics procedural motion and the bridge to physics solvers.
- **Kinematics** (§12): `moveTo`/`rotateTo`/`followPath`; steering, look-at, orbit, spline,
  camera rigs, character controllers, motion limits.
- **`Trajectory`** (§13): sample position/velocity/acceleration by time. Built-ins: linear,
  parabolic, circular, elliptical, Bézier, Catmull-Rom, ballistic, damped spring, custom.

### Part III — Animation (§14–19)
- Tween API: `Four.animate(obj).to({...}, ms).ease("cubic-out").play()`; 12 easing families
  including spring/bounce/elastic (§15).
- `Timeline` (§16): `.at(time, tween|callback)`, nesting, labels, markers, parallel tracks,
  looping, reversing, scrubbing, speed, **deterministic evaluation**.
- `AnimationClip`/`AnimationTrack` (§17): track types scalar/vector/quaternion/color/Boolean/
  discrete/morph/skeletal/custom; interpolation step/linear/cubic/Hermite/slerp.
- Animation state machines (§18): states, condition-based transitions
  (`{ from: "idle", to: "walk", when: "speed > 0.1" }`), blend trees, layers.
- **Physics-animation blending** (§19): `MotionAuthority = "animation" | "kinematic" |
  "physics" | "blended"` with `physicsWeight`/`animationWeight`. Canonical pipeline:
  animation target pose → kinematic modification → physics solve → interpolated render pose →
  optional blend.

### Part IV — Physics (§20–37)
- Stable, renderer-independent API; users never write solver-specific code for common tasks
  (§20). `new Four.PhysicsWorld({ dimension, gravity, solver: "auto" })`.
- Dimensions `"2d" | "3d"` with parallel naming/semantics (§21).
- Body types: `static | dynamic | kinematic-position | kinematic-velocity` (§22).
- `RigidBody` (§23): mass, inertia, velocities, damping, `gravityScale`, sleeping, CCD,
  `applyForce/Torque/Impulse/AngularImpulse`.
- Colliders (§24): shape + offset, friction/restitution/density, `sensor`, collision
  groups/masks. 2D shapes: circle, rectangle, capsule, polygon, polyline, chain, compound.
  3D: sphere, box, capsule, cylinder, cone, convex hull, trimesh, height field, compound.
- `PhysicsMaterial` (§25) with combine modes `average | minimum | maximum | multiply`.
- Forces/impulses and force generators (§26); `ForceField.sample(position, velocity, time)`
  with built-ins uniform/radial gravity, vortex, wind, drag, turbulence, spring, callback,
  GPU (§27).
- Joints (§28): fixed, distance, spring, revolute/hinge, prismatic/slider, spherical/ball,
  rope, gear, motorized — with limits, motors, springs, damping, break force/torque.
- Collision events (§29): `collisionstart/stay/end`, `triggerenter/exit` with contacts,
  relative velocity, total impulse.
- Queries (§30): `raycast`, `shapeCast`, `overlapSphere/Box`, `pointQuery`, with
  groups/masks/filters, first/all/sorted hits.
- CCD modes `disabled | speculative | swept` (§31); sleeping thresholds (§32).
- **Determinism** (§33): tiers `none | same-runtime | same-platform | cross-platform`; initial
  target is **same-runtime** determinism (same solver, timestep, input sequence, no
  nondeterministic multithreaded paths). Seeded RNG, recorded inputs, snapshots, replay,
  rollback, checksums.
- Snapshots/replay (§34): `world.createSnapshot()` / `restoreSnapshot()`; replay format stores
  initial state, solver settings, timestep, seed, inputs, optional periodic snapshots.
- Soft bodies/deformables (§35), particles (§36).
- **`PhysicsSolverAdapter`** (§37): `name`, `capabilities`, `initialize`, `createBody/
  Collider/Joint`, `step`, `syncToScene`/`syncFromScene`, `raycast`, optional
  `createSnapshot`/`restoreSnapshot`, `dispose`. The stable four.js API sits **above**
  adapters (Rapier, Box2D, Matter.js, Cannon-es, Ammo.js, custom solvers are candidates).

### Part V — Numerical Integration and Simulation (§38–41)
- Built-in lightweight integrators: `explicit-euler | semi-implicit-euler | velocity-verlet |
  rk2 | rk4`. Defaults: semi-implicit Euler (rigid real-time), velocity Verlet (conservative
  particles), RK4 (small accurate engineering demos). Solver adapters use their own methods.
- `SimulationSystem` (§39) with explicit, configurable priority ordering: input → commands →
  animation targets → kinematics → forces → physics solve → constraints → collision events →
  sensors → snapshot → render interpolation.
- **Units** (§40): never silently assume 1 unit = 1 meter; `UnitSystem` declares length/mass/
  time/angle and scale factors. Physics default: meter, kilogram, second, radian.
- Numerical stability guidance (§41) is a documentation requirement; diagnostics should warn
  about suspicious values (mass ratios, extreme scales, etc.).

### Part VI — Rendering and Motion Synchronization (§42–44)
- **`TransformAuthority`** (§42): `manual | animation | kinematic | physics | constraint |
  network`. Exactly one system owns a node's transform; conflicts produce development
  warnings, never silent overwrites.
- Physics-to-render sync (§43): fixed-rate physics, any-rate rendering; positions lerp between
  previous/current physics state by `interpolationAlpha`, rotations slerp. Render transforms
  never feed back into physics unless explicitly requested.
- Camera motion (§44) uses the same timeline/constraint/motion systems as ordinary nodes.

### First Part VII — Graphics, Rendering, Application, Platform (first §45–67, then §68–97)
- **Application model** (§45): `Four.Application` owns scene, renderer, time, scheduler,
  input, assets, diagnostics, cameras, viewports; lifecycle `initialize/start/stop/pause/
  resume/step/resize/dispose`. Advanced users may construct systems independently — the
  wrapper is a convenience, not a requirement.
- Scene queries (§46): `findById/Name/Tag/Component`, selector syntax
  (`scene.query("Mesh.dynamic[visible=true]")`); symbolic **layers** compile to masks but keep
  human-readable names in APIs and serialized files.
- Cameras (§47): Perspective, Orthographic, Screen (top-left/bottom-left/centered origins),
  Oblique, custom projection; rigs (orbit, fly, first-person, trackball, follow, spring arm,
  XR extension point, shake).
- Viewports (§48): camera → rect region + optional render target; split-screen, minimaps, CAD
  views, picture-in-picture, offscreen textures, portals.
- Renderable hierarchy (§49, first range): `Renderable` (material, renderLayer, renderOrder,
  depthMode, shadows, frustumCulled) → `Shape2D` (Circle, Ellipse, Rectangle,
  RoundedRectangle, Polygon, Polyline, Arc, Path), `Sprite`, `Text`, `Mesh`, `Line3D`,
  `PointCloud`, `ParticleSystem`, `CustomRenderable`.
- Native 2D shapes (§50) with full fill/stroke model, Boolean ops, analytic hit testing, SVG
  import/export. Path model (§51): moveTo/lineTo/quadratic/cubic/arc/close plus flatten,
  simplify, offset, length, point/tangent/normal evaluation, closest point, union/intersect/
  subtract/xor; fill rules nonzero and even-odd.
- **Tessellation** (§52) is an isolated, replaceable package with a stable interface
  (concave polygons, holes, adaptive subdivision, stroke expansion, AA fringe, incremental
  rebuild).
- Geometry (§53): `Geometry2D` (path/fill/stroke) and `Geometry3D` (buffer/indexed/
  procedural); 11 3D primitives; standard attributes including instance transforms.
- Mesh/instancing/LOD (§54); sprites with atlases, nine-slice, billboarding (§55).
- **Text is a core capability** (§56): Unicode, bidi, shaping, wrapping, rich spans, text on
  paths, bitmap/SDF/MSDF rendering, accessible semantic mirror.
- Materials (§57): unified `Material` base; families Shape/Sprite/Text/Line/Unlit/Standard/
  Physical/Shader/Node/Compute. Paints (§58): solid, linear/radial/conic gradients, patterns,
  procedural shaders, render-target textures; full `StrokeStyle`. `StandardMaterial` (§59) is
  glTF-compatible metallic-roughness.
- **Node-material shader system** (§60, first range): backend-independent; compiles to WGSL
  (WebGPU) and GLSL ES (WebGL 2) with reduced Canvas/SVG fallbacks.
- Renderer interface (§61); backends and capability tiers (§62): auto-selection prefers
  WebGPU → WebGL 2 → 2D backend; capability reporting; apps declare required/optional
  capabilities.
- **Render graph** (§63): DAG of passes (scene prep → depth prepass → shadows → opaque →
  transparent → world-space vectors/text → post-processing → screen-space UI → composite)
  managing transient targets, lifetimes, barriers.
- Render pipeline stages (§64): traversal → visibility/layers → culling → render items →
  sorting → batching/instancing → command encoding → submission. Avoid per-node virtual calls
  in the hot path; compile renderables into compact render items.
- Batching (§65, first range) is automatic but inspectable. Sort order (§66): layer →
  opaque/transparent → pipeline/material → depth → explicit order.
- Clipping/masks/stencils (§67, first range) including 3D clipping planes and engineering
  section views.
- Lighting (§68), shadows (§69), post-processing (§70).
- **Unified 2D/3D picking** (§71): `hitTestMode = "bounds" | "geometry" | "pixel" | "gpu" |
  "custom"`; engine picks the cheapest valid method.
- Input (§72): DOM-mirroring capture → target → bubble phases; pointer capture across mixed
  2D/3D.
- Retained-mode UI (§73–75): `@four/ui` controls are scene nodes; layout modes absolute/
  stack/flex/grid/anchor/constraints; **accessibility via a hidden DOM mirror** (roles,
  labels, keyboard nav, focus, reduced motion, high contrast).
- Assets (§76–78): declarative `app.assets.load({...})`; dedup, caching, refcounting,
  streaming, worker decoding, hot reload; glTF/GLB is the model format.
- **Serialization** (§79–80): `.four.json` (human-readable) and `.four` (binary); versioned,
  deterministic, diff-friendly, preserves unknown extension data; physics/animation/replay
  state are separate optional sections. Scene-format versioning is independent of package
  semver; migrations are explicit, testable, deterministic, composable.
- Plugins (§81): `FourPlugin` with install/uninstall; extension points include render passes,
  backends, asset formats, materials, physics solvers, UI controls, serialization types.
- GPU compute (§82) is optional — basic graphics/physics must not require it.
- Resource lifecycle (§83): explicit `dispose()` everywhere plus ownership tracking; dev
  warnings for leaks, stale handles, per-frame allocation storms.
- Diagnostics (§84): `app.stats.*` (cpu/gpu frame time, draw calls, contacts, memory…) and a
  long list of debug overlays (colliders, contacts, joints, overdraw, batch boundaries…).
- Validation (§85): dev builds detect NaN, singular transforms, graph cycles, authority
  conflicts, impossible mass/inertia, version mismatches; production keeps essential checks.
- Performance targets (§86, benchmark goals): 100k batched sprites @60fps, 50k shapes, 5k UI
  nodes, 20k animated glyphs, 25k CPU / 100k+ GPU particles, 5k active rigid bodies,
  near-zero idle work.
- Spatial indexing (§87): systems may keep specialized indices; the public scene graph is
  never forced to mirror a spatial tree.
- Threading (§88): main-thread mode, worker-rendering mode (OffscreenCanvas), split-simulation
  mode. MVP may be main-thread only, but **APIs must not preclude worker migration**.
- Errors (§89): `FourError` with `code` (e.g. `RENDERER_INITIALIZATION_FAILED`,
  `PHYSICS_SOLVER_FAILED`), `context`, `cause`; recoverable failures report via events.
- Versioning (§90): semver; published compatibility tables (browsers, GPU tiers, solvers,
  scene formats, plugin API).
- Security (§96): asset loaders and deserializers treat all external content as untrusted —
  bounds checks, size/decompression limits, no code execution from scene files, safe
  shader/plugin boundaries, decoder timeouts.
- §97 is a complete mixed-scene example (3D physics cube + billboard label + screen-space UI
  panel applying impulses) worth reading as the canonical "feel" of the API.

### Second Part VII — Package Architecture (second §45–49)
See §7 below (package map).

### Part VIII — Implementation Plan (second-range §50–60 = Phases 0–10)
| Phase | Scope | Exit criterion |
|---|---|---|
| 0 | Root files: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.github/workflows/ci.yml`, CONTRIBUTING, CODE_OF_CONDUCT, IMPLEMENTATION_PLAN, ROADMAP | Monorepo installs; packages compile; tests run; docs build; example starts |
| 1 | Vector2/3/4, Matrix3/4, Quaternion, Transform, Node, Group, Scene, EventEmitter, Clock, TimeState, fixed-step scheduler, dirty transform propagation | Scene graph deterministically steps **without a renderer** |
| 2 | MotionComponent, kinematic controller, paths, trajectories, spring motion, transform authority, interpolation buffers | Motion is deterministic, renderer-independent, unit tested |
| 3 | Renderer interface, **WebGL 2 backend**, cameras, render list, buffers, shaders, textures, viewports, interpolation-aware rendering | Moving 2D/3D primitives render smoothly under fixed-step simulation |
| 4 | Tween, easing, Timeline, AnimationClip/Track, property binding, deterministic evaluation | Any numeric/vector/quaternion/color/transform property is animatable |
| 5 | PhysicsWorld, RigidBody, Collider, materials, forces, collision events, raycasts, sync, debug draw — **first adapter: Rapier** (modern WASM, covers 2D+3D) | Mixed 2D/3D demo with gravity, collisions, impulses, sensors via the common API |
| 6 | Joints (fixed/distance/spring/hinge/slider/spherical), motors, limits, break thresholds | Constraints stable under real-time loads |
| 7 | Motion authority, kinematic↔dynamic transitions, ragdoll, blended poses, root motion | Animated↔kinematic↔physical control without discontinuities |
| 8 | Steering, flocking, IK, trajectory prediction, spring-damper, **PID controller utility** | — |
| 9 | Particle emitters, CPU + GPU compute simulation, force fields, trails | 100k simple particles at interactive rates |
| 10 | Snapshots, input recording, replay, checksums, frame stepping, solver stats | A physics defect can be captured, replayed, inspected frame by frame |

### Parts IX–XII
- Part IX (§61–64, second range): canonical public API examples — animated circle, dynamic
  ball, motorized hinge, physics/animation blend with impact-triggered ragdoll.
- Part X (§65–66, second range): flagship demos — *"One Scene, Everything Moves"* (success
  criterion: "one motion-capable engine, not a graphics library with physics bolted on") and
  the *Electric Motor Digital Twin* engineering demo (PID speed control, fault injection,
  torque overlays, replay).
- Part XI (§67, second range): **Revised MVP** — Node/Group/Scene/Transform/cameras/layers;
  clock + fixed-step + MotionComponent + path motion + interpolation; Tween/easing/Timeline/
  transform tracks; PhysicsWorld with 2D+3D descriptors, static/dynamic/kinematic bodies,
  basic colliders, gravity/forces/impulses, collision events, raycasts, **one solver
  adapter**, debug drawing; **WebGL 2 only**, 2D primitives, basic meshes, lighting, sprites,
  text; pointer events, 2D picking, 3D raycasting, dragging; tests, examples, API docs,
  benchmark harness, deterministic simulation tests.
- Part XII: final design statement (object model + promise, quoted in §4 above).

## 6. Toolchain, standards, and testing (spec §91–95)

When implementation begins, the prescribed baseline is: **strict TypeScript** (no implicit
`any`), **ESM**, **pnpm workspace**, **Turborepo or Nx**, **Vitest**, **Playwright**,
**ESLint**, **Prettier**, **API Extractor or TypeDoc**, **Vite**, **Changesets**, **GitHub
Actions**. Requirements: documented public APIs, tree-shakable modules, package-boundary
checks, browser compatibility matrix, changelogs.

Test taxonomy (§92):
- **Unit**: math (vectors/matrices/quaternions), transforms, scene graph, clocks/scheduling,
  animation interpolation, geometry generation, path ops, serialization, physics descriptor/
  adapter normalization.
- **Integration**: scene+renderer, fixed-step physics + interpolated rendering, 2D/3D
  picking, assets+materials, animation-to-physics transitions, UI focus/accessibility bridge.
- **Visual regression**: fills/strokes, joins/caps, transparency, materials/lighting, text
  layout, clipping, mixed 2D/3D ordering, debug overlays.
- **Determinism**: identical input stream ⇒ identical checksums; snapshot restore reproduces
  subsequent states; replay stable within the declared tier.
- **Performance**: CPU/GPU/simulation time, draw calls, contacts, memory, allocations,
  loading throughput.

Release roadmap (§94): 0.1 math/scene/time/basic WebGL → 0.2 2D shapes/sprites/text/picking →
0.3 meshes/materials/lights/shadows → 0.4 motion/tweens/timelines → 0.5 first physics adapter
→ 0.6 joints/motors/blending/replay → 0.7 assets/glTF/serialization/UI/accessibility →
0.8 WebGPU preview/render graph/compute/workers → 0.9 optimization/stabilization → 1.0 stable
API + scene format + compatibility policy.

Governance (§95): lead-maintainer model; **major architectural changes require an RFC/ADR**
(context, decision, alternatives, consequences, compatibility analysis, prototype/benchmark
where practical, maintainer approval).

## 7. Package map (`packages/`)

All packages are `@four/`-scoped. The scaffold matches §45 (Proposed Monorepo) exactly —
24 packages plus the top-level dirs `examples/`, `benchmarks/`, `docs/`, `tests/`, `tools/`,
`website/`.

| Package | Layer / responsibility |
|---|---|
| `core` | Foundation (EventEmitter, shared infrastructure) |
| `math` | Vector2/3/4, Matrix3/4, Quaternion, Transform math |
| `scene` | Node, Group, Scene, transforms, layers, queries |
| `motion` | Clocks, fixed-step scheduler, MotionComponent, velocity/acceleration, kinematic controllers, path following, trajectories, spring motion, steering, interpolation, **transform authority** (§46, Motion Package) |
| `animation` | Tweens, easing, timelines, clips, tracks, state machines, blend trees, skeletons, IK, physics-animation blending (§47, Animation Package) |
| `physics` | **Stable public API**: body/collider descriptors, materials, constraints, joints, force fields, queries, event normalization, solver adapters, snapshots, units, debug data (§48, Physics Package) |
| `physics-rapier`, `physics-box2d` | Solver adapters implementing the shared adapter interface, declaring capability differences (§49, Solver Packages). *No `physics-matter`/`physics-cannon` — see ERRATA E-3.* |
| `physics-soft` | Soft bodies and deformables (not a solver adapter) |
| `particles` | Particle emitters and simulation |
| `geometry` | 2D/3D geometry, tessellation targets |
| `materials` | Material families, paints, node materials |
| `render` | Backend-independent renderer interface, render graph |
| `render-webgpu`, `render-webgl`, `render-canvas`, `render-svg` | Rendering backends |
| `input` | Pointer/keyboard/gamepad input, event propagation, picking |
| `assets` | Asset manager, loaders (glTF, images, fonts) |
| `text` | Typography, shaping, SDF rendering |
| `ui` | Retained-mode UI controls, layout, accessibility mirror |
| `serialization` | `.four.json` / `.four` formats, migration |
| `diagnostics` | Stats, debug overlays, validation warnings |
| `four` | Umbrella package (the `import * as Four from "four"` surface) |

Dependency direction to preserve: `math`/`core` at the bottom; `scene`, `motion`, `animation`
above them; `physics` defines the API that `physics-*` adapters implement; `render` defines
the interface that `render-*` backends implement; the logical scene never depends on a
concrete backend; `four` aggregates everything.

## 8. Rules and guardrails for agents

1. **Don't fabricate tooling.** There is no build/lint/test today. If asked to "run the
   tests", explain the repo state instead of inventing commands.
2. **The PDF is authoritative.** Never edit `SPECIFICATION.md` content except clearly-marked
   editorial notes; never claim the Markdown overrides the PDF.
3. **Cite ambiguous sections by content**, per ERRATA E-2 ("§49 (Solver Packages)"), and keep
   `docs/ERRATA.md` updated if new spec defects are genuinely discovered (check its
   "non-defects" list first).
4. **Respect ERRATA E-3**: no `physics-matter`/`physics-cannon` packages without a spec
   amendment decision from the owner.
5. **Match the scaffold to the spec.** New top-level directories or packages need a basis in
   §45 (Proposed Monorepo) or an explicit owner decision (RFC/ADR per §95 once governance is
   live).
6. **When implementing, follow the phase order** (Part VIII): math/scene/time before motion,
   motion before rendering, rendering before animation core, physics API + Rapier adapter
   before joints, etc. Each phase has exit criteria — treat them as definitions of done.
7. **Determinism is a feature, not an afterthought**: fixed-step accumulator loop, seeded
   RNG, no wall-clock in simulation code, deterministic timeline evaluation, checksum tests.
8. **Honor single-authority transforms**: any system writing to a transform must go through
   the transform-authority model; conflicts warn in development.
9. **Keep the stable-API/adapter split**: application code (and examples/tests) targets
   `@four/physics` and `@four/render` interfaces, never a specific solver or backend, except
   inside adapter/backend packages themselves.
10. **Units are explicit** (§40): default meter/kilogram/second/radian, but never hard-code
    the assumption that 1 unit = 1 meter into APIs.
11. **Security posture** (§96): treat scene files, assets, and any deserialized content as
    untrusted input.
