/**
 * four.js — **"Electric Motor Digital Twin"**, the §119 flagship demonstration.
 *
 * §118 asks whether four.js *feels* like one engine. §119 asks a harder and more
 * checkable question: is it **useful for engineering** — "engineering,
 * education, simulation, and digital twins", the audience `docs/POSITIONING.md`
 * names first. An engineering audience does not want a nice picture of a motor.
 * It wants a model whose numbers mean something, in units it can name, with a
 * controller in the loop, a fault it can inject, and a run it can rewind and
 * re-examine. That is what this page is, and it is the living proof of
 * `docs/guides/digital-twin.md`, which specifies the four properties a twin
 * needs — saveable state (§79/§34), reproducible runs (§33), inspectable
 * history (§34/§113), loadable content (§76) — and which had, until this file,
 * no shipped demonstration.
 *
 * ## §119's list, and where each item is
 *
 * | §119 asks for | where it is here |
 * | ------------- | ---------------- |
 * | 3D motor model | {@link MOTOR_ORIGIN}: a stator box with end bells and cooling fins, a rotor drum with six vanes, a shaft and a coupling — §53 primitives under `LitMaterial` and one `DirectionalLight` (glTF is staged, S-7, so the model is procedural) |
 * | animated rotor | the rotor is turned by the solver, not by a tween: the drive hinge's §28 motor is the only thing in the scene that puts energy in |
 * | torque and angular-velocity visualization | the two chart-A traces (measured and commanded speed), the `trq`/`spd` readouts, and the §113 overlay's torque arc |
 * | bearing constraints | **two coaxial `HingeJoint`s** between stator and rotor — {@link DRIVE_BEARING_Z} and {@link IDLE_BEARING_Z} — which is what a bearing pair is: five constrained degrees of freedom at each end of the shaft |
 * | motorized shaft | the drive-end hinge's §28 velocity motor, commanded every fixed step |
 * | vibration simulation | **emergent, not authored**: the rotor carries a second collider off the spin axis ({@link IMBALANCE_OFFSET}), and the stator hangs on a §28 slider + spring mount, so unbalance shakes the machine and the mount's deflection *is* the vibration signal (read out in millimetres, §40) |
 * | temperature indicators | a first-order thermal model integrated on the fixed step ({@link updateThermalModel}), shown as a bar, a trace, a numeric readout and a trip lamp |
 * | waveform charts | two scrolling strip charts, four traces, **one draw call** — a `"lines"` `BufferGeometry` with per-vertex colours (see "What the charts cost", below) |
 * | fault injection | two, both physical rather than cosmetic: a **bearing rub** that drives a §28 *slider* motor's pad onto the rotor, and a **drive sag** that clamps the actuator below the setpoint |
 * | PID speed controller | `PIDController` from `@four/motion`, closing on the rotor's measured `angularVelocity.z` and commanding the hinge motor's `targetVelocity` |
 * | pause and replay | `app.pause()`, an exact single step, and a §34 `ReplayRecorder`/`ReplayPlayer` audit that seeks into the recorded run and verifies it bit-for-bit |
 * | force and torque vector overlays | the §113 debug overlay: body origins and velocities from `@four/diagnostics`' own streams, plus a torque arc and a mount-reaction arrow this page draws (see "Whose numbers the overlay draws") |
 *
 * Three things §119 does not list are here because the task of a twin is not
 * finished without them, and each is a **first** for this repository's examples:
 *
 * - **§84 runtime statistics.** The first example to pass `stats: true` and read
 *   `app.stats` — draw calls, triangles, CPU frame time, resource bytes, and
 *   §32's awake-body count, which the application fills itself because §45 has
 *   no `app.physics` yet (gap `A-6`).
 * - **§40 unit display.** The first example to use `@four/core`'s conversion
 *   helpers. The engine stays in radians and seconds; the *readouts* are in
 *   degrees, millimetres and milliseconds, converted once at the edge.
 * - **§79 save and load.** `registerSceneNodeTypes` + `registerRenderSerializers`
 *   + a `SceneResourceCatalog`, round-tripped and byte-compared on demand.
 * - **A screen-space pass (§46, §47, §48).** The instrument column and the
 *   control panel are drawn by a *second* full-surface viewport whose camera is
 *   §47's `ScreenCamera`, over a `"ui"` layer the world view masks out — one
 *   scene, one frame, two passes over one render list. Until 2026-08-21 they
 *   were children of the `PerspectiveCamera` node at a fixed local depth,
 *   because neither the camera nor §46's layer registry existed; the note that
 *   said so is deleted, and {@link UI_UNIT_PIXELS} records why the swap needed
 *   no layout number re-tuned.
 *
 * ## What §119 asks for that the engine cannot do yet (staged, honestly)
 *
 * Compose what §119 lists; stage what it cannot. Each row cites the row of
 * `docs/GAP ANALYSIS v1.md` that owns it.
 *
 * - **Waveform charts are lines, not shapes** (`R-24`, blocker; `R-23`). There
 *   is no `Path` model and no 2D shape node, so a chart cannot be stroked,
 *   dashed, filled or given a line width. What ships is the workaround the
 *   analysis names: a `"lines"` `BufferGeometry` whose vertex colours carry the
 *   trace identity, so all four traces are **one draw call** — but they are
 *   one-pixel, un-antialiased polylines, with no axis, tick or grid primitive
 *   behind them (the frames below are quads). When `R-23`/`R-24` land this is
 *   the file that should stop hand-writing `Float32Array`s.
 * - **No glTF motor model** (`S-7`, `A-18`). §76's manager ships JSON, text,
 *   binary and image loaders; glTF needs the §55 texture tier plus non-unlit
 *   materials. So the machine is built from §53 primitives in this file, which
 *   also means the geometry keys the §79 catalog publishes are honest names
 *   rather than asset URLs.
 * - **Whose numbers the overlay draws.** §113's body origins and velocities come
 *   from `@four/diagnostics` reading the solver (`R-35`, shipped). The **torque
 *   arc and the mount-reaction arrow do not**: no `PhysicsSolverAdapter` here
 *   reports joint reactions — both Rapier adapters declare
 *   `reportsJointReactions: false`, and `PhysicsWorld` exposes no reaction
 *   accessor at all — so those two glyphs are drawn from *this file's* model of
 *   the machine (motor gain × velocity error; mount stiffness × deflection).
 *   They are labelled as the twin's estimate, not as a measurement, because an
 *   overlay that quietly drew an application's own guess as if the solver had
 *   said it would be the worst kind of instrument.
 * - **No thermal domain, and there should not be one.** §5 says four.js is not a
 *   CAD/FEM kernel. The temperature here is application state integrated on the
 *   engine's fixed step — which is precisely the seam a twin needs, and is why
 *   it is stated rather than hidden.
 *
 * ## The payload decision: one wasm image, not two
 *
 * `examples/flagship/one-scene-everything-moves` selects its solver through
 * §37's registry (`solver: "auto"` after `registerRapierSolver()`), and pays for
 * it: that call names *both* Rapier adapters, so the bundle carries both wasm
 * images — 1.54 MB gzip against 0.69 MB for a single adapter (measured
 * 2026-08-07, recorded in `MEMORY.md`). This page constructs
 * `new Rapier3dAdapter()` **directly**, which is the documented cheaper path,
 * for three reasons that are all §119's own:
 *
 * 1. §119 is an *electric motor*. It has one dimension, and it is `"3d"`; there
 *    is no 2D world here for a registry to choose between.
 * 2. The registry's `"auto"` path is already demonstrated, measured and gated by
 *    the §118 flagship. Demonstrating it twice would buy nothing and cost
 *    0.85 MB.
 * 3. This page is an **instrumented build** (see `vite.config.ts`): it needs
 *    `__FOUR_DEV__` left at its default `true`, because A-4 gates §84's whole
 *    statistics path on it. Dev-build JavaScript plus two wasm images would be
 *    the worst of both worlds; dev-build JavaScript plus one is what a twin
 *    actually ships.
 *
 * ## Determinism (§33)
 *
 * Every seed is a constant, nothing reads `Math.random` or a wall clock, and the
 * only clock this file touches is the rAF timestamp handed to `app.step` — a
 * presentation-side measurement converted to seconds before it crosses into the
 * engine (§7a). Every decision the controller makes is a function of the
 * **simulation step index**, never of elapsed wall time: the scripted fault at
 * {@link SCRIPTED_RUB_FROM}, the thermal integration, the chart sampling. So two
 * runs of this page that reach the same step hold the same state, which is what
 * `data-markchecksum` publishes and what the browser gate compares across two
 * page loads.
 *
 * §40's conversion helpers are **never** called from a fixed step. They are
 * documented as inexact (8.8 % of degree round trips differ in the last bit),
 * and the only safe answer is to keep them off the simulation path — so every
 * call to them in this file is inside {@link publish}, which runs once per
 * rendered frame, on the display side of the engine.
 *
 * ## Record, seek, replay — and where the controller's state lives (§34)
 *
 * A twin's recording must reproduce the *machine*, and the machine is what the
 * solver holds. So the recorded stream is the **actuation**, not the controller:
 * every fixed step, {@link driveTheMotor} computes a command and hands it to
 * {@link actuate}; the same value is recorded with `recorder.recordInput`, and on
 * replay `ReplayTarget.applyInput` calls **the same `actuate`**. One code path
 * applies inputs live and on replay, which is the rule
 * `docs/guides/digital-twin.md` states and the reason a replay here is exact
 * rather than approximate.
 *
 * The consequence is worth stating plainly, because it is the §34 boundary an
 * engineer will hit: **the PID's integrator and the thermal state are not in the
 * recording.** §34 snapshots solver state. A seek restores the machine, not the
 * controller. This page therefore runs its replay audit with the application
 * paused — so no fixed step runs and no controller state moves — and restores
 * the live snapshot afterwards, so the audit is a pure read of the recording.
 * A twin that needed to resume a mid-run seek would snapshot its controller
 * beside the §34 snapshot, exactly as the guide says a mid-contact resume pairs
 * a §79 document with a §34 snapshot.
 *
 * ## The palette is an instrument, and it is **regional**
 *
 * §66 gives this tier no material state a screenshot can read back, so the
 * browser gate attributes pixels to objects by hue — the discipline
 * `examples/particles-demo` established. This page differs from the §118
 * flagship in one way worth flagging: it is *two instruments side by side*, and
 * a hue that means "rotor" in the machine bay would mean "temperature trace" in
 * the instrument column. So each classifier below states the **region** it is
 * valid in, and the gate crops before it counts.
 *
 * Every byte value below was **measured off a built screenshot**, not derived
 * from the material colour, because a `LitMaterial` under a directional light
 * plus ambient produces several illumination levels of the same hue and only the
 * ratios survive.
 *
 * | object | region | measured bytes | classifier |
 * | ------ | ------ | -------------- | ---------- |
 * | rotor drum, vanes, balance weight | machine bay (`x < 422`) | `(255, 158, 43)` | amber: `r ≥ 150`, `r − g ≥ 60`, `r − b ≥ 110` |
 * | stator frame, end bells, shaft, isolator posts | machine bay | `(103, 128, 208)`, `(71, 88, 149)`, `(67, 84, 141)` | steel: `b ≥ 100`, `b − r ≥ 45`, `b − g ≥ 35` |
 * | brake caliper (the rub fault) | machine bay | `(250, 64, 178)` | magenta: `r ≥ 150`, `b ≥ 110`, `g ≤ r − 100` |
 * | measured-speed trace | chart A (`x 514…941`, `y 12…102`) | `(61, 219, 240)` | cyan: `g ≥ 140`, `b ≥ 140`, `g − r ≥ 80`, `b − r ≥ 80` |
 * | commanded-speed trace | chart A | `(255, 219, 79)` | yellow: `r ≥ 170`, `g ≥ 150`, `b ≤ 130` |
 * | vibration trace | chart B (`y 126…213`) | `(79, 230, 120)` | green: `g ≥ 150`, `g − r ≥ 80`, `g − b ≥ 60` |
 * | temperature trace | chart B | `(255, 110, 51)` | orange: `r ≥ 200`, `r − g ≥ 100`, `r − b ≥ 150` |
 * | temperature bar fill | the bar (`y 358…374`) | a ramp, `(106, 185, 143)` at 47 °C | measured by **length**, not hue — see {@link updateTemperatureBar} |
 * | glyphs | both | `(236, 239, 246)` | neutral: `min ≥ 170`, `max − min ≤ 22` |
 * | bench slab, chart and panel surfaces | both | `(43, 45, 53)`, `(18, 19, 26)` | none — they must trip nothing |
 * | background | both | `(8, 9, 14)` | none |
 *
 * The §113 overlay keeps §113's own defaults (saturated, **no blue**), and is
 * off until the `vectors` button is pressed; the gate crops the machine bay
 * before counting it, where no instrument colour can reach. `b ≤ 30` separates
 * it from the amber rotor with a computed rather than an eyeballed margin: amber
 * is `(1, 0.59, 0.16)` before lighting, so a pixel dark enough to satisfy it has
 * `r ≤ 187` and fails the overlay's `max(r, g) ≥ 200`.
 *
 * ## What the frame looks like, mechanically
 *
 * ```text
 *   app.step(elapsed)                                §10 fixed-step accumulator
 *     ├─ fixedUpdate ×N   control      (200)         PID → actuate() → recordInput
 *     │                   PhysicsSystem(600)         Rapier 3D: stator, rotor, pad
 *     │                   instruments  (950)         thermal model, chart samples
 *     │                   pose capture (1000)        §43 previous/current states
 *     ├─ update           this file: charts, readouts, overlay, panel text
 *     └─ render           renderer.render(scene, views, interpolationAlpha)
 *   …then, after step() returns: §84 statistics and everything #status publishes
 * ```
 *
 * The last line is not a stylistic choice. `Application.step` resets §84's whole
 * record on the way *in* and writes the render counters, the §83 resource levels
 * and `cpuFrameTime` on the way *out*, so a page that read `app.stats` from the
 * `update` event would find every counter `NaN` — measured, then moved.
 *
 * The control system sits at §39's `PRIORITY_COMMANDS` — step 2, strictly before
 * the step-6 solve — so the ordering is the engine's, not this file's, and the
 * command it queues is drained by the very step it was computed for. That is
 * the sampled-data form every digital controller has, and it is the same
 * arrangement `tests/integration/helpers/motion-advanced-scenarios.ts` proved on
 * a real Rapier hinge in Phase 8.
 */

