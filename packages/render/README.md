# @four/render

Backend-independent renderer interface and render preparation. Part of [four.js](../../README.md).

Implements the MVP tier of §61–66 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped across Phases 3, 3a, and 9. The logical scene never depends on a concrete backend — backends (`render-webgl`, …) implement the `Renderer` interface defined here.

## What's here

- **`Renderer` (§61)** — the interface every backend implements, with `RendererCapabilities`, `RendererBackend`, resize events (`RendererEventMap`, `ResizeRecord`), and **`NullRenderer`** for headless composition.
- **Render lists** — `buildRenderList` and `buildInterpolatedRenderList` (§43: draws at `interpolationAlpha` between physics poses), producing typed `RenderItem`s (`isUnlitItem` / `isSpriteItem` / `isParticlesItem`).
- **`Renderable`** — the geometry + material scene attachment.
- **`Sprite` and `Texture`** — the §55/§77 MVP tier (`TextureSource` accepts what `@four/text`'s glyph atlas emits).
- **Particle contract** — `ParticleDrawable` (duck-typed toward `@four/particles`; the dependency matrix forbids the direct edge), `particleQuadGeometry`, and the stride-8 instance layout constants (`PARTICLE_INSTANCE_FLOATS` and offsets).

## Staged / not yet implemented

- The render graph (DAG of passes), culling, sorting, and general batching/instancing strategies — the MVP pipeline is traversal → render items → submission, with instancing implemented for particles only.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/render`; publishes as `@danielsimonjr/fourjs-render`.
