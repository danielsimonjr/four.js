/**
 * `RenderTarget` (§61, §48, §63, §77) — an off-screen surface a frame can be
 * drawn into, and the texture that surface can then be sampled as.
 *
 * §61's renderer interface declares
 * `createRenderTarget(options: RenderTargetOptions): RenderTarget`, §48 gives a
 * viewport an optional `renderTarget`, and §63 makes transient targets the
 * currency the render graph trades in. None of that is expressible while the
 * type itself does not exist, which is what this module fixes: **the minimal
 * render-target tier** — a sized colour surface with an optional depth buffer,
 * a stable identity, a version, and explicit disposal (§83).
 *
 * ```ts
 * const target = new RenderTarget({ width: 512, height: 512 });
 *
 * // Draw the scene from the mirror camera into the target…
 * renderer.render(scene, [mirrorView], undefined, target);
 * // …and sample the result in the next pass.
 * mirrorMaterial.map = target.colorTexture;
 * renderer.render(scene, [mainView]);
 *
 * target.dispose(); // §83
 * ```
 *
 * ## A render target is a CPU-side descriptor; GPU residency is a backend cache
 *
 * This is the same decision `Texture` and `BufferGeometry` already made, taken
 * again for the same reasons and stated here because §61's literal text points
 * the other way (decision, R-4, 2026-08-07).
 *
 * §61 hands render targets out through the *renderer*. That shape means an
 * application cannot describe a target before it has a renderer, must build a
 * second one to render the same view with a second renderer, and must re-create
 * every one of them by hand after a §61 context loss. `@four/render`'s
 * `texture.ts` rejected exactly that trade for textures and left
 * `createTexture` deferred; the WebGL backend's `TextureCache` and
 * `GeometryCache` are the proof that the alternative works. So a
 * {@link RenderTarget} is a plain, backend-free description of *what surface is
 * wanted* — `id`, `version`, size, format — and the backend allocates the
 * framebuffer the first time it is asked to draw into it, keyed on `id` and
 * validated by `version`, exactly as it does for a geometry or a texture. A
 * context loss drops the cache; the next frame re-allocates; the application
 * holds the same `RenderTarget` object throughout and is told nothing, which is
 * what §61's "re-creates engine-owned GPU resources on restore" asks for.
 *
 * {@link RenderTargetOptions} is still declared with §61's name and shape, so
 * the packet that wants a renderer-owned factory can add
 * `createRenderTarget(options)` over this type without re-shaping anything.
 * The typed TODO in `renderer.ts` records it.
 *
 * ## Render-to-texture is the point (R-4 → R-5, R-6)
 *
 * {@link RenderTarget.colorTexture} satisfies `@four/materials`'
 * `MaterialTexture` — the *same* contract `@four/render`'s `Texture` satisfies
 * — so the result of an off-screen pass is assignable to `UnlitMaterial.map`,
 * `LitMaterial.map`, or `SpriteMaterial.texture` with no adapter and no new
 * material type. That single property is what unblocks §48's minimaps,
 * mirrors, portals and 3D-previews-in-2D-UI, §63's transient resources, and
 * §70's post-processing chain: every one of them is "draw into a target, then
 * sample it".
 *
 * A backend has to tell the two apart, because a render-target texture has no
 * CPU-side texels to upload — it *is* the framebuffer's colour attachment.
 * {@link isRenderTargetTexture} is that seam: a marker-property guard, the same
 * duck-typed contract pattern as `isParticleDrawable` and
 * `isDirectionalLightSource`, so no backend needs to name this class and
 * `@four/render` needs no backend type.
 *
 * ## Staged, with the dates (2026-08-07, R-4)
 *
 * Named here rather than sketched, because each one is public shape that a
 * backend, the §79 scene format, and §63's graph would all have to agree on:
 *
 * - **Stencil attachments** (§67) — the WebGL 2 backend requests its context
 *   without a stencil buffer (`stencil: false`), so a stencilled *target* would
 *   be the only stencilled surface in the engine. R-7 owns the whole of §67 and
 *   this option lands with it.
 * - **Multiple render targets** (§63, §70) — one colour attachment here. The
 *   shape it wants is `colorTextures: readonly RenderTargetTexture[]`, which is
 *   why the accessor is named `colorTexture` rather than `texture`.
 * - **Multisampled targets** (§62's capability list) — needs
 *   `renderbufferStorageMultisample` plus a resolve blit, and a capability
 *   query to know it is available at the requested sample count.
 * - **Floating-point and other formats** (§62 "floating-point targets", §60a) —
 *   {@link RenderTargetFormat} is deliberately a one-member union rather than a
 *   `string`, so `format: "rgba16f"` is a compile error today instead of a
 *   silent no-op. Widening the union is how the format tier arrives.
 * - **Depth *textures*** — the depth buffer here is a renderbuffer: writable by
 *   the pass, not samplable afterwards. §69's shadow maps need the samplable
 *   form, and land with it.
 * - **`readPixels`** (§61, §92) — §61 types it `readPixels?(target,
 *   region?: Rectangle2)`, and `Rectangle2` does not exist in `@four/math`
 *   (R-4's own effort note names it). It stays on `renderer.ts`'s typed TODO;
 *   the §92 pixel tier is its first consumer.
 */

