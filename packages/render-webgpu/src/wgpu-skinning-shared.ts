/**
 * The vertex-stage skinning chunk both the colour/caster pipelines
 * (`wgpu-skinning.ts`) and the picking id pipeline (`wgpu-picking.ts`) splice
 * in.
 *
 * Isolated so {@link registerPickingPipeline} can draw a deformed silhouette
 * without linking `wgpu-skinning.ts` (pipeline-cost law: that module is the
 * `registerSkinningPipeline` seam, and importing it would pull the colour
 * pair into every picking bundle). WebGL solved the same split with
 * `gl-skinning-glsl.ts`. The two consumers interpolate the same exported
 * helpers; they must not drift.
 *
 * Linear blend skinning, four influences summed in attribute order — a
 * fixed association order, though the result never re-enters the §33
 * envelope either way. Dual-quaternion skinning is deferred (RFC 0003 §8).
 * Joint indices arrive as `uint16x4` at location 4 (WGSL `vec4<u32>`) and
 * weights as `float32x4` at location 5; weights are not renormalised.
 */

import { MAX_SKINNING_JOINTS } from "@fourjs/render";

import {
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuDevice,
  type GpuVertexBufferLayout,
} from "./webgpu-device.js";

/** `@location(4)` — four joint indices per vertex (§54, RFC 0003). */
export const JOINTS_SHADER_LOCATION = 4;

/** `@location(5)` — four influence weights per vertex, not renormalised. */
export const WEIGHTS_SHADER_LOCATION = 5;

/** Vertex layout for the joint stream: one tightly packed `uint16x4`. */
export const JOINTS_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 8,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "uint16x4",
      offset: 0,
      shaderLocation: JOINTS_SHADER_LOCATION,
    }),
  ]),
});

/** Vertex layout for the weight stream: one tightly packed `vec4<f32>`. */
export const WEIGHTS_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 16,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "float32x4",
      offset: 0,
      shaderLocation: WEIGHTS_SHADER_LOCATION,
    }),
  ]),
});

/**
 * Size of one joint-palette uniform block in bytes — `MAX_SKINNING_JOINTS`
 * × a std140 `mat4` (64 bytes). Already a multiple of the 256-byte dynamic
 * offset alignment, so the slot *is* the stride.
 */
export const JOINT_PALETTE_BYTES = MAX_SKINNING_JOINTS * 64;

/** `JOINT_PALETTE_BYTES` in `Float32Array` elements. */
export const JOINT_PALETTE_FLOATS = JOINT_PALETTE_BYTES / 4;

/** `@binding(0)` of the palette group — the `mat4` array. */
export const JOINT_PALETTE_BINDING = 0;

/**
 * Bind-group index the palette occupies for one colour variant — always the
 * slot after the family's existing groups, so unlit untextured is group 1,
 * textured unlit and untextured lit are group 2, and textured lit is
 * group 3 (WebGPU's last slot). The id pass and the §69 caster bind the
 * palette at group 1 (after `IdUniforms` / `DrawUniforms`).
 */
export function skinnedPaletteBindGroupIndex(
  lit: boolean,
  map: boolean,
): number {
  if (lit) {
    return map ? 3 : 2;
  }
  return map ? 2 : 1;
}

/**
 * The palette bind-group layout: group N, binding 0, a dynamically-offset
 * uniform buffer visible to the **vertex** stage alone (the fragment never
 * reads a joint).
 */
export function createJointPaletteBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "fourJS:joint-palette",
    entries: [
      {
        binding: JOINT_PALETTE_BINDING,
        visibility: GPU_SHADER_STAGE.VERTEX,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: JOINT_PALETTE_BYTES,
        },
      },
    ],
  });
}

/**
 * Linear-blend skinning chunk spliced into every skinned vertex stage —
 * four influences, weights as authored (not renormalised), matching
 * WebGL's `SKINNING_GLSL`. Joint indices arrive as `uint16x4` at location
 * 4 (WGSL `vec4<u32>`) and weights as `float32x4` at location 5.
 */
export function skinningWgsl(paletteGroup: number): string {
  return `struct JointPalette {
  jointMatrices : array<mat4x4<f32>, ${String(MAX_SKINNING_JOINTS)}>,
};

@group(${String(paletteGroup)}) @binding(${String(JOINT_PALETTE_BINDING)}) var<uniform> palette : JointPalette;

fn skinMatrix() -> mat4x4<f32> {
  return weights.x * palette.jointMatrices[joints.x]
       + weights.y * palette.jointMatrices[joints.y]
       + weights.z * palette.jointMatrices[joints.z]
       + weights.w * palette.jointMatrices[joints.w];
}`;
}
