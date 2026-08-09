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
export type { ImageBitmapLike, ImageDecodeLike } from "./loaders.js";
export {
  ImageAsset,
  binaryLoader,
  createImageLoader,
  jsonLoader,
  textLoader,
} from "./loaders.js";
