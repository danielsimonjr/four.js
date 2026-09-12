import { FourError } from "@fourjs/core";
import type { AssetLoader, ByteReaderLike } from "./asset-manager.js";
import {
  DEFAULT_MAXIMUM_DECODED_BYTES,
  DEFAULT_MAXIMUM_EXPANSION_RATIO,
} from "./texture.js";

/** Pull-based decoder output. Cancellation must stop further decompression. */
export interface GzipReader extends ByteReaderLike {
  cancel(reason?: unknown): Promise<void> | void;
}
/**
 * Host gzip decoder. Must validate the complete stream and checksum, rejecting
 * corrupt/truncated input. The host must bound its chunks/internal allocations.
 */
export type GzipDecodeLike = (
  encoded: ArrayBuffer,
) => GzipReader | Promise<GzipReader>;
/** Finite limits checked before retaining each decoded chunk. */
export interface GzipLoaderOptions {
  readonly maximumDecodedBytes?: number;
  readonly maximumExpansionRatio?: number;
}
/**
 * Loads raw gzip assets as bytes (§76, §96), with no browser/native dependency.
 * ```ts
 * const gzip = createGzipLoader((bytes) => new Blob([bytes]).stream()
 *   .pipeThrough(new DecompressionStream("gzip")).getReader());
 * const decoded = await assets.load("/scene.json.gz", gzip);
 * ```
 * Not for HTTP Content-Encoding bodies that fetch already decoded. AssetManager
 * bounds encoded input and the load deadline. Only returns after the decoder's
 * checksum validation. Growing storage plus the final trimmed copy use at most twice the
 * decoded limit, excluding encoded input and the host decoder's buffers.
 */
export function createGzipLoader(
  decode: GzipDecodeLike,
  options: GzipLoaderOptions = {},
): AssetLoader<ArrayBuffer> {
  const maximumDecodedBytes =
    options.maximumDecodedBytes ?? DEFAULT_MAXIMUM_DECODED_BYTES;
  const maximumExpansionRatio =
    options.maximumExpansionRatio ?? DEFAULT_MAXIMUM_EXPANSION_RATIO;
  if (!Number.isSafeInteger(maximumDecodedBytes) || maximumDecodedBytes < 1)
    throw new RangeError(
      "maximumDecodedBytes must be a positive safe integer.",
    );
  if (!Number.isFinite(maximumExpansionRatio) || maximumExpansionRatio <= 0)
    throw new RangeError("maximumExpansionRatio must be finite and positive.");
  return {
    name: "gzip",
    async load(response, url) {
      const encoded = await response.arrayBuffer();
      const header = new Uint8Array(encoded);
      if (
        header.length < 18 ||
        header[0] !== 0x1f ||
        header[1] !== 0x8b ||
        header[2] !== 8 ||
        (header[3] & 0xe0) !== 0
      )
        throw new FourError(
          "UNTRUSTED_INPUT_REJECTED",
          "Invalid gzip header.",
          { context: { url } },
        );
      const limit = Math.min(
        maximumDecodedBytes,
        Math.floor(encoded.byteLength * maximumExpansionRatio),
      );
      let reader: GzipReader | undefined;
      try {
        reader = await decode(encoded);
        let output = new Uint8Array(0);
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array) || value.byteLength === 0)
            throw new TypeError(
              "Gzip decoder must yield nonempty byte chunks.",
            );
          if (value.byteLength > limit - total)
            throw new FourError(
              "UNTRUSTED_INPUT_REJECTED",
              "Gzip output exceeds decompression limits.",
              {
                context: {
                  url,
                  maximumDecodedBytes,
                  maximumExpansionRatio,
                  observed: total + value.byteLength,
                },
              },
            );
          const next = total + value.byteLength;
          if (next > output.byteLength) {
            const capacity = Math.min(
              limit,
              Math.max(next, output.byteLength * 2, 65536),
            );
            const grown = new Uint8Array(capacity);
            grown.set(output);
            output = grown;
          }
          // Copy before requesting the next chunk; decoders may reuse buffers.
          output.set(value, total);
          total = next;
        }
        return total === output.byteLength
          ? output.buffer
          : output.slice(0, total).buffer;
      } catch (cause) {
        try {
          await reader?.cancel(cause);
        } catch {
          /* Preserve the original failure. */
        }
        if (cause instanceof FourError) throw cause;
        throw new FourError(
          "UNTRUSTED_INPUT_REJECTED",
          "Invalid gzip stream or decoder output.",
          { cause, context: { url } },
        );
      } finally {
        reader?.releaseLock?.();
      }
    },
  };
}
