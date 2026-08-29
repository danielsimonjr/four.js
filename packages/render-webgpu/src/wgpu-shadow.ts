/**
 * §69's shadow tier on WebGPU (WP-R1.7): the depth-only caster module, the
 * widened light block that carries the shadow matrix and biases, the
 * comparison-sampler bindings, and the receiver-side WGSL chunk the shaded
 * families splice in.
 *
 * This is the WGSL port of `gl-shadow.ts` plus the shadow half of
 * `gl-program.ts` (`SHADOW_GLSL`, `ShadowUniforms`), and the same single tier
 * ships: one directional light's map, rendered depth-only and sampled back
 * with a 3×3 percentage-closer filter. `@four/scene`'s
 * `DirectionalLightShadow` owns the list of what is staged; this module owns
 * how the shipped tier becomes WebGPU.
 *
 * ## The layout is structurally different from GL's, and declared as data
 *
 * GL binds the map to a numbered texture unit (`SHADOW_TEXTURE_UNIT`) and
 * samples it as a plain `sampler2D`. WebGPU has no units, and a depth
 * comparison is a **distinct binding type**: `texture_depth_2d` plus
 * `sampler_comparison`, neither of which the `map` layout
 * (`createTextureBindGroupLayout`) can describe — a `float`-sampled,
 * `filtering` pair is API-invalid for a depth comparison. So the shadow gets
 * its own layout, and it joins the **lights group** rather than claiming a
 * group of its own: {@link createShadowLightsBindGroupLayout} is a widened
 * twin of `createLightsBindGroupLayout` — the same dynamically-offset uniform
 * buffer at binding 0, now {@link SHADOW_LIGHT_UNIFORM_BYTES} long, plus the
 * map at {@link SHADOW_MAP_BINDING} and the comparison sampler at
 * {@link SHADOW_SAMPLER_BINDING}. A shadow map is per-frame state and the
 * light block is per-view state, so the pairing is lifetime-correct, it keeps
 * §57's `map` at its landed group index for every variant, and it stays
 * inside WebGPU's four-group guarantee.
 *
 * The uniform widening itself is the sprite/standard move one group over: the
 * shadow matrix and parameters ride the **spare stride bytes** the light
 * buffer already allocates (`LIGHT_UNIFORM_STRIDE_BYTES` 768 against
 * `LIGHT_UNIFORM_BYTES` 592), so no landed layout, binding size, or transcript
 * moves — a draw that receives no shadow still binds the narrow block through
 * the landed layout, and a shadowless scene records not one of these objects.
 *
 * ## `useShadow` becomes a lazy variant, not a uniform
 *
 * GL folds "is this draw shadowed" into a `bool` uniform mirrored at its
 * initial `false`. Here it is pipeline identity — the R-19 inversion, fifth
 * application: the shaded WGSL builders take a `shadow` flag, the pipeline
 * key appends `|sh:y` **only when the draw receives** (`§49 receiveShadow` ∧
 * the frame produced a map), and a non-receiver inside a shadowed frame draws
 * through the very pipeline a shadowless frame compiled — one object, one
 * key, byte-identical to what WP-R1.5 landed. The R1.5 statement "the shaded
 * stages are GL-with-`useShadow`-false, verbatim" is now the *unshadowed
 * variant's* description; the shadowed variant is GL-with-`useShadow`-true,
 * operation for operation.
 *
 * ## The comparison is GL's arithmetic, tap for tap
 *
 * GL deliberately uses a plain `NEAREST` sampler and nine explicit
 * `receiver <= occluder` comparisons, so the filter is arithmetic the engine
 * can state (§33). The WGSL port keeps every tap and the `/9`:
 * `textureSampleCompareLevel` with a **nearest, `less-equal`** comparison
 * sampler is exactly one single-texel `receiver <= occluder` per call — the
 * hardware evaluates the comparison, never a wider filter — and the `Level`
 * form samples mip 0 without implicit derivatives, so the call is legal
 * inside the non-uniform `len > 0` guard where GL also evaluates it
 * (`textureSampleCompare` would trip WGSL's derivative-uniformity analysis
 * there). The four recorded `SHADOW_GLSL` decisions carry over verbatim:
 * outside the volume is lit, the perspective divide stays although the tier's
 * projection is orthographic, `shadowBias` is subtracted from the receiver,
 * and the normal bias offsets the sample **position** in world space.
 *
 * One line is new, and it is the two-backends line: the receiver's `v`
 * coordinate is `0.5 - ndc.y * 0.5`, not GL's `ndc.y * 0.5 + 0.5`, because
 * this backend's caster pass rasterises with WebGPU's top-left framebuffer
 * origin — the same flip `webgpu-renderer.ts` applies to §48 rectangles,
 * applied to the map's texture space. Depth needs no counterpart: the caster
 * vertex stage applies the standard §3.3.8 remap, which lands the stored
 * depth on GL's `[0, 1]` window convention exactly.
 *
 * ## The caster pass borrows nothing — the mirror-state discipline evaporates
 *
 * GL's `#renderShadowMap` borrows the framebuffer binding, both rectangles
 * and the current program, and its caller owes a re-bind — four pieces of
 * ambient state a throw could leak. Here the caster pass is **its own render
 * pass**: viewport, scissor and stencil reference reset to pass defaults, no
 * mirror consulted, nothing to restore, and a throw simply never submits.
 * §67's clips stay out for R-23's structural reason, now stronger: the map's
 * `depth32float` attachment (the R1.6 format-table row) *cannot* carry
 * stencil planes, so a clipped surface casts its whole shadow — the §69
 * analogue of a sprite casting its rectangle.
 *
 * ## Who casts (the GL exclusions, restated for this backend's tiers)
 *
 * The pass draws the frame's own render list filtered to `castShadow` items
 * of the kinds this backend draws — `unlit`, `lit`, `standard`. Sprites are
 * excluded (a depth-only pass would cast the §55 rectangle, not the texture);
 * particles carry `castShadow: false` from the list builder; masks likewise.
 * The two GL exclusions with a WebGPU twist: skinned and `node` items are
 * excluded here **by absence** — this backend has no pipeline for either
 * surface (WP-R1.4's pinned transcript-invisibility; RFC 0001's emitter is
 * staged), and an invisible surface must not cast, so the caster filter is
 * simply "what this backend draws". GL's finer rule (an *undisplaced* node
 * caster casts exactly) becomes reachable only when the WGSL emitter lands
 * the node tier itself.
 */

