export const PACKAGE_NAME = "@four/render";

export type {
  AmbientLightSource,
  DirectionalLightSource,
  SceneLights,
} from "./lights.js";
export {
  collectSceneLights,
  createSceneLights,
  isDirectionalLightSource,
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
  UnlitRenderItem,
} from "./render-list.js";
export {
  buildInterpolatedRenderList,
  buildRenderList,
  isLitItem,
  isParticlesItem,
  isSpriteItem,
  isUnlitItem,
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
  RenderInterpolation,
  Renderer,
  RendererBackend,
  RendererCapabilities,
  RendererEventMap,
  RendererOptions,
  ResizeRecord,
} from "./renderer.js";
export { NullRenderer } from "./renderer.js";
export type {
  RenderStatistics,
  RenderStatisticsReporter,
} from "./statistics.js";
export {
  createRenderStatistics,
  resetRenderStatistics,
  supportsRenderStatistics,
} from "./statistics.js";
export type { SpriteOptions } from "./sprite.js";
export { Sprite } from "./sprite.js";
export type { TextureSource } from "./texture.js";
export { Texture } from "./texture.js";
