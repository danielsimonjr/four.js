/**
 * The frame's lighting as **one uniform buffer** (§68, WP-R1.5), plus the
 * shared WGSL both shaded families splice in.
 *
 * This is the WebGPU port of the GL backend's light-set uploads — the five
 * `uniform3fv`/`uniform4fv` calls `PunctualLightUniforms` issues, the ambient
 * and directional uploads beside them, and `StandardProgram`'s eye position —
 * folded into a single block, written once per view and bound at
 * {@link LIGHTS_BIND_GROUP_INDEX} with a dynamic offset per view. That is the
 * "strictly simpler" the R-1 plan promised (§3.2): where GL uploads per
 * program per view, this backend packs one block per view into one buffer and
 * issues one `writeBuffer` for the whole frame.
 *
 * ## The layout, declared as data (§7 of the R-1 plan)
 *
 * Every slot is a **`vec4`**, deliberately: WGSL's `vec3<f32>` is 16-byte
 * aligned, so a `vec3` member or a tightly packed `array<vec3>` would leave
 * implicit padding the CPU packer has to know about anyway — a naive struct
 * silently misreads. All-`vec4` makes the byte layout below *total*: every
 * float of the block is named, none is implied.
 *
 * ```text
 * offset  member              contents
 *      0  ambientColor        rgb = SceneLights.ambientColor;      w = 0
 *     16  lightDirection      xyz = SceneLights.direction;         w = 0
 *     32  lightColor          rgb = SceneLights.directionalColor;  w = 0
 *     48  cameraPosition      xyz = the view's eye (§59);          w = 0
 *     64  counts              x = f32(punctualCount);        y, z, w = 0
 *     80  punctualPosition[8] xyz per light;                       w = 0
 *    208  punctualColor[8]    rgb premultiplied by intensity;      w = 0
 *    336  punctualDirection[8] xyz cone axis (§68);                w = 0
 *    464  punctualParams[8]   x range, y cos outer, z cone scale, w spot flag
 *    592  = LIGHT_UNIFORM_BYTES
 * ```
 *
 * `counts.x` is an **`f32`, not a `u32`** — the block is packed through one
 * `Float32Array`, and a `u32` word inside it would need a second typed-array
 * view over the same bytes for one integer. `f32` is exact for every value the
 * count can take (0…`MAX_PUNCTUAL_LIGHTS`), and the shader reads it back
 * with `i32(lights.counts.x)`, which is exact over the same range.
 *
 * The four punctual arrays carry `SceneLights`' packed arrays **re-strided**
 * from three floats per light to four; `punctualParams` is `vec4` on both
 * sides and copies straight through. The scalar meanings are `lights.ts`'s,
 * verbatim — this module re-encodes, it never re-derives.
 *
 * ## One block for both families
 *
 * `cameraPosition` is only read by the standard family's specular lobe, and it
 * rides in the shared block anyway: it is per-view state exactly as the light
 * set is, and a second layout for one `vec4` would double the bind-group
 * plumbing to save 16 strided bytes that are already allocated. The lit WGSL
 * simply never reads the member — the same deal `DrawUniforms.color` has with
 * the clear pipeline's vertex stage.
 *
 * ## Where the groups sit
 *
 * `wgpu-bindings.ts` promised that a per-view group would arrive **as
 * group 1** without moving group 0 — this is that group. The unlit family's
 * `map` already owns group 1, so for the two shaded families the *same*
 * texture layout object binds at {@link SHADED_MAP_BIND_GROUP_INDEX} — a bind
 * group carries no index of its own (the pipeline layout assigns it), so the
 * texture cache's records serve both families unchanged.
 *
 * ## The shadow half rides the spare stride bytes (WP-R1.7)
 *
 * §69's comparison sampler is a structurally different binding, and it lives
 * in `wgpu-shadow.ts`: a **widened twin** of this block
 * (`SHADOW_LIGHT_UNIFORM_WGSL`) appends the shadow matrix and parameters in
 * the stride bytes this layout already leaves spare (592…672 of 768), and two
 * more bindings — `texture_depth_2d` and `sampler_comparison` — join it in a
 * second group-1 layout. This layout, this struct, and
 * {@link LIGHT_UNIFORM_BYTES} are untouched, which is what keeps every landed
 * shaded transcript byte-identical: a draw that receives no shadow still binds
 * exactly this block. The member list is shared as
 * {@link LIGHT_UNIFORM_MEMBERS_WGSL} so the two structs cannot drift.
 */

