/**
 * This backend's binding layout, **declared as data** (§7 of the R-1 plan).
 *
 * A WGSL shader can declare its own bindings inline and let
 * `layout: "auto"` infer a pipeline layout from them. This backend refuses that
 * shortcut, and the refusal is a recorded debt to RFC 0001 rather than a style
 * preference: the RFC's future WGSL *emitter* will be a second producer of
 * shaders for this same backend, and two producers can only share a pipeline
 * layout if the layout exists somewhere other than inside a shader string. So
 * the layout is a TypeScript table here, every WGSL source in this package is
 * generated against it (`wgpu-unlit.ts`), and `layout: "auto"` appears nowhere.
 * It costs nothing today and saves the emitter from inventing a second
 * convention (decision, WP-R1.1).
 *
 * ## One uniform block per draw, one bind group per frame
 *
 * Every pipeline in this tier reads exactly one uniform buffer, at group 0,
 * binding 0, with a **dynamic offset**:
 *
 * ```wgsl
 * struct DrawUniforms {
 *   viewProjection : mat4x4<f32>,   //   0 .. 64
 *   model          : mat4x4<f32>,   //  64 .. 128
 *   color          : vec4<f32>,     // 128 .. 144
 * };
 * @group(0) @binding(0) var<uniform> draw : DrawUniforms;
 * ```
 *
 * The frame packs one such block per draw into a single growable CPU staging
 * array, uploads it with one `queue.writeBuffer`, creates **one** bind group,
 * and moves between draws with a dynamic offset. The alternatives were a bind
 * group per draw (an allocation per draw, per frame) or a uniform buffer per
 * draw (an allocation per object); this shape allocates once per *frame size*
 * and never inside a steady-state frame, which is the same rule §64's pooled
 * render items follow.
 *
 * The view-projection is duplicated into every draw's block rather than living
 * in a second, per-view bind group. That is 64 bytes per draw against a second
 * bind group, a second layout and a second binding index in every shader —
 * and the blocks are 256-byte-strided anyway (see `UNIFORM_STRIDE_BYTES`), so
 * the duplication is free in allocated bytes. When a per-view group earns its
 * keep — the lit pipeline's light block is the first candidate (WP-R1.5) — it
 * arrives as group 1, and this group's layout does not move.
 */

import {
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuDevice,
} from "./webgpu-device.js";

/** Byte offset of `DrawUniforms.viewProjection`. */
export const DRAW_VIEW_PROJECTION_OFFSET = 0;

/** Byte offset of `DrawUniforms.model`. */
export const DRAW_MODEL_OFFSET = 64;

/** Byte offset of `DrawUniforms.color`. */
export const DRAW_COLOR_OFFSET = 128;

/**
 * Size of the `DrawUniforms` block in bytes — the layout above, ending on its
 * last member.
 *
 * Not the 256-byte *stride*: this is the size a binding declares
 * (`minBindingSize`) and the size a bind group binds, while the stride is how
 * far apart two blocks sit in the buffer. Conflating them would bind 112 bytes
 * of the next draw's block into this draw's shader.
 */
export const DRAW_UNIFORM_BYTES = 144;

/** `DRAW_UNIFORM_BYTES` in `Float32Array` elements — the packing loop's unit. */
export const DRAW_UNIFORM_FLOATS = DRAW_UNIFORM_BYTES / 4;

/**
 * The one bind-group layout this tier declares: group 0, binding 0, a
 * dynamically-offset uniform buffer visible to both stages.
 *
 * Both stages, not one each: the vertex stage reads `viewProjection` and
 * `model`, the fragment stage reads `color`, and they are one block because
 * splitting them would double the bind-group traffic to save nothing — a
 * uniform block is uploaded whole either way.
 *
 * `minBindingSize` is set, so a mis-sized bind group is a validation error at
 * creation rather than a shader reading past its block at draw time.
 */
export function createDrawBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "four:draw-uniforms",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: DRAW_UNIFORM_BYTES,
        },
      },
    ],
  });
}

/**
 * The WGSL declaration of the block above, spliced into every shader in this
 * package.
 *
 * One string, exported, so that "the layout the pipeline declares" and "the
 * layout the shader reads" cannot drift: they are the same two definitions,
 * side by side in this module, and a change to either is a change to a file
 * whose whole subject is the pair.
 */
export const DRAW_UNIFORM_WGSL = `struct DrawUniforms {
  viewProjection : mat4x4<f32>,
  model : mat4x4<f32>,
  color : vec4<f32>,
};

@group(0) @binding(0) var<uniform> draw : DrawUniforms;`;
