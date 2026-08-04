# four.js guides

The prose half of the §93 Documentation Plan. §93 lists nineteen documentation
items; the first six — installation and quick start, and the five worked
scenes — are carried by the root `README.md` and the example apps:

| §93 item                     | where it lives                                             |
| ---------------------------- | ---------------------------------------------------------- |
| installation and quick start | root `README.md`                                           |
| first 2D scene               | `examples/first-2d-scene`                                  |
| first 3D scene               | `examples/first-3d-scene`                                  |
| first animated scene         | `examples/first-animated-scene`                            |
| first physics scene          | `examples/first-physics-scene`                             |
| mixed 2D/3D/physics example  | `examples/mixed-scene` (and `examples/physics-playground`) |

The remaining thirteen items are these guides. Read them in this order — each
assumes the ones above it:

1. **[The scene graph and transforms](scene-graph-and-transforms.md)** — nodes,
   groups, components (§6a), events (§6b), and the transform system (§7).
2. **[Cameras and coordinate conversion](cameras-and-coordinate-conversion.md)** —
   §47 cameras, §48 viewports, and the full pixel → NDC → world → pick path
   (§71/§72), including pointer input and dragging.
3. **[Fixed-step simulation](fixed-step-simulation.md)** — §9 time domains, the
   §10 accumulator, §39 system ordering, and §43 interpolated rendering.
4. **[Transform authority](transform-authority.md)** — §42's one-owner rule,
   authority handovers, and the §19 physics-animation blending pipeline.
5. **[Materials and the render graph](materials-and-render-graph.md)** — the
   shipped unlit/sprite material tier, render lists, and the honest state of
   the §63 render graph.
6. **[Collision filtering](collision-filtering.md)** — bodies, colliders,
   physics materials, groups and masks (§24), events (§29), and queries (§30).
7. **[Units and numerical stability](units-and-numerical-stability.md)** —
   §7a/§40 unit conventions and the §41 stability guidance, with the measured
   numbers behind it.
8. **[Workers and cross-origin isolation](workers-and-cross-origin-isolation.md)** —
   §88's three threading modes, what ships today (main-thread), and the
   COOP/COEP deployment requirement.
9. **[Performance optimization](performance-optimization.md)** — §86 targets,
   what the committed benchmarks actually measured, and the practices the
   engine's own hot paths use.
10. **[Custom shaders](custom-shaders.md)** — the honest state of §60: what the
    material/shader seam looks like today and what is staged.
11. **[Custom solver adapters](custom-solver-adapters.md)** — the §37
    `PhysicsWorldAdapter` contract, capabilities, and the access seams the
    shipped adapters implement.
12. **[The engineering dashboard](engineering-dashboard.md)** — motors, PID
    control, limit switches, and live instrumentation (§119's dashboard half).
13. **[The digital twin](digital-twin.md)** — serialization (§79), snapshots
    and replay (§34), determinism (§33), and assets (§76), composed.

## Conventions every guide assumes

- The world is **right-handed, Y-up, in 2D and 3D alike** (§7a). 2D gravity is
  negative Y. Angles are **radians**; every engine time is **seconds** — tween
  and timeline durations included, never milliseconds.
- Components attach with `node.addComponent(...)`, one per type per node (§6a).
- Simulation advances in fixed steps; rendering interpolates between them
  (§10, §43).
- Exactly one system owns any node's transform at a time (§42).
- Imports use the umbrella package's subpaths, exactly as the examples do:

  ```ts
  import { Application } from "four/application";
  import { Group, OrthographicCamera } from "four/scene";
  import { Vector3 } from "four/math";
  ```

Section references like "§42" mean `docs/SPECIFICATION.md` numbering. Every
code sample in these guides is written against the implemented API surface
(`docs/Architecture/package-export-surfaces.json`) and modeled on the example
apps; where a §93 topic covers something not yet implemented, the guide says
so and cites the staging note instead of pretending.
