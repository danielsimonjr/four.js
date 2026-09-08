# @fourjs/materials

Materials and shading. Part of [fourJS](../../README.md).

Implements the MVP tier of §57–60 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phases 3 and 3a.

## What's here

- **`UnlitMaterial`** — flat-color material (`ColorRGBA`, re-exported from `@fourjs/math`); color is read per draw, so in-place tuple animation works.
- **`SpriteMaterial`** — textured-quad material over the `SpriteTexture` contract (§55/§77 MVP tier), used by `@fourjs/render`'s `Sprite`.

## Staged / not yet implemented

- `StandardMaterial` (glTF-compatible metallic-roughness) and lighting — lighting is the one dated staged absence in the §120 MVP audit (owner tier decision pending).
- The node-material shader system (WGSL + GLSL ES generation) and the paints/fills/strokes model.
- §55 texture frame regions — sprites currently map whole textures.

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/materials`; publishes as `@danielsimonjr/fourjs-materials`.