import { Application } from "four/application";
import {
  angleToDisplay,
  lengthToDisplay,
  resolveUnitSystem,
  timeToDisplay,
  unitSymbol,
} from "four/core";
import {
  DebugDrawBuffer,
  applyDebugDrawStreams,
  collectBodyOrigins,
  collectBodyVelocities,
  debugDrawStreams,
  recordSolverStatistics,
  solverStatistics,
  ReplayPlayer,
  ReplayRecorder,
  encodeReplayRecording,
  type DebugDrawStreams,
  type ReplaySnapshot,
  type ReplayTarget,
  type SolverStatistics,
} from "four/diagnostics";
import {
  BufferGeometry,
  boxGeometry,
  cylinderGeometry,
  planeGeometry,
  torusGeometry,
} from "four/geometry";
import { KeyboardInput, PointerInput, type Pickable } from "four/input";
import { LitMaterial, UnlitMaterial, type Material } from "four/materials";
import { Quaternion, Vector3 } from "four/math";
import {
  PIDController,
  PRIORITY_COMMANDS,
  type SimulationSystem,
} from "four/motion";
import {
  Collider,
  HingeJoint,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  SliderJoint,
  SpringJoint,
} from "four/physics";
import { Rapier3dAdapter } from "four/physics-rapier";
import { Renderable, Texture } from "four/render";
import { WebglRenderer } from "four/render-webgl";
import {
  DEFAULT_LAYER_MASK,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  ScreenCamera,
  Transform,
  createFullscreenViewport,
  defineLayer,
  layerMask,
  resolveWorldTransform,
} from "four/scene";
import {
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "four/serialization";
import { buildGlyphAtlas } from "four/text";
import {
  Button,
  Label,
  Panel,
  Slider,
  collectPickables,
  focusedWidget,
  installKeyboardTraversal,
  keyboardFocusTarget,
  type UIWidget,
  type WidgetSkin,
} from "four/ui";
import { Text, registerSceneNodeTypes, resourceCatalog } from "four";

// --- surface -----------------------------------------------------------------

/**
 * The one element matching `selector`, or a thrown error naming it.
 *
 * A helper rather than an inline null check because the handles are read from
 * inside callbacks, and TypeScript does not carry a module-level narrowing into
 * a closure (the reason every other example in this repository gives).
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`four.js motor twin: no ${selector} in the document.`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");
const status = requireElement<HTMLParagraphElement>("#status");

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 960;
const HEIGHT = 600;

/** Straight (non-premultiplied) RGBA in 0…1 (§60a, §66). */
type Rgba = readonly [number, number, number, number];

// --- §40: the twin's declared display units ----------------------------------

/**
 * The one `UnitSystem` this page declares (§40), and the whole of §40's effect.
 *
 * Read the header of `@four/core`'s `units` module before changing anything
 * here: **declaring a unit system does not change what the engine computes.**
 * There is no unit mode, no `ApplicationOptions.units`, and no signature
 * anywhere that takes one. Internally and at every API boundary this file is
 * still radians, seconds, and world units — which the physics defaults treat as
 * metres and kilograms.
 *
 * What the declaration buys is exactly what §40 promises its audience,
 * *"engineering applications must be able to declare and display units
 * explicitly"*: one record, carried from here to every readout, instead of
 * `* 180 / Math.PI` scattered through the presentation layer. A twin whose
 * operator reads degrees and millimetres declares it once, converts at the edge,
 * and hands the engine radians as it always did.
 *
 * `scale` is left at SI: one world unit **is** one metre here, so the collider
 * dimensions below are metres and the masses the solver derives are kilograms.
 */
const DISPLAY_UNITS = resolveUnitSystem({
  angle: "degree",
  length: "millimeter",
  time: "millisecond",
});

/**
 * Revolutions per minute from radians per second.
 *
 * §40's record has **no angular-velocity selector** — it names length, mass,
 * time, and angle, and nothing else — so RPM is not a unit this engine can be
 * asked for. It is derived here from the two selectors that do exist: the
 * declared angle unit turns radians into degrees, 360 of which are one
 * revolution, and 60 seconds are one minute. Stating the derivation is the
 * point: an engineering readout that invented a conversion factor would be
 * exactly the failure §40 exists to prevent.
 *
 * Display only, like everything else in this section — never called from a fixed
 * step.
 */
function revolutionsPerMinute(radiansPerSecond: number): number {
  return (angleToDisplay(radiansPerSecond, DISPLAY_UNITS) / 360) * 60;
}

// --- camera and view (§47, §48) ----------------------------------------------

/** Full **vertical** field of view in radians (§7a) — 45°. */
const FIELD_OF_VIEW = Math.PI / 4;

/** Where the camera stands, in world units (metres, §40). */
const CAMERA_POSITION = new Vector3(0, 0.35, 6.2);

const camera = new PerspectiveCamera({
  fieldOfView: FIELD_OF_VIEW,
  aspect: WIDTH / HEIGHT,
  near: 0.1,
  far: 80,
});
camera.name = "camera";
camera.transform.position.copy(CAMERA_POSITION);
camera.updateProjectionMatrix();

/**
 * §46's screen-space layer, and the masks that split the world pass from it
 * (R-37/R-38, adopted here 2026-08-21 — see the module header).
 *
 * Only the UI is named. The machine keeps the **default** layer, and the world
 * view excludes the instruments by asking for {@link DEFAULT_LAYER_MASK} — so a
 * future packet that adds a bearing does not have to remember a layer, and the
 * one mistake this arrangement can make (forgetting the mask on a *new UI* node)
 * is confined to the three funnels that build UI nodes.
 */
defineLayer("ui");
const UI_LAYER = layerMask("ui");

const view = createFullscreenViewport(camera, "world");
/** Near-black, and far from every classifier the browser gate uses. */
view.clearColor = [0.032, 0.036, 0.055, 1];
view.layerMask = DEFAULT_LAYER_MASK;

/**
 * §47's screen camera — the projection **is** the surface's pixel rectangle.
 *
 * `origin: "bottom-left"` rather than §7a's default `"top-left"`: §74's layout
 * writes its children at `(left, −top)`, a Y-**up** frame with downward offsets
 * as negative numbers, and the instrument column below is authored the same way.
 * A top-left origin flips Y in the projection, and every one of those offsets
 * would climb the screen instead of descending it.
 *
 * `Application.resize` maintains its size from here on: any camera in the views
 * that declares `setSurfaceSize` is fed (§45's structural opt-in).
 */
const uiCamera = new ScreenCamera({
  origin: "bottom-left",
  width: WIDTH,
  height: HEIGHT,
  resolution: window.devicePixelRatio,
});
uiCamera.name = "ui-camera";
uiCamera.updateProjectionMatrix();

/**
 * The second full-surface viewport: the "ui" layer only, and **no
 * `clearColor`** — a view that cleared would erase the world pass drawn before
 * it (§48).
 */
const uiView = createFullscreenViewport(uiCamera, "ui");
uiView.layerMask = UI_LAYER;

// --- the application (§45), with §84 statistics on ---------------------------

/**
 * The renderer is **constructed**, not selected.
 *
 * The §62 registry's `"auto"` path is the §118 flagship's subject and is gated
 * there; here it would only add a code path this page does not exercise. The
 * same reasoning as the solver decision in the module header, one size smaller.
 */
const renderer = new WebglRenderer();

const app = new Application({
  renderer,
  canvas,
  views: [view, uiView],
  width: WIDTH,
  height: HEIGHT,
  resolution: window.devicePixelRatio,
  // §84 (A-1, 2026-08-07). The first example in this repository to ask for it.
  // `Application.stats` is `null` unless this is `true` **and** the build is a
  // development build — see `vite.config.ts` for why this one is.
  stats: true,
});

app.scene.add(camera);
app.scene.add(uiCamera);

// --- light (§68) --------------------------------------------------------------

/** The scene-wide ambient term — what keeps an unlit face readable, not black. */
const AMBIENT_LIGHT: Rgba = [0.17, 0.18, 0.22, 1];

app.scene.ambientLight[0] = AMBIENT_LIGHT[0];
app.scene.ambientLight[1] = AMBIENT_LIGHT[1];
app.scene.ambientLight[2] = AMBIENT_LIGHT[2];

/**
 * The key light's aim, as the two rotations that produce it (§68: a directional
 * light shines along its node's −Z world axis, so it is aimed by rotating the
 * node). Composed yaw-after-pitch this puts a bright upper-left and a dim
 * lower-right on the rotor drum, which is what makes a *cylinder* read as a
 * cylinder rather than as a disc.
 */
const SUN_PITCH = -0.7;
const SUN_YAW = -0.45;

const sun = new DirectionalLight({ color: [1, 0.97, 0.92], intensity: 1.3 });
sun.name = "key-light";
sun.transform.rotation
  .setFromAxisAngle(new Vector3(0, 1, 0), SUN_YAW)
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), SUN_PITCH));
app.scene.add(sun);

// --- palette ------------------------------------------------------------------

/** Rotor drum, vanes and the balance weight: amber. */
const ROTOR_COLOR: Rgba = [1, 0.59, 0.16, 1];

/** Stator, end bells, shaft, coupling and bench frame: steel blue. */
const STEEL_COLOR: Rgba = [0.38, 0.48, 0.78, 1];

/** The stator's darker shell, so the end bells read as separate parts. */
const STATOR_COLOR: Rgba = [0.26, 0.33, 0.56, 1];

/** The brake pad the rub fault drives onto the rotor: magenta. */
const PAD_COLOR: Rgba = [0.92, 0.24, 0.67, 1];

/** The bench: near-neutral, and dark enough to trip no classifier. */
const BENCH_COLOR: Rgba = [0.16, 0.17, 0.2, 1];

/** Instrument surfaces: unlit, dark, and deliberately colourless. */
const CHART_BACKGROUND: Rgba = [0.07, 0.075, 0.1, 1];
const CHART_FRAME: Rgba = [0.2, 0.21, 0.25, 1];
const SETPOINT_LINE_COLOR: Rgba = [0.43, 0.43, 0.46, 1];

/** Glyph tint: neutral, so no hue classifier can claim text. */
const LABEL_TINT: Rgba = [0.925, 0.937, 0.965, 1];

// --- the physics world (§20, §21, §37) ---------------------------------------

const physics = new PhysicsSystem();
app.systems.register(physics);

/**
 * The one world: `"3d"`, on a directly-constructed Rapier 3D adapter, with §32
 * sleeping **off** and the application's §43 pose buffer attached.
 *
 * Sleeping is off because a twin that let its machine fall asleep would be
 * lying: the mount's vibration decays toward — but never to — zero, and a solver
 * that parked the stator would freeze the very signal this page measures. Four
 * dynamic bodies cost nothing to keep awake.
 */
const world = physics.track(
  new PhysicsWorld({
    dimension: "3d",
    adapter: new Rapier3dAdapter(),
    poses: app.poses,
    sleeping: { enabled: false },
  }),
);

// --- §24 collision filtering --------------------------------------------------

/**
 * Three §24 filter groups, because in a real machine most parts are held
 * together by *constraints* and must never be held apart by *contacts*.
 *
 * The stator and the bench carry colliders so the solver can derive their mass
 * and inertia from density (§23, §25) — a body with no collider would need an
 * authored mass and an authored inertia tensor, which is two more numbers to get
 * wrong — but their mask is `0`: nothing in this scene may touch them. The only
 * contact pair that exists at all is rotor ↔ brake pad, which is the rub fault,
 * and it is the only contact this twin wants.
 */
const GROUP_INERT = 0x0001;
const GROUP_ROTOR = 0x0002;
const GROUP_PAD = 0x0004;

// --- the machine's geometry, named (§53, §79) --------------------------------

/**
 * Every geometry and material the machine is built from, under a **logical key**.
 *
 * §79 states that "assets are referenced by logical key, resolved through a
 * manifest that maps each key to a URL and content hash (§76)", and A-16 landed
 * the seam for it: a `Renderable` saves *a key, not a copy*, and the application
 * resolves it on the way back in. §76's content hashing is staged (`A-18`), so
 * there is no manifest to resolve against yet — but the seam is real, and a
 * catalog built from a plain `Map` satisfies it exactly as a manifest-backed one
 * would. That is why these two maps exist rather than a scattering of inline
 * `new LitMaterial(...)` calls: they are the twin's resource table, and
 * {@link runSaveLoadAudit} hands them straight to `registerSceneNodeTypes`.
 */
const geometries = new Map<string, BufferGeometry>();
const materials = new Map<string, Material>();

/** Registers `geometry` under `key` and returns it, so a builder reads as one line. */
function geometry(key: string, build: () => BufferGeometry): BufferGeometry {
  const built = build();
  geometries.set(key, built);
  return built;
}

/** Registers `material` under `key` and returns it. */
function material<T extends Material>(key: string, built: T): T {
  materials.set(key, built);
  return built;
}

/**
 * The one unit quad every flat surface on this page is scaled out of.
 *
 * Instrument backgrounds, chart frames, the temperature bar, and every §73 skin
 * quad share it — which is one geometry instead of forty, one §83 allocation
 * instead of forty, and one catalog entry instead of forty. §79's rule that a
 * `Renderable` names a *shared* resource rather than owning a copy is not a
 * serialization detail; it is how a scene should have been built in the first
 * place, and the save is where that shows up.
 */
const unitQuad = geometry("unit-quad", () =>
  planeGeometry({ width: 1, height: 1 }),
);

const steelMaterial = material(
  "steel",
  new LitMaterial({ color: STEEL_COLOR }),
);
const statorMaterial = material(
  "stator",
  new LitMaterial({ color: STATOR_COLOR }),
);
const rotorMaterial = material(
  "rotor",
  new LitMaterial({ color: ROTOR_COLOR }),
);
const padMaterial = material("pad", new LitMaterial({ color: PAD_COLOR }));
const benchMaterial = material(
  "bench",
  new LitMaterial({ color: BENCH_COLOR }),
);

// --- where the machine stands -------------------------------------------------

/**
 * The machine bay's centre, in world units.
 *
 * Everything physical is offset by this, and the instrument column is parented
 * to the camera on the other side of the frame — so the two halves of the page
 * cannot overlap on screen, which is what lets the browser gate crop a region
 * and trust the crop.
 */
const MOTOR_ORIGIN = new Vector3(-2.35, 0, 0);

/** Rotor drum radius and half-length, in metres. */
const ROTOR_RADIUS = 0.5;
const ROTOR_HALF_LENGTH = 0.28;

/** Where the two bearings sit along the shaft axis, relative to the machine. */
const DRIVE_BEARING_Z = -ROTOR_HALF_LENGTH;
const IDLE_BEARING_Z = ROTOR_HALF_LENGTH;

/** Stator half-extents (a box around the rotor, clear of it on every side). */
const STATOR_HALF = new Vector3(0.95, 0.95, 0.5);

/**
 * Where the unbalance mass sits on the rotor, in the rotor's own frame.
 *
 * A balance weight bolted to the front face, off the spin axis: that offset is
 * the entire vibration model. `m · r` here is about 0.082 kg × 0.36 m, so the
 * rotating unbalance force is `m r ω²` ≈ 13 N at the default setpoint — enough
 * to move a 3 kg stator on a 4 kN/m mount by several millimetres, which is what
 * the `vib` readout shows.
 */
const IMBALANCE_OFFSET = new Vector3(0.36, 0, 0.34);

/** Half-extents of the unbalance block, and how much denser it is than steel-1. */
const IMBALANCE_HALF = new Vector3(0.07, 0.07, 0.07);
const IMBALANCE_DENSITY = 30;

/** The compliant mount: a §28 slider for the direction, a spring for the rate. */
const MOUNT_TRAVEL = 0.06;
const MOUNT_STIFFNESS = 4000;
const MOUNT_DAMPING = 14;
const MOUNT_REST_LENGTH = 1.35;

/** Where the bench slab's centre is, below the machine. */
const BENCH_Y = -MOUNT_REST_LENGTH;
const BENCH_HALF = new Vector3(2.2, 0.15, 0.6);

/**
 * The brake pad: where it parks, how far it can travel, how hard it presses.
 *
 * It is a wide shoe — wider than the rotor's crown — so that when it is pressed
 * home its ends stand clear of the drum's silhouette against the background
 * instead of disappearing into it; a fault whose only evidence is a three-pixel
 * sliver is a fault a browser gate cannot see. It parks **inside** the frame,
 * just under the top plate, and travels down onto
 * the rotor's rim — 0.24 m of stroke, of which the last 0.05 m is the interference
 * that makes the contact a *press* rather than a touch, and which at
 * {@link PAD_ENGAGE_SPEED} is under half a second from command to contact. A caliper that parked outside the
 * frame would have to pass through the top plate to reach the rotor, and a twin
 * whose parts intersect on screen is not a twin anyone would trust.
 */
const PAD_PARK_Y = 0.72;
const PAD_HALF = new Vector3(0.34, 0.05, 0.24);
const PAD_TRAVEL_MIN = -0.24;
const PAD_TRAVEL_MAX = 0.02;
const PAD_FORCE = 40;
const PAD_RETRACT_SPEED = 0.6;
const PAD_ENGAGE_SPEED = -0.5;

// --- building the machine -----------------------------------------------------

/** Adds a lit visual part under `parent`, positioned in the parent's frame. */
function addPart(
  parent: Group,
  name: string,
  geo: BufferGeometry,
  mat: LitMaterial,
  x: number,
  y: number,
  z: number,
): Renderable {
  const part = new Renderable(geo, mat);
  part.name = name;
  part.transform.position.set(x, y, z);
  parent.add(part);
  return part;
}