import type { SceneLights } from "@four/render";

import {
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuDevice,
  type GpuSampler,
} from "./webgpu-device.js";
import { DRAW_UNIFORM_WGSL } from "./wgpu-bindings.js";
import {
  LIGHTS_BIND_GROUP_INDEX,
  LIGHT_UNIFORM_BYTES,
  LIGHT_UNIFORM_MEMBERS_WGSL,
  LIGHT_UNIFORM_STRIDE_BYTES,
} from "./wgpu-lights.js";
import {
  FRAGMENT_ENTRY_POINT,
  POSITION_SHADER_LOCATION,
  VERTEX_ENTRY_POINT,
} from "./wgpu-unlit.js";

/**
 * Byte offset of `ShadowLightUniforms.shadowMatrix` — the first spare stride
 * byte after the landed block, which is already the 16-byte alignment a
 * `mat4x4<f32>` member demands (592 = 37 × 16).
 */
export const SHADOW_MATRIX_OFFSET = LIGHT_UNIFORM_BYTES;

/**
 * Byte offset of `ShadowLightUniforms.shadowParams`:
 * `x` = `shadowBias`, `y` = `shadowNormalBias`, `z` = the PCF tap offset
 * `1 / shadowMapSize` (computed once per view on the CPU, as GL computes it
 * once per frame), `w` unused, written 0.
 */
export const SHADOW_PARAMS_OFFSET = SHADOW_MATRIX_OFFSET + 64;

/**
 * Size of one `ShadowLightUniforms` block in bytes — the widened binding
 * size, still inside the landed 768-byte stride, so the shadow rides
 * allocation the light buffer already made.
 */
