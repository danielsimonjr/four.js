/**
 * `Sprite` (§55) — a textured, tinted quad in the scene graph.
 *
 * §55's sprite tier is large: screen-space and world-space sizing, anchors and
 * pivots, atlases and frame regions, nine-slice scaling, tint and opacity,
 * billboarding, per-instance data, alpha masks, normal-mapped sprites, and
 * sprite animation clips. This packet implements the floor that §106a's
 * interaction demo and §56's MVP text tier both stand on — **a world-sized,
 * anchored, tinted textured quad** — and names the rest as deferred rather than
 * sketching it.
 *
 * ## §55's `class Sprite extends Renderable`, as of 2026-08-06
 *
 * §55 writes `class Sprite extends Renderable`, and that is where this class
 * now is. It could not go there at WP-3a.3, and the obstacle is worth keeping
 * on the record because it was a type-level one and not a design disagreement:
 *
 * - §49's `Renderable.material` is `Material | Material[]`, over §57's abstract
 *   `Material` base.
 * - That base did not exist. WP-3.3 deliberately did not introduce it (every
 *   field of it is render state whose meaning the backend packet fixes), and so
 *   `Renderable.material` was narrowed to the concrete surface materials —
 *   `UnlitMaterial` alone at WP-3a.3; `UnlitMaterial | LitMaterial` after the
 *   2026-08-04 lighting packet — classes with private fields, hence nominally
 *   typed.
 * - A subclass may not re-declare an inherited property with an unrelated type.
 *   `Sprite extends Renderable` would therefore have had to carry a surface
 *   material, which cannot name a texture.
 *
 * The base landed with the render-state packet that could say what its fields
 * mean, `Renderable` became generic in its material (`Renderable<M extends
 * Material>`, defaulting to the surface pair), and this class is a
 * `Renderable<SpriteMaterial>` — the mechanical change this note predicted.
 * The three re-declared members it carried (`material`, `renderLayer`,
 * `renderOrder`) are gone, inherited instead; `geometry` stays as an
 * **override**, because a sprite derives its quad rather than being handed one
 * (see below).
 *
 * `buildRenderList` still tags each item with a `RenderItemKind` discriminant
 * read off the *material*, so the render list, the sort, and every backend see
 * one uniform stream of draws — and the list no longer needs a second
 * `instanceof` to recognise a sprite.
 *
 * ## The quad, and who owns it
 *
 * Unlike a `Renderable`, a sprite **owns its geometry**: the quad is derived
 * from {@link Sprite.anchor}, {@link Sprite.width}, and {@link Sprite.height},
 * so it is a function of the sprite and belongs to it. {@link Sprite.dispose}
 * therefore disposes it — and deliberately does *not* dispose the material or
 * the texture, which are shared (§83).
 *
 * The quad is built **lazily and in place**: one `BufferGeometry` is created per
 * sprite and its position array is rewritten whenever the anchor or the size
 * changes, followed by `markDirty()`. Keeping the same geometry *id* is what
 * makes a resize cost one re-upload in the backend's `GeometryCache` (an `id`
 * hit with a stale `version` deletes and re-uploads) instead of leaking the old
 * entry behind a new id (decision, WP-3a.3).
 *
 * ## Texture coordinates: derived from position, and that survived §55's frame
 *
 * When this class was written §53's `BufferGeometry` carried positions and
 * indices and nothing else, so the sprite pipeline derived uv from **position**:
 * the quad is a rectangle in the XY plane, so `uv = (position.xy - min) / size`
 * maps its corners onto `(0,0)…(1,1)` exactly, and `min`/`size` are the
 * geometry's own local bounds (`computeBounds()`, cached against the version).
 * The backend uploads them as one `vec4` per draw; see `@four/render-webgl`'s
 * `SpriteProgram`.
 *
 * `BufferGeometry.uvs` exists as of R-19 (2026-08-07), and this module then
 * carried a note predicting that §55's `frame` would force the rewrite —
 * "a sub-rectangle is not a function of the quad's bounds", so the atlas packet
 * would author uv and retire the `quad` uniform. **R-29 (2026-08-08) found that
 * prediction wrong, and the note is replaced by the derivation that disproves
 * it.** A frame is not a new mapping; it is a *reparametrization of the same
 * affine one*. Write `w`/`h` for the quad's local size, `(fx, fy, fw, fh)` for
 * the frame in texels and `(tw, th)` for the texture's size. The uv the
 * fragment stage wants is
 *
 * ```text
 * uv = (frame.xy + (position.xy - min) / size · frame.zw) / texture-size
 * ```
 *
 * which is affine in `position.xy` — so it is expressible by the *existing*
 * shader, `uv = (position.xy - quad.xy) / quad.zw`, at
 *
 * ```text
 * quad.zw = (w · tw / fw,  h · th / fh)
 * quad.xy = (minX - fx · w / fw,  minY - fy · h / fh)
 * ```
 *
 * i.e. `quad` stops meaning "the quad's own local rectangle" and starts meaning
 * **the local rectangle the whole texture maps onto** — the quad's own
 * rectangle exactly when there is no frame, since `(fx, fy, fw, fh) =
 * (0, 0, tw, th)` collapses the two lines above to `quad = (minX, minY, w, h)`.
 *
 * Three consequences, all of them the reason this is the shipped mechanism:
 *
 * - **A frameless sprite's GL transcript is unchanged, by construction.** The
 *   backend takes the same branch it always took and uploads the same four
 *   floats through the same `uniform4fv`; there is no new uniform, no new
 *   attribute, and no new call. Byte-identity is not a numerical argument here,
 *   it is a code-path argument.
 * - **Changing a frame costs no upload.** A `frame` write does not touch the
 *   geometry, so nothing is re-uploaded and no version is bumped — which is
 *   what §55's sprite animation clips and §86's glyph batching need, and what a
 *   uv *attribute* could not have given them (a per-frame buffer rewrite per
 *   quad).
 * - **The `quad` uniform survives.** Its name is load-bearing beyond taste: a
 *   uniform name is an argument of `getUniformLocation`, so renaming it would
 *   itself perturb every recorded GL sequence.
 *
 * A real uv stream is still the right answer for §65 batching, where many quads
 * with different frames share one draw and there is no per-draw uniform left to
 * vary. That is a batching decision, recorded there rather than pre-empted here
 * (2026-08-08).
 *
 * ## Deferred from §55 (named, not dropped)
 *
 * `sizeMode: "pixels" | "world"` — world only; pixel sizing needs the viewport's
 * drawing-buffer size inside the vertex stage, which is §61 state the render
 * item does not carry. `billboardMode` — needs the camera inside the model
 * transform, i.e. a per-view render list, which arrives with §87 culling.
 * Nine-slice, per-instance data, alpha masks, and normal-mapped sprites each
 * need either a second geometry path or a second texture binding.
 *
 * Two neighbours of {@link Sprite.frame} are deliberately *not* here
 * (2026-08-08):
 *
 * - **An atlas object with named frames.** `frame` is the primitive such a
 *   thing hands out — `atlas.get("coin")` returns a {@link SpriteFrame} — and
 *   an atlas is a §77 texture-metadata container (a parsed `.json` sidecar,
 *   a packer's output) rather than a scene-graph feature. It belongs with
 *   `@four/assets`, next to the loader that would parse it, and it needs
 *   nothing from this class that is not already public.
 * - **Sprite animation clips.** §55 lists them, but an *animated* frame is a
 *   track that writes `frame` over time, which is §14's clip model and §17's
 *   track types — a discrete/step-interpolated track over a frame sequence.
 *   Building a private timeline inside `Sprite` would be a second animation
 *   system next to the one that exists. Staged for the packet that adds a
 *   step-interpolated non-numeric track; the property it drives is shipped.
 *
 * Transparency **sorting** (§66 key 2) arrived on 2026-08-06 and a sprite opts
 * into it like any other drawable, by declaring `transparent: true` on its
 * material. A sprite that does not still draws in render-list order with
 * straight-alpha blending — the pipeline blends by construction — which is
 * correct for the non-overlapping and back-to-front-authored cases and remains
 * documented as a limitation on the backend.
 */