/** A body node: a `Group` under §42 `"physics"` authority, placed and registered. */
function addBodyNode(
  name: string,
  offset: Vector3,
  type: "static" | "dynamic",
): Group {
  const node = new Group();
  node.name = name;
  node.transform.position.set(
    MOTOR_ORIGIN.x + offset.x,
    MOTOR_ORIGIN.y + offset.y,
    MOTOR_ORIGIN.z + offset.z,
  );
  // §42: exactly one system writes a transform, and for all four of these it is
  // the solver's.
  node.transformAuthority = "physics";
  node.addComponent(new RigidBody({ type }));
  app.scene.add(node);
  return node;
}

// The bench: the machine's foundation, and the only static body.
const bench = addBodyNode("bench", new Vector3(0, BENCH_Y, 0), "static");
bench.addComponent(
  new Collider({
    shape: { type: "box", halfExtents: BENCH_HALF },
    collisionGroups: GROUP_INERT,
    collisionMask: 0,
  }),
);
addPart(
  bench,
  "bench-slab",
  geometry("bench-slab", () =>
    boxGeometry({
      width: BENCH_HALF.x * 2,
      height: BENCH_HALF.y * 2,
      depth: BENCH_HALF.z * 2,
    }),
  ),
  benchMaterial,
  0,
  0,
  0,
);

/**
 * The rotor's own collider: a cylinder whose axis is rotated onto **+Z**.
 *
 * `cylinderGeometry` and §24's `"cylinder"` shape are both about **+Y** (§53),
 * and this machine spins about +Z — toward the viewer — because that is the one
 * axis on which a rotation is not foreshortened, and a demonstration whose
 * motion cannot be seen is not a demonstration. A quarter turn about +X takes
 * +Y onto +Z, and §24's collider `offset` is where that belongs: the shape stays
 * canonical and the *placement* carries the orientation.
 */
const ROTOR_AXIS_OFFSET = new Transform();
ROTOR_AXIS_OFFSET.rotation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/**
 * Two isolator posts on the bench, under the machine.
 *
 * Visual only, and worth the two draw calls: the stator hangs on a spring and a
 * slider, so without something to hang *from* it reads as a box floating above a
 * slab. The posts stand still while the machine moves against them, which is
 * what makes the mount's compliance legible rather than merely measured.
 */
const isolator = geometry("isolator-post", () =>
  boxGeometry({ width: 0.26, height: 0.22, depth: 0.4 }),
);
for (const x of [-0.62, 0.62]) {
  addPart(
    bench,
    `isolator-post-${x < 0 ? "left" : "right"}`,
    isolator,
    steelMaterial,
    x,
    BENCH_HALF.y + 0.11,
    0,
  );
}

// The stator: the motor's frame, hung on the compliant mount.
const stator = addBodyNode("stator", new Vector3(0, 0, 0), "dynamic");

/**
 * The stator's collider is a **mass model, not a contact surface.**
 *
 * Its mask is `0`, so nothing can ever touch it (see {@link GROUP_INERT}); the
 * only thing the solver does with this shape is derive the frame's mass and
 * rotational inertia from its density (§23, §25). A solid envelope the size of
 * the machine is the right model for that and needs no authored mass or inertia
 * tensor — two more numbers to get wrong. The plates below draw the *frame*,
 * which is open at the front, and the two are deliberately not the same shape:
 * every other example in this repository builds a drawn box and its collider
 * from one pair of numbers, and this is the case where that rule does not apply
 * and the reason is stated instead.
 */
stator.addComponent(
  new Collider({
    shape: { type: "box", halfExtents: STATOR_HALF },
    collisionGroups: GROUP_INERT,
    collisionMask: 0,
  }),
);

/** Plate thickness, and how far the frame's back wall sits behind the rotor. */
const PLATE = 0.08;
const BACK_PLATE_Z = -0.44;

/**
 * The frame, as five plates around an **open front**.
 *
 * A closed casing is what a real motor has and what a demonstration cannot
 * afford: the first build of this page drew a solid box, and the rotor — the one
 * moving part §119 is about — was invisible behind it. So the machine is drawn
 * as a test-bench cradle, which is what a twin's subject usually is anyway: base
 * and top plates, a back wall, two side plates, and nothing between the viewer
 * and the rotor.
 */
