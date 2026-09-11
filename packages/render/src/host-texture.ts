import { FourError } from "@fourjs/core";
import { Rectangle2 } from "@fourjs/math";
import { DEFAULT_RASTER_MAXIMUM_BYTES } from "./raster-limits.js";
import {
  Texture,
  validateTextureSource,
  type TextureSource,
} from "./texture.js";

/** Minimal Canvas/OffscreenCanvas read surface; no DOM dependency in the engine. */
export interface ImageReadSurface {
  width: number;
  height: number;
  getContext(kind: "2d"): {
    drawImage(image: object, x: number, y: number): void;
    clearRect(x: number, y: number, width: number, height: number): void;
    getImageData(
      x: number,
      y: number,
      width: number,
      height: number,
    ): { readonly data: Uint8ClampedArray | Uint8Array };
  } | null;
}

/** A supplied surface keeps DOM discovery, threading, and ownership in the host. */
export interface HostTextureOptions extends Pick<
  TextureSource,
  | "colorSpace"
  | "role"
  | "filter"
  | "wrap"
  | "mipmaps"
  | "minFilter"
  | "anisotropy"
> {
  readonly surface: ImageReadSurface;
  readonly maximumBytes?: number;
}

function checkedSource(
  width: number,
  height: number,
  options: HostTextureOptions,
): TextureSource {
  const {
    surface: _surface,
    maximumBytes = DEFAULT_RASTER_MAXIMUM_BYTES,
    ...sampler
  } = options;
  if (
    !(maximumBytes > 0) ||
    !Number.isSafeInteger(width * height * 4) ||
    width * height * 4 > maximumBytes
  ) {
    throw new RangeError(
      "Host texture exceeds maximumBytes or has an invalid byte count.",
    );
  }
  const source = { width, height, role: "color" as const, ...sampler };
  validateTextureSource(source);
  return source;
}

/** Canvas readback has straight alpha and top-first rows; texture rows are bottom-first. */
function readImage(
  image: object,
  source: TextureSource,
  surface: ImageReadSurface,
  out?: Uint8Array,
): Uint8Array {
  const { width, height } = source;
  if (surface.width !== width) surface.width = width;
  if (surface.height !== height) surface.height = height;
  const context = surface.getContext("2d");
  if (context === null)
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      "Host texture needs a readable 2D surface.",
    );
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0);
  const bytes = context.getImageData(0, 0, width, height).data;
  if (bytes.length !== width * height * 4)
    throw new RangeError(
      "Host image reader returned an invalid RGBA8 byte count.",
    );
  const data = out ?? new Uint8Array(bytes.length);
  const stride = width * 4;
  for (let row = 0; row < height; row++)
    data.set(
      bytes.subarray(row * stride, (row + 1) * stride),
      (height - 1 - row) * stride,
    );
  return data;
}

/**
 * Copies an ImageBitmap (or other width/height image) into restorable RGBA8 storage.
 * The caller owns the image and surface; closing the bitmap after construction is safe.
 * Browser use: `new ImageBitmapTexture(bitmap, { surface: new OffscreenCanvas(1, 1) })`.
 * Canvas security exceptions propagate; this does not bypass cross-origin restrictions.
 */
export class ImageBitmapTexture extends Texture {
  constructor(
    image: { readonly width: number; readonly height: number },
    options: HostTextureOptions,
  ) {
    const source = checkedSource(image.width, image.height, options);
    const data = readImage(image, source, options.surface);
    super({ ...source, data });
  }
}

/** HTMLVideoElement's frame-notification seam, also implementable in headless hosts. */
export interface VideoTextureSource {
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly readyState: number;
  readonly currentTime: number;
  requestVideoFrameCallback?(callback: () => void): number;
  cancelVideoFrameCallback?(handle: number): void;
}

/**
 * A restorable video texture. Frame callbacks only invalidate; the application calls
 * update() before rendering. Without callbacks, currentTime is the fallback signal.
 * The video and read surface remain caller-owned. New video dimensions are validated
 * against maximumBytes before any canvas or texture allocation changes.
 */
export class VideoTexture extends Texture {
  readonly #video: VideoTextureSource;
  readonly #options: HostTextureOptions;
  #dirty = true;
  #time = Number.NaN;
  #callback: number | null = null;

  constructor(video: VideoTextureSource, options: HostTextureOptions) {
    const ready = video.readyState >= 2;
    super(
      checkedSource(
        ready ? video.videoWidth : 1,
        ready ? video.videoHeight : 1,
        options,
      ),
    );
    this.#video = video;
    this.#options = { ...options };
    this.#requestFrame();
  }

  /** Explicit signal for hosts without a frame callback or for a paused-frame edit. */
  invalidate(): void {
    this.#dirty = true;
  }

  update(): boolean {
    if (this.disposed)
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "Cannot update a disposed VideoTexture.",
      );
    const video = this.#video;
    if (video.readyState < 2) return false;
    const resized =
      video.videoWidth !== this.width || video.videoHeight !== this.height;
    if (
      !this.#dirty &&
      !resized &&
      (video.requestVideoFrameCallback !== undefined ||
        video.currentTime === this.#time)
    )
      return false;
    const source = checkedSource(
      video.videoWidth,
      video.videoHeight,
      this.#options,
    );
    const data = readImage(
      video,
      source,
      this.#options.surface,
      resized ? undefined : (this.data ?? undefined),
    );
    if (resized || this.data === null) this.source = { ...source, data };
    else this.markDirty(new Rectangle2(0, 0, this.width, this.height));
    this.#time = video.currentTime;
    this.#dirty = false;
    return true;
  }

  override dispose(): void {
    if (this.#callback !== null)
      this.#video.cancelVideoFrameCallback?.(this.#callback);
    this.#callback = null;
    super.dispose();
  }

  #requestFrame(): void {
    if (this.disposed || this.#video.requestVideoFrameCallback === undefined)
      return;
    this.#callback = this.#video.requestVideoFrameCallback(() => {
      this.#callback = null;
      if (this.disposed) return;
      this.#dirty = true;
      this.#requestFrame();
    });
  }
}
