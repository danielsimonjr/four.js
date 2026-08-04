# @four/particles

Particle systems — deterministic CPU simulation with force fields. Part of [four.js](../../README.md).

Implements §27 and §36 of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 9 (§112). Simulation is seeded and deterministic: emitters burn a fixed `PARTICLE_DRAWS_PER_SPAWN` RNG draws per spawn slot, so the stream is a function of history.

## What's here

- **`ParticleEmitter`** — spawn rate, bursts (`ParticleBurst`), ranges/ramps (`ParticleRange`, `ParticleLifetimeRamp`), seeded via `SeededRandom` (re-exported from `@four/core`).
- **`ParticlePool`** — structure-of-arrays `Float32Array` storage with swap-remove; capacity is part of the deterministic contract.
- **Force fields (§27)** — factories `uniformGravityField`, `dragField`, `windField`, `radialField` (inverse-square), `vortexField`, `turbulenceField` (bounded hash-noise curl; honestly _not_ divergence-free), and `volumeField` over box/sphere volumes.
- **`ParticleSystem`** — the fixed-step system (`PRIORITY_PARTICLES` = 500) advancing emitters and fields.
- **`ParticleRenderable`** — bridges to `@four/render`'s instanced particle path (`PARTICLE_INSTANCE_FLOATS` stride-8 interleaved instances; the `ParticleDrawable` contract is deliberately duck-typed — the dependency matrix forbids the edge).

100k particles + 3 fields measured at ~16.5 ms/step on CI hardware (recorded benchmark, not a 60 fps claim).

## Staged / not yet implemented

- GPU compute simulation, particle-vs-physics collision, and trails.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/particles`; publishes as `@danielsimonjr/fourjs-particles`.
