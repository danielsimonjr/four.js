/**
 * §70's full-screen effects in hand-written WGSL — the blit, the colour grade,
 * and §60a's output transform (WP-R1.6; the WGSL port of `gl-effect.ts`).
 *
 * `@four/render`'s `effect-pass.ts` owns the *policy* — which of §70's ten
 * effects this tier ships and what each staged one waits on — and this module
 * owns the WGSL. What the port keeps: the full-screen triangle generated from
 * the vertex index with no vertex buffer at all, the exact grading arithmetic
 * (exposure, contrast about a linear 0.5 pivot, saturation toward the Rec. 709
 * linear luma), the exact IEC 61966-2-1 encode with its odd extension below
 * zero, and alpha carried through both untouched. What it does not keep is the
 * one-program-two-switches shape, and the inversion is the R-19 argument this
 * backend has now applied three times: GL made `useGrade`/`useEncode` uniforms
 * because variants meant more programs compiled at init; here the pipeline
 * cache is lazy, so each effect kind is its **own module**, compiled only when
 * a frame first draws it, with no per-fragment branch — and the copy's
 * bit-exactness is a property of its module (one sample, one return) rather
 * than of a mirror having stayed at `false`.
 *
 * ## The (kind × format) pipeline space
 *
 * A `GPURenderPipeline` bakes in its colour format, and an effect can draw
 * into the swap chain (`bgra8unorm` on most hosts) or into a render target
 * (`rgba8unorm` — `wgpu-render-target.ts`). Effect pipelines therefore live in
 * the same lazy cache as every other family (`wgpu-pipeline-cache.ts`), keyed
 * by kind and format through the descriptor's conditional `|e:` suffix — a
 * chain that only ever grades on screen compiles one module and one pipeline.
 *
 * ## Bindings
 *
 * The source is sampled through **the texture cache's group layout at group
 * 0** — the same object every `map` pipeline compiles against, exactly as the
 * mip blit reuses it, because an effect binds precisely a texture and a
 * sampler and a bind group carries no index. The grade's coefficients ride a
 * 16-byte uniform block at group 1 ({@link createEffectBindGroupLayout}),
 * which only the grade variant declares — a copy or an output transform keeps
 * the one-group layout and uploads nothing, which is what keeps §70's blit
 * free of uniform traffic here just as GL's mirror discipline kept it there.
 *
 * ## Orientation
 *
 * The vertex stage derives uv from the clip-space corner with the same
 * `(1 - y) / 2` flip the mip blit uses, so destination pixel (x, y) samples
 * source texel (x, y) exactly — a copy is a per-pixel identity, never a
 * mirror, whatever §7a orientation the surfaces carry.
 */

import {
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuDevice,
} from "./webgpu-device.js";
import { MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING } from "./wgpu-bindings.js";
import { FRAGMENT_ENTRY_POINT, VERTEX_ENTRY_POINT } from "./wgpu-unlit.js";

/**
 * The effect kinds this *fixed-effect family* draws — `ScreenEffect`'s closed
 * union minus `"graph"`, which is RFC 0001's WGSL emitter (WP-R1.9): drawn by
 * the registered node pipeline through its own per-graph modules
 * (`wgpu-node-program.ts`), so it is dispatched before this family and never
 * becomes a fourth member here.
 */
export type WgpuEffectKind = "copy" | "grade" | "output-transform";

/** Vertices of the effect's full-screen triangle — the clear draw's idiom. */
export const EFFECT_PASS_VERTEX_COUNT = 3;

/** Byte offset of the grade coefficients inside the effect uniform block. */
export const EFFECT_GRADE_OFFSET = 0;

/**
 * Size of the effect uniform block: one `vec4<f32>` — exposure, contrast,
 * saturation, and a padding lane written as zero (`wgpu-lights.ts`'s
 * all-`vec4` rule: no member whose alignment the CPU packer must guess).
 */
export const EFFECT_UNIFORM_BYTES = 16;

/** The bind-group index the grade's uniform block occupies. */
export const EFFECT_BIND_GROUP_INDEX = 1;

