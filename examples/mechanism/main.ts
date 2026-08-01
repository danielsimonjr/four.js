/**
 * four.js — the mechanism example, and the §109 demonstration.
 *
 * §109 asks for constraints that "remain stable under expected real-time
 * loads", and names the parts an engineering mechanism is made of:
 *
 * > a rotating shaft, a hinge, a slider, a spring, a motor, limit switches.
 *
 * This page is one mechanism containing all six, running in one browser tab:
 *
 * | §109 part          | where it is                                                                                          |
 * | ------------------ | ---------------------------------------------------------------------------------------------------- |
 * | **rotating shaft** | the crank, a bar pinned to a static block by a `HingeJoint` and turning about it continuously          |
 * | **motor**          | that hinge's §28 motor, commanded in rad/s — the only thing in the scene that puts energy in           |
 * | **hinge**          | two more `HingeJoint`s, crank→rod (the crank pin) and rod→carriage (the wrist pin)                     |
 * | **slider**         | a `SliderJoint` with §28 limits, turning the crank's rotation into the carriage's reciprocation        |
 * | **spring**         | a `SpringJoint` from the carriage to a static post: it is stretched and compressed once per revolution |
 * | **limit switches** | two lamps that latch when the carriage reaches either end of its travel, with hit counters             |
 *
 * The chain is a **slider–crank**: the classical mechanism that converts
 * rotation into reciprocation, and the smallest arrangement in which a shaft, a
 * hinge and a slider are genuinely *one* mechanism rather than five demos side
 * by side. It is a closed kinematic loop with exactly one degree of freedom —
 * three revolute constraints and one prismatic constraint over three dynamic
 * bodies — which is the hardest thing §28's joints are asked to hold together
 * here, and the reason this example is the §109 exit criterion's visible half.
 *
 * ## One world, and it is `"2d"` (a deliberate choice)
 *
 * One `Application`, one canvas, one `WebglRenderer`, one `PhysicsSystem`, one
 * `PhysicsWorld` — and that world's dimension is `"2d"`, because every part
 * §109 lists is planar: a crank, a connecting rod, a carriage on a rail and a
 * spring all live in one plane, and simulating them in a volume would add a
 * third axis that nothing in the mechanism uses. The 3D solver is not neglected
 * — `examples/physics-playground` runs a `"3d"` world beside a `"2d"` one, and
 * `tests/integration/physics-joints.test.ts` builds every joint in this file in
 * **both** dimensions, including the 3D-only spherical joint. This page is about
 * the mechanism, so it is built in the dimension the mechanism has.
 *
 * ## The layout is derived, not authored (§7a)
 *
 * Five numbers are chosen — where the shaft is, the crank radius, the rod
 * length, the rod's start angle, and where the spring post stands — and every
 * other coordinate below is computed from them, because in a closed loop the
 * coordinates are not independent: a rod whose ends do not reach its two pins
 * is a joint that starts violated, and §28's anchors are baked into body-local
 * frames **at `world.addJoint`**, so a mechanism must be assembled correctly
 * before it is jointed, exactly as it would be in any solver.
 *
 * Two of the derived numbers are worth stating outright:
 *
 * - the carriage's stroke centre is `shaftX + rodLength`, and its half-stroke is
 *   the crank radius (the extremes are `shaftX ± r + √(L² − 0)`), which is why
 *   the rail, the limit-switch lamps and the spring's rest length can all be
 *   written in terms of the crank rather than measured off a drawing;
 * - the mechanism starts at a crank angle of 90°, **not** 0°: at 0° the crank
 *   and the rod are collinear (dead centre), a configuration the loop passes
 *   through happily under a driven crank but a needlessly delicate one to
 *   *begin* in.
 *
 * ## What the motor's numbers mean on this solver (WP-6.2, honest limitation)
 *
 * §28 states a motor as `{ enabled, targetVelocity, maxTorque }`, and on Rapier
 * 0.19.3 `maxTorque` is **a gain, not a clamp**: the bindings expose no force
 * limit at all, so the adapter maps it to the motor's stiffness in Rapier's
 * force-based model, where the effort exerted equals `maxTorque` at one rad/s of
 * velocity error. A bigger number is a stronger motor — §28's monotone intent —
 * but it is not a torque ceiling, and this file does not pretend otherwise:
 * {@link MOTOR_GAIN} is named for what it is.
 *
 * Releasing the motor is the other half. `enableMotor(false)` does not brake:
 * the adapter reconfigures the motor to a measured-inert gain, which WP-6.2-fix1
 * showed is bit-identical to a joint that never had a motor, so the mechanism
 * **coasts** — it keeps turning and slows only as the spring's damper takes the
 * energy out. That is what the click below demonstrates.
 *
 * ## Limit switches are sampled, and say so
 *
 * A real limit switch is a sensor at a fixed point of the travel. §24 sensors
 * are collider volumes, and the carriage has no contact geometry to trip one
 * with (see "no contacts" below), so the switches here are **position samples
 * in application code**: once per frame the carriage's travel along the rail is
 * compared with {@link SWITCH_TRAVEL}, and the open→closed transition latches a
 * lamp and increments a counter. That is an honest switch — it is exactly what
 * an encoder-fed limit switch does — but it is application logic, not a physics
 * event, and no reading of this file should conclude otherwise.
 *
 * The `SliderJoint`'s own §28 limits are a *different* thing, and are set wider
 * than the crank's throw ({@link SLIDER_LIMIT} = crank radius + 0.1 m): they are
 * the mechanical end stops, and a closed loop whose stops sat inside the throw
 * would be over-constrained — the crank commanding a position the slider is
 * forbidden to take. They are present, correct, and deliberately not the thing
 * the crank fights.
 *
 * ## Colour discipline (§66: no blending in this tier, so hue is the channel)
 *
 * Every part owns one flat colour, and the palette is built so that a frame can
 * be attributed part by part **by hue alone**, which is what a browser gate
 * needs (the playground's rule, restated for this scene):
 *
 * 1. everything static or scenery is dark — max channel < 0.32;
 * 2. every moving part is bright — max channel > 0.8 — and any two moving parts
 *    differ by at least 0.35 in some channel;
 * 3. the two indicator colours a lamp switches between differ by at least 0.5 in
 *    two channels, so "the lamp latched" survives any reasonable threshold;
 * 4. the motor plate's on/off colours are far apart in the same way, so the
 *    toggle is readable from pixels as well as from `data-motor`.
 *
 * ## Known approximations
 *
 * - **The spring is drawn, not modelled, as a coil.** A `SpringJoint` is a
 *   distance spring; it has no shape. It is drawn as a bar between its two
 *   anchors whose length is the spring's current length and whose thickness
 *   grows as it compresses — a visual affectation for legibility, computed in
 *   {@link updateSpringVisual} and touching nothing the solver reads.
 * - **Nothing in this scene collides.** The static blocks carry no collider at
 *   all, and the three dynamic bodies only ever overlap at pins whose joints
 *   have §28 collision disabled (the default). Every number on screen is a
 *   constraint's, never a contact's — the same discipline
 *   `tests/integration/helpers/joint-scenarios.ts` keeps, and for the same
 *   reason.
 * - **Sleeping is off** (§32). A coasting mechanism settles, and a settled body
 *   Rapier has put to sleep would not restart when the motor is re-engaged —
 *   the toggle would look broken. The scene is five bodies, so the cost is nil.
 * - **No transparency.** This renderer tier enables `GL_BLEND` for sprites only
 *   (finding, WP-4.7), so overlap is resolved by depth alone: bodies sit at
 *   z = 0 as §21 requires, and scenery is pushed behind them.
 */

