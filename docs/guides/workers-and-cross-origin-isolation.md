# Workers and cross-origin isolation

§88 defines three operating modes for four.js applications. This guide states
what each mode is, **what actually ships today**, and the deployment
requirement (COOP/COEP headers) that §88 obliges the documentation to cover.

## Honest state first

**Everything shipped today runs in main-thread mode.** No worker-rendering or
split-simulation code exists in the repository; the §88 section is normative
direction ("APIs and data structures should avoid assumptions that make
worker migration impossible"), and the engine's design decisions honour it —
but no packet has implemented a worker mode, and none is scheduled in the
completed Phase 0–11 plan. Treat the two worker modes below as **staged**.

## The three modes (§88)

1. **Main-thread mode** _(shipped)_ — input, simulation, and rendering all on
   the browser main thread. Every example app runs this way.
2. **Worker-rendering mode** _(staged)_ — the main thread owns DOM,
   accessibility, and input forwarding; a worker owns the scene, simulation,
   and `OffscreenCanvas` rendering.
3. **Split-simulation mode** _(staged)_ — rendering stays on the main thread;
   simulation executes in a worker over transferable or shared state buffers.

## Why migration stays possible

Several shipped decisions were made with §88 in view, and they are the reason
worker migration is a refactor rather than a rewrite:

- **The engine never touches the DOM.** `Application` takes a canvas and a
  constructed renderer; `PointerInput` reads only three structural members of
  its surface (`addEventListener`, `removeEventListener`,
  `getBoundingClientRect`) — a postMessage-fed stand-in satisfies it.
- **Simulation is headless by construction.** An `Application` without a
  renderer runs the identical event trace (§33); the determinism suites
  already run whole simulations in plain Node processes.
- **Fixed-step state is snapshottable** (§34) and pose data flows through
  `PoseBuffer` — a compact, copyable structure — rather than through live
  scene reads.

A worker-ready structure you can adopt now: keep everything below the frame
loop free of `window`/`document`, and feed elapsed time in from outside.
This complete program is the simulation half of a future split — it runs
unchanged on the main thread today and in a worker later:

```ts
// simulation.ts — no DOM access anywhere below this line.
import { Application } from "four/application";
import { Vector3 } from "four/math";
import { MotionComponent, MotionSystem } from "four/motion";
import { Group } from "four/scene";

export function createSimulation() {
  const app = new Application({ fixedTimeStep: 1 / 60 });
  const rotor = new Group();
  rotor.name = "rotor";
  rotor.transformAuthority = "kinematic";
  rotor.addComponent(
    new MotionComponent({ angularVelocity: new Vector3(0, 0, 8) }),
  );
  app.scene.add(rotor);

  const motion = new MotionSystem();
  app.systems.register(motion);
  motion.track(rotor);

  return {
    ready: app.initialize().then(() => {
      app.start();
    }),
    // The host — rAF loop or worker message pump — feeds elapsed seconds:
    step: (elapsedSeconds: number) => {
      app.step(elapsedSeconds);
    },
    // The host reads poses out; in a worker this becomes a posted buffer:
    rotorAngle: () =>
      2 * Math.atan2(rotor.transform.rotation.z, rotor.transform.rotation.w),
  };
}
```

## Cross-origin isolation (the deployment requirement)

Split-simulation mode's shared state buffers require `SharedArrayBuffer`,
which browsers gate behind **cross-origin isolation**. When that mode lands,
serving a page that uses it will require these response headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Consequences to plan for now if you intend to adopt it:

- Every embedded cross-origin resource (fonts, images, wasm — including
  solver wasm if you move it off the bundled base64 images) must itself send
  `Cross-Origin-Resource-Policy` or be loaded with `crossorigin` + CORS.
- Third-party iframes that are not COEP-compatible will stop loading.
- §88 requires the engine to **detect unavailability and fall back** to
  transferable buffers — so isolation is a performance requirement, not a
  correctness one, and your deployment can adopt it incrementally.

You can verify a deployment today with `crossOriginIsolated === true` in the
console.

## Practical guidance

- Nothing to configure today: ship main-thread, keep DOM access confined to
  the frame loop and input layer as the examples do.
- If you operate a CDN or static host, find out where response headers are
  set _now_ — COOP/COEP misconfiguration is the classic last-minute blocker
  for wasm-threads features.
- Solver wasm decoding is already async (§37 `initialize()`), so a future
  worker boot sequence changes where it happens, not whether the API allows
  it.

## Cross-references

- §88 (threading and workers), §33/§34 (headless simulation and snapshots),
  §45 (application model), §37 (async solver initialization).
- `tests/determinism/` — whole simulations running headless in child Node
  processes, the existence proof for the simulation half.