import type { Disposable } from "@four/core";
import type { MaterialTexture } from "@four/materials";
import type { ColorSpace } from "@four/math";

import { noteRenderTarget } from "./resource-memory.js";

/**
 * The texel format of a target's colour attachment (§62 "texture formats").
 *
 * One member, on purpose: `"rgba8"` is what this tier allocates, and a union of
 * exactly the supported values makes an unsupported request a *type* error
 * rather than a silent downgrade at allocation time. §62's floating-point and
 * compressed tiers widen it.
 */
export type RenderTargetFormat = "rgba8";

/**
 * What a {@link RenderTarget} is asked for (§61's `RenderTargetOptions`).
 *
 * ```ts
 * const shadowish = new RenderTarget({ width: 1024, height: 1024 });
 * const flat = new RenderTarget({ width: 256, height: 256, depth: false });
 * ```
 */
export interface RenderTargetOptions {
  /** Width in texels. A finite integer ≥ 1 (§85). */
  readonly width: number;

  /** Height in texels. A finite integer ≥ 1 (§85). */
  readonly height: number;

  /**
   * Colour format of the attachment. Defaults to `"rgba8"`, which is also the
   * only value this tier accepts — see {@link RenderTargetFormat}.
   */
  readonly format?: RenderTargetFormat;

  /**
   * Whether the target carries a depth buffer. **Defaults to `true`.**
   *
   * The default is `true` rather than `false` because the shared
   * `Renderer.render` contract clears depth for every view "whenever the
   * backend has a depth buffer", and the on-screen surface always has one: a
   * target that silently had none would make the same scene draw *differently*
   * off-screen — 3D geometry composited in submission order instead of by
   * depth — which is the class of difference a render-to-texture pass exists to
   * avoid. Pass `false` for a pass that is provably flat (a full-screen
   * composite, a 2D UI layer) and save the allocation.
   *
   * The depth buffer is a renderbuffer: written by the pass, not samplable
   * afterwards. §69's samplable depth is staged — see the module header.
   */
  readonly depth?: boolean;

  /**
   * The colour space the attachment's texels are in — §60a's "render targets
   * carry color-space metadata" (R-15, 2026-08-08).
   *
   * **Defaults to `"linear"`**: everything this engine renders is linear-light
   * working-space content (§60a), so an off-screen target is by default an
   * intermediate surface in that pipeline rather than a presentable image. Tag
   * a target `"srgb"` when it is the *destination of the output transform* —
   * the surface §60a's final render-graph pass encodes into — so that
   * {@link validateEffectRenderPass} can tell an encode into an already-encoded
   * surface (a double encode) from an encode into a linear one.
   *
   * Metadata, not behaviour: this tier's only colour format is `rgba8` and the
   * bytes are whatever was written into them. What the tag changes is what the
   * *graph* accepts, which is where a colour-space mistake is catchable at
   * setup (§85) instead of visible as a washed-out frame.
   */
  readonly colorSpace?: ColorSpace;
}

