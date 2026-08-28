/**
 * `@four/render-webgpu` — the WebGPU backend (§62 backend 1).
 *
 * The public surface is one class, {@link WebgpuRenderer}, which implements
 * `@four/render`'s `Renderer`, plus {@link registerWebgpuRenderer} for §62's
 * registry. Everything else exported here is exported because a *test*, a
 * diagnostic, or a later packet in this package needs it — the structural
 * device surface, the pipeline cache and its key function, the bind-group
 * layout table and the WGSL builders are the seams that let the whole backend
 * be unit-tested against a fake device with no GPU and no browser (Node has no
 * `navigator.gpu` at all; see `tests/integration/helpers/recording-gpu.ts`).
 *
 * Applications select a backend at the edge (§62); nothing in `@four/scene`,
 * `@four/motion`, or `@four/physics` may name anything in this package. Note
 * that **calling `registerWebgpuRenderer()` moves an application off WebGL 2**,
 * because `AUTO_RENDERER_ORDER` prefers WebGPU — `register.ts` has the full
 * note.
 */

export const PACKAGE_NAME = "@four/render-webgpu";

export type {
  Gpu,
  GpuAdapter,
  GpuStencilFaceState,
  GpuBindGroup,
  GpuBindGroupEntry,
  GpuBindGroupLayout,
  GpuBindGroupLayoutEntry,
  GpuBlendComponent,
  GpuBlendState,
  GpuBuffer,
  GpuBufferDescriptor,
  GpuCanvasContext,
  GpuCommandBuffer,
  GpuCommandEncoder,
  GpuDevice,
  GpuDeviceLostInfo,
  GpuPipelineLayout,
  GpuQueue,
  GpuRenderPassDescriptor,
  GpuRenderPassEncoder,
  GpuRenderPipeline,
  GpuBufferBinding,
  GpuRenderPipelineDescriptor,
  GpuSampler,
  GpuSamplerDescriptor,
  GpuShaderModule,
  GpuTexture,
  GpuTextureDescriptor,
  GpuTextureView,
  GpuTextureViewDescriptor,
  GpuVertexBufferLayout,
  WebgpuCanvas,
} from "./webgpu-device.js";
export {
  GPU_BUFFER_USAGE,
  GPU_SHADER_STAGE,
  GPU_TEXTURE_USAGE,
  UNIFORM_STRIDE_BYTES,
} from "./webgpu-device.js";
export { hostGpu, WebgpuRenderer } from "./webgpu-renderer.js";
export { isWebgpuSupported, registerWebgpuRenderer } from "./register.js";
export {
  DRAW_COLOR_OFFSET,
  DRAW_MODEL_OFFSET,
  DRAW_UNIFORM_BYTES,
  DRAW_UNIFORM_FLOATS,
  DRAW_UNIFORM_WGSL,
  DRAW_VIEW_PROJECTION_OFFSET,
  MAP_BINDING_WGSL,
  MAP_BIND_GROUP_INDEX,
  MAP_SAMPLER_BINDING,
  MAP_TEXTURE_BINDING,
  createDrawBindGroupLayout,
  createTextureBindGroupLayout,
} from "./wgpu-bindings.js";
export type { CacheableGeometry, WgpuGeometryRecord } from "./wgpu-geometry.js";
export { WgpuGeometryCache } from "./wgpu-geometry.js";
export type {
  WgpuBatchStream,
  WgpuPipelineDescriptor,
  WgpuPipelineKind,
  WgpuStencilDescriptor,
} from "./wgpu-pipeline-cache.js";
export { pipelineKey, WgpuPipelineCache } from "./wgpu-pipeline-cache.js";
export type { WgpuRenderBatching } from "./wgpu-batch.js";
export {
  WgpuBatching,
  batchVertexBufferLayout,
  createWgpuBatching,
} from "./wgpu-batch.js";
export {
  SPRITE_MODEL_OFFSET,
  SPRITE_QUAD_OFFSET,
  SPRITE_SHADER_SOURCE,
  SPRITE_TINT_OFFSET,
  SPRITE_UNIFORM_BYTES,
  SPRITE_UNIFORM_WGSL,
  SPRITE_VIEW_PROJECTION_OFFSET,
  createSpriteBindGroupLayout,
} from "./wgpu-sprite.js";
export type {
  ResolvedSamplerState,
  WgpuCacheableTexture,
  WgpuTextureRecord,
} from "./wgpu-texture.js";
export {
  MIPMAP_SHADER_SOURCE,
  WgpuTextureCache,
  mipLevelCount,
  samplerKey,
  textureByteLength,
} from "./wgpu-texture.js";
export {
  CLEAR_SHADER_SOURCE,
  CLEAR_VERTEX_COUNT,
  COLOR_BUFFER_LAYOUT,
  COLOR_SHADER_LOCATION,
  FRAGMENT_ENTRY_POINT,
  POSITION_BUFFER_LAYOUT,
  POSITION_SHADER_LOCATION,
  UV_BUFFER_LAYOUT,
  UV_SHADER_LOCATION,
  VERTEX_ENTRY_POINT,
  unlitShaderSource,
  unlitVertexBufferLayouts,
} from "./wgpu-unlit.js";
export {
  LIGHTS_BIND_GROUP_INDEX,
  LIGHT_AMBIENT_OFFSET,
  LIGHT_CAMERA_OFFSET,
  LIGHT_COLOR_OFFSET,
  LIGHT_COUNTS_OFFSET,
  LIGHT_DIRECTION_OFFSET,
  LIGHT_PUNCTUAL_COLOR_OFFSET,
  LIGHT_PUNCTUAL_DIRECTION_OFFSET,
  LIGHT_PUNCTUAL_PARAMS_OFFSET,
  LIGHT_PUNCTUAL_POSITION_OFFSET,
  LIGHT_UNIFORM_BYTES,
  LIGHT_UNIFORM_FLOATS,
  LIGHT_UNIFORM_STRIDE_BYTES,
  LIGHT_UNIFORM_STRIDE_FLOATS,
  LIGHT_UNIFORM_WGSL,
  PUNCTUAL_LIGHT_WGSL,
  SHADED_MAP_BINDING_WGSL,
  SHADED_MAP_BIND_GROUP_INDEX,
  createLightsBindGroupLayout,
  writeLightUniforms,
} from "./wgpu-lights.js";
export {
  NORMAL_BUFFER_LAYOUT,
  NORMAL_MATRIX_WGSL,
  NORMAL_SHADER_LOCATION,
  litShaderSource,
  shadedVertexBufferLayouts,
  shadedVertexStageWgsl,
} from "./wgpu-lit.js";
export {
  STANDARD_BASE_COLOR_OFFSET,
  STANDARD_EMISSIVE_OFFSET,
  STANDARD_MODEL_OFFSET,
  STANDARD_SURFACE_OFFSET,
  STANDARD_UNIFORM_BYTES,
  STANDARD_UNIFORM_WGSL,
  STANDARD_VIEW_PROJECTION_OFFSET,
  createStandardBindGroupLayout,
  standardShaderSource,
} from "./wgpu-standard.js";
