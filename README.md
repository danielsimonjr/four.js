# four.js

**One scene. Every dimension. Everything moves.**

four.js is a unified JavaScript/TypeScript framework for building interactive
applications that combine 2D, 2.5D, and 3D graphics with animation, motion systems, and
physics in a single shared scene model. 2D shapes, 3D meshes, sprites, text, UI widgets,
rigid bodies, joints, and particle emitters are all nodes and components in one scene
graph, over one fixed-step simulation loop with interpolated rendering.

The full implementation plan (§103–§113a) is complete: 24 workspace packages build,
test (≈3,000 unit tests, coverage ≥95% per package, browser-verified rendering and
input), and lint. The §120 MVP audit stands at **43/43 shipped-or-MVP** — this line read
"42/43 … lighting is the single staged absence" until 2026-08-05, which stopped being
true when the lighting packet landed 2026-08-04 (`docs/AUDIT-120.md`, S-5). Six of the 43
ship at a pinned MVP tier with a dated widening staged; see that audit's staged lines
before quoting the count. The packages are not yet published to npm.

## Quick start (§93)

Until first publish, clone the repository and build the workspace
(`pnpm install && pnpm build`), then run any example with
`npx vite examples/first-2d-scene`. The smallest program looks like this:

```ts
import { Application } from "four/application";
import { circleGeometry2D } from "four/geometry";
import { UnlitMaterial } from "four/materials";
import { OrthographicCamera, createFullscreenViewport } from "four/scene";
import { Renderable } from "four/render";
import { WebglRenderer } from "four/render-webgl";

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
let last = performance.now();
requestAnimationFrame(function frame(now) {
  app.step(Math.max(0, now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
});
```

> The snippet is illustrative; the compiling, running version of every idea in it is
> `examples/first-2d-scene/main.ts`, which adds picking, dragging, sprites, text, and
> authored animation on top. Start there.

## Examples

Each example is a small Vite app; build them all with `pnpm examples:build` or serve one
directly with `npx vite examples/<name>`.

| Example              | Shows                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `first-2d-scene`     | Scene/render/motion pillars, §13 trajectories, tweens/clips/timelines, picking, dragging, text  |
| `physics-playground` | Rigid bodies on the Rapier adapter, mixed 2D/3D worlds, §42 authority                           |
| `mechanism`          | §28 joints: a slider-crank driven by a motor, with live limits                                  |
| `blending`           | §19 physics-animation blending: animated ↔ ragdoll ↔ recovering, in-place re-typing             |
| `particles-demo`     | SoA particle core, §27 force fields, one-draw-call instanced rendering                          |
| `ui-demo`            | @four/ui widgets (panel/buttons/labels), app-supplied skins, keyboard focus, §72 pointer events |

## The four pillars

- **Scene** — one graph (`@four/scene`): nodes, typed events (§6b), components (§6a),
  transform authority (§42), cameras and viewports.
- **Render** — a backend-independent interface (`@four/render`) with a WebGL 2 backend
  (`@four/render-webgl`); WebGPU/Canvas/SVG tiers are reserved interfaces (§62).
- **Motion** — integrators, trajectories, kinematic control, steering, PID, springs,
  seeded randomness (`@four/motion`), and authored animation (`@four/animation`).
- **Physics** — a stable API (`@four/physics`) over pluggable solver adapters (§37);
  `@four/physics-rapier` ships 2D and 3D Rapier solvers with determinism goldens,
  snapshots, and bit-identical replay (§33–§34, `@four/diagnostics`).

Conventions everywhere: right-handed **Y-up world in both 2D and 3D**, radians, **all
times in seconds**, fixed-step simulation with render interpolation (§10). See
`docs/guides/` for prose guides and `CLAUDE.md`/`AGENTS.md` for contributor orientation.

## Development

```sh
pnpm install          # workspace install (Node >= 20, pnpm 10)
pnpm build            # tsc -b, all 24 packages, topological
pnpm test             # per-package unit tests
pnpm test:suites      # cross-package integration + determinism suites
pnpm test:browser     # Playwright + SwiftShader browser gates
pnpm lint             # eslint (type-checked)
pnpm run docs         # TypeDoc API reference
pnpm check-spec       # specification consistency checks
pnpm graph            # regenerate docs/Architecture (dependency graph)
pnpm run size         # §86 payload budget (150 kB gzip ceiling)
```

## Specification

See [docs/SPECIFICATION.md](docs/SPECIFICATION.md) — the working reference for this
repository (parts I–XIII, sections 1–120 plus lettered insertions and appendices, no
duplicates). Its amendments table records each revision. The original
[docs/archive/four-js-specification.pdf](docs/archive/four-js-specification.pdf) is
preserved unchanged and **frozen at the pre-1.0 text**; [docs/ERRATA.md](docs/ERRATA.md)
documents its known defects and the old-to-new numbering map.

Publish naming (§98): the umbrella package publishes as `@danielsimonjr/fourjs`, the
sub-packages as `@danielsimonjr/fourjs-<name>`; workspace names remain `four`/`@four/*`.

## Compatibility

[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) carries §90's five tables — browser and
runtime support (what is _tested_ versus what is merely expected), the §62 render-backend
tiers, the physics solver adapters, the scene/replay/snapshot format versions, and the
plugin API (n/a: §81 is unimplemented). The solver-adapter block is generated from the
adapters' own §37 capability declarations by `node tools/generate-compatibility.mjs`;
`--check` fails if the committed document has drifted from them.

## License

MIT — see [LICENSE](LICENSE).