import type { Disposable } from "@four/core";
import { BufferGeometry } from "@four/geometry";
import { Vector2 } from "@four/math";
import type { SpriteMaterial } from "@four/materials";

import { Renderable } from "./renderable.js";

/**
 * §55's `frame?: Rectangle2` — the sub-rectangle of the texture a sprite
 * samples, in **texels** (R-29, 2026-08-08).
 *
 * ```ts
 * // a 16 × 16 cell of a 128 × 128 sheet, third column, second row from the bottom
 * sprite.setFrame(32, 16, 16, 16);
 * ```
 *
 * ## Why texels, and where the origin is
 *
 * §55 names the type `Rectangle2` and gives no units; the two candidates were
 * texels and normalized uv, and this is texels because:
 *
 * - it is the unit every atlas packer, sprite sheet, and glyph atlas already
 *   emits, so the common case involves no conversion and no rounding;
 * - it makes §85's containment check *mean* something — a frame is validated
 *   against the texture it indexes, which in normalized units degenerates to
 *   "is it inside `0…1`" and never consults the texture at all;
 * - it keeps the field readable: `(32, 16, 16, 16)` names a cell, `(0.25, 0.125,
 *   0.125, 0.125)` names arithmetic.
 *
 * The price is a coupling — a frame is only meaningful against a texture of a
 * particular size — and it is paid where {@link Sprite.frame} documents it.
 *
 * **The origin is the bottom-left texel and +Y is up**, which is not a choice:
 * `MaterialTexture.data` documents row 0 as `v = 0`, the sprite shader
 * documents `v = 0` as the quad's bottom edge, and §7a puts +Y up in 2D exactly
 * as in 3D. A producer whose rectangles are top-left-origin (a decoded PNG
 * sheet, most packer sidecars) flips with `y = textureHeight - top - height`
 * where it adapts them, which is the same place it already flips the texels.
 *
 * A producer that has **normalized** uv instead — `@four/text`'s `TextQuad`
 * carries `u0/v0/u1/v1` — multiplies: `x = u0 · texture.width`,
 * `width = (u1 - u0) · texture.width`, and the same in Y.
 *
 * Every field is `readonly`: a frame is read by the render list and the backend
 * and written only through {@link Sprite.setFrame}, which validates.
 */
