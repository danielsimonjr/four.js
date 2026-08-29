/**
 * §65 batching — merging consecutive compatible draws into one (R-9,
 * 2026-08-09).
 *
 * §64 lists batching as pipeline stage 6, between sorting and backend command
 * encoding, and §65 names the strategies: sprite batching, glyph batching,
 * compatible shape batching, instanced meshes, material and pipeline sorting,
 * atlas grouping, staged buffers, multi-draw. This module ships the first two
 * *drawing* strategies — **sprite batching and compatible shape batching** — as
 * a backend-independent planner: it turns a run of {@link RenderItem}s into one
 * interleaved vertex stream plus one index stream, and a backend uploads and
 * draws them. `@four/render-webgl`'s `gl-batch.ts` is the first consumer;
 * nothing here names GL, so a second backend reuses the planner unchanged.
 *
 * ```ts
 * const batcher = new RenderBatcher();
 * for (let i = 0; i < list.length; i += 1) {
 *   const batch = batcher.next(list, i);
 *   if (batch !== null) {
 *     drawOnce(batch);          // one draw call for batch.items items
 *     i += batch.items - 1;
 *     continue;
 *   }
 *   drawOne(list[i]);           // exactly the draw it always was
 * }
 * ```
 *
 * ## The tier, and why it is this one
 *
 * **Consecutive items that share a pipeline and a material instance.** Nothing
 * is reordered here — reordering is §66's key 3 and is a separate, opt-in verb
 * (`groupRenderListByPipeline`), for the reason recorded there. That
 * restriction is what makes this batcher **exact rather than approximate**:
 *
 * - GL rasterises the primitives of one draw call in submission order, and
 *   blending, depth testing and depth writing all respect that order. Merging
 *   *N* consecutive draws that share every piece of render state into one draw
 *   whose primitives are concatenated in the same order therefore produces the
 *   same picture, primitive for primitive — including the `LEQUAL` co-planar
 *   case where the later draw wins, which is exactly how a §58 stroke paints
 *   over its fill and how a later sibling paints over an earlier one.
 * - "Same material *instance*" (`===`, not "equal fields") is what makes the
 *   claim checkable in one comparison: blend mode, depth test, depth write,
 *   colour write, texture, colour and opacity are all read off that one object,
 *   so a run cannot straddle a state change.
 * - A run of one is not a batch. A scene with a single sprite, or with no two
 *   adjacent draws sharing a material, produces exactly the GL sequence it
 *   produced before this module existed — the byte-identity property this
 *   packet keeps.
 *
 * ## The one divergence, stated
 *
 * A batch has one model matrix for many nodes, so **world transforms are baked
 * into the vertex stream** here on the CPU (in `Float64Array` matrix precision,
 * stored to `Float32Array`) instead of applied by the vertex stage. The drawn
 * geometry is the same geometry; the arithmetic that produces each clip-space
 * position is not bit-identical to `viewProjection * model * p` evaluated in
 * the shader's `highp float`. Sub-ulp differences in a vertex position can move
 * an anti-aliased edge by a fraction of a pixel — so a batched draw is *not*
 * claimed to be bit-identical to the unbatched one, only geometrically and
 * semantically identical. This is why batching is opt-in per renderer rather
 * than switched on for everybody, and why the pixel gates compare a batched
 * scene against itself rather than against an unbatched golden.
 *
 * Baking assumes an **affine** world matrix (bottom row `0 0 0 1`), which is
 * what `Transform.compose` produces for every node in the engine; the fourth
 * row is not applied and no perspective divide is performed.
 *
 * ## Which pipelines, and why only those
 *
 * `"unlit"` and `"sprite"` — the two whose shading depends on nothing but the
 * fragment's own interpolated values. `"lit"` and `"standard"` shade with
 * normals, which a baked batch would have to transform by the inverse-transpose
 * *per item*, and `"particles"` arrives batched already (one item is one
 * instanced draw, plan P9-3). Instanced meshes for the shaded pipelines are
 * §65's own next strategy and a separate packet (R-22).
 *
 * ## Determinism (§33)
 *
 * A batch is a pure function of the item sequence: a left-to-right scan, no
 * `Map`, no `Set`, no iteration over object keys, no identity hashing. The same
 * list produces the same runs, the same vertex order and the same indices on
 * every run and every platform. The arithmetic is IEEE multiply-add in the
 * order written, so the vertex stream is bit-identical across runs of the same
 * build — same-runtime tier, and cross-platform for the copied streams (uv and
 * colour are memcpy) while the baked positions inherit the tier of whatever
 * produced the world matrix.
 *
 * ## Allocation (plan D7)
 *
 * One {@link RenderBatcher} owns two growable typed arrays and one mutable
 * batch record, all reused. The steady state allocates nothing: arrays grow to
 * the largest run the scene contains and then stop. The record and both arrays
 * are **valid until the next {@link RenderBatcher.next} call** — upload during
 * the call, never retain.
 */

