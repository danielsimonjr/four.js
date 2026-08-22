/**
 * four.js — the first **3D** scene of §93: a perspective camera, lit meshes,
 * and one directional light over the same scene graph every other example uses.
 *
 * `first-2d-scene` shows the pillars cooperating through an *orthographic*
 * camera on flat shapes. This page is its 3D counterpart and exists because
 * nothing else in the repository exercised the 3D tier in a browser: until this
 * example landed (2026-08-07) **no shipped example constructed a
 * `PerspectiveCamera`, and none drew a `LitMaterial`** — the lighting MVP
 * (§68, 2026-08-04) and the nine 3D primitives (§53, R-19/R-20, 2026-08-07)
 * were unit-tested and pixel-tested from fake contexts, but never shown.
 *
 * What is new here, and nowhere else:
 *
 * - **A `PerspectiveCamera` (§47).** A projection with a vanishing point, so
 *   the two identical spheres below are *different sizes on screen* purely
 *   because one is nearer. That is the one property an orthographic camera can
 *   never reproduce, and it is what `tests/browser/first-3d-scene.spec.ts`
 *   measures rather than asserting the class name.
 * - **`LitMaterial` under a `DirectionalLight` plus scene ambient (§57, §68).**
 *   Every surface here is shaded `color × (ambient + lightColor · max(N·−L, 0))`
 *   — Lambert diffuse, the MVP lighting tier — so a sphere reads as a sphere
 *   from its shading alone rather than from its silhouette.
 * - **The §53 3D primitives.** `sphereGeometry`, `torusGeometry` and
 *   `capsuleGeometry` carry real per-vertex normals (and uvs, unused here: this
 *   page is untextured on purpose, so what you see is the *lighting*).
 *
 * ## The scene
 *
 * | node          | geometry                      | why it is there                                        |
 * | ------------- | ----------------------------- | ------------------------------------------------------ |
 * | `ground`      | `planeGeometry`, +Y normals   | catches the light so the horizon is visible (§7a Y-up)  |
 * | `nearSphere`  | `sphereGeometry` r = 0.45     | the near half of the perspective pair, and the shading gradient the light test reads |
 * | `farSphere`   | `sphereGeometry` r = 0.45     | the far half — **identical** geometry and material      |
 * | `torus`       | `torusGeometry`               | derived motion (§11, §38): a `MotionComponent` integrates an angular velocity |
 * | `capsule`     | `capsuleGeometry`             | authored motion (§15): a yoyo `Tween` bobs it, so two different clocks are visible in one frame |
 *
 * Two spheres rather than one is the whole design of the perspective proof: the
 * pair shares a geometry *instance* and a material *instance*, so nothing but
 * the transform differs, and the only thing that can make their pixel counts
 * differ is the projection.
 *
 * ## Fixed-step simulation, variable-rate rendering (§10, §43)
 *
 * The loop at the bottom hands real elapsed seconds to `app.step(...)`, which
 * advances simulation in fixed 1/60 s steps and draws from *interpolated* poses
 * — which is why both movers are `app.poses.track`ed. Nothing in this file
 * reads a clock to decide how far something moved: the torus's spin and the
 * capsule's bob are both functions of simulated time (§9), so two runs of this
 * page reach the same pose at the same simulation step.
 *
 * ## Y-up in 3D exactly as in 2D (§7a)
 *
 * The world is right-handed with +Y up and −Z into the screen, angles are
 * radians, times are seconds. The camera stands at +Z and is *aimed* at the
 * middle of the scene; the light shines along its node's −Z world axis (§68),
 * so it is placed up and to the left and aimed at the origin. Both are one
 * `Node.lookAt(target)` call — a light is a node like everything else, and it is
 * turned exactly the way a camera is. This file composed both orientations out
 * of `setFromAxisAngle` quaternions until 2026-08-21.
 *
 * ## Colour discipline (what the browser gate depends on)
 *
 * `tests/browser/first-3d-scene.spec.ts` attributes each pixel to one object
 * from the outside, with no material state to label it (§66 gives this tier
 * none), so hue is the channel — the discipline `examples/particles-demo`
 * established:
 *
 * - the **spheres** are violet: blue leads red at *every* point of their
 *   shading ramp, including the ambient-only dark side;
 * - the **torus** is warm: red leads blue by a wide margin wherever it is lit;
 * - the **capsule** is green: green leads both other channels;
 * - the **ground** is a near-neutral grey and the **background** is darker
 *   still, so neither can be mistaken for a mesh however the light falls.
 *
 * Because the shading ramp is what the gate reads, every colour below states
 * the byte values it produces at full illumination and at ambient only. Change
 * a colour and those margins change with it.
 */

