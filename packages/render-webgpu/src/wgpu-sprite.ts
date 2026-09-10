/**
 * The sprite pipeline in hand-written WGSL (§55, WP-R1.3), plus the uniform
 * block a sprite draw reads.
 *
 * This is the WGSL port of `gl-program.ts`'s `SpriteProgram`: the same
 * `texture × tint` fragment product, the same §55 always-blend policy
 * (applied by the renderer's pipeline descriptor). Atlas UVs are an authored
 * vertex attribute at `@location(2)` — the unlit `map` stream — not a `quad`
 * uniform. §65's *batched* sprites do not come through this module at all —
 * a batch already interleaves those uvs and draws through the unlit shader
 * family (`wgpu-batch.ts`).
 *
 * ## Why sprites still have their own bind-group layout at group 0
 *
 * A sprite draw used to need one more `vec4` than `DrawUniforms` carried —
 * §55's `quad`. That member is gone (the atlas packet), so the sprite block
 * is the 144-byte prefix (`viewProjection`, `model`, `tint` in `color`'s
 * slot). `DrawUniforms` continues with `normalMatrix` (192 bytes); sprites
 * do not bind that tail. The **second group-0 layout** stays: `minBindingSize`
 * appears in the `createBindGroupLayout` call every application records at
 * initialization, and sharing the unlit layout would move the spriteless
 * transcript. The layout and its bind group are still created lazily by the
 * first sprite draw, so an application that draws no sprites records the
 * identical WP-R1.1/R1.2 transcript.
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
import {
  FRAGMENT_ENTRY_POINT,
  UV_SHADER_LOCATION,
  VERTEX_ENTRY_POINT,
} from "./wgpu-unlit.js";

/** Byte offset of `SpriteUniforms.viewProjection` — shared with `DrawUniforms`. */
export const SPRITE_VIEW_PROJECTION_OFFSET = 0;

/** Byte offset of `SpriteUniforms.model` — shared with `DrawUniforms`. */
export const SPRITE_MODEL_OFFSET = 64;

/** Byte offset of `SpriteUniforms.tint` — `DrawUniforms.color`'s slot, renamed. */
export const SPRITE_TINT_OFFSET = 128;

/**
 * Size of the `SpriteUniforms` block in bytes — `viewProjection`, `model`,
 * `tint`. Stays 144 after `DRAW_UNIFORM_BYTES` widened for `normalMatrix`;
 * the retired `quad` member is what used to make this 160.
 *
 * The binding size, not the 256-byte stride — `DRAW_UNIFORM_BYTES`'s
 * distinction, restated because both bindings still read the same strided
 * buffer and only the *sizes* are declared here.
 */
export const SPRITE_UNIFORM_BYTES = 144;

/**
 * The sprite draw's group-0 layout: binding 0, a dynamically-offset uniform
 * buffer of {@link SPRITE_UNIFORM_BYTES}, visible to both stages (the vertex
 * stage reads the matrices, the fragment stage reads the tint).
 *
 * Created lazily by the renderer's first sprite draw — see the module header
 * for why this is a second layout rather than the unlit `DrawUniforms` one.
 */
export function createSpriteBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "fourJS:sprite-uniforms",
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
};

@group(0) @binding(0) var<uniform> draw : SpriteUniforms;`;

/**
 * The sprite WGSL module.
 *
 * One variant — a sprite always samples and never carries per-vertex colour
 * (§55; `batch.ts` records the same two facts as planner invariants) — so
 * unlike `unlitShaderSource` this is a constant. The vertex stage reads the
 * authored uv stream at {@link UV_SHADER_LOCATION}; `Sprite.frame` writes
 * those values onto the geometry.
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
fn ${VERTEX_ENTRY_POINT}(
  @location(0) position : vec3<f32>,
  @location(${String(UV_SHADER_LOCATION)}) uv : vec2<f32>,
) -> VertexOutput {
  var output : VertexOutput;
  let clip = draw.viewProjection * draw.model * vec4<f32>(position, 1.0);
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see wgpu-unlit.ts.
  output.position = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
  output.uv = uv;
  return output;
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : VertexOutput) -> @location(0) vec4<f32> {
  return textureSample(mapTexture, mapSampler, input.uv) * draw.tint;
}
`;