const platePairs: readonly (readonly [
  string,
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  [
    "base-plate",
    STATOR_HALF.x * 2,
    PLATE * 2,
    STATOR_HALF.z * 2,
    0,
    -STATOR_HALF.y + PLATE,
    0,
  ],
  [
    "top-plate",
    STATOR_HALF.x * 2,
    PLATE * 2,
    STATOR_HALF.z * 2,
    0,
    STATOR_HALF.y - PLATE,
    0,
  ],
  [
    "back-plate",
    STATOR_HALF.x * 2,
    STATOR_HALF.y * 2,
    PLATE * 1.5,
    0,
    0,
    BACK_PLATE_Z,
  ],
  [
    "side-plate-left",
    PLATE * 2,
    STATOR_HALF.y * 2,
    STATOR_HALF.z * 2,
    -STATOR_HALF.x + PLATE,
    0,
    0,
  ],
  [
    "side-plate-right",
    PLATE * 2,
    STATOR_HALF.y * 2,
    STATOR_HALF.z * 2,
    STATOR_HALF.x - PLATE,
    0,
    0,
  ],
];
for (const [name, width, height, depth, x, y, z] of platePairs) {
  addPart(
    stator,
    name,
    geometry(name, () => boxGeometry({ width, height, depth })),
    statorMaterial,
    x,
    y,
    z,
  );
}

/**
 * End bells: the two bearing housings, one ring per bearing.
 *
 * `torusGeometry` lays its ring in **XZ**, about +Y, "so the ring lies flat on
 * the ground plane of a Y-up world" (§53) — which is the right default for a
 * gear lying on a bench and the wrong one for a bearing race on a horizontal
 * shaft. A quarter turn about +X stands it up, the same rotation the rotor's
 * cylinder takes and for the same reason.
 */
const endBell = geometry("end-bell", () =>
  torusGeometry({
    radius: ROTOR_RADIUS + 0.09,
    tubeRadius: 0.06,
    tubularSegments: 28,
    radialSegments: 10,
  }),
);
for (const [name, z] of [
  ["bearing-drive", DRIVE_BEARING_Z],
  ["bearing-idle", IDLE_BEARING_Z],
] as const) {
  addPart(
    stator,
    name,
    endBell,
    steelMaterial,
    0,
    0,
    z,
  ).transform.rotation.copy(ROTOR_AXIS_OFFSET.rotation);
}

/** Cooling fins along the top of the frame — four thin plates, purely visual. */
const fin = geometry("cooling-fin", () =>
  boxGeometry({ width: STATOR_HALF.x * 1.7, height: 0.13, depth: 0.05 }),
);
for (let i = 0; i < 4; i += 1) {
  addPart(
    stator,
    `cooling-fin-${String(i)}`,
    fin,
    steelMaterial,
    0,
    STATOR_HALF.y + 0.05,
    -0.3 + i * 0.2,
  );
}

/** The terminal box — the detail that makes the frame read as a motor. */
addPart(
  stator,
  "terminal-box",
  geometry("terminal-box", () =>
    boxGeometry({ width: 0.3, height: 0.22, depth: 0.3 }),
  ),
  steelMaterial,
  -STATOR_HALF.x - 0.1,
  0.28,
  0,
);

// The rotor: the one part the motor actually drives.
const rotor = addBodyNode("rotor", new Vector3(0, 0, 0), "dynamic");

rotor.addComponent(
  new Collider({
    shape: {
      type: "cylinder",
      halfHeight: ROTOR_HALF_LENGTH,
      radius: ROTOR_RADIUS,
    },
    offset: ROTOR_AXIS_OFFSET,
    friction: 0.9,
    collisionGroups: GROUP_ROTOR,
    collisionMask: GROUP_PAD,
  }),
);

/**
 * The unbalance: a **second collider on the same body**, expressed as a child
 * node.
 *
 * §6a allows one component of each type per node, and `PhysicsWorld.addBody`
 * scans the whole subtree and claims every collider whose §24 ancestor walk
 * names this body — which is exactly why several colliders on one body are
 * written as child nodes (WP-5.2). So this node is not a second body: it is the
 * rotor's balance weight, and the solver folds its mass into the rotor's, moving
 * the rotor's centre of mass off the spin axis. Everything the vibration
 * readout shows follows from that one displacement.
 */
const IMBALANCE_TRANSFORM = new Transform();
IMBALANCE_TRANSFORM.position.copy(IMBALANCE_OFFSET);

const imbalance = new Group();
imbalance.name = "balance-weight";
imbalance.addComponent(
  new Collider({
    shape: { type: "box", halfExtents: IMBALANCE_HALF },
    offset: IMBALANCE_TRANSFORM,
    density: IMBALANCE_DENSITY,
    collisionGroups: GROUP_INERT,
    collisionMask: 0,
  }),
);
rotor.add(imbalance);

addPart(
  rotor,
  "rotor-drum",
  geometry("rotor-drum", () =>
    cylinderGeometry({
      radius: ROTOR_RADIUS,
      height: ROTOR_HALF_LENGTH * 2,
      radialSegments: 28,
    }),
  ),
  rotorMaterial,
  0,
  0,
  0,
).transform.rotation.copy(ROTOR_AXIS_OFFSET.rotation);

addPart(
  rotor,
  "shaft",
  geometry("shaft", () => cylinderGeometry({ radius: 0.09, height: 1.65 })),
  steelMaterial,
  0,
  0,
  0,
).transform.rotation.copy(ROTOR_AXIS_OFFSET.rotation);

addPart(
  rotor,
  "coupling",
  geometry("coupling", () => cylinderGeometry({ radius: 0.2, height: 0.16 })),
  steelMaterial,
  0,
  0,
  0.76,
).transform.rotation.copy(ROTOR_AXIS_OFFSET.rotation);

/**
 * Six vanes on the rotor's visible face.
 *
 * A cylinder turning about its own axis is rotationally symmetric and therefore
 * *invisible* in a screenshot; the vanes and the balance weight are what make
 * the rotation something a browser gate can measure in changed pixels. They are
 * visual only — the collider above is still a plain cylinder, because a vaned
 * collider would rub on the brake pad at six discrete angles and turn a smooth
 * fault into a hammer.
 */
const VANE_COUNT = 6;
const vane = geometry("rotor-vane", () =>
  boxGeometry({ width: 0.09, height: ROTOR_RADIUS * 0.82, depth: 0.06 }),
);
for (let i = 0; i < VANE_COUNT; i += 1) {
  const angle = (i / VANE_COUNT) * Math.PI * 2;
  const radius = ROTOR_RADIUS * 0.52;
  const part = addPart(
    rotor,
    `rotor-vane-${String(i)}`,
    vane,
    rotorMaterial,
    Math.cos(angle) * radius,
    Math.sin(angle) * radius,
    ROTOR_HALF_LENGTH + 0.03,
  );
  part.transform.rotation.setFromAxisAngle(
    new Vector3(0, 0, 1),
    angle + Math.PI / 2,
  );
}

addPart(
  rotor,
  "balance-weight-block",
  geometry("balance-weight", () =>
    boxGeometry({
      width: IMBALANCE_HALF.x * 2,
      height: IMBALANCE_HALF.y * 2,
      depth: IMBALANCE_HALF.z * 2,
    }),
  ),
  rotorMaterial,
  IMBALANCE_OFFSET.x,
  IMBALANCE_OFFSET.y,
  IMBALANCE_OFFSET.z,
);

// The brake pad: parked clear of the rotor until a rub fault is injected.
const pad = addBodyNode("brake-pad", new Vector3(0, PAD_PARK_Y, 0), "dynamic");
pad.addComponent(
  new Collider({
    shape: { type: "box", halfExtents: PAD_HALF },
    friction: 1.2,
    collisionGroups: GROUP_PAD,
    collisionMask: GROUP_ROTOR,
  }),
);
addPart(
  pad,
  "brake-shoe",
  geometry("brake-shoe", () =>
    boxGeometry({
      width: PAD_HALF.x * 2,
      height: PAD_HALF.y * 2,
      depth: PAD_HALF.z * 2,
    }),
  ),
  padMaterial,
  0,
  0,
  0,
);

/**
 * The caliper's faceplate: the shoe again, drawn in front of everything.
 *
 * Purely visual, and it exists because of what a screenshot showed. The shoe
 * itself sits *inside* the frame, at the rotor's own depth, so the drum and the
 * bearing ring hide all but a few pixels of it — a fault whose evidence is
 * invisible is not a demonstration. This plate rides the same body at
 * {@link CALIPER_FACE_Z}, clear of every other part, so the actuator's travel is
 * legible from outside: it is a magenta bar that moves a quarter of a metre when
 * the fault is injected. The collider is unchanged, so nothing here alters what
 * the solver does.
 */
const CALIPER_FACE_Z = 0.46;
addPart(
  pad,
  "caliper-face",
  geometry("caliper-face", () =>
    boxGeometry({
      width: PAD_HALF.x * 2,
      height: PAD_HALF.y * 2.4,
      depth: 0.05,
    }),
  ),
  padMaterial,
  0,
  0,
  CALIPER_FACE_Z,
);

// --- the joints (§28) ---------------------------------------------------------

/** The shaft axis: +Z, toward the viewer. */
const SHAFT_AXIS = new Vector3(0, 0, 1);

/** The mount axis: +Y, the one direction the stator may move. */
const MOUNT_AXIS = new Vector3(0, 1, 0);

/** A world-space point in the machine's frame. */
function machinePoint(x: number, y: number, z: number): Vector3 {
  return new Vector3(
    MOTOR_ORIGIN.x + x,
    MOTOR_ORIGIN.y + y,
    MOTOR_ORIGIN.z + z,
  );
}

/** The §28 motor's effort number. See {@link MOTOR_GAIN} for what it means here. */
const MOTOR_GAIN = 1;

/**
 * The drive-end bearing, which is also the motorised shaft — the two are the
 * same joint because in a real machine they are the same bearing.
 */
let driveBearing: HingeJoint;
/** The non-drive-end bearing: the same constraint, undriven. */
let idleBearing: HingeJoint;
/** The mount's slider, which decides *which way* the stator may move. */
let mountSlider: SliderJoint;
/** The mount's spring, which decides *how hard* it resists moving that way. */
let mountSpring: SpringJoint;
/** The brake actuator: a §28 **slider motor**, the rub fault's muscle. */
let brakeActuator: SliderJoint;

/** The four registered bodies, once the solver has them. */
let statorBody: RigidBody;
let rotorBody: RigidBody;
let padBody: RigidBody;

/**
 * Hands the machine to the solver and joints it.
 *
 * Deliberately a function called from {@link main} rather than statements at
 * module scope: `PhysicsWorld.addBody` refuses to run before
 * `world.initialize()` has decoded the wasm image (§37 puts the load there), so
 * everything that touches the solver has to be on the far side of that `await`.
 *
 * Order matters: a joint's anchors are world-space at `addJoint` and are baked
 * into body-local frames *there* (§28), so both of its bodies must exist and be
 * standing where they belong first.
 */
function registerMachine(): void {
  const benchBody = world.addBody(bench);
  statorBody = world.addBody(stator);
  rotorBody = world.addBody(rotor);
  padBody = world.addBody(pad);

  // The compliant mount, in two joints. A slider alone would let the stator
  // free-fall along its axis; a spring alone would let it swing like a pendulum.
  // Together they are a machine mount: one direction of travel, a rate, and a
  // damping — which is how a mount is specified on a real data sheet.
  mountSlider = world.addJoint(
    new SliderJoint({
      bodyA: benchBody,
      bodyB: statorBody,
      anchor: machinePoint(0, 0, 0),
      axis: MOUNT_AXIS,
      limits: { min: -MOUNT_TRAVEL, max: MOUNT_TRAVEL },
    }),
  ) as SliderJoint;
  mountSpring = world.addJoint(
    new SpringJoint({
      bodyA: benchBody,
      bodyB: statorBody,
      anchorA: machinePoint(0, BENCH_Y, 0),
      anchorB: machinePoint(0, 0, 0),
      restLength: MOUNT_REST_LENGTH,
      stiffness: MOUNT_STIFFNESS,
      damping: MOUNT_DAMPING,
    }),
  ) as SpringJoint;

  // §119's "bearing constraints", plural and literal: two coaxial hinges, one at
  // each end of the shaft. A single hinge already constrains five degrees of
  // freedom, so the pair is *redundant* in the strict sense — and that is what a
  // bearing pair is in a real machine too. It was measured before it was
  // written: with both hinges the solver holds the shaft steady for 900 steps
  // with the rub fault applied and released, which is the check that mattered.
  driveBearing = world.addJoint(
    new HingeJoint({
      bodyA: statorBody,
      bodyB: rotorBody,
      anchor: machinePoint(0, 0, DRIVE_BEARING_Z),
      axis: SHAFT_AXIS,
      // The motor exists from construction because §28 motors cannot be *added*
      // to a registered joint, only reconfigured — so a shaft that will ever be
      // driven is built with a motor, even one commanding zero.
      motor: { enabled: true, targetVelocity: 0, maxTorque: MOTOR_GAIN },
    }),
  ) as HingeJoint;
  idleBearing = world.addJoint(
    new HingeJoint({
      bodyA: statorBody,
      bodyB: rotorBody,
      anchor: machinePoint(0, 0, IDLE_BEARING_Z),
      axis: SHAFT_AXIS,
    }),
  ) as HingeJoint;

  // The rub fault's actuator: §28's *linear* motor, the twin of the hinge's.
  // Parked at its upper limit, driven down onto the rotor when a fault is
  // injected — a physical fault, not a number this file subtracts from a
  // reading.
  brakeActuator = world.addJoint(
    new SliderJoint({
      bodyA: statorBody,
      bodyB: padBody,
      anchor: machinePoint(0, PAD_PARK_Y, 0),
      axis: MOUNT_AXIS,
      limits: { min: PAD_TRAVEL_MIN, max: PAD_TRAVEL_MAX },
      motor: {
        enabled: true,
        targetVelocity: PAD_RETRACT_SPEED,
        maxForce: PAD_FORCE,
      },
    }),
  ) as SliderJoint;
}

// --- the control law (§111, §119) --------------------------------------------

/** The fixed simulation step, in seconds (§10) — restated for the controller. */
const FIXED_DELTA_TIME = 1 / 60;

/** Speed range the operator may command, in RPM, and the twin's default. */
const SETPOINT_MIN_RPM = 0;
const SETPOINT_MAX_RPM = 320;
const SETPOINT_STEP_RPM = 10;
const SETPOINT_DEFAULT_RPM = 200;

/** RPM to rad/s — the *authoring* direction, and the one place it happens. */
function radiansPerSecondFromRpm(rpm: number): number {
  return (rpm * Math.PI * 2) / 60;
}

/** Gains, tuned against the plant this file builds — see the class note in §111. */
const PID_KP = 0.9;
const PID_KI = 4;
const PID_KD = 0.01;

/**
 * The controller's own actuator limits, in rad/s.
 *
 * §111's sketch puts `outputLimits` in the controlled quantity's own units, and
 * here that is a **maximum commanded shaft speed** — a real limit of the drive,
 * which is what makes the controller's built-in anti-windup meaningful.
 */
const PID_OUTPUT_LIMITS: readonly [number, number] = [0, 60];

/**
 * The ceiling a drive sag imposes on the command, in rad/s — about 134 rpm,
 * two-thirds of the default setpoint.
 *
 * A supply sag does not make a drive weaker in the sense of a smaller gain: the
 * controller would simply integrate that away, because this plant's load is
 * small and the loop has authority to spare. What a sag actually does is cap the
 * achievable speed, and that is a limit no controller can integrate through. So
 * the fault is expressed as {@link deratedDrive}'s `outputLimits`, and the
 * standing speed error it leaves is the honest signature of a saturated
 * actuator.
 */
const DRIVE_FAULT_CEILING = 14;

/**
 * The speed loop.
 *
 * The output is taken as the hinge motor's `targetVelocity`, not as its
 * `maxTorque`, for the reason Phase 8 recorded when it proved this arrangement
 * on a real Rapier hinge (WP-8.4): Rapier's motor is
 * `effort = maxTorque · (targetVelocity − ω)`, so modulating `targetVelocity`
 * leaves the actuator linear and makes this the textbook **cascade** — an outer
 * PID on speed around an inner proportional velocity drive. Modulating
 * `maxTorque` would make the loop gain the manipulated variable, on a plant
 * whose sign cannot even be commanded, and would break outright on a solver
 * where `maxTorque` is §28's hard cap.
 */
const healthyDrive = new PIDController({
  kp: PID_KP,
  ki: PID_KI,
  kd: PID_KD,
  outputLimits: [PID_OUTPUT_LIMITS[0], PID_OUTPUT_LIMITS[1]],
});

/**
 * The same loop with a **derated actuator** — the drive-sag fault.
 *
 * A second controller rather than a clamp applied outside one, and that is a
 * decision worth recording because the first build of this page got it wrong.
 * Saturating the output *after* `update` returns leaves the controller blind to
 * its own limit: it keeps integrating against an error it cannot fix. Holding
 * the integrator by setting `ki = 0` — the obvious repair — is worse, because it
 * removes the accumulated term from the output as well as freezing it, so the
 * command falls below the ceiling, un-clamps, integrates, re-clamps, and the
 * drive oscillates between two values every other step. That limit cycle was
 * measured (the command alternated 8.7 / 14.0 rad/s and the shaft settled at
 * their average) before it was diagnosed.
 *
 * §111's `outputLimits` already solve this exactly: the controller's own
 * anti-windup rejects an integration step that would drive it further into a
 * limit it is already against. So the sag is expressed the way the API wants —
 * as a controller whose actuator limit *is* the sag — and the standing speed
 * error it produces is real, stable, and windup-free.
 */
const deratedDrive = new PIDController({
  kp: PID_KP,
  ki: PID_KI,
  kd: PID_KD,
  outputLimits: [PID_OUTPUT_LIMITS[0], DRIVE_FAULT_CEILING],
});

/** Whichever of the two is closing the loop right now. */
let speedController = healthyDrive;

/** The commanded speed, in rad/s. Written by the slider, read by the loop. */
let setpoint = radiansPerSecondFromRpm(SETPOINT_DEFAULT_RPM);

/** Whether the operator has injected a bearing rub. */
let rubFault = false;

/** Whether the operator has injected a drive sag. */
let driveFault = false;

/** The scripted fault: a one-second rub, at the same two steps on every run. */
const SCRIPTED_RUB_FROM = 180;
const SCRIPTED_RUB_UNTIL = 240;

/** Set once the operator touches the rub control, retiring the scripted fault. */
let rubOperated = false;

/** Fixed simulation steps this page has run. The twin's clock (§33). */
let simulationStep = 0;

/** The last command sent to the drive, in rad/s, and the effort it implies. */
let lastCommand = 0;
let motorTorque = 0;

/** Whether the drive is energised — cleared by a thermal trip. */
let driveEnergised = true;

/**
 * One actuation, as one JSON payload.
 *
 * This is the twin's **command log entry**: what was sent to the machine on one
 * fixed step. It is the thing {@link actuate} applies and the thing
 * `ReplayRecorder.recordInput` records, so live operation and replay cannot
 * diverge by construction — there is one code path, and the recording is a log
 * of its arguments.
 */
interface Actuation {
  /** Commanded shaft speed in rad/s (§7a). */
  readonly v: number;
  /** `1` when the drive is energised, `0` when tripped. */
  readonly e: number;
  /** Commanded brake-pad speed in m/s along the mount axis. */
  readonly p: number;
}

/**
 * Applies one actuation to the machine — the **only** place either motor is
 * commanded.
 *
 * §28's commands are queued and drained by the next fixed step, never applied as
 * mutations, so calling this from `PRIORITY_COMMANDS` means the step that runs
 * immediately afterwards is the step the command was computed for.
 *
 * On `maxTorque`: this adapter declares `jointMotorEffortCap: false`, so §28's
 * effort limit is a **strength gain** rather than a hard cap here — a bigger
 * number is a stronger motor, but it will not stall at that value. The engine
 * warns about this once per world, which is the correct behaviour and is left
 * un-suppressed; `examples/mechanism` documents the same limitation for the same
 * adapter.
 */
function actuate(command: Actuation): void {
  driveBearing.setMotor({
    enabled: command.e === 1,
    targetVelocity: command.v,
    maxTorque: MOTOR_GAIN,
  });
  brakeActuator.setMotor({
    enabled: true,
    targetVelocity: command.p,
    maxForce: PAD_FORCE,
  });
}

// --- the thermal model (§119 "temperature indicators") ------------------------

/** Ambient, in degrees Celsius — where the machine starts and returns to. */
const AMBIENT_TEMPERATURE = 22;

/** Rated torque, in newton-metres: the load that produces one per-unit loss. */
const TORQUE_RATED = 0.3;

/** The largest per-unit load the thermal model will believe. */
const LOAD_CEILING = 2;

/** Windage and iron loss, in per-unit — what a running machine dissipates unloaded. */
const LOSS_IDLE = 0.12;

/** Steady-state rise at one per-unit loss, in kelvin. */
const THERMAL_RISE = 30;

/** Thermal time constant, in seconds. */
const THERMAL_TAU = 4;

/**
 * Where the twin trips the drive, and where it will re-energise.
 *
 * Chosen so a trip is a *deliberate* act rather than an accident of the
 * demonstration: the scripted one-second rub raises the winding by about eight
 * kelvin and never comes close, while holding the `rub` control engaged reaches
 * the trip in roughly five seconds — long enough to watch the temperature climb
 * and the trace bend, short enough to sit through.
 */
const TRIP_TEMPERATURE = 135;
const RESET_TEMPERATURE = 70;

/** Winding temperature in degrees Celsius. Integrated on the fixed step. */
let temperature = AMBIENT_TEMPERATURE;

/** Whether a thermal trip has de-energised the drive. */
let tripped = false;

/** How many times the twin has tripped this session. */
let trips = 0;

/**
 * Advances the winding temperature by one fixed step.
 *
 * A first-order lumped model, and nothing more: copper loss rises with the
 * square of the torque (because it rises with the square of the current), iron
 * and windage add a constant, and the winding approaches its steady-state rise
 * with one time constant. It is integrated with the **injected** fixed delta,
 * never with elapsed wall time, so it is as deterministic as the solver beside
 * it — which is the only reason `data-temperature` can be compared across two
 * page loads at all.
 *
 * The load is clamped at {@link LOAD_CEILING} because the model has no business
 * extrapolating: a seized rotor produces a torque error far outside anything
 * this curve was fitted to, and a thermal model that answered confidently there
 * would be inventing numbers.
 */
function updateThermalModel(): void {
  const load = driveEnergised
    ? Math.min(Math.abs(motorTorque) / TORQUE_RATED, LOAD_CEILING)
    : 0;
  const power = driveEnergised ? LOSS_IDLE + load * load : 0;
  const target = AMBIENT_TEMPERATURE + power * THERMAL_RISE;
  temperature += ((target - temperature) / THERMAL_TAU) * FIXED_DELTA_TIME;

  if (!tripped && temperature >= TRIP_TEMPERATURE) {
    tripped = true;
    trips += 1;
    // The plant the integrator's history describes no longer exists: the drive
    // is open. §111's own advice, and the reason `reset` is public.
    speedController.reset();
  } else if (tripped && temperature <= RESET_TEMPERATURE) {
    tripped = false;
  }
}

// --- the recorder (§34) -------------------------------------------------------

/** Fixed steps the twin records before closing the recording. 10 s at 60 Hz. */
const RECORD_STEPS = 600;

/** Steps between periodic snapshots — the whole reason a seek is cheap (§34). */
const SNAPSHOT_INTERVAL_STEPS = 60;

/** The step whose checksum this page publishes as its §33 fingerprint. */
const MARK_STEP = 360;

/** The step the replay audit seeks to. Deliberately not a snapshot multiple. */
const SEEK_STEP = 305;

/** The run's seed (§33). Nothing here reads it — it is recorded metadata. */
const RUN_SEED = 20260808;

const recorder = new ReplayRecorder();

/** The recording, once {@link RECORD_STEPS} have been recorded. */
let recording: ReturnType<ReplayRecorder["end"]> | null = null;

/** Steps the closed recording holds, kept because `end()` resets the recorder. */
let recordedSteps = 0;

/** The world's §33 checksum at {@link MARK_STEP}, and at {@link SEEK_STEP}. */
let markChecksum = 0;
let seekReference = 0;

// --- systems (§39) ------------------------------------------------------------

/**
 * Step 2 of §39: the controller.
 *
 * Reads the speed the previous step ended on, computes a command, applies it,
 * and logs it. Every one of those four verbs is a function of the step index and
 * the plant state, and of nothing else — no wall clock, no `Math.random`, no
 * unit conversion (§40's helpers are documented as inexact and are kept out of
 * here on purpose).
 */
function driveTheMotor(): void {
  const measured = rotorBody.angularVelocity.z;
  const command = speedController.update(setpoint, measured, FIXED_DELTA_TIME);

  const scriptedRub =
    !rubOperated &&
    simulationStep >= SCRIPTED_RUB_FROM &&
    simulationStep < SCRIPTED_RUB_UNTIL;
  const engage = rubFault || scriptedRub;

  driveEnergised = !tripped;
  lastCommand = driveEnergised ? command : 0;
  motorTorque = driveEnergised ? MOTOR_GAIN * (command - measured) : 0;

  const actuation: Actuation = {
    v: lastCommand,
    e: driveEnergised ? 1 : 0,
    p: engage ? PAD_ENGAGE_SPEED : PAD_RETRACT_SPEED,
  };
  actuate(actuation);
  if (recorder.isRecording) {
    recorder.recordInput(simulationStep, { ...actuation });
  }
}

const controlSystem: SimulationSystem = {
  priority: PRIORITY_COMMANDS,
  initialize(): void {
    // Nothing to set up: the plant is built before the system is registered.
  },
  fixedUpdate(): void {
    driveTheMotor();
  },
  dispose(): void {
    // Deliberately empty; the world outlives the system.
  },
};

/**
 * Step 9-and-a-half of §39: the instruments.
 *
 * After the solve and after §29's dispatch, before §43's pose capture. It
 * samples the machine the way a data logger would — once per step, at the same
 * point in the step, every step — because a chart fed at the render rate would
 * be a chart of the browser's frame timing rather than of the machine.
 */
const INSTRUMENT_PRIORITY = 950;

/**
 * How many samples the strip charts hold, and how many fixed steps apart they
 * are taken: 90 points, one every other step — a three-second window.
 *
 * The decimation is not thrift, it is legibility, and it was measured. At one
 * sample per step the window is 180 points across 430 device pixels, so a
 * segment is 2.4 px long — and a **horizontal** 2.4 px `GL_LINES` segment does
 * not reliably produce a fragment, because OpenGL's diamond-exit rule can drop a
 * short line that never leaves a pixel's diamond. The result was a flat trace
 * rendered as evenly spaced dashes: a chart that lied about a steady machine by
 * looking like a broken one. At 90 points a segment is 4.8 px and every one of
 * them rasterises.
 *
 * This is the second thing `R-24` costs (the first is having to write the
 * `Float32Array` at all): a stroked path would be a filled shape and would have
 * no minimum length.
 */
const CHART_SAMPLES = 90;
const SAMPLE_INTERVAL_STEPS = 2;

/** The window the vibration reading is a peak-to-peak of: one second. */
const VIBRATION_WINDOW = 60;

/** Ring buffers, one per trace, plus the mount-deflection window. */
const speedSamples = new Float32Array(CHART_SAMPLES);
const commandSamples = new Float32Array(CHART_SAMPLES);
const vibrationSamples = new Float32Array(CHART_SAMPLES);
const temperatureSamples = new Float32Array(CHART_SAMPLES);
const deflectionWindow = new Float32Array(VIBRATION_WINDOW);

/** Where the next sample goes; the charts read forward from here. */
let sampleHead = 0;

/** Peak-to-peak mount deflection over the window, in metres. */
let vibrationAmplitude = 0;

/** The stator's rest height, captured once the mount has settled. */
let mountRestY = 0;

/** The mount's deflection from rest, in metres — signed, for the overlay. */
let mountDeflection = 0;

const instrumentSystem: SimulationSystem = {
  priority: INSTRUMENT_PRIORITY,
  initialize(): void {
    // Nothing to set up.
  },
  fixedUpdate(): void {
    simulationStep += 1;

    mountDeflection = stator.transform.position.y - mountRestY;
    deflectionWindow[simulationStep % VIBRATION_WINDOW] = mountDeflection;
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < VIBRATION_WINDOW; i += 1) {
      const value = deflectionWindow[i];
      if (value < lowest) lowest = value;
      if (value > highest) highest = value;
    }
    vibrationAmplitude = highest - lowest;

    updateThermalModel();

    if (simulationStep % SAMPLE_INTERVAL_STEPS === 0) {
      speedSamples[sampleHead] = rotorBody.angularVelocity.z;
      commandSamples[sampleHead] = lastCommand;
      vibrationSamples[sampleHead] = vibrationAmplitude;
      temperatureSamples[sampleHead] = temperature;
      sampleHead = (sampleHead + 1) % CHART_SAMPLES;
    }

    if (simulationStep === MARK_STEP) {
      markChecksum = world.checksum();
    }
    if (simulationStep === SEEK_STEP) {
      seekReference = world.checksum();
    }
  },
  dispose(): void {
    // Deliberately empty.
  },
};

