/**
 * §61's `readPixels` seam, backend-independent half (2026-08-29).
 *
 * The member itself is declared on {@link Renderer} — optional, presence is
 * the capability — and each backend owns its mechanism (`wgpu-readback.ts`'s
 * `copyTextureToBuffer` + `mapAsync`; the WebGL backend's wrapped
 * `gl.readPixels`). What is backend-*independent* lives here, in the
 * discipline `effect-pass.ts` set for `renderEffect`:
 *
 * - the structural capability interface and its duck-typed guard, so a caller
 *   can narrow the optional member without `@four/render` naming any backend
 *   (§61);
 * - the §85 region check, shared so every backend refuses the same malformed
 *   region with the same words — one refusal, stated once, exactly as
 *   `validateColorSpace` is shared by `RenderTarget` and `Texture`.
 *
 * The region's coordinate space is part of the `Renderer.readPixels` contract
 * (texels from the target's **bottom-left**, +Y up, §7a) and is documented
 * there; this module only checks the numbers.
 */

import type { Rectangle2 } from "@four/math";

import type { RenderTarget } from "./render-target.js";

/**
 * A renderer that can read a target's pixels back — the structural capability
 * (§61, §92).
 *
 * Written as its own interface, and as an **optional** member of
 * {@link Renderer}, for the reasons `statistics.ts` gives for
 * `RenderStatisticsReporter`: adding a required member to a published
 * interface breaks every implementor, and a backend with no readable pixels
 * (the null tier, §62's SVG tier) should be able to say so by omission rather
 * than by fabricating bytes.
 */
export interface PixelReader {
  /**
   * Reads `target`'s colour attachment — or `region` of it — back as tightly
   * packed RGBA8 bytes, rows bottom-to-top. See {@link Renderer.readPixels}
   * for the full contract; the promise shape, row order, and rejection rules
   * are identical on every backend.
   */
  readPixels(target: RenderTarget, region?: Rectangle2): Promise<ArrayBuffer>;
}

/**
 * Whether `renderer` can read pixels back, narrowing it so
 * {@link PixelReader.readPixels} can be called.
 *
 * A property test rather than an `instanceof`: backends are separate packages
 * and `@four/render` must not name any of them (§61) — the same duck-typed
 * discipline as {@link supportsScreenEffects} and
 * {@link supportsRenderStatistics}.
 */
export function supportsReadPixels<TRenderer extends object>(
  renderer: TRenderer,
): renderer is TRenderer & PixelReader {
  return typeof (renderer as Partial<PixelReader>).readPixels === "function";
}

/**
 * Runs the §85 checks for a `readPixels` region against the size the target's
 * attachments actually have. Throws a `RangeError` on the first violation —
 * inside a backend's `readPixels` that surfaces as a rejection, per the
 * member's contract.
 *
 * A region must be integer-valued (texels, not fractions of them), non-empty
 * (an empty read has no defined byte length that is not zero, and a caller
 * who wants nothing should not call), and lie wholly inside the target — a
 * read that hangs off the edge would have to invent texels no attachment
 * holds. Shared by every backend so the refusal is one refusal (§62).
 */
export function validateReadbackRegion(
  region: Rectangle2,
  width: number,
  height: number,
): void {
  const components: readonly (readonly [string, number])[] = [
    ["x", region.x],
    ["y", region.y],
    ["width", region.width],
    ["height", region.height],
  ];
  for (const [name, value] of components) {
    if (!Number.isInteger(value)) {
      throw new RangeError(
        `readPixels region ${name} must be an integer number of texels; got ` +
          `${String(value)} (§61, §85).`,
      );
    }
  }
  if (region.width < 1 || region.height < 1) {
    throw new RangeError(
      "readPixels region must be non-empty: width and height must be at " +
        `least 1; got ${String(region.width)} × ${String(region.height)} ` +
        "(§61, §85).",
    );
  }
  if (
    region.x < 0 ||
    region.y < 0 ||
    region.x + region.width > width ||
    region.y + region.height > height
  ) {
    throw new RangeError(
      `readPixels region [${String(region.x)}, ${String(region.y)}] + ` +
        `${String(region.width)} × ${String(region.height)} does not lie ` +
        `inside the ${String(width)} × ${String(height)} target (§61, §85).`,
    );
  }
}