export const SHADOW_LIGHT_UNIFORM_BYTES = SHADOW_PARAMS_OFFSET + 16;

/** `@binding(1)` of the shadow-lights group — the `texture_depth_2d` map. */
export const SHADOW_MAP_BINDING = 1;

/** `@binding(2)` of the shadow-lights group — the `sampler_comparison`. */
export const SHADOW_SAMPLER_BINDING = 2;

/**
 * The shadowed shaded families' group-1 layout: the widened light block plus
 * the two comparison bindings — see the module header for why this is a
 * second lights layout rather than a widened `createLightsBindGroupLayout`
 * or a fourth group.
 *
 * All three entries are **fragment-only** for the landed layouts' reason: no
 * vertex stage in this package reads a light or samples a shadow. Created
 * lazily by the renderer's first shadowed draw — the WP-R1.2 precedent — so
 * a shadowless application records none of it.
 */
export function createShadowLightsBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "four:shadow-lights",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: SHADOW_LIGHT_UNIFORM_BYTES,
        },
      },
      {
        binding: SHADOW_MAP_BINDING,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        texture: { sampleType: "depth", viewDimension: "2d" },
      },
      {
        binding: SHADOW_SAMPLER_BINDING,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        sampler: { type: "comparison" },
      },
    ],
  });
}

/**
 * The one comparison sampler every shadowed draw shares: `less-equal` —
 * GL's `receiver <= occluder`, evaluated by the sampler — over a **nearest**,
 * clamped tap, so each `textureSampleCompareLevel` is exactly one texel's
 * comparison and the 3×3 filter stays the explicit arithmetic `SHADOW_GLSL`
 * records (§33). Created by the first shadowed draw, beside the layout.
 */
export function createShadowSampler(device: GpuDevice): GpuSampler {
  return device.createSampler({
    label: "four:shadow-sampler",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    magFilter: "nearest",
    minFilter: "nearest",
    mipmapFilter: "nearest",
    compare: "less-equal",
  });
}

/**
 * The widened light block and the two comparison bindings, as WGSL — spliced
 * into the shadowed shaded variants **in place of** `LIGHT_UNIFORM_WGSL`.
 *
 * The variable is named `lights`, like the narrow block's, so the punctual
 * chunk and both fragment bodies splice in unchanged; the first
 * {@link LIGHT_UNIFORM_BYTES} bytes are `LIGHT_UNIFORM_MEMBERS_WGSL`
 * verbatim, so the two structs cannot disagree about where a light lives.
 */
export const SHADOW_LIGHT_UNIFORM_WGSL = `struct ShadowLightUniforms {
${LIGHT_UNIFORM_MEMBERS_WGSL}
  shadowMatrix : mat4x4<f32>,
  shadowParams : vec4<f32>,
};

@group(${String(LIGHTS_BIND_GROUP_INDEX)}) @binding(0) var<uniform> lights : ShadowLightUniforms;
@group(${String(LIGHTS_BIND_GROUP_INDEX)}) @binding(${String(SHADOW_MAP_BINDING)}) var shadowMap : texture_depth_2d;
@group(${String(LIGHTS_BIND_GROUP_INDEX)}) @binding(${String(SHADOW_SAMPLER_BINDING)}) var shadowSampler : sampler_comparison;`;

/**
 * The receiver-side factor — `SHADOW_GLSL`'s `shadowFactor`, tap for tap;
 * the module header walks the two deliberate differences (the `v` flip, the
 * comparison evaluated by the sampler instead of in the loop body).
 */
export const SHADOW_FACTOR_WGSL = `fn shadowFactor(worldPosition : vec3<f32>, n : vec3<f32>) -> f32 {
  let lightSpace = lights.shadowMatrix * vec4<f32>(worldPosition + n * lights.shadowParams.y, 1.0);
  let ndc = lightSpace.xyz / lightSpace.w;
  // x and depth map [-1, 1] onto [0, 1]; v flips for the top-left map origin.
  let c = vec3<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z * 0.5 + 0.5);
  if (any(c < vec3<f32>(0.0)) || any(c > vec3<f32>(1.0))) {
    return 1.0;
  }
  let receiver = c.z - lights.shadowParams.x;
  var lit = 0.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let tap = c.xy + vec2<f32>(f32(x), f32(y)) * lights.shadowParams.z;
      lit = lit + textureSampleCompareLevel(shadowMap, shadowSampler, tap, receiver);
    }
  }
  return lit / 9.0;
}`;