app.systems.register(controlSystem);
app.systems.register(instrumentSystem);

// --- text (§55, §56) ----------------------------------------------------------

/**
 * The font, packed once into one RGBA8 buffer with a uv rectangle per glyph.
 * ASCII only: the built-in 6 × 12 face covers U+0020…U+007E.
 */
const atlas = buildGlyphAtlas();

/**
 * The whole sheet as one texture, sampled with §77's `"nearest"` filter (R-30):
 * the face is a bitmap, and a linear filter blends each texel with its
 * neighbours — at a cell's edge, with the neighbouring *glyph*.
 */
const font = new Texture({ ...atlas, filter: "nearest" });

/**
 * One material behind **every** label on this page — nameplate, readouts and
 * widget captions alike — registered in the §79 catalog like every other shared
 * resource here, so a saved document names it once.
 *
 * Until 2026-08-21 this section held `examples/first-2d-scene`'s workaround: one
 * cut-out `Texture` and one catalog `SpriteMaterial` per distinct glyph cell,
 * and one `Sprite` per drawn glyph, because a sprite maps its whole texture
 * across its whole quad and §55's frame sub-rectangle never landed. R-28's
 * `Text` node addresses the cells with §53 per-vertex uvs, so a label is one
 * node, one geometry and one draw — and the catalog carries one glyph material
 * instead of ninety-odd.
 */
const ink = material(
  "label-ink",
  new UnlitMaterial({
    map: font,
    transparent: true,
    color: [LABEL_TINT[0], LABEL_TINT[1], LABEL_TINT[2], LABEL_TINT[3]],
  }),
);

/**
 * A label node: one geometry, one draw, left-aligned on its own origin.
 *
 * `renderLayer: 1` draws it after the opaque scene — it blends, and blending
 * needs what is behind it already in the framebuffer (§66).
 */
function makeLabel(name: string, text: string, size: number): Text {
  const label = new Text(atlas, ink, { text, size, renderLayer: 1 });
  label.name = name;
  return label;
}

/** The machine's nameplate, in world space above the stator. */
const nameplate = makeLabel("nameplate", "MOTOR-01  3ph  4kW", 0.19);
nameplate.transform.position.set(
  MOTOR_ORIGIN.x - 0.62,
  MOTOR_ORIGIN.y + 1.42,
  MOTOR_ORIGIN.z,
);
app.scene.add(nameplate);

// --- the instrument column (screen-space; §46/§47/§48) -----------------------

/**
 * How far in front of the camera the instrument plane sits, in world units.
 *
 * At {@link FIELD_OF_VIEW} the visible half-height there is
 * `UI_DEPTH · tan(fov/2)` = **0.911** and the half-width `× aspect` = **1.458**
 * — the box every layout number below is placed inside. One instrument unit is
 * therefore `HEIGHT / (2 × 0.911)` ≈ 329 CSS pixels.
 */
const UI_DEPTH = 2.2;

/** The instrument column's left and right edges, in instrument units. */
const COLUMN_LEFT = 0.1;
const COLUMN_RIGHT = 1.4;

/** Chart A (speed) and chart B (health), as `[bottom, top]` pairs. */
const CHART_A_BOTTOM = 0.6;
const CHART_A_TOP = 0.88;
const CHART_B_BOTTOM = 0.26;
const CHART_B_TOP = 0.54;

/** Full-scale values the traces are mapped against. */
const CHART_RPM_FULL = SETPOINT_MAX_RPM;
const CHART_VIBRATION_FULL_MM = 24;
const CHART_TEMPERATURE_FULL = 150;

/** Depths inside the instrument plane, so the layers cannot z-fight. */
const CHART_BACK_Z = 0;
const CHART_LINE_Z = 0.006;
const CHART_TRACE_Z = 0.01;
const READOUT_Z = 0.014;

/** Trace colours — see the palette table in the module header. */
const TRACE_SPEED_COLOR: Rgba = [0.24, 0.86, 0.94, 1];
const TRACE_COMMAND_COLOR: Rgba = [1, 0.86, 0.31, 1];
const TRACE_VIBRATION_COLOR: Rgba = [0.31, 0.9, 0.47, 1];
const TRACE_TEMPERATURE_COLOR: Rgba = [1, 0.43, 0.2, 1];

/**
 * How many canvas pixels one instrument unit is.
 *
 * The column's numbers are kept in their own unit rather than re-authored in
 * pixels, and one scale on {@link screenSpace} converts them — which makes this
 * rewrite **pixel-exact**: a plane at a constant depth under a perspective
 * projection maps to the screen by exactly a scale and a translation, so the
 * same numbers through a `ScreenCamera` land on the same pixels they landed on
 * when the column hung 2.2 units in front of the camera. That is the property
 * that let this file move to §47's camera without re-tuning forty literals.
 */
const UI_UNIT_PIXELS = HEIGHT / (2 * UI_DEPTH * Math.tan(FIELD_OF_VIEW / 2));

/**
 * The screen-space root: everything the {@link uiCamera} draws hangs under it —
 * the instrument column and the §73 control panel.
 *
 * It sits at the middle of the canvas because the instrument plane's origin used
 * to sit on the camera's axis, and it is scaled by {@link UI_UNIT_PIXELS} so its
 * children keep their own unit. §46 is self-not-subtree, so the mask still has
 * to be written on every drawable inside it; this node carries it too, for the
 * day it grows a quad of its own.
 */
const screenSpace = new Group();
screenSpace.name = "screen-space";
screenSpace.transformAuthority = "manual";
screenSpace.layers = UI_LAYER;
screenSpace.transform.position.set(WIDTH / 2, HEIGHT / 2, 0);
screenSpace.transform.scale.set(UI_UNIT_PIXELS, UI_UNIT_PIXELS, 1);
app.scene.add(screenSpace);

/** The instrument column's root — a child of {@link screenSpace}. */
const instruments = new Group();
instruments.name = "instruments";
instruments.transformAuthority = "manual";
screenSpace.add(instruments);