import { Application } from "four/application";
import { circleGeometry2D, planeGeometry } from "four/geometry";
import { PointerInput, type Pickable } from "four/input";
import { UnlitMaterial } from "four/materials";
import { Vector2, Vector3 } from "four/math";
import {
  Collider,
  HingeJoint,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  SliderJoint,
  SpringJoint,
} from "four/physics";
import { Rapier2dAdapter } from "four/physics-rapier";
import { Renderable } from "four/render";
import { WebglRenderer } from "four/render-webgl";
import { OrthographicCamera, createFullscreenViewport } from "four/scene";

// --- surface -----------------------------------------------------------------

/**
 * Resolves one required element of the page.
 *
 * A function rather than a module-level `const` + guard because this file
 * touches the status element from inside hoisted function declarations, and
 * TypeScript does not carry a module-level narrowing into one of those (the
 * playground's reason, unchanged).
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`four.js mechanism: no ${selector} in the document.`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");

/** The one line of page chrome: the loading state, then the instructions. */
const status = requireElement<HTMLParagraphElement>("#status");

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 960;
const HEIGHT = 540;

// --- the view, in world units (§47, §48) -------------------------------------

/** Half-width of the camera's view: 16 world units across a 960 px canvas. */
const VIEW_HALF_WIDTH = 8;

/** Half-height of the camera's view. 16 × 9 units over a 16:9 canvas. */
const VIEW_HALF_HEIGHT = 4.5;

// --- the mechanism, in world units (§7a: +Y is up, metres, radians) ----------

/** Where the driven shaft is pinned. Everything else is derived from it. */
const SHAFT_X = -5.4;
const SHAFT_Y = 0.6;

/** Distance from the shaft's centre to the crank pin — the half-stroke. */
const CRANK_RADIUS = 0.85;

/** The crank bar: centred on the shaft, so gravity exerts no torque on it. */
const CRANK_HALF_LENGTH = 1;
const CRANK_HALF_THICKNESS = 0.11;

/** Distance between the crank pin and the wrist pin. */
const ROD_LENGTH = 2.4;
const ROD_HALF_THICKNESS = 0.075;

