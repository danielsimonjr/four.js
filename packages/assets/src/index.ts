/**
 * `@four/assets` — the asset system (§76–78).
 *
 * Phase 11 (WP-11.2) ships the MVP tier: a deduplicating, reference-counted
 * {@link AssetManager} over an injectable `fetch`, plus text, JSON, binary, and
 * image loaders. glTF/GLB (§78) and the texture system (§77) are staged with
 * dated notes in `loaders.ts` and `asset-manager.ts` — they need the §55
 * material tier and a texture representation that do not exist yet.
 *
 * §96's "asset loaders … shall treat external content as untrusted" is enforced
 * by the manager, not the loaders: an input-size limit
 * ({@link DEFAULT_MAXIMUM_BYTES}) and a whole-load deadline
 * ({@link DEFAULT_TIMEOUT_SECONDS}), both finite by default, both overridable
 * per manager. See `docs/guides/security-and-untrusted-content.md`.
 *
 * Content hashing (§76) and the §79 manifest landed on 2026-08-21, together
 * with the texture loader tier (§77's assets half): `load(url, loader, {
 * expectedHash })` refuses bytes that are not the bytes a manifest named, and
 * {@link createTextureLoader} turns encoded images into `TextureSource`-shaped
 * {@link TextureAsset}s under §96 decompression bounds. See `content-hash.ts`,
 * `manifest.ts`, and `texture.ts`.
 *
 * §76's cancellation landed on 2026-08-09: `load(url, loader, { signal })`
 * rejects and gives back its reference, and — when the manager was built with an
 * {@link AssetManagerOptions.abortController} — the last waiter's abort cancels
 * the request itself. The rules are in `asset-manager.ts`'s module comment.
 */

export const PACKAGE_NAME = "@four/assets";

export type {
  AbortHandle,
  AbortSignalLike,
  AssetLoadOptions,
  AssetLoader,
  AssetManagerOptions,
  FetchInit,
  FetchLike,
  FetchResponse,
  ResponseHeadersLike,
  TimerLike,
} from "./asset-manager.js";
export {
  AssetManager,
  DEFAULT_MAXIMUM_BYTES,
  DEFAULT_TIMEOUT_SECONDS,
} from "./asset-manager.js";
export type { DigestLike, TextDecodeLike } from "./content-hash.js";
export { CONTENT_HASH_ALGORITHM } from "./content-hash.js";
export type {
  AssetManifest,
  AssetManifestEntry,
  ManifestLoadOptions,
} from "./manifest.js";
export {
  loadFromManifest,
  manifestLoader,
  manifestUrl,
  parseAssetManifest,
} from "./manifest.js";
export type {
  DecodedTexels,
  TexelDecodeLike,
  TexelProbeLike,
  TextureColorSpace,
  TextureFilterMode,
  TextureLoaderOptions,
  TextureWrapMode,
} from "./texture.js";
export {
  DEFAULT_MAXIMUM_DECODED_BYTES,
  DEFAULT_MAXIMUM_EXPANSION_RATIO,
  TextureAsset,
  createTextureLoader,
} from "./texture.js";
export type { ImageBitmapLike, ImageDecodeLike } from "./loaders.js";
export {
  ImageAsset,
  binaryLoader,
  createImageLoader,
  jsonLoader,
  textLoader,
} from "./loaders.js";
