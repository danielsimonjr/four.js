# Examples

Runnable examples planned by the documentation plan (§93) and the flagship demonstrations
(§118–119). Every major feature should have a runnable example (§93).

**Seven examples are implemented** (six until 2026-08-07, when `first-3d-scene` was
written). The other five entries below are **not yet written; the directory is a
placeholder** — each holds a `.gitkeep` and nothing else. Until 2026-08-05
they were described only as "scaffold only" in this paragraph while reading like a catalogue
of demos in the list; each such row now carries the marker on its own line. The absence is
dated in `docs/AUDIT-120.md` as **S-8**, and `tools/check-docs.mjs` fails if this file or a
guide points at one of them without the marker.

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
  Fulfils the role sketched for `first-physics-scene/` (placeholder entry kept until the
  owner retires it).
- [`ui-demo/`](ui-demo/) — **Implemented.** §73–§75's retained-mode UI: a `@four/ui` panel of
  buttons and labels laid out by the package and skinned by the application, driven by real
  pointer and keyboard input, with a drawn focus ring (`pnpm run ui-demo:build`). Listed
  here from 2026-08-05; it shipped earlier and this file had never mentioned it.
- [`first-3d-scene/`](first-3d-scene/) — **Implemented (2026-08-07).** §93's first 3D
  scene, and the first example of any kind to use a `PerspectiveCamera`: two identical
  spheres at different depths (the projection measured in pixels, not asserted by class
  name), a tumbling torus, a bobbing capsule and a ground plane, all `LitMaterial` under one
  `DirectionalLight` plus scene ambient (§47, §53, §57, §68).
  Build it with `pnpm run first-3d-scene:build`; it is non-wasm and ~23 kB gzip.
  This entry read "**not yet written; directory is a placeholder** … the one placeholder
  with no stand-in" until that date.
- [`first-animated-scene/`](first-animated-scene/) — **Not yet written; directory is a
  placeholder.** Planned as §93's first animated scene: tweens and a timeline. Animation
  ships inside `first-2d-scene/`.
- [`first-physics-scene/`](first-physics-scene/) — **Not yet written; directory is a
  placeholder.** Planned as §93's first physics scene: gravity, collisions, impulses.
  `physics-playground/` fulfils the role (kept until the owner retires the entry).
- [`mixed-scene/`](mixed-scene/) — **Not yet written; directory is a placeholder.** Planned
  as the mixed 2D/3D/physics/UI example (§93, §97). `physics-playground/` steps a 2D and a
  3D world side by side.
- [`flagship/one-scene-everything-moves/`](flagship/one-scene-everything-moves/) — **Not yet
  written; directory is a placeholder.** Planned as the §118 flagship: rotating cube, 2D
  orbit, pendulum, bouncing body, labels, UI panel, timeline, motorized hinge, collision
  events, pause/slow-motion/step.
- [`flagship/motor-digital-twin/`](flagship/motor-digital-twin/) — **Not yet written;
  directory is a placeholder.** Planned as the §119 engineering flagship: an electric motor
  digital twin — animated rotor, bearing constraints, PID speed control, fault injection,
  waveforms, replay.
