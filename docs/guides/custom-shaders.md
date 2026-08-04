# Custom shaders

§60 specifies a shader and node-material system: custom shader chunks, a
node-based material graph, and safe shader/plugin boundaries (§96). This
guide's first job is to be honest about its state.

## Honest state

**There is no custom shader API yet.** Nothing in the shipped surface accepts
user GLSL/WGSL: §60's shader system, §59's PBR materials, and §63's render
graph are all unimplemented, and no packet in the completed Phase 0–11 plan
scheduled them. The shaders that exist are three fixed, internal programs in
`@four/render-webgl` — `UnlitProgram`, `SpriteProgram`, and
`ParticleProgram` — compiled from embedded sources. They are exported for the
backend's own composition and tests, **not** as an extension point: their
GLSL is not part of the public contract and may change without notice.

What this means practically:

- You cannot write a custom material for the WebGL backend today.
- Post-processing (§70), lighting models (§68), and node materials (§60) are
  all downstream of the same missing seam.
- When §60 lands it must respect §96 (no arbitrary code execution from scene
  files; safe shader boundaries), so expect a declarative surface rather than
  raw string injection.

## The seam that does exist: the renderer

The extension point that _is_ public and stable is one level up: the §61
`Renderer` interface. The application drives whatever instance you construct
— `four` never imports a backend — so a custom backend (or an instrumented
wrapper around one) is ordinary application code. That is how the engine's
own tiers are built: `WebglRenderer` and the headless `NullRenderer` are
peers behind one interface.

A useful, real thing you can build today with that seam plus the public
render-list functions: a draw-call auditor that tells you what a frame would
submit, without touching a GPU.

```ts
// audit-draws.ts — runs headless under Node: no canvas, no GL.
import { boxGeometry, planeGeometry } from "four/geometry";
import { UnlitMaterial } from "four/materials";
import {
  buildRenderList,
  isParticlesItem,
  isSpriteItem,
  isUnlitItem,
  Renderable,
  type RenderItem,
} from "four/render";
import { Group, Scene } from "four/scene";

const scene = new Scene();
const assembly = new Group();
assembly.add(
  new Renderable(
    planeGeometry({ width: 2, height: 1 }),
    new UnlitMaterial({ color: [0.2, 0.3, 0.5, 1] }),
  ),
);
assembly.add(
  new Renderable(
    boxGeometry({ width: 1, height: 1, depth: 1 }),
    new UnlitMaterial({ color: [1, 0.5, 0.2, 1] }),
  ),
);
scene.add(assembly);

// The same sorted list the WebGL backend consumes (§64–§66):
const list: RenderItem[] = [];
buildRenderList(scene, list);

let unlit = 0;
let sprites = 0;
let particleBatches = 0;
for (const item of list) {
  if (isUnlitItem(item)) unlit += 1;
  else if (isSpriteItem(item)) sprites += 1;
  else if (isParticlesItem(item)) particleBatches += 1;
}
console.log({ items: list.length, unlit, sprites, particleBatches });
// { items: 2, unlit: 2, sprites: 0, particleBatches: 0 }
```

Because the list's sort order (layer → kind → material) is the contract the
backends implement, auditing it is auditing your frame: every unlit item is
one draw, every sprite is one draw (until §65 batching lands), every
particle item is one instanced draw.

## What to do instead of a custom shader, today

- **Colour and texture are the channels you have.** `UnlitMaterial` colour,
  `SpriteMaterial` texture + tint, and per-particle colour ramps cover the
  shipped examples' entire visual range — see the
  [materials guide](materials-and-render-graph.md) for the discipline.
- **Procedural textures** are ordinary `Texture` objects over a
  `Uint8Array` you compute — the text stack builds its glyph atlas exactly
  this way (`buildGlyphAtlas` in `four/text`).
- **Animate materials**, not shaders: tweens drive material colour in place
  (§17's color kind), which is how the examples pulse and flash.
- If you genuinely need custom GPU work now, the honest options are: render
  four.js into one canvas and composite your own WebGL on top; or implement
  the §61 `Renderer` interface yourself against the render-list contract.
  Both are real work; neither fights the engine.

## When it lands

The §60 design obligations already recorded: chunks must compose with the
§57 unified material model, degrade across §62 capability tiers, respect
§60a colour management, and pass §96's safety review. Watch `docs/rfcs/` —
a shader-system RFC is the expected route, as it was for text shaping.

## Cross-references

- §60 (shader system), §60a (color management), §61 (renderer interface),
  §64–§66 (submission and ordering), §96 (security boundaries).
- `packages/render-webgl/src` — the three internal programs, for the
  curious; `packages/render/src/render-list.ts` — the contract a backend
  consumes.
