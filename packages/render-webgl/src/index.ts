/**
 * `@four/render-webgl` — the WebGL 2 backend (§62 backend 2, §120's MVP tier).
 *
 * The public surface is one class, {@link WebglRenderer}, which implements
 * `@four/render`'s `Renderer`. Everything else exported here is exported
 * because a *test*, a diagnostic, or a future second pipeline in this package
 * needs it — `GL`, `WebglContext`, `UnlitProgram`, and `GeometryCache` are the
 * seams that let the whole backend be unit-tested against a hand-rolled fake
 * context with no GPU and no browser (see `tests/webgl-renderer.test.ts`).
 *
 * Applications select a backend at the edge (§62); nothing in `@four/scene`,
 * `@four/motion`, or `@four/physics` may name anything in this package.
 */

export const PACKAGE_NAME = "@four/render-webgl";

export type { BatchGlContext, RenderBatching } from "./gl-batch.js";
export { GlBatching, createGlBatching } from "./gl-batch.js";
export {
  EFFECT_TEXTURE_UNIT,
  EFFECT_VERTEX_COUNT,
  EffectProgram,
} from "./gl-effect.js";
export type { CacheableGeometry, GeometryRecord } from "./gl-geometry.js";
export { GeometryCache } from "./gl-geometry.js";
export type { ParticleBatchRecord, ParticleGlContext } from "./gl-particles.js";
export {
  PARTICLE_ATTRIBUTE_LOCATIONS,
  PARTICLE_GL,
  ParticleBatchCache,
  ParticleProgram,
} from "./gl-particles.js";
export type {
  GlBuffer,
  GlProgramHandle,
  GlShader,
  GlSync,
  GlTexture,
  GlUniformLocation,
  GlVertexArray,
  WebglContext,
} from "./gl-program.js";
export type { GlFramebuffer, GlRenderbuffer } from "./gl-program.js";
export {
  COLOR_ATTRIBUTE_LOCATION,
  GL,
  LitProgram,
  MAP_TEXTURE_UNIT,
  METAL_ROUGHNESS_TEXTURE_UNIT,
  NORMAL_ATTRIBUTE_LOCATION,
  POSITION_ATTRIBUTE_LOCATION,
  PUNCTUAL_LIGHT_GLSL,
  PunctualLightUniforms,
  SHADOW_GLSL,
  SHADOW_TEXTURE_UNIT,
  ShadowUniforms,
  SpriteProgram,
  UV_ATTRIBUTE_LOCATION,
  UnlitProgram,
} from "./gl-program.js";
export type {
  PickingRendererHost,
  PickingServiceFactory,
} from "./gl-picking-registry.js";
export {
  clearRegisteredPickingPipeline,
  resolvePickingServiceFactory,
} from "./gl-picking-registry.js";
// §71's picking pipeline (RFC 0005). Deliberately — like the skinned and
// node-material pipelines above and below — a module `WebglRenderer` never
// reaches statically: importing `registerPickingPipeline` is what links the
// id program, the service, and its fence read-back into a bundle, and a
// barrel re-export does not (it tree-shakes like every other unused export)
// — see `gl-picking-registry.ts` for the whole seam.
export {
  IdPassProgram,
  PICKING_GL,
  WebglPickingService,
  registerPickingPipeline,
} from "./gl-picking.js";
export type {
  CacheableRenderTarget,
  RenderTargetRecord,
} from "./gl-render-target.js";
export { RenderTargetCache } from "./gl-render-target.js";
export {
  JOINTS_ATTRIBUTE_LOCATION,
  WEIGHTS_ATTRIBUTE_LOCATION,
} from "./gl-program.js";
export type {
  SkinnedLitPipeline,
  SkinnedPrograms,
  SkinnedUnlitPipeline,
  SkinningPipelineFactory,
} from "./gl-skinning-registry.js";
export {
  clearRegisteredSkinningPipeline,
  resolveSkinningPipelineFactory,
} from "./gl-skinning-registry.js";
// The skinned pipeline itself (§54; RFC 0003). Deliberately the **only**
// module here that `WebglRenderer` does not reach statically: importing
// `registerSkinningPipeline` is what links the two skinned programs into a
// bundle, and a barrel re-export does not (it tree-shakes like every other
// unused export) — see `gl-skinning-registry.ts` for the whole seam.
export {
  SkinnedLitProgram,
  SkinnedUnlitProgram,
  registerSkinningPipeline,
} from "./gl-skinning.js";
export type {
  NodeItemMaterial,
  NodeMaterialPipelineFactory,
  NodeMaterialProgram,
  NodeMaterialPrograms,
} from "./node-pipeline-registry.js";
export {
  NODE_SURFACE_TEXTURE_UNIT_BASE,
  clearRegisteredNodeMaterialPipeline,
  resolveNodeMaterialPipelineFactory,
} from "./node-pipeline-registry.js";
// §60's node pipeline (RFC 0001). Deliberately — like the skinned pipeline
// above — a module `WebglRenderer` never reaches statically: importing
// `registerNodeMaterialPipeline` is what links the GLSL emitter and the
// program cache into a bundle, and a barrel re-export does not (it
// tree-shakes like every other unused export) — see
// `node-pipeline-registry.ts` for the whole seam.
export type { EmittedNodeShader } from "./gl-node-program.js";
export {
  GlNodeProgram,
  GlNodeProgramCache,
  emitShaderGraphGlsl,
  registerNodeMaterialPipeline,
} from "./gl-node-program.js";
export { ShadowProgram } from "./gl-shadow.js";
export { StandardProgram } from "./gl-standard.js";
export type { CacheableTexture, TextureRecord } from "./gl-texture.js";
export { TextureCache } from "./gl-texture.js";
export { isWebgl2Supported, registerWebglRenderer } from "./register.js";
export type {
  WebglCanvas,
  WebglContextAttributes,
  WebglContextEventLike,
} from "./webgl-renderer.js";
export { WebglRenderer } from "./webgl-renderer.js";