import { MAX_PUNCTUAL_LIGHTS, type SceneLights } from "@four/render";

import {
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuDevice,
} from "./webgpu-device.js";
import { MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING } from "./wgpu-bindings.js";

/**
 * The bind-group index the shaded families read the light block at — the
 * per-view group 1 `wgpu-bindings.ts` reserved. The unlit family's group 1
 * (`map`) is untouched: the two families never share a pipeline layout.
 */
export const LIGHTS_BIND_GROUP_INDEX = 1;

/**
 * The bind-group index §57's `map` occupies **on the shaded families**:
 * group 2, because their group 1 is the light block. The *layout object* and
 * the per-texture bind groups are `createTextureBindGroupLayout`'s, unchanged
 * — a bind group binds at whatever index the pipeline layout put its layout,
 * so one texture cache serves all three sampling families.
 */
export const SHADED_MAP_BIND_GROUP_INDEX = 2;

/** Byte offset of `LightUniforms.ambientColor` (rgb; w unused, written 0). */
export const LIGHT_AMBIENT_OFFSET = 0;

/** Byte offset of `LightUniforms.lightDirection` (xyz; w unused, written 0). */
export const LIGHT_DIRECTION_OFFSET = 16;

/** Byte offset of `LightUniforms.lightColor` (rgb premultiplied; w written 0). */
export const LIGHT_COLOR_OFFSET = 32;

/** Byte offset of `LightUniforms.cameraPosition` (xyz; w unused, written 0). */
export const LIGHT_CAMERA_OFFSET = 48;

/** Byte offset of `LightUniforms.counts` (x = f32 punctual count; yzw 0). */
export const LIGHT_COUNTS_OFFSET = 64;

/** Byte offset of the `punctualPosition` array (xyz per light; w 0). */
export const LIGHT_PUNCTUAL_POSITION_OFFSET = 80;

/** Byte offset of the `punctualColor` array (rgb × intensity per light; w 0). */
export const LIGHT_PUNCTUAL_COLOR_OFFSET = 208;

/** Byte offset of the `punctualDirection` array (cone axis per light; w 0). */
export const LIGHT_PUNCTUAL_DIRECTION_OFFSET = 336;

/** Byte offset of the `punctualParams` array — `SceneLights.punctualParams`'s vec4s. */
export const LIGHT_PUNCTUAL_PARAMS_OFFSET = 464;

/**
 * Size of one `LightUniforms` block in bytes — the layout in the module
 * header, ending on its last member. The binding size, not the stride:
 * `DRAW_UNIFORM_BYTES`' distinction, third statement.
 */
export const LIGHT_UNIFORM_BYTES = 592;

/** {@link LIGHT_UNIFORM_BYTES} in `Float32Array` elements. */
export const LIGHT_UNIFORM_FLOATS = LIGHT_UNIFORM_BYTES / 4;

/**
 * Distance between two views' blocks in the lights buffer: the block size
 * rounded up to the 256-byte dynamic-offset alignment (`UNIFORM_STRIDE_BYTES`'
 * reasoning — 256 is every conforming device's valid alignment, and a fixed
 * stride keeps the frame's byte layout device-independent, §33).
 */
export const LIGHT_UNIFORM_STRIDE_BYTES = 768;

/** {@link LIGHT_UNIFORM_STRIDE_BYTES} in `Float32Array` elements. */
export const LIGHT_UNIFORM_STRIDE_FLOATS = LIGHT_UNIFORM_STRIDE_BYTES / 4;

/**
 * The light block's bind-group layout: binding 0, a dynamically-offset uniform
 * buffer of {@link LIGHT_UNIFORM_BYTES}, **fragment-only** — no vertex stage
 * in this package reads a light, and declaring vertex visibility would reserve
 * a vertex-stage buffer slot nothing uses (`createTextureBindGroupLayout`'s
 * argument, applied to a buffer).
 *
 * Created lazily by the renderer's first lit frame — the WP-R1.2 group-1
 * precedent, third application — so an application that never shades records
 * the identical initialization transcript, byte for byte.
 */
