/**
 * The metallic-roughness pipeline in hand-written WGSL (§57
 * `StandardMaterial`, §59, WP-R1.5) — the WGSL port of `gl-standard.ts`'s
 * `StandardProgram`, plus the widened per-draw uniform block a standard draw
 * reads.
 *
 * ## The BRDF is the GL module's, conventions included
 *
 * Cook-Torrance over glTF's metallic-roughness parameterization — GGX `D`,
 * the Smith height-correlated visibility `V`, Schlick `F` — with the three
 * engine conventions `gl-standard.ts` records carried over verbatim, because
 * they are conventions of the *engine*, not of a backend:
 *
 * 1. **No `1/π` on either lobe** (R-13): light colour × intensity is already
 *    an irradiance over π, which is what lets a fully-rough dielectric
 *    `StandardMaterial` and a `LitMaterial` under one lamp read as one model.
 * 2. **Ambient reaches the diffuse lobe only** — a pure metal under ambient
 *    alone renders black until IBL exists, on both backends alike.
 * 3. **Roughness is floored in the shader** (`MIN_ROUGHNESS`), where the
 *    division lives, never clamped in the material.
 *
 * The guards are the GL stage's too: a zero-length normal shades
 * ambient-plus-emissive, `nDotL ≤ 0` skips the whole direct term, `nDotV` is
 * floored at `1e-4`, the `D` and `V` denominators at `1e-8`/`1e-6`. §69's
 * shadow multiply is a lazy variant (WP-R1.7, `wgpu-shadow.ts`): with
 * `shadow` false this arithmetic is exactly the GL stage with `useShadow` at
 * its initial `false`, and with it true the **directional lobe's** product is
 * bound to a local and multiplied by `shadowFactor` before joining `shaded` —
 * the R-17 shape `gl-standard.ts` records, with the same normalized `n` the
 * BRDF shades with fed to the normal bias.
 *
 * ## Why a second group-0 layout (the sprite precedent, second application)
 *
 * A standard draw needs two `vec4`s more than `DrawUniforms` carries — §59's
 * `emissive` term and the metalness/roughness pair — and widening the shared
 * block would move `minBindingSize` in every recorded initialization
 * transcript (`wgpu-sprite.ts`'s argument, byte for byte). So the standard
 * family declares a **third group-0 layout over the same strided uniform
 * buffer**: the same 256-byte blocks, the same dynamic offset per draw, a
 * binding size of {@link STANDARD_UNIFORM_BYTES}. The layout and its bind
 * group are created lazily by the first standard draw, so an application that
 * never shades a standard material records the transcript it always did. The
 * spare stride bytes were already allocated; a standard block reads 32 more of
 * them.
 *
 * ```text
 * offset  member          contents
 *      0  viewProjection  as DrawUniforms
 *     64  model           as DrawUniforms
 *    128  baseColor       §59 base colour × opacity   (DrawUniforms.color's slot)
 *    144  emissive        rgb (§59);                   w unused, written 0
 *    160  surface         x metalness, y roughness;    z, w unused, written 0
 *    176  = STANDARD_UNIFORM_BYTES
 * ```
 *
 * All-`vec4` slots for `wgpu-lights.ts`'s alignment reason: every byte named,
 * none implied. The lights, the eye position and §57's `map` bind exactly as
 * the lit family's do (`wgpu-lights.ts`).
 *
 * ## Second texture unit — staged on this backend (2026-09-06)
 *
 * `StandardMaterial.metalRoughnessMap` is a real field and WebGL samples it.
 * This family still shades from the scalar factors only. `normalMap` /
 * `occlusionMap` / `emissiveMap` remain unstaged on both backends.
 */

import {
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuDevice,
} from "./webgpu-device.js";
import {
  LIGHT_UNIFORM_WGSL,
  PUNCTUAL_LIGHT_WGSL,
  SHADED_MAP_BINDING_WGSL,
} from "./wgpu-lights.js";
import { shadedVertexStageWgsl } from "./wgpu-lit.js";
import {
  SHADOW_FACTOR_WGSL,
  SHADOW_LIGHT_UNIFORM_WGSL,
} from "./wgpu-shadow.js";
import { FRAGMENT_ENTRY_POINT } from "./wgpu-unlit.js";

/** Byte offset of `StandardUniforms.viewProjection` — shared with `DrawUniforms`. */
export const STANDARD_VIEW_PROJECTION_OFFSET = 0;

/** Byte offset of `StandardUniforms.model` — shared with `DrawUniforms`. */
export const STANDARD_MODEL_OFFSET = 64;

/** Byte offset of `StandardUniforms.baseColor` — `DrawUniforms.color`'s slot, renamed. */
export const STANDARD_BASE_COLOR_OFFSET = 128;

/** Byte offset of `StandardUniforms.emissive` (rgb; w unused, written 0). */
export const STANDARD_EMISSIVE_OFFSET = 144;

/** Byte offset of `StandardUniforms.surface` (x metalness, y roughness; zw 0). */
export const STANDARD_SURFACE_OFFSET = 160;

/**
 * Size of the `StandardUniforms` block in bytes — the binding size, not the
 * 256-byte stride (`SPRITE_UNIFORM_BYTES`' distinction, restated).
 */
export const STANDARD_UNIFORM_BYTES = 176;

/**
 * The standard draw's group-0 layout: binding 0, a dynamically-offset uniform
 * buffer of {@link STANDARD_UNIFORM_BYTES}, visible to both stages (the vertex
 * stage reads the matrices, the fragment stage the colour and surface).
 *
 * Created lazily by the renderer's first standard draw — see the module header
 * for why this is a third layout rather than a widened `DrawUniforms`.
 */
