/**
 * The page `tests/browser/readme.spec.ts` drives — README.md's Quick start
 * TypeScript block against a **real** WebGL 2 context.
 *
 * This file is not an example and is not served: the spec bundles it with
 * Vite's JavaScript API and injects the result into a page, the technique
 * `batching-page.ts` introduced. The README snippet is the first program a
 * new reader copies; until 2026-09-06 it was gated only by a text check in
 * `tools/check-docs.mjs` (`start()` / `step()` pairing). That check cannot
 * see a runtime throw. This fixture is the runtime half.
 *
 * ## Why the snippet is restated, not extracted at runtime
 *
 * Every other browser gate restates the page it checks as constants in the
 * spec, and says why: a gate that imported the source under test would let a
 * wrong page agree with a wrong expectation. The same honesty applies here.
 * The block below is README.md's Quick start ` ```ts ` fence, restated, with
 * two mechanical adaptations the fixture Vite lib build requires:
 *
 * 1. **Imports.** The README writes `four/application`, `four/geometry`, …
 *    — the umbrella subpaths an examples/ Vite config resolves. Fixture
 *    pages resolve workspace packages the same way `batching-page.ts` does
 *    (`@four/geometry`, `@four/materials`, …). `Application` lives on the
 *    umbrella package, so that one import stays `four/application`.
 * 2. **Ready flag.** After `start()` the fixture sets
 *    `body[data-readme-ready]`, which the spec waits for. The README has
 *    no such hook; it is not part of the program under test.
 *
 * The rest — camera, `Application`, the circle, the fixed-step `step()`
 * loop — is the README's.
 */

import { Application } from "four/application";
import { circleGeometry2D } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import { Renderable } from "@four/render";
import { WebglRenderer } from "@four/render-webgl";
import { OrthographicCamera, createFullscreenViewport } from "@four/scene";

const canvas = document.querySelector("canvas")!;
const renderer = new WebglRenderer();

// A world-unit view: right-handed, Y-up (§7a), radians and seconds everywhere.
const camera = new OrthographicCamera({
  left: -4,
  right: 4,
  bottom: -3,
  top: 3,
  near: 0.1,
  far: 10,
});
camera.position.set(0, 0, 5);

const app = new Application({
  renderer,
  canvas,
  views: [createFullscreenViewport(camera)],
});
renderer.resize(800, 600, window.devicePixelRatio);
app.scene.add(camera);

// One node: a flat 2D circle in the same graph a 3D mesh would join.
const circle = new Renderable(
  circleGeometry2D({ radius: 1 }),
  new UnlitMaterial({ color: [1, 0.5, 0.2, 1] }),
);
app.scene.add(circle);

// Simulation advances in fixed 1/60 s steps; rendering interpolates (§10).
app.poses.track(circle);
app.on("update", (time) => {
  circle.position.set(
    Math.cos(time.simulationTime),
    Math.sin(time.simulationTime),
    0,
  );
});

await app.initialize();
app.start();
document.body.dataset["readmeReady"] = "1";
let last = performance.now();
requestAnimationFrame(function frame(now) {
  app.step(Math.max(0, now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
});
