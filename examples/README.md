# Examples

Runnable examples planned by the documentation plan (§93) and the flagship demonstrations
(§118–119). Every major feature should have a runnable example (§93).

**Nine examples are implemented** (six until 2026-08-07, when `first-3d-scene` and then
the §118 flagship were written; nine on 2026-08-08, when §119's motor digital twin was
written). The other three entries below are **not yet written; the
directory is a placeholder** — each holds a `.gitkeep` and nothing else. Until 2026-08-05
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
- [`flagship/one-scene-everything-moves/`](flagship/one-scene-everything-moves/) —
  **Implemented (2026-08-07).** §118's flagship, "One Scene, Everything Moves": every item
  on §118's list in one scene, one fixed-step loop and one frame — a textured lit cube spun
  by a `MotionComponent`, a 2D vector orbit, a `SpringJoint` pendulum, a bouncing body whose
  §29 landings fire a particle burst and a re-launch impulse, a motorised `HingeJoint`, two
  world-space labels (one rides the bouncing body), a `@four/ui` panel parented to the
  camera, a §16 `Timeline`, and pause / slow-motion / single-step controls that are
  keyboard-operable. It is also the first example to select its backend _and_ its solver
  through the §62/§37 registries (`renderer: "auto"`, `solver: "auto"`), and the first to
  assemble the §113 debug overlay from `@four/diagnostics` streams.
  Build it with `pnpm run flagship:build`; it carries **both** Rapier wasm images (the cost
  of `registerRapierSolver()`, measured) and is ~1.54 MB gzip. This entry read "**not yet
  written; directory is a placeholder**" until that date.
- [`flagship/motor-digital-twin/`](flagship/motor-digital-twin/) —
  **Implemented (2026-08-08).** §119's engineering flagship, "Electric Motor Digital
  Twin": a motorised shaft on two coaxial bearing `HingeJoint`s inside a stator that
  hangs on a §28 slider-and-spring mount, so a deliberate rotor unbalance produces real
  vibration; a `PIDController` closing the speed loop on the shaft's measured
  `angularVelocity`; two physical faults (a bearing rub driven by a §28 **slider** motor,
  and a supply sag expressed as a derated actuator); a lumped thermal model with a trip;
  two scrolling waveform charts drawn as one `"lines"` draw call; and a §34 record / seek /
  replay audit paired with a §79 save-and-reload that round-trips byte-identically.
  It is the first example to read §84's `app.stats`, the first to use §40's unit-conversion
  helpers (RPM, degrees, millimetres, milliseconds at the display edge only), and the only
  one built in **development** mode, because §84's statistics path is gated on
  `__FOUR_DEV__` (A-4). Build it with `pnpm run twin:build`; it carries **one** Rapier wasm
  image (a directly-constructed `Rapier3dAdapter`) and is ~0.93 MB gzip. This entry read
  "**not yet written; directory is a placeholder**" until that date.