import type { BufferGeometry } from "@four/geometry";
import type {
  MaterialTexture,
  SpriteMaterial,
  UnlitMaterial,
} from "@four/materials";
import type { ColorRGBA } from "@four/math";
import { ALL_LAYERS, type LayerMask } from "@four/scene";

import type { RenderItemClip } from "./clip.js";
import type {
  RenderItem,
  SpriteRenderItem,
  UnlitRenderItem,
} from "./render-list.js";
import type { SpriteFrame } from "./sprite.js";

/** Floats per vertex in the position stream — always present. */
const POSITION_FLOATS = 3;

/** Floats per vertex in the uv stream, when the batch carries one. */
const UV_FLOATS = 2;

/** Floats per vertex in the colour stream, when the batch carries one. */
const COLOR_FLOATS = 4;

/**
 * Vertices one batch may hold before the run is split, unless a caller says
 * otherwise.
 *
 * A cap is needed at all because the planner's arrays grow to the largest run
 * they are asked for and never shrink: without one, a scene of 100 000 sprites
 * sharing an atlas would allocate a single 400 000-vertex staging buffer, and a
 * backend would then upload it as one buffer object. 65 536 is chosen for two
 * reasons — it is the vertex count above which indices stop fitting in 16 bits
 * (this planner emits 32-bit indices, but a backend that wanted narrow ones
 * could split on the same boundary), and it bounds the staging arrays at
 * 65 536 × 9 floats ≈ 2.4 MB in the widest layout.
 *
 * Splitting costs one draw call per 65 536 vertices, which is 6 draws for
 * §86's 100 000-sprite row instead of 100 000.
 */
export const DEFAULT_MAX_BATCH_VERTICES = 65_536;

/** Construction arguments of {@link RenderBatcher}. */
export interface RenderBatchOptions {
  /**
   * Vertices one batch may hold before the run is split — see
   * {@link DEFAULT_MAX_BATCH_VERTICES}.
   *
   * An item whose geometry alone exceeds this is never batched; it draws on its
   * own, unchanged, which is the right answer for a mesh that is already one
   * big draw call.
   *
   * @throws FourError never — a value below one vertex simply means "batch
   * nothing", which is a legitimate way to switch the batcher off (§85's
   * refuse-don't-clamp applies to configuration that would otherwise be
   * silently reinterpreted; here the extreme value keeps its literal meaning).
   */
  maxVertices?: number;
}

/**
 * The materials this planner batches — the two whose pipelines shade from the
 * fragment's own interpolated values (see the module header).
 */
export type BatchableMaterial = UnlitMaterial | SpriteMaterial;

/**
 * The two render items {@link RenderBatcher} merges — the arms of
 * {@link RenderItem} whose pipelines shade from interpolated vertex values
 * alone (see the module header).
 */
export type BatchableItem = UnlitRenderItem | SpriteRenderItem;

/**
 * One merged draw: `items` consecutive render items, concatenated into one
 * interleaved vertex stream and one index stream.
 *
 * **Pooled and rewritten.** The record and both typed arrays belong to the
 * {@link RenderBatcher} that produced them and are overwritten by its next
 * {@link RenderBatcher.next} call. `vertices` and `indices` are the batcher's
 * whole staging arrays, which may be longer than this batch needs — read
 * `vertexCount × floatsPerVertex` floats and `indexCount` indices, and upload
 * with the five-argument `bufferSubData` rather than taking a `subarray` (which
 * would allocate a view per frame).
 */
