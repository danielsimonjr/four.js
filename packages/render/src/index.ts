export const PACKAGE_NAME = "@four/render";

export type {
  ColorGradeEffect,
  CopyEffect,
  EffectRenderPass,
  OutputTransformEffect,
  ScreenEffect,
  ScreenEffectKind,
  ScreenEffectRenderer,
} from "./effect-pass.js";
export {
  COLOR_GRADE_DEFAULTS,
  COPY_EFFECT,
  OUTPUT_TRANSFORM_EFFECT,
  supportsScreenEffects,
  validateEffectRenderPass,
} from "./effect-pass.js";
export type {
  AmbientLightSource,
  DirectionalLightSource,
  PointLightSource,
  PunctualLightSource,
  PunctualLightSourceBase,
  SceneLights,
  SpotLightSource,
} from "./lights.js";
export {
  MAX_PUNCTUAL_LIGHTS,
  collectSceneLights,
  createSceneLights,
  isDirectionalLightSource,
  isPunctualLightSource,
} from "./lights.js";
export type { ParticleDrawable } from "./particles.js";
export {
  PARTICLE_COLOR_OFFSET,
  PARTICLE_INSTANCE_FLOATS,
  PARTICLE_POSITION_OFFSET,
  PARTICLE_SIZE_OFFSET,
  isParticleDrawable,
  particleQuadGeometry,
} from "./particles.js";
export type {
  LitRenderItem,
  ParticleRenderItem,
  RenderItem,
  RenderItemKind,
  SpriteRenderItem,
  StandardRenderItem,
  UnlitRenderItem,
} from "./render-list.js";
export {
  buildInterpolatedRenderList,
  buildRenderList,
  isLitItem,
  isParticlesItem,
  isSpriteItem,
  isStandardItem,
  isUnlitItem,
  viewLayerMask,
} from "./render-list.js";
export type {
  AddPassOptions,
  CustomRenderPass,
  RenderGraphIssue,
  RenderGraphIssueCode,
  RenderGraphIssueSeverity,
  RenderGraphPass,
  RenderPass,
  RenderPassContext,
  SceneRenderPass,
} from "./render-graph.js";
export { RenderGraph } from "./render-graph.js";
export type {
  RenderTargetFormat,
  RenderTargetOptions,
  RenderTargetTexture,
} from "./render-target.js";
export { RenderTarget, isRenderTargetTexture } from "./render-target.js";
export type { RenderableOptions, SurfaceMaterial } from "./renderable.js";
export { Renderable } from "./renderable.js";
export type {
  RendererFallbackReason,
  RendererFallbackReport,
  RendererRegistration,
  RendererResolveOptions,
  RendererSelection,
} from "./renderer-registry.js";
export {
  AUTO_RENDERER_ORDER,
  RendererRegistry,
  clearRegisteredRenderers,
  registerRenderer,
  registeredRenderers,
  resolveRenderer,
} from "./renderer-registry.js";
export type {
  RenderInterpolation,
  Renderer,
  RendererBackend,
  RendererCapabilities,
  RendererEventMap,
  RendererOptions,
  ResizeRecord,
} from "./renderer.js";
export { NullRenderer } from "./renderer.js";
export {
  liveRenderTargetCount,
  liveTextureCount,
  textureMemoryBytes,
} from "./resource-memory.js";
export type {
  RenderStatistics,
  RenderStatisticsReporter,
} from "./statistics.js";
export {
  createRenderStatistics,
  resetRenderStatistics,
  supportsRenderStatistics,
} from "./statistics.js";
export type { SpriteFrame, SpriteOptions } from "./sprite.js";
export { Sprite } from "./sprite.js";
export type { TextureSource } from "./texture.js";
export { Texture } from "./texture.js";
