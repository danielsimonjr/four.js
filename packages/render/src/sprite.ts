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
 * ## Departure from §55's `class Sprite extends Renderable` (decision, WP-3a.3)
 *
 * §55 writes `class Sprite extends Renderable`, and that is where this class
 * belongs. It cannot go there **yet**, and the reason is worth stating exactly,
 * because it is a temporary type-level obstacle and not a design disagreement:
 *
 * - §49's `Renderable.material` is `Material | Material[]`, over §57's abstract
 *   `Material` base.
 * - That base does not exist. WP-3.3 deliberately did not introduce it (every
 *   field of it is render state whose meaning the backend packet fixes), and so
 *   `Renderable.material` is narrowed to the concrete surface materials —
 *   `UnlitMaterial` alone at WP-3a.3; `UnlitMaterial | LitMaterial` since the
 *   2026-08-04 lighting packet — classes with private fields, hence nominally
 *   typed.
 * - A subclass may not re-declare an inherited property with an unrelated type.
 *   `Sprite extends Renderable` would therefore have to carry a surface
 *   material, which cannot name a texture.
 *
 * Replacing that union with §57's abstract base is the `Material`-base
 * packet's job, not this one's — doing it here would pin the base's shape
 * from the outside. So
 * {@link Sprite} extends `Node` directly and re-declares the four `Renderable`
 * members it needs (`geometry`, `material`, `renderLayer`, `renderOrder`).
 * `buildRenderList` treats the two side by side and tags each item with a
 * `RenderItemKind` discriminant, so the render list, the sort, and every backend see
 * one uniform stream of draws. When §57's base lands, this class re-parents onto
 * `Renderable`, deletes those four declarations, and nothing else changes.
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
 * ## Texture coordinates without a uv attribute
 *
 * §53's `BufferGeometry` carries positions and indices — there is no uv stream,
 * and adding one is the packet that introduces the standard attribute set, not
 * this one. The sprite pipeline therefore derives uv from **position**: the quad
 * is a rectangle in the XY plane, so `uv = (position.xy - min) / size` maps its
 * corners onto `(0,0)…(1,1)` exactly, and `min`/`size` are the geometry's own
 * local bounds (`computeBounds()`, cached against the version). The backend
 * uploads them as one `vec4` per draw; see `@four/render-webgl`'s
 * `SpriteProgram`. The mapping is exact for any anchor and any size, and it
 * disappears the moment geometries carry real uvs.
 *
 * ## Deferred from §55 (named, not dropped)
 *
 * `sizeMode: "pixels" | "world"` — world only; pixel sizing needs the viewport's
 * drawing-buffer size inside the vertex stage, which is §61 state the render
 * item does not carry. `frame?: Rectangle2` and atlases — needs a uv sub-rect on
 * the material or the item. `billboardMode` — needs the camera inside the model
 * transform, i.e. a per-view render list, which arrives with §87 culling.
 * Nine-slice, per-instance data, alpha masks, and sprite animation clips each
 * need either a second geometry path or §65 batching. Transparency **sorting**
 * (§66 key 2) is likewise deferred: sprites draw in render-list order with
 * straight-alpha blending, which is correct for the non-overlapping and
 * back-to-front-authored cases and documented as a limitation on the backend.
 */

import type { Disposable } from "@four/core";
import { BufferGeometry } from "@four/geometry";
import { Vector2 } from "@four/math";
import type { SpriteMaterial } from "@four/materials";
import { Node } from "@four/scene";

/** Optional construction arguments of {@link Sprite}. */
export interface SpriteOptions {
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
export class Sprite extends Node implements Disposable {
  /** Surface appearance (§55, §57). Shared, not owned — see the module header. */
  material: SpriteMaterial;

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

  /**
   * Symbolic drawing group (§46, §66 sort key 1) — the render list's primary
   * key. Identical in meaning to `Renderable.renderLayer`; see that class for
   * why it is a plain number for now.
   */
  renderLayer = 0;

  /**
   * Explicit ordering within a layer (§66 sort key 5). Lower draws first; ties
   * keep scene-graph order.
   *
   * With transparency sorting deferred (§66 key 2), this is the control an
   * author has over which sprite draws on top of which — that, and sibling
   * order.
   */
  renderOrder = 0;

  #width: number;

  #height: number;

  /**
   * The owned quad. Created once, rewritten in place; see the module header for
   * why the id is stable across resizes.
   */
  readonly #geometry: BufferGeometry;

  /** Whether the quad's positions still match the anchor and the size. */
  #quadStale = true;

  #disposed = false;

  /**
   * Builds a sprite for `material`. The material is required: a sprite without
   * one draws nothing, and defaulting it would hide the mistake behind an
   * invisible node rather than a type error — the rule `Renderable` follows.
   */
  constructor(material: SpriteMaterial, options: SpriteOptions = {}) {
    super();
    this.material = material;
    this.#width = requirePositive("width", options.width ?? 1);
    this.#height = requirePositive("height", options.height ?? 1);
    const anchor = options.anchor ?? { x: 0.5, y: 0.5 };
    this.anchor = new Vector2(
      requireFinite("x", anchor.x),
      requireFinite("y", anchor.y),
    );
    this.renderLayer = options.renderLayer ?? 0;
    this.renderOrder = options.renderOrder ?? 0;
    this.#geometry = new BufferGeometry({
      positions: new Float32Array(QUAD_VERTEX_COUNT * 3),
      indices: QUAD_INDICES.slice(),
      mode: "triangles",
    });
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
   * The quad this sprite draws (§53), rebuilt on read whenever the anchor or the
   * size has changed since the last one.
   *
   * Owned by the sprite — do not dispose it yourself, and do not hand it to a
   * `Renderable`, which would then draw a quad that changes under it. Reading it
   * is cheap: the rebuild is skipped unless something moved.
   */
  get geometry(): BufferGeometry {
    if (this.#quadStale) {
      this.#rebuildQuad();
    }
    return this.#geometry;
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
    this.#geometry.dispose();
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

    const positions = this.#geometry.positions;
    // prettier-ignore
    positions.set([
      x0, y0, 0, // 0 bottom-left
      x1, y0, 0, // 1 bottom-right
      x1, y1, 0, // 2 top-right
      x0, y1, 0, // 3 top-left
    ]);
    this.#geometry.markDirty();
  }
}
