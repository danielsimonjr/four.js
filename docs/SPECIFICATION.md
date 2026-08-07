# four.js - Complete Specification and Implementation Plan

> **Corrected rendering.** This Markdown was extracted from `archive/four-js-specification.pdf`
> (65 pages) and then corrected by decision of the specification's author: the duplicated
> `Part VII` label, the twice-assigned section numbers 45-67, and the solver-package list
> contradiction present in the PDF are resolved here, and text-extraction artifacts
> (kerning splits, ligatures, mid-word line breaks) are repaired. Parts now run I-XIII and
> sections 1-120 with no duplicates. **This file is the working reference for the
> repository**; the PDF is preserved unchanged as the original source and retains the
> defects. See [ERRATA.md](ERRATA.md) for the correction log and the old-to-new
> numbering map.

**Specification revision 1.7 — 2026-08-06**

| Revision | Date | Summary |
|---|---|---|
| 1.0 | 2026-07-28 | Corrected rendering of the original PDF (ERRATA E-1/E-2/E-3 resolved, extraction artifacts repaired). |
| 1.1 | 2026-07-28 | Technical revision applying [SPEC-REVIEW.md](SPEC-REVIEW.md) items R-1–R-35: contradictions resolved; component model, eventing, coordinate/math conventions, and the solver-adapter contract specified; scope of audio/networking settled; Appendices A (defaults) and B (glossary) added. New sections use letter suffixes (6a, 6b, 7a, 7b, 60a) so §1–120 numbering is unchanged. |
| 1.2 | 2026-07-29 | §86 payload budget (minimal 2D application ≤ 150 kB gzip) confirmed by the owner; provisional marker removed. |
| 1.3 | 2026-07-29 | Verification pass over the 1.1 material: world-matrix resolution per fixed step (§7); pause semantics (§10); replay records dropped time and step counts (§10, §34); §97 field of view in radians; §40 unit options restricted to display/authoring conversion; `ForceField.sample` gains `out` (§27); collider density authoritative over material density (§25); checksum order and "existing body" defined (§33); local-plane mapping in 2D worlds (§21); §39 sensor update moved before event dispatch; previous-pose capture defined (§37); marker behavior under replay/restore (§16); reduced motion in §14; cameras/viewports assigned to `@four/scene` (§98); §49–52 group renamed; §6 audio marked plugin-provided. |
| 1.4 | 2026-07-29 | §98: the §45 Application composition root moved from `core` to the `four` umbrella package — `core` owning the application shell would invert the dependency direction (§45's Application owns scene, renderer, scheduler, input, assets, diagnostics, all of which sit above `core`). Found by the implementation-plan stress test. |
| 1.5 | 2026-07-29 | Gap-closure pass: Part IX never scheduled the §120 MVP's interaction/content/tooling scope — added §106a (Phase 3a: input, picking, sprites, MVP-tier text) and §113a (Phase 11: assets, serialization, UI, benchmark harness, documentation). §56 gains an MVP text tier (full shaping staged behind a shaping-engine decision). §98 gains a publish-names note (`four` and `four-js` are occupied on npm; `fourjs`/`@fourjs` free as of 2026-07-29). |
| 1.6 | 2026-07-29 | Publish names decided (owner): packages publish under the owner's personal npm scope — umbrella `@danielsimonjr/fourjs`, sub-packages `@danielsimonjr/fourjs-<name>`. No org claim or name dispute needed; §98 note updated. Workspace names remain `four`/`@four/*`. |
| 1.7 | 2026-08-06 | Public-API reconciliation (gap analysis A-22/PH-18, owner decision — amend the specification rather than alias the shipped surface). New §97a "Namespace and Naming Conventions" records the per-package umbrella barrel (decision WP-0.7-fix1: collision avoidance plus §91 tree-shaking, so every `Four.X` of Parts VII and X reads `Four.<package>.X`), the shipped-name mapping (`Mesh`→`Renderable`; `*Geometry` classes→geometry factory functions; `*Collider` classes→one `Collider` component over a `CollisionShape` descriptor union; `Motion`→`MotionComponent`; `SceneMigrator.upgrade`→`migrateSceneDocument` + `SceneMigrationRegistry`; `scene.activeCamera`→§48 viewports on `app.views`; `physicsWeight`/`animationWeight` on the `RigidBody` component, not the node), the names with no shipped equivalent yet (a `Text` node, `AnimationController`, `Circle`, `StandardMaterial`, §8 space modes, `Node.animation`), and the deferred string-selection affordances (`renderer: "auto"`, `solver: "auto"`). §97 and §114–§117 and the inline snippets of §11, §15, §16, §18, §20, §111 are rewritten against the shipped API; where a feature is unshipped the example shows the available-today form and cites §97a. Frozen §1–120 numbering respected: the new section takes a letter suffix. |

---

<!-- toc -->
## Contents

- [Introduction](#1-vision) (§1-5)
- [Part I - Core Scene Architecture](#part-i---core-scene-architecture) (§6-8)
- [Part II - Time and Motion Architecture](#part-ii---time-and-motion-architecture) (§9-13)
- [Part III - Animation Architecture](#part-iii---animation-architecture) (§14-19)
- [Part IV - Physics Architecture](#part-iv---physics-architecture) (§20-37)
- [Part V - Numerical Integration and Simulation](#part-v---numerical-integration-and-simulation) (§38-41)
- [Part VI - Rendering and Motion Synchronization](#part-vi---rendering-and-motion-synchronization) (§42-44)
- [Part VII - Complete Graphics, Rendering, Application, and Platform Architecture](#part-vii---complete-graphics-rendering-application-and-platform-architecture) (§45-97)
- [Part VIII - Package Architecture](#part-viii---package-architecture) (§98-102)
- [Part IX - Implementation Plan](#part-ix---implementation-plan) (§103-113)
- [Part X - Public API Examples](#part-x---public-api-examples) (§114-117)
- [Part XI - Flagship Demonstrations](#part-xi---flagship-demonstrations) (§118-119)
- [Part XII - Revised MVP](#part-xii---revised-mvp) (§120)
- [Part XIII - Final Design Statement](#part-xiii---final-design-statement)
- [Appendix A - Normative Defaults](#appendix-a---normative-defaults)
- [Appendix B - Glossary](#appendix-b---glossary)
<!-- /toc -->

four.js - Unified 2D, 3D, Motion, Animation, and Physics Framework
Tagline: One scene. Every dimension. Everything moves.
Status: Revised architectural specification and implementation plan
Primary language: TypeScript
Proposed license: MIT
Target platforms: Web browsers, Web Workers, Node-compatible headless
environments, and future native runtimes
### 1. Vision
four.js is a unified JavaScript and TypeScript framework for building interactive
applications that combine:
- 2D graphics
- 2.5D scenes
- 3D graphics
- vector graphics
- raster graphics
- text and user interfaces
- animation
- motion systems
- rigid-body physics
- soft-body and particle simulation
- constraints and joints
- engineering and scientific simulation
- GPU computation
The name four.js represents more than “the library after Three.js. ” It represents
a fourth layer that brings time, motion, animation, and physical behavior
into a unified 2D/3D scene model.
A scene is not merely a collection of objects in space. It is a system
of objects changing through time.
The framework therefore treats the following as equally fundamental:
1. Space - where an object exists.
2. Appearance - how an object is rendered.
3. Interaction - how an object receives input.
4. Dynamics - how an object changes, moves, collides, and responds over
time.
### 2. Core Design Principle
Every visible, interactive, animated, or simulated entity is represented within
one shared scene.

```text
Scene
+-- Static Geometry
+-- Animated Objects
+-- Dynamic Bodies
+-- Constraints and Joints
+-- Particle Systems
+-- Cameras and Lights
+-- 2D Diagrams
+-- 3D Models
+-- User Interface
```

A 2D circle, 3D mesh, text label, rigid body, spring, motor, particle emitter,
animation controller, and sensor visualization can participate in the same application lifecycle.
### 3. Four Architectural Pillars
four.js is organized around four coequal pillars.
3.1 Scene
The scene graph defines hierarchy, transforms, visibility, grouping, and ownership.
3.2 Render
The rendering system converts logical scene state into pixels through WebGPU,
WebGL 2, Canvas 2D, SVG, or headless backends.
3.3 Motion
The motion system defines deterministic changes through time, including animation, velocity, acceleration, trajectories, interpolation, procedural movement,
and kinematic control.
3.4 Physics
The physics system models forces, mass, collisions, constraints, impulses, joints,
fields, and numerical integration.

```text
four.js
+------------+------------+
| | |
Scene Render Motion
| | |
+------------+------+-----+
|
Physics
```

Motion and physics are related but not identical:
- Animation specifies how something should move.
- Physics calculates how something must move under physical rules.
- Kinematics moves objects directly without solving forces.
- Dynamics derives motion from forces, mass, and constraints.
four.js must support all four approaches and allow controlled blending between
them.
### 4. Goals
four.js shall:
1. unify 2D and 3D objects under one scene graph;
2. make animation and motion first-class engine systems;
3. provide a common physics API for both 2D and 3D;
4. support deterministic fixed-step simulation;
5. separate logical physics state from rendering backends;
6. permit pluggable physics solvers while maintaining a stable four.js API;
7. support rigid bodies, colliders, forces, impulses, constraints, joints, and
sensors;
8. support keyframe, procedural, skeletal, morph, path, and physics-driven
animation;
9. provide interpolation between simulation states for smooth rendering;
10. support worker-based and GPU-accelerated simulation;
11. enable engineering and scientific applications, not only games;
12. support serialization, replay, debugging, and reproducible simulation.
### 5. Non-Goals
The initial release shall not attempt to provide:
- a complete industrial finite-element solver;
- a certified safety-critical physics simulator;
- a complete computational fluid-dynamics package;
- a full CAD geometric kernel;
- a full game editor;
- an audio engine (the plugin system, §81, is the integration point for audio);
- a networking or replication layer (the "network" transform authority, §42, and the
snapshot and rollback facilities, §33-34, are enablers; transport and protocol belong
to plugins);
- exact real-world simulation across all scales.
These may be supported by plugins or specialized solver integrations.
Conformance language: the key words "must", "shall", "should", "may", and
"recommended" in this specification are interpreted as in RFC 2119 / BCP 14.
"Must" and "shall" denote hard requirements; "should" and "recommended" denote
defaults that require documented justification to deviate from; "may" denotes a true
option.
## Part I - Core Scene Architecture
### 6. Unified Node Model

```ts
abstract class Node {
  readonly id: string;
  name: string;
  parent: Node | null;
  readonly children: Node[];
  readonly transform: Transform;
  visible: boolean;
  enabled: boolean;
  opacity: number;
  tags: Set<string>;
  metadata: Record<string, unknown>;
  add(...nodes: Node[]): this;
  remove(...nodes: Node[]): this;
  traverse(visitor: (node: Node) => void): void;
}
```

Every node may optionally participate in:
- rendering;
- animation;
- input;
- physics;
- layout;
- audio (via plugins, §81 - an audio engine is a non-goal, §5);
- serialization.
The base Node should remain lightweight. Extended behavior should be attached through typed components or specialized subclasses.
### 6a. Component Model
Components attach typed behavior and state to nodes. Node gains:

```ts
interface Component {
  readonly node: Node | null;
  onAttach?(node: Node): void;
  onDetach?(node: Node): void;
  dispose?(): void;
}
abstract class Node {
  addComponent<T extends Component>(component: T): T;
  getComponent<T extends Component>(type: ComponentType<T>): T | undefined;
  removeComponent(component: Component): boolean;
}
```

Rules:
- at most one component of a given type per node; adding a second replaces the first
and emits a development warning;
- components hold behavior and state, but per-frame work is driven by systems (§39)
and the animation and physics packages - not by ad-hoc per-component callbacks in the
hot path (§64);
- lifecycle is explicit: `onAttach`, `onDetach`, `dispose`; detaching a node from the
scene does not dispose its components;
- `RigidBody` (§23), colliders (§24), and `MotionComponent` (§11) are components,
not Node subclasses;
- components serialize under registered type names (§79); plugins register theirs
(§81);
- components that write transforms are subject to transform authority (§42).
### 6b. Eventing
Nodes and the application expose one typed event API; `EventEmitter` (§104) is the
shared implementation.

```ts
interface EventEmitter<EventMap> {
  on<K extends keyof EventMap>(type: K, listener: (event: EventMap[K]) => void): () => void;
  once<K extends keyof EventMap>(type: K, listener: (event: EventMap[K]) => void): () => void;
  off<K extends keyof EventMap>(type: K, listener: (event: EventMap[K]) => void): void;
}
```

Rules:
- `on` returns an unsubscribe function; `once` removes the listener after one
delivery;
- listeners fire in registration order; listeners added or removed during dispatch
take effect from the next dispatch; an event does not re-enter its own dispatch;
- input events propagate through the scene graph in capture, target, and bubble
phases (§72); all other events fire on their emitter only;
- physics events (§29) dispatch after each fixed step, at step 9 of the §39 ordering
(after the sensor update that produces trigger transitions), never during the solver
step itself;
- application events `fixedUpdate`, `update`, and `render` follow the main-loop
contract of §10.
### 7. Transform System
Every node uses a common 3D transform representation.

```ts
class Transform {
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
  pivot: Vector3;
  localMatrix: Matrix4;
  worldMatrix: Matrix4;
  matrixAutoUpdate: boolean;
  version: number;
}
```

Transform semantics:
- the local matrix composes as `T · Tp · R · S · Tp⁻¹` (translation, then rotation
and scale about the pivot), so `pivot` affects rotation and scale but not `position`;
- writing `localMatrix` directly requires `matrixAutoUpdate = false`; the user then
owns the matrix, and position/rotation/scale are not back-derived from it;
- world matrices update lazily: they are resolved before each physics
synchronization point (once per fixed step, §37), before render-item generation
(§64), and on demand for queries;
- `version` increments on every local mutation so dependent systems can cache
against it.
Two-dimensional nodes normally use:

```ts
position.z = 0;
scale.z = 1;
```

The same transform hierarchy therefore supports:
- 2D scenes;
- 3D scenes;
- world-space UI;
- screen-space UI;
- billboards;
- planar diagrams in 3D;
- physics bodies;
- animated skeletons.
### 7a. Coordinate and Unit Conventions
One set of conventions covers 2D, 3D, UI, and physics:
- world space is right-handed with +Y up, for both 2D and 3D; a 2D scene is the XY
plane of the same space (§7), so 2D gravity is `(0, -9.81)` (§21);
- front faces wind counter-clockwise;
- every API angle is radians; degree input and display are a formatting concern
(§40);
- backend NDC and depth-range differences (WebGPU versus WebGL 2) are absorbed by
the projection matrix (§47) and never exposed to user code;
- screen and viewport spaces (§8) use a top-left origin in logical pixels by
default; `ScreenCamera` (§47) can select other origins;
- the default unit system is meter, kilogram, second, radian (§40); every engine
time is seconds (§9, §15-17, §45).
### 7b. Math Type Conventions
Math types (`Vector2/3/4`, `Quaternion`, `Matrix3/4`) follow one allocation policy:
- instances are mutable; instance methods mutate in place and return `this` for
chaining;
- `clone()` and static factory variants allocate; nothing else on a hot path does;
- sampling and query APIs accept an optional `out` parameter and return it (§13);
- steady-state per-frame engine code must not allocate math objects; the diagnostics
package flags violations (§83).
### 8. Space Modes

```ts
type SpaceMode =
  | "world"
  | "screen"
  | "viewport"
  | "camera"
  | "billboard"
  | "local-plane";
```

Physics normally operates in world or local-plane space. Screen-space UI
should not automatically participate in physical simulation unless explicitly
mapped to a simulation plane.
## Part II - Time and Motion Architecture
### 9. Clock and Time Domains
four.js must distinguish multiple time concepts.

```ts
interface TimeState {
  realTime: number;
  renderTime: number;
  simulationTime: number;
  deltaTime: number;
  unscaledDeltaTime: number;
  fixedDeltaTime: number;
  timeScale: number;
  paused: boolean;
  interpolationAlpha: number;
  frame: number;
  simulationStep: number;
  droppedTime: number;
}
```

Required time domains:
- real time - wall-clock elapsed time;
- render time - time used for visual presentation;
- simulation time - deterministic physics time;
- animation time - timeline or clip-local time;
- scaled time - affected by slow motion or pause;
- unscaled time - unaffected by simulation time scale.

```ts
app.time.scale = 0.25;
app.time.paused = false;
```

Individual systems may select a time source.
`deltaTime` is scaled by `timeScale`; `unscaledDeltaTime` is not. Animation time is
clip-local and lives on players and timelines (§16-17), not in the global
`TimeState`. `droppedTime` accumulates simulation time discarded by the substep clamp
(§10). All fields are seconds (§7a).
### 10. Main Loop
The application loop shall separate simulation from rendering.

```ts
app.on("fixedUpdate", ({ fixedDelta }) => {
    physics.step(fixedDelta);
});
app.on("update", ({ delta, alpha }) => {
    animation.update(delta);
    controls.update(delta);
});
app.on("render", () => {
    renderer.render(scene);
});
```

Recommended accumulator algorithm:

```ts
accumulator += elapsedRealTime * timeScale;
let steps = 0;
while (accumulator >= fixedDeltaTime && steps < maximumSubSteps) {
  previousState.copy(currentState);
  simulate(fixedDeltaTime);
  accumulator -= fixedDeltaTime;
  steps += 1;
}
if (accumulator >= fixedDeltaTime) {
  // long frame: drop the excess so simulation cost stays bounded
  droppedTime += accumulator - fixedDeltaTime;
  accumulator = fixedDeltaTime;
}
alpha = accumulator / fixedDeltaTime;
render(interpolate(previousState, currentState, alpha));
```

This design provides:
- stable physics;
- smooth rendering;
- deterministic playback;
- pause and step controls;
- slow motion;
- simulation replay.
The substep clamp (`maximumSubSteps`, §45; default in Appendix A) bounds simulation
work after long frames (background tabs, debugger pauses, GC hitches): excess
accumulated time is dropped, so simulation time falls behind real time instead of
entering a feedback spiral. Drops surface through `TimeState.droppedTime` (§9), a
diagnostics warning (§84), and the replay format (§34), which records per-frame
executed step counts and dropped time. After clamping, `interpolationAlpha` remains
in [0, 1].
When `paused` is true, the accumulator stops accumulating and `deltaTime` is 0,
while `unscaledDeltaTime`, `update`, and `render` continue. Pause is equivalent to
`timeScale = 0` except that `timeScale` is preserved across pause and resume.
### 11. Motion Components
A node may use a MotionComponent.

```ts
interface MotionComponent {
  linearVelocity: Vector3;
  angularVelocity: Vector3;
  linearAcceleration: Vector3;
  angularAcceleration: Vector3;
  damping: number;
  angularDamping: number;
  maxSpeed?: number;
  maxAngularSpeed?: number;
}
```

This component supports non-physics procedural motion and acts as a bridge
to physics solvers.
Example:

```ts
import { Vector3 } from "four/math";
import { MotionComponent } from "four/motion";

const motion = new MotionComponent({
    linearVelocity: new Vector3(2, 0, 0),
    angularVelocity: new Vector3(0, 1, 0)
});
node.addComponent(motion);
```

The class ships as `MotionComponent` (`Four.motion.MotionComponent` through the
umbrella barrel), not `Motion`; see §97a. A `MotionComponent` only moves a node
once a `MotionSystem` is registered and tracking it (§39).

### 12. Kinematic Motion
Kinematic controllers directly prescribe movement.

```ts
interface KinematicController {
  moveTo(position: Vector3, options?: MoveOptions): void;
  rotateTo(rotation: Quaternion, options?: RotateOptions): void;
  followPath(path: Curve, options?: PathFollowOptions): void;
}
```

Required kinematic features:
- velocity-based movement;
- target following;
- path following;
- steering behaviors;
- look-at constraints;
- orbit motion;
- spline motion;
- camera rigs;
- character controllers;
- motion limits.
### 13. Trajectory System

```ts
interface Trajectory {
  samplePosition(time: number, out?: Vector3): Vector3;
  sampleVelocity(time: number, out?: Vector3): Vector3;
  sampleAcceleration(time: number, out?: Vector3): Vector3;
  duration: number;
}
```

Trajectory `time` and `duration` are seconds (§7a).
Built-in trajectories:
- linear;
- parabolic;
- circular;
- elliptical;
- Bézier;
- Catmull-Rom spline;
- ballistic;
- damped spring;
- custom parametric trajectory.
This is useful for:
- engineering visualization;
- robotic motion;
- camera movement;
- projectile previews;
- educational simulations;
- animation paths.
## Part III - Animation Architecture
### 14. Animation System Requirements
four.js shall support:
- property animation;
- keyframe animation;
- timelines;
- easing;
- transform animation;
- skeletal animation;
- morph-target animation;
- material animation;
- path animation;
- procedural animation;
- spring animation;
- state machines;
- animation blending;
- additive animation;
- inverse kinematics;
- physics-animation blending;
- reduced-motion consultation (the application-level `reducedMotion` policy, §45 and
§75, exposed to animation code on an opt-in basis).
### 15. Tween API

```ts
import { animate } from "four/animation";

animate(node.position)
  .to({ x: 10, y: 5 }, 1.0)
  .ease("cubic-out")
  .play();
```

Durations and times throughout the animation API are seconds, matching the
engine-wide convention (§7a); nothing in four.js takes implicit milliseconds.
Required easing families:
- linear;
- quadratic;
- cubic;
- quartic;
- quintic;
- sine;
- exponential;
- circular;
- back;
- bounce;
- elastic;
- spring.

Each family but `linear` names three `EasingName` values — `"<family>-in"`,
`"<family>-out"`, `"<family>-in-out"` — so `.ease("spring")` is not a name;
`.ease("spring-out")` is (§97a).
### 16. Timeline API

```ts
import { Timeline, tween } from "four/animation";

const timeline = new Timeline();
timeline
  .at(0, tween(node.position, { x: 5 }, 0.8))
  .at(0.25, tween(node, { opacity: 0.5 }, 0.5))
  .at(1.0, () => console.log("complete"));
timeline.play();
```

Timeline requirements:
- nested timelines;
- labels;
- markers;
- sequencing;
- parallel tracks;
- looping;
- reversing;
- scrubbing;
- playback speed;
- pause and resume;
- event callbacks;
- deterministic evaluation.
Evaluation semantics:
- value tracks are a pure function of timeline time: evaluating at time `t` always
produces the same values, which is what scrubbing and deterministic evaluation
require;
- callbacks are event markers, not value tracks: they fire exactly once per forward
crossing during playback; `seek` and scrubbing suppress them by default, with an
opt-in per-marker replay-on-seek policy;
- property bindings are typed property references; string-path convenience forms are
resolved once, at creation time;
- when two active tweens target the same property, the last-started tween wins and a
development warning is emitted; tweens that write transforms additionally respect
transform authority (§42);
- replay (§34) re-executes playback, so markers re-fire exactly as in the original
run; restoring a mid-timeline snapshot positions playback without re-firing markers
already crossed.
### 17. Animation Clips and Tracks

```ts
class AnimationClip {
  name: string;
  duration: number;
  tracks: AnimationTrack[];
  events: AnimationEvent[];
}
```

`duration` and track times are seconds (§7a).
Track types:
- scalar;
- vector;
- quaternion;
- color;
- Boolean;
- discrete;
- morph weight;
- skeletal joint;
- custom property.
Interpolation modes:
- step;
- linear;
- cubic;
- Hermite;
- spherical linear interpolation for quaternions.
### 18. Animation State Machines
The target form — a declarative controller owning states and transitions:

```ts
const controller = new AnimationController({
    states: {
      idle: idleClip,
      walk: walkClip,
      run: runClip
    },
    transitions: [
      { from: "idle", to: "walk", when: "speed > 0.1" },
      { from: "walk", to: "run", when: "speed > 5" }
    ]
});
```

`AnimationController` is **not implemented** (§97a). The available-today form is
an `AnimationMixer` per node plus application-side selection; it has no
transition durations, no exit time, and no blend trees, and it is not a
substitute for this section — it is what this section is scheduled to replace:

```ts
import { AnimationMixer, AnimationSystem } from "four/animation";

const animation = new AnimationSystem();
app.systems.register(animation);

const LOOP = { loop: Number.POSITIVE_INFINITY };
let current = idleClip;
let mixer = animation.track(new AnimationMixer(character).play(current, LOOP));

// The transition condition, evaluated by the application once per fixed step.
app.on("fixedUpdate", () => {
    const next = speed > 5 ? runClip : speed > 0.1 ? walkClip : idleClip;
    if (next === current) return;
    // A played mixer binds once (§16), so a state change is a new mixer: `stop`
    // releases the property claims, and the successor takes them uncontested.
    animation.untrack(mixer);
    mixer.stop();
    current = next;
    mixer = animation.track(new AnimationMixer(character).play(next, LOOP));
});
```

State machine features:
- parameters;
- Boolean conditions;
- numeric comparisons;
- triggers;
- transition duration;
- exit time;
- transition interruption;
- blend trees;
- layered animation.
### 19. Physics-Animation Blending
Which system moves a node is governed by its transform authority (§42). The
`"blended"` authority selects the blending pipeline defined in this section.
Examples:
- animated door controlled by a timeline;
- physically simulated door connected by a hinge;
- kinematic robot arm following a commanded path;
- character with animated limbs and physically simulated ragdoll response.

```ts
body.transformAuthority = "blended";
body.physicsWeight = 0.35;
body.animationWeight = 0.65;
```

The implementation must define conflict resolution clearly.
Recommended rule:
1. animation produces a target pose;
2. kinematic controllers may modify the target;
3. physics solves constraints and forces;
4. final rendered pose is interpolated;
5. optional blending combines animated and physical poses.
## Part IV - Physics Architecture
### 20. Physics as a First-Class System
four.js should expose a stable, renderer-independent physics API.
The core framework may use adapter-backed solvers, but users should not need
to write solver-specific application code for common tasks.

```ts
import { Vector3 } from "four/math";
import { PhysicsWorld } from "four/physics";
import { Rapier3dAdapter } from "four/physics-rapier";

const world = new PhysicsWorld({
    dimension: "3d",
    gravity: new Vector3(0, -9.81, 0),
    adapter: new Rapier3dAdapter()
});
await world.initialize();
```

The world takes an **adapter instance**; the `solver: "auto"` string form of
§37's capability-driven selection is deferred to the same registry work as
`renderer: "auto"` (§97a). Swapping solvers is still the one line this section
promises: it is the `adapter` argument, and nothing above it changes.

### 21. Physics Dimensions

```ts
type PhysicsDimension = "2d" | "3d";
```

The API should be conceptually consistent across both dimensions.

```ts
const world2D = new Four.PhysicsWorld({
    dimension: "2d",
    gravity: new Vector2(0, -9.81)
});
const world3D = new Four.PhysicsWorld({
    dimension: "3d",
    gravity: new Vector3(0, -9.81, 0)
});
```

The internal solver may differ, but common operations should use parallel naming and semantics.
Typing strategy: the public physics API is typed once, in 3D (`Vector3`,
quaternions), for both dimensions. A `"2d"` world constrains motion to the XY plane
and rotation to the Z axis - semantically a plane constraint - and accepts `Vector2`
arguments as a convenience that widens to `Vector3` with `z = 0`. Both dimensions
share the Y-up convention of §7a, so gravity is negative Y in 2D and 3D alike.
Nodes simulating in local-plane space (§8) use the plane's own 2D frame, which the
engine maps to the world XY frame of the `"2d"` world.
### 22. Body Types

```ts
type BodyType =
  | "static"
  | "dynamic"
  | "kinematic-position"
  | "kinematic-velocity";
```

Static
Does not move and is unaffected by forces.
Dynamic
Moves according to mass, force, collisions, and constraints.
Kinematic position
Moves toward prescribed positions.
Kinematic velocity
Moves using prescribed velocity.
### 23. Rigid Body

```ts
class RigidBody {
  type: BodyType;
  mass: number;
  readonly inverseMass: number;
  centerOfMass: Vector3;
  inertiaTensor: Matrix3;
  linearVelocity: Vector3;
  angularVelocity: Vector3;
  linearDamping: number;
  angularDamping: number;
  gravityScale: number;
  readonly sleeping: boolean;
  continuousCollisionDetection: boolean;
  wake(): void;
  sleep(): void;
  applyForce(force: Vector3): void;
  applyForceAtPoint(force: Vector3, worldPoint: Vector3): void;
  applyTorque(torque: Vector3): void;
  applyImpulse(impulse: Vector3): void;
  applyImpulseAtPoint(impulse: Vector3, worldPoint: Vector3): void;
  applyAngularImpulse(impulse: Vector3): void;
}
```

Mass and state rules:
- `mass` is authoritative and settable; `inverseMass` is derived and read-only;
- when `mass` is omitted it defaults to collider density times volume (§24-25); an
explicit `mass` overrides density;
- `mass` must be positive on dynamic bodies (validated, §85); non-simulated mass is
expressed through the static and kinematic body types, never `mass = 0`;
- `sleeping` is read-only state; `wake()` and `sleep()` are the explicit commands
(§32);
- in `"2d"` worlds, rotational inertia is the scalar Z-diagonal entry of
`inertiaTensor`; the remaining entries are ignored (§21).

### 24. Collider System

```ts
interface Collider {
  shape: CollisionShape;
  offset: Transform;
  friction: number;
  restitution: number;
  density: number;
  sensor: boolean;
  collisionGroups: number;
  collisionMask: number;
}
```

Required collision shapes:
2D
- circle;
- rectangle;
- capsule;
- polygon;
- polyline;
- chain;
- compound shape.
3D
- sphere;
- box;
- capsule;
- cylinder;
- cone;
- convex hull;
- triangle mesh;
- height field;
- compound shape.
### 25. Physics Materials

```ts
class PhysicsMaterial {
  friction: number;
  restitution: number;
  rollingFriction?: number;
  spinningFriction?: number;
  density: number;
}
```

Combination rules:

```ts
type CombineMode =
  | "average"
  | "minimum"
  | "maximum"
  | "multiply";
```

`Collider.density` (§24) is authoritative for mass derivation (§23);
`PhysicsMaterial.density` is a fallback used only when the collider does not set
one.

### 26. Forces and Impulses
Required force APIs:

```ts
body.applyForce(force);
body.applyForceAtPoint(force, worldPoint);
body.applyTorque(torque);
body.applyImpulse(impulse);
body.applyImpulseAtPoint(impulse, worldPoint);
body.applyAngularImpulse(angularImpulse);
```

`worldPoint` is a world-space position. These signatures are the single canonical
force API and match the `RigidBody` declaration in §23.
Force generators may include:
- gravity;
- drag;
- springs;
- buoyancy;
- wind;
- magnetic approximations;
- attractors;
- repulsors;
- custom fields.
### 27. Force Fields

```ts
interface ForceField {
  sample(
    position: Vector3,
    velocity: Vector3,
    time: number,
    out?: Vector3
  ): Vector3;
}
```

Built-in field types:
- uniform gravity;
- radial gravity;
- vortex;
- wind;
- drag volume;
- turbulence/noise;
- spring field;
- user-defined callback;
- GPU field.
Force fields should support volume-based inclusion and filtering.
### 28. Constraints and Joints
Required joint types:
Shared concepts
- fixed;
- distance;
- spring;
- revolute/hinge;
- prismatic/slider;
- spherical/ball;
- rope;
- gear;
- motorized joint.

```ts
const hinge = new Four.HingeJoint({
    bodyA,
    bodyB,
    anchor,
    axis,
    limits: {
      min: -Math.PI / 2,
      max: Math.PI / 2
    },
    motor: {
      enabled: true,
      targetVelocity: 2,
      maxTorque: 50
    }
});
```

Constraint features:
- limits;
- motors;
- springs;
- damping;
- break force;
- break torque;
- collision enable/disable;
- solver iterations.
### 29. Collision Events

```ts
body.on("collisionstart", event => {});
body.on("collisionstay", event => {});
body.on("collisionend", event => {});
sensor.on("triggerenter", event => {});
sensor.on("triggerexit", event => {});
```

Collision and trigger events dispatch after each fixed step, per the eventing rules
of §6b and the ordering of §39; adapters never invoke user callbacks during the
solver step (§37).
Collision event data:

```ts
interface CollisionEvent {
  bodyA: RigidBody;
  bodyB: RigidBody;
  colliderA: Collider;
  colliderB: Collider;
  contacts: ContactPoint[];
  relativeVelocity: Vector3;
  totalImpulse: Vector3;
}
```

### 30. Queries
Required physics queries:

```ts
world.raycast(ray, options);
world.shapeCast(shape, transform, direction, options);
world.overlapSphere(center, radius, options);
world.overlapBox(center, halfExtents, rotation, options);
world.pointQuery(point, options);
```

Queries should support:
- collision groups;
- masks;
- ignored bodies;
- first hit;
- all hits;
- sorted hits;
- sensor inclusion;
- custom filters.
In `"2d"` worlds the overlap queries operate in the XY plane (`overlapSphere` as a
circle, `overlapBox` as a rectangle), preserving §21's parallel-naming rule without
a second API surface.
### 31. Continuous Collision Detection
Fast objects may tunnel through thin geometry. four.js shall provide optional
continuous collision detection.

```ts
body.continuousCollisionDetection = true;
```

Possible modes:

```ts
type CCDMode =
  | "disabled"
  | "speculative"
  | "swept";
```

### 32. Sleeping
Dynamic bodies at rest should sleep to improve performance.

```ts
world.sleeping = {
  enabled: true,
  linearThreshold: 0.01,
  angularThreshold: 0.01,
  timeThreshold: 0.5
};
```

Users should be able to wake bodies explicitly.
### 33. Determinism
four.js should define determinism tiers.

```ts
type DeterminismLevel =
  | "none"
  | "same-runtime"
  | "same-platform"
  | "cross-platform";
```

The initial target should be same-runtime deterministic simulation when:
- the same solver is used;
- the same timestep is used;
- the same input sequence is used;
- multithreaded nondeterministic paths are disabled.
The engine should support:
- seeded random number generators;
- recorded inputs;
- state snapshots;
- replay;
- rollback;
- checksums.
Tier definitions and known hazards:
- `same-runtime`: identical results for the same build on the same JS engine, OS,
and hardware. This is the initial target.
- `same-platform`: additionally stable across runs and engine minor versions on one
platform; this requires avoiding JS `Math` transcendentals in simulation paths
(their results legally vary between engines), for example via a deterministic math
kernel or WebAssembly.
- `cross-platform`: additionally stable across OS and hardware; effectively the
whole simulation path, including the solver, must run in deterministic WebAssembly
or software floating point.
Simulation code must iterate collections in insertion order and must not derive
behavior from object-key enumeration or `Set`/`Map` ordering beyond insertion
order. Event and callback dispatch order must be deterministic (§6b). Solver
adapters declare their achievable tier in `PhysicsCapabilities` (§37).
Checksum definition: unless configured otherwise, the per-step checksum is FNV-1a
over each existing body's transform and velocities (sleeping bodies included),
quantized to 1e-6, visited in ascending engine-assigned monotonic body id - an
order well-defined across body destruction (§37) and preserved by snapshot restore
(§34). The determinism tests of §92 compare these checksums.
### 34. Physics Snapshots and Replay

```ts
const snapshot = world.createSnapshot();
world.restoreSnapshot(snapshot);
```

Use cases:
- debugging;
- network rollback;
- deterministic tests;
- simulation comparison;
- education;
- engineering analysis.
A replay format should store:
- initial scene state;
- solver settings;
- time step;
- random seed;
- external inputs, indexed by simulation step;
- per-frame executed fixed-step counts and dropped time (§10);
- optional periodic snapshots.
Snapshots are opaque adapter data: a snapshot is valid only for the same adapter,
adapter version, and world configuration that produced it (§37). The replay format
therefore records the adapter name and version, and a replay refuses to run against
a different solver.
### 35. Soft Bodies and Deformables
Soft-body support should be a later module.
Potential features:
- cloth;
- ropes;
- deformable surfaces;
- volume preservation;
- position-based dynamics;
- mass-spring systems;
- shape matching.

```text
@four/physics-soft
```

This should not block the core rigid-body MVP.
### 36. Particles
Particles should support both visual-only and physically simulated modes.

```ts
const emitter = new Four.ParticleEmitter({
    maxParticles: 100000,
    simulation: "gpu",
    forces: [gravity, wind],
    collisions: "depth-buffer"
});
```

Particle features:
- CPU simulation;
- GPU compute simulation;
- emitters;
- lifetimes;
- velocity distributions;
- forces;
- color and size over lifetime;
- collision;
- trails;
- attractors;
- custom data channels.
### 37. Physics Solver Adapter

```ts
interface PhysicsSolverAdapter {
  readonly name: string;
  readonly version: string;
  readonly capabilities: PhysicsCapabilities;
  initialize(options: PhysicsWorldOptions): Promise<void> | void;
  createBody(desc: RigidBodyDescriptor): PhysicsBodyHandle;
  destroyBody(handle: PhysicsBodyHandle): void;
  createCollider(desc: ColliderDescriptor): PhysicsColliderHandle;
  destroyCollider(handle: PhysicsColliderHandle): void;
  createJoint(desc: JointDescriptor): PhysicsJointHandle;
  destroyJoint(handle: PhysicsJointHandle): void;
  step(delta: number): void;
  drainEvents(): PhysicsEvent[];
  syncSceneToSolver(): void;
  syncSolverToScene(): void;
  raycast(query: RaycastQuery): RaycastHit[];
  shapeCast(query: ShapeCastQuery): ShapeCastHit[];
  overlap(query: OverlapQuery): OverlapHit[];
  pointQuery(query: PointQuery): PointHit[];
  createSnapshot?(): ArrayBuffer;
  restoreSnapshot?(snapshot: ArrayBuffer): void;
  dispose(): void;
}
```

Adapter contract:
- `syncSceneToSolver` pushes scene-authored state into the solver (kinematic
targets, teleports, property changes); `syncSolverToScene` publishes solved body
transforms back to the scene. The physics package calls them around `step` per the
§39 ordering. The "previous" pose used for render interpolation (§43) is the
solver's pre-step body state, retained by the physics package; interpolated render
poses are presentation-only and are never captured as a previous pose or written
back (§43).
- `drainEvents` returns the contact, trigger, and sleep events accumulated during
the preceding `step`; the physics package normalizes them (§101) and dispatches
them after the fixed step (§6b, §29). Adapters never invoke user callbacks
directly.
- The query methods implement the §30 query set; capability flags declare which are
supported.

```ts
interface PhysicsCapabilities {
  dimensions: PhysicsDimension[];
  jointTypes: string[];
  ccdModes: CCDMode[];
  determinism: DeterminismLevel;
  snapshots: boolean;
  queries: {
    raycast: boolean;
    shapeCast: boolean;
    overlap: boolean;
    point: boolean;
  };
}
```

Capability declarations drive `solver: "auto"` selection (§20) and the
compatibility tables of §90.
Potential adapters:
- Rapier 2D/3D;
- Box2D;
- Matter.js;
- Cannon-es;
- Ammo.js;
- custom engineering solvers.
The stable four.js API should sit above these adapters.
## Part V - Numerical Integration and Simulation
### 38. Integrators
For built-in lightweight motion, four.js should provide:

```ts
type Integrator =
  | "explicit-euler"
  | "semi-implicit-euler"
  | "velocity-verlet"
  | "rk2"
  | "rk4";
```

Recommended defaults:
- semi-implicit Euler for simple real-time rigid motion;
- velocity Verlet for conservative particle systems;
- RK4 for small, smooth engineering demonstrations where accuracy matters more than cost.
The full rigid-body solver adapter may use its own integration method.
### 39. Simulation Systems

```ts
interface SimulationSystem {
  priority: number;
  initialize(context: SimulationContext): void;
  fixedUpdate(context: FixedUpdateContext): void;
  dispose(): void;
}
```

Example system order:
1. Input sampling
2. Command processing
3. Animation target evaluation
4. Kinematic motion
5. Force generation
6. Physics solve
7. Constraint solve
8. Sensor update
9. Collision event dispatch
10. State snapshot
11. Render interpolation
The ordering must be explicit and configurable.
### 40. Units
four.js should not silently assume that one world unit is always one meter.

```ts
interface UnitSystem {
  length: "meter" | "centimeter" | "millimeter" | "custom";
  mass: "kilogram" | "gram" | "custom";
  time: "second" | "millisecond";
  angle: "radian" | "degree";
  scale: {
    lengthToMeters: number;
    massToKilograms: number;
  };
}
```

Recommended physics default:

```text
length = meter
mass = kilogram
time = second
angle = radian
```

Engineering applications must be able to declare and display units explicitly.
The `angle` and `time` selections govern display and authoring-input conversion
only: the engine's internal representation and every API signature remain radians
and seconds (§7a). The `scale` factors relate world units to SI for physics; they do
not change API units.
### 41. Numerical Stability Guidance
The engine documentation should explain:
- why very large mass ratios can destabilize solvers;
- why extremely small or large world scales are problematic;
- why fixed timesteps are preferred;
- how solver iterations affect stability;
- how collision margins work;
- how damping differs from friction;
- how continuous collision detection affects performance.
The diagnostics package should warn about suspicious values.
Precision at scale: 32-bit float positions lose sub-millimeter fidelity beyond
roughly 1e5 length units from the origin. Release 1.0 supports coordinates within
that envelope, and validation (§85) warns beyond it. Camera-relative rendering
(subtracting the eye position before matrix composition) is the reserved extension
for larger worlds, and render-item generation (§64) must not preclude it.
`TimeState.realTime` (§9) is a double and stays precise over multi-day sessions;
long-running applications should prefer relative times.
## Part VI - Rendering and Motion Synchronization
### 42. Transform Authority
A transform may be controlled by:

```ts
type TransformAuthority =
  | "manual"
  | "animation"
  | "kinematic"
  | "physics"
  | "blended"
  | "constraint"
  | "network";
```

The engine must prevent multiple systems from silently overwriting the same
transform.

```ts
node.transformAuthority = "physics";
```

Conflicts should produce development warnings.
Exactly one authority owns a node's transform at a time. `"blended"` designates the
physics-animation blending pipeline of §19 as that single owner; blend weights vary
inside the pipeline without changing ownership. A development warning fires whenever
a system writes a transform it does not own. `"network"` marks externally replicated
transforms and is an enabler only - transport and replication protocols are out of
scope (§5).
### 43. Physics-to-Render Synchronization
Physics state updates at fixed intervals. Rendering may occur at a different
rate.

```ts
renderPosition = lerp(
  previousPhysicsPosition,
  currentPhysicsPosition,
  interpolationAlpha
);
```

Rotations should use quaternion spherical interpolation.
The render transform should not feed back into the physics state unless explicitly
requested.
### 44. Camera Motion
Cameras should support:
- orbit control;
- fly control;
- first-person control;
- trackball control;
- follow rigs;
- spring arms;
- shake;
- path animation;
- physics attachment.
Camera motion should use the same timeline, constraint, and motion systems
as ordinary nodes.
## Part VII - Complete Graphics, Rendering, Application, and Platform Architecture
Part VII groups its sections as follows: Application and Scene Services (§45-48),
Renderables and 2D Vector Graphics (§49-52), Geometry, Materials, and Shading
(§53-60a), Renderer
Core (§61-67), Lighting and Post-Processing (§68-70), Interaction and UI (§71-75),
Assets and Serialization (§76-81), Platform and Runtime (§82-90), Process and
Quality (§91-96), Worked Example and Conventions (§97-97a).

**Application and Scene Services (§45-§48)**
### 45. Application Model

The high-level Application object owns the default scene, renderer, time system, simulation scheduler, input routing, assets, diagnostics, cameras, and viewports.

```ts
const app = new Four.Application({
    canvas: document.querySelector("canvas"),
    renderer: "auto",
    antialias: true,
    resolution: window.devicePixelRatio,
    fixedTimeStep: 1 / 60,
    physics: { solver: "rapier", dimension: "3d" }
});
await app.initialize();
app.start();
```

```ts
interface ApplicationOptions {
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  renderer?: "auto" | "webgpu" | "webgl2" | "canvas2d" | "svg";
  width?: number;
  height?: number;
  resolution?: number;
  antialias?: boolean;
  alpha?: boolean;
  powerPreference?: "low-power" | "high-performance";
  autoResize?: boolean;
  reducedMotion?: "auto" | boolean;
  fixedTimeStep?: number;
  maximumSubSteps?: number;
  physics?: PhysicsWorldOptions | false;
}
```

The application lifecycle shall expose:
- initialize;
- start;
- stop;
- pause;
- resume;
- step;
- resize;
- dispose.
The application must permit advanced users to construct and own these systems
independently rather than requiring the convenience wrapper.
### 46. Scene Queries, Layers, and Tags
A Scene provides indexed lookup by identifier, name, type, tag, component, and
optional selector syntax.

```ts
scene.findById("motor-01");
scene.findByName("bearing");
scene.findByTag("sensor");
scene.findByComponent(RigidBody);
scene.query("Mesh.dynamic[visible=true]");
```

Symbolic layers control:
- camera visibility;
- rendering order;
- physics interaction groups;
- picking and pointer interaction;
- post-processing inclusion;
- editor-only objects;
- debug visualization.
Layers should compile to efficient masks internally while preserving human-readable names in the public API and serialized scene files.
### 47. Camera System
Required camera types:
- PerspectiveCamera;
- OrthographicCamera;
- ScreenCamera;
- ObliqueCamera;
- custom projection camera.

```ts
abstract class Camera extends Node {
  near: number;
  far: number;
  projectionMatrix: Matrix4;
  inverseProjectionMatrix: Matrix4;
  viewMatrix: Matrix4;
  layers: LayerMask;
}
```

ScreenCamera shall support top-left, bottom-left, and centered origins with
logical-pixel or physical-pixel units.
Camera rigs shall include:
- orbit;
- fly;
- first-person;
- trackball;
- follow target;
- spring arm;
- stereo/XR extension point;
- shake and impulse effects.
### 48. Viewports and Render Surfaces
A viewport maps one camera to a rectangular region and optional render target.

```ts
interface Viewport {
  id: string;
  camera: Camera;
  normalized?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  clearColor?: Color;
  clearDepth?: number;
  layerMask?: LayerMask;
  renderTarget?: RenderTarget;
  postProcessing?: RenderPipeline;
}
```

Supported use cases:
- split-screen;
- minimaps;
- CAD orthographic views;
- picture-in-picture;
- editor panels;
- offscreen textures;
- mirrors and portals;
- 3D model previews inside 2D UI.

**Renderables and 2D Vector Graphics (§49-§52)**
### 49. Renderable Node Hierarchy

```text
Renderable
+-- Shape2D
| +-- Circle
| +-- Ellipse
| +-- Rectangle
| +-- RoundedRectangle
| +-- Polygon
| +-- Polyline
| +-- Arc
| +-- Path
+-- Sprite
+-- Text
+-- Mesh
+-- Line3D
+-- PointCloud
+-- ParticleSystem
+-- CustomRenderable
```

```ts
abstract class Renderable extends Node {
  material: Material | Material[];
  renderLayer: number;
  renderOrder: number;
  depthMode: "normal" | "always-front" | "always-back" | "disabled";
  castShadow: boolean;
  receiveShadow: boolean;
  frustumCulled: boolean;
}
```

### 50. Native 2D Shape System
Required shape primitives:
- circle;
- ellipse;
- rectangle;
- rounded rectangle;
- regular polygon;
- arbitrary polygon;
- star;
- line;
- polyline;
- arc;
- sector;
- ring;
- path;
- Bézier path.

```ts
const rectangle = new Four.Rectangle({
    width: 200,
    height: 100,
    radius: 12,
    fill: "#4466ff",
    stroke: { color: "#ffffff", width: 3 }
});
```

Shape requirements:
- fill and stroke;
- fill opacity and stroke opacity;
- stroke alignment;
- dashes and dash offset;
- miter, bevel, and round joins;
- butt, square, and round caps;
- clipping and masks;
- Boolean geometry operations;
- local and world bounds;
- analytic hit testing where possible;
- SVG import/export compatibility.
### 51. Path Model

```ts
const path = new Four.Path();
path.moveTo(0, 0);
path.lineTo(100, 0);
path.quadraticCurveTo(150, 50, 100, 100);
path.cubicCurveTo(75, 125, 25, 125, 0, 100);
path.arc(0, 50, 25, 0, Math.PI);
path.close();
```

Required operations:
- move;
- line;
- quadratic Bézier;
- cubic Bézier;
- circular and elliptical arc;
- close path;
- flatten;
- subdivide;
- simplify;
- reverse;
- transform;
- compute length;
- evaluate point, tangent, and normal;
- closest-point query;
- offset path;
- union, intersection, subtraction, and xor.
Fill rules:
- nonzero;
- even-odd.
### 52. Tessellation and Stroke Generation
2D paths must be converted into GPU-ready geometry while retaining vector-level source data.
The tessellation subsystem shall support:
- concave polygons;
- holes;
- self-intersections where well-defined;
- adaptive curve subdivision;
- stroke expansion;
- anti-alias fringe generation;
- index-buffer reuse;
- incremental rebuild of modified path segments;
- optional compute-based tessellation in later releases.
The tessellator shall be an isolated module of `@four/geometry` with a stable interface so implementations can be replaced without changing the scene API. (A dedicated package remains a possible future split; §98 stays authoritative for the package set.)

**Geometry, Materials, and Shading (§53-§60a)**
### 53. Geometry Architecture

```ts
abstract class Geometry implements Disposable {
  readonly id: string;
  version: number;
  bounds: BoundingVolume;
  computeBounds(): void;
  clone(): Geometry;
  dispose(): void;
}
```

```text
Geometry
+-- Geometry2D
| +-- PathGeometry2D
| +-- FillGeometry2D
| +-- StrokeGeometry2D
+-- Geometry3D
+-- BufferGeometry
+-- IndexedGeometry
+-- ProceduralGeometry
```

Required 3D primitives:
- plane;
- box;
- sphere;
- cylinder;
- cone;
- capsule;
- torus;
- lathe;
- extrusion;
- tube;
- height field.
Standard attributes:
- position;
- normal;
- tangent;
- color;
- uv and secondary uv;
- joints and weights;
- instance transform;
- custom typed attributes.
### 54. Mesh, Instancing, and Level of Detail

```ts
class Mesh extends Renderable {
  geometry: Geometry3D;
  material: Material | Material[];
  morphTargetWeights?: Float32Array;
  skeleton?: Skeleton;
}
```

The engine shall support:
- indexed and non-indexed geometry;
- multiple material groups;
- hardware instancing;
- indirect rendering where supported;
- morph targets;
- skeletal deformation;
- static and dynamic GPU buffers;
- level-of-detail selection;
- impostors and billboards;
- geometry merging and batching tools.
### 55. Sprite and Raster System
Sprites shall support:
- screen-space and world-space sizing;
- anchors and pivots;
- atlases and frame regions;
- nine-slice scaling;
- tint and opacity;
- billboarding modes;
- per-instance data;
- alpha masks;
- normal-mapped sprites as an extension;
- sprite animation clips.

```ts
class Sprite extends Renderable {
  texture: Texture;
  frame?: Rectangle2;
  anchor: Vector2;
  sizeMode: "pixels" | "world";
  billboardMode: "none" | "spherical" | "cylindrical";
}
```

### 56. Text and Typography
Text is a core capability rather than a UI-only afterthought.
Requirements:
- Unicode;
- font fallback;
- bidirectional layout;
- ligatures;
- kerning;
- shaping;
- line breaking and wrapping;
- horizontal and vertical alignment;
- letter and word spacing;
- rich text spans;
- text along paths;
- world-space, billboard, and screen-space text;
- bitmap, signed-distance-field, and multi-channel SDF rendering;
- selection and caret support in UI text inputs;
- accessible semantic mirror.
MVP tier: initial releases may ship bitmap/SDF text with basic Latin-script layout
only. Full shaping, bidirectional layout, and ligatures are staged behind a
shaping-engine decision (for example HarfBuzz via WebAssembly versus a native
implementation), to be recorded by amendment before that work begins.

```ts
const label = new Four.Text({
    text: "Motor Temperature",
    fontFamily: "Inter",
    fontSize: 22,
    fontWeight: 600,
    color: "#ffffff",
    space: "billboard"
});
```

### 57. Unified Material Model
Shared material properties:

```ts
abstract class Material implements Disposable {
  opacity: number;
  transparent: boolean;
  blendMode: BlendMode;
  depthTest: boolean;
  depthWrite: boolean;
  colorWrite: boolean;
  stencil?: StencilState;
  dispose(): void;
}
```

Material families:

```text
Material
+-- ShapeMaterial
+-- SpriteMaterial
+-- TextMaterial
+-- LineMaterial
+-- UnlitMaterial
+-- StandardMaterial
+-- PhysicalMaterial
+-- ShaderMaterial
+-- NodeMaterial
+-- ComputeMaterial
```

The API unifies lifecycle and render state while preserving specialized 2D and
3D properties.
### 58. Paints, Fills, and Strokes
A shape paint may be:
- solid color;
- linear gradient;
- radial gradient;
- conic gradient;
- image pattern;
- procedural shader;
- render-target texture.

```ts
interface StrokeStyle {
  paint: Paint;
  width: number;
  alignment: "inside" | "center" | "outside";
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  miterLimit: number;
  dash?: number[];
  dashOffset?: number;
}
```

### 59. Physically Based Materials
StandardMaterial shall implement a metallic-roughness workflow compatible
with glTF conventions.

```ts
const material = new Four.StandardMaterial({
    baseColor: "#a0a0a0",
    roughness: 0.6,
    metalness: 0.1,
    normalMap,
    occlusionMap,
    emissive: "#000000"
});
```

Later physical extensions may include:
- clearcoat;
- transmission;
- index of refraction;
- sheen;
- anisotropy;
- subsurface approximation;
- iridescence.
### 60. Shader and Node-Material System
Advanced users require a backend-independent shader model.

```ts
const material = new Four.NodeMaterial();
const albedo = material.texture(albedoTexture);
const pulse = material.sin(material.time().multiply(2));
material.output.color = albedo.multiply(pulse.add(1));
```

The compiler should generate:
- WGSL for WebGPU;
- GLSL ES for WebGL 2;
- reduced fallbacks for Canvas/SVG where meaningful.
Shader features:
- reusable functions;
- uniforms and uniform blocks;
- vertex attributes;
- storage buffers;
- textures and samplers;
- conditional variants;
- reflection metadata;
- source maps and readable compiler diagnostics.
### 60a. Color Management
The rendering pipeline is linear-light on the GPU backends:
- color textures default to sRGB-encoded and are decoded to linear on sample; data
maps (normal, roughness, occlusion) default to linear - both via the color-space
metadata of §77;
- lighting and blending run in linear space on WebGPU and WebGL 2;
- the output transform - tone mapping (§68) followed by sRGB encoding - is the
final render-graph pass (§63); render targets carry color-space metadata;
- CSS-style color strings used throughout the API (§50, §59, §68) denote sRGB
values;
- the Canvas 2D and SVG backends operate sRGB-native; their divergence from
linear-light results is documented under §62's capability tiers.

**Renderer Core (§61-§67)**
### 61. Renderer Interface

```ts
interface Renderer {
  readonly capabilities: RendererCapabilities;
  initialize(options: RendererOptions): Promise<void>;
  render(scene: Scene, views: readonly Viewport[]): void;
  resize(width: number, height: number, resolution: number): void;
  createTexture(source: TextureSource): Texture;
  createRenderTarget(options: RenderTargetOptions): RenderTarget;
  readPixels?(target: RenderTarget, region?: Rectangle2): Promise<ArrayBuffer>;
  dispose(): void;
}
```

The logical scene shall remain independent of the selected backend.
Device and context loss (WebGL context loss, WebGPU device loss) is a first-class
event, not an error case. The renderer emits `contextlost` and `contextrestored`,
re-creates engine-owned GPU resources (pipelines, internal buffers, render targets)
on restore, and re-uploads user resources that retain CPU-side sources; resources
without retained sources expose a documented re-upload hook. Error codes are defined
in §89; the required integration test in §92.
### 62. Rendering Backends and Capability Tiers
Supported backends:
1. WebGPU;
2. WebGL 2;
3. Canvas 2D;
4. SVG;
5. headless/software extension.

```ts
renderer: "auto"
```

Automatic selection should prefer WebGPU, then WebGL 2, then an appropriate
2D backend.
If WebGPU initialization fails at runtime under `"auto"`, selection falls back to
WebGL 2 and emits a diagnostics event; an explicit `renderer: "webgpu"` fails fast
with `RENDERER_INITIALIZATION_FAILED` (§89) rather than silently downgrading.
Headless *simulation* - running the scene and physics with no renderer - is core
behavior from Phase 1 (§104); the headless/software *rendering* tier above is the
later extension.
Capability reporting shall include:
- maximum texture dimensions;
- texture formats;
- multisampling;
- floating-point targets;
- timestamp queries;
- storage buffers;
- compute shaders;
- indirect draw;
- compressed textures;
- shader precision;
- maximum uniforms and bindings.
Applications may declare required and optional capabilities.
### 63. Render Graph
Rendering shall be organized as a directed acyclic graph of passes and resources.

```text
Scene Preparation
v
Depth Prepass (optional)
v
Shadow Passes
v
Opaque World
v
Transparent World
v
World-Space Vectors and Text
v
Post-Processing
v
Screen-Space UI
v
Final Composite
```

```ts
const graph = new Four.RenderGraph();
graph.addPass("world", worldPass);
graph.addPass("bloom", bloomPass, { inputs: ["world"] });
graph.addPass("ui", uiPass);
graph.addPass("composite", compositePass, { inputs: ["bloom", "ui"] });
```

The graph shall manage:
- pass dependencies;
- transient render targets;
- resource lifetime;
- barriers and state transitions;
- pass enable/disable;
- viewport-specific pipelines;
- debug visualization.
### 64. Render Preparation and Submission
The renderer pipeline shall separate:
1. scene traversal;
2. visibility and layer filtering;
3. frustum and occlusion culling;
4. render-item generation;
5. sorting;
6. batching and instancing;
7. backend command encoding;
8. GPU submission.
Avoid per-node virtual calls in the final drawing hot path. Renderables should
compile into compact render items and backend-native pipelines.
### 65. Batching and Instancing
Automatic batching strategies:
- sprite batching;
- glyph batching;
- compatible shape batching;
- instanced meshes;
- material sorting;
- pipeline sorting;
- texture atlas grouping;
- persistent mapped or staged buffers;
- multi-draw/indirect draw where available.
Batching shall be transparent to ordinary users but inspectable through diagnostics.
### 66. Ordering, Transparency, and Composition
Default sorting order:
1. render layer;
2. opaque versus transparent classification;
3. pipeline/material compatibility;
4. depth;
5. explicit render order.
The engine must document limitations of transparent sorting and provide:
- order-independent transparency extension points;
- weighted blended transparency option;
- depth prepass control;
- explicit object ordering;
- alpha test and alpha-to-coverage;
- premultiplied and straight alpha policies.
Screen-space UI normally renders after world content. World-space 2D geometry
normally participates in depth testing.
### 67. Clipping, Masks, and Stencils
Required mechanisms:
- rectangular scissor clipping;
- path masks;
- alpha masks;
- stencil masks;
- nested clipping;
- UI overflow clipping;
- clipping planes for 3D;
- section views for engineering models.
Nested clipping must have defined behavior and diagnostics when backend limits
are exceeded.

**Lighting and Post-Processing (§68-§70)**
### 68. Lighting
Initial lights:
- ambient;
- hemisphere;
- directional;
- point;
- spot;
- rectangular area light where supported.

```ts
const light = new Four.DirectionalLight({
    color: "#ffffff",
    intensity: 3,
    castShadow: true
});
```

Lighting requirements:
- physically coherent units where practical;
- light layers;
- environment lighting;
- image-based lighting;
- tone mapping;
- exposure;
- clustered/forward-plus extension path for many lights.
### 69. Shadows
Required shadow features:
- directional shadow maps;
- point-light cubemap shadows;
- spot-light shadows;
- cascaded shadow maps;
- configurable resolution;
- bias and normal-bias controls;
- percentage-closer filtering;
- transparent shadow masks;
- contact-shadow extension;
- shadow atlas management.
### 70. Post-Processing
The render graph shall support reusable effects:
- tone mapping;
- color grading;
- bloom;
- anti-aliasing;
- depth of field;
- motion blur;
- screen-space ambient occlusion;
- outlines and selection highlighting;
- distortion;
- custom full-screen passes.
Effects must be composable per viewport.

**Interaction and UI (§71-§75)**
### 71. Picking and Hit Testing
One unified picking API shall cover 2D and 3D.
Strategies:
- analytic primitive testing;
- bounding-volume testing;
- path geometry testing;
- ray/triangle intersection;
- pixel-alpha testing;
- GPU identifier buffer;
- custom callbacks.

```ts
node.hitTestMode = "bounds" | "geometry" | "pixel" | "gpu" | "custom";
```

The engine should select the cheapest valid method by default.
### 72. Input and Event Propagation
Input sources:
- mouse;
- touch;
- pen/stylus;
- keyboard;
- wheel and trackpad;
- gamepad;
- future XR controllers.
Event phases mirror the DOM:

```text
Capture -> Target -> Bubble
```

Events include pointer enter/leave, down/up/move, click, double-click, wheel,
drag, pinch, rotate, keyboard, focus, and blur.
Pointer capture must be supported across mixed 2D/3D objects.
### 73. Retained-Mode UI
The optional @four/ui package shall provide:
- panel;
- label;
- button;
- toggle;
- checkbox;
- radio control;
- slider;
- text input;
- scroll view;
- list and virtual list;
- image;
- progress indicator;
- menu;
- tooltip;
- canvas view;
- embedded 3D viewport.
UI objects are scene nodes and therefore share animation, input, clipping, serialization, and diagnostics.
### 74. Layout
Required layout modes:
- absolute;
- stack;
- flex;
- grid;
- anchor;
- constraints.

```ts
const panel = new Four.Panel({
    layout: {
      type: "flex",
      direction: "column",
      gap: 12,
      padding: 20
    }
});
```

Layout must support:
- logical pixels;
- percentages;
- minimum/maximum sizes;
- intrinsic text/image size;
- margins and padding;
- overflow;
- scroll extent;
- device-pixel scaling;
- right-to-left interfaces.
### 75. Accessibility
The UI module shall provide an optional hidden DOM accessibility mirror.

```ts
button.accessibility = {
  role: "button",
  label: "Start simulation",
  description: "Begins the motor simulation",
  tabIndex: 0
};
```

Requirements:
- semantic roles;
- accessible names and descriptions;
- keyboard navigation;
- focus management;
- disabled/checked/expanded states;
- screen-reader updates;
- reduced-motion preference;
- high-contrast theme hooks;
- scalable text.
Reduced motion is an application-level policy (`reducedMotion`, §45): `"auto"`
follows the platform preference and may be overridden. The UI module must honor it;
non-UI animation consults it through the animation API on an opt-in basis (§14).

**Assets and Serialization (§76-§81)**
### 76. Asset System

```ts
const assets = await app.assets.load({
    robot: "/models/robot.glb",
    icon: "/images/icon.png",
    font: "/fonts/inter.woff2"
});
```

Supported initial formats:
- PNG, JPEG, WebP, and AVIF where available;
- SVG;
- JSON;
- glTF and GLB;
- font files;
- audio files through optional module;
- OBJ and other legacy formats through plugins.
The asset manager shall support:
- deduplication;
- caching;
- reference counting;
- lazy loading;
- streaming;
- dependency graphs;
- progress reporting;
- cancellation;
- retries;
- worker decoding;
- hot reload in development;
- content hashing.
### 77. Texture System
Texture requirements:
- 2D, cube, array, and 3D textures where supported;
- mipmaps;
- wrap and filter modes;
- anisotropy;
- color-space metadata;
- compressed texture containers;
- render-target textures;
- video textures;
- canvas and image-bitmap sources;
- asynchronous upload and residency diagnostics.
### 78. Model and Scene Loading
The glTF loader should support:
- geometry;
- materials;
- textures;
- skins;
- morph targets;
- animations;
- cameras;
- lights extensions;
- compression extensions through optional decoders;
- user metadata.
Loaded assets should be instantiated without sharing mutable transforms while
safely sharing immutable geometry and textures.
### 79. Serialization and Scene Format
Human-readable scene files use:

```text
.four.json
```

Binary packages may use:

```text
.four
```

Serialization goals:
- versioned;
- deterministic;
- backend-independent;
- schema-validatable;
- diff-friendly;
- extensible;
- capable of preserving unknown extension data.

```json
{
  "format": "four-scene",
  "version": "1.0",
  "scene": {
    "type": "Scene",
    "id": "scene-main",
    "children": []
  }
}
```

Physics state, animation state, and replay data must be separate optional sections so static scene definitions remain clean.
Identity and references:
- node and resource ids are stable: they serialize with the scene, and
deserialization restores them (the engine assigns ids only to newly created
objects);
- intra-file references (joint bodies, camera targets, parent links) are by id;
- assets are referenced by logical key, resolved through a manifest that maps each
key to a URL and content hash (§76);
- components (§6a) serialize under registered type names; plugins register theirs
(§81).
### 80. Scene Migration
Scene format versioning is independent from package semantic versioning.

```ts
const migrated = Four.SceneMigrator.upgrade(oldScene, "2.0");
```

Migrations must be:
- explicit;
- testable;
- deterministic;
- capable of producing warnings for lossy changes;
- composable across multiple versions.
### 81. Plugin System

```ts
interface FourPlugin {
  name: string;
  version: string;
  install(context: PluginContext): void | Promise<void>;
  uninstall?(context: PluginContext): void;
}
```

Plugin extension points:
- render passes;
- renderer backends;
- asset formats;
- materials and shader nodes;
- physics solvers;
- animation systems;
- UI controls;
- editor tools;
- diagnostics;
- serialization types;
- compute workloads.
Plugins shall declare dependencies and compatibility ranges.

**Platform and Runtime (§82-§90)**
### 82. GPU Compute
WebGPU compute is an advanced optional capability for:
- particles;
- image processing;
- procedural geometry;
- physics preprocessing;
- cellular automata;
- field simulation;
- matrix operations;
- scientific visualization.

```ts
const compute = new Four.ComputePass({
    shader: particleShader,
    workgroups: [1024, 1, 1],
    bindings: { positions, velocities, parameters }
});
```

Basic graphics and physics functionality must not require compute support.
### 83. Resource Lifecycle
GPU and solver resources shall be explicitly disposable.

```ts
texture.dispose();
geometry.dispose();
material.dispose();
physicsWorld.dispose();
app.dispose();
```

The engine should also implement reference counting or ownership tracking for
shared resources.
Development warnings:
- leaked textures/buffers;
- disposed resources still in use;
- duplicate asset loads;
- detached nodes retaining listeners;
- stale physics handles;
- excessive per-frame allocations.
### 84. Diagnostics and Developer Tools
Runtime statistics:

```ts
app.stats.cpuFrameTime;
app.stats.gpuFrameTime;
app.stats.simulationTime;
app.stats.physicsStepTime;
app.stats.drawCalls;
app.stats.triangles;
app.stats.instances;
app.stats.activeBodies;
app.stats.contacts;
app.stats.textureMemory;
app.stats.bufferMemory;
```

Debug overlays:
- bounds;
- transforms and pivots;
- camera frustums;
- light volumes;
- colliders;
- contacts and normals;
- centers of mass;
- velocity, acceleration, force, and torque vectors;
- joints and limits;
- sleeping bodies;
- overdraw;
- batch boundaries;
- texture atlases;
- render graph;
- UI layout boxes;
- picking identifiers.
### 85. Validation
Development builds shall detect:
- NaN and infinite values;
- singular transforms;
- scene graph cycles;
- invalid geometry indices;
- unsupported renderer features;
- shader compilation failures;
- conflicting transform authority;
- invalid physics dimensions;
- impossible mass/inertia values;
- unstable scales and extreme ratios;
- serialization version mismatches.
Production builds may disable expensive validation while preserving essential
safety checks.
### 86. Performance Targets
Initial engineering targets on suitable modern desktop hardware:

| Scenario | Target |
|---|---|
| Batched sprites | 100,000 at 60 FPS |
| Simple batched shapes | 50,000 at 60 FPS |
| Simple mesh instances | 100,000 visible instances where GPU-bound limits permit |
| Retained UI nodes | 5,000 |
| Animated glyphs | 20,000 |
| CPU particles | 25,000 baseline |
| GPU particles | 100,000+ |
| Active rigid bodies | 5,000 simple bodies baseline |
| Idle scene | Near-zero unnecessary uploads and simulation work |
| Payload: minimal 2D application (core + math + scene + render-webgl) | 150 kB gzip or less |

Targets are benchmark goals, not universal guarantees.
### 87. Spatial Indexing and Culling
Potential spatial structures:
- dynamic AABB tree;
- quadtree;
- octree;
- bounding-volume hierarchy;
- grid/spatial hash;
- backend-provided physics broad phase.
Systems may maintain specialized indices for rendering, picking, physics, and
UI. The public scene graph must not be forced to mirror a spatial tree.
### 88. Threading and Workers
Operating modes:
Main-thread mode
Input, simulation, and rendering occur on the browser main thread.
Worker-rendering mode
The main thread owns DOM, accessibility, and input forwarding. A worker
owns the scene, simulation, and OffscreenCanvas rendering.
Split-simulation mode
Rendering stays on the main thread while simulation executes in a worker using
transferable or shared state buffers.
The MVP may begin on the main thread, but APIs and data structures should
avoid assumptions that make worker migration impossible.
Split-simulation mode's shared state buffers require `SharedArrayBuffer`, which
browsers gate behind cross-origin isolation (COOP/COEP headers). The engine must
detect unavailability and fall back to transferable buffers, and the documentation
(§93) must cover the deployment requirement.
### 89. Error Model

```ts
class FourError extends Error {
  code: string;
  context?: Record<string, unknown>;
  cause?: unknown;
}
```

Example codes:
- RENDERER_INITIALIZATION_FAILED;
- UNSUPPORTED_GPU_FEATURE;
- ASSET_LOAD_FAILED;
- SHADER_COMPILATION_FAILED;
- CONTEXT_LOST;
- DEVICE_LOST;
- INVALID_SCENE_GRAPH;
- PHYSICS_SOLVER_FAILED;
- SERIALIZATION_VERSION_MISMATCH.
Recoverable failures should be reportable through events and diagnostics without always terminating the application.
### 90. Versioning and Compatibility
The packages shall use semantic versioning.
- patch: compatible defect correction;
- minor: backward-compatible feature;
- major: breaking API change.
The project should publish compatibility tables for:
- browser support;
- WebGPU/WebGL feature tiers;
- physics solver adapters;
- scene format versions;
- plugin API versions.

**Process and Quality (§91-§96)**
### 91. Coding Standards and Toolchain
Recommended baseline:
- strict TypeScript;
- ESM;
- pnpm workspace;
- Turborepo or Nx;
- Vitest;
- Playwright;
- ESLint;
- Prettier;
- API Extractor or TypeDoc;
- Vite;
- Changesets;
- GitHub Actions.
Requirements:
- no implicit any;
- documented public APIs;
- tree-shakable modules;
- side-effect-free packages with subpath exports (§98);
- package-boundary checks;
- unit, integration, visual, and benchmark tests;
- browser compatibility matrix;
- changelog for public releases.
### 92. Testing Strategy
Unit tests
- vectors, matrices, and quaternions;
- transforms;
- scene graph;
- clocks and scheduling;
- animation interpolation;
- geometry generation;
- path operations;
- serialization;
- physics descriptors and adapter normalization.
Integration tests
- scene plus renderer;
- fixed-step physics plus interpolated rendering;
- picking across 2D and 3D;
- asset loading plus materials;
- animation-to-physics transitions;
- UI focus and accessibility bridge;
- renderer context loss and restore (§61).
Visual regression tests
- shape fills and strokes;
- path joins and caps;
- transparency;
- materials and lighting;
- text layout;
- clipping;
- mixed 2D/3D ordering;
- debug overlays.
Visual baselines are per backend (WebGPU, WebGL 2, Canvas 2D, SVG) and are compared
with a perceptual-difference tolerance rather than exact pixels; a shared baseline
across backends is a non-goal.
Determinism tests
- identical input stream produces identical checksums;
- snapshot restoration reproduces subsequent states;
- replay remains stable within the declared determinism tier.
Determinism tests run headless - no renderer - and therefore do not depend on the
software rendering tier of §62.
Performance tests
Track CPU time, GPU time, simulation time, draw calls, contacts, memory,
allocations, and loading throughput.
### 93. Documentation Plan
Documentation shall include:
- installation and quick start;
- first 2D scene;
- first 3D scene;
- first animated scene;
- first physics scene;
- mixed 2D/3D/physics example;
- scene graph and transforms;
- cameras and coordinate conversion;
- materials and render graph;
- transform authority;
- fixed-step simulation;
- collision filtering;
- units and numerical stability;
- worker deployment and cross-origin isolation (§88);
- performance optimization;
- custom shaders;
- custom solver adapters;
- engineering dashboard guide;
- digital-twin guide.
API documentation should be generated directly from TypeScript declarations,
and every major feature should have a runnable example.
### 94. Release Strategy
- 0.1: math, scene, time, and basic WebGL rendering;
- 0.2: native 2D shapes, sprites, text, and picking;
- 0.3: 3D meshes, materials, lights, shadows, and mixed scenes;
- 0.4: motion, tweens, timelines, and path animation;
- 0.5: first physics adapter, bodies, colliders, forces, and collision events;
- 0.6: joints, motors, animation-physics blending, and replay;
- 0.7: assets, glTF, serialization, UI, and accessibility;
- 0.8: WebGPU preview, render graph, compute particles, and workers;
- 0.9: optimization, conformance, API stabilization, and production trials;
- 1.0: stable API, stable scene format, compatibility policy, full documentation.
### 95. Governance
Initial governance may use a lead-maintainer model with delegated ownership
for:
- core and math;
- rendering;
- motion and animation;
- physics;
- UI and accessibility;
- documentation;
- release engineering.
Major architectural changes require an RFC or ADR containing:
1. context;
2. proposed decision;
3. alternatives;
4. consequences;
5. compatibility analysis;
6. prototype or benchmark where practical;
7. maintainer approval.
### 96. Security and Untrusted Content
Asset loaders and scene deserializers shall treat external content as untrusted.
Requirements:
- bounds checking;
- input-size limits;
- decompression limits;
- no arbitrary code execution from scene files;
- safe shader/plugin boundaries;
- cancellation and timeouts for expensive decoders;
- documented content-security-policy behavior.

**Worked Example and Conventions (§97-§97a)**
### 97. Complete Mixed-Scene Example
One application, one scene graph, and every pillar in it: a 3D mesh under solver
authority, world-space text, a UI panel, and a button that applies an impulse.
The spellings are the shipped ones; §97a says what each replaced and why.

```ts
import { Application } from "four/application";
import { boxGeometry } from "four/geometry";
import { LitMaterial, SpriteMaterial } from "four/materials";
import { Vector3 } from "four/math";
import { Collider, PhysicsSystem, PhysicsWorld, RigidBody } from "four/physics";
import { Rapier3dAdapter } from "four/physics-rapier";
import { Renderable, Sprite, type Texture } from "four/render";
import { WebglRenderer } from "four/render-webgl";
import {
    DirectionalLight,
    Group,
    PerspectiveCamera,
    createFullscreenViewport
} from "four/scene";
import {
    buildGlyphAtlas,
    layoutText,
    type GlyphAtlas,
    type TextQuad
} from "four/text";
import { Button, Label, Panel } from "four/ui";

// --- application (§45): the renderer is an instance, not a string (§97a) ------
const canvas = document.querySelector("canvas") as HTMLCanvasElement;

const camera = new PerspectiveCamera({
    fieldOfView: Math.PI / 3,   // radians (§7a)
    near: 0.1,
    far: 1000
});
camera.transform.position.set(0, 2, 6);
camera.updateProjectionMatrix();

const app = new Application({
    canvas,
    renderer: new WebglRenderer(),
    fixedTimeStep: 1 / 60,
    // §48: a camera reaches the renderer through a viewport on `app.views`;
    // there is no `scene.activeCamera` (§97a).
    views: [createFullscreenViewport(camera)]
});
app.scene.add(camera, new DirectionalLight({ color: [1, 1, 1], intensity: 1 }));

// --- physics (§20, §37): a world is built and tracked, not an app option -----
const physics = new PhysicsSystem();
app.systems.register(physics);
const world = physics.track(
    new PhysicsWorld({
        dimension: "3d",
        gravity: new Vector3(0, -9.81, 0),
        adapter: new Rapier3dAdapter(),
        poses: app.poses          // §43: render interpolation reads from here
    })
);

// --- the cube (§49, §53, §57, §23, §24) --------------------------------------
const cube = new Renderable(
    boxGeometry({ width: 1, height: 1, depth: 1 }),
    new LitMaterial({ color: [0.33, 0.53, 1, 1] })   // linear RGBA, 0..1 (§60a)
);
cube.transformAuthority = "physics";                 // §42: one owner, declared
cube.addComponent(new RigidBody({ type: "dynamic", mass: 1 }));
cube.addComponent(
    new Collider({
        // One collider component over a shape descriptor, not a shape class
        // (§97a); half-extents, so this box matches the 1 x 1 x 1 geometry.
        shape: { type: "box", halfExtents: new Vector3(0.5, 0.5, 0.5) }
    })
);
app.scene.add(cube);

// --- the label (§55, §56): text is data, and the application draws it (§97a) --
// One glyph cell cut out of the atlas into its own texture. Elided here because
// it is arithmetic, not API; `examples/first-2d-scene/main.ts` implements it.
declare function glyphTexture(atlas: GlyphAtlas, quad: TextQuad): Texture;

const atlas = buildGlyphAtlas();
const layout = layoutText("Transformer T-101", atlas, { size: 0.26 });
const label = new Group();
// Parented to the cube, so it follows the body. §8's `space: "billboard"` —
// turning to face the camera — is not implemented (§97a).
label.transform.position.set(-layout.width / 2, 1.2, 0);
for (const quad of layout.quads) {
    const glyph = new Sprite(
        new SpriteMaterial({
            texture: glyphTexture(atlas, quad),
            tint: [1, 1, 1, 1]
        }),
        {
            width: quad.x1 - quad.x0,
            height: quad.y1 - quad.y0,
            anchor: { x: 0, y: 0 },
            renderLayer: 1          // sprites blend, so they draw last (§66)
        }
    );
    glyph.transform.position.set(quad.x0, quad.y0, 0);
    label.add(glyph);
}
cube.add(label);

// --- the panel (§73, §74): widgets own layout, the application owns pixels ----
const panel = new Panel({
    layout: { type: "flex", direction: "column", gap: 0.08, padding: 0.12 }
});
// World units: §8's `space: "screen"` is not implemented, so a screen-space
// panel is a widget subtree placed in the world, or under its own orthographic
// viewport (§48, §97a).
panel.transform.position.set(-3.2, 1.6, 0);

const impulseButton = new Button({ width: 1.6, height: 0.4 });
impulseButton.add(new Label({ text: "Apply Impulse", atlas, size: 0.2 }));
// `uiactivate` is the §73 activation — a §72 click or a programmatic
// `activate()`, indistinguishable downstream except by `event.source`.
impulseButton.on("uiactivate", () => {
    cube.getComponent(RigidBody)?.applyImpulse(new Vector3(0, 4, 0));
});

panel.add(new Label({ text: "System Status", atlas, size: 0.24 }), impulseButton);
app.scene.add(panel);
panel.layout();     // one explicit pass; layout is never implicit (§74)

// Every widget surface above is drawn by an application-supplied `WidgetSkin`
// (§73): `@four/ui` may not import a renderer, so it measures and states but
// never draws. Assign `panel.skin` / `impulseButton.skin` to make it visible.

// --- run (§10): the host drives the loop, the engine never calls rAF ---------
await app.initialize();     // acquires the WebGL 2 context
await world.initialize();   // decodes the solver's wasm image (§37)
app.start();

let last: number | null = null;
requestAnimationFrame(function frame(now: number): void {
    // The one place a wall clock is allowed: a presentation-side measurement,
    // converted to seconds before it crosses into the engine (§7a, §33).
    if (last !== null) app.step((now - last) / 1000);
    last = now;
    requestAnimationFrame(frame);
});
```

### 97a. Namespace and Naming Conventions
The examples of §97 and Part X were written against a flat umbrella barrel
(`Four.Mesh`, `Four.animate`) and against names the implementation later chose
differently. This section is the reconciliation. It is normative for how the
examples in this specification are spelled, and it records — rather than
hides — the affordances that are deferred rather than renamed.

**The umbrella barrel is per-package namespaces.** `import * as Four from
"four"` yields one namespace per §98 package, plus the §45 composition root,
which is the only API the umbrella owns rather than re-exports:

```ts
import * as Four from "four";

const app = new Four.Application({ /* ... */ });        // owned by `four`
const pid = new Four.motion.PIDController({ kp: 2 });   // re-exported namespace
const body = new Four.physics.RigidBody({ type: "dynamic" });
```

So **every `Four.X` in this specification reads `Four.<package>.X`**, with
`<package>` the §98 package name in camelCase — `physicsRapier` for
`@four/physics-rapier`, `renderWebgl` for `@four/render-webgl`. Two reasons,
both binding:

- **Collision avoidance.** Independent packages legitimately export the same
  identifier: `ColorRGBA` from both `math` and `materials`, `SeededRandom` from
  `core`, `motion`, and `particles`, `PACKAGE_NAME` from every package. A flat
  barrel would have to rename or drop one side of every collision.
- **§91 tree-shaking and the §86 payload budget.** A flat barrel re-exporting
  two dozen packages by name puts every one of them in the module graph of any
  program that imports the umbrella; a minimal 2D application would carry the
  renderer and physics surfaces it never names. Namespaces keep each package a
  separate, droppable subgraph.

Applications that want short names use the **subpath** form, which is what §97,
Part X, and every worked example use, and which tree-shakes the same way:

```ts
import { Application } from "four/application";
import { Vector3 } from "four/math";
import { PhysicsWorld, RigidBody } from "four/physics";
```

**Shipped-name mapping.** Where this specification's prose names a symbol, the
implementation ships it as follows.

| This specification | Shipped API | Note |
|---|---|---|
| `Four.Mesh` (§49, §54) | `Renderable` (`four/render`) | One concrete node carrying a `BufferGeometry` and a material. §49's family — `Shape2D`, `Text`, `Mesh`, `Line3D`, `PointCloud` — narrows it later. |
| `Four.BoxGeometry`, `Four.SphereGeometry` (§53) | `boxGeometry(...)`, `planeGeometry(...)`, `circleGeometry2D(...)` (`four/geometry`) | Geometry primitives are **factory functions returning `BufferGeometry`**, not classes. There is no sphere primitive yet. |
| `Four.StandardMaterial` (§59) | `LitMaterial`, `UnlitMaterial` (`four/materials`) | §59's PBR material is staged; the MVP tier is one Lambert-diffuse material and one flat one. Colors are linear RGBA arrays in 0..1 (§60a), not CSS strings. |
| `Four.BoxCollider`, `Four.SphereCollider` (§24) | one `Collider` component over a `CollisionShape` descriptor union (`four/physics`) | `new Collider({ shape: { type: "box", halfExtents } })`. There are no per-shape collider classes; §24's shape catalogue is a discriminated union, which is what lets `COLLISION_SHAPE_TYPES_2D`/`_3D` state per-dimension validity. |
| `Four.Motion` (§11) | `MotionComponent` (`four/motion`) | Renamed for what it is: a §6a component, not the motion pillar. |
| `Four.Text` (§56) | *no node* — `layoutText` + `buildGlyphAtlas` (`four/text`) + `Sprite` (`four/render`) | §56's MVP tier produces **data**: baseline-origin quads and a glyph atlas. The application turns quads into sprites. A `Text` node, and the one-draw-call batching it needs, are unbuilt. |
| `Four.Circle` (§50) | `circleGeometry2D(...)` + `Renderable` | §50's shape-node catalogue (`Circle`, `Rect`, `Path`, …) is staged; a filled circle today is geometry plus a material. |
| `Four.AnimationController` (§18) | *unimplemented* — `AnimationMixer` + application-side selection | §18's state machines, blend trees, and layered/additive animation are scheduled, not shipped. See §18 for the available-today form. |
| `Four.SceneMigrator.upgrade` (§80) | `migrateSceneDocument(...)` + `SceneMigrationRegistry` (`four/serialization`) | A registry of versioned `SceneMigration`s and a function over it, rather than an object with an `upgrade` method; warnings are returned, not thrown. |
| `app.scene.activeCamera = camera` (§47) | `app.views.push(createFullscreenViewport(camera))` (§48) | A scene has no active camera. A camera reaches the renderer through a §48 `Viewport`, which is what makes split-screen and multi-view a list operation rather than a mode. |
| `node.physicsWeight`, `node.animationWeight` (§19, §117) | `RigidBody.physicsWeight`, `RigidBody.animationWeight` | §19's blend weights live on the body component, beside the state they blend — a node with no body has nothing to weight. |
| `node.animation.play(...)` (§117) | `new AnimationMixer(target).play(clip)` (`four/animation`) | There is no `Node.animation` member; playback is owned by a mixer, and an `AnimationSystem` advances it (§39). |
| `Four.PIDController` (§111) | `Four.motion.PIDController` / `four/motion` | Namespace only; the constructor shape of §111 is exact. |
| `Four.HingeJoint`, `Four.Panel`, `Four.Button`, `Four.PerspectiveCamera`, `Four.Vector3` | unchanged, under their package namespaces | `four/physics`, `four/ui`, `four/ui`, `four/scene`, `four/math`. |

**Names with no shipped equivalent.** §8's `SpaceMode` — `"screen"`,
`"billboard"`, `"viewport"`, `"camera"`, `"local-plane"` — is not implemented on
any node: every node is world-space, so screen-space UI is a widget subtree
placed in world units (optionally under its own orthographic §48 viewport), and
a billboard is an application-side orientation update. Billboarding in
particular needs a per-view render list, which §64's list builder does not yet
produce. §82's `ComputePass` likewise has no surface.

**Deferred string selection (recorded deviations, not renames).** Two of this
specification's affordances select an implementation by string, and both are
deferred to one future registry packet for the same concrete reason: resolving a
string to a class means the umbrella importing every candidate package at
runtime, which every program then carries (§86, §91).

| Specified | Today | Why deferred |
|---|---|---|
| `renderer: "auto" \| "webgpu" \| "webgl2" \| "canvas2d" \| "svg"` (§45, §62) | `renderer: Renderer \| false` — an instance the application constructs | A string form must resolve through a registry a backend package opts into, so that §62's capability-ordered fallback exists without `four` statically importing any backend. Appendix A's `"auto"` order stands as the specified ordering for that packet. |
| `solver: "auto"` (§20, §37) | `adapter: PhysicsWorldAdapter` — an instance | Same payload reason. The capability machinery §37 requires is already live: a world validates its requested `dimension` and `determinism` against `adapter.capabilities` at construction and fails immediately rather than degrading quietly. Only the selection front-end is missing. |

Passing an instance remains supported after those land: §45 requires every
system to be constructible and ownable independently, so the string form widens
the option rather than replacing it.

## Part VIII - Package Architecture

### 98. Proposed Monorepo

```text
four.js/
+-- packages/
| +-- core/
| +-- math/
| +-- scene/
| +-- motion/
| +-- animation/
| +-- physics/
| +-- physics-rapier/
| +-- physics-box2d/
| +-- physics-soft/
| +-- particles/
| +-- geometry/
| +-- materials/
| +-- render/
| +-- render-webgpu/
| +-- render-webgl/
| +-- render-canvas/
| +-- render-svg/
| +-- input/
| +-- assets/
| +-- text/
| +-- ui/
| +-- serialization/
| +-- diagnostics/
| +-- four/
+-- examples/
+-- benchmarks/
+-- docs/
+-- tests/
+-- tools/
+-- website/
```

Responsibilities of the packages not detailed in §99-102:
- `core`: eventing (§6b), component model (§6a), unit system (§40), plugin host
(§81), error model (§89), lifecycle primitives;
- `math`: vectors, matrices, quaternions, curves, math conventions (§7b);
- `scene`: nodes, transforms, cameras (§47), viewports (§48), layers, queries, space
modes, serialization hooks;
- `geometry`: 2D and 3D geometry, path model, tessellation module (§52);
- `materials`: material families, paints, node materials, color management (§60a);
- `render`: renderer interface, render graph, batching, capability tiers (§61-67);
- `render-webgpu`, `render-webgl`, `render-canvas`, `render-svg`: backend
implementations of the §61 interface;
- `input`: input sources and event propagation (§72), picking front end (§71);
- `assets`: loading, caching, glTF, textures (§76-78);
- `text`: shaping, layout, SDF rendering (§56);
- `ui`: retained-mode controls, layout, accessibility (§73-75);
- `particles`: emitters, CPU and GPU simulation (§36, §112);
- `serialization`: scene format and migration (§79-80);
- `diagnostics`: statistics, overlays, validation (§84-85);
- `four`: umbrella package hosting the §45 `Application` composition root and
re-exporting the others through side-effect-free subpath exports (`four/scene`,
`four/physics`, ...) so tree-shaking works for umbrella users (§91).
Camera rigs and controls (§12, §44, §47) live in `@four/motion` as kinematic
controllers, with input bindings supplied through `@four/input`.
Publish names (decided by the owner, 2026-07-29): packages publish under the owner's
personal npm scope — the umbrella is `@danielsimonjr/fourjs`, and the other packages
follow `@danielsimonjr/fourjs-<name>` (for example `@danielsimonjr/fourjs-core`,
`@danielsimonjr/fourjs-physics-rapier`). The npm names `four` and `four-js` are
occupied by unrelated packages and are not pursued. In-repo workspace names remain
`four`/`@four/*` as specified here; the publish mapping is applied mechanically at
release time (§94, release 0.1). Subpath exports on the umbrella
(`@danielsimonjr/fourjs/scene`, ...) preserve the §91 tree-shaking requirement.
### 99. Motion Package
@four/motion responsibilities:
- clocks;
- fixed-step scheduler;
- motion components;
- velocity and acceleration;
- kinematic controllers;
- path following;
- trajectories;
- spring motion;
- steering;
- interpolation;
- transform authority.
### 100. Animation Package
@four/animation responsibilities:
- tweens;
- easing;
- timelines;
- clips;
- tracks;
- state machines;
- blend trees;
- skeletons;
- inverse kinematics;
- physics-animation blending.
### 101. Physics Package
@four/physics responsibilities:
- stable public API;
- body and collider descriptors;
- physics materials;
- constraints;
- joints;
- force fields;
- queries;
- event normalization;
- solver adapters;
- snapshots;
- unit application in simulation (the unit system itself lives in `@four/core`,
§40);
- debug data.
### 102. Solver Packages

```text
@four/physics-rapier
@four/physics-box2d
```

Each solver package implements the shared adapter interface and declares capability differences.
Additional adapters (for example Matter.js and Cannon-es, listed as potential adapters in §37) may be introduced as new solver packages by a future amendment; they are not part of the current package set defined in §98.
## Part IX - Implementation Plan
### 103. Phase 0 - Project Foundation
Deliverables

```text
README.md
LICENSE
CONTRIBUTING.md
CODE_OF_CONDUCT.md
SPECIFICATION.md
IMPLEMENTATION_PLAN.md
ROADMAP.md
package.json
pnpm-workspace.yaml
tsconfig.base.json
eslint.config.js
.github/workflows/ci.yml
```

Exit criteria
- monorepo installs successfully;
- all packages compile;
- tests run;
- documentation builds;
- example application starts.
### 104. Phase 1 - Math, Scene, and Time
Components
- Vector2, Vector3, Vector4;
- Matrix3 and Matrix4;
- Quaternion;
- Transform;
- Node;
- Group;
- Scene;
- component attachment model (§6a);
- EventEmitter (§6b);
- Clock;
- TimeState;
- fixed-step scheduler;
- dirty transform propagation.
Tests
- hierarchy insertion and removal;
- cycle prevention;
- matrix composition;
- world-transform propagation;
- fixed-step accumulator;
- pause and time scaling;
- interpolation alpha.
Exit criteria
A scene graph can be deterministically stepped without a renderer.
### 105. Phase 2 - Motion Foundation
Components
- MotionComponent;
- velocity and acceleration integration;
- kinematic controller;
- path following;
- trajectories;
- spring motion;
- transform authority;
- interpolation buffers.
Demonstration
A set of 2D and 3D objects move through:
- constant velocity;
- constant acceleration;
- circular paths;
- spline paths;
- damped spring motion.
Exit criteria
Motion is deterministic, renderer-independent, and unit tested.
### 106. Phase 3 - Renderer Foundation
Components
- renderer interface;
- WebGL 2 backend;
- camera projections;
- render list;
- GPU buffers;
- shaders;
- textures;
- viewports;
- interpolation-aware rendering.
Exit criteria
Moving 2D and 3D primitives render smoothly despite fixed-step simulation.
### 106a. Phase 3a - Interaction, Sprites, and Text (MVP Tier)
Covers the §120 interaction and 2D-content scope that Phases 0-10 previously never
scheduled; aligns with release 0.2 (§94).
Components
- input event routing and propagation (§72);
- unified picking: bounds and analytic 2D testing, 3D ray casting (§71);
- dragging;
- sprites with atlases and anchors (§55);
- MVP-tier text: bitmap and SDF rendering with basic Latin-script layout (§56);
- the example application upgraded to interactive content.
Exit criteria
Pointer events, picking, dragging, sprites, and text labels work in a mixed 2D/3D
example.
### 107. Phase 4 - Animation Core
Components
- Tween;
- easing;
- Timeline;
- AnimationClip;
- AnimationTrack;
- property binding;
- playback controls;
- event markers;
- deterministic evaluation.
Exit criteria
Any numeric, vector, quaternion, color, or transform property can be animated.
### 108. Phase 5 - Physics API and First Solver Adapter
Recommended first solver
Use Rapier as the first 2D/3D adapter because it provides modern
WebAssembly-based rigid-body physics and parallel conceptual coverage
for both dimensions.
Components
- PhysicsWorld;
- RigidBody;
- Collider;
- PhysicsMaterial;
- body types;
- force and impulse APIs;
- collision events;
- ray casting;
- scene synchronization;
- fixed-step integration;
- debug drawing.
Exit criteria
A mixed 2D/3D demonstration supports gravity, collisions, impulses, and sensors through the common API.
### 109. Phase 6 - Joints and Constraints
Components
- fixed joint;
- distance joint;
- spring;
- hinge;
- slider;
- spherical joint;
- motors;
- limits;
- break thresholds.
Demonstration
An engineering mechanism containing:
- rotating shaft;
- hinge;
- slider;
- spring;
- motor;
- limit switches.
Exit criteria
Constraints remain stable under expected real-time loads.
### 110. Phase 7 - Physics-Animation Integration
Components
- transform authority (§42);
- animation target poses;
- kinematic-to-dynamic transitions;
- ragdoll activation;
- blended poses;
- root motion;
- physical constraints on animated objects.
Exit criteria
A character or machine can move between animated, kinematic, and physical
control without abrupt discontinuities.
### 111. Phase 8 - Advanced Motion
Components
- steering;
- flocking;
- path planning adapters;
- inverse kinematics;
- trajectory prediction;
- spring-damper controllers;
- PID controller utility;
- robotic joint commands.
Engineering relevance
A PID utility should support simulation and visualization of control systems:

```ts
import { PIDController } from "four/motion";

const controller = new PIDController({
    kp: 2,
    ki: 0.5,
    kd: 0.1,
    outputLimits: [-10, 10]
});

// Once per fixed step, with the injected simulation delta (§10, §33).
app.on("fixedUpdate", (time) => {
    const command = controller.update(setpoint, measurement, time.fixedDeltaTime);
    shaftHinge.setMotor({ enabled: true, targetVelocity: command, maxTorque: 400 });
});
```

Through the umbrella barrel this is `Four.motion.PIDController` (§97a); the
constructor options above are exact.

### 112. Phase 9 - Particles and GPU Motion
Components
- particle emitter;
- CPU particle simulation;
- GPU compute simulation;
- force fields;
- collision options;
- lifetime curves;
- trails.
Exit criteria
At least 100,000 simple particles can be simulated and rendered at interactive
rates on suitable hardware.
### 113. Phase 10 - Replay, Snapshots, and Diagnostics
Components
- physics snapshots;
- input recording;
- replay;
- deterministic checksums;
- slow-motion inspection;
- frame stepping;
- collision visualization;
- constraint visualization;
- center-of-mass display;
- velocity and force vectors;
- solver statistics.
Exit criteria
A physics defect can be captured, replayed, and inspected frame by frame.
### 113a. Phase 11 - Assets, Serialization, UI, and Tooling
Covers the §120 application-layer and tooling scope that Phases 0-10 previously never
scheduled; aligns with release 0.7 (§94).
Components
- asset manager and glTF loading (§76-78);
- scene serialization and migration (§79-80);
- retained-mode UI and accessibility mirror, MVP subset (§73-75);
- benchmark harness under `benchmarks/` (§92 performance tests against the §86
targets);
- documentation and website per §93.
Exit criteria
A scene can be saved, reloaded, and benchmarked, and the §120 tooling list is
complete.
## Part X - Public API Examples
These four examples are written in the shipped spellings; §97a maps them back to
the names this specification's prose uses. Each continues from the one before —
§115 to §117 assume §114's `app` and a `world` built as in §20.
### 114. Basic Animated Object

```ts
import { animate } from "four/animation";
import { Application } from "four/application";
import { circleGeometry2D } from "four/geometry";
import { UnlitMaterial } from "four/materials";
import { Renderable } from "four/render";
import { WebglRenderer } from "four/render-webgl";
import { OrthographicCamera, createFullscreenViewport } from "four/scene";

const camera = new OrthographicCamera({
    left: -4, right: 4, bottom: -3, top: 3, near: 0.1, far: 10
});
camera.transform.position.set(0, 0, 5);
camera.updateProjectionMatrix();

const app = new Application({
    canvas: document.querySelector("canvas") as HTMLCanvasElement,
    renderer: new WebglRenderer(),      // an instance, not "auto" (§97a)
    views: [createFullscreenViewport(camera)]
});

// A filled circle is geometry plus a material (§97a); world units, not pixels.
const circle = new Renderable(
    circleGeometry2D({ radius: 0.4 }),
    new UnlitMaterial({ color: [0.31, 0.49, 1, 1] })
);
circle.transform.position.set(-3, 0, 0);
app.scene.add(circle);

// Seconds, never milliseconds (§7a). "spring" names a family; the easing is
// one of its three variants (§15, §97a).
animate(circle.transform.position)
  .to({ x: 3 }, 1.5)
  .ease("spring-out")
  .play();

await app.initialize();
app.start();
```

### 115. Dynamic Physics Object

```ts
import { LitMaterial } from "four/materials";
import { Vector3 } from "four/math";
import { Collider, RigidBody } from "four/physics";
import { Renderable } from "four/render";
import { boxGeometry } from "four/geometry";

// No sphere primitive ships yet, so the drawn shape is a box and the collider
// says what the solver sees (§97a). The two are authored separately on purpose:
// physics needs extents, rendering needs vertices.
const ball = new Renderable(
    boxGeometry({ width: 1, height: 1, depth: 1 }),
    new LitMaterial({ color: [1, 0.53, 0.27, 1] })
);
ball.transformAuthority = "physics";        // §42: the solver owns this node
ball.addComponent(new RigidBody({ type: "dynamic", mass: 1 }));
ball.addComponent(
  new Collider({
      shape: { type: "sphere", radius: 0.5 },
      restitution: 0.8,
      friction: 0.3
  })
);
app.scene.add(ball);

// Registration reads the components and the node's transform as the initial
// pose, and writes the derived mass back onto the component (§23, §37).
world.addBody(ball);
```

### 116. Motorized Hinge

```ts
import { HingeJoint } from "four/physics";
import { Vector3 } from "four/math";

const hinge = new HingeJoint({
    // The two §23 body components, not their nodes.
    bodyA: frameBody,
    bodyB: rotorBody,
    // Anchor and axis are authored in WORLD space and converted once, at
    // `addJoint` — so pose both bodies before jointing them (§28).
    anchor: new Vector3(0, 0, 0),
    axis: new Vector3(0, 0, 1),
    motor: {
      enabled: true,
      targetVelocity: 10,       // radians per second (§7a)
      maxTorque: 100            // newton-metres
    }
});
world.addJoint(hinge);
```

On the shipped Rapier adapters `maxTorque` is a force-based **gain** rather than
§28's hard ceiling — a declared capability deviation (§37, §90), not a defect of
this example. `setMotor` and `setLimits` stay live after registration; anchors
and axes are frozen.

### 117. Physics and Animation Blend

```ts
import { AnimationMixer, AnimationSystem } from "four/animation";
import { RigidBody, createPoseTargetCaptureSystem } from "four/physics";
import { PoseTarget } from "four/scene";

// §19's pipeline: animation writes a target pose, the solver writes a solved
// pose, and the two are blended by weight. The capture system is REQUIRED —
// without it the velocity handed to the solver on activation is meaningless.
const animation = new AnimationSystem();
app.systems.register(createPoseTargetCaptureSystem(physics.worlds));
app.systems.register(animation);

robot.transformAuthority = "blended";           // §42 selects the §19 pipeline
const target = robot.addComponent(new PoseTarget()).copyFrom(robot.transform);
const body = robot.addComponent(new RigidBody({ type: "kinematic-position" }));

// The clip drives the PoseTarget, not the transform: nothing but §19's blend
// writes a "blended" node (§97a — there is no `robot.animation`).
animation.track(
    new AnimationMixer(target).play(walkClip, {
        loop: Number.POSITIVE_INFINITY,
        authority: robot
    })
);

// §19's weights live on the body component, not the node (§97a).
body.physicsWeight = 0.2;
body.animationWeight = 0.8;

// §29's collision name, dispatched after the fixed step (§39 step 9).
body.on("collisionstart", () => {
    body.physicsWeight = 1;
    body.animationWeight = 0;
    // Hand the chain to the solver, inheriting the animated target's velocity.
    world.setBodyControlMode(robot, "dynamic", { inheritVelocityFrom: target });
});
```

## Part XI - Flagship Demonstrations
### 118. “One Scene, Everything Moves”
The first public demonstration should contain:
- a rotating 3D cube;
- a 2D vector orbit;
- a spring-connected pendulum;
- a bouncing rigid body;
- a world-space label;
- a screen-space control panel;
- a timeline;
- a motorized hinge;
- collision events;
- pause, slow motion, and single-step controls.
Success criterion:
It must feel like one motion-capable engine, not a graphics library
with physics bolted on afterward.
### 119. Engineering Demonstration
Electric Motor Digital Twin
Features:
- 3D motor model;
- animated rotor;
- torque and angular-velocity visualization;
- bearing constraints;
- motorized shaft;
- vibration simulation;
- temperature indicators;
- waveform charts;
- fault injection;
- PID speed controller;
- pause and replay;
- force and torque vector overlays.
This example establishes four.js as useful for engineering, education, simulation,
and digital twins.
## Part XII - Revised MVP
### 120. MVP Requirements
The first meaningful release shall include:
Scene
- Node;
- Group;
- Scene;
- Transform;
- Cameras;
- Layers.
Time and Motion
- Clock;
- fixed-step scheduler;
- MotionComponent;
- velocity;
- acceleration;
- path motion;
- interpolation.
Animation
- Tween;
- easing;
- Timeline;
- transform tracks.
Physics
- PhysicsWorld;
- 2D and 3D world descriptors;
- static, dynamic, and kinematic bodies;
- basic colliders;
- gravity;
- forces;
- impulses;
- collision events;
- ray casting;
- one solver adapter;
- debug drawing.
Rendering
- WebGL 2;
- 2D primitives;
- basic 3D meshes;
- lighting;
- sprites;
- text.
Interaction
- pointer events;
- 2D picking;
- 3D ray casting;
- dragging.
Tooling
- tests;
- examples;
- API documentation;
- benchmark harness;
- deterministic simulation tests.
## Part XIII - Final Design Statement
four.js should not merely answer:
Where is this object, and how should it look?
It must also answer:
How does this object change through time, what controls its motion,
what forces act on it, and how does it interact physically with the
rest of the scene?
The defining model is:

```text
Object
+-- Transform
+-- Appearance
+-- Motion
+-- Animation
+-- Physics
+-- Interaction
```

The defining promise is:
Create once. Position anywhere. Animate naturally. Simulate physically. Render everywhere.
## Appendix A - Normative Defaults
Examples elsewhere in this specification are illustrative; this table is normative.

| Setting | Default |
|---|---|
| `fixedTimeStep` | 1/60 s (§10, §45) |
| `maximumSubSteps` | 5 (§10, §45) |
| Gravity, 3D world | `(0, -9.81, 0)` m/s² (§20) |
| Gravity, 2D world | `(0, -9.81)` m/s² (§21) |
| Friction combine mode | `average` (§25) |
| Restitution combine mode | `maximum` (§25) |
| Sleeping | enabled; linear 0.01, angular 0.01, time 0.5 s (§32) |
| Continuous collision detection | `disabled` (§31) |
| `renderer: "auto"` order | WebGPU, then WebGL 2, then Canvas 2D (§62) |
| Determinism target | `same-runtime` (§33) |
| Unit system | meter / kilogram / second / radian (§40) |
| Angle unit in APIs | radian (§7a) |
| Time unit in APIs | second (§7a) |
| `reducedMotion` | `"auto"` (§45, §75) |

## Appendix B - Glossary
- **Animation**: specification of how something *should* move over time (§3, §14).
- **Kinematics**: moving objects directly, without solving forces (§3, §12).
- **Dynamics**: motion derived from forces, mass, and constraints (§3, §20).
- **Motion**: umbrella term for deterministic change through time - animation,
kinematics, trajectories, procedural movement (§3).
- **Component**: typed behavior and state attached to a node (§6a).
- **Transform authority**: the single system permitted to write a node's transform
(§42); `"blended"` selects the §19 pipeline.
- **Fixed step / accumulator**: simulation advances in constant `fixedDeltaTime`
increments, decoupled from the render rate (§10).
- **Interpolation alpha**: fraction in [0, 1] of leftover accumulator time used to
blend previous and current simulation states for rendering (§10, §43).
- **Determinism tier**: declared reproducibility level - `none`, `same-runtime`,
`same-platform`, `cross-platform` (§33).
- **Sensor**: a collider that reports overlaps but exerts no forces (§24, §29).
- **Solver adapter**: implementation of `PhysicsSolverAdapter` (§37) binding a
concrete physics engine beneath the stable `@four/physics` API.
- **Logical pixel**: device-independent pixel unit used by screen space and UI
layout, scaled to physical pixels by `resolution` (§47, §74).
- **World / local-plane space**: the spaces in which physics normally operates (§8);
screen-space UI does not simulate unless mapped to a plane.