export interface RenderBatch {
  /** Which pipeline draws it (§64, §66 key 3) — the merged items' `kind`. */
  readonly kind: "unlit" | "sprite";

  /**
   * The one material every merged item carries — the same object, not an equal
   * one. Every piece of §57 render state the draw needs is read off it.
   */
  readonly material: BatchableMaterial;

  /**
   * The texture the batch samples — a sprite material's `texture` (§55) or an
   * unlit material's `map` (§57, R-19) — or `null` when it samples none.
   *
   * Resolved here rather than by the backend so the draw path reads **one**
   * field instead of asking which kind of material this is; the same reason
   * `RenderItem` snapshots `transparent` and `materialId` rather than chasing
   * the material per comparison. A backend still resolves it to a GPU handle
   * through its own cache, and a batch whose texture resolves to nothing is
   * skipped or drawn untextured by exactly the rule that backend applies to a
   * single item.
   */
  readonly texture: MaterialTexture | null;

  /**
   * The RGBA the whole batch is tinted by — an unlit material's `color` or a
   * sprite material's `tint`, the same live array the material owns (copy it if
   * you need to keep it).
   *
   * One value for the batch because "same material instance" is the batching
   * rule: §55's tint and §57's colour are *material* state, so merging never
   * needs them per vertex. That is also why a sprite batch carries no colour
   * stream (see {@link RenderBatch.hasColors}).
   */
  readonly color: ColorRGBA;

  /** §57's `opacity` for the shared material, multiplying the alpha above. */
  readonly opacity: number;

  /** The merged items' shared draw mode (§53). */
  readonly mode: BufferGeometry["mode"];

  /**
   * §67's clip, shared by every merged item, or `null` where none of them is
   * clipped (R-23, 2026-08-21).
   *
   * A run breaks where the record changes, so this is one value for the whole
   * batch exactly as the material is: the same material under two different
   * clips is two different draws, and merging them would let one scroll view's
   * content escape into another's. A backend applies it exactly as it applies
   * a single item's.
   *
   * Never a mask pass: every clip owns its own bit plane and emits exactly one
   * mask draw, so two consecutive mask items never share a record and a run of
   * them never forms.
   *
   * Optional for `RenderItem.clip`'s reason — a hand-built batch predating §67
   * must still typecheck, and `undefined` reads as "unclipped" — but the
   * batcher itself always writes it.
   */
  readonly clip?: RenderItemClip | null;

  /**
   * How many consecutive render items this batch consumed. Always ≥ 2 — a run
   * of one is not a batch (see the module header).
   */
  readonly items: number;

  /** Vertices in {@link RenderBatch.vertices}. */
  readonly vertexCount: number;

  /** Indices in {@link RenderBatch.indices}; the draw's element count. */
  readonly indexCount: number;

  /**
   * Floats per vertex in the interleaved stream: position (3), then uv (2) when
   * {@link RenderBatch.hasUvs}, then colour (4) when
   * {@link RenderBatch.hasColors}, in that order.
   */
  readonly floatsPerVertex: number;

  /**
   * Whether the stream carries uv, i.e. whether the material samples a texture.
   * Always true for a sprite batch (§55's quad is a texture map by definition).
   */
  readonly hasUvs: boolean;

  /**
   * Whether the stream carries per-vertex colour, i.e. whether the material
   * declares §53's `vertexColors` (R-19). Always false for a sprite batch:
   * §55's tint is material state, shared by the run by construction.
   */
  readonly hasColors: boolean;

  /** Interleaved vertex data, world-space positions. See the interface note. */
  readonly vertices: Float32Array;

  /** Indices into {@link RenderBatch.vertices}, already offset per item. */
  readonly indices: Uint32Array;
}