/** Adds an unlit quad to the instrument plane, in instrument units. */
function addInstrumentQuad(
  name: string,
  color: Rgba,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z: number,
): Renderable<UnlitMaterial> {
  const quad = new Renderable(
    unitQuad,
    material(
      `${name}-surface`,
      new UnlitMaterial({ color: [color[0], color[1], color[2], color[3]] }),
    ),
  );
  quad.name = name;
  quad.transform.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
  quad.transform.scale.set(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  quad.renderLayer = 1;
  quad.layers = UI_LAYER;
  instruments.add(quad);
  return quad;
}

addInstrumentQuad(
  "chart-a-frame",
  CHART_FRAME,
  COLUMN_LEFT - 0.012,
  CHART_A_BOTTOM - 0.012,
  COLUMN_RIGHT + 0.012,
  CHART_A_TOP + 0.012,
  CHART_BACK_Z,
);
addInstrumentQuad(
  "chart-a-back",
  CHART_BACKGROUND,
  COLUMN_LEFT,
  CHART_A_BOTTOM,
  COLUMN_RIGHT,
  CHART_A_TOP,
  CHART_BACK_Z + 0.002,
);
addInstrumentQuad(
  "chart-b-frame",
  CHART_FRAME,
  COLUMN_LEFT - 0.012,
  CHART_B_BOTTOM - 0.012,
  COLUMN_RIGHT + 0.012,
  CHART_B_TOP + 0.012,
  CHART_BACK_Z,
);
addInstrumentQuad(
  "chart-b-back",
  CHART_BACKGROUND,
  COLUMN_LEFT,
  CHART_B_BOTTOM,
  COLUMN_RIGHT,
  CHART_B_TOP,
  CHART_BACK_Z + 0.002,
);

/** The setpoint rule across chart A — the only static line a chart gets (`R-24`). */
const setpointRule = addInstrumentQuad(
  "setpoint-rule",
  SETPOINT_LINE_COLOR,
  COLUMN_LEFT,
  CHART_A_BOTTOM,
  COLUMN_RIGHT,
  CHART_A_BOTTOM + 0.004,
  CHART_LINE_Z,
);

// --- the waveform charts (§119, `R-24`'s workaround) -------------------------

/**
 * Four traces in **one** `"lines"` geometry, with the trace identity in the
 * vertex colours.
 *
 * There is no `Path`, no stroke, no line width and no 2D shape node in this
 * engine yet (`R-23`/`R-24`), so a chart is a `Float32Array` of segment
 * endpoints and this file writes it. What that buys, and it is not nothing, is
 * that all four traces are **one draw call** whatever the sample count — the
 * colours ride the geometry, not the material, exactly as §113's overlay does.
 * `positions` is edited in place and announced with `markDirty()`; the colours
 * are written once, because a trace never changes colour.
 */
const SEGMENTS_PER_TRACE = CHART_SAMPLES - 1;
const TRACE_COUNT = 4;

/**
 * Each trace is drawn **twice**, one device pixel apart in y.
 *
 * `R-24` again: there is no line width, and a one-pixel polyline over a dark
 * background is both hard to read and hard for a browser gate to count with any
 * margin. Two offset polylines are two pixels of trace, which is what a chart
 * wants and what the gate's thresholds are set against.
 */
const TRACE_PASSES = 2;

/** Vertical offset of the second pass, in instrument units — about one pixel. */
const TRACE_PASS_OFFSET = 0.0031;

const POLYLINE_COUNT = TRACE_COUNT * TRACE_PASSES;
const CHART_VERTEX_COUNT = POLYLINE_COUNT * SEGMENTS_PER_TRACE * 2;

const chartPositions = new Float32Array(CHART_VERTEX_COUNT * 3);
const chartColors = new Float32Array(CHART_VERTEX_COUNT * 4);

/** Writes one trace's constant colour into every vertex both its passes own. */
function paintTrace(trace: number, color: Rgba): void {
  for (let pass = 0; pass < TRACE_PASSES; pass += 1) {
    const first = (trace * TRACE_PASSES + pass) * SEGMENTS_PER_TRACE * 2;
    for (let i = 0; i < SEGMENTS_PER_TRACE * 2; i += 1) {
      const at = (first + i) * 4;
      chartColors[at] = color[0];
      chartColors[at + 1] = color[1];
      chartColors[at + 2] = color[2];
      chartColors[at + 3] = color[3];
    }
  }
}

paintTrace(0, TRACE_SPEED_COLOR);
paintTrace(1, TRACE_COMMAND_COLOR);
paintTrace(2, TRACE_VIBRATION_COLOR);
paintTrace(3, TRACE_TEMPERATURE_COLOR);

const chartGeometry = geometry(
  "waveform-charts",
  () =>
    new BufferGeometry({
      positions: chartPositions,
      colors: chartColors,
      mode: "lines",
    }),
);

const chartNode = new Renderable(
  chartGeometry,
  material(
    "waveform-traces",
    new UnlitMaterial({ color: [1, 1, 1, 1], vertexColors: true }),
  ),
);
chartNode.name = "waveform-charts";
chartNode.renderLayer = 1;
chartNode.layers = UI_LAYER;
instruments.add(chartNode);

/**
 * Rewrites one trace's segment endpoints from a ring buffer.
 *
 * The oldest sample is at {@link sampleHead} and the newest just before it, so
 * the chart scrolls without anything ever being copied: the ring is read in
 * order, and the x coordinate comes from the *position in the window*, not from
 * the position in the array.
 */
function writeTrace(
  trace: number,
  samples: Float32Array,
  low: number,
  high: number,
  bottom: number,
  top: number,
): void {
  const span = high - low;
  const height = top - bottom;
  const width = COLUMN_RIGHT - COLUMN_LEFT;
  let previousX = COLUMN_LEFT;
  let previousY = bottom;
  for (let i = 0; i < CHART_SAMPLES; i += 1) {
    const value = samples[(sampleHead + i) % CHART_SAMPLES];
    const clamped = Math.min(1, Math.max(0, (value - low) / span));
    const x = COLUMN_LEFT + (i / SEGMENTS_PER_TRACE) * width;
    const y = bottom + clamped * height;
    if (i > 0) {
      for (let pass = 0; pass < TRACE_PASSES; pass += 1) {
        const base = (trace * TRACE_PASSES + pass) * SEGMENTS_PER_TRACE * 2;
        const offset = pass * TRACE_PASS_OFFSET;
        const at = (base + (i - 1) * 2) * 3;
        chartPositions[at] = previousX;
        chartPositions[at + 1] = previousY + offset;
        chartPositions[at + 2] = CHART_TRACE_Z;
        chartPositions[at + 3] = x;
        chartPositions[at + 4] = y + offset;
        chartPositions[at + 5] = CHART_TRACE_Z;
      }
    }
    previousX = x;
    previousY = y;
  }
}

/** Redraws all four traces and the setpoint rule from the current samples. */
function updateCharts(): void {
  const rpmScale = 60 / (Math.PI * 2);
  writeTrace(
    0,
    speedSamples,
    0,
    CHART_RPM_FULL / rpmScale,
    CHART_A_BOTTOM,
    CHART_A_TOP,
  );
  writeTrace(
    1,
    commandSamples,
    0,
    CHART_RPM_FULL / rpmScale,
    CHART_A_BOTTOM,
    CHART_A_TOP,
  );
  writeTrace(
    2,
    vibrationSamples,
    0,
    CHART_VIBRATION_FULL_MM / 1000,
    CHART_B_BOTTOM,
    CHART_B_TOP,
  );
  writeTrace(
    3,
    temperatureSamples,
    AMBIENT_TEMPERATURE,
    CHART_TEMPERATURE_FULL,
    CHART_B_BOTTOM,
    CHART_B_TOP,
  );
  // In-place edits are invisible to the geometry until they are announced
  // (§53's `version` contract), and the backend re-uploads on the version bump.
  chartGeometry.markDirty();

  const fraction = Math.min(1, (setpoint * rpmScale) / CHART_RPM_FULL);
  setpointRule.transform.position.y =
    CHART_A_BOTTOM + fraction * (CHART_A_TOP - CHART_A_BOTTOM);
}

// --- the temperature bar ------------------------------------------------------

/** Where the temperature bar sits, in instrument units. */
const BAR_BOTTOM = -0.23;
const BAR_TOP = -0.17;

/** Cool and hot ends of the bar's fill. */
const BAR_COOL: Rgba = [0.27, 0.8, 0.65, 1];
const BAR_HOT: Rgba = [1, 0.43, 0.2, 1];

addInstrumentQuad(
  "temperature-track",
  CHART_BACKGROUND,
  COLUMN_LEFT,
  BAR_BOTTOM,
  COLUMN_RIGHT,
  BAR_TOP,
  CHART_BACK_Z + 0.002,
);

const temperatureFill = addInstrumentQuad(
  "temperature-fill",
  BAR_COOL,
  COLUMN_LEFT,
  BAR_BOTTOM,
  COLUMN_RIGHT,
  BAR_TOP,
  CHART_LINE_Z,
);

/**
 * Scales and tints the temperature bar.
 *
 * The bar is measured by the browser gate as a **length**, not as a hue,
 * deliberately: its colour is a ramp, so a hue classifier would have to know the
 * temperature to know what to look for, which is circular. Its width is a
 * monotone function of the reading and can be compared against `data-temperature`
 * from the outside.
 */
function updateTemperatureBar(): void {
  const fraction = Math.min(
    1,
    Math.max(
      0,
      (temperature - AMBIENT_TEMPERATURE) /
        (CHART_TEMPERATURE_FULL - AMBIENT_TEMPERATURE),
    ),
  );
  const width = (COLUMN_RIGHT - COLUMN_LEFT) * Math.max(fraction, 0.001);
  temperatureFill.transform.scale.set(width, BAR_TOP - BAR_BOTTOM, 1);
  temperatureFill.transform.position.x = COLUMN_LEFT + width / 2;
  const color = temperatureFill.material.color;
  color[0] = BAR_COOL[0] + (BAR_HOT[0] - BAR_COOL[0]) * fraction;
  color[1] = BAR_COOL[1] + (BAR_HOT[1] - BAR_COOL[1]) * fraction;
  color[2] = BAR_COOL[2] + (BAR_HOT[2] - BAR_COOL[2]) * fraction;
}

// --- the numeric readouts (§40's whole point) --------------------------------

/** How many readout lines there are, and how they are spaced. */
const READOUT_SIZE = 0.05;
const READOUT_TOP = 0.19;
const READOUT_SPACING = 0.077;
const READOUT_LINES = 5;

/** One `Text` node per line; its quads are rebuilt only when its text changes. */
const readouts: Text[] = [];
const readoutText: string[] = [];

for (let i = 0; i < READOUT_LINES; i += 1) {
  const line = makeLabel(`readout-${String(i)}`, "", READOUT_SIZE);
  line.layers = UI_LAYER;
  line.transform.position.set(
    COLUMN_LEFT,
    READOUT_TOP - i * READOUT_SPACING,
    READOUT_Z,
  );
  instruments.add(line);
  readouts.push(line);
  readoutText.push("");
}

/** Rebuilds line `index` only if its text actually changed. */
function setReadout(index: number, text: string): void {
  if (readoutText[index] === text) return;
  readoutText[index] = text;
  readouts[index].text = text;
}

/**
 * How often the readouts are re-laid-out, in frames.
 *
 * A line is one `Text` node and one draw call whatever it says (R-28), so this
 * is no longer the draw-call throttle it was written as — it is a *rebuild*
 * throttle: changing the string re-lays-out the line and rewrites its vertex
 * buffers. Ten hertz is what a panel meter updates at anyway. Until 2026-08-21
 * every glyph was its own `Sprite` and its own draw call, and rebuilding five
 * lines every frame put ~70 draw calls of text in front of a scene that
 * otherwise needs about thirty.
 */
const READOUT_INTERVAL_FRAMES = 6;

/**
 * Writes the five readout lines, in the declared display units (§40).
 *
 * This is the **only** place in the file that calls a §40 conversion helper, and
 * it runs once every {@link READOUT_INTERVAL_FRAMES} rendered frames — on the
 * display side of the engine, never inside a fixed step. See the module header
 * for why that boundary is not negotiable.
 */
function updateReadouts(): void {
  const speed = rotorBody.angularVelocity.z;
  setReadout(0, `spd ${revolutionsPerMinute(speed).toFixed(1)} rpm`);
  setReadout(1, `cmd ${revolutionsPerMinute(lastCommand).toFixed(1)} rpm`);
  setReadout(
    2,
    `vib ${lengthToDisplay(vibrationAmplitude, DISPLAY_UNITS).toFixed(2)} ${unitSymbol(DISPLAY_UNITS, "length")}`,
  );
  setReadout(3, `tmp ${temperature.toFixed(1)} C${tripped ? " TRIP" : ""}`);
  setReadout(4, `trq ${motorTorque.toFixed(3)} N.m`);
}

// --- the §73 control panel ----------------------------------------------------

const PANEL_PADDING = 0.035;
const PANEL_GAP = 0.026;
const BUTTON_WIDTH = 0.4;
const BUTTON_HEIGHT = 0.095;
const SLIDER_WIDTH = 1.252;
const SLIDER_HEIGHT = 0.05;
const PANEL_TEXT_SIZE = 0.046;
const BUTTON_TEXT_SIZE = 0.042;

/** Top-left corner of the panel, in the camera's local frame. */
const PANEL_ORIGIN = new Vector3(COLUMN_LEFT - PANEL_PADDING, -0.3, 0);

/** Widget surfaces: warm-grey and near-neutral, so no hue classifier claims them. */
const PANEL_COLOR: Rgba = [0.11, 0.12, 0.15, 1];
const BUTTON_IDLE_COLOR: Rgba = [0.28, 0.27, 0.24, 1];
const BUTTON_HOVER_COLOR: Rgba = [0.42, 0.4, 0.35, 1];
const BUTTON_PRESSED_COLOR: Rgba = [0.6, 0.58, 0.5, 1];
const BUTTON_LATCHED_COLOR: Rgba = [0.5, 0.44, 0.28, 1];
const FOCUS_RING_COLOR: Rgba = [0.9, 0.92, 0.96, 1];
const SLIDER_TRACK_COLOR: Rgba = [0.16, 0.17, 0.2, 1];
const SLIDER_FILL_COLOR: Rgba = [0.33, 0.5, 0.58, 1];
const SLIDER_HANDLE_COLOR: Rgba = [0.9, 0.92, 0.96, 1];

/*
 * Widgets are coplanar — §74 layout writes (left, −top) and preserves z — so the
 * *visuals* separate by depth: panel background under focus ring under button
 * face under glyphs.
 */
const PANEL_QUAD_Z = 0;
const FOCUS_RING_Z = 0.004;
const WIDGET_QUAD_Z = 0.008;
const SLIDER_FILL_Z = 0.012;
const SLIDER_HANDLE_Z = 0.016;
const UI_GLYPH_Z = 0.02;

/** How far the focus ring extends past a widget's box on every side. */
const FOCUS_RING_MARGIN = 0.011;

/** Builds one unit quad the skins scale into place. */
function skinQuad(name: string, color: Rgba): Renderable<UnlitMaterial> {
  const quad = new Renderable(
    unitQuad,
    material(
      `${name}-surface`,
      new UnlitMaterial({ color: [color[0], color[1], color[2], color[3]] }),
    ),
  );
  quad.name = name;
  quad.renderLayer = 1;
  quad.layers = UI_LAYER;
  return quad;
}

/** A flat background filling the widget's box — the panel's skin. */
function panelSkin(color: Rgba, z: number): WidgetSkin {
  let quad: Renderable<UnlitMaterial> | null = null;
  return {
    onAttach(widget) {
      quad = skinQuad(`${widget.name}-background`, color);
      widget.add(quad);
    },
    onLayout(widget) {
      if (quad === null) return;
      quad.transform.position.set(
        widget.measuredWidth / 2,
        -widget.measuredHeight / 2,
        z,
      );
      quad.transform.scale.set(widget.measuredWidth, widget.measuredHeight, 1);
    },
    onDetach(widget) {
      if (quad !== null) widget.remove(quad);
      quad = null;
    },
  };
}

/**
 * A button's face and focus ring, plus a **latched** colour this page adds.
 *
 * Four of the six buttons are toggles, and §73's `Button` is not a checkable
 * widget, so what is latched is application state. The skin reads it through a
 * callback rather than inventing a widget state.
 */
function buttonSkin(latched: () => boolean): WidgetSkin {
  let face: Renderable<UnlitMaterial> | null = null;
  let ring: Renderable<UnlitMaterial> | null = null;
  const repaint = (widget: UIWidget): void => {
    if (face === null || ring === null) return;
    const color = widget.pressed
      ? BUTTON_PRESSED_COLOR
      : widget.hovered
        ? BUTTON_HOVER_COLOR
        : latched()
          ? BUTTON_LATCHED_COLOR
          : BUTTON_IDLE_COLOR;
    const target = face.material.color;
    target[0] = color[0];
    target[1] = color[1];
    target[2] = color[2];
    target[3] = color[3];
    ring.visible = widget.focused;
  };
  return {
    onAttach(widget) {
      ring = skinQuad(`${widget.name}-focus`, FOCUS_RING_COLOR);
      face = skinQuad(`${widget.name}-face`, BUTTON_IDLE_COLOR);
      widget.add(ring);
      widget.add(face);
    },
    onLayout(widget) {
      if (face === null || ring === null) return;
      face.transform.position.set(
        widget.measuredWidth / 2,
        -widget.measuredHeight / 2,
        WIDGET_QUAD_Z,
      );
      face.transform.scale.set(widget.measuredWidth, widget.measuredHeight, 1);
      ring.transform.position.set(
        widget.measuredWidth / 2,
        -widget.measuredHeight / 2,
        FOCUS_RING_Z,
      );
      ring.transform.scale.set(
        widget.measuredWidth + FOCUS_RING_MARGIN * 2,
        widget.measuredHeight + FOCUS_RING_MARGIN * 2,
        1,
      );
      repaint(widget);
    },
    onStateChange(widget) {
      repaint(widget);
    },
    onDetach(widget) {
      if (face !== null) widget.remove(face);
      if (ring !== null) widget.remove(ring);
      face = null;
      ring = null;
    },
  };
}

/** The setpoint slider's track, fill and handle. */
function sliderSkin(): WidgetSkin {
  let track: Renderable<UnlitMaterial> | null = null;
  let fill: Renderable<UnlitMaterial> | null = null;
  let handle: Renderable<UnlitMaterial> | null = null;
  let ring: Renderable<UnlitMaterial> | null = null;

  const place = (widget: UIWidget): void => {
    if (track === null || fill === null || handle === null || ring === null) {
      return;
    }
    const slider = widget as Slider;
    const width = widget.measuredWidth;
    const height = widget.measuredHeight;
    const span = slider.max - slider.min;
    const fraction = span === 0 ? 0 : (slider.value - slider.min) / span;

    track.transform.position.set(width / 2, -height / 2, WIDGET_QUAD_Z);
    track.transform.scale.set(width, height, 1);

    const filled = Math.max(width * fraction, 1e-4);
    fill.transform.position.set(filled / 2, -height / 2, SLIDER_FILL_Z);
    fill.transform.scale.set(filled, height, 1);

    handle.transform.position.set(filled, -height / 2, SLIDER_HANDLE_Z);
    handle.transform.scale.set(height * 0.42, height * 1.2, 1);

    ring.transform.position.set(width / 2, -height / 2, FOCUS_RING_Z);
    ring.transform.scale.set(
      width + FOCUS_RING_MARGIN * 2,
      height + FOCUS_RING_MARGIN * 2,
      1,
    );
    ring.visible = widget.focused;
  };

  return {
    onAttach(widget) {
      ring = skinQuad(`${widget.name}-focus`, FOCUS_RING_COLOR);
      track = skinQuad(`${widget.name}-track`, SLIDER_TRACK_COLOR);
      fill = skinQuad(`${widget.name}-fill`, SLIDER_FILL_COLOR);
      handle = skinQuad(`${widget.name}-handle`, SLIDER_HANDLE_COLOR);
      widget.add(ring);
      widget.add(track);
      widget.add(fill);
      widget.add(handle);
    },
    onLayout: place,
    onStateChange: place,
    onContentChange: place,
    onDetach(widget) {
      for (const part of [ring, track, fill, handle]) {
        if (part !== null) widget.remove(part);
      }
      ring = null;
      track = null;
      fill = null;
      handle = null;
    },
  };
}

/**
 * A §73 `Label`'s glyphs — one `Text` node, over the same atlas and the same
 * material the readouts use.
 *
 * `size` is written only when it changes: the setter has no equality check of
 * its own (`text` does), so an unconditional write on every `layout()` pass
 * would rebuild vertex buffers that did not move.
 */
function labelSkin(): WidgetSkin {
  let glyphs: Text | null = null;
  return {
    onAttach(widget) {
      glyphs = makeLabel(`${widget.name}-glyphs`, "", (widget as Label).size);
      glyphs.layers = UI_LAYER;
      widget.add(glyphs);
    },
    onLayout(widget) {
      if (glyphs === null) return;
      const label = widget as Label;
      glyphs.text = label.text;
      if (glyphs.size !== label.size) glyphs.size = label.size;
      glyphs.transform.position.set(
        (widget.measuredWidth - label.measuredWidth) / 2,
        -widget.measuredHeight / 2 - label.size * 0.36,
        UI_GLYPH_Z,
      );
    },
    onDetach(widget) {
      if (glyphs !== null) {
        // The node owns its quad buffers; the atlas, texture and material are
        // shared and outlive it (§83).
        widget.remove(glyphs);
        glyphs.dispose();
      }
      glyphs = null;
    },
  };
}

// --- the controls' state ------------------------------------------------------

/** Whether the application is paused (§10). */
let paused = false;

/** Whether the §113 overlay is drawn. */
let overlayVisible = false;

/** Fixed steps the last single-step actually ran — published, not asserted. */
let lastSingleStepCount = 0;

/** How many single steps the operator has taken. */
let singleSteps = 0;

/** Activations of any control, and where the last one came from (§72, §75). */
let activations = 0;
let lastSource = "none";

/** The most recent audit's published results. */
let seekResimSteps = -1;
let seekChecksum = 0;
let seekMatched = false;
let replayVerified = false;
let replayBytes = 0;
let liveRestored = false;
let saveRoundTripped = false;
let saveBytes = 0;
let saveNodes = 0;

// --- the widget tree ----------------------------------------------------------

const uiRoot = new Panel({
  name: "panel",
  // Containers opt out of §71 picking so a click inside a button cannot tie with
  // its coplanar ancestor — `collectPickables` documents the tie and this is its
  // recommended resolution.
  interactive: false,
  layout: {
    type: "flex",
    direction: "column",
    gap: PANEL_GAP,
    padding: PANEL_PADDING,
  },
});
uiRoot.transformAuthority = "manual";
uiRoot.transform.position.copy(PANEL_ORIGIN);
// An ordinary child of the screen-space root: what makes it screen-space is the
// view it is drawn through, not who its parent is (§47, §48).
screenSpace.add(uiRoot);

const panelTitle = new Label({
  name: "panel-title",
  text: "twin controls",
  atlas,
  size: PANEL_TEXT_SIZE,
});

const topRow = new Panel({
  name: "control-row-top",
  interactive: false,
  layout: { type: "flex", direction: "row", gap: PANEL_GAP },
});
const bottomRow = new Panel({
  name: "control-row-bottom",
  interactive: false,
  layout: { type: "flex", direction: "row", gap: PANEL_GAP },
});

const panelStatus = new Label({
  name: "panel-status",
  text: "running",
  atlas,
  size: BUTTON_TEXT_SIZE,
});

const setpointSlider = new Slider({
  name: "setpoint",
  width: SLIDER_WIDTH,
  height: SLIDER_HEIGHT,
  min: SETPOINT_MIN_RPM,
  max: SETPOINT_MAX_RPM,
  step: SETPOINT_STEP_RPM,
  value: SETPOINT_DEFAULT_RPM,
  accessibility: {
    role: "slider",
    label: "Speed setpoint in revolutions per minute",
    tabIndex: 6,
  },
});

uiRoot.add(panelTitle);
uiRoot.add(topRow);
uiRoot.add(bottomRow);
uiRoot.add(setpointSlider);
uiRoot.add(panelStatus);

/** What each button does, in tab order. */
interface Control {
  readonly name: string;
  readonly caption: string;
  readonly row: Panel;
  readonly activate: () => void;
  readonly latched: () => boolean;
}

/** Declared before the audits, which are defined below and referenced here. */
const controls: readonly Control[] = [
  {
    name: "pause",
    caption: "pause",
    row: topRow,
    activate: () => {
      paused = !paused;
      if (paused) app.pause();
      else app.resume();
    },
    latched: () => paused,
  },
  {
    name: "step",
    caption: "step",
    row: topRow,
    activate: () => {
      singleStep();
    },
    latched: () => false,
  },
  {
    name: "overlay",
    caption: "vectors",
    row: topRow,
    activate: () => {
      overlayVisible = !overlayVisible;
      if (overlay !== null) overlay.node.visible = overlayVisible;
    },
    latched: () => overlayVisible,
  },
  {
    name: "rub",
    caption: "rub",
    row: bottomRow,
    activate: () => {
      rubOperated = true;
      rubFault = !rubFault;
    },
    latched: () => rubFault,
  },
  {
    name: "sag",
    caption: "sag",
    row: bottomRow,
    activate: () => {
      driveFault = !driveFault;
      speedController = driveFault ? deratedDrive : healthyDrive;
      // §111: reset when the loop is re-enabled or the plant changes. The
      // controller taking over has a history that describes a drive that no
      // longer exists, and the dip its zeroed integrator produces is what a real
      // drive changeover looks like.
      speedController.reset();
    },
    latched: () => driveFault,
  },
  {
    name: "audit",
    caption: "audit",
    row: bottomRow,
    activate: () => {
      runAudits();
    },
    latched: () => false,
  },
];

const buttons: Button[] = controls.map((control, index) => {
  const button = new Button({
    name: control.name,
    width: BUTTON_WIDTH,
    height: BUTTON_HEIGHT,
    layout: {
      type: "flex",
      direction: "row",
      justify: "center",
      align: "center",
    },
    accessibility: { role: "button", label: control.caption, tabIndex: index },
  });
  const caption = new Label({
    name: `${control.name}-caption`,
    text: control.caption,
    atlas,
    size: BUTTON_TEXT_SIZE,
  });
  button.add(caption);
  control.row.add(button);

  // One event whatever the source: a §72 click synthesized by the pointer
  // source, or the Enter/Space the button reads off §72's key events.
  button.on("uiactivate", (event) => {
    activations += 1;
    lastSource = event.source;
    control.activate();
  });

  button.skin = buttonSkin(control.latched);
  caption.skin = labelSkin();
  return button;
});

setpointSlider.on("uivaluechange", (event) => {
  // The one authoring conversion in the file: the operator works in RPM, the
  // engine is handed rad/s, and the conversion happens exactly once, here (§40).
  setpoint = radiansPerSecondFromRpm(event.current);
});
setpointSlider.skin = sliderSkin();

uiRoot.skin = panelSkin(PANEL_COLOR, PANEL_QUAD_Z);
panelTitle.skin = labelSkin();
panelStatus.skin = labelSkin();
uiRoot.layout();

// --- picking, pointer and keyboard (§71, §72, §75) ---------------------------

/** Candidate scratch — `collectPickables` overwrites it per query, zero-alloc. */
const pickables: Pickable[] = [];

// A real `HTMLCanvasElement` satisfies `PointerSurface` structurally, and
// `window` satisfies `KeySurface` the same way. Both live exactly as long as the
// page does, so neither is disposed here (§83).
// The **UI** camera: a §71 ray must be cast through the projection the panel is
// drawn with, or it would test a screen-space rectangle against a perspective
// ray and miss everything (§48, §71).
new PointerInput(canvas, {
  camera: uiCamera,
  pickables: () => collectPickables(uiRoot, pickables),
});
new KeyboardInput(window, { focusTarget: keyboardFocusTarget(uiRoot) });
installKeyboardTraversal(uiRoot);

// --- single-step (§10) --------------------------------------------------------

/** Slack added to the single-step delta so the accumulator's `>=` cannot miss. */
const STEP_EPSILON = 1e-6;

/**
 * Advances the simulation by **exactly one** fixed step while paused.
 *
 * §10's accumulator is what makes this exact rather than approximate: the
 * scheduler publishes its unconsumed time, so the delta that runs one step and
 * no more is `fixedDeltaTime − accumulator`. Pause is lifted and restored around
 * it, and the number of steps that actually ran is published as `data-substeps`
 * so the claim can be checked instead of trusted.
 */
function singleStep(): void {
  const scheduler = app.scheduler;
  if (!scheduler.paused) {
    lastSingleStepCount = 0;
    return;
  }
  scheduler.paused = false;
  app.step(
    Math.max(0, scheduler.fixedDeltaTime - scheduler.accumulator) +
      STEP_EPSILON,
  );
  scheduler.paused = true;
  lastSingleStepCount = scheduler.fixedStepsLastFrame;
  singleSteps += 1;
}

// --- the §113 overlay ---------------------------------------------------------

/**
 * The overlay's line buffer, and the two `Float32Array`s it publishes.
 *
 * `@four/diagnostics` has no `geometry` edge in the frozen §3.1 matrix, so it
 * emits streams whose field names spread straight into `BufferGeometryOptions`
 * and the assembly happens here — the one place that may see both packages
 * (`R-35`).
 */
const overlayBuffer = new DebugDrawBuffer();

/** Reused across frames, so a steady segment count reallocates nothing. */
let overlayStreams: DebugDrawStreams | undefined;

/** The overlay, once the world holds its bodies. `null` until `main` runs. */
let overlay: { node: Renderable; geometry: BufferGeometry } | null = null;

/** §113's default origin colour is cyan, which is the speed trace's hue. */
const OVERLAY_ORIGIN_COLOR: Rgba = [0, 1, 0, 1];

/** The torque arc and the mount-reaction arrow — the twin's own estimates. */
const OVERLAY_TORQUE_COLOR: Rgba = [1, 0.55, 0, 1];
const OVERLAY_FORCE_COLOR: Rgba = [1, 0.1, 0.1, 1];

/**
 * The depth the twin's **own** overlay glyphs are drawn at, in world units.
 *
 * A metre in front of the machine, and measured rather than guessed: the first
 * build drew the torque arc and the reaction arrow at the machine's own depth,
 * where the frame's plates are in front of them and the depth test discarded
 * almost every fragment. §113's body origins and velocities cannot move — they
 * are drawn where the bodies are, which is the point of them — so those get long
 * arms instead ({@link OVERLAY_CROSS_SIZE}), the workaround the §118 flagship
 * measured first.
 */
const OVERLAY_PLANE_Z = 1.15;

/** Arm half-length of §113's body-origin crosses, in metres. */
const OVERLAY_CROSS_SIZE = 1.3;

/** Radius the torque arc is drawn at, and how many newton-metres a full turn is. */
const TORQUE_ARC_RADIUS = 0.82;
const TORQUE_FULL_SCALE = 3;
const TORQUE_ARC_SEGMENTS = 28;

/** The shortest arc drawn, in radians, so a light load is still visible. */
const TORQUE_ARC_MINIMUM = 0.5;

/** Metres of arrow per newton of mount reaction. */
const FORCE_ARROW_SCALE = 0.006;

/** Scratch for the overlay's own glyphs (plan D7: the loop allocates nothing). */
const arcFrom = new Vector3();
const arcTo = new Vector3();
const forceFrom = new Vector3();
const forceTo = new Vector3();

/**
 * Draws the twin's estimate of the shaft torque as an arc about the shaft axis.
 *
 * An arrow *along* +Z would be a dot: the shaft points at the camera, which is
 * what makes its rotation legible and its axial vector useless. The engineering
 * convention for a moment is an arc with a sense, so that is what is drawn — and
 * the arc's sweep is proportional to the torque, clamped at one full turn.
 */
function drawTorqueArc(): void {
  const scaled =
    (Math.max(-TORQUE_FULL_SCALE, Math.min(TORQUE_FULL_SCALE, motorTorque)) /
      TORQUE_FULL_SCALE) *
    Math.PI *
    1.8;
  const sweep =
    Math.sign(scaled || 1) * Math.max(Math.abs(scaled), TORQUE_ARC_MINIMUM);
  const centreX = stator.transform.position.x;
  const centreY = stator.transform.position.y;
  const centreZ = OVERLAY_PLANE_Z;
  for (let i = 0; i < TORQUE_ARC_SEGMENTS; i += 1) {
    const a0 = (sweep * i) / TORQUE_ARC_SEGMENTS;
    const a1 = (sweep * (i + 1)) / TORQUE_ARC_SEGMENTS;
    arcFrom.set(
      centreX + Math.cos(a0) * TORQUE_ARC_RADIUS,
      centreY + Math.sin(a0) * TORQUE_ARC_RADIUS,
      centreZ,
    );
    arcTo.set(
      centreX + Math.cos(a1) * TORQUE_ARC_RADIUS,
      centreY + Math.sin(a1) * TORQUE_ARC_RADIUS,
      centreZ,
    );
    overlayBuffer.addLine(arcFrom, arcTo, OVERLAY_TORQUE_COLOR);
  }
}

/**
 * Draws the twin's estimate of the mount reaction as a vertical arrow.
 *
 * `stiffness × deflection`, which is the spring's own constitutive law and the
 * number an engineer would compute by hand — **not** a reaction read off the
 * solver, because no adapter here reports one (see the module header).
 */
function drawMountReaction(): void {
  // The stiffness is read off the **joint**, not off the constant that built it:
  // an overlay that recomputed the mount's law from a second copy of the number
  // would keep drawing the old force after somebody retuned the spring.
  const force = -mountSpring.stiffness * mountDeflection;
  forceFrom.set(
    stator.transform.position.x,
    stator.transform.position.y - STATOR_HALF.y,
    OVERLAY_PLANE_Z,
  );
  forceTo.set(
    forceFrom.x,
    forceFrom.y - force * FORCE_ARROW_SCALE,
    forceFrom.z,
  );
  overlayBuffer.addLine(forceFrom, forceTo, OVERLAY_FORCE_COLOR);
}

/** Refills {@link overlayBuffer} from the live world plus the twin's estimates. */
function collectOverlaySegments(): void {
  overlayBuffer.clear();
  // `world.adapter` is a `SolverBodyAccess`, which satisfies the diagnostics
  // package's structural `DebugBodyAccess` without either package importing the
  // other — so an application can assemble the overlay while §3.1 stays frozen.
  // The arms are deliberately **longer than the bodies they mark** — a cross
  // drawn inside an opaque mesh is hidden by the depth test, and an overlay
  // nobody can see is not a diagnostic. The §118 flagship measured the same
  // thing (at 0.18 m its crosses contributed exactly zero pixels); this machine
  // is a metre across, so the arms are 1.3 m each — and no longer, because the
  // cross's Z arm projects as a long slant toward the vanishing point when the
  // machine is off the camera's axis, and at 2.6 m it reached across the
  // instrument column (measured, then shortened).
  collectBodyOrigins(world.adapter, overlayBuffer, {
    size: OVERLAY_CROSS_SIZE,
    color: OVERLAY_ORIGIN_COLOR,
  });
  collectBodyVelocities(world.adapter, overlayBuffer, {
    scale: 0.06,
    includeAngular: true,
  });
  drawTorqueArc();
  drawMountReaction();
}

/** The overlay's geometry and node, built once the world holds its bodies. */
function buildOverlay(): { node: Renderable; geometry: BufferGeometry } {
  collectOverlaySegments();
  overlayStreams = debugDrawStreams(overlayBuffer);
  const geo = geometry(
    "debug-overlay",
    () =>
      new BufferGeometry({
        positions: overlayStreams?.positions ?? new Float32Array(0),
        colors: overlayStreams?.colors ?? new Float32Array(0),
        mode: "lines",
      }),
  );
  const node = new Renderable(
    geo,
    // One draw call for the whole overlay, whatever its segment count: the
    // colours ride the geometry, not the material (`R-19`/`R-35`).
    material(
      "debug-overlay-lines",
      new UnlitMaterial({ color: [1, 1, 1, 1], vertexColors: true }),
    ),
  );
  node.name = "debug-overlay";
  node.visible = false;
  node.renderLayer = 1;
  app.scene.add(node);
  return { node, geometry: geo };
}

/** Refills and re-uploads the overlay, when it is visible. */
function updateOverlay(): void {
  if (overlay === null || !overlayVisible) return;
  collectOverlaySegments();
  overlayStreams = debugDrawStreams(overlayBuffer, overlayStreams);
  applyDebugDrawStreams(overlayStreams, overlay.geometry);
}

// --- the §34 replay audit -----------------------------------------------------

/**
 * The replay target: the world, plus the one method a `PhysicsWorld` does not
 * have.
 *
 * `PhysicsWorld` already satisfies `ReplayTarget`'s three required members
 * structurally. What it cannot supply is `applyInput`, because a solver has no
 * notion of an application's commands — so the twin supplies it, and points it
 * at {@link actuate}: the same function the live loop calls, with the same
 * payload the live loop recorded. That identity is the whole guarantee.
 */
const replayTarget: ReplayTarget = {
  checksum: (): number => world.checksum(),
  createSnapshot: (): ReplaySnapshot => world.createSnapshot(),
  restoreSnapshot: (snapshot: ReplaySnapshot): void => {
    world.restoreSnapshot(snapshot as never);
  },
  applyInput: (_step: number, payload): void => {
    const command = payload as unknown as Actuation;
    actuate(command);
  },
};

/**
 * Seeks into the recorded run, verifies it, and puts the live machine back.
 *
 * Three claims, each published rather than asserted here:
 *
 * 1. **A seek is exact.** `seekToStep(SEEK_STEP)` restores the nearest periodic
 *    snapshot and re-simulates the remainder; the world's §33 checksum then
 *    equals the checksum the *live* run published at that same step. Bit for
 *    bit — `data-seekmatch`.
 * 2. **A seek is cheap.** `seekToStep` returns the steps it re-simulated, which
 *    is fewer than {@link SNAPSHOT_INTERVAL_STEPS}. That number is the entire
 *    reason §34 has periodic snapshots, and it is published as
 *    `data-seekresim` rather than trusted.
 * 3. **The replay reproduces the run.** Seeking to the end and calling
 *    `verifyChecksum()` compares against the checksum the recorder took when the
 *    recording closed — `data-replayverified`.
 *
 * The audit runs with the application paused, so no fixed step runs and no
 * controller state moves while the machine is being rewound (see the module
 * header on where the controller's state lives). It finishes by restoring the
 * live snapshot it took first, and re-applying the live actuation, so the twin
 * resumes exactly where it was — which `data-liverestored` states.
 */
function runReplayAudit(): void {
  if (recording === null) return;

  const wasPaused = paused;
  if (!wasPaused) {
    paused = true;
    app.pause();
  }

  const liveSnapshot = world.createSnapshot();
  const liveChecksum = world.checksum();

  const player = new ReplayPlayer(recording, {
    target: replayTarget,
    stepFn: (delta: number): void => {
      world.step(delta);
    },
  });
  player.load();

  seekResimSteps = player.seekToStep(SEEK_STEP);
  seekChecksum = world.checksum();
  seekMatched = seekChecksum === seekReference;

  player.seekToStep(player.totalSteps);
  replayVerified = player.verifyChecksum();
  replayBytes = encodeReplayRecording(recording).length;

  world.restoreSnapshot(liveSnapshot);
  liveRestored = world.checksum() === liveChecksum;
  // The snapshot restores the machine, not the queued commands: re-arm the
  // actuators with what the live loop last sent, so the next fixed step
  // continues the live run rather than the replayed one.
  actuate({ v: lastCommand, e: driveEnergised ? 1 : 0, p: PAD_RETRACT_SPEED });

  if (!wasPaused) {
    paused = false;
    app.resume();
  }
}

// --- the §79 save/load audit --------------------------------------------------

/**
 * Saves the whole scene, reloads it, and re-saves the reload byte-for-byte.
 *
 * The registration is one call — `registerSceneNodeTypes` from the umbrella
 * package — and it is the only place in this repository that could make it,
 * because §3.1 forbids `@four/serialization` from seeing `@four/ui`,
 * `@four/render` or `@four/physics`. What it hands back is a component registry
 * that already knows `RigidBody`, `Collider`, `MotionComponent` and
 * `KinematicController`, plus the `nodeTypeOf`/`nodeFactory` pair that knows the
 * nine §73 widgets and the five drawing-tier classes
 * (`registerRenderSerializers`' half: `Renderable`, `Sprite`, both cameras and
 * `DirectionalLight`).
 *
 * The two {@link SceneResourceCatalog}s are the part a twin actually cares
 * about: a `Renderable` saves the **key** of the geometry and material it points
 * at, never a copy, so the document that comes out names `rotor-drum` and
 * `stator` rather than carrying two hundred kilobytes of vertices. §76's
 * manifest sits behind exactly this seam when `A-18`'s content hashing lands;
 * until then a `Map` satisfies it, and that is a feature.
 *
 * The reload goes into a **detached scene**, never into the live application:
 * restored node ids can collide with a live id counter, which the digital-twin
 * guide lists among its honest boundaries. So this is a proof that the twin's
 * state is expressible and stable, not a live re-instantiation — and the check
 * it publishes is the strongest one a canonical format can make, that encoding
 * the reload reproduces the original bytes exactly (`data-saveroundtrip`).
 */
/** How many nodes a §79 document holds, counted through its `children` trees. */
function countDocumentNodes(
  nodes: readonly { readonly children?: readonly unknown[] }[],
): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    if (node.children !== undefined) {
      total += countDocumentNodes(
        node.children as readonly { readonly children?: readonly unknown[] }[],
      );
    }
  }
  return total;
}

