# @four/render

Backend-independent renderer interface and render preparation. Part of [four.js](../../README.md).

Implements the MVP tier of §61–66 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped across Phases 3, 3a, and 9. The logical scene never depends on a concrete backend — backends (`render-webgl`, …) implement the `Renderer` interface defined here.

## What's here

- **`Renderer` (§61)** — the interface every backend implements, with `RendererCapabilities`, `RendererBackend`, resize events (`RendererEventMap`, `ResizeRecord`), and **`NullRenderer`** for headless composition.
- **Render lists** — `buildRenderList` and `buildInterpolatedRenderList` (§43: draws at `interpolationAlpha` between physics poses), producing typed `RenderItem`s (`isUnlitItem` / `isSpriteItem` / `isParticlesItem`).
- **Per-view lists and §87 culling (§64 stages 2–3)** — `buildViewRenderList` derives one viewport's draws from the frame's list by §46's layer mask and an optional `Frustum`, and `computeWorldBoundingSphere` is the world bound it tests. The frame traverses once; a view is a query over what it produced, so §69's shadow map stays frame state no viewport filters.
- **§66's sort keys as verbs** — `groupRenderListByPipeline` (key 3, for §65 batching) and `sortRenderListByDepth` (key 4, opaque near-to-far and blended far-to-near, on a view's own list). Neither is a default: under §61's `LEQUAL` both permute co-planar opaque draws, which is what a 2D scene is made of.
- **`Renderable`** — the geometry + material scene attachment.
- **`Sprite` and `Texture`** — the §55/§77 MVP tier (`TextureSource` accepts what `@four/text`'s glyph atlas emits).
- **Particle contract** — `ParticleDrawable` (duck-typed toward `@four/particles`; the dependency matrix forbids the direct edge), `particleQuadGeometry`, and the stride-8 instance layout constants (`PARTICLE_INSTANCE_FLOATS` and offsets).
- **`Shape2D` and §50's twelve shape nodes** — `Circle`, `Ellipse`, `Rectangle` (rounded or not), `RegularPolygon`, `Polygon`, `Star`, `Sector`, `Ring`, `PathShape`, and the three stroke-only primitives `Line`, `Polyline`, `Arc`. Every one derives and owns its geometry from a §51 `Path`.
- **§58 paints, fills and strokes** — `Paint`/`SolidPaint` at the solid tier, `ShapeFill`, and `StrokeStyle` over §52's `expandStroke`. Solid colours travel as per-vertex colour through the existing unlit pipeline, so a stroked, painted shape is still one draw with no new render-item kind. The **paint-object tier** (2026-08-29, behind `registerShapePaints()`) adds `LinearGradientPaint`, `RadialGradientPaint`, and `PatternPaint` (image _and_ render-target textures): a shape constructed without a `material` derives a §60 `NodeMaterial` that evaluates its paints exactly per fragment, drawn through RFC 0001's `"node"` pipeline — still one geometry, one draw. Conic gradients are refused naming §60's missing angle operator; the anti-alias fringe remains staged (it needs a coverage attribute no §57 pipeline reads).

_Added 2026-08-09 (gaps `R-23`, `R-16`, `R-8`): the sections above listed neither the shape family, the paint model, nor the per-view lists. Paint-object tier added 2026-08-29 (R-16's follow-up)._

## Staged / not yet implemented

- General instancing strategies — instancing is implemented for particles only (`R-22` is the mesh half). §65's consecutive-run batching lives in `RenderBatcher`, opt-in per renderer.
- **Occlusion** culling (§87's second half) and any spatial index: culling here is a linear scan with an O(1) bounding-sphere test per item per view, which is what §87's "the public scene graph must not be forced to mirror a spatial tree" allows a first tier to be. A §36 particle system is never culled, because its item carries the shared instance quad rather than a bound over its live particles.

_Amended 2026-08-09 (`R-8`, `R-9`, `R-6`): this list said "the render graph, culling, sorting, and general batching/instancing strategies" long after the graph, the sort keys and the batcher had landed._

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/render`; publishes as `@danielsimonjr/fourjs-render`.