/**
 * A {@link RenderTarget}'s colour attachment, seen as a texture (§77, §61).
 *
 * Extends `MaterialTexture` — the contract `@four/materials` declares and
 * `@four/render`'s `Texture` implements — so this is assignable to any material
 * slot that takes a texture, which is the whole point of the type. Two things
 * distinguish it, and both are load-bearing for a backend:
 *
 * - **`data` is always `null`.** There are no CPU-side texels: the pixels live
 *   in the framebuffer the backend allocated, and reading them back is
 *   `readPixels` (staged — see the module header). Narrowed to the literal
 *   `null` rather than left as `Uint8Array | null` so the compiler knows too.
 * - **{@link RenderTargetTexture.renderTarget} points back at the target.** A
 *   backend that meets one of these in a render list looks the *target* up in
 *   its framebuffer cache — allocating it if this is the first the backend has
 *   heard of it — instead of trying to upload texels that do not exist.
 */
export interface RenderTargetTexture extends MaterialTexture {
  /**
   * Marker the {@link isRenderTargetTexture} guard reads — the duck-typed
   * contract pattern `isParticleDrawable` and `isDirectionalLightSource`
   * already use, so a backend narrows without naming the class and without an
   * `instanceof` that would break across realms.
   */
  readonly isRenderTargetTexture: true;

  /** Never any CPU-side texels; see the interface documentation. */
  readonly data: null;

  /** The target whose colour attachment this is. */
  readonly renderTarget: RenderTarget;
}

/**
 * Narrows any value to a {@link RenderTargetTexture} — the seam a backend uses
 * to tell "sample the framebuffer I rendered into" from "upload these bytes".
 *
 * Written exactly like `isParticleDrawable`: a marker property plus the one
 * member the caller will actually reach for, so a partially-formed object is
 * rejected rather than half-accepted.
 */
export function isRenderTargetTexture(
  value: unknown,
): value is RenderTargetTexture {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<RenderTargetTexture>;
  return (
    candidate.isRenderTargetTexture === true &&
    typeof candidate.renderTarget === "object" &&
    candidate.renderTarget !== null
  );
}

/**
 * Source of render-target ids. Monotonic and process-wide, exactly like
 * `Texture`'s, `Node`'s, and `BufferGeometry`'s — §33 forbids random or
 * clock-derived identity, and a counter makes two identical construction
 * sequences produce identical ids.
 */
let nextRenderTargetId = 1;

function assignRenderTargetId(): string {
  const id = `render-target-${String(nextRenderTargetId)}`;
  nextRenderTargetId += 1;
  return id;
}

/** Runs the §85 checks for a size. Throws on the first violation. */
function validateSize(width: number, height: number): void {
  const pairs: readonly (readonly [string, number])[] = [
    ["width", width],
    ["height", height],
  ];
  for (const [axis, value] of pairs) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(
        `RenderTarget ${axis} must be a finite integer of at least 1; got ` +
          `${String(value)} (§85).`,
      );
    }
  }
}

/** Runs the §85 check for the format. Throws on an unsupported value. */
function validateFormat(format: RenderTargetFormat): void {
  if (format !== "rgba8") {
    throw new RangeError(
      `RenderTarget format ${JSON.stringify(format)} is not supported by this ` +
        'tier; the only value is "rgba8" (§62, §85).',
    );
  }
}

/**
 * Runs the §85 check for a colour-space tag, and returns it (§60a).
 *
 * Shared by `RenderTarget` and `Texture` through the barrel, so the two report
 * the same refusal for the same mistake; `owner` names the resource in it.
 */
export function validateColorSpace(
  colorSpace: ColorSpace,
  owner: string,
): ColorSpace {
  if (colorSpace !== "srgb" && colorSpace !== "linear") {
    throw new RangeError(
      `${owner} colorSpace ${JSON.stringify(colorSpace)} is not a color ` +
        'space; the values are "srgb" and "linear" (§60a, §85).',
    );
  }
  return colorSpace;
}

/**
 * The colour attachment view handed out by {@link RenderTarget.colorTexture}.
 *
 * Every member delegates to the target rather than copying from it, so a
 * `resize()` is visible through a texture reference a material captured frames
 * ago — one resource, one version, no way for the two to disagree. Not
 * exported: it is reached as {@link RenderTargetTexture}, which is the contract
 * that matters, and keeping the class private leaves the shape free to change
 * when multiple render targets arrive.
 */
