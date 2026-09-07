/**
 * §78 — loading a glTF model, end to end.
 *
 * Added 2026-09-07 because §78 shipped **tested but undemonstrated**: a browser
 * gate and unit tests covered the loader, and no example loaded a model. "Load
 * my model" is the first thing anyone tries with a 3D engine, so the absence
 * was an adoption gap rather than a correctness one.
 *
 * It exists to show the two things a first attempt gets wrong:
 *
 * 1. **The entry point is `createGltfLoader`, not a `loadGltf`.** The loader is
 *    built once and handed to `AssetManager.load`, which owns the cache, the
 *    refcount and the single fetch per URL (§76).
 * 2. **A `.gltf` with an external buffer needs a transport.** `AssetManager`
 *    resolves `globalThis.fetch` for the document itself, but the loader fetches
 *    the `.bin` beside it and is built without one unless you pass `{ fetch }`.
 *    Omit it and the load fails with
 *    *"the document names external buffer "quad.bin" but this loader was built
 *    without a transport"* — accurate, and easier to read here than to meet.
 *
 * The model is the same `quad.gltf` fixture the browser gate uses: one mesh, one
 * material, one external buffer, no images — the smallest file that still
 * exercises the buffer path that trips people up.
 */
import { Application } from "four/application";
import { AssetManager, createGltfLoader } from "four/assets";
import { instantiateGltf } from "four";
import { PerspectiveCamera, createFullscreenViewport } from "four/scene";
import { WebglRenderer } from "four/render-webgl";

/** The example's drawing surface. */
const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (canvas === null) throw new Error("four.js example: no #scene in the document.");
const status = document.querySelector<HTMLElement>("#status");
if (status === null) throw new Error("four.js example: no #status in the document.");

const renderer = new WebglRenderer();
const camera = new PerspectiveCamera({ aspect: 640 / 400, near: 0.1, far: 100 });
// The quad is authored around the origin in the XY plane; back off along +Z.
camera.position.set(0, 0, 3);

const app = new Application({
  renderer,
  canvas,
  views: [createFullscreenViewport(camera)],
});
renderer.resize(640, 400, window.devicePixelRatio);
app.scene.add(camera);

/**
 * The manager owns the cache and the fetch for the document (§76); the loader
 * needs its own transport for the buffers the document names.
 */
const assets = new AssetManager();
const gltfLoader = createGltfLoader({
  fetch: (input, init) => globalThis.fetch(input, init),
});

let meshCount = 0;

const asset = await assets.load("./quad.gltf", gltfLoader);
const instance = instantiateGltf(asset);
if (instance.scene !== null) {
  app.scene.add(instance.scene);
  instance.scene.traverse(() => {
    meshCount += 1;
  });
}

await app.initialize();
app.start();

// §45 phase 1 installs no driver — the host owns the cadence and calls `step`.
let last = performance.now();
requestAnimationFrame(function frame(now) {
  app.step(Math.max(0, now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
});

status.dataset["state"] = "running";
status.dataset["nodes"] = String(meshCount);
status.textContent = `loaded quad.gltf — ${String(meshCount)} node(s) instantiated`;
