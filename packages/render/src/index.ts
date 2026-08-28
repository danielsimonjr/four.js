export const PACKAGE_NAME = "@four/render";

export type {
  BatchableItem,
  BatchableMaterial,
  RenderBatch,
  RenderBatchOptions,
} from "./batch.js";
export { DEFAULT_MAX_BATCH_VERTICES, RenderBatcher } from "./batch.js";

export type { BoundingSphere } from "./bounds.js";
export { computeWorldBoundingSphere } from "./bounds.js";

export type { ClipScope, RenderItemClip, RenderItemStencil } from "./clip.js";
export { ClipPlaneAllocator, MAX_CLIP_PLANES } from "./clip.js";

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
  DirectionalShadowSource,
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
  groupRenderListByPipeline,
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
export type {
  ArcOptions,
  CircleOptions,
  EllipseOptions,
  LineOptions,
  Paint,
  PathShapeOptions,
  PolygonOptions,
  PolylineOptions,
  RectangleOptions,
  RegularPolygonOptions,
  RingOptions,
  SectorOptions,
  ResolvedPaint,
  ResolvedShapeFill,
  ResolvedStrokeStyle,
  Shape2DOptions,
  ShapeFill,
  SolidPaint,
  StarOptions,
  StrokeStyle,
} from "./shape.js";
export {
  Arc,
  Circle,
  Ellipse,
  Line,
  PathShape,
  Polygon,
  Polyline,
  Rectangle,
  RegularPolygon,
  Ring,
  Sector,
  Shape2D,
  Star,
} from "./shape.js";
export type { SpriteFrame, SpriteOptions } from "./sprite.js";
export { Sprite } from "./sprite.js";
export type {
  TextureFilter,
  TextureMinFilter,
  TextureSource,
  TextureWrap,
} from "./texture.js";
export { Texture } from "./texture.js";
export type { ViewRenderListOptions } from "./view-list.js";
export { buildViewRenderList, sortRenderListByDepth } from "./view-list.js";