export function createLightsBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "four:lights",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: LIGHT_UNIFORM_BYTES,
        },
      },
    ],
  });
}

/**
 * The member list of the block above, without the struct wrapper — shared
 * with `wgpu-shadow.ts`'s widened `ShadowLightUniforms` (WP-R1.7), whose
 * first {@link LIGHT_UNIFORM_BYTES} bytes must be this layout exactly: one
 * string, two structs, so the shadowed and unshadowed variants cannot
 * disagree about where a light lives.
 */
export const LIGHT_UNIFORM_MEMBERS_WGSL = `  ambientColor : vec4<f32>,
  lightDirection : vec4<f32>,
  lightColor : vec4<f32>,
  cameraPosition : vec4<f32>,
  counts : vec4<f32>,
  punctualPosition : array<vec4<f32>, ${String(MAX_PUNCTUAL_LIGHTS)}>,
  punctualColor : array<vec4<f32>, ${String(MAX_PUNCTUAL_LIGHTS)}>,
  punctualDirection : array<vec4<f32>, ${String(MAX_PUNCTUAL_LIGHTS)}>,
  punctualParams : array<vec4<f32>, ${String(MAX_PUNCTUAL_LIGHTS)}>,`;

/**
 * The WGSL declaration of the block above — `DRAW_UNIFORM_WGSL`'s discipline:
 * the layout the pipeline declares and the layout the shader reads live side
 * by side in one module, so they cannot drift.
 */
export const LIGHT_UNIFORM_WGSL = `struct LightUniforms {
${LIGHT_UNIFORM_MEMBERS_WGSL}
};

@group(${String(LIGHTS_BIND_GROUP_INDEX)}) @binding(0) var<uniform> lights : LightUniforms;`;

/**
 * The **light model** both shaded fragment stages share — the WGSL port of
 * `gl-program.ts`'s `PUNCTUAL_LIGHT_GLSL`, one string spliced into both
 * families for the recorded reason: the falloff and the cone are one model,
 * and a scene mixing a `LitMaterial` with a `StandardMaterial` under the same
 * lamp must not be able to disagree about it.
 *
 * The arithmetic is the GLSL chunk's, line for line — inverse-square with the
 * `max(d², 1e-8)` guard where the division happens, `KHR_lights_punctual`'s
 * range window and cone ramp, the precomputed `params.z` reciprocal — with
 * one syntactic difference: WGSL has no `out` parameters, so the direction
 * travels back in a two-member struct instead of an `out vec3 l`.
 *
 * No `1/π` appears here or in either lobe that consumes this — the engine's
 * light colour × intensity is an irradiance already divided by π (R-13), which
 * is what lets a point light and the directional light add up to one lighting
 * model across both backends.
 */
export const PUNCTUAL_LIGHT_WGSL = `struct PunctualLight {
  irradiance : vec3<f32>,
  direction : vec3<f32>,
};

fn punctualLight(index : i32, p : vec3<f32>) -> PunctualLight {
  let offset = lights.punctualPosition[index].xyz - p;
  let distanceSquared = max(dot(offset, offset), 1e-8);
  let d = sqrt(distanceSquared);
  let l = offset / d;
  let params = lights.punctualParams[index];
  var attenuation = 1.0 / distanceSquared;
  if (params.x > 0.0) {
    let ratio = d / params.x;
    let squared = ratio * ratio;
    attenuation = attenuation * clamp(1.0 - squared * squared, 0.0, 1.0);
  }
  if (params.w > 0.0) {
    let cosTheta = dot(lights.punctualDirection[index].xyz, -l);
    attenuation = attenuation * clamp((cosTheta - params.y) * params.z, 0.0, 1.0);
  }
  var result : PunctualLight;
  result.irradiance = lights.punctualColor[index].xyz * attenuation;
  result.direction = l;
  return result;
}`;

/**
 * The `map` declaration of the **shaded** families — `MAP_BINDING_WGSL` with
 * the group renumbered to {@link SHADED_MAP_BIND_GROUP_INDEX}, because their
 * group 1 is the light block. Same two bindings, same layout object, same
 * texture-cache records.
 */
export const SHADED_MAP_BINDING_WGSL = `@group(${String(SHADED_MAP_BIND_GROUP_INDEX)}) @binding(${String(MAP_TEXTURE_BINDING)}) var mapTexture : texture_2d<f32>;
@group(${String(SHADED_MAP_BIND_GROUP_INDEX)}) @binding(${String(MAP_SAMPLER_BINDING)}) var mapSampler : sampler;`;

