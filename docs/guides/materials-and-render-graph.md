# Materials and the render graph

This guide covers the material tier that ships today, how a scene becomes
draw calls (render lists, §64–§66), and — honestly — how much of §57's
unified material model and §63's render graph exists yet. Short version: the
MVP tier is unlit colour, textured sprites, instanced particles and — since
the 2026-08-04 lighting packet — one Lambert-lit material on a WebGL 2
backend; PBR, multi-light, shadows and the render graph are staged.

## The shipped materials

Three material classes (`four/materials`) and one instanced path. This section
said "two material classes" and omitted `LitMaterial` until 2026-08-05:

```ts
import { SpriteMaterial, UnlitMaterial } from "four/materials";
import { Renderable, Sprite, Texture } from "four/render";
import { planeGeometry } from "four/geometry";

// Flat colour, straight (non-premultiplied) RGBA in 0..1 (§60a, §66):
const slab = new Renderable(
  planeGeometry({ width: 2, height: 1 }),
  new UnlitMaterial({ color: [0.16, 0.18, 0.24, 1] }),
);

// Recolour in place; setColor announces the change:
slab.material.setColor(0.1, 0.52, 0.45, 1);

// A textured quad. The texture is an RGBA8 buffer you own:
const texture = new Texture({ width: 6, height: 12, data: rgbaBytes });
const badge = new Sprite(new SpriteMaterial({ texture, tint: [1, 1, 1, 1] }), {
  width: 0.5,
  height: 1,
  anchor: { x: 0, y: 0 },
  renderLayer: 1, // draw after opaque shapes — sprites blend (§66)
});
```

`LitMaterial` is the third: colour-only, mirroring `UnlitMaterial`, shaded by
one `DirectionalLight` (a `@four/scene` node) plus `Scene.ambientLight`. It
needs geometry carrying the optional `normals` attribute — `boxGeometry` and
`planeGeometry` generate per-face normals; 2D shapes stay unlit and
position-only.

Particles use `ParticleRenderable` (see the
[performance guide](performance-optimization.md)); geometry comes from
`four/geometry`'s `boxGeometry`, `planeGeometry`, and `circleGeometry2D`.

Facts of this tier worth knowing before you fight them:

- **Blending is enabled for sprites and particles only.** An unlit material's
  alpha never reaches a blend equation, so animating it is invisible; the
  examples fake translucency with hue and depth instead (finding WP-4.7,
  §60a backlog).
- **Unlit colour is read per draw** — an in-place tuple edit is picked up next
  frame without touching `material.version`.
- **Sprites map the whole texture across the whole quad.** §55's `frame`
  sub-rectangle has not landed, so drawing one cell of an atlas means cutting
  the cell into its own small `Texture` (the documented text workaround in
  `examples/first-2d-scene` and `examples/ui-demo`).

## From scene to draw calls (§64–§66)

There is no retained display list to manage. Each frame the renderer walks
the scene into a sorted **render list**:

```ts
import { buildInterpolatedRenderList, buildRenderList } from "four/render";

const list = buildRenderList(scene, []); // live transforms
buildInterpolatedRenderList(scene, poses, alpha, list); // §43 render poses
```

Items sort by **`renderLayer`, then `renderOrder`, and nothing else** —
`compareRenderItems` in `packages/render/src/render-list.ts` is those two keys,
and because `Array.prototype.sort` is stable, equal keys fall back to
generation (scene-graph) order. That is the whole of the transparency ordering
control this tier offers (§66), and it is manual: **the list is not sorted by
kind and not sorted by material**, so an opaque item can be drawn after a
blended one unless you separate them with a layer or an order yourself. This
paragraph claimed a sort "by render layer, then kind (opaque unlit first, then
blended sprites, then particles), then material" until 2026-08-05; no such
comparator has ever existed. The backend does track the _current_ pipeline and
only re-binds a program when the kind changes, which is a per-run
state-change saving on an already-ordered list — not a sort. The WebGL 2
backend (`WebglRenderer`, in
`four/render-webgl`) consumes the list with cached GPU resources
(`GeometryCache`, `TextureCache`) keyed by object identity and version; a
particle item becomes exactly one `drawArraysInstanced` whatever its count.

`Renderer` (§61) is the backend-independent interface; `NullRenderer` is the
headless implementation the determinism suites use. The application drives
whichever instance you construct and hand to it — `four` never imports a
backend at runtime.

## Honest state of the rest

| §       | feature                            | state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §57–§59 | unified material model, PBR        | not implemented; `UnlitMaterial`, `SpriteMaterial` and `LitMaterial` are the shipped tier (this row omitted `LitMaterial` until 2026-08-05)                                                                                                                                                                                                                                                                                                                                                   |
| §60     | shader & node-material system      | not implemented — see [custom shaders](custom-shaders.md)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| §62     | backends                           | WebGL 2 shipped; `render-webgpu`, `render-canvas`, `render-svg` are scaffold-only packages                                                                                                                                                                                                                                                                                                                                                                                                    |
| §63     | render graph                       | **shipped at the linear-pass tier 2026-08-07** (`RenderGraph` in `@four/render`: named passes over R-4's target seam, declared `inputs` + discovered sampled-target validation, enable/disable, per-pass viewports, textual `describe()`). Transient targets, resource lifetimes, and barriers are staged with dated reasons in the module header. This row said "not implemented; the fixed pipeline is list → sort → draw" until 2026-08-07; the fixed pipeline is still what one pass runs |
| §65     | batching                           | particles are instanced (one `drawArraysInstanced` per system); **nothing else is batched or instanced** — sprites, glyphs and meshes are one draw call each (the §55 frame-region + §65 backlog). This row said "particles and instancing yes" until 2026-08-05, which read as general instancing support                                                                                                                                                                                    |
| §68–§70 | lighting, shadows, post-processing | lighting **shipped at an MVP tier 2026-08-04** — one directional light plus a scene ambient, Lambert, via `LitMaterial`/`LitProgram`. Shadows (§69) and post-processing (§70) are not implemented. This row said lighting was "**not implemented** — the one §120 MVP item recorded as a dated staged absence (2026-08-02); materials are unlit everywhere" until 2026-08-05; see `docs/AUDIT-120.md` S-5 for what is still staged                                                            |

When these land they are required to slot beneath the same `Renderer`
interface and render-list contract, so scene code written against today's
tier does not change.

## Practical guidance

- Author colours as straight-alpha RGBA in 0…1 and keep a palette: with no
  lighting and no blending on shapes, **hue is your only material channel**,
  and the examples' colour-discipline notes exist because tests read hue.
- Overlap is resolved by depth: push scenery behind bodies (negative Z) and
  marks in front, rather than relying on draw order.
- One material instance per logical surface; share materials across nodes
  that recolour together (the glyph cache in `examples/ui-demo` shares one
  material per distinct glyph cell).

## Cross-references

- §55, §57, §60a, §61–§66 — the normative text.
- `examples/first-2d-scene` (sprites + text), `examples/ui-demo` (skins over
  unlit quads), `examples/particles-demo` (instanced batching).