class RenderTargetColorTexture implements RenderTargetTexture {
  readonly isRenderTargetTexture = true as const;

  /** Always `null` — the texels live in the framebuffer, not on the CPU. */
  readonly data = null;

  readonly renderTarget: RenderTarget;

  constructor(renderTarget: RenderTarget) {
    this.renderTarget = renderTarget;
  }

  /**
   * The target's own id. One GPU surface, one identity: a backend that caches
   * the framebuffer under this id and a diagnostic that names the texture are
   * then talking about the same thing.
   */
  get id(): string {
    return this.renderTarget.id;
  }

  get version(): number {
    return this.renderTarget.version;
  }

  get width(): number {
    return this.renderTarget.width;
  }

  get height(): number {
    return this.renderTarget.height;
  }

  get disposed(): boolean {
    return this.renderTarget.disposed;
  }

  /** The target's colour space (§60a) — one surface, one tag. */
  get colorSpace(): ColorSpace {
    return this.renderTarget.colorSpace;
  }
}

/**
 * An off-screen surface a frame can be rendered into, and sampled from
 * afterwards (§61, §48, §63).
 *
 * ```ts
 * const target = new RenderTarget({ width: 512, height: 512 });
 * renderer.render(scene, [minimapView], undefined, target);
 * panelMaterial.map = target.colorTexture;
 * ```
 *
 * ## Version, not events
 *
 * `id` plus `version` is the cache contract every four.js GPU resource offers
 * (`BufferGeometry`, `Texture`), and a render target offers it for the same
 * reason: a backend keyed on the pair compares one number per frame instead of
 * holding a subscription per target. {@link RenderTarget.resize} and
 * {@link RenderTarget.dispose} are the only mutations, and both bump the
 * version — so the backend's framebuffer is re-allocated at the new size on the
 * next frame that draws into it, with nothing for the application to call.
 *
 * ## Ownership (§83)
 *
 * A target is **shared, not owned by the materials that sample it** — the same
 * rule `Texture` follows. Whoever created it disposes it; `Material.dispose()`
 * deliberately does not. Disposal is idempotent and terminal: a disposed target
 * is skipped by a backend rather than drawn into, exactly as a disposed texture
 * is skipped rather than sampled.
 *
 * Every target reports its size ({@link RenderTarget.byteLength}) to the
 * process-wide §83 totals in `resource-memory.ts` — at construction, on
 * `resize()`, and on `dispose()` — so an off-screen surface that is re-created
 * per resize instead of resized shows up in §84's `textureMemory` as the leak
 * it is (A-5, 2026-08-07).
 */
export class RenderTarget implements Disposable {
  /**
   * Stable identity (§83), assigned at construction from a monotonic counter
   * and formatted `render-target-<n>`. Unique within a process, ascending in
   * construction order, never reused.
   */
  readonly id: string = assignRenderTargetId();

  /** The colour attachment, as a texture. Stable for the target's lifetime. */
  readonly colorTexture: RenderTargetTexture = new RenderTargetColorTexture(
    this,
  );

  readonly #format: RenderTargetFormat;

  readonly #depth: boolean;

  readonly #colorSpace: ColorSpace;

  #width: number;

  #height: number;

  #version = 0;

  #disposed = false;