export function createStandardBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "four:standard-uniforms",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: STANDARD_UNIFORM_BYTES,
        },
      },
    ],
  });
}

/**
 * The WGSL declaration of the block above — `DRAW_UNIFORM_WGSL`'s discipline:
 * declared layout and read layout side by side in one module.
 *
 * The variable is named `draw`, as every group-0 block in this package is, so
 * the shared vertex stage (`shadedVertexStageWgsl`) splices in unchanged.
 */
export const STANDARD_UNIFORM_WGSL = `struct StandardUniforms {
  viewProjection : mat4x4<f32>,
  model : mat4x4<f32>,
  baseColor : vec4<f32>,
  emissive : vec4<f32>,
  surface : vec4<f32>,
};

@group(0) @binding(0) var<uniform> draw : StandardUniforms;`;

/**
 * The standard WGSL module for one variant triple — the same variant axes as
 * the lit family (`normals`, `map`, WP-R1.7's `shadow`), for the same reasons
 * (`wgpu-lit.ts`'s departures 2 and 3 apply verbatim; the vertex stage *is*
 * the lit family's, over this module's own uniform block; `shadow` defaults
 * false and the default's text is byte-identical to what WP-R1.5 landed).
 *
 * The fragment stage is `STANDARD_FRAGMENT_SHADER_SOURCE`'s arithmetic in its
 * order: the base sample, the diffuse/F0 split, ambient into the diffuse lobe,
 * then — under the normal-length guard — the shared `directLobe` evaluated
 * once for the directional light and once per punctual light, each multiplied
 * by its irradiance and cosine *at the call site*, exactly as the GL refactor
 * keeps the directional term the pre-R-17 expression. Emissive is added last,
 * outside every guard, so a normal-less or back-facing surface still glows.
 */
export function standardShaderSource(
  normals: boolean,
  map: boolean,
  shadow = false,
): string {
  return `${STANDARD_UNIFORM_WGSL}

${shadow ? SHADOW_LIGHT_UNIFORM_WGSL : LIGHT_UNIFORM_WGSL}${
    map
      ? `

${SHADED_MAP_BINDING_WGSL}`
      : ""
  }

${shadedVertexStageWgsl(normals, map)}

${PUNCTUAL_LIGHT_WGSL}${
    shadow
      ? `

${SHADOW_FACTOR_WGSL}`
      : ""
  }

const DIELECTRIC_F0 : f32 = 0.04;
const MIN_ROUGHNESS : f32 = 0.045;

fn directLobe(
  n : vec3<f32>,
  v : vec3<f32>,
  l : vec3<f32>,
  nDotL : f32,
  diffuseColor : vec3<f32>,
  f0 : vec3<f32>,
  alpha2 : f32,
) -> vec3<f32> {
  let h = normalize(l + v);
  let nDotV = max(dot(n, v), 1e-4);
  let nDotH = max(dot(n, h), 0.0);
  let vDotH = clamp(dot(v, h), 0.0, 1.0);

  let denominator = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
  let distribution = alpha2 / max(denominator * denominator, 1e-8);

  let visibilityV = nDotL * sqrt(nDotV * nDotV * (1.0 - alpha2) + alpha2);
  let visibilityL = nDotV * sqrt(nDotL * nDotL * (1.0 - alpha2) + alpha2);
  let visibility = 0.5 / max(visibilityV + visibilityL, 1e-6);

  let fresnel = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - vDotH, 5.0);
  let specular = vec3<f32>(distribution * visibility) * fresnel;

  return diffuseColor + specular;
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : VertexOutput) -> @location(0) vec4<f32> {
  var base = draw.baseColor;${
    map
      ? `
  base = base * textureSample(mapTexture, mapSampler, input.uv);`
      : ""
  }
  let albedo = base.rgb;
  let metalness = draw.surface.x;
  let diffuseColor = albedo * (1.0 - metalness);
  let f0 = mix(vec3<f32>(DIELECTRIC_F0), albedo, metalness);
  var shaded = lights.ambientColor.xyz * diffuseColor;

  let normalLength = length(input.normal);
  if (normalLength > 0.0) {
    let n = input.normal / normalLength;
    let v = normalize(lights.cameraPosition.xyz - input.worldPosition);

    var alpha = max(draw.surface.y, MIN_ROUGHNESS);
    alpha = alpha * alpha;
    let alpha2 = alpha * alpha;

    let l = -lights.lightDirection.xyz;
    let nDotL = dot(n, l);
    if (nDotL > 0.0) {
      ${
        shadow
          ? `var direct = directLobe(n, v, l, nDotL, diffuseColor, f0, alpha2)
        * lights.lightColor.xyz * nDotL;
      direct = direct * shadowFactor(input.worldPosition, n);
      shaded = shaded + direct;`
          : `shaded = shaded + directLobe(n, v, l, nDotL, diffuseColor, f0, alpha2)
        * lights.lightColor.xyz * nDotL;`
      }
    }

    let punctualCount = i32(lights.counts.x);
    for (var index = 0; index < punctualCount; index = index + 1) {
      let punctual = punctualLight(index, input.worldPosition);
      let pnDotL = dot(n, punctual.direction);
      if (pnDotL > 0.0) {
        shaded = shaded
          + directLobe(n, v, punctual.direction, pnDotL, diffuseColor, f0, alpha2)
          * punctual.irradiance * pnDotL;
      }
    }
  }

  return vec4<f32>(shaded + draw.emissive.xyz, base.a);
}
`;
}