import { AnimationSystem, animate } from "four/animation";
import { Application } from "four/application";
import {
  capsuleGeometry,
  planeGeometry,
  sphereGeometry,
  torusGeometry,
} from "four/geometry";
import { LitMaterial } from "four/materials";
import { Vector3 } from "four/math";
import { MotionComponent, MotionSystem } from "four/motion";
import { Renderable } from "four/render";
import { WebglRenderer } from "four/render-webgl";
import {
  DirectionalLight,
  PerspectiveCamera,
  createFullscreenViewport,
} from "four/scene";

// --- surface ---------------------------------------------------------------

/**
 * The one element matching `selector`, or a thrown error naming it.
 *
 * A helper rather than an inline null check because the handles are read from
 * inside callbacks, and TypeScript does not carry a narrowing from a
 * module-level `if` into a closure (the reason `examples/particles-demo` gives).
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`four.js example: no ${selector} in the document.`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");
const status = requireElement<HTMLParagraphElement>("#status");

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 800;
const HEIGHT = 600;

// --- camera and view (§47, §48) --------------------------------------------

/** Full **vertical** field of view, in radians (§7a) — 45°. */
const FIELD_OF_VIEW = Math.PI / 4;

/** Where the camera stands, in world units. */
const CAMERA_POSITION = new Vector3(0, 1.35, 6.4);

/**
 * What the camera aims at, in **world** space — the middle of the arrangement,
 * a little above the ground plane at `y = −1.3`.
 *
 * A target rather than an angle (R-36's `Node.lookAt`, adopted here 2026-08-21).
 * This file used to write the aim as a rotation — `setFromAxisAngle((1, 0, 0),
 * −0.17)` — which says *how far to tip the camera* and never says *what it is
 * looking at*; a reader had to work the second out from the first, and moving
 * anything in the scene meant re-deriving the angle by hand. One `lookAt` call
 * states the intent, and derives the pitch that satisfies it:
 * `atan2(−1.1, 6.4) = −0.17021` rad, which is the hand-written −0.17 to two
 * ten-thousandths of a radian (about a seventh of a pixel at this projection).
 */
const CAMERA_TARGET = new Vector3(0, 0.25, 0);

// The first perspective camera in any four.js example. `aspect` is the
// viewport's width ÷ height and the application does not guess it: §61 makes it
// the application's to set, and `Application.resize` maintains it afterwards
// for full-surface viewports.
const camera = new PerspectiveCamera({
  fieldOfView: FIELD_OF_VIEW,
  aspect: WIDTH / HEIGHT,
  // A near plane of 0.1 and a far plane of 100 comfortably contain a scene
  // whose deepest object is ~10 units away. Depth precision is a ratio, not a
  // distance: pushing `near` to 0.001 for no reason is what makes z-fighting.
  near: 0.1,
  far: 100,
});
camera.transform.position.copy(CAMERA_POSITION);
// Aim the camera's −Z axis at the scene (§44/§47's orientation helper). The
// target is world-space whatever the camera is parented to, and world +Y is the
// default `up`, which is right for everything but a straight-down shot.
camera.lookAt(CAMERA_TARGET);
// Nothing recomputes implicitly: after setting projection parameters, say so.
camera.updateProjectionMatrix();