/** The record the batcher fills; `RenderBatch` is its read-only face. */
interface MutableBatch {
  kind: "unlit" | "sprite";
  material: BatchableMaterial;
  texture: MaterialTexture | null;
  color: ColorRGBA;
  opacity: number;
  mode: BufferGeometry["mode"];
  clip: RenderItemClip | null;
  items: number;
  vertexCount: number;
  indexCount: number;
  floatsPerVertex: number;
  hasUvs: boolean;
  hasColors: boolean;
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * An item as this module reads §55's frame — structurally, exactly as
 * `render-list.ts` does, because a sprite item's `frame` is a
 * {@link SpriteFrame} or `null` and a *structurally typed* item built before
 * R-29 has no such property at all.
 */
interface FramedItem {
  readonly frame?: SpriteFrame | null;
}

/**
 * Whether `item` can start or join a batch at all, ignoring what it would join.
 *
 * Three questions, in the order that answers most items with the first: is its
 * pipeline one of the two this planner merges, does it carry a material to
 * merge by, and does its geometry have anything to draw? The last is the same
 * test a backend's geometry cache makes — a disposed geometry has empty arrays
 * (§53) and is skipped rather than drawn — so a run never straddles an item the
 * backend would have declined.
 */
function isBatchable(item: RenderItem): item is BatchableItem {
  if (item.kind !== "unlit" && item.kind !== "sprite") {
    return false;
  }
  const geometry = item.geometry;
  return (
    item.material !== undefined &&
    geometry.vertexCount > 0 &&
    geometry.drawCount > 0
  );
}

/**
 * The rectangle in **local** space that a sprite item's whole texture maps onto
 * — `(x, y, width, height)` written into `out`.
 *
 * This is the `quad` uniform `@four/render-webgl`'s sprite pipeline uploads,
 * derived here instead so a batched sprite can carry the same mapping *per
 * vertex*: `uv = (position.xy − quad.xy) / quad.zw`. With no frame the
 * rectangle is the geometry's own local bounds; with one it is the (larger,
 * offset) rectangle the whole texture would occupy given that the quad shows
 * `frame` of it — R-29's affine reparametrization, restated here in the same
 * form the shader uses so the two cannot drift apart in meaning.
 *
 * `render-list.ts`'s own note predicted this: "§65 batching is where that
 * changes, and it changes by carrying uv per vertex rather than per draw."
 */
function spriteQuad(
  item: RenderItem,
  material: SpriteMaterial,
  out: Float64Array,
): void {
  const bounds = item.geometry.computeBounds();
  const minX = bounds.min.x;
  const minY = bounds.min.y;
  const width = bounds.max.x - minX;
  const height = bounds.max.y - minY;
  const frame = (item as FramedItem).frame ?? null;
  if (frame === null) {
    out[0] = minX;
    out[1] = minY;
    out[2] = width;
    out[3] = height;
    return;
  }
  const texture = material.texture;
  out[0] = minX - (frame.x * width) / frame.width;
  out[1] = minY - (frame.y * height) / frame.height;
  out[2] = (width * texture.width) / frame.width;
  out[3] = (height * texture.height) / frame.height;
}

/**
 * §65's batcher: finds runs of compatible consecutive render items and merges
 * each into one draw's worth of vertex data.
 *
 * One instance per consumer (a renderer owns one), because the staging arrays
 * and the batch record are reused across calls. Holds no GPU resources, no
 * scene references and nothing to dispose: between calls it retains only its
 * two typed arrays and the material of the last batch it built.
 */
export class RenderBatcher {
  /** See {@link RenderBatchOptions.maxVertices}. */
  readonly maxVertices: number;

  /** Interleaved staging array; grows, never shrinks. */
  #vertices = new Float32Array(0);

  /** Index staging array; grows, never shrinks. */
  #indices = new Uint32Array(0);

  /** Scratch for {@link spriteQuad}, so uv derivation allocates nothing. */
  readonly #quad = new Float64Array(4);

