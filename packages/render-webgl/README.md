# @four/render-webgl

WebGL 2 backend — the MVP renderer (§120). Part of [four.js](../../README.md).

Implements §62 backend 2 of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped across Phases 3, 3a, and 9. Applications select a backend at the edge — nothing in `@four/scene`, `@four/motion`, or `@four/physics` may name anything in this package.

## What's here

- **`WebglRenderer`** — the one public entry point, implementing `@four/render`'s `Renderer`. It draws unlit geometry, textured sprites, and instanced particles (straight-alpha blended, a constant 6 GL calls per frame at any particle count).
- **Testing seams** — `GL`, `WebglContext` (a 33-method structural context interface), `WebglCanvas`, the `UnlitProgram` / `SpriteProgram` / `ParticleProgram` pipelines, and the `GeometryCache` / `TextureCache` / `ParticleBatchCache` resource caches. These are exported so the whole backend can be unit-tested against a hand-rolled fake context with no GPU and no browser (see `tests/webgl-renderer.test.ts`); browser-pixel coverage runs under Playwright with SwiftShader.

## Notes

- Unlit draws currently run with `GL_BLEND` off, so alpha animation on unlit materials is invisible (recorded §60a/blending backlog); particles are the first blended non-sprite pass.
- The `core + math + scene + render-webgl` payload is gated by the §86 budget (≤150 kB gzip; currently ~32 kB).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/render-webgl`; publishes as `@danielsimonjr/fourjs-render-webgl`.
