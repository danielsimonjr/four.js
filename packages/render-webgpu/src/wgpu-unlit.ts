/**
 * The unlit pipeline in hand-written WGSL (§64, §120's MVP tier), plus the
 * clear pipeline every view's clear is drawn with.
 *
 * This is the WGSL port of `gl-program.ts`'s `UnlitProgram`, and the port is
 * deliberately a *translation*: the same two matrices, the same flat colour,
 * the same optional per-vertex colour multiplier. RFC 0001's shader graph will
 * one day emit WGSL for this backend; hand-written WGSL is what makes that
 * emitter testable ("emit this pipeline and compare"), which is the argument
 * §7 of the R-1 plan settles at length.
 *
 * ## Two departures from the GLSL original, both forced by WebGPU
 *
 * ### 1. The depth remap lives here
 *
 * WebGL's clip space maps visible depth onto `z ∈ [-w, w]`; WebGPU's maps it
 * onto `z ∈ [0, w]`. `@four/math`'s projections are written to the WebGL
 * convention (D8), and they must stay that way: the math package may not learn
 * which backend is drawing (§3.1). So the remap
 *
 * ```wgsl
 * clip.z = (clip.z + clip.w) * 0.5
 * ```
 *
 * is applied **in this backend's vertex stage**, once, on the way out — the
 * placement the R-1 plan fixes (§3.3.8). It is exact, it costs one multiply-add
 * per vertex, and it keeps `Frustum`'s WebGL-convention plane extraction (which
 * `buildViewRenderList` culls with) correct for both backends, because the
 * matrix the CPU culls against is the un-remapped one.
 *
 * ### 2. `useMap` / `useVertexColors` are pipeline variants, not uniforms
 *
 * R-19 made them uniform branches on WebGL for a measured reason: a variant set
 * would have meant more programs compiled at initialization. That reason does
 * not survive the port. A `GPURenderPipeline` is immutable and combinatorial,
 * the cache that holds them is **lazy** (`wgpu-pipeline-cache.ts`), and a
 * variant nothing draws is never created at all — so the cost model inverts,
 * and the variant is strictly better: no per-fragment branch, and the vertex
 * layout can *omit* the colour buffer entirely rather than binding a dummy.
 * (Texturing itself is WP-R1.2's; this module ships the flat and
 * vertex-coloured variants.)
 */

import { DRAW_UNIFORM_WGSL } from "./wgpu-bindings.js";
import type { GpuVertexBufferLayout } from "./webgpu-device.js";

/** `@location(0)` — object-space position, the one required stream (§53). */
export const POSITION_SHADER_LOCATION = 0;

/** `@location(1)` — the optional per-vertex RGBA stream (§53, §60a). */
export const COLOR_SHADER_LOCATION = 1;

/** Vertex layout for the position stream: one tightly packed `vec3<f32>`. */
export const POSITION_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 12,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "float32x3",
      offset: 0,
      shaderLocation: POSITION_SHADER_LOCATION,
    }),
  ]),
});

/** Vertex layout for the optional colour stream: one tightly packed `vec4<f32>`. */
export const COLOR_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 16,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "float32x4",
      offset: 0,
      shaderLocation: COLOR_SHADER_LOCATION,
    }),
  ]),
});

/**
 * Vertex layouts for an unlit pipeline, in slot order — one buffer, or two when
 * the variant reads per-vertex colours.
 *
 * Separate buffers rather than one interleaved one, matching `gl-geometry.ts`:
 * `BufferGeometry` holds each stream as its own typed array, so one buffer per
 * stream is a straight upload with no CPU-side interleave pass.
 */
export function unlitVertexBufferLayouts(
  vertexColors: boolean,
): readonly GpuVertexBufferLayout[] {
  return vertexColors
    ? [POSITION_BUFFER_LAYOUT, COLOR_BUFFER_LAYOUT]
    : [POSITION_BUFFER_LAYOUT];
}

/** Entry point name of every vertex stage in this package. */
export const VERTEX_ENTRY_POINT = "vertexMain";

/** Entry point name of every fragment stage in this package. */
export const FRAGMENT_ENTRY_POINT = "fragmentMain";

/**
 * The unlit WGSL module for one variant.
 *
 * Generated rather than stored as two constants so that the shared half — the
 * uniform block, the remap, the fragment stage — is written once. The generated
 * text is a pure function of the flag, so two calls with the same flag produce
 * byte-identical source, which is what lets the pipeline cache key on the
 * descriptor instead of on the string (§33's determinism rule, applied to a
 * cache).
 */
export function unlitShaderSource(vertexColors: boolean): string {
  const input = vertexColors
    ? `  @location(${String(POSITION_SHADER_LOCATION)}) position : vec3<f32>,
  @location(${String(COLOR_SHADER_LOCATION)}) vertexColor : vec4<f32>,`
    : `  @location(${String(POSITION_SHADER_LOCATION)}) position : vec3<f32>,`;
  const color = vertexColors ? "draw.color * vertexColor" : "draw.color";
  return `${DRAW_UNIFORM_WGSL}

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@vertex
fn ${VERTEX_ENTRY_POINT}(
${input}
) -> VertexOutput {
  var output : VertexOutput;
  let clip = draw.viewProjection * draw.model * vec4<f32>(position, 1.0);
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see the module header.
  output.position = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
  output.color = ${color};
  return output;
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : VertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
`;
}

/**
 * Number of vertices the clear pipeline draws: one oversized triangle covering
 * the whole clip-space square.
 */
export const CLEAR_VERTEX_COUNT = 3;

/**
 * The clear pipeline's WGSL — a full-surface triangle at the far plane.
 *
 * ## Why a *draw* clears, when WebGPU has `loadOp: "clear"`
 *
 * Because §61's clear contract is not "clear the surface", it is **"clear the
 * viewport rectangle"**: *"clears are confined to the viewport rectangle, never
 * the whole surface"*, which is what makes a minimap composite over the main
 * view rather than erase it. WebGPU's `loadOp` clears the whole attachment and
 * has no scissor, so a `loadOp: "clear"` implementation of a two-view frame
 * would erase the first view when the second began. `setScissorRect` plus a
 * full-surface triangle clears exactly the rectangle — which is what the WebGL
 * backend's scissored `clear` does, expressed in the primitives WebGPU has.
 *
 * The colour attachment therefore always loads (`loadOp: "load"`), and the
 * per-view rules fall out unchanged: a view carrying no `clearColor` draws no
 * clear triangle at all, and a view that carries one clears just its rectangle.
 * Depth is cleared for every view by the same draw — `depthCompare: "always"`
 * with `depthWriteEnabled: true` and `z = 1`, the far plane §61 names — so a
 * later view cannot be occluded by an earlier one's geometry.
 *
 * The colour-less variant writes no colour channels (`writeMask: 0`), so the
 * clear-depth-only case is the same draw with a different pipeline key rather
 * than a second code path.
 */
export const CLEAR_SHADER_SOURCE = `${DRAW_UNIFORM_WGSL}

@vertex
fn ${VERTEX_ENTRY_POINT}(@builtin(vertex_index) index : u32) -> @builtin(position) vec4<f32> {
  // (-1,-1), (-1, 3), (3, -1): one triangle covering the clip-space square.
  let corner = i32(index);
  let x = f32(corner / 2) * 4.0 - 1.0;
  let y = f32(corner & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 1.0, 1.0);
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}() -> @location(0) vec4<f32> {
  return draw.color;
}
`;