/** The reciprocating carriage, a square block on the rail. */
const CARRIAGE_HALF_EXTENT = 0.26;

/**
 * The crank angle the scene is assembled at, measured from +X (§7b).
 *
 * 90°, not 0°: at 0° the crank and the rod are collinear (dead centre) — see the
 * module header.
 */
const START_ANGLE = Math.PI / 2;

/** The crank pin's world position at {@link START_ANGLE}. */
const PIN_X = SHAFT_X + CRANK_RADIUS * Math.cos(START_ANGLE);
const PIN_Y = SHAFT_Y + CRANK_RADIUS * Math.sin(START_ANGLE);

/**
 * The carriage's world X at {@link START_ANGLE}: the point on the rail (which
 * runs at `SHAFT_Y`) that is exactly {@link ROD_LENGTH} from the crank pin.
 */
const CARRIAGE_START_X =
  PIN_X + Math.sqrt(ROD_LENGTH * ROD_LENGTH - (PIN_Y - SHAFT_Y) ** 2);

/** The rod spans pin to pin, so its pose is the midpoint and the pin-to-pin angle. */
const ROD_CENTER_X = (PIN_X + CARRIAGE_START_X) / 2;
const ROD_CENTER_Y = (PIN_Y + SHAFT_Y) / 2;
const ROD_ANGLE = Math.atan2(SHAFT_Y - PIN_Y, CARRIAGE_START_X - PIN_X);

/**
 * The centre of the carriage's stroke, which the slider's travel is measured
 * from.
 *
 * `shaftX + rodLength` exactly: the extremes of a slider–crank are
 * `shaftX ± r + √(L² − r²·sin²θ)` evaluated at `θ = 0` and `θ = π`, where the
 * sine vanishes and the square root is `L` in both cases. So the stroke is
 * `2r` wide and centred one rod-length from the shaft, and the rail below is
 * placed by that identity rather than by measurement.
 */
const RAIL_ORIGIN_X = SHAFT_X + ROD_LENGTH;

/**
 * The slider's §28 travel limits, in metres from {@link RAIL_ORIGIN_X}.
 *
 * 0.1 m wider than the crank's throw on each side — mechanical end stops the
 * crank never reaches. See the module header for why they must not be tighter.
 */
const SLIDER_LIMIT = CRANK_RADIUS + 0.1;

/**
 * Where a limit switch trips, in metres from {@link RAIL_ORIGIN_X}.
 *
 * 0.07 m short of each end of the throw, which the carriage crosses at nearly
 * zero speed (it is reversing there), so the switch is closed for about a tenth
 * of a second per revolution — far longer than a frame, at any frame rate this
 * page will see.
 */
const SWITCH_TRAVEL = CRANK_RADIUS - 0.07;

/** The static post the spring pulls against. */
const SPRING_ANCHOR_X = 0.4;

/**
 * The spring's rest length: the distance from the post to the **centre** of the
 * stroke, so the spring is stretched over one half of every revolution and
 * compressed over the other, by {@link CRANK_RADIUS} either way (25% of its
 * rest length, which is what makes the flexing visible).
 */
const SPRING_REST_LENGTH = SPRING_ANCHOR_X - RAIL_ORIGIN_X;

/** Spring constant in N/m, and damping in N·s/m (§28). */
const SPRING_STIFFNESS = 25;
const SPRING_DAMPING = 0.8;

/** How thick the spring is drawn at rest, in world units. */
const SPRING_THICKNESS = 0.22;

/**
 * How thick the rail is drawn.
 *
 * Wider than the spring at its fattest (`SPRING_THICKNESS × 1.8 = 0.396`), so
 * the spring is drawn *on* the rail rather than over it and both stay legible —
 * the rail is the only static thing the two of them share a line with.
 */
const RAIL_THICKNESS = 0.44;

// --- the motor (§28) ---------------------------------------------------------

/**
 * §28's `maxTorque`, which on this solver is the motor's **gain** — see the
 * module header. 400 holds the commanded speed to within about 0.1 rad/s
 * against the spring's ~21 N peak pull at a 0.85 m lever arm.
 */
const MOTOR_GAIN = 400;

/** The commanded shaft speed in rad/s at load: a little under one turn a second. */
const MOTOR_TARGET_DEFAULT = 6;

/** What the `−`/`+` plates may command, and by how much per click. */
const MOTOR_TARGET_MIN = 2;
const MOTOR_TARGET_MAX = 12;
const MOTOR_TARGET_STEP = 2;

// --- depth (§21 pins bodies to z = 0; scenery goes behind, glyphs in front) ---

/** The rail and the spring, drawn behind the bodies they belong to. */
const RAIL_Z = -0.5;
const SPRING_Z = -0.25;

/** The `−`/`+` marks, drawn in front of the plate they label. */
const GLYPH_Z = 0.2;