  constructor(options: RenderTargetOptions) {
    const format = options.format ?? "rgba8";
    validateSize(options.width, options.height);
    validateFormat(format);
    this.#width = options.width;
    this.#height = options.height;
    this.#format = format;
    this.#depth = options.depth ?? true;
    this.#colorSpace = validateColorSpace(
      options.colorSpace ?? "linear",
      "RenderTarget",
    );
    noteRenderTarget(1, this.byteLength);
  }

  /** Width of the colour attachment in texels. */
  get width(): number {
    return this.#width;
  }

  /** Height of the colour attachment in texels. */
  get height(): number {
    return this.#height;
  }

  /** Colour format of the attachment; `"rgba8"` in this tier (§62). */
  get format(): RenderTargetFormat {
    return this.#format;
  }

  /**
   * Whether the target carries a depth buffer — see
   * {@link RenderTargetOptions.depth}. Fixed at construction: changing it means
   * a different framebuffer, and re-creating the target says so plainly.
   */
  get depth(): boolean {
    return this.#depth;
  }

  /**
   * The colour space of the attachment's texels (§60a) — see
   * {@link RenderTargetOptions.colorSpace}. Fixed at construction, like
   * {@link RenderTarget.format}: a surface does not change what its bytes mean
   * halfway through a frame graph.
   */
  get colorSpace(): ColorSpace {
    return this.#colorSpace;
  }

  /**
   * Counter incremented on every mutation. Backends key their framebuffer
   * allocation on {@link RenderTarget.id} and validate it against this;
   * treat it as opaque and compare for inequality, exactly like
   * `Texture.version`.
   */
  get version(): number {
    return this.#version;
  }

  /** Whether {@link RenderTarget.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Bytes this target's attachments describe (§83, §84's `textureMemory`).
   *
   * Four bytes per texel for the `"rgba8"` colour attachment, plus **two** per
   * texel for the depth buffer when {@link RenderTarget.depth} is on: the only
   * depth storage this tier allocates is `DEPTH_COMPONENT16` (see
   * `@four/render-webgl`'s `gl-render-target.ts`), and quoting the backend's
   * actual format is the difference between accounting and guessing. The two
   * constants move together when §67's `DEPTH24_STENCIL8` and §62's
   * floating-point formats widen {@link RenderTargetFormat}.
   *
   * ```ts
   * new RenderTarget({ width: 512, height: 512 }).byteLength; // 512*512*6
   * new RenderTarget({ width: 512, height: 512, depth: false }).byteLength;
   * // 512*512*4
   * ```
   *
   * **`0` once disposed** — one rule with `Texture.byteLength`: a disposed
   * resource holds nothing.
   */
  get byteLength(): number {
    if (this.#disposed) {
      return 0;
    }
    return this.#width * this.#height * (this.#depth ? 6 : 4);
  }

  /**
   * Changes the size of the colour (and depth) attachment (§85 validated).
   *
   * The backend re-allocates on the next frame that draws into this target,
   * because the version advances — **and the old contents are gone**, which is
   * the honest description of a re-allocated framebuffer. A pass that must
   * survive a resize re-renders; there is no resize-preserving blit in this
   * tier.
   *
   * Resizing to the size it already has still bumps the version, and so still
   * costs a re-allocation. Guard the call if that matters: an application
   * following the canvas usually knows whether the size actually changed, and
   * a no-op here would make "the version advanced" stop meaning "something
   * changed".
   *
   * Throws after disposal (§83): disposal is terminal, and silently resizing a
   * dead target would hide the mistake.
   */
  resize(width: number, height: number): void {
    if (this.#disposed) {
      throw new RangeError(
        `RenderTarget ${this.id} was resized after disposal; disposal is ` +
          "terminal (§83).",
      );
    }
    validateSize(width, height);
    const before = this.byteLength;
    this.#width = width;
    this.#height = height;
    noteRenderTarget(0, this.byteLength - before);
    this.#version += 1;
  }

  /**
   * Releases this target (§83). Idempotent and terminal.
   *
   * There is nothing CPU-side to free — the framebuffer, its colour texture and
   * its depth buffer all belong to the backend — so this marks the target
   * disposed and bumps the version, which is exactly what makes the backend
   * delete them on the next frame that meets this target. A backend that meets
   * a disposed target **skips** it: drawing into a released framebuffer, or
   * sampling one, would paint undefined content rather than report the mistake
   * (the same rule `Texture.dispose` states).
   *
   * Materials pointing at {@link RenderTarget.colorTexture} are not notified;
   * ownership is explicit and upwards (§83).
   *
   * It **does** remove this target and its bytes from the process-wide §83
   * totals (`textureMemoryBytes`, `liveRenderTargetCount`), exactly once: the
   * idempotence guard above is what makes a double `dispose()` subtract once
   * rather than twice.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    const before = this.byteLength;
    this.#disposed = true;
    noteRenderTarget(-1, -before);
    this.#version += 1;
  }
}
