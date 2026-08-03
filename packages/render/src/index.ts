export const PACKAGE_NAME = "@four/render";

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
  ParticleRenderItem,
  RenderItem,
  RenderItemKind,
  SpriteRenderItem,
  UnlitRenderItem,
} from "./render-list.js";
export {
  buildInterpolatedRenderList,
  buildRenderList,
  isParticlesItem,
  isSpriteItem,
  isUnlitItem,
} from "./render-list.js";
export type { RenderableOptions } from "./renderable.js";
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
export type { SpriteOptions } from "./sprite.js";
export { Sprite } from "./sprite.js";
export type { TextureSource } from "./texture.js";
export { Texture } from "./texture.js";