/** The crank pin's marker, drawn in front of the rod it carries. */
const PIN_MARKER_Z = 0.1;

// --- palette (see "Colour discipline" in the module header) ------------------

/** Straight (non-premultiplied) RGBA in 0…1 (§60a, §66). */
type Color = readonly [number, number, number, number];

/** Static blocks: the frame the mechanism is bolted to. Rule 1: dark. */
const STATIC_COLOR: Color = [0.16, 0.18, 0.24, 1];

/** The rail the carriage runs on, and the scenery tier generally. Rule 1. */
const RAIL_COLOR: Color = [0.22, 0.24, 0.31, 1];

/** The crank: orange. Rule 2 (r 0.98). */
const CRANK_COLOR: Color = [0.98, 0.36, 0.16, 1];

/** The connecting rod: amber — 0.44 above the crank on green. Rule 2. */
const ROD_COLOR: Color = [0.98, 0.8, 0.24, 1];

/** The carriage: sky blue — 0.68 below both on red. Rule 2. */
const CARRIAGE_COLOR: Color = [0.3, 0.8, 0.98, 1];

/** The spring: green — 0.48 below the rod on red, 0.46 above it on blue. Rule 2. */
const SPRING_COLOR: Color = [0.35, 0.86, 0.52, 1];

/** The crank pin's marker: near-white, so the crank's driven end is unmistakable. */
const PIN_MARKER_COLOR: Color = [0.88, 0.9, 0.95, 1];

/** A limit switch that is open. Rule 3, with {@link SWITCH_CLOSED_COLOR}. */
const SWITCH_OPEN_COLOR: Color = [0.18, 0.2, 0.28, 1];

/** A limit switch the carriage has closed: magenta (Δ 0.82 red, 0.44 blue). */
const SWITCH_CLOSED_COLOR: Color = [1, 0.29, 0.62, 1];

/** The motor plate while the motor is driving: green. Rule 4. */
const MOTOR_ON_COLOR: Color = [0.24, 0.85, 0.45, 1];

/** The motor plate while the motor is released: slate (Δ 0.53 green). */
const MOTOR_OFF_COLOR: Color = [0.42, 0.32, 0.3, 1];

/** The two speed plates: violet, distinct from every part and both lamps. */
const PLATE_COLOR: Color = [0.44, 0.4, 0.72, 1];

/** The `−` and `+` marks on the speed plates. */
const GLYPH_COLOR: Color = [0.92, 0.94, 0.98, 1];

// --- the control panel, in world units ---------------------------------------

/** The plate that toggles the motor, and the plates that retune it. */
const MOTOR_PLATE = { x: 1.6, y: 2.6, width: 1.4, height: 0.9 };
const SLOWER_PLATE = { x: 3.4, y: 2.6, width: 1, height: 0.9 };
const FASTER_PLATE = { x: 4.8, y: 2.6, width: 1, height: 0.9 };

/** The limit-switch lamps, each directly above the travel point it watches. */
const LAMP_Y = 1.9;
const LAMP_SIZE = 0.44;

// --- camera and application (§45, §47) ---------------------------------------

// 16 × 9 world units over a 16:9 canvas: 60 CSS pixels per world unit, and no
// stretch — `px = (x + 8) × 60`, `py = (4.5 − y) × 60`. +Y is up here exactly as
// it is in the physics world (§7a).
const camera = new OrthographicCamera({
  left: -VIEW_HALF_WIDTH,
  right: VIEW_HALF_WIDTH,
  bottom: -VIEW_HALF_HEIGHT,
  top: VIEW_HALF_HEIGHT,
  near: 0.1,
  far: 100,
});
camera.transform.position.set(0, 0, 20);
camera.updateProjectionMatrix();

const view = createFullscreenViewport(camera);
// Matches the page background, so the canvas has no visible edge.
view.clearColor = [0.05, 0.06, 0.09, 1];

const renderer = new WebglRenderer();
const app = new Application({
  renderer,
  canvas,
  views: [view],
  // The default with a renderer, spelled out because the arrangement below
  // depends on it: the solver steps at a fixed 1/60 s while the display draws
  // at its own rate from §43-interpolated poses.
  poseInterpolation: true,
});
renderer.resize(WIDTH, HEIGHT, window.devicePixelRatio);
app.scene.add(camera);

const physics = new PhysicsSystem();
app.systems.register(physics);

/**
 * The one world: `"2d"`, on a Rapier 2D adapter, with §32 sleeping **off**.
 *
 * See the module header for both choices. `poses` is the application's §43
 * buffer, so every dynamic body's pose is captured each step and the frame is
 * drawn from an interpolation between the previous one and the current one.
 */
const world = physics.track(
  new PhysicsWorld({
    dimension: "2d",
    adapter: new Rapier2dAdapter(),
    poses: app.poses,
    sleeping: { enabled: false },
  }),
);

// --- building blocks ---------------------------------------------------------