export interface SpriteFrame {
  /** Left edge in texels, measured from the texture's left edge. */
  readonly x: number;
  /** Bottom edge in texels, measured from the texture's **bottom** edge. */
  readonly y: number;
  /** Width in texels; strictly positive. */
  readonly width: number;
  /** Height in texels; strictly positive. */
  readonly height: number;
}

/** {@link SpriteFrame} as the sprite stores it — see {@link Sprite.setFrame}. */
interface MutableSpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Optional construction arguments of {@link Sprite} — the quad's own size and
 * anchor, plus the three `RenderableOptions` fields a sprite honours
 * (`renderLayer`, `renderOrder`, and §67's `clip`), spelled out here so the
 * sprite's own options read as one list.
 */
export interface SpriteOptions {
  /**
   * Initial {@link Sprite.frame}, copied into the sprite's own record and
   * validated against the material's texture (§85). Omitted means the whole
   * texture, which is what a sprite without a frame draws.
   */
  frame?: SpriteFrame;
  /** Initial {@link Sprite.width} in world units; defaults to 1. */
  width?: number;
  /** Initial {@link Sprite.height} in world units; defaults to 1. */
  height?: number;
  /**
   * Initial {@link Sprite.anchor}, copied into the sprite's own vector.
   * Defaults to the centre, `(0.5, 0.5)`.
   */
  anchor?: { readonly x: number; readonly y: number };
  /** Initial {@link Sprite.renderLayer}; defaults to 0. */
  renderLayer?: number;
  /** Initial {@link Sprite.renderOrder}; defaults to 0. */
  renderOrder?: number;
  /**
   * Initial `Node.clip`; defaults to `false` (§67, R-23). A clipping sprite
   * masks its subtree to its **quad** — the anchored rectangle, not the
   * texture's alpha (§67's alpha masks are a staged tier; see
   * `@four/render`'s `clip.ts`) — which is §73's overflow-clipping shape.
   */
  clip?: boolean;
}

/** Vertices of the quad: bottom-left, bottom-right, top-right, top-left. */
const QUAD_VERTEX_COUNT = 4;

/**
 * Two counter-clockwise triangles seen from +Z, matching `planeGeometry` and
 * §7a's winding rule.
 */
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

/** Validates one extent (§85), mirroring `@four/geometry`'s builders. */
function requirePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `Sprite ${name} must be a finite positive number; got ${String(value)} ` +
        "(§85).",
    );
  }
  return value;
}

