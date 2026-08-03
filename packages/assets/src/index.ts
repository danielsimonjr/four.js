/**
 * `@four/assets` — the asset system (§76–78).
 *
 * Phase 11 (WP-11.2) ships the MVP tier: a deduplicating, reference-counted
 * {@link AssetManager} over an injectable `fetch`, plus text, JSON, binary, and
 * image loaders. glTF/GLB (§78) and the texture system (§77) are staged with
 * dated notes in `loaders.ts` and `asset-manager.ts` — they need the §55
 * material tier and a texture representation that do not exist yet.
 */

export const PACKAGE_NAME = "@four/assets";

export type {
  AssetLoader,
  AssetManagerOptions,
  FetchLike,
  FetchResponse,
} from "./asset-manager.js";
export { AssetManager } from "./asset-manager.js";
export type { ImageBitmapLike, ImageDecodeLike } from "./loaders.js";
export {
  ImageAsset,
  binaryLoader,
  createImageLoader,
  jsonLoader,
  textLoader,
} from "./loaders.js";