/** The +Z axis: §21's only rotational freedom in a `"2d"` world. */
const Z_AXIS = new Vector3(0, 0, 1);

/** A registered body: the node that draws it and the component that moves it. */
interface Part {
  readonly node: Renderable;
  readonly body: RigidBody;
}

/**
 * Adds one dynamic bar or block: a §24 rectangle collider and the quad that
 * draws it, from the same two half-extents.
 *
 * No mass is authored anywhere in this file. Each collider carries the default
 * density of 1, the solver derives mass from density × area, and
 * `PhysicsWorld.addBody` reads it back onto the component (§23, §25).
 */
function addSlab(
  name: string,
  x: number,
  y: number,
  angle: number,
  halfWidth: number,
  halfHeight: number,
  color: Color,
): Part {
  const node = new Renderable(
    planeGeometry({ width: halfWidth * 2, height: halfHeight * 2 }),
    new UnlitMaterial({ color }),
  );
  node.name = name;
  // z is always 0: §21 requires a `"2d"` body to lie in the XY plane.
  node.transform.position.set(x, y, 0);
  node.transform.rotation.setFromAxisAngle(Z_AXIS, angle);
  // §42: exactly one system writes a transform, and for these three it is the
  // solver's.
  node.transformAuthority = "physics";
  node.addComponent(new RigidBody({ type: "dynamic" }));
  node.addComponent(
    new Collider({
      shape: {
        type: "rectangle",
        halfExtents: new Vector2(halfWidth, halfHeight),
      },
    }),
  );
  app.scene.add(node);
  return { node, body: world.addBody(node) };
}

/**
 * Adds one immovable block: a `"static"` body with **no collider**, drawn as a
 * dark quad.
 *
 * No collider is the point — nothing in this scene may contact anything (see
 * the module header), and §23 permits a body without one. A static body still
 * needs to exist because a joint's fixed side is a body, not a point.
 */