/** Validates one anchor component (§85). */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Sprite anchor.${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/**
 * The texel size a frame is validated against, or `null` when the sprite's
 * material cannot say.
 *
 * `null` is not a hypothetical: the render suites and consumers alike hand a
 * `Sprite` a **structurally typed** sprite material, and one written before
 * §77's texture contract grew `width`/`height` — or a stub with no texture at
 * all — reports `undefined`. The same defence the render list applies to
 * `node.layers`: an absent value means "cannot check", never "check against
 * zero", which would refuse every frame ever written.
 */
function textureSizeOf(material: SpriteMaterial): {
  width: number;
  height: number;
} | null {
  const texture: { width?: number; height?: number } | undefined =
    material.texture;
  const width = texture?.width ?? 0;
  const height = texture?.height ?? 0;
  return Number.isFinite(width) && width > 0 && height > 0
    ? { width, height }
    : null;
}

/** One frame as `(x, y, width, height)`, for the two §85 messages below. */
function describeFrame(frame: SpriteFrame): string {
  return (
    `(${String(frame.x)}, ${String(frame.y)}, ` +
    `${String(frame.width)}, ${String(frame.height)})`
  );
}

/**
 * Validates one frame against the texture it indexes (§85, §55).
 *
 * **Refuses; never clamps.** A frame that runs off the edge of its texture is
 * an authoring mistake — a mis-packed atlas, a stale sheet, an off-by-one in a
 * generated table — and clamping it would silently rewrite authored data and
 * then draw *something*, which is the failure mode the repository's
 * no-silent-rewrites rule exists to prevent. It is the rule `SpriteMaterial`
 * follows for out-of-range tint components and `Sprite` follows for a
 * non-positive width.
 *
 * Sub-texel and non-integer edges are **legal**: a half-texel inset is the
 * standard defence against atlas bleeding under bilinear filtering, so
 * requiring integers here would refuse the correct thing.
 *
 * Two messages rather than five, and both built from
 * {@link describeFrame} — every rejected frame is printed in full, so the
 * offending component is visible without a message naming it. That is a
 * deliberate trade: the five-message version cost **+330 B gzipped in the
 * `ui-demo` bundle**, measured, which is more than the whole of the rest of
 * this feature (2026-08-08). §85 asks for refusal, not for prose.
 */
function validateFrame(
  frame: SpriteFrame,
  size: { width: number; height: number } | null,
): void {
  const { x, y, width, height } = frame;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    x < 0 ||
    y < 0
  ) {
    throw new RangeError(
      "Sprite frame must be a finite rectangle with positive extents at a " +
        `non-negative origin, in texels; got ${describeFrame(frame)} (§85).`,
    );
  }
  if (size !== null && (x + width > size.width || y + height > size.height)) {
    throw new RangeError(
      `Sprite frame ${describeFrame(frame)} runs outside its ` +
        `${String(size.width)} × ${String(size.height)} texture (§85). ` +
        "Frames are in texels from the bottom-left; flip a top-left one.",
    );
  }
}

