# Performance optimization

§86 states the engineering targets; the committed benchmarks state what has
been measured. This guide covers both, plus the practices the engine's own
hot paths use — which are the same ones your application code should.

## Targets vs. measurements

§86's headline targets (100 000 batched sprites, 5 000 rigid bodies, 150 kB
gzip minimal payload, …) are benchmark goals, not guarantees. What the
committed benchmark records (`benchmarks/`, run on a 4-core CI Xeon) actually
say:

- **Particles:** 100 000 particles + 3 force fields = **16.54 ms/step mean**
  — 99.2 % of the 60 Hz budget, p95 over it. The integrator alone is 1.35 ms;
  each polymorphic §27 `sample()` call site costs ~5.3 ms per 100 k. Fewer,
  cheaper fields is the lever.
- **Physics:** contacts + event derivation are **~88 % of a physics step**.
  Fewer touching pairs (filtering, sleeping, sensor discipline) buys more
  than any micro-optimization.
- **Scene:** a clean world-transform pass is only ~3× cheaper than a full
  recompute — dirty-tracking helps but is not free; scene depth is
  recursion-limited around ~8 k.
- **Payload:** the §86 gate holds the minimal 2D app at **32.13 kB gzip** of
  its 150 kB budget. Solver wasm is outside the budget by its wording
  (~670 kB gzip per Rapier dimension) — load it async and show a loading
  state, as every physics example does.

## Draw calls: batching is per system, not per particle

A `ParticleRenderable` is exactly **one** instanced draw whatever its count.
The demo below simulates thousands of particles in two draw calls; scaling
the numbers up changes fill rate, not call count:

```ts
import { Application } from "four/application";
import { Vector3 } from "four/math";
import {
  ParticleEmitter,
  ParticleRenderable,
  ParticleSystem,
  uniformGravityField,
} from "four/particles";
import { WebglRenderer } from "four/render-webgl";
import { OrthographicCamera, createFullscreenViewport } from "four/scene";

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (canvas === null) throw new Error("no canvas");

const camera = new OrthographicCamera({
  left: -4,
  right: 4,
  bottom: -3,
  top: 3,
  near: 0.1,
  far: 20,
});
camera.transform.position.set(0, 0, 10);
camera.updateProjectionMatrix();

const renderer = new WebglRenderer();
const app = new Application({
  renderer,
  canvas,
  views: [createFullscreenViewport(camera)],
});
renderer.resize(800, 600, window.devicePixelRatio);
app.scene.add(camera);

function fountain(x: number, seed: number): ParticleEmitter {
  return new ParticleEmitter({
    maxParticles: 3000, // capacity is part of the RNG stream — size it once
    seed,
    position: new Vector3(x, -2, 0),
    emissionRate: 1200,
    lifetime: { min: 1.2, max: 2 },
    initialSpeed: { min: 4, max: 6 },
    direction: new Vector3(0, 1, 0),
    spreadAngle: 0.25,
    size: { start: 0.06, end: 0.02 },
    color: {
      start: { r: 1, g: 0.7, b: 0.3, a: 1 },
      end: { r: 1, g: 0.2, b: 0.1, a: 0 },
    },
    // One constant acceleration? Use the emitter's own gravity option —
    // it costs no per-particle virtual call, a field does (~5 ms/100k each):
    gravity: new Vector3(0, -9.81, 0),
  });
}

const left = fountain(-1.5, 101);
const right = fountain(1.5, 102);
app.scene.add(new ParticleRenderable(left)); // draw call 1
app.scene.add(new ParticleRenderable(right)); // draw call 2

const particles = new ParticleSystem();
app.systems.register(particles);
particles.track(left);
particles.track(right);

let last: number | null = null;
function frame(now: number): void {
  if (last !== null) app.step((now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
}
app.initialize().then(() => {
  app.start();
  requestAnimationFrame(frame);
});
```

Sprites and glyphs are **not** batched yet (each is a draw; the §55
frame-region + §65 batching backlog) — keep label counts modest and cache
materials per distinct texture, as the examples do.

## Allocation discipline (§7b)

The math types are mutable with `out`-parameter hot paths, and the engine's
own systems allocate nothing per step. Do the same in yours:

```ts
const impulse = new Vector3(); // module-level scratch
node.on("click", (event) => {
  impulse.set(0, 6.5 * (body.mass ?? 1), 0); // reuse; no per-event allocation
  body.wake();
  body.applyImpulse(impulse);
});
```

Prefer `position.set(...)` over building new vectors; one clamped `set` also
advances the transform version once instead of twice. Diagnostics helpers
follow the same convention (`solverStatistics(access, out)` reuses `out`).

## The checklist

- **Track poses only for movers** (§43). Untracked static nodes draw from
  their live transform and cost nothing per step.
- **Let bodies sleep** (§32) unless the scene needs them responsive;
  `examples/mechanism` disables sleeping for five bodies and says why —
  don't copy that into a 500-body scene. (Honest gap: sleep _thresholds_
  have no Rapier binding yet; only `enabled` maps.)
- **Filter aggressively** (groups/masks, sensors) — contacts dominate the
  step; a pair that cannot collide costs nothing in the narrow phase.
- **Build pick candidate lists once** when the pickable set is static; the
  bounds vectors are live views onto the geometry.
- **Reuse geometries and materials**: GPU caches key on object identity +
  version, so two nodes sharing a `BufferGeometry` share buffers.
- **Idle scenes should idle** (§86): no unnecessary uploads or simulation.
  Untrack finished tweens (the `AnimationSystem` auto-untracks); don't
  repaint materials every frame when only edges change (see the limit-switch
  repaint in `examples/mechanism`).
- **Measure with the engine's numbers first** — `Emitter.particleCount`,
  `droppedCount`, `TimeState.droppedTime`, checksummed step times — before
  reaching for a profiler, and keep `benchmarks/` as the model for a fair
  headless measurement.

## Cross-references

- §86 (targets), §87 (spatial indexing — honest state: staged; steering uses
  brute-force neighbours today), §65 (batching), §32 (sleeping).
- `benchmarks/` (committed records), `examples/particles-demo` (batching made
  visible, with its own honest scale note).
