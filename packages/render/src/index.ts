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
  ComputeBinding,
  ComputeBindingAccess,
  ComputeBuffer,
  ComputeDispatcher,
  ComputePassDescriptor,
} from "./compute.js";
export { COMPUTE_ENTRY_POINT, supportsCompute } from "./compute.js";

export type {
  ColorGradeEffect,
  CopyEffect,
  EffectRenderPass,
  GraphEffect,
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
  NodeRenderItem,
  ParticleRenderItem,
  RenderItem,
  RenderItemKind,
  SkinnedLitRenderItem,
  SkinnedUnlitRenderItem,
  SpriteRenderItem,
  StandardRenderItem,
  UnlitRenderItem,
} from "./render-list.js";
export {
  buildInterpolatedRenderList,
  buildRenderList,
  groupRenderListByPipeline,
  isLitItem,
  isNodeItem,
  isParticlesItem,
  isSkinnedLitItem,
  isSkinnedUnlitItem,
  isSpriteItem,
  isStandardItem,
  isUnlitItem,
  viewLayerMask,
} from "./render-list.js";

// §60's shader-graph IR (RFC 0001), re-exported from `@four/materials` so a
// backend reads it through the package it already depends on — `render-webgl`'s
// frozen §3.1 row is `core, math, render`, and this re-export is what keeps a
// GLSL emitter legal there without a new edge (the RFC's own legality
// argument, and the §62-registry precedent). Types and the pure analysis
// functions only; `NodeMaterial` itself stays a `@four/materials` export, and
// backends meet it through the `NodeRenderItem` union member.
export type {
  ShaderAttributeName,
  ShaderBinaryOp,
  ShaderDomain,
  ShaderGraph,
  ShaderGraphAnalysis,
  ShaderNode,
  ShaderNodeId,
  ShaderReflection,
  ShaderTextureReflection,
  ShaderUnaryOp,
  ShaderUniformReflection,
  ShaderValueType,
} from "@four/materials";
export {
  MAX_SHADER_GRAPH_NODES,
  MAX_SHADER_GRAPH_TEXTURES,
  SHADER_ATTRIBUTE_TYPES,
  SHADER_VALUE_COMPONENTS,
  analyzeShaderGraph,
  forEachShaderNodeReference,
} from "@four/materials";
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
// §77a raster painting (RFC 0004). Nothing on the render path references this
// module — a backend meets a `CanvasTexture` only through `MaterialTexture`,
// which is what keeps the tier at 0 B in every bundle that never paints.
export type {
  CanvasTextureOptions,
  RasterOrigin,
  RasterSource,
} from "./raster.js";
export { CanvasTexture } from "./raster.js";
export type { PickRequest, PickResult, PickingService } from "./picking.js";
export {
  MAX_PICK_CANDIDATES,
  assertEncodableCandidateCount,
  collectPickCandidates,
  decodePickId,
  encodePickId,
  supportsPicking,
} from "./picking.js";
export type {
  RenderTargetFormat,
  RenderTargetOptions,
  RenderTargetTexture,
} from "./render-target.js";
export { RenderTarget, isRenderTargetTexture } from "./render-target.js";
export type { RenderableOptions, SurfaceMaterial } from "./renderable.js";
export { Renderable } from "./renderable.js";
export { MAX_SKINNING_JOINTS, Mesh, restoreMeshSkeleton } from "./mesh.js";
export type {
  RendererCapabilityDeclaration,
  RendererCapabilityName,
  RendererCapabilityShortfall,
  RendererFallbackReason,
  RendererFallbackReport,
  RendererRegistration,
  RendererResolveOptions,
  RendererSelection,
} from "./renderer-registry.js";
export {
  AUTO_RENDERER_ORDER,
  RENDERER_CAPABILITY_NAMES,
  RendererRegistry,
  clearRegisteredRenderers,
  missingCapabilities,
  registerRenderer,
  registeredRenderers,
  resolveRenderer,
  validateCapabilityDeclaration,
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
  GradientStop,
  LinearGradientPaint,
  LineOptions,
  ObjectPaint,
  Paint,
  PathShapeOptions,
  PatternPaint,
  PolygonOptions,
  PolylineOptions,
  RadialGradientPaint,
  RectangleOptions,
  RegularPolygonOptions,
  RingOptions,
  SectorOptions,
  ResolvedGradientStop,
  ResolvedLinearGradientPaint,
  ResolvedObjectPaint,
  ResolvedPaint,
  ResolvedPatternPaint,
  ResolvedRadialGradientPaint,
  ResolvedShapeFill,
  ResolvedSolidPaint,
  ResolvedStrokeStyle,
  Shape2DOptions,
  ShapeFill,
  ShapePaintPlan,
  ShapePaintSupport,
  SolidPaint,
  StarOptions,
  StrokeStyle,
} from "./shape.js";
export {
  Arc,
  Circle,
  clearRegisteredShapePaints,
  Ellipse,
  Line,
  PathShape,
  Polygon,
  Polyline,
  Rectangle,
  RegularPolygon,
  resolveShapePaintSupport,
  Ring,
  Sector,
  setShapePaintSupport,
  Shape2D,
  Star,
} from "./shape.js";
export { registerShapePaints } from "./shape-paint.js";
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
