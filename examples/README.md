# Examples

Runnable examples planned by the documentation plan (§93) and the flagship demonstrations
(§118–119). Every major feature should have a runnable example (§93). Entries below are
implemented where noted; the rest are scaffold only.

- [`first-2d-scene/`](first-2d-scene/) — **Implemented.** First 2D scene (§93) grown into
  the interactive demo: shapes, motion, picking, dragging, text, animation
  (`pnpm run example:build`).
- [`blending/`](blending/) — **Implemented.** The §110 Phase 7 demonstration: an articulated
  chain cycling between animated, ragdoll and blended-recovery control on a click — pose
  targets, §19 weights, velocity inheritance, live continuity measurement
  (`pnpm run blending:build`).
- [`particles-demo/`](particles-demo/) — **Implemented.** The §112 Phase 9 demonstration: a
  seeded CPU particle fountain under §27 force fields (gravity, drag, vortex), bouncing off a
  §36 collision plane, plus a click burst — each system drawn as one instanced draw call
  (`pnpm run particles-demo:build`). Non-wasm and ~19 kB gzip; the 100 000-particle half of
  §112 is measured headlessly by `benchmarks/particles-100k.mjs`.
- [`mechanism/`](mechanism/) — **Implemented.** The §109 Phase 6 demonstration: a
  motor-driven slider–crank — rotating shaft, hinges, limited slider, spring buffer,
  limit-switch lamps, click-to-coast motor with speed controls
  (`pnpm run mechanism:build`).
- [`physics-playground/`](physics-playground/) — **Implemented.** The §108 Phase 5 exit
  demonstration: a 2D world and a 3D world stepping side by side through one API —
  gravity, collisions, click impulses, sensor zones (`pnpm run playground:build`).
  Fulfils the role sketched for `first-physics-scene/` (scaffold entry kept until the
  owner retires it).
- [`first-3d-scene/`](first-3d-scene/) — First 3D scene (§93): mesh, camera, lighting.
- [`first-animated-scene/`](first-animated-scene/) — First animated scene (§93): tweens and a timeline.
- [`first-physics-scene/`](first-physics-scene/) — First physics scene (§93): gravity, collisions, impulses.
- [`mixed-scene/`](mixed-scene/) — Mixed 2D/3D/physics/UI example (§93, §97).
- [`flagship/one-scene-everything-moves/`](flagship/one-scene-everything-moves/) — Flagship demo (§118): rotating cube, 2D orbit, pendulum, bouncing body, labels, UI panel, timeline, motorized hinge, collision events, pause/slow-motion/step.
- [`flagship/motor-digital-twin/`](flagship/motor-digital-twin/) — Engineering flagship (§119): electric motor digital twin — animated rotor, bearing constraints, PID speed control, fault injection, waveforms, replay.