// One viewport covering the whole canvas (§48), cleared to a near-black that no
// pixel classifier in the browser gate can fire on.
const view = createFullscreenViewport(camera);
view.clearColor = [0.045, 0.05, 0.075, 1];

// --- application (§45) ------------------------------------------------------

// The backend is constructed here and handed over: the application drives it,
// but the code that created it owns it (§83).
const renderer = new WebglRenderer();
const app = new Application({ renderer, canvas, views: [view] });

// Draw at the display's true pixel density; the CSS size stays 800 × 600.
renderer.resize(WIDTH, HEIGHT, window.devicePixelRatio);

app.scene.add(camera);

// --- light (§68) ------------------------------------------------------------

/**
 * The scene-wide ambient term (§68's "ambient", a `Scene` property rather than
 * a node — see `@four/scene`'s `light.ts`). Cool and modest: it is what keeps
 * a surface facing away from the sun readable instead of black, and every
 * "dark side" number quoted in this file is `color × ambient`.
 */
const AMBIENT_LIGHT: readonly [number, number, number] = [0.16, 0.17, 0.21];

app.scene.ambientLight[0] = AMBIENT_LIGHT[0];
app.scene.ambientLight[1] = AMBIENT_LIGHT[1];
app.scene.ambientLight[2] = AMBIENT_LIGHT[2];

/**
 * Where the sun stands, in world units — 10 units from the origin, up, to the
 * left, and behind the viewer's shoulder.
 *
 * A `DirectionalLight` shines along its node's **−Z world axis** (§68) — the
 * direction a camera looks — so it is aimed by rotating the node, not by
 * writing a direction vector. Until 2026-08-21 that rotation was composed here
 * by hand out of a pitch and a yaw (`yaw.multiply(pitch)`, §7b), and the
 * resulting travel direction was quoted in this comment because nothing in the
 * code said it. Placing the light and calling {@link Node.lookAt} says the same
 * thing in the terms anyone lighting a scene actually thinks in — *the sun is
 * over there* — and the direction is then read off the code rather than
 * asserted by a comment:
 *
 * ```text
 * ‖SUN_POSITION‖ = 10 exactly, so the light travels
 * (0.345, −0.751, −0.563)   — down, to the right, and away from the camera
 * ```
 *
 * which is the pre-`lookAt` pitch/yaw pair (−0.85, −0.55) to three decimal
 * places. That is the classic key-light placement, and it is what puts a bright
 * upper-left and a dim lower-right on every sphere here — the gradient the
 * browser gate measures to prove the shading is real Lambert diffuse and not a
 * flat fill.
 */
const SUN_POSITION = new Vector3(-3.45, 7.51, 5.63);

/** What the sun is aimed at — the world origin, the middle of the meshes. */
const ORIGIN = new Vector3(0, 0, 0);

const sun = new DirectionalLight({
  // Slightly warm white against the cool ambient, so the lit and unlit sides of
  // a surface differ in hue as well as in brightness.
  color: [1, 0.96, 0.9],
  // Dimensionless in this tier (§68's physical units are staged): 1 is the
  // multiplicative identity, and 1.25 makes a fully lit surface a little
  // brighter than its own colour.
  intensity: 1.25,
});
sun.name = "sun";
sun.transform.position.copy(SUN_POSITION);
// A light is aimed exactly as a camera is: one call, a world-space target. The
// position itself does not reach the shader — a directional light contributes a
// direction only (§68) — it is what makes the aim expressible.
sun.lookAt(ORIGIN);
app.scene.add(sun);

// --- the meshes -------------------------------------------------------------

// (1) The ground. `planeGeometry` faces +Z, so a −π/2 pitch about X lays it
// flat with its normals pointing +Y — the same rotation that would aim a
// camera at the floor, for the same reason (§7a).
const ground = new Renderable(
  planeGeometry({ width: 30, height: 30 }),
  // Near-neutral grey: bright enough to show that it is lit from above, far
  // enough from every mesh hue that no classifier in the gate can claim it.
  // Fully lit it is (48, 50, 51); it never reaches a mesh's margins.
  new LitMaterial({ color: [0.17, 0.175, 0.19, 1] }),
);
ground.name = "ground";
ground.transform.position.set(0, -1.3, 0);
ground.transform.rotation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
app.scene.add(ground);