function runSaveLoadAudit(): void {
  const io = registerSceneNodeTypes({
    atlas,
    geometries: resourceCatalog(geometries),
    materials: resourceCatalog(materials),
  });

  const document = serializeScene(app.scene, io.components, io.write);
  const text = encodeSceneDocument(document);
  const reloaded = instantiateScene(
    decodeSceneDocument(text),
    io.components,
    io.read,
  );
  const again = encodeSceneDocument(
    serializeScene(reloaded, io.components, io.write),
  );

  saveBytes = text.length;
  saveNodes = countDocumentNodes(document.nodes);
  saveRoundTripped = text === again;
}

/** Runs both audits, in the order a twin's operator would. */
function runAudits(): void {
  runReplayAudit();
  runSaveLoadAudit();
}

// --- §84 statistics -----------------------------------------------------------

/** Reused so the per-frame count allocates nothing (§7b's out-parameter rule). */
const solverStats: SolverStatistics = {
  bodyCount: 0,
  sleepingCount: 0,
  awakeCount: 0,
  colliderCount: 0,
  maxBodyId: -1,
};

/**
 * Fills the one §84 counter that has a producer but no caller inside the engine.
 *
 * `Application` owns no physics world — §45's `app.physics` is gap `A-6` — so
 * `activeBodies` would stay `NaN` forever unless the application that *does* own
 * a world fills it. This is that application, and this is the documented way to
 * do it: `solverStatistics` counts §32's awake set off the adapter's body seam,
 * and `recordSolverStatistics` writes the one field §84 has a name for.
 *
 * `gpuFrameTime`, `physicsStepTime` and `contacts` stay `NaN` on purpose. §84's
 * rule is that **`NaN` means "not measured" and `0` means "measured zero"**, so
 * this page publishes them as `nan` rather than inventing a zero.
 */