function addAnchor(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Part {
  const node = new Renderable(
    planeGeometry({ width, height }),
    new UnlitMaterial({ color: STATIC_COLOR }),
  );
  node.name = name;
  node.transform.position.set(x, y, 0);
  node.addComponent(new RigidBody({ type: "static" }));
  app.scene.add(node);
  return { node, body: world.addBody(node) };
}

/**
 * Adds one quad that belongs to no world: a rail, a lamp, a plate, a mark.
 *
 * Scenery has no body and no components, so nothing but this file ever writes
 * its transform or its colour.
 */
function addScenery(
  name: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  color: Color,
): Renderable {
  const node = new Renderable(
    planeGeometry({ width, height }),
    new UnlitMaterial({ color }),
  );
  node.name = name;
  node.transform.position.set(x, y, z);
  app.scene.add(node);
  return node;
}

/** Paints one node's unlit material (§60a straight RGBA). */
function paint(node: Renderable, color: Color): void {
  node.material.setColor(color[0], color[1], color[2], color[3]);
}

// --- the mechanism -----------------------------------------------------------

/** Everything the frame loop and the click handlers need afterwards. */
interface Mechanism {
  readonly crank: Part;
  readonly carriage: Part;
  readonly shaftHinge: HingeJoint;
  readonly spring: Renderable;
  readonly leftLamp: Renderable;
  readonly rightLamp: Renderable;
  readonly motorPlate: Renderable;
  readonly slowerPlate: Renderable;
  readonly fasterPlate: Renderable;
  /** The three plates as §71 pick candidates, in the same order. */
  readonly plates: readonly Pickable[];
}

/**
 * Assembles the slider–crank, its spring, its indicators and its control panel.
 *
 * Bodies first, then joints: `world.addJoint` converts each **world-space**
 * anchor into body-local frames against the pose the solver holds at that
 * moment (§28), so every body has to be registered, and standing where it
 * belongs, before the first joint is added.
 */
function buildMechanism(): Mechanism {
  // The frame: three static blocks, none of which can touch anything.
  const shaftBlock = addAnchor("shaft-block", SHAFT_X, SHAFT_Y, 0.42, 0.42);
  const railBlock = addAnchor("rail-block", RAIL_ORIGIN_X, SHAFT_Y, 0.3, 0.3);
  const springPost = addAnchor("spring-post", SPRING_ANCHOR_X, SHAFT_Y, 0.3, 1);

  // The rail the carriage runs on: scenery, drawn behind the carriage, as long
  // as the §28 limits it illustrates.
  addScenery(
    "rail",
    RAIL_ORIGIN_X,
    SHAFT_Y,
    RAIL_Z,
    SLIDER_LIMIT * 2 + CARRIAGE_HALF_EXTENT * 2,
    RAIL_THICKNESS,
    RAIL_COLOR,
  );

  // The three moving bodies, in the order the chain runs.
  const crank = addSlab(
    "crank",
    SHAFT_X,
    SHAFT_Y,
    START_ANGLE,
    CRANK_HALF_LENGTH,
    CRANK_HALF_THICKNESS,
    CRANK_COLOR,
  );
  const rod = addSlab(
    "connecting-rod",
    ROD_CENTER_X,
    ROD_CENTER_Y,
    ROD_ANGLE,
    ROD_LENGTH / 2,
    ROD_HALF_THICKNESS,
    ROD_COLOR,
  );
  const carriage = addSlab(
    "carriage",
    CARRIAGE_START_X,
    SHAFT_Y,
    0,
    CARRIAGE_HALF_EXTENT,
    CARRIAGE_HALF_EXTENT,
    CARRIAGE_COLOR,
  );

  // A marker at the crank's driven end, so which way the crank is pointing is
  // legible at a glance. A child of the crank node, so it orbits with it and
  // needs no per-frame code; it carries no physics of its own.
  const pinMarker = new Renderable(
    circleGeometry2D({ radius: 0.16, segments: 32 }),
    new UnlitMaterial({ color: PIN_MARKER_COLOR }),
  );
  pinMarker.name = "crank-pin";
  pinMarker.transform.position.set(CRANK_RADIUS, 0, PIN_MARKER_Z);
  crank.node.add(pinMarker);

  // The three §28 hinges. None names an axis: a hinge in a `"2d"` world has
  // exactly one possible one (+Z, §21) and the joint fills it in.
  const shaftHinge = new HingeJoint({
    bodyA: shaftBlock.body,
    bodyB: crank.body,
    anchor: new Vector3(SHAFT_X, SHAFT_Y, 0),
    motor: {
      enabled: true,
      targetVelocity: MOTOR_TARGET_DEFAULT,
      maxTorque: MOTOR_GAIN,
    },
  });
  world.addJoint(shaftHinge);

  world.addJoint(
    new HingeJoint({
      bodyA: crank.body,
      bodyB: rod.body,
      anchor: new Vector3(PIN_X, PIN_Y, 0),
    }),
  );
  world.addJoint(
    new HingeJoint({
      bodyA: rod.body,
      bodyB: carriage.body,
      anchor: new Vector3(CARRIAGE_START_X, SHAFT_Y, 0),
    }),
  );

  // The §28 slider. Its two anchors are named separately — the rail's origin on
  // the static side and the carriage's own centre on the moving side — so that
  // the joint's travel is measured from the stroke centre rather than from
  // wherever the carriage happened to be assembled.
  world.addJoint(
    new SliderJoint({
      bodyA: railBlock.body,
      bodyB: carriage.body,
      anchorA: new Vector3(RAIL_ORIGIN_X, SHAFT_Y, 0),
      anchorB: new Vector3(CARRIAGE_START_X, SHAFT_Y, 0),
      axis: new Vector3(1, 0, 0),
      limits: { min: -SLIDER_LIMIT, max: SLIDER_LIMIT },
    }),
  );

  // The §28 spring, from the post to the carriage.
  world.addJoint(
    new SpringJoint({
      bodyA: springPost.body,
      bodyB: carriage.body,
      anchorA: new Vector3(SPRING_ANCHOR_X, SHAFT_Y, 0),
      anchorB: new Vector3(CARRIAGE_START_X, SHAFT_Y, 0),
      restLength: SPRING_REST_LENGTH,
      stiffness: SPRING_STIFFNESS,
      damping: SPRING_DAMPING,
    }),
  );

  // One unit wide, because `updateSpringVisual` scales it to the current length
  // every frame; its position is set there too.
  const spring = addScenery(
    "spring",
    0,
    SHAFT_Y,
    SPRING_Z,
    1,
    SPRING_THICKNESS,
    SPRING_COLOR,
  );

  const leftLamp = addScenery(
    "limit-lamp-left",
    RAIL_ORIGIN_X - CRANK_RADIUS,
    LAMP_Y,
    0,
    LAMP_SIZE,
    LAMP_SIZE,
    SWITCH_OPEN_COLOR,
  );
  const rightLamp = addScenery(
    "limit-lamp-right",
    RAIL_ORIGIN_X + CRANK_RADIUS,
    LAMP_Y,
    0,
    LAMP_SIZE,
    LAMP_SIZE,
    SWITCH_OPEN_COLOR,
  );

  // The control panel: three click plates, marked so they can be told apart.
  const motorPlate = addScenery(
    "motor-plate",
    MOTOR_PLATE.x,
    MOTOR_PLATE.y,
    0,
    MOTOR_PLATE.width,
    MOTOR_PLATE.height,
    MOTOR_ON_COLOR,
  );
  const slowerPlate = addScenery(
    "slower-plate",
    SLOWER_PLATE.x,
    SLOWER_PLATE.y,
    0,
    SLOWER_PLATE.width,
    SLOWER_PLATE.height,
    PLATE_COLOR,
  );
  const fasterPlate = addScenery(
    "faster-plate",
    FASTER_PLATE.x,
    FASTER_PLATE.y,
    0,
    FASTER_PLATE.width,
    FASTER_PLATE.height,
    PLATE_COLOR,
  );

  // `−` is one bar; `+` is that bar and its upright. Children of their plates,
  // in front of them.
  addGlyphBar("slower-mark", slowerPlate, 0.5, 0.12);
  addGlyphBar("faster-mark", fasterPlate, 0.5, 0.12);
  addGlyphBar("faster-mark-upright", fasterPlate, 0.12, 0.5);

  return {
    crank,
    carriage,
    shaftHinge,
    spring,
    leftLamp,
    rightLamp,
    motorPlate,
    slowerPlate,
    fasterPlate,
    plates: [motorPlate, slowerPlate, fasterPlate].map((node) => {
      // §71/§72 picking: `@four/input` never reads geometry, so the layer that
      // does states each candidate's **local** bounds. The plates never move,
      // so this list is built once.
      const bounds = node.geometry.computeBounds();
      return { node, boundsMin: bounds.min, boundsMax: bounds.max };
    }),
  };
}

/** Adds one bar of a plate's mark, centred on the plate and in front of it. */
function addGlyphBar(
  name: string,
  plate: Renderable,
  width: number,
  height: number,
): void {
  const bar = new Renderable(
    planeGeometry({ width, height }),
    new UnlitMaterial({ color: GLYPH_COLOR }),
  );
  bar.name = name;
  bar.transform.position.set(0, 0, GLYPH_Z);
  plate.add(bar);
}

// --- live state --------------------------------------------------------------

/** Whether the §28 motor is driving; flipped by the motor plate. */
let motorEnabled = true;

/** The commanded shaft speed in rad/s; changed by the `−`/`+` plates. */
let motorTarget = MOTOR_TARGET_DEFAULT;

/** Whether each limit switch is currently closed, and how often it has closed. */
let leftClosed = false;
let rightClosed = false;
let leftHits = 0;
let rightHits = 0;

// --- the frame's application work --------------------------------------------

/**
 * Redraws the spring between the post and the carriage.
 *
 * The bar's geometry is one unit wide, so its X scale *is* the spring's current
 * length; its Y scale exaggerates the same thing the other way (thicker in
 * compression, thinner in tension), clamped so an extreme never turns it into a
 * hairline or a slab. Purely presentational — see the module header.
 */
function updateSpringVisual(mechanism: Mechanism): void {
  const carriageX = mechanism.carriage.node.transform.position.x;
  const length = SPRING_ANCHOR_X - carriageX;
  const squash = Math.min(1.8, Math.max(0.55, SPRING_REST_LENGTH / length));
  mechanism.spring.transform.position.set(
    (SPRING_ANCHOR_X + carriageX) / 2,
    SHAFT_Y,
    SPRING_Z,
  );
  mechanism.spring.transform.scale.set(length, squash, 1);
}

/**
 * Samples both limit switches against the carriage's travel and latches them.
 *
 * A switch closes when the carriage reaches its end of the stroke and opens
 * again when it leaves; only the open→closed edge counts, which is what makes
 * the counters revolutions rather than frames. A lamp is repainted only on that
 * edge, so a steady state costs no material writes. See the module header for
 * why this is application code and not a §24 sensor.
 */
function sampleSwitches(mechanism: Mechanism): void {
  const travel = mechanism.carriage.node.transform.position.x - RAIL_ORIGIN_X;
  const left = travel <= -SWITCH_TRAVEL;
  const right = travel >= SWITCH_TRAVEL;

  if (left !== leftClosed) {
    leftClosed = left;
    if (left) {
      leftHits += 1;
    }
    paint(mechanism.leftLamp, left ? SWITCH_CLOSED_COLOR : SWITCH_OPEN_COLOR);
  }
  if (right !== rightClosed) {
    rightClosed = right;
    if (right) {
      rightHits += 1;
    }
    paint(mechanism.rightLamp, right ? SWITCH_CLOSED_COLOR : SWITCH_OPEN_COLOR);
  }
}

/**
 * Mirrors the mechanism's state onto the status element as data attributes.
 *
 * Everything a test would otherwise have to infer from pixels is here:
 * `data-motor`, `data-target`, `data-spin`, `data-travel`, and the two switch
 * counters. The measured numbers are rounded to three decimals (the commanded
 * one to a single decimal, which is all it ever has) so a reader sees a number
 * rather than a float's tail.
 */
function syncStatus(mechanism: Mechanism): void {
  const data = status.dataset;
  data["motor"] = motorEnabled ? "on" : "off";
  data["target"] = motorTarget.toFixed(1);
  data["spin"] = mechanism.crank.body.angularVelocity.z.toFixed(3);
  data["travel"] = (
    mechanism.carriage.node.transform.position.x - RAIL_ORIGIN_X
  ).toFixed(3);
  data["leftHits"] = String(leftHits);
  data["rightHits"] = String(rightHits);
  data["switchLeft"] = leftClosed ? "closed" : "open";
  data["switchRight"] = rightClosed ? "closed" : "open";
}

// --- interaction (§28 live reconfiguration, §72 picking) ---------------------

/**
 * Pushes the current {@link motorEnabled} / {@link motorTarget} into the shaft
 * hinge and repaints the plate.
 *
 * `setMotor` is the §28 reconfiguration path: it queues a command that the world
 * drains into the solver at the **next fixed step**, never mid-step (the same
 * commands-not-mutations rule §26 imposes on forces). Both fields are written
 * together because a motor record is one value — writing only the target would
 * silently re-enable a released motor.
 */
function applyMotor(mechanism: Mechanism): void {
  mechanism.shaftHinge.setMotor({
    enabled: motorEnabled,
    targetVelocity: motorTarget,
    maxTorque: MOTOR_GAIN,
  });
  paint(mechanism.motorPlate, motorEnabled ? MOTOR_ON_COLOR : MOTOR_OFF_COLOR);
}

/** Wires the three plates. See {@link applyMotor} for what a click does. */
function watchPlates(mechanism: Mechanism): void {
  // `click` is synthesized by the pointer source — a press and a release on the
  // same node (§72) — and delivered through the node's own §6b emitter.
  mechanism.motorPlate.on("click", () => {
    motorEnabled = !motorEnabled;
    // `enableMotor` keeps the target and the effort and flips only the switch,
    // which is what "release the drive" means: the mechanism coasts, it is not
    // braked (see the module header).
    mechanism.shaftHinge.enableMotor(motorEnabled);
    paint(
      mechanism.motorPlate,
      motorEnabled ? MOTOR_ON_COLOR : MOTOR_OFF_COLOR,
    );
  });

  mechanism.slowerPlate.on("click", () => {
    motorTarget = Math.max(MOTOR_TARGET_MIN, motorTarget - MOTOR_TARGET_STEP);
    applyMotor(mechanism);
  });

  mechanism.fasterPlate.on("click", () => {
    motorTarget = Math.min(MOTOR_TARGET_MAX, motorTarget + MOTOR_TARGET_STEP);
    applyMotor(mechanism);
  });
}

/**
 * The pick candidates, filled by {@link main} once the plates exist.
 *
 * The pointer source reads them through a callback, so it can be constructed
 * before there is anything to pick.
 */
let pickables: readonly Pickable[] = [];

// A real `HTMLCanvasElement` satisfies `PointerSurface` structurally, so no
// adapter and no cast is needed. It is never disposed: it lives exactly as long
// as the page does (§83).
new PointerInput(canvas, { camera, pickables: () => pickables });

// --- the frame loop ----------------------------------------------------------

/** The mechanism, once `main` has built it. `null` until then. */
let scene: Mechanism | null = null;

/**
 * Seeded from the FIRST rAF timestamp rather than `performance.now()`: rAF hands
 * the frame-start time, which can precede a `now()` taken moments earlier, and a
 * negative first delta would make `app.step` throw and kill the loop
 * (WP-3.7-fix1, caught by the WP-3.8 browser gate).
 */
let last: number | null = null;

function frame(now: number): void {
  if (last !== null && scene !== null) {
    // The one place a wall clock is allowed: a presentation-side measurement,
    // converted to **seconds** before it crosses into the engine (§7a, §33).
    app.step((now - last) / 1000);
    sampleSwitches(scene);
    updateSpringVisual(scene);
    syncStatus(scene);
  }
  last = now;
  requestAnimationFrame(frame);
}

/** What the page says while the wasm is decoding, and after. */
const LOADING_TEXT = "loading physics (WebAssembly solver)…";
const RUNNING_TEXT =
  "A motor-driven crank turns a connecting rod, which drives a carriage along a " +
  "limited slider against a spring — one shaft, three hinges, one slider, one " +
  "spring, one motor. The two lamps are limit switches: each latches when the " +
  "carriage reaches its end of the stroke. Click the green plate to release the " +
  "motor (the mechanism coasts) and again to re-engage it; the − and + plates " +
  "command a slower or faster shaft.";

async function main(): Promise<void> {
  status.textContent = LOADING_TEXT;
  status.dataset["state"] = "loading";

  // Acquires the WebGL 2 context (§45).
  await app.initialize();
  // Decodes the Rapier 2D wasm image (§37 allows `initialize` to be async for
  // exactly this).
  await world.initialize();

  const mechanism = buildMechanism();
  pickables = mechanism.plates;
  watchPlates(mechanism);
  updateSpringVisual(mechanism);
  syncStatus(mechanism);
  scene = mechanism;

  status.textContent = RUNNING_TEXT;
  status.dataset["state"] = "running";

  app.start();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  status.textContent = "four.js mechanism: failed to start — see the console.";
  status.dataset["state"] = "error";
  console.error("four.js mechanism: failed to start.", error);
});