/**
 * A textured quad node (§55).
 *
 * ```ts
 * const texture = new Texture({ width: 2, height: 2, data: bytes });
 * const sprite = new Sprite(new SpriteMaterial({ texture }), {
 *   width: 3,
 *   height: 2,
 *   anchor: { x: 0, y: 0 },       // bottom-left corner sits on the node origin
 * });
 * scene.add(sprite);
 * // …
 * sprite.dispose();               // the quad; not the material, not the texture
 * ```
 *
 * ## Anchor
 *
 * {@link Sprite.anchor} is the point of the sprite that lands on the node's
 * origin, in **quad-relative** units: `(0, 0)` is the bottom-left corner,
 * `(1, 1)` the top-right, `(0.5, 0.5)` — the default — the centre. So a
 * `width × height` sprite spans
 *
 * ```text
 * x ∈ [-anchor.x · width,  (1 - anchor.x) · width ]
 * y ∈ [-anchor.y · height, (1 - anchor.y) · height]
 * ```
 *
 * Values outside `[0, 1]` are legal and place the origin outside the quad, which
 * is what an orbiting or hinged sprite wants. Y-up throughout (§7a): `anchor.y =
 * 0` is the **bottom** edge, in 2D exactly as in 3D.
 *
 * This is §55's `anchor`, not §7's `Transform.pivot`. They compose: the anchor
 * says where the artwork sits relative to the node, the pivot says what the
 * node's own rotation and scale turn about. A sprite that should spin about its
 * bottom-left corner sets `anchor` to `(0, 0)` and leaves the pivot alone.
 */
export class Sprite extends Renderable<SpriteMaterial> implements Disposable {
  /**
   * The point of the quad that sits on the node origin, in quad-relative units;
   * `(0.5, 0.5)` (centre) by default. See the class documentation.
   *
   * The vector instance is `readonly` — write *into* it — because the sprite
   * keeps it for the lifetime of the node. Writing components directly is legal
   * and cheap, but invisible: call {@link Sprite.markDirty} afterwards, or use
   * {@link Sprite.setAnchor}, which does it for you.
   */
  readonly anchor: Vector2;

  #width: number;

  #height: number;

  /**
   * The owned quad, kept privately as well as in the inherited `geometry` slot.
   * Created once, rewritten in place; see the module header for why the id is
   * stable across resizes.
   *
   * The private reference exists so {@link Sprite.geometry}'s override and the
   * rebuild never read through the accessor they are overriding.
   */
  readonly #quad: BufferGeometry;

  /** Whether the quad's positions still match the anchor and the size. */
  #quadStale = true;

  /**
   * §55's frame, or `null` for the whole texture. Retained and rewritten in
   * place by {@link Sprite.setFrame} — see it for why.
   */
  #frame: MutableSpriteFrame | null = null;

  #disposed = false;

  /**
   * Builds a sprite for `material`. The material is required: a sprite without
   * one draws nothing, and defaulting it would hide the mistake behind an
   * invisible node rather than a type error — the rule `Renderable` follows.
   *
   * The quad is built **before** `super()`, because `Renderable`'s constructor
   * takes the geometry: a sprite owns its geometry rather than being handed
   * one, so it hands its own to the base and keeps the reference.
   */
  constructor(material: SpriteMaterial, options: SpriteOptions = {}) {
    const quad = new BufferGeometry({
      positions: new Float32Array(QUAD_VERTEX_COUNT * 3),
      indices: QUAD_INDICES.slice(),
      mode: "triangles",
    });
    super(quad, material, {
      renderLayer: options.renderLayer ?? 0,
      renderOrder: options.renderOrder ?? 0,
      clip: options.clip ?? false,
    });
    this.#quad = quad;
    this.#width = requirePositive("width", options.width ?? 1);
    this.#height = requirePositive("height", options.height ?? 1);
    const anchor = options.anchor ?? { x: 0.5, y: 0.5 };
    this.anchor = new Vector2(
      requireFinite("x", anchor.x),
      requireFinite("y", anchor.y),
    );
    if (options.frame !== undefined) {
      const frame = options.frame;
      this.setFrame(frame.x, frame.y, frame.width, frame.height);
    }
  }