  /**
   * The single pooled result record. Constructed with the fields' zero values
   * and a `null` material that {@link RenderBatcher.next} always overwrites
   * before returning — the same "every field is overwritten by the caller"
   * contract `render-list.ts`'s pooled items carry.
   */
  readonly #batch: MutableBatch = {
    kind: "unlit",
    // Written on every successful `next`; the cast is the pool's, exactly as
    // `render-list.ts`'s `itemAt` needs one, because a record cannot be
    // constructed without a material and no material exists yet.
    material: null as unknown as BatchableMaterial,
    texture: null,
    color: [1, 1, 1, 1],
    opacity: 1,
    mode: "triangles",
    clip: null,
    items: 0,
    vertexCount: 0,
    indexCount: 0,
    floatsPerVertex: POSITION_FLOATS,
    hasUvs: false,
    hasColors: false,
    vertices: this.#vertices,
    indices: this.#indices,
  };

  constructor(options: RenderBatchOptions = {}) {
    this.maxVertices = options.maxVertices ?? DEFAULT_MAX_BATCH_VERTICES;
  }

  /**
   * Plans and assembles the batch that starts at `items[from]`, or returns
   * `null` when that item does not start one.
   *
   * ```ts
   * const batch = batcher.next(list, i, viewMask);
   * if (batch !== null) { draw(batch); i += batch.items - 1; }
   * ```
   *
   * Returning `null` is the common answer and costs one predicate plus, at
   * most, one comparison against the next item: an item that cannot batch, or
   * whose successor carries a different material, is rejected before anything
   * is written. A caller that skips the merged items (`i += batch.items - 1`)
   * pays **O(n) in total** for a whole list, since each item is examined by the
   * scan that consumes it and by the scan that stops at it.
   *
   * `layerMask` is §46's per-view filter, applied here for the same reason a
   * backend applies it per item: an item this view does not draw must not be
   * merged into a batch it *would* draw. A masked-out item **ends the run**
   * rather than being skipped inside it, so the returned `items` count is
   * always a contiguous span of the list and the caller's index arithmetic
   * stays trivial.
   *
   * @param items a render list, as {@link buildRenderList} produced it.
   * @param from index of the item to start at.
   * @param layerMask §46 mask of the view being drawn; defaults to `ALL_LAYERS`.
   * @returns the pooled batch — valid until the next call — or `null`.
   */
  next(
    items: readonly RenderItem[],
    from: number,
    layerMask: LayerMask = ALL_LAYERS,
  ): RenderBatch | null {
    const first = items[from];
    if (first === undefined || (first.layers & layerMask) === 0) {
      return null;
    }
    if (!isBatchable(first)) {
      return null;
    }
    const material: BatchableMaterial = first.material;
    // Narrowed once, here, and carried through the assembly loop: a run's items
    // all share this material *instance*, so they all draw through this
    // pipeline. `null` for an unlit run is what tells `#writeVertices` to copy
    // the geometry's uv instead of deriving §55's.
    const spriteMaterial = first.kind === "sprite" ? first.material : null;
    // §67's clip for the whole run (R-23) — see `RenderBatch.clip`. `?? null`
    // so a structurally-typed item predating the field compares equal to the
    // builders' own unclipped `null` rather than ending every run at it.
    const clip = first.clip ?? null;
    const kind = first.kind;
    const mode = first.geometry.mode;
    let vertexCount = first.geometry.vertexCount;
    if (vertexCount > this.maxVertices) {
      return null;
    }
    let indexCount = first.geometry.drawCount;

    // Scan: how far does the run reach? Comparisons only — nothing is written
    // until the run is known to be worth building, so the common "no batch
    // here" answer never touches the staging arrays.
    let count = 1;
    for (let i = from + 1; i < items.length; i += 1) {
      const item = items[i];
      if (
        (item.layers & layerMask) === 0 ||
        item.material !== material ||
        // §67 (R-23): the same material under a different clip is a different
        // draw. Identity, not equality — every item under one clip carries the
        // same pooled record — and `null !== null` is `false`, so an unclipped
        // scene's runs are exactly the runs it had before clipping existed.
        // `?? null` for `first`'s reason above.
        (item.clip ?? null) !== clip ||
        item.geometry.mode !== mode ||
        !isBatchable(item)
      ) {
        break;
      }
      const geometry = item.geometry;
      if (vertexCount + geometry.vertexCount > this.maxVertices) {
        break;
      }
      vertexCount += geometry.vertexCount;
      indexCount += geometry.drawCount;
      count += 1;
    }
    if (count < 2) {
      return null;
    }

    // §57's feature switches decide the layout, and they are material state —
    // so one look at the shared material answers for the whole run. A sprite
    // always samples (§55) and never carries per-vertex colour; an unlit
    // material carries whichever of the two R-19 streams it declares.
    // Read defensively, as `render-list.ts` reads §57's flags and for the same
    // reason: a **structurally typed** material double predating §57's `map` or
    // §53's `vertexColors` reports `undefined`, which must mean "samples
    // nothing" and "carries no colour stream" rather than widening the layout
    // with a stream no geometry will fill.
    const texture =
      first.kind === "sprite"
        ? first.material.texture
        : (first.material.map ?? null);
    const hasUvs = first.kind === "sprite" || texture !== null;
    const hasColors =
      first.kind === "unlit" && first.material.vertexColors === true;
    const floatsPerVertex =
      POSITION_FLOATS +
      (hasUvs ? UV_FLOATS : 0) +
      (hasColors ? COLOR_FLOATS : 0);

    this.#reserve(vertexCount * floatsPerVertex, indexCount);
    const vertices = this.#vertices;
    const indices = this.#indices;
    let vertexBase = 0;
    let floatOffset = 0;
    let indexOffset = 0;
    for (let i = 0; i < count; i += 1) {
      const item = items[from + i];
      const geometry = item.geometry;
      if (spriteMaterial !== null) {
        spriteQuad(item, spriteMaterial, this.#quad);
      }
      floatOffset = this.#writeVertices(
        item,
        floatOffset,
        floatsPerVertex,
        hasUvs,
        hasColors,
        spriteMaterial !== null,
      );
      indexOffset = this.#writeIndices(geometry, indexOffset, vertexBase);
      vertexBase += geometry.vertexCount;
    }

    const batch = this.#batch;
    batch.kind = kind;
    batch.material = material;
    // The kind-dependent reads, done once here so the backend's draw path has
    // none — see `RenderBatch.texture` and `RenderBatch.color`. `?? 1` on the
    // opacity for the reason the feature switches are read defensively above.
    batch.texture = texture;
    batch.color =
      first.kind === "sprite" ? first.material.tint : first.material.color;
    batch.opacity = material.opacity ?? 1;
    batch.mode = mode;
    batch.clip = clip;
    batch.items = count;
    batch.vertexCount = vertexCount;
    batch.indexCount = indexCount;
    batch.floatsPerVertex = floatsPerVertex;
    batch.hasUvs = hasUvs;
    batch.hasColors = hasColors;
    batch.vertices = vertices;
    batch.indices = indices;
    return batch;
  }