function updateStatistics(): void {
  if (app.stats === null) return;
  solverStatistics(world.adapter, solverStats);
  recordSolverStatistics(app.stats, solverStats);
}

/** `NaN` is "not measured" (§84) — publish that, rather than a number. */
function statNumber(value: number | undefined, digits: number): string {
  if (value === undefined) return "off";
  return Number.isNaN(value) ? "nan" : value.toFixed(digits);
}

// --- what the page publishes --------------------------------------------------

/** Frames rendered since the loop started. */
let frameCount = 0;

/**
 * Where the centre of `widget`'s box lands on the canvas, in CSS pixels.
 *
 * The page publishes these as `data-controls` because a browser gate should not
 * have to re-derive §74's layout arithmetic to find a button: a test that
 * recomputed them would be testing its own copy of the algorithm. What the gate
 * *does* check is that the page's claim is true — it moves the pointer to the
 * published point and reads `data-hover` back before clicking.
 *
 * **This function used to be twenty lines** (2026-08-21): with the panel
 * parented to the perspective camera it inverted the camera's world matrix,
 * divided by −z and scaled by the frustum's half-extents at that depth. Under
 * {@link uiCamera} a widget's world position *is* its position on the canvas —
 * the panel's ancestors carry the scale, so the world matrix has already done
 * the arithmetic — and the only conversion left is between the camera's
 * bottom-left origin and the DOM's top-left one.
 */
function controlPixels(widget: UIWidget): { x: number; y: number } {
  // Column-major (§7b): elements 0 and 5 are the accumulated scale, 12 and 13
  // the translation. No widget on this page is rotated.
  const world = resolveWorldTransform(widget).elements;
  return {
    x: world[12] + (widget.measuredWidth * world[0]) / 2,
    y: HEIGHT - (world[13] - (widget.measuredHeight * world[5]) / 2),
  };
}

/** `name:x,y` for every control, as the page believes them to be on screen. */
function publishControlPositions(): string {
  const parts: string[] = [];
  for (const widget of [...buttons, setpointSlider]) {
    const point = controlPixels(widget);
    parts.push(`${widget.name}:${point.x.toFixed(1)},${point.y.toFixed(1)}`);
  }
  return parts.join("|");
}

/** Scratch: the rotor's orientation, read for display only. */
const rotorRotation = new Quaternion();

/**
 * The shaft angle in radians, wrapped to `[0, 2π)`.
 *
 * Read off the rotor's orientation quaternion rather than integrated, so it
 * cannot drift away from the body it describes. `2·atan2(z, w)` is the exact
 * angle for a rotation purely about +Z, and the rotor's other components stay
 * below a milliradian while the mount's tilt is small — which it is by
 * construction, since the mount is a slider with one translational freedom. A
 * display quantity, stated as an approximation because it is one.
 */
function shaftAngle(): number {
  rotorRotation.copy(rotor.transform.rotation);
  const angle = 2 * Math.atan2(rotorRotation.z, rotorRotation.w);
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

/** Which faults are active, as one stable string. */
function faultState(): string {
  const active: string[] = [];
  if (rubFault) active.push("rub");
  if (driveFault) active.push("sag");
  if (tripped) active.push("trip");
  return active.length === 0 ? "none" : active.join("+");
}

/**
 * Mirrors the running twin onto `#status`, so a browser gate can read the
 * engine's own account of the frame instead of inferring everything from pixels
 * — and so the two accounts can be checked against each other.
 *
 * Every §40 conversion in this file happens here or in {@link updateReadouts},
 * which is the display side of the engine. `data-rpm` and `data-omega` are
 * published together on purpose: a gate can check that the readout really is the
 * engine's own number put through the declared unit system, rather than a second
 * number that happens to look plausible.
 */
function publish(): void {
  const data = status.dataset;
  const scheduler = app.scheduler;
  const omega = rotorBody.angularVelocity.z;

  data["state"] = "running";
  data["frames"] = String(frameCount);
  data["sim"] = scheduler.time.simulationTime.toFixed(4);
  data["steps"] = String(simulationStep);
  data["paused"] = paused ? "true" : "false";
  data["substeps"] = String(lastSingleStepCount);
  data["singlesteps"] = String(singleSteps);

  // The machine, in engine units (§7a) …
  data["omega"] = omega.toFixed(6);
  data["command"] = lastCommand.toFixed(6);
  data["setpoint"] = setpoint.toFixed(6);
  data["torque"] = motorTorque.toFixed(6);
  data["angle"] = shaftAngle().toFixed(6);
  data["deflection"] = mountDeflection.toFixed(8);
  data["vibration"] = vibrationAmplitude.toFixed(8);

  // … and the same machine, in the twin's declared display units (§40).
  data["rpm"] = revolutionsPerMinute(omega).toFixed(4);
  data["commandrpm"] = revolutionsPerMinute(lastCommand).toFixed(4);
  data["setpointrpm"] = revolutionsPerMinute(setpoint).toFixed(4);
  data["angledeg"] = angleToDisplay(shaftAngle(), DISPLAY_UNITS).toFixed(4);
  data["vibrationmm"] = lengthToDisplay(
    vibrationAmplitude,
    DISPLAY_UNITS,
  ).toFixed(5);
  data["stepms"] = timeToDisplay(FIXED_DELTA_TIME, DISPLAY_UNITS).toFixed(6);
  data["unitsymbols"] =
    `${unitSymbol(DISPLAY_UNITS, "angle")}|` +
    `${unitSymbol(DISPLAY_UNITS, "length")}|` +
    `${unitSymbol(DISPLAY_UNITS, "time")}`;

  data["temperature"] = temperature.toFixed(4);
  data["tripped"] = tripped ? "true" : "false";
  data["trips"] = String(trips);
  data["fault"] = faultState();
  // §119's "bearing constraints", read back off the two joints rather than
  // asserted: a pair of coaxial hinges, of which exactly one is driven.
  data["bearings"] =
    `${driveBearing.motor === undefined ? "free" : "driven"}/` +
    `${idleBearing.motor === undefined ? "free" : "driven"}`;
  const travel = mountSlider.limits;
  data["mounttravel"] =
    travel === undefined
      ? "unlimited"
      : `${travel.min.toFixed(3)},${travel.max.toFixed(3)}`;
  // The signature of a saturated actuator, in the controlled quantity's own
  // units: a standing error the loop cannot close because its ceiling is below
  // the setpoint. Published rather than a boolean, because `outputLimits`
  // anti-windup deliberately settles the command just *under* the limit.
  data["speederror"] = (setpoint - omega).toFixed(6);
  data["ceiling"] = speedController.outputLimits[1].toFixed(6);

  data["checksum"] = String(world.checksum());
  data["markchecksum"] = String(markChecksum);
  data["recorded"] = String(
    recording === null ? recorder.stepsRecorded : recordedSteps,
  );
  data["recording"] = recording === null ? "open" : "closed";
  data["seekresim"] = String(seekResimSteps);
  data["seekchecksum"] = String(seekChecksum);
  data["seekmatch"] = seekMatched ? "true" : "false";
  data["replayverified"] = replayVerified ? "true" : "false";
  data["replaybytes"] = String(replayBytes);
  data["liverestored"] = liveRestored ? "true" : "false";
  data["saveroundtrip"] = saveRoundTripped ? "true" : "false";
  data["savebytes"] = String(saveBytes);
  data["savenodes"] = String(saveNodes);

  const stats = app.stats;
  data["stats"] = stats === null ? "off" : "on";
  data["drawcalls"] = statNumber(stats?.drawCalls, 0);
  data["triangles"] = statNumber(stats?.triangles, 0);
  data["cpuframe"] = statNumber(stats?.cpuFrameTime, 6);
  data["activebodies"] = statNumber(stats?.activeBodies, 0);
  data["contacts"] = statNumber(stats?.contacts, 0);
  data["gpuframe"] = statNumber(stats?.gpuFrameTime, 6);
  data["texturebytes"] = statNumber(stats?.textureMemory, 0);
  data["bufferbytes"] = statNumber(stats?.bufferMemory, 0);

  data["overlay"] = overlayVisible ? "on" : "off";
  data["focused"] = focusedWidget(app.scene)?.name ?? "none";
  data["hover"] = buttons.find((button) => button.hovered)?.name ?? "none";
  data["activations"] = String(activations);
  data["source"] = lastSource;
  data["controls"] = publishControlPositions();

  status.textContent =
    `${paused ? "paused" : "running"} — ` +
    `${revolutionsPerMinute(omega).toFixed(1)} rpm, ` +
    `${lengthToDisplay(vibrationAmplitude, DISPLAY_UNITS).toFixed(2)} mm vibration, ` +
    `${temperature.toFixed(1)} °C, fault: ${faultState()} — ` +
    "pause, step, vectors, rub, sag, audit; drag the slider to retune the setpoint";
}

/** The one line of §73 text that changes, kept out of {@link publish}. */
function updatePanelText(): void {
  const panelText = `${paused ? "paused" : "run"} ${revolutionsPerMinute(rotorBody.angularVelocity.z).toFixed(0)} rpm`;
  if (panelStatus.text === panelText) return;
  panelStatus.text = panelText;
  // §74's layout is explicit and one-pass: a changed text is a changed intrinsic
  // size, so the panel is re-laid-out rather than left stale.
  uiRoot.layout();
}

// --- per-frame application work ----------------------------------------------

app.on("update", () => {
  frameCount += 1;

  // The recording is a §34 document, and a document has an end: ten seconds of
  // the machine's life, closed at a frame boundary so the final checksum is the
  // state at the end of a recorded frame.
  if (recorder.isRecording) {
    recorder.recordFrame(app.scheduler.fixedStepsLastFrame, 0);
    if (recorder.stepsRecorded >= RECORD_STEPS) {
      recordedSteps = recorder.stepsRecorded;
      recording = recorder.end();
    }
  }

  updateCharts();
  updateTemperatureBar();
  if (frameCount % READOUT_INTERVAL_FRAMES === 0) {
    updateReadouts();
  }
  updateOverlay();
  updatePanelText();
});

// --- the frame loop -----------------------------------------------------------

/**
 * Drives the application from `requestAnimationFrame`.
 *
 * Seeded from the FIRST rAF timestamp rather than a `now()` taken earlier: rAF
 * hands the frame-*start* time, and a negative first delta would make `app.step`
 * throw and kill the loop.
 *
 * **§84 is read *after* `app.step` returns, not inside the `update` event.**
 * `Application.step` calls `resetFrameStats` on the way in — so every counter is
 * `NaN` while `update` runs — and writes the render counters, the §83 resource
 * levels and `cpuFrameTime` on the way out. "The frame just stepped" is
 * therefore exactly here, which is also where the application's own contribution
 * (`activeBodies`) belongs. Publishing happens in the same place so the numbers
 * `#status` carries all come from one frame.
 */
let last: number | null = null;

function frame(now: number): void {
  if (last !== null) {
    app.step((now - last) / 1000);
    updateStatistics();
    publish();
  }
  last = now;
  requestAnimationFrame(frame);
}

const LOADING_TEXT = "loading (WebGL 2 context and the WebAssembly solver)…";

async function main(): Promise<void> {
  status.textContent = LOADING_TEXT;

  await app.initialize();
  // Decodes the Rapier 3D wasm image; §37 allows `initialize` to be async for
  // exactly this.
  await world.initialize();

  // Everything that touches the solver lives on this side of the await.
  registerMachine();

  // The mount's rest height is where the stator hangs under its own weight, and
  // the vibration reading is a deflection *from* it — so it is measured once,
  // from the pose the solver settles into after one step, rather than assumed to
  // be the authored height. One step is enough: the spring's static deflection
  // is applied on the first solve.
  world.step(FIXED_DELTA_TIME);
  mountRestY = stator.transform.position.y;

  overlay = buildOverlay();
  updateReadouts();

  // §34: the recording opens before the first stepped frame, so its initial
  // snapshot is the state step 0 begins from.
  recorder.begin(world, {
    fixedDeltaTime: FIXED_DELTA_TIME,
    seed: RUN_SEED,
    snapshotIntervalSteps: SNAPSHOT_INTERVAL_STEPS,
    metadata: { scenario: "motor-digital-twin", section: "119" },
  });

  status.dataset["backend"] = app.renderer?.capabilities.backend ?? "none";
  status.dataset["solver"] = world.adapter.name;
  // Read off the world rather than typed in: `size` is its registered-body count
  // and `jointCount` its §28 joints, so the numbers the browser gate checks
  // cannot drift from what was actually registered.
  status.dataset["bodies"] = String(world.size);
  status.dataset["joints"] = String(world.jointCount);
  status.dataset["colliders"] = String(
    solverStatistics(world.adapter).colliderCount,
  );

  app.start();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  status.dataset["state"] = "error";
  status.textContent = "failed to start — see the console";
  console.error("four.js motor twin: failed to start.", error);
});
