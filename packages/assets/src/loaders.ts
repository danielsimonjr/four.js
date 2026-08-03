/**
 * The built-in loaders (§76) — text, JSON, binary, image.
 *
 * ```ts
 * const config = await assets.load("/config.json", jsonLoader);
 * const shader = await assets.load("/shaders/basic.frag", textLoader);
 * const bytes  = await assets.load("/data/heights.bin", binaryLoader);
 *
 * // Browser: adapt the platform decoder once, at the edge.
 * const imageLoader = createImageLoader((data) =>
 *   createImageBitmap(new Blob([data])),
 * );
 * const icon = await assets.load("/images/icon.png", imageLoader);
 * ```
 *
 * A loader is a plain value (see `AssetLoader`), so an application's format
 * support is exactly what it imports. The three body loaders are module-level
 * singletons, which is what makes `load(url, jsonLoader)` from two call sites
 * hit one cache slot — cache identity is loader *object* identity.
 *
 * ## Why `createImageLoader` is a factory
 *
 * Image decoding is the one built-in that needs a platform API. `@four/assets`
 * must build and unit-test under plain `lib.es2022` in Node, so this module
 * never names `createImageBitmap`, `Blob`, or `ImageBitmap`: it declares the
 * shapes it needs ({@link ImageDecodeLike}, {@link ImageBitmapLike}) and takes
 * the decoder as an argument. The browser wiring is the two-line adapter above;
 * the tests pass a fake that counts calls and returns a `{ width, height,
 * close() }` object. Nothing about the loader is browser-only — only the
 * decoder the caller supplies is.
 *
 * The factory returns a loader whose asset is an {@link ImageAsset}: a
 * `Disposable` (§83) wrapper that `close()`s the underlying bitmap exactly
 * once. That is deliberate — a raw `ImageBitmap` has `close()`, not
 * `dispose()`, so the asset manager's "release the last reference, dispose the
 * asset" path would silently skip it and leak decoded image memory. Each call
 * to `createImageLoader` produces a **distinct** loader object and therefore a
 * distinct cache slot; hoist it to a module constant if two call sites should
 * share one.
 *
 * ## glTF / GLB — STAGED (dated note, 2026-08-02, WP-11.2)
 *
 * §78 requires the glTF loader to deliver geometry, materials, textures, skins,
 * morph targets, animations, cameras, and light extensions, sharing immutable
 * geometry and textures while never sharing mutable transforms. Three of those
 * have no engine behind them yet: the §77 texture tier (2D/cube/array textures,
 * mipmaps, wrap and filter modes, color-space metadata) does not exist, §55
 * materials beyond the unlit tier do not exist, and skins/morph targets have no
 * representation in `@four/geometry`. A loader that parsed a `.glb` container
 * and returned buffers with nowhere to put them would be a stub wearing the
 * name of a feature — the plan's P11-2 wording ("dishonest to ship as a stub")
 * is the decision, and this note is the record of it. Until then a `.gltf`
 * document is loadable as JSON and a `.glb` as an `ArrayBuffer`, which is
 * exactly what a future loader would build on.
 */

import type { AssetLoader, FetchResponse } from "./asset-manager.js";

/** Loads a response body as UTF-8 text (§76: JSON/SVG/shader sources). */
export const textLoader: AssetLoader<string> = {
  name: "text",
  load(response: FetchResponse): Promise<string> {
    return response.text();
  },
};

/**
 * Loads a response body as parsed JSON (§76).
 *
 * The result is `unknown` on purpose: the bytes came off a network and nothing
 * has validated them. Callers narrow (or run their own schema check) at the one
 * place that knows what the document is supposed to be — a loader that claimed
 * `T` here would be an unchecked cast in a trench coat.
 */
export const jsonLoader: AssetLoader<unknown> = {
  name: "json",
  load(response: FetchResponse): Promise<unknown> {
    return response.json();
  },
};

/**
 * Loads a response body as raw bytes (§76: GLB containers, compressed
 * textures, fonts, audio).
 */
export const binaryLoader: AssetLoader<ArrayBuffer> = {
  name: "binary",
  load(response: FetchResponse): Promise<ArrayBuffer> {
    return response.arrayBuffer();
  },
};

/**
 * The decoded-image shape this package needs: dimensions, and a way to release
 * the decoded memory.
 *
 * The DOM's `ImageBitmap` satisfies it structurally (it has `width`, `height`,
 * and `close()`), so no adapter is needed around a real one.
 */
export interface ImageBitmapLike {
  /** Decoded width in pixels. */
  readonly width: number;
  /** Decoded height in pixels. */
  readonly height: number;
  /** Releases the decoded pixels; idempotent in the DOM. */
  close(): void;
}

/**
 * A `createImageBitmap`-like decoder: encoded bytes in, a decoded bitmap out.
 *
 * Takes an `ArrayBuffer` rather than a `Blob` because that is what a
 * `FetchResponse` yields without naming a DOM type; the browser adapter is
 * `(data) => createImageBitmap(new Blob([data]))`.
 */
export type ImageDecodeLike = (
  data: ArrayBuffer,
) => Promise<ImageBitmapLike> | ImageBitmapLike;

/**
 * A decoded image with an explicit lifetime (§83).
 *
 * Exists so that releasing the last reference in the asset manager actually
 * frees the bitmap: the manager disposes assets that have `dispose()`, and a
 * platform `ImageBitmap` only has `close()`.
 */
export class ImageAsset implements ImageBitmapLike {
  /** The decoded bitmap, for upload to a texture. */
  readonly bitmap: ImageBitmapLike;

  #closed = false;

  constructor(bitmap: ImageBitmapLike) {
    this.bitmap = bitmap;
  }

  /** Decoded width in pixels. */
  get width(): number {
    return this.bitmap.width;
  }

  /** Decoded height in pixels. */
  get height(): number {
    return this.bitmap.height;
  }

  /** Whether {@link dispose} has already closed the bitmap. */
  get isDisposed(): boolean {
    return this.#closed;
  }

  /** Closes the underlying bitmap. Idempotent (§83). */
  dispose(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.bitmap.close();
  }

  /** {@link ImageBitmapLike} conformance; an alias for {@link dispose}. */
  close(): void {
    this.dispose();
  }
}

/**
 * Builds an image loader around a platform decoder.
 *
 * @param decode - The decoder; `(data) => createImageBitmap(new Blob([data]))`
 *   in a browser, a fake in a unit test. May return the bitmap synchronously.
 * @param name - Diagnostics label used in error `context.loader`.
 * @returns A loader producing a `Disposable` {@link ImageAsset}. Each call
 *   returns a distinct object, hence a distinct asset-manager cache slot.
 */
export function createImageLoader(
  decode: ImageDecodeLike,
  name = "image",
): AssetLoader<ImageAsset> {
  return {
    name,
    async load(response: FetchResponse): Promise<ImageAsset> {
      const data = await response.arrayBuffer();
      return new ImageAsset(await decode(data));
    },
  };
}
