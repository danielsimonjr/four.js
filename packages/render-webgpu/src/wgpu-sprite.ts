/**
 * The sprite pipeline in hand-written WGSL (§55, WP-R1.3), plus the widened
 * uniform block a sprite draw reads.
 *
 * This is the WGSL port of `gl-program.ts`'s `SpriteProgram`, and like the
 * unlit port it is a *translation*: the same quad-uniform uv derivation
 * (`uv = (position.xy − quad.xy) / quad.zw`), the same `texture × tint`
 * fragment product, the same §55 always-blend policy (applied by the renderer's
 * pipeline descriptor, since blending is pipeline state here). §65's *batched*
 * sprites do not come through this module at all — a batch carries uv per
 * vertex and draws through the unlit shader family (`wgpu-batch.ts`), exactly
 * as the GL backend draws its batches through `UnlitProgram`.
 *
 * ## Why sprites get their own bind-group layout at group 0
 *
 * A sprite draw needs one more `vec4` than `DrawUniforms` carries — §55's
 * `quad`, the local rectangle the whole texture maps onto, which is per-draw
 * state exactly as the model matrix is. The obvious move — widening
 * `DrawUniforms` itself — was rejected for a byte-transcript reason:
 * `minBindingSize` appears in the `createBindGroupLayout` call every
 * application records at initialization, so widening the shared block would
 * move the transcript of every scene, sprites or not. `wgpu-bindings.ts`'s own
 * header promises that group 0's layout does not move.
 *
 * So sprites declare a **second group-0 layout** over the *same* uniform
 * buffer: the same 256-byte-strided blocks, the same dynamic offset per draw,
 * a binding size of {@link SPRITE_UNIFORM_BYTES} instead of 144. The layout
 * and its bind group are created lazily by the first sprite draw — the WP-R1.2
 * precedent, where group 1 is created by the first textured upload — so an
 * application that draws no sprites records the identical WP-R1.1/R1.2
 * transcript, byte for byte. The 112 spare bytes of every stride were already
 * allocated; a sprite block simply reads 16 more of them.
 *
 * ## The texture rides group 1 unchanged
 *
 * §55's texture binds through the same `createTextureBindGroupLayout` group the
 * unlit `map` variant uses, from the same `WgpuTextureCache` record — one
 * layout, one sampler-dedup policy, one upload path for both pipelines.
 */

import {
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuDevice,
} from "./webgpu-device.js";
import { MAP_BINDING_WGSL } from "./wgpu-bindings.js";
import { FRAGMENT_ENTRY_POINT, VERTEX_ENTRY_POINT } from "./wgpu-unlit.js";

/** Byte offset of `SpriteUniforms.viewProjection` — shared with `DrawUniforms`. */
export const SPRITE_VIEW_PROJECTION_OFFSET = 0;

/** Byte offset of `SpriteUniforms.model` — shared with `DrawUniforms`. */
export const SPRITE_MODEL_OFFSET = 64;

/** Byte offset of `SpriteUniforms.tint` — `DrawUniforms.color`'s slot, renamed. */
export const SPRITE_TINT_OFFSET = 128;

/**
 * Byte offset of `SpriteUniforms.quad` — the one member `DrawUniforms` does not
 * have, in the bytes immediately after it.
 */
export const SPRITE_QUAD_OFFSET = 144;

/**
 * Size of the `SpriteUniforms` block in bytes.
 *
 * The binding size, not the 256-byte stride — `DRAW_UNIFORM_BYTES`'s
 * distinction, restated because it matters twice here: both bindings read the
 * same strided buffer, and only the *sizes* differ.
 */
export const SPRITE_UNIFORM_BYTES = 160;

/**
 * The sprite draw's group-0 layout: binding 0, a dynamically-offset uniform
 * buffer of {@link SPRITE_UNIFORM_BYTES}, visible to both stages (the vertex
 * stage reads the matrices and the quad, the fragment stage reads the tint).
 *
 * Created lazily by the renderer's first sprite draw — see the module header
 * for why this is a second layout rather than a widened `DrawUniforms`.
 */
export function createSpriteBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "four:sprite-uniforms",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: SPRITE_UNIFORM_BYTES,
        },
      },
    ],
  });
}

/**
 * The WGSL declaration of the block above — `DRAW_UNIFORM_WGSL`'s discipline:
 * the layout the pipeline declares and the layout the shader reads live side by
 * side in one module, so they cannot drift.
 */
export const SPRITE_UNIFORM_WGSL = `struct SpriteUniforms {
  viewProjection : mat4x4<f32>,
  model : mat4x4<f32>,
  tint : vec4<f32>,
  quad : vec4<f32>,
};

@group(0) @binding(0) var<uniform> draw : SpriteUniforms;`;

/**
 * The sprite WGSL module.
 *
 * One variant — a sprite always samples and never carries per-vertex colour
 * (§55; `batch.ts` records the same two facts as planner invariants) — so
 * unlike `unlitShaderSource` this is a constant. The vertex stage derives uv
 * from the local position and the quad uniform, which is what lets one shared
 * unit-quad geometry serve every sprite and every §55 frame without a uv
 * buffer: `quad` is the rectangle the *whole* texture maps onto, so a framed
 * sprite's larger, offset quad lands the frame's sub-rectangle on the
 * geometry — R-29's affine reparametrization, evaluated per vertex exactly as
 * the GL sprite vertex stage evaluates it.
 *
 * The depth remap is `wgpu-unlit.ts`'s, applied here for the same reason and
 * with the same one multiply-add.
 */
export const SPRITE_SHADER_SOURCE = `${SPRITE_UNIFORM_WGSL}

${MAP_BINDING_WGSL}

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn ${VERTEX_ENTRY_POINT}(@location(0) position : vec3<f32>) -> VertexOutput {
  var output : VertexOutput;
  let clip = draw.viewProjection * draw.model * vec4<f32>(position, 1.0);
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see wgpu-unlit.ts.
  output.position = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
  output.uv = vec2<f32>(
    (position.x - draw.quad.x) / draw.quad.z,
    (position.y - draw.quad.y) / draw.quad.w,
  );
  return output;
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : VertexOutput) -> @location(0) vec4<f32> {
  return textureSample(mapTexture, mapSampler, input.uv) * draw.tint;
}
`;
