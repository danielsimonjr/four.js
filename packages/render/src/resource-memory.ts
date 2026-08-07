/**
 * §83 resource accounting for textures and render targets — how many are live,
 * and how many bytes they hold (A-5, 2026-08-07).
 *
 * The twin of `@four/geometry`'s `resource-memory.ts`, which documents the
 * design in full: **numbers, not references**, so the tracker cannot itself
 * become the leak it reports; process-wide rather than per-application, because
 * a texture belongs to whoever created it (§83) and two applications sharing an
 * atlas share its bytes; absolute and never reset, because these are levels
 * rather than per-frame accumulations; and never healed by garbage collection,
 * because §83's contract is that lifetimes are *explicit* and a total that
 * forgave a missing `dispose()` would hide the leak it exists to reveal.
 *
 * `@four/diagnostics` bridges {@link textureMemoryBytes} into §84's
 * `app.stats.textureMemory` through `recordResourceMemory`.
 *
 * ## Why targets are counted with textures
 *
 * §84 names two memory counters, `textureMemory` and `bufferMemory`, and a
 * render target's attachments are neither vertex buffers nor anything else:
 * they are a colour texture plus, usually, a depth surface, allocated by the
 * same backend that allocates {@link Texture} uploads. So
 * {@link textureMemoryBytes} is the sum of both populations, and
 * {@link liveTextureCount} and {@link liveRenderTargetCount} keep them
 * separable for anyone asking which one is growing.
 *
 * ## What the byte count is, and is not
 *
 * It is the size of the surfaces the live resources *describe* — what a backend
 * allocates for them — computed from the size and format each one already
 * carries. It is **not** a query of the driver: a texture created and never
 * sampled has not been uploaded yet, and a backend keeps a disposed texture's
 * object until the next frame that meets it. The accounted number is what the
 * engine holds and would upload, which is the number §83's leak question is
 * about, and it is exact rather than approximate.
 */

/** Live (constructed, undisposed) `Texture` instances. */
let liveTextures = 0;

/** Bytes described by those textures. */
let liveTextureBytes = 0;

/** Live (constructed, undisposed) `RenderTarget` instances. */
let liveRenderTargets = 0;

/** Bytes described by those targets, attachments included. */
let liveRenderTargetBytes = 0;

/**
 * Records a change to the live texture accounting: `instances` is `+1` at
 * construction, `-1` at disposal, and `0` for a mutation; `bytes` is the signed
 * change in described bytes.
 *
 * Internal to `@four/render` — exported so `texture.ts` can reach it,
 * deliberately absent from the package index, exactly as `@four/math`'s
 * `noteConstruction` is.
 */
export function noteTexture(instances: number, bytes: number): void {
  liveTextures += instances;
  liveTextureBytes += bytes;
}

/**
 * Records a change to the live render-target accounting. See
 * {@link noteTexture}; internal to `@four/render`, reached by
 * `render-target.ts`.
 */
export function noteRenderTarget(instances: number, bytes: number): void {
  liveRenderTargets += instances;
  liveRenderTargetBytes += bytes;
}

/**
 * Bytes described by every live texture **and** every live render target —
 * §84's `textureMemory` (§83).
 *
 * ```ts
 * const before = textureMemoryBytes();
 * const atlas = new Texture({ width: 256, height: 256 });
 * textureMemoryBytes() - before; // === atlas.byteLength === 256 * 256 * 4
 * atlas.dispose();
 * textureMemoryBytes(); // === before
 * ```
 *
 * Reading it allocates nothing and costs two property reads and an addition, so
 * a diagnostics overlay may sample it every frame.
 */
export function textureMemoryBytes(): number {
  return liveTextureBytes + liveRenderTargetBytes;
}

/**
 * How many textures have been constructed and not yet disposed (§83) — the
 * instance-count half of the accounting, and the "leaked textures" warning §83
 * asks for when it grows across identical frames.
 */
export function liveTextureCount(): number {
  return liveTextures;
}

/**
 * How many render targets have been constructed and not yet disposed (§83).
 * Separate from {@link liveTextureCount} because the two leak for different
 * reasons — an undisposed atlas is an asset-lifetime mistake, an undisposed
 * target is usually a resize that re-created instead of resizing.
 */
export function liveRenderTargetCount(): number {
  return liveRenderTargets;
}