/**
 * The WGSL declaration of the grade's uniform block, spliced into the grade
 * module — beside {@link createEffectBindGroupLayout} for `DRAW_UNIFORM_WGSL`'s
 * reason: the layout the pipeline declares and the block the shader reads are
 * two definitions in one file, so they cannot drift.
 */
export const EFFECT_UNIFORM_WGSL = `struct EffectUniforms {
  grade : vec4<f32>,
};

@group(${String(EFFECT_BIND_GROUP_INDEX)}) @binding(0) var<uniform> effect : EffectUniforms;`;

/**
 * The grade uniform block's bind-group layout: group 1, binding 0, sixteen
 * bytes, fragment-only — the coefficients are fragment arithmetic and the
 * vertex stage has no use for a reserved slot. No dynamic offset: one effect
 * draw per `renderEffect` call binds one block.
 */
export function createEffectBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "four:effect-uniforms",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        buffer: { type: "uniform", minBindingSize: EFFECT_UNIFORM_BYTES },
      },
    ],
  });
}

/**
 * The shared half of every effect module: the source bindings at group 0 (the
 * texture cache's layout — module header) and the full-screen-triangle vertex
 * stage with its identity-preserving uv derivation.
 */
const EFFECT_COMMON_WGSL = `@group(0) @binding(${String(MAP_TEXTURE_BINDING)}) var sourceTexture : texture_2d<f32>;
@group(0) @binding(${String(MAP_SAMPLER_BINDING)}) var sourceSampler : sampler;

struct EffectOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn ${VERTEX_ENTRY_POINT}(@builtin(vertex_index) index : u32) -> EffectOutput {
  let corner = i32(index);
  let x = f32(corner / 2) * 4.0 - 1.0;
  let y = f32(corner & 1) * 4.0 - 1.0;
  var output : EffectOutput;
  output.position = vec4<f32>(x, y, 0.0, 1.0);
  output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
  return output;
}`;

/**
 * The WGSL module for one effect kind — a pure function of the kind, so two
 * calls produce byte-identical source and the pipeline cache can key on the
 * descriptor (§33's rule, as every generated module in this package states it).
 *
 * - **`"copy"`** assigns the sampled texel to the output with no arithmetic
 *   between — the bit-exact blit `CopyEffect` promises, by construction.
 * - **`"grade"`** runs `ColorGradeEffect`'s three operations in its documented
 *   order on straight linear-light RGB, alpha untouched, nothing clamped (the
 *   `rgba8` destination saturates on write; a future float target must not be
 *   silently clamped into agreeing with it).
 * - **`"output-transform"`** encodes linear-light RGB as sRGB — the piecewise
 *   IEC 61966-2-1 curve `@four/math`'s `linearToSrgb` computes on the CPU,
 *   odd-extended below zero by taking the magnitude and restoring the sign so
 *   a negative texel never reaches `pow` (undefined for a negative base).
 *   Alpha is a coverage fraction, not a light quantity, and is not encoded.
 */
export function effectShaderSource(kind: WgpuEffectKind): string {
  if (kind === "copy") {
    return `${EFFECT_COMMON_WGSL}

@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : EffectOutput) -> @location(0) vec4<f32> {
  return textureSample(sourceTexture, sourceSampler, input.uv);
}
`;
  }
  if (kind === "grade") {
    return `${EFFECT_COMMON_WGSL}

${EFFECT_UNIFORM_WGSL}

const LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : EffectOutput) -> @location(0) vec4<f32> {
  let texel = textureSample(sourceTexture, sourceSampler, input.uv);
  var color = texel.rgb * effect.grade.x;
  color = (color - 0.5) * effect.grade.y + 0.5;
  color = mix(vec3<f32>(dot(color, LUMA)), color, effect.grade.z);
  return vec4<f32>(color, texel.a);
}
`;
  }
  return `${EFFECT_COMMON_WGSL}

@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : EffectOutput) -> @location(0) vec4<f32> {
  let texel = textureSample(sourceTexture, sourceSampler, input.uv);
  let m = abs(texel.rgb);
  let high = 1.055 * pow(m, vec3<f32>(1.0 / 2.4)) - 0.055;
  let encoded = sign(texel.rgb) * mix(high, m * 12.92, step(m, vec3<f32>(0.0031308)));
  return vec4<f32>(encoded, texel.a);
}
`;
}
