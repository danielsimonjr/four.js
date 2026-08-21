# @four/assets

Asset system. Part of [four.js](../../README.md).

Implements the MVP tier of §76–78 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 11 (§113a).

## What's here

- **`AssetManager`** — deduplicating, reference-counted cache over an injectable `fetch` (`FetchLike`); concurrent requests for the same URL coalesce into one load, and releasing the last reference disposes the asset.
- **§96 untrusted-content limits** — `maximumBytes` (default `DEFAULT_MAXIMUM_BYTES`, 64 MiB) checked against the declared `content-length` _and_ against the body a loader reads, plus `timeoutSeconds` (default `DEFAULT_TIMEOUT_SECONDS`, 30 s) over transport and decode together, through an injectable `TimerLike`. Both finite by default; see [`docs/guides/security-and-untrusted-content.md`](../../docs/guides/security-and-untrusted-content.md).
- **Cancellation (§76)** — `load(url, loader, { signal })` takes any `AbortSignalLike` (the DOM's `AbortSignal` fits with no adapter). An aborted load rejects with `ASSET_LOAD_FAILED` / `context.reason === "aborted"` and hands back the reference it took, so it must not be released; a coalesced load survives one waiter's abort and is abandoned only when the last one goes; `release` is not `abort`. Pass `abortController: () => new AbortController()` to extend cancellation to the request itself (`canAbortTransport` reports whether it was), which also cancels a request that outran `timeoutSeconds`.
- **Content hashing (§76)** — `load(url, loader, { hashContent: true })` records a hash readable through `contentHash(url, loader)`; `{ expectedHash }` verifies it and **refuses** a mismatch (`context.reason === "hash-mismatch"`), which is the §96 integrity feature. SHA-256 over `crypto.subtle` by default, overridable through `digest`; `canHashContent` reports whether the runtime has one, and a hash that cannot be computed refuses rather than passes. See `src/content-hash.ts` for the algorithm argument.
- **The §79 manifest** — `manifestLoader` / `parseAssetManifest` (a manifest is untrusted content too), `loadFromManifest(assets, manifest, key, loader)` resolving logical key → URL → verified bytes, and `manifestUrl` for the matching `release`.
- **Loaders** — `textLoader`, `jsonLoader`, `binaryLoader`, `createImageLoader` (over an injectable `ImageDecodeLike`), and `createTextureLoader`; `AssetLoader` is the contract a custom loader implements.
- **`ImageAsset` / `TextureAsset`** — disposal wrappers (§83) around a decoded image and around decoded RGBA8 texels. `TextureAsset` is shaped as `@four/render`'s `TextureSource` **structurally** (no dependency edge; `tests/integration/texture-manifest.test.ts` keeps the two spellings honest), carries §60a/§77 `colorSpace`/`filter`/`wrap`, and flips the codec's top-first rows so row 0 is `v = 0` (§7a).
- **§96 decompression limits** — `createTextureLoader` bounds decoded output (`maximumDecodedBytes`, default 64 MiB = 4096²) _and_ expansion ratio (`maximumExpansionRatio`, default 1000×), post-decode by default and pre-decode when an optional `probe` reads the header.

## Staged / not yet implemented

- glTF/GLB loading (§78) — staged with dated notes in `src/loaders.ts`; it needs the §55 texture tier and non-unlit materials, which do not exist yet.
- The rest of the texture system (§77): cube/array/3D targets, mipmaps, anisotropy, compressed containers, render targets, video textures — all renderer-side (`R-30b`). What ships here is the loader tier that feeds it.
- Streaming, worker decoding, and hot reload.
- Dependency graphs and progress reporting — the remaining §76 capabilities, each staged with a dated note in `src/asset-manager.ts`.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/assets`; publishes as `@danielsimonjr/fourjs-assets`.
