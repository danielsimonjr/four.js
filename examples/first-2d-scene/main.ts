/**
 * four.js — first 2D scene.
 *
 * The smallest program that shows three of the four pillars cooperating over
 * one scene graph:
 *
 * - **Scene** — every object below is a node in a single graph: the camera, the
 *   ground, the circle, and the box. There is no separate "2D layer": the
 *   circle is a flat XY shape and the box is a solid, and they share the same
 *   right-handed, Y-up world (§7a).
 * - **Render** — one `WebglRenderer` draws that graph through one viewport
 *   (§48, §62). Nothing in the scene names WebGL; swapping the backend is a
 *   one-line change at this file's top.
 * - **Motion** — the circle follows a prescribed path (`KinematicController` +
 *   a §13 trajectory) while the box integrates an angular velocity
 *   (`MotionComponent`). Both are *components* attached to ordinary nodes
 *   (§6a), advanced by systems registered on the application (§39).
 *
 * The fourth pillar, **Physics**, arrives in Phase 5 — and will attach to these
 * same nodes as one more component, under one more transform authority (§42).
 *
 * ## Fixed-step simulation, variable-rate rendering (§10, §43)
 *
 * The loop at the bottom feeds real elapsed seconds to `app.step(...)`. Inside,
 * simulation advances in fixed 1/60 s steps regardless of how fast the display
 * refreshes, and the frame is drawn from *interpolated* poses — which is why
 * `app.poses.track(...)` is called for the two moving nodes. On a 144 Hz screen
 * that is what keeps the motion smooth instead of showing each simulation step
 * two or three times.
 */

import { Application } from "four/application";
import { boxGeometry, circleGeometry2D, planeGeometry } from "four/geometry";
import { UnlitMaterial } from "four/materials";
import { Vector3 } from "four/math";
import {
  CircularTrajectory,
  KinematicController,
  KinematicSystem,
  MotionComponent,
  MotionSystem,
} from "four/motion";
import { Renderable } from "four/render";
import { WebglRenderer } from "four/render-webgl";
import { OrthographicCamera, createFullscreenViewport } from "four/scene";

// --- surface ---------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (canvas === null) {
  throw new Error('four.js example: no <canvas id="scene"> in the document.');
}

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 800;
const HEIGHT = 600;

// --- camera and view (§47, §48) --------------------------------------------

// An orthographic camera showing 8 × 6 world units — the same 4:3 shape as the
// canvas, so nothing is stretched. +Y is up here exactly as it is in 3D (§7a).
const camera = new OrthographicCamera({
  left: -4,
  right: 4,
  bottom: -3,
  top: 3,
  near: 0.1,
  far: 10,
});
// A camera is a node, so it is placed with its transform. `Vector3.set` is a
// mutator and announces itself, so no `markDirty()` is needed (§7b).
camera.transform.position.set(0, 0, 5);
// Nothing recomputes implicitly: after changing projection parameters, say so.
camera.updateProjectionMatrix();

// One viewport covering the whole canvas, cleared to a dark background. A
// second entry in `app.views` would be split-screen or a minimap (§48).
const view = createFullscreenViewport(camera);
view.clearColor = [0.05, 0.06, 0.09, 1];

// --- application (§45) ------------------------------------------------------

// The backend is constructed here and handed over: the application drives it,
// but the code that created it owns it (§83).
const renderer = new WebglRenderer();
const app = new Application({ renderer, canvas, views: [view] });

// Draw at the display's true pixel density; the CSS size stays 800 × 600.
renderer.resize(WIDTH, HEIGHT, window.devicePixelRatio);

app.scene.add(camera);

// --- the scene --------------------------------------------------------------

// (1) A static plane, one unit behind the movers — a ground reference, and the
// proof that depth still works in a "2D" scene: the orbiting circle passes in
// front of it.
const ground = new Renderable(
  planeGeometry({ width: 7.6, height: 1.2 }),
  new UnlitMaterial({ color: [0.1, 0.13, 0.19, 1] }),
);
ground.name = "ground";
ground.transform.position.set(0, -2.35, -1);
app.scene.add(ground);

// (2) An orbiting circle — a 2D shape driven by a *prescribed* path (§12, §13).
// The trajectory states where the node is as a function of time; the
// `KinematicSystem` evaluates it once per fixed step and writes the position.
const orbiter = new Renderable(
  circleGeometry2D({ radius: 0.45, segments: 48 }),
  new UnlitMaterial({ color: [1, 0.45, 0.2, 1] }),
);
orbiter.name = "orbiter";
// §42: exactly one system may write a node's transform, and it must say so.
orbiter.transformAuthority = "kinematic";
const orbit = orbiter.addComponent(new KinematicController());
orbit.followPath(
  new CircularTrajectory({
    center: new Vector3(0, 0, 0),
    radius: 2,
    // Radians per second (§7a: radians and seconds everywhere) — a quarter
    // turn per second, so one lap takes four seconds.
    angularVelocity: Math.PI / 2,
  }),
  { loop: true },
);
app.scene.add(orbiter);

// (3) A tumbling box — a 3D solid in the same graph, moved by *derived* motion
// (§11): a `MotionComponent` holds an angular velocity, and the `MotionSystem`
// integrates it into the node's rotation each fixed step. Two non-zero axes so
// the tumble reads as a tumble rather than a spin.
const tumbler = new Renderable(
  boxGeometry({ width: 0.9, height: 0.9, depth: 0.9 }),
  new UnlitMaterial({ color: [0.25, 0.7, 1, 1] }),
);
tumbler.name = "tumbler";
tumbler.transform.position.set(-2.7, 1.8, 0);
tumbler.transformAuthority = "kinematic";
tumbler.addComponent(
  new MotionComponent({ angularVelocity: new Vector3(0.7, 1.1, 0) }),
);
app.scene.add(tumbler);

// --- systems (§39) ----------------------------------------------------------

// Systems do the per-fixed-step work; components are just the state they read.
// Registration order does not matter — the registry runs them by priority.
const motionSystem = new MotionSystem();
const kinematicSystem = new KinematicSystem();
app.systems.register(motionSystem);
app.systems.register(kinematicSystem);

motionSystem.track(tumbler);
kinematicSystem.track(orbiter);

// Interpolate the two movers between simulation states when drawing (§43).
// The ground never moves, so it is left untracked and simply draws from its
// live transform.
app.poses.track(orbiter);
app.poses.track(tumbler);

// --- the frame loop ---------------------------------------------------------

/**
 * Drives the application from `requestAnimationFrame`.
 *
 * `performance.now()`/the rAF timestamp is a *presentation-side* clock, which
 * is the one place a wall clock is allowed: it measures how long the display
 * took, and is converted to seconds before it crosses into the engine (§7a).
 * Simulation itself never sees it — inside `app.step` the fixed-step
 * accumulator hands every system the same injected `fixedDeltaTime` (§10, §33).
 */
let last = performance.now();

function frame(now: number): void {
  app.step((now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
}

async function main(): Promise<void> {
  // Acquires the WebGL 2 context. A failure here rejects rather than leaving a
  // half-started application (§45).
  await app.initialize();
  app.start();
  last = performance.now();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  console.error("four.js example: failed to start.", error);
});