  /**
   * Grows the staging arrays to hold at least `floats` and `indices`.
   *
   * Doubling (from a 1 024-float floor) rather than exact sizing, so a scene
   * whose batches vary in size reallocates a handful of times and then never
   * again — the same "grow to the scene and stop" shape `render-list.ts`'s item
   * pool has. Contents are not preserved: every float and index is overwritten
   * by the caller before it is read.
   */
  #reserve(floats: number, indices: number): void {
    if (this.#vertices.length < floats) {
      let length = Math.max(1_024, this.#vertices.length);
      while (length < floats) length *= 2;
      this.#vertices = new Float32Array(length);
    }
    if (this.#indices.length < indices) {
      let length = Math.max(1_024, this.#indices.length);
      while (length < indices) length *= 2;
      this.#indices = new Uint32Array(length);
    }
  }

  /**
   * Writes one item's vertices into the staging array at `offset`, returning
   * the offset after them.
   *
   * The position of every vertex is transformed by the item's **world matrix**
   * here, because a batch has one model matrix for many nodes — see the module
   * header for what that costs and what it does not. The other two streams are
   * copied verbatim: a batched geometry's uv and colour are the same numbers
   * the unbatched draw would have read out of the same buffers.
   *
   * A geometry that lacks a stream the layout declares contributes GL's own
   * generic attribute default — `(0, 0)` for uv, `(0, 0, 0, 1)` for colour —
   * which is precisely what the *unbatched* draw would sample, since a vertex
   * array with no such buffer leaves the attribute disabled. Filling the
   * default rather than refusing the item is therefore not a kindness: it is
   * what keeps the batch a faithful copy of the draws it replaces.
   */
  #writeVertices(
    item: RenderItem,
    offset: number,
    floatsPerVertex: number,
    hasUvs: boolean,
    hasColors: boolean,
    deriveUvs: boolean,
  ): number {
    const geometry = item.geometry;
    const positions = geometry.positions;
    const vertexCount = geometry.vertexCount;
    const uvs = geometry.uvs;
    const colors = geometry.colors;
    const e = item.worldMatrix.elements;
    const m0 = e[0];
    const m1 = e[1];
    const m2 = e[2];
    const m4 = e[4];
    const m5 = e[5];
    const m6 = e[6];
    const m8 = e[8];
    const m9 = e[9];
    const m10 = e[10];
    const m12 = e[12];
    const m13 = e[13];
    const m14 = e[14];
    const quadX = this.#quad[0];
    const quadY = this.#quad[1];
    const quadWidth = this.#quad[2];
    const quadHeight = this.#quad[3];
    const vertices = this.#vertices;
    let at = offset;
    for (let v = 0; v < vertexCount; v += 1) {
      const p = v * 3;
      const x = positions[p];
      const y = positions[p + 1];
      const z = positions[p + 2];
      vertices[at] = m0 * x + m4 * y + m8 * z + m12;
      vertices[at + 1] = m1 * x + m5 * y + m9 * z + m13;
      vertices[at + 2] = m2 * x + m6 * y + m10 * z + m14;
      let stream = at + POSITION_FLOATS;
      if (hasUvs) {
        if (deriveUvs) {
          // §55's mapping, per vertex instead of per draw — the same expression
          // the sprite vertex stage evaluates, over the same *local* position.
          vertices[stream] = (x - quadX) / quadWidth;
          vertices[stream + 1] = (y - quadY) / quadHeight;
        } else if (uvs === undefined) {
          vertices[stream] = 0;
          vertices[stream + 1] = 0;
        } else {
          const uv = v * 2;
          vertices[stream] = uvs[uv];
          vertices[stream + 1] = uvs[uv + 1];
        }
        stream += UV_FLOATS;
      }
      if (hasColors) {
        if (colors === undefined) {
          vertices[stream] = 0;
          vertices[stream + 1] = 0;
          vertices[stream + 2] = 0;
          vertices[stream + 3] = 1;
        } else {
          const c = v * 4;
          vertices[stream] = colors[c];
          vertices[stream + 1] = colors[c + 1];
          vertices[stream + 2] = colors[c + 2];
          vertices[stream + 3] = colors[c + 3];
        }
      }
      at += floatsPerVertex;
    }
    return at;
  }

  /**
   * Writes one item's indices into the staging array at `offset`, shifted by
   * `vertexBase`, and returns the offset after them.
   *
   * A **non-indexed** geometry contributes the identity sequence, which is what
   * makes a run of mixed indexed and non-indexed geometries mergeable at all:
   * one merged draw has one element type, so the batch is always indexed and a
   * `drawArrays` item becomes `base, base+1, …` — the same vertices in the same
   * order, drawn by `drawElements` instead. §53 fixes both index types at
   * unsigned integers and this planner widens to 32 bits, so no source index
   * can overflow the destination.
   */
  #writeIndices(
    geometry: BufferGeometry,
    offset: number,
    vertexBase: number,
  ): number {
    const indices = this.#indices;
    const source = geometry.indices;
    const count = geometry.drawCount;
    if (source === undefined) {
      for (let i = 0; i < count; i += 1) {
        indices[offset + i] = vertexBase + i;
      }
      return offset + count;
    }
    for (let i = 0; i < count; i += 1) {
      indices[offset + i] = vertexBase + source[i];
    }
    return offset + count;
  }
}
