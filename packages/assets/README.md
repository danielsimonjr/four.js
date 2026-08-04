# @four/assets

Asset system. Part of [four.js](../../README.md).

Implements the MVP tier of §76–78 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 11 (§113a).

## What's here

- **`AssetManager`** — deduplicating, reference-counted cache over an injectable `fetch` (`FetchLike`); concurrent requests for the same URL coalesce into one load, and releasing the last reference disposes the asset.
- **Loaders** — `textLoader`, `jsonLoader`, `binaryLoader`, and `createImageLoader` (over an injectable `ImageDecodeLike`); `AssetLoader` is the contract a custom loader implements.
- **`ImageAsset`** — disposal wrapper around a decoded image (`ImageBitmapLike`).

## Staged / not yet implemented

- glTF/GLB loading (§78) — staged with dated notes in `src/loaders.ts`; it needs the §55 texture tier and non-unlit materials, which do not exist yet.
- The texture system (§77).
- Streaming, worker decoding, and hot reload.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/assets`; publishes as `@danielsimonjr/fourjs-assets`.