  /**
   * Width of the quad in **world units** (§55's `sizeMode: "world"`; pixel
   * sizing is deferred — see the module header). Assigning rebuilds the quad.
   */
  get width(): number {
    return this.#width;
  }

  set width(value: number) {
    this.#width = requirePositive("width", value);
    this.markDirty();
  }

  /** Height of the quad in world units. Assigning rebuilds the quad. */
  get height(): number {
    return this.#height;
  }

  set height(value: number) {
    this.#height = requirePositive("height", value);
    this.markDirty();
  }

  /**
   * The sub-rectangle of the texture this sprite samples, in texels, or `null`
   * — the default — for the whole texture (§55; R-29, 2026-08-08).
   *
   * ```ts
   * sprite.frame = { x: 32, y: 16, width: 16, height: 16 };  // one atlas cell
   * sprite.frame = null;                                      // whole texture
   * ```
   *
   * See {@link SpriteFrame} for the units and the bottom-left origin, and the
   * module header for how the backend draws it without a uv attribute and
   * without a second uniform.
   *
   * ## What it costs, and what it does not
   *
   * Nothing on the geometry: the quad is a function of the anchor and the size
   * and is untouched by a frame, so writing one **re-uploads nothing** and
   * leaves {@link Sprite.geometry} and its version exactly as they were. What
   * changes is four floats of a uniform the backend already uploaded per draw.
   * Many sprites over one atlas texture therefore share one GPU texture, one
   * material, and one upload — which is the whole point, and what the "cut the
   * cell into its own texture" workaround in the examples was paying to avoid.
   *
   * ## Validation (§85) and the one hole in it
   *
   * The setter **refuses** a frame that is not finite, is not positive in both
   * extents, is negative in either origin, or runs outside the texture; it does
   * not clamp (see `validateFrame`). Containment is checked against
   * `material.texture` **as it is at the moment of the write**.
   *
   * Assigning a *different* texture to the material afterwards — or a different
   * material to the sprite — is therefore not re-checked, because neither
   * setter is this class's: `Material.texture` belongs to `@four/materials`,
   * which cannot know its sprites, and `Renderable.material` is a plain field
   * on the base. A frame left over from a larger texture then resolves to uv
   * beyond `1`, which samples per the texture's wrap mode — clamp-to-edge is
   * the only mode this tier has, so the sprite draws a smeared edge rather than
   * anything undefined. Named rather than papered over (2026-08-08): the clean
   * fix is a §77 texture-change notification, which is R-30's territory, and
   * re-validating on read would put a throw on the render path.
   *
   * The returned record is the sprite's own and is **rewritten in place** by
   * {@link Sprite.setFrame} — read it, do not retain it across a write, and do
   * not mutate it (the type is `readonly` in every field). Same contract as
   * {@link Sprite.anchor} and `SpriteMaterial.tint`.
   */
  get frame(): SpriteFrame | null {
    return this.#frame;
  }

  set frame(value: SpriteFrame | null) {
    if (value === null) {
      this.#frame = null;
      return;
    }
    this.setFrame(value.x, value.y, value.width, value.height);
  }

  /**
   * Writes {@link Sprite.frame} from four texel coordinates and returns `this`
   * for chaining (§7b's mutate-and-return convention).
   *
   * Validated **before** the first write, so a refused frame leaves the sprite
   * exactly as it was rather than half-updated — the torn-state rule the three
   * materials' `set*` methods follow.
   *
   * The record is allocated once per sprite and rewritten in place afterwards,
   * so stepping a sprite through an atlas every frame allocates nothing (§7b's
   * no-allocation-on-a-hot-path rule); the price is the aliasing the getter
   * documents.
   */
  setFrame(x: number, y: number, width: number, height: number): this {
    validateFrame({ x, y, width, height }, textureSizeOf(this.material));
    const frame = this.#frame;
    if (frame === null) {
      this.#frame = { x, y, width, height };
    } else {
      frame.x = x;
      frame.y = y;
      frame.width = width;
      frame.height = height;
    }
    return this;
  }