/**
 * The spheres' shared radius. Both spheres are built from **one** geometry and
 * **one** material instance: sharing is the norm (§83 puts disposal on whoever
 * created a resource, not on each user), and here it is also the experiment's
 * control — nothing but the transform differs between the two.
 */
const SPHERE_RADIUS = 0.45;

const sphereGeometryShared = sphereGeometry({
  radius: SPHERE_RADIUS,
  widthSegments: 48,
  heightSegments: 24,
});

/**
 * Violet, and violet everywhere along its ramp: fully lit it is
 * `(187, 154, 255)` and at ambient only `(21, 19, 51)`, so blue leads red by 68
 * at the bright end and by 30 at the dark end. The gate's sphere classifier
 * (`blue ≥ 45` and `blue − red ≥ 22`) therefore holds across the whole shaded
 * surface, and the background's `(11, 13, 19)` cannot reach it.
 */
const sphereMaterial = new LitMaterial({ color: [0.52, 0.44, 0.95, 1] });

const nearSphere = new Renderable(sphereGeometryShared, sphereMaterial);
nearSphere.name = "near-sphere";
nearSphere.transform.position.set(-1.55, -0.3, 1.4);
app.scene.add(nearSphere);

const farSphere = new Renderable(sphereGeometryShared, sphereMaterial);
farSphere.name = "far-sphere";
farSphere.transform.position.set(1.9, 0.15, -3.8);
app.scene.add(farSphere);

// (2) The torus — derived motion (§11, §38). A `MotionComponent` holds an
// angular velocity in radians per second and `MotionSystem` integrates it into
// the node's rotation once per fixed step. Two non-zero axes so the tumble
// reads as a tumble, and so the ring presents a different silhouette to the
// light every second.
const torus = new Renderable(
  torusGeometry({
    radius: 0.75,
    tubeRadius: 0.26,
    tubularSegments: 48,
    radialSegments: 24,
  }),
  // Warm: fully lit (255, 147, 48), so red leads blue by 207 where the light
  // reaches it. The gate counts torus pixels with `red ≥ 70` and
  // `red − blue ≥ 45`, which its ambient-only side deliberately fails — an
  // unlit face of an orange torus is not orange, it is brown, and pretending
  // otherwise would make the classifier a lie.
  new LitMaterial({ color: [0.98, 0.42, 0.14, 1] }),
);
torus.name = "torus";
torus.transform.position.set(-0.15, 0.7, -0.8);
// §42: exactly one system may write a node's transform, and it must say so.
torus.transformAuthority = "kinematic";
torus.addComponent(
  new MotionComponent({ angularVelocity: new Vector3(0.55, 0.9, 0) }),
);
app.scene.add(torus);

/** Where the capsule's bob starts and ends, in world units. */
const CAPSULE_LOW_Y = -0.35;
const CAPSULE_HIGH_Y = 0.35;

// (3) The capsule — authored motion (§15). `capsuleGeometry.height` measures
// the **cylindrical section only**, so this capsule's total extent along Y is
// `1 + 2 × 0.32`; that is the same measurement §24's capsule collider takes,
// which is what lets a body and the shape drawn for it be built from one pair
// of numbers.
const capsule = new Renderable(
  capsuleGeometry({
    radius: 0.32,
    height: 1,
    radialSegments: 32,
    capSegments: 10,
  }),
  // Green: fully lit (86, 255, 143). The gate's classifier is `green ≥ 90`,
  // `green − red ≥ 45` and `green − blue ≥ 35`; no other surface here can
  // satisfy all three.
  new LitMaterial({ color: [0.24, 0.85, 0.42, 1] }),
);
capsule.name = "capsule";
capsule.transform.position.set(3.3, CAPSULE_LOW_Y, -3);
// §42: the tween below writes as `"animation"`, and the two have to agree or
// the write is refused and warns.
capsule.transformAuthority = "animation";
app.scene.add(capsule);