/**
 * The depth-only caster module — `gl-shadow.ts`'s two stages, ported.
 *
 * The vertex stage transforms through `model` then `viewProjection` in the
 * exact association `shadedVertexStageWgsl` uses, with the same §3.3.8 depth
 * remap on the way out — a caster and its own on-screen draw then agree with
 * the receiver's `shadowMatrix * world` arithmetic, which is one fewer source
 * of disagreement between the depth a receiver computes and the depth the map
 * holds. `draw.viewProjection` carries the light's matrix
 * (`SceneLights.shadowMatrix`); the block is the ordinary strided
 * `DrawUniforms`, so the caster pass needs no layout of its own.
 *
 * The fragment stage writes constant opaque white for `gl-shadow.ts`'s
 * reason, one shade stronger here: WebGPU requires a fragment output for
 * every colour attachment the pass carries, and the shadow target's cache row
 * (R1.6) always allocates one — so the constant is both the defined-behaviour
 * answer and a debug view of the map that shows a silhouette. `draw.color` is
 * never read; the renderer packs the canonical zero block, like a mask's.
 */
export const SHADOW_SHADER_SOURCE = `${DRAW_UNIFORM_WGSL}

@vertex
fn ${VERTEX_ENTRY_POINT}(
  @location(${String(POSITION_SHADER_LOCATION)}) position : vec3<f32>,
) -> @builtin(position) vec4<f32> {
  let world = draw.model * vec4<f32>(position, 1.0);
  let clip = draw.viewProjection * world;
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see wgpu-unlit.ts.
  return vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;

/**
 * Packs one view's shadow tail — the 80 bytes after the landed block — into
 * `staging` at `floatBase`, `writeLightUniforms`' contract continued: every
 * float is written on every shaded view, **zeros when no light casts**, so
 * the uploaded stride is a function of this frame's `SceneLights` alone and a
 * frame that stops casting cannot leak the previous frame's matrix into its
 * transcript (§33). Zeros are also what a fresh staging array holds, which is
 * what keeps every landed shadowless upload byte-identical.
 *
 * When a light casts, the values are `ShadowUniforms.uploadView`'s, member
 * for member; the tap offset divides here once per view — `mapSize` is a
 * positive integer whenever `hasShadow` is true (`lights.ts` refuses
 * anything else), so the division cannot be by zero on the path that
 * reaches it.
 */
export function writeShadowUniforms(
  staging: Float32Array,
  floatBase: number,
  lights: SceneLights,
): void {
  const matrix = floatBase + SHADOW_MATRIX_OFFSET / 4;
  const params = floatBase + SHADOW_PARAMS_OFFSET / 4;
  if (!lights.hasShadow) {
    for (let index = 0; index < 20; index += 1) {
      staging[matrix + index] = 0;
    }
    return;
  }
  for (let index = 0; index < 16; index += 1) {
    staging[matrix + index] = lights.shadowMatrix.elements[index];
  }
  staging[params] = lights.shadowBias;
  staging[params + 1] = lights.shadowNormalBias;
  staging[params + 2] = 1 / lights.shadowMapSize;
  staging[params + 3] = 0;
}

/**
 * The stride bytes still spare after the widening — the "rides the spare
 * bytes" argument above, as a number a test can pin: if a later member ever
 * drives this negative, the widened block no longer fits the landed
 * `LIGHT_UNIFORM_STRIDE_BYTES` and the argument (not just a bind-time
 * validation error) is what fails.
 */
export const SHADOW_UNIFORM_SPARE_BYTES =
  LIGHT_UNIFORM_STRIDE_BYTES - SHADOW_LIGHT_UNIFORM_BYTES;