  /**
   * The quad this sprite draws (§53), rebuilt on read whenever the anchor or the
   * size has changed since the last one.
   *
   * Owned by the sprite — do not dispose it yourself, and do not hand it to a
   * `Renderable`, which would then draw a quad that changes under it. Reading it
   * is cheap: the rebuild is skipped unless something moved.
   *
   * Overrides `Renderable.geometry` with a **read-only** accessor: a sprite
   * derives its geometry from its anchor and size, so there is nothing sensible
   * to assign, and the base's setter is deliberately not inherited (the base
   * constructor writes its own backing field, so the quad still reaches it).
   */
  override get geometry(): BufferGeometry {
    if (this.#quadStale) {
      this.#rebuildQuad();
    }
    return this.#quad;
  }

  /** Whether {@link Sprite.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Writes the anchor and rebuilds the quad on the next read. Returns `this` for
   * chaining (§7b's mutate-and-return convention).
   */
  setAnchor(x: number, y: number): this {
    this.anchor.set(requireFinite("x", x), requireFinite("y", y));
    this.markDirty();
    return this;
  }

  /**
   * Announces a change the sprite could not see — a direct write into
   * {@link Sprite.anchor}. The quad is rebuilt on the next read of
   * {@link Sprite.geometry}, not here, so a burst of edits in one frame costs
   * one rebuild rather than one per edit.
   */
  markDirty(): void {
    this.#quadStale = true;
  }

  /**
   * Releases the quad this sprite owns (§83). Idempotent.
   *
   * **The material and its texture are not disposed**: both are shared, and §83
   * puts disposal on whoever created them. After disposal the quad has no
   * vertices, so a backend meeting this sprite in a render list skips it — the
   * same behaviour a disposed `BufferGeometry` produces for a `Renderable`.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#quad.dispose();
  }

  /**
   * Rewrites the quad's four corners from the anchor and the size, in place.
   *
   * ```text
   * 3 ── 2      (x0, y1) ── (x1, y1)
   * │    │           │           │
   * 0 ── 1      (x0, y0) ── (x1, y0)
   * ```
   *
   * with `x0 = -anchor.x · width`, `x1 = x0 + width`, and the same in Y — so the
   * corners straddle the origin exactly as the class documentation states. The
   * winding (indices `0,1,2, 0,2,3`) is counter-clockwise seen from +Z, matching
   * `planeGeometry` and §7a.
   *
   * `positions` is written through, then `markDirty()` bumps the geometry's
   * version: an in-place edit is invisible to `BufferGeometry` by design (§53),
   * and the version bump is what makes the backend re-upload. A disposed sprite
   * never gets here — its geometry has been emptied, and `dispose()` is
   * terminal.
   */
  #rebuildQuad(): void {
    this.#quadStale = false;
    if (this.#disposed) {
      return;
    }

    // `0 - a·s` rather than `-a·s`: the latter produces **negative zero** at
    // anchor 0, and a `-0` in a vertex buffer is a value that compares equal to
    // `0` with `===`, unequal with `Object.is`, and hashes differently in a §33
    // checksum. Subtracting from zero yields `+0` and is otherwise identical.
    const x0 = 0 - this.anchor.x * this.#width;
    const x1 = x0 + this.#width;
    const y0 = 0 - this.anchor.y * this.#height;
    const y1 = y0 + this.#height;

    const positions = this.#quad.positions;
    // prettier-ignore
    positions.set([
      x0, y0, 0, // 0 bottom-left
      x1, y0, 0, // 1 bottom-right
      x1, y1, 0, // 2 top-right
      x0, y1, 0, // 3 top-left
    ]);
    this.#quad.markDirty();
  }
}