// --- systems (§39) ----------------------------------------------------------

// Systems do the per-fixed-step work; components are just the state they read.
// Registration order does not matter — the registry runs them by priority, and
// animation (300) runs before motion (400) whatever order they arrive in.
const motionSystem = new MotionSystem();
const animationSystem = new AnimationSystem();
app.systems.register(motionSystem);
app.systems.register(animationSystem);

motionSystem.track(torus);

// The capsule's whole `transform.position` moves, not two scalars: naming the
// node as the target is also what lets the tween find the §42 authority that
// gates it. Seconds everywhere (§7a); `yoyo` walks the same eased curve back
// rather than snapping to the start.
animationSystem.track(
  animate(capsule)
    .to({ "transform.position": new Vector3(3.3, CAPSULE_HIGH_Y, -3) }, 1.4)
    .ease("sine-in-out")
    .yoyo()
    .repeat(Infinity)
    .play(),
);

// Interpolate the movers between simulation states when drawing (§43). The
// ground, the two spheres and the camera never move, so they are left untracked
// and simply draw from their live transforms.
app.poses.track(torus);
app.poses.track(capsule);

// --- what the page publishes ------------------------------------------------

/** Frames rendered since the loop started; mirrored onto `#status`. */
let frameCount = 0;

/**
 * Mirrors the running scene onto `#status`, so a browser gate can read the
 * engine's own account of the frame instead of inferring everything from
 * pixels — and so the two accounts can be checked against each other.
 *
 * Called from `update`, once per host frame, after every fixed step of that
 * frame has run: these are quantities a *frame* observes.
 */
function publish(simulationTime: number): void {
  status.dataset["state"] = "running";
  status.dataset["frames"] = String(frameCount);
  status.dataset["camera"] = "perspective";
  // Radians (§7a). The gate compares this against the value it computes the
  // expected projection from, so a changed field of view fails loudly rather
  // than silently moving every threshold.
  status.dataset["fov"] = camera.fieldOfView.toFixed(4);
  status.dataset["aspect"] = camera.aspect.toFixed(4);
  status.dataset["lights"] = "1";
  status.dataset["meshes"] = "5";
  status.dataset["sim"] = simulationTime.toFixed(2);
  status.textContent =
    `perspective camera, ${(FIELD_OF_VIEW * (180 / Math.PI)).toFixed(0)}° vertical FOV — ` +
    `5 lit meshes, 1 directional light + ambient — ` +
    `simulated ${simulationTime.toFixed(1)} s over ${String(frameCount)} frames`;
}

app.on("update", (time) => {
  frameCount += 1;
  publish(time.simulationTime);
});

// --- the frame loop ---------------------------------------------------------

/**
 * Drives the application from `requestAnimationFrame`.
 *
 * The rAF timestamp is a *presentation-side* clock, which is the one place a
 * wall clock is allowed: it measures how long the display took, and is
 * converted to seconds before it crosses into the engine (§7a). Simulation
 * never sees it — inside `app.step` the fixed-step accumulator hands every
 * system the same injected `fixedDeltaTime` (§10, §33).
 *
 * Seeded from the FIRST rAF timestamp rather than a `now()` taken earlier: rAF
 * hands the frame-*start* time, and a negative first delta would make
 * `app.step` throw and kill the loop (the bug WP-3.7-fix1 fixed).
 */
let last: number | null = null;

function frame(now: number): void {
  if (last !== null) {
    app.step((now - last) / 1000);
  }
  last = now;
  requestAnimationFrame(frame);
}

async function main(): Promise<void> {
  // Acquires the WebGL 2 context. A failure here rejects rather than leaving a
  // half-started application (§45).
  await app.initialize();
  app.start();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  status.dataset["state"] = "error";
  status.textContent = "failed to start — see the console";
  console.error("four.js example: failed to start.", error);
});