/**
 * Packs one view's `LightUniforms` block into `staging` at `floatBase`.
 *
 * Every float of the block is written — the unused `w` slots and the dead tail
 * of the arrays included — so the uploaded bytes are a function of this
 * frame's `SceneLights` alone, never of what a previous frame or view left in
 * the reused staging array (`clearSceneLights`' transcript-determinism
 * argument, restated one buffer later).
 *
 * The three `vec3`-meaning arrays are re-strided from `SceneLights`' packed
 * three-floats-per-light to the block's `vec4` slots; `punctualParams` copies
 * straight through. `SceneLights` zeroes its own dead tails per collection, so
 * the re-stride can copy all `MAX_PUNCTUAL_LIGHTS` entries without
 * consulting the count.
 *
 * The eye is three scalars rather than a `Vector3` for `setCameraPosition`'s
 * recorded reason: the renderer reads them straight out of the camera's world
 * matrix translation column and has nothing to allocate on the way.
 *
 * Branch-free on purpose: point-versus-spot is already resolved in the packed
 * `SceneLights` arrays (`writePunctualLight`), and a packer that re-decided it
 * would be a second place for the light model to drift.
 */
export function writeLightUniforms(
  staging: Float32Array,
  floatBase: number,
  lights: SceneLights,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
): void {
  const ambient = floatBase + LIGHT_AMBIENT_OFFSET / 4;
  staging[ambient] = lights.ambientColor[0];
  staging[ambient + 1] = lights.ambientColor[1];
  staging[ambient + 2] = lights.ambientColor[2];
  staging[ambient + 3] = 0;

  const direction = floatBase + LIGHT_DIRECTION_OFFSET / 4;
  staging[direction] = lights.direction.x;
  staging[direction + 1] = lights.direction.y;
  staging[direction + 2] = lights.direction.z;
  staging[direction + 3] = 0;

  const color = floatBase + LIGHT_COLOR_OFFSET / 4;
  staging[color] = lights.directionalColor[0];
  staging[color + 1] = lights.directionalColor[1];
  staging[color + 2] = lights.directionalColor[2];
  staging[color + 3] = 0;

  const camera = floatBase + LIGHT_CAMERA_OFFSET / 4;
  staging[camera] = cameraX;
  staging[camera + 1] = cameraY;
  staging[camera + 2] = cameraZ;
  staging[camera + 3] = 0;

  const counts = floatBase + LIGHT_COUNTS_OFFSET / 4;
  staging[counts] = lights.punctualCount;
  staging[counts + 1] = 0;
  staging[counts + 2] = 0;
  staging[counts + 3] = 0;

  const positions = floatBase + LIGHT_PUNCTUAL_POSITION_OFFSET / 4;
  const colors = floatBase + LIGHT_PUNCTUAL_COLOR_OFFSET / 4;
  const directions = floatBase + LIGHT_PUNCTUAL_DIRECTION_OFFSET / 4;
  for (let index = 0; index < MAX_PUNCTUAL_LIGHTS; index += 1) {
    const packed = index * 3;
    const slot = index * 4;
    staging[positions + slot] = lights.punctualPositions[packed];
    staging[positions + slot + 1] = lights.punctualPositions[packed + 1];
    staging[positions + slot + 2] = lights.punctualPositions[packed + 2];
    staging[positions + slot + 3] = 0;
    staging[colors + slot] = lights.punctualColors[packed];
    staging[colors + slot + 1] = lights.punctualColors[packed + 1];
    staging[colors + slot + 2] = lights.punctualColors[packed + 2];
    staging[colors + slot + 3] = 0;
    staging[directions + slot] = lights.punctualDirections[packed];
    staging[directions + slot + 1] = lights.punctualDirections[packed + 1];
    staging[directions + slot + 2] = lights.punctualDirections[packed + 2];
    staging[directions + slot + 3] = 0;
  }

  const params = floatBase + LIGHT_PUNCTUAL_PARAMS_OFFSET / 4;
  for (let index = 0; index < MAX_PUNCTUAL_LIGHTS * 4; index += 1) {
    staging[params + index] = lights.punctualParams[index];
  }
}
