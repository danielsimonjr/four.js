/**
 * Render-list construction (§64) — scene graph in, flat sorted draw list out.
 *
 * §64 requires the renderer pipeline to separate eight stages: traversal,
 * visibility and layer filtering, frustum and occlusion culling, render-item
 * generation, sorting, batching and instancing, backend command encoding, and
 * GPU submission. This module is stages **1, 2, 4, and 5** — the backend-
 * independent half — and produces "compact render items" exactly as §64 asks,
 * so the drawing hot path never makes a virtual call on a node.
 *
 * Two node kinds generate an item: §49's `Renderable` — which §55's `Sprite`
 * has been a subclass of since §57's `Material` base landed (2026-08-06) — and,
 * structurally and never by inheritance, a §36 particle system, which
 * contributes **one batched item for the whole system** (plan P9-3). The second
 * is a duck-typed contract because the frozen dependency matrix forbids an edge
 * in either direction (see `particles.ts`).
 *
 * Which pipeline a renderable draws through is read off its **material's**
 * `kind` (§57), not off the node's class: that is one property load, it is what
 * makes a family member a consumer writes reachable without editing this file,
 * and it is why the sprite no longer needs an `instanceof` of its own.
 *
 * Not here, and why:
 *
 * - **Culling (stage 3).** Frustum culling needs a camera and per-item world
 *   bounds; cameras land in `@four/scene` with WP-3.1/3.2 and bounds
 *   transformation belongs with §87's spatial index. Building it now would mean
 *   inventing both. Every visible renderable is therefore submitted.
 * - **Batching (stage 6).** §65 is a whole packet, and batching decisions
 *   depend on the backend's pipeline model (WP-3.5). The one exception is a
 *   particle system, which arrives *already* batched: one item carrying every
 *   particle, because §112's 100 000-particle target is not reachable any other
 *   way (plan P9-3, WP-9.3).
 * - **Encoding and submission (stages 7–8).** Backend work by definition; the
 *   render list is the handover point, and it deliberately contains no GL
 *   objects.
 *
 * ## Ordering (§66 subset)
 *
 * §66's full order is: render layer, opaque versus transparent, pipeline and
 * material compatibility, depth, explicit render order. {@link buildRenderList}
 * sorts by **render layer, then opaque before transparent, then explicit render
 * order, then scene-graph order** — keys 1, 2, and 5.
 *
 * Key 3 (pipeline and material compatibility) ships as
 * {@link groupRenderListByPipeline}, a **second verb** rather than a mode of the
 * builders, and key 4 (depth) is still deferred:
 *
 * - key 3 cannot be the default order, and the reason is stronger than
 *   byte-identity (R-10, 2026-08-09). Grouping by pipeline permutes draws that
 *   were tied under keys 1, 2 and 5 — which, in this engine, is most of a 2D
 *   scene — and **co-planar opaque draws are order-dependent**: §61 fixes the
 *   depth function at `LEQUAL`, so of two surfaces at the same depth the one
 *   submitted *later* wins. That is not an accident to be fixed; it is what
 *   makes a §58 stroke paint over its own fill (R-16) and what makes a later
 *   sibling draw on top in every 2D scene. A default-on key 3 would therefore
 *   repaint existing scenes, not merely reorder their GL calls. §66 lists the
 *   key for content whose overlap is resolved by depth, and this engine's
 *   own 2D layer model is the case where that is untrue, so the key is offered
 *   and never imposed. See {@link groupRenderListByPipeline};
 * - depth sorting needs a camera (WP-3.1/3.2) to measure distance along, and a
 *   per-view render list to store the measurement in (§87 culling, R-8). One
 *   list serves every view in this engine today (see `RenderItem.layers`), so a
 *   depth key computed for one camera would order the others by the wrong
 *   number — a key 4 written now would be *wrong*, not merely disruptive.
 *   Deferred again 2026-08-09, on R-8 rather than on a byte-identity argument.
 *
 * Key 2 landed on 2026-08-06 with §57's `transparent` flag (`material.ts`).
 * It is a **no-op for every scene that does not use it**: with the base's
 * `transparent: false` default every item classifies opaque, the comparator
 * returns 0, and the stable sort leaves the list exactly as it was — which is
 * the property that let the key land under the pixel-golden gate. The sprite
 * and particle pipelines blend by construction but are *classified* by their
 * material's flag like everything else; reclassifying them wholesale is a
 * follow-up (2026-08-06), because it would reorder existing scenes.
 *
 * The tie-break is **scene-graph order** — the depth-first, insertion-ordered
 * walk of §6 — which makes the list a deterministic function of the scene (§33)
 * and gives authors the one ordering guarantee 2D content actually relies on:
 * later siblings draw on top. It comes for free from a stable sort, since items
 * are generated in traversal order.
 *
 * ## Allocation (plan D7)
 *
 * Both builders fill a caller-supplied `out` array and reuse **pooled item
 * objects** keyed to that array, so the steady state allocates nothing at all —
 * no items, no matrices, no `Vector3`/`Quaternion` scratch. The consequences
 * are stated on {@link buildRenderList} and matter: the items are valid until
 * the next build into the same array.
 */

import { DEV } from "@four/core";
import type { BufferGeometry } from "@four/geometry";
import { Matrix4, Quaternion, Vector3 } from "@four/math";
import type {
  LitMaterial,
  Material,
  SpriteMaterial,
  StandardMaterial,
  UnlitMaterial,
} from "@four/materials";
import {
  ALL_LAYERS,
  DEFAULT_LAYER_MASK,
  assertLayerMask,
  isLayerMask,
  layersMatch,
  type LayerMask,
  type Node,
  type PoseBuffer,
  type Viewport,
} from "@four/scene";

import { isParticleDrawable, particleQuadGeometry } from "./particles.js";
import { Renderable } from "./renderable.js";
import type { SpriteFrame } from "./sprite.js";

/**
 * A drawable that may carry §55's frame, as this module reads it (R-29,
 * 2026-08-08).
 *
 * Structural, and deliberately not `node instanceof Sprite`. Which pipeline a
 * node draws through is read off its **material** here (see `pipelineOf`), so
 * "is a sprite item" and "is a `Sprite`" are not the same predicate: a plain
 * `Renderable` carrying a `SpriteMaterial` produces a sprite item and has no
 * `frame`, and that must read as "no frame" rather than as a type error or a
 * crash. It also keeps the `instanceof` this module removed in 2026-08-06 from
 * coming back, and keeps the import type-only — no runtime edge from the list
 * to the node class.
 */
interface FramedDrawable {
  readonly frame?: SpriteFrame | null;
}

/**
 * Which pipeline a render item needs (§64 stage 7, §66 sort key 3).
 *
 * A backend cannot draw a textured quad with the flat-colour pipeline, so an
 * item has to say which one it is. The discriminant is carried **on the item**
 * rather than derived from the material's class at draw time, for the reason
 * §64 gives for compact render items in the first place: the draw path must not
 * make a virtual call, an `instanceof` check, or a property probe per object.
 * It is also the field §66's key 3 ("pipeline/material compatibility") will sort
 * on when batching (§65) lands (decision, WP-3a.3).
 *
 * A string union rather than an enum, matching `TransformAuthority`,
 * `RendererBackend`, and `GeometryDrawMode`: it serializes, logs, and compares
 * as itself.
 *
 * `"lit"` joined with the §68 lighting packet (2026-08-04): a `Renderable`
 * generates `"unlit"` or `"lit"` according to its material's own `kind`
 * discriminant (§57) — a material property, not a node property, because
 * which pipeline shades a surface is exactly what a material *is*.
 *
 * `"standard"` joined with §59's metallic-roughness workflow (R-13,
 * 2026-08-08), by the same rule and for the same reason. Widening this union is
 * still an edit to this package, which is R-12's remaining half: the closed
 * union is the **staging mechanism**, not the destination — it keeps every arm
 * type-checked end to end while the pipeline registry §64 asks for is designed
 * (see `pipelineOf`).
 */
export type RenderItemKind =
  "unlit" | "lit" | "standard" | "sprite" | "particles";

/**
 * The fields every render item carries, whatever pipeline draws it — one draw in
 * the compact form §64 asks for: no node reference, no virtual calls, nothing
 * the backend has to walk.
 *
 * Every field is a snapshot or a reference taken during list construction. The
 * item object itself is **pooled and rewritten** by the next build into the same
 * `out` array — see {@link buildRenderList}.
 */
interface RenderItemBase {
  /**
   * World transform of the drawn node.
   *
   * {@link buildRenderList} stores a **reference to the node's own**
   * `transform.worldMatrix`, so the item costs nothing to fill and always
   * reflects the last resolve. {@link buildInterpolatedRenderList} stores a
   * pooled matrix holding the §43 render pose instead. Either way: read it,
   * upload it, do not mutate it.
   */
  worldMatrix: Matrix4;
  /** Vertex data to draw (§53). */
  geometry: BufferGeometry;
  /** §66 sort key 5, copied from the drawable node. */
  renderOrder: number;
  /** §66 sort key 1, copied from the drawable node. */
  renderLayer: number;
  /**
   * The drawable node's §46 layer mask, snapshotted at generation time (R-38,
   * 2026-08-08).
   *
   * Not a sort key and not read by the comparator — it is what lets **one**
   * render list serve several views with different masks, which is the shape
   * this engine has until the per-view list arrives (R-8): the backend tests
   * `item.layers & effectiveViewMask` once per item per view, before it touches
   * a GPU resource. Filtering *at build time* is the other half and is
   * {@link buildRenderList}'s `layerMask` parameter; the two compose, since an
   * item that was never generated cannot be drawn into any view.
   *
   * On the item rather than reached through a node reference for the reason §64
   * gives for compact render items in the first place — and because a compact
   * item has no node reference to reach through.
   *
   * Confusingly adjacent to `renderLayer` above, and unrelated: that is §66's
   * ordering ordinal, this is §46's membership set.
   */
  layers: LayerMask;
  /**
   * §66 sort key 2, read off the item's material (§57's `transparent`) at
   * generation time: `false` for an opaque draw, `true` for a blended one.
   *
   * Snapshotted onto the item rather than reached through `material.transparent`
   * inside the comparator, for the reason §64 gives for compact render items —
   * a comparator runs O(n log n) times and must not chase a reference per
   * call — and because a particle item has no material to ask.
   */
  transparent: boolean;
  /**
   * The item's material's stable `id` (§57), snapshotted at generation time —
   * the *material* half of §66's sort key 3 (R-10, 2026-08-09). `""` for a
   * particle item, which has no material.
   *
   * Key 3 is "pipeline **and** material compatibility", and this item carries it
   * as two fields rather than one: `kind` is the pipeline and this is the
   * material. Not one concatenated key, because building `${kind}:${id}` would
   * allocate a string per item per frame, which is exactly what the pooled item
   * exists to avoid (plan D7). Not read through `material.id` inside the
   * comparator either, for the reason §64 gives for compact render items — a
   * comparator runs O(n log n) times and must not chase a reference per call.
   *
   * Ids are assigned from `Material`'s monotonic counter in construction order,
   * so ordering by them is a deterministic function of the program that built
   * the scene (§33) — the property {@link groupRenderListByPipeline} rests on.
   * They are compared as strings, so the order is lexicographic
   * (`material-10` before `material-9`) rather than numeric: §66 asks for
   * *grouping*, and any total order that puts equal ids together satisfies it.
   */
  materialId: string;
  /**
   * §49's `castShadow`, snapshotted from the drawable node (§69; R-18,
   * 2026-08-09).
   *
   * Read by the backend's **depth-only shadow pass**, which walks this same
   * list before the view loop and draws the items carrying `true` — of the
   * three *surface* kinds only, since a §55 quad would cast its rectangle
   * rather than its texture (see `Renderable.castShadow`). On
   * the item rather than reached through a node reference for the reason §64
   * gives for compact render items in the first place — and because a compact
   * item has no node reference to reach through.
   *
   * Always `false` on a particle item: §36's billboards have no surface to
   * project (see {@link ParticleRenderItem}).
   */
  castShadow: boolean;
  /**
   * §49's `receiveShadow`, snapshotted from the drawable node (§69; R-18,
   * 2026-08-09).
   *
   * Read by the two **shaded** pipelines, which switch the shadow comparison
   * off for a draw carrying `false`; the unlit and sprite pipelines have no
   * lighting term to attenuate and never ask. Always `false` on a particle
   * item, for the reason above.
   */
  receiveShadow: boolean;
}

/** A draw generated from a `Renderable` (§49) — flat colour, no texture. */
export interface UnlitRenderItem extends RenderItemBase {
  kind: "unlit";
  /** Surface appearance (§57). */
  material: UnlitMaterial;
}

/**
 * A draw generated from a `Renderable` carrying a `LitMaterial` (§49, §57,
 * §68) — Lambert diffuse plus the scene ambient term. The item is the draw
 * only; the lights it is shaded by travel separately, in the frame's
 * `SceneLights` record (`lights.ts`), because they are per-frame state shared
 * by every lit item, not per-draw state.
 */
export interface LitRenderItem extends RenderItemBase {
  kind: "lit";
  /** Surface appearance (§57, §68). */
  material: LitMaterial;
}

/**
 * A draw generated from a `Renderable` carrying a `StandardMaterial` (§49,
 * §57, §59) — metallic-roughness PBR, one diffuse and one specular lobe under
 * the same §68 lighting a {@link LitRenderItem} is shaded by.
 *
 * Structurally identical to a lit item, and deliberately a **separate arm**
 * rather than a widened `LitRenderItem.material`: the two draw through
 * different programs, and §66's sort key 3 is a pipeline key. The frame's
 * lights travel in the shared `SceneLights` record exactly as they do for the
 * lit pipeline — they are per-frame state, not per-draw state.
 */
export interface StandardRenderItem extends RenderItemBase {
  kind: "standard";
  /** Surface appearance (§57, §59, §68). */
  material: StandardMaterial;
}

/** A draw generated from a {@link Sprite} (§55) — one textured, tinted quad. */
export interface SpriteRenderItem extends RenderItemBase {
  kind: "sprite";
  /** Surface appearance (§55, §57). */
  material: SpriteMaterial;
  /**
   * §55's frame sub-rectangle in texels, or `null` for the whole texture
   * (R-29, 2026-08-08) — a **reference to the sprite's own record**, snapshotted
   * like every other field at generation time.
   *
   * A reference rather than a copy for the reason `worldMatrix` and
   * `material.tint` are: the item is pooled and rewritten, and copying four
   * floats per sprite per frame buys nothing a backend can observe — it reads
   * the frame during the same call that built the list. Read it, resolve it to
   * uv, do not retain it.
   *
   * `null` rather than absent so a backend's read is one property load and one
   * comparison on every sprite item, framed or not, with no `in` check and no
   * shape change between the two cases — which is what keeps a frameless
   * sprite on exactly the code path it was on before frames existed.
   *
   * On the sprite item and not on the item base: no other pipeline
   * samples an atlas today. §65 batching is where that changes, and it changes
   * by carrying uv per vertex rather than per draw.
   */
  frame: SpriteFrame | null;
}

/**
 * A draw generated from a particle system (§36) — **one batched, instanced
 * draw for the whole system**, whatever its particle count (§64 stage 6, plan
 * P9-3).
 *
 * The contract, the interleaved instance layout, and the blending and
 * billboarding a backend owes it live in `particles.ts`; read that module's
 * header before implementing one. In this file the item is just the third arm
 * of the union, and it differs from the other two in exactly two ways:
 *
 * - **`geometry` is the *instance* mesh**, not the drawn shape:
 *   {@link particleQuadGeometry}'s shared unit quad, drawn `count` times.
 *   Carrying it here rather than inventing a fourth item field is what lets a
 *   backend's ordinary geometry cache upload it, once, like any other geometry.
 * - **There is no material.** §36 puts colour on the particle, not on a shared
 *   surface, so every particle carries its own straight-alpha RGBA in the
 *   instance stream. The field is declared as `material?: undefined` rather
 *   than omitted so that `item.material` stays *readable* on the union — a
 *   backend or a test can ask any item for its material and get `undefined`
 *   here, instead of failing to compile.
 */
export interface ParticleRenderItem extends RenderItemBase {
  kind: "particles";

  /**
   * Stable identity of the emitting node (§6), for a backend to key this
   * system's GPU buffers on — see `ParticleDrawable.id`.
   */
  id: string;

  /** Live particles to draw; the instance count of the batched draw. */
  count: number;

  /**
   * The emitting node's interleaved instance array (`particles.ts`), valid for
   * `count × PARTICLE_INSTANCE_FLOATS` floats. Owned by the node and rewritten
   * every frame: upload it during the call, never retain it.
   */
  instances: Float32Array;

  /** Particles carry no material — see the interface documentation. */
  material?: undefined;
}

/**
 * One draw (§64), as a **discriminated union** on {@link RenderItemKind}.
 *
 * ```ts
 * for (const item of buildRenderList(scene, out)) {
 *   if (item.kind === "sprite") {
 *     bind(item.material.texture);      // narrowed to SpriteMaterial
 *   } else if (item.kind === "particles") {
 *     upload(item.instances, item.count);
 *   } else {
 *     upload(item.material.color);      // narrowed to UnlitMaterial
 *   }
 * }
 * ```
 *
 * A union rather than one interface with a widened `material` so that a backend
 * gets the concrete material type from an ordinary `kind` check, with no cast
 * and no `instanceof` on the draw path. The builders pay for that with **one**
 * documented cast where the invariant is actually established — see
 * `itemAt`.
 */
export type RenderItem =
  | UnlitRenderItem
  | LitRenderItem
  | StandardRenderItem
  | SpriteRenderItem
  | ParticleRenderItem;

/**
 * The pooled item as the builders write it: one mutable shape covering every
 * union member, because a pooled object is rewritten field by field and
 * TypeScript cannot track a union member across independent assignments.
 *
 * Fields that belong to one arm are present on all of them here and carry
 * harmless defaults for the others — `material` is `undefined` on a particle
 * item, `frame` is `null` on everything but a framed sprite, `count` is `0` and
 * `instances` empty on the other two. The exported union is what hides them,
 * which is why a caller never sees a sprite item offering a particle count.
 *
 * Not exported: outside this module an item is always a {@link RenderItem}, and
 * the correlation between `kind` and the arm-specific fields is an invariant the
 * builders maintain rather than a contract callers may break.
 */
interface MutableRenderItem extends RenderItemBase {
  kind: RenderItemKind;
  material?: UnlitMaterial | LitMaterial | StandardMaterial | SpriteMaterial;
  frame: SpriteFrame | null;
  id: string;
  count: number;
  instances: Float32Array;
}

/**
 * Which pipeline draws a node carrying `material` (§57, §64).
 *
 * One property load and a short chain of comparisons, with `"unlit"` as the
 * fallback so that a structurally-typed material double predating the
 * discriminant — or a family member no backend knows yet — keeps drawing
 * flat-coloured rather than vanishing. Replacing this mapping with the registry
 * §64 wants, so a consumer's material can bring its own pipeline, is R-12's
 * remaining half and is recorded as a follow-up (2026-08-06).
 *
 * The chain is ordered by how often each arm is taken, not alphabetically:
 * `"lit"` and `"standard"` are the two surface families a 3D scene mixes, and
 * `"sprite"` is asked last because §55's quads reach this function through the
 * same `Renderable` slot but are a minority of the items in any scene that has
 * both.
 */
function pipelineOf(material: Material): RenderItemKind {
  if (material.kind === "lit") {
    return "lit";
  }
  if (material.kind === "standard") {
    return "standard";
  }
  if (material.kind === "sprite") {
    return "sprite";
  }
  return "unlit";
}

/**
 * The `instances` a non-particle pooled item carries: shared, empty, never
 * uploaded. One array for the whole module, so pooling a thousand items does
 * not allocate a thousand empty buffers.
 */
const EMPTY_INSTANCES = new Float32Array(0);

/** Narrows `item` to the textured-quad pipeline (§55). */
export function isSpriteItem(item: RenderItem): item is SpriteRenderItem {
  return item.kind === "sprite";
}

/** Narrows `item` to the flat-colour pipeline (§57's `UnlitMaterial`). */
export function isUnlitItem(item: RenderItem): item is UnlitRenderItem {
  return item.kind === "unlit";
}

/** Narrows `item` to the Lambert-lit pipeline (§57's `LitMaterial`, §68). */
export function isLitItem(item: RenderItem): item is LitRenderItem {
  return item.kind === "lit";
}

/**
 * Narrows `item` to the metallic-roughness pipeline (§57's `StandardMaterial`,
 * §59; R-13).
 */
export function isStandardItem(item: RenderItem): item is StandardRenderItem {
  return item.kind === "standard";
}

/** Narrows `item` to the batched particle pipeline (§36; see `particles.ts`). */
export function isParticlesItem(item: RenderItem): item is ParticleRenderItem {
  return item.kind === "particles";
}

/**
 * The §46 layer mask a view actually draws (§47, §48; R-38, 2026-08-08) —
 * `view.layerMask` when it has one, the camera's own `layers` otherwise.
 *
 * ```ts
 * const mask = viewLayerMask(view);
 * for (const item of list) {
 *   if ((item.layers & mask) === 0) continue;   // layersMatch, inlined
 *   draw(item);
 * }
 * ```
 *
 * §48's fallback rule in exactly one place, so every backend and every consumer
 * that draws a viewport resolves it identically. Both defaults are `ALL_LAYERS`
 * — a viewport with no mask over a camera with no mask draws every layer — so
 * this returns `ALL_LAYERS` for every view built before layers existed.
 *
 * The trailing `?? ALL_LAYERS` is not dead: `Camera.layers` is non-optional in
 * the type system, but a **structurally typed camera** predating the field
 * (`@four/render-webgl`'s test double, a host's own minimal camera object)
 * reports `undefined`, and that must resolve to "draws everything" rather than
 * to a mask of zero that silently empties the view. Same defence, same reason,
 * as `material.transparent === true` in `collect`.
 */
export function viewLayerMask(view: Viewport): LayerMask {
  const mask = view.layerMask ?? view.camera.layers ?? ALL_LAYERS;
  // §85, and only in a development build: this runs once per view per frame, so
  // the cheap predicate gates the message — a template literal built here would
  // allocate a string every frame, which is precisely what `@four/core`'s
  // `dev.ts` tells callers not to do. `assertLayerMask` re-tests and throws.
  if (DEV && !isLayerMask(mask)) {
    assertLayerMask(mask, `viewport "${view.id}" layer mask`);
  }
  return mask;
}

/** Pooled backing store for one `out` array. */
interface ListPool {
  /** Item objects, indexed by generation order (not by final sorted order). */
  readonly items: MutableRenderItem[];
  /**
   * World matrices for the interpolated builder, index-aligned with `items` and
   * grown only when that builder runs — {@link buildRenderList} never
   * constructs one.
   */
  readonly matrices: Matrix4[];
}

/**
 * Pools, keyed by the `out` array they serve.
 *
 * Keying on `out` rather than using one module-wide pool is what makes two
 * simultaneously live render lists safe (two viewports, or a main list plus a
 * shadow list): each keeps its own items. A `WeakMap` so a discarded list takes
 * its pool with it. Steady state is one `WeakMap` lookup per build.
 */
const pools = new WeakMap<readonly RenderItem[], ListPool>();

function poolFor(out: RenderItem[]): ListPool {
  let pool = pools.get(out);
  if (pool === undefined) {
    pool = { items: [], matrices: [] };
    pools.set(out, pool);
  }
  return pool;
}

/**
 * Returns pooled item `index`, creating it (once, ever, for this `out` array)
 * from the two fields that have no meaningful default — a geometry and a
 * matrix, both of which the caller has in hand. **Every field is overwritten by
 * the caller immediately**, including these two; they are parameters only
 * because `MutableRenderItem` cannot be constructed without them.
 */
function itemAt(
  pool: ListPool,
  index: number,
  geometry: BufferGeometry,
  worldMatrix: Matrix4,
): MutableRenderItem {
  let item = pool.items[index];
  if (item === undefined) {
    item = {
      kind: "unlit",
      worldMatrix,
      geometry,
      material: undefined,
      frame: null,
      renderOrder: 0,
      renderLayer: 0,
      layers: DEFAULT_LAYER_MASK,
      transparent: false,
      materialId: "",
      castShadow: false,
      receiveShadow: false,
      id: "",
      count: 0,
      instances: EMPTY_INSTANCES,
    };
    pool.items[index] = item;
  }
  return item;
}

/** Returns pooled render-pose matrix `index`, creating it once. */
function matrixAt(pool: ListPool, index: number): Matrix4 {
  let matrix = pool.matrices[index];
  if (matrix === undefined) {
    matrix = new Matrix4();
    pool.matrices[index] = matrix;
  }
  return matrix;
}

/**
 * Scratch used by {@link composeRenderPoseMatrix}. Module-level and reused, so
 * interpolated list building allocates nothing per node (§7b, plan D7); the
 * price is that composition is not re-entrant, which is fine on a single-
 * threaded render path that never calls user code.
 */
const ancestorChain: Node[] = [];
const scratchLocal = new Matrix4();
const scratchPosition = new Vector3();
const scratchRotation = new Quaternion();

/**
 * Writes `node`'s **interpolated** world matrix into `out` (§43).
 *
 * The world matrix is composed from the outermost ancestor down, using each
 * level's interpolated local pose where the pose buffer has one and its live
 * local matrix where it does not:
 *
 * ```text
 * out = L(root) · … · L(parent) · L(node)
 * L(n) = compose(lerp(prev, cur, alpha), slerp(prev, cur, alpha), scale, pivot)
 * ```
 *
 * Cost is **O(depth) per item**, since each node re-walks its own ancestor
 * chain; a depth-`d` subtree of `n` nodes costs `O(n · d)` rather than the
 * `O(n)` the ordinary resolver achieves by composing top-down as it descends.
 * That is a deliberate simplification: the interpolated path composes into
 * per-item scratch matrices instead of into the scene, so it has nowhere to
 * cache a parent result, and a depth-keyed matrix stack is an optimization for
 * the packet that finds it necessary. Scene depths in the MVP are single
 * digits.
 *
 * **Nothing in the scene is written.** §43 is explicit that the render
 * transform must not feed back into simulation state, and §42 would make any
 * such write a second authority over the node. This function reads
 * `transform.scale`/`transform.pivot`, calls the lazy, idempotent
 * `updateLocalMatrix()` on untracked nodes — which recomposes the local matrix
 * from unchanged inputs and does not touch `version` — and writes only into
 * `out`. `transform.version`, `transform.worldVersion`, and
 * `transform.worldMatrix` are all left exactly as they were.
 */
function composeRenderPoseMatrix(
  node: Node,
  poses: PoseBuffer,
  alpha: number,
  out: Matrix4,
): void {
  ancestorChain.length = 0;
  for (let n: Node | null = node; n !== null; n = n.parent) {
    ancestorChain.push(n);
  }

  for (let i = ancestorChain.length - 1; i >= 0; i -= 1) {
    const current = ancestorChain[i];
    const transform = current.transform;
    let local: Matrix4;
    if (
      poses.computeRenderPose(current, alpha, scratchPosition, scratchRotation)
    ) {
      local = scratchLocal.compose(
        scratchPosition,
        scratchRotation,
        transform.scale,
        transform.pivot,
      );
    } else {
      // Untracked: the node did not move under the simulation, so its live
      // local transform *is* its render pose.
      transform.updateLocalMatrix();
      local = transform.localMatrix;
    }

    if (i === ancestorChain.length - 1) {
      out.copy(local);
    } else {
      out.multiply(local);
    }
  }

  // Do not keep the walked nodes reachable between builds.
  ancestorChain.length = 0;
}

/**
 * Points `item.worldMatrix` at the right matrix for the frame: the node's own
 * resolved one when the list is not interpolating, or a pooled matrix holding
 * its §43 render pose when it is.
 *
 * Shared by every drawable kind, because §43 applies to a particle system's
 * *transform* exactly as it does to a mesh's — only the particles inside it are
 * not interpolated (see `particles.ts`).
 */
function writeWorldMatrix(
  item: MutableRenderItem,
  node: Node,
  pool: ListPool,
  index: number,
  poses: PoseBuffer | null,
  alpha: number,
): void {
  if (poses === null) {
    item.worldMatrix = node.transform.worldMatrix;
    return;
  }
  const matrix = matrixAt(pool, index);
  composeRenderPoseMatrix(node, poses, alpha, matrix);
  item.worldMatrix = matrix;
}

/**
 * Narrows `node` to a drawable renderable, whatever material it carries.
 *
 * `node instanceof Renderable` on its own narrows to `Renderable<any>`, because
 * the class is generic in its material — and an `any` would spread from
 * `node.material` into every read that follows. This guard states the
 * instantiation the render list actually wants: the material is a
 * {@link Material}, and its `kind` says which pipeline draws it.
 */
function isRenderable(node: Node): node is Renderable<Material> {
  return node instanceof Renderable;
}

/**
 * Appends render items for `node`'s subtree to `out`, starting at index
 * `count`, and returns the new count. Depth-first in insertion order (§6).
 *
 * Filtering is §64 stage 2, and it comes in two shapes.
 *
 * **Subtree pruning**, for the two §6 flags:
 *
 * - `visible === false` — §6's rendering flag. Pruning rather than skipping the
 *   single node is the behaviour authors expect (hiding a group hides what is
 *   in it) and is what makes hiding a subtree cost O(1) instead of O(subtree).
 * - `enabled === false` — §6's "participates in simulation and updates" flag.
 *   A disabled subtree is inert in every other system, so it does not draw
 *   either (decision, WP-3.3: the alternative — a disabled node that still
 *   renders — would show a frozen object that no longer responds to anything,
 *   which reads as a bug rather than a feature).
 *
 * Both are checked on every node, including the traversal root: passing a
 * hidden root yields an empty list.
 *
 * **Per-node skipping**, for §46's layer mask (R-38, 2026-08-08): a node whose
 * `layers` shares no bit with `mask` generates no item, and **its children are
 * still visited**. That asymmetry is deliberate and is §46's model — a layer is
 * membership, not state, so it does not inherit (see `@four/scene`'s
 * `layers.ts` for the recorded decision). The consequence here is that layer
 * filtering costs one `&` per node and never changes the traversal, which is
 * what keeps a masked list a permutation-free subsequence of the unmasked one
 * (§33) and what makes `ALL_LAYERS` a true no-op.
 */
function collect(
  node: Node,
  out: RenderItem[],
  pool: ListPool,
  count: number,
  poses: PoseBuffer | null,
  alpha: number,
  mask: LayerMask,
): number {
  if (!node.visible || !node.enabled) {
    return count;
  }

  let next = count;
  // §46's mask, read once and shared by both drawable arms.
  //
  // `?? DEFAULT_LAYER_MASK` for the same reason `material.transparent === true`
  // is written that way below: a **structurally typed** drawable predating the
  // field — a `ParticleDrawable` implemented outside `@four/scene`, a host's own
  // minimal node — reports `undefined`, and that must read as "on the default
  // layer", which is where every real node starts. Reading it as a bare
  // `undefined` would make `undefined & mask` zero and drop the node from every
  // list, silently.
  const nodeLayers = node.layers ?? DEFAULT_LAYER_MASK;
  // `false` skips this node only — the children below are visited either way,
  // because §46 layers do not inherit.
  const onLayer = layersMatch(nodeLayers, mask);
  if (onLayer && isRenderable(node)) {
    // A sprite rebuilds its quad here if the anchor or the size moved (its
    // `geometry` accessor is an override); a plain renderable's geometry is
    // whatever it was handed.
    const geometry = node.geometry;
    const material = node.material;
    const item = itemAt(pool, next, geometry, node.transform.worldMatrix);
    item.kind = pipelineOf(material);
    item.geometry = geometry;
    // The cast is the union's, not the material's: `MutableRenderItem` types
    // this slot as the four known surface materials, and `pipelineOf` has just
    // decided which of them the backend will read it as.
    item.material = material as
      UnlitMaterial | LitMaterial | StandardMaterial | SpriteMaterial;
    // §55's frame (R-29), read structurally and only where it can mean
    // something. Written on **every** renderable, not only framed sprites: the
    // item is pooled, so a slot that carried a framed sprite last frame would
    // otherwise hand a stale sub-rectangle to whatever lands in it next — the
    // same hazard the `material = undefined` line in the particle arm below
    // exists for. `?? null` because a `Renderable` with a sprite material has
    // no such property at all.
    item.frame =
      item.kind === "sprite" ? ((node as FramedDrawable).frame ?? null) : null;
    item.renderLayer = node.renderLayer;
    item.renderOrder = node.renderOrder;
    // §46's mask, snapshotted so a per-view filter needs no node reference.
    item.layers = nodeLayers;
    // §66 key 2, snapshotted from §57's flag. `=== true` rather than a truthy
    // read: a material double built before the flag existed reports
    // `undefined`, which classifies opaque — the behaviour every scene had
    // before the key landed.
    item.transparent = material.transparent === true;
    // §66 key 3's material half (R-10), snapshotted like every other field.
    // `?? ""` for `transparent`'s reason, with a sharper consequence: a
    // **structurally typed** material double predating §57's `id` reports
    // `undefined`, and `undefined < undefined` is `false` in both directions —
    // a comparator reading it would answer "after" for both orders, which is
    // not a total order and makes the sort's result implementation-defined.
    // `""` collapses every such double into one group that keeps scene order,
    // which is what those items had before key 3 existed.
    item.materialId = material.id ?? "";
    // §49's two shadow flags (§69, R-18), snapshotted like every other field.
    // `!== false` rather than a truthy read, for `transparent`'s reason turned
    // around: both default to `true` on a `Renderable`, so a **structurally
    // typed** drawable predating the fields — a host's own minimal node —
    // reports `undefined`, which must read as "casts and receives", the
    // behaviour a `Renderable` authored today has.
    item.castShadow = node.castShadow !== false;
    item.receiveShadow = node.receiveShadow !== false;
    writeWorldMatrix(item, node, pool, next, poses, alpha);
    // The one cast in the module, and the only place the `kind`/`material`
    // correlation is established: both were just written from the same node, so
    // a "sprite" item carries a `SpriteMaterial`, a "lit" item a `LitMaterial`,
    // a "standard" item a `StandardMaterial`, and an "unlit" item an
    // `UnlitMaterial` by construction. TypeScript cannot
    // see that across two assignments to a pooled object — see
    // `MutableRenderItem`.
    out[next] = item as RenderItem;
    next += 1;
  } else if (onLayer && isParticleDrawable(node)) {
    // §36's whole system becomes **one** item (plan P9-3). The repack is the
    // node's own work and happens here, at list-build time, so the uploaded
    // arrays cannot be a step older than the item that points at them — see
    // `particles.ts` for the layout and for why this costs one pass per build.
    node.updateParticleInstances();
    const quad = particleQuadGeometry();
    const item = itemAt(pool, next, quad, node.transform.worldMatrix);
    item.kind = "particles";
    item.geometry = quad;
    // Drop a material this pooled slot may have carried for a `Renderable` in
    // an earlier frame: a particle item has none (§36), and keeping the
    // reference would both mislead a reader and retain a material the scene may
    // have discarded.
    item.material = undefined;
    // Likewise (R-29): a particle system has no texture sub-rectangle, and a
    // pooled slot must not keep one a sprite left in it.
    item.frame = null;
    item.id = node.id;
    item.count = node.particleCount;
    item.instances = node.particleInstances;
    item.renderLayer = node.renderLayer;
    item.renderOrder = node.renderOrder;
    item.layers = nodeLayers;
    // §66 key 2: a particle system has no material to declare `transparent`,
    // and its pipeline blends by construction (§36's colour ramp). It is
    // classified **opaque** so that key 2 leaves particle scenes in exactly the
    // order they drew in before the key existed; giving §36 a render-state
    // carrier of its own is the follow-up (2026-08-06).
    item.transparent = false;
    // §66 key 3's material half (R-10): a particle system has no material, so
    // it has no material identity either. Written rather than left, for the
    // reason `material` and `frame` above are — the pooled slot must not keep a
    // `Renderable`'s id and group this system with a surface.
    item.materialId = "";
    // §69 (R-18): a particle system neither casts nor receives. §36's
    // billboards are camera-facing quads with no surface to project into a
    // shadow map and no lighting term to attenuate, and the pooled slot must
    // not keep a `Renderable`'s flags from an earlier frame — the same hazard
    // the `material` and `frame` resets above exist for. Both are written
    // rather than left, so a particle item's shadow state is a fact of the
    // item, not of what last occupied the slot.
    item.castShadow = false;
    item.receiveShadow = false;
    writeWorldMatrix(item, node, pool, next, poses, alpha);
    out[next] = item as RenderItem;
    next += 1;
  }

  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    next = collect(children[i], out, pool, next, poses, alpha, mask);
  }
  return next;
}

/**
 * §66's comparator, reduced to the three keys this tier has — layer (key 1),
 * opaque before transparent (key 2), explicit render order (key 5). Returns 0
 * for equal keys, which a **stable** sort resolves in favour of generation —
 * i.e. scene-graph — order; `Array.prototype.sort` has been required to be
 * stable since ES2019.
 *
 * Key 2 sits **above** explicit render order, as §66 lists it: within a layer,
 * every opaque draw is issued before any blended one, so a transparent surface
 * composites over the geometry it overlaps instead of racing it in scene order
 * and being depth-rejected. `renderOrder` still orders inside each of the two
 * groups, which is where an author's manual ordering of overlapping
 * transparency belongs.
 *
 * An author who needs a blended draw *underneath* an opaque one — a rare but
 * real case, e.g. a glow behind a mask — reaches for `renderLayer`, which is
 * key 1 and outranks this.
 */
function compareRenderItems(a: RenderItem, b: RenderItem): number {
  if (a.renderLayer !== b.renderLayer) {
    return a.renderLayer - b.renderLayer;
  }
  if (a.transparent !== b.transparent) {
    return a.transparent ? 1 : -1;
  }
  return a.renderOrder - b.renderOrder;
}

/**
 * §66's comparator with **key 3 in place**: layer, opaque before transparent,
 * pipeline and material compatibility, explicit render order — and scene-graph
 * order under all of them, from the stable sort.
 *
 * Key 3 sits above key 5 because §66 lists it there. The consequence is worth
 * stating rather than discovering: under this comparator a scene's own
 * `renderOrder` no longer separates draws that use different materials inside
 * one layer, so an author who needs a specific painting order across materials
 * uses `renderLayer` (key 1), which outranks everything here.
 *
 * The pipeline half compares `kind` — the item's own field, one property load,
 * already there — and the material half compares {@link RenderItem.materialId}.
 * Both are compared as strings, so the *groups* are the ones §66 asks for and
 * their relative order is lexicographic. Nothing here reads a material, a node,
 * or a camera, so the result is a pure function of the list (§33).
 */
function comparePipelineGroupedItems(a: RenderItem, b: RenderItem): number {
  if (a.renderLayer !== b.renderLayer) {
    return a.renderLayer - b.renderLayer;
  }
  if (a.transparent !== b.transparent) {
    return a.transparent ? 1 : -1;
  }
  if (a.kind !== b.kind) {
    return a.kind < b.kind ? -1 : 1;
  }
  if (a.materialId !== b.materialId) {
    return a.materialId < b.materialId ? -1 : 1;
  }
  return a.renderOrder - b.renderOrder;
}

/**
 * Re-sorts an already-built render list with §66's **sort key 3** — pipeline and
 * material compatibility — inserted between key 2 and key 5, in place, and
 * returns it (R-10, 2026-08-09).
 *
 * ```ts
 * buildRenderList(scene, list);       // keys 1, 2, 5 — the order every scene has
 * groupRenderListByPipeline(list);    // keys 1, 2, 3, 5 — draws grouped for §65
 * ```
 *
 * The point of key 3 is that a batcher can only merge draws that are already
 * **adjacent**: grouping is what turns an interleaved scene into runs
 * `@four/render-webgl`'s batcher can collapse (§65, R-9). A scene authored in
 * groups already — a thousand sprites parented to one node, sharing one atlas —
 * needs none of this, which is why the builders do not do it.
 *
 * ## Why this is a second verb and not a parameter (decision, R-10)
 *
 * Because the reordering is **not always safe**, and a default, a flag, or an
 * option would all put the unsafe case one keystroke from an author who never
 * read this paragraph:
 *
 * - §61 fixes the depth comparison at `LEQUAL`, so where two opaque surfaces
 *   sit at the same depth the one drawn *later* wins. All of this engine's 2D
 *   content sits at one depth. Grouping by material therefore **changes the
 *   picture** of a 2D scene, rather than only changing the order of its GL
 *   calls — a §58 fill and its stroke, two overlapping shapes, a sprite over a
 *   background quad.
 * - §66 lists key 3 for content whose overlap is resolved by the depth buffer.
 *   That is true of the 3D half of this engine and false of the 2D half, and no
 *   property of a render item distinguishes them.
 *
 * So the caller who knows their content is depth-resolved (or who is drawing
 * one flat layer of same-depth-independent sprites) asks for the grouping, and
 * everybody else keeps the order they have had since 2026-08-06 — byte for
 * byte, since {@link buildRenderList} is untouched by this function's existence.
 *
 * ## Stability
 *
 * `Array.prototype.sort` is stable (ES2019), so items that compare equal keep
 * their relative order — which, after {@link buildRenderList}, is scene-graph
 * order. Two consequences: sorting a list that is *already* grouped changes
 * nothing at all, and a scene where every item shares one pipeline and one
 * material is left exactly as it was.
 *
 * @param list a list produced by {@link buildRenderList} or
 * {@link buildInterpolatedRenderList}; sorted in place and returned, so the
 * pooled items and the caller's array are the same objects afterwards.
 */
export function groupRenderListByPipeline(list: RenderItem[]): RenderItem[] {
  list.sort(comparePipelineGroupedItems);
  return list;
}

/**
 * Builds the sorted render list for `root`'s subtree into `out`, and returns
 * `out` (§64).
 *
 * ```ts
 * const list: RenderItem[] = [];        // allocated once, reused every frame
 * // per frame:
 * resolveWorldTransforms(scene);        // §7: world matrices before §64
 * buildRenderList(scene, list);
 * ```
 *
 * **World matrices are not resolved here.** Each item's `worldMatrix` is a
 * reference to the node's own matrix, so the list is only as fresh as the last
 * `resolveWorldTransforms` pass — which §7 requires the frame to run before
 * render-item generation anyway, and which the `Application` composition root
 * already runs before its `render` listeners. Keeping resolution out of this
 * function is what lets the two passes stay separately schedulable (§64 lists
 * them as distinct stages) and what makes the item generation free.
 *
 * `out` is truncated to the number of items generated, so a list that shrinks
 * does not leave stale items behind. The items themselves are **pooled per
 * `out` array**: after a rebuild the array contains the same item *objects*,
 * with new contents and possibly in a new order. Two consequences worth
 * stating —
 *
 * 1. an item read after the next build into the same array describes a
 *    different draw; copy anything you need to keep;
 * 2. two independent lists need two `out` arrays (they then have independent
 *    pools), which is the normal way to render several viewports.
 *
 * Allocates nothing in the steady state: no items, no matrices, no math
 * objects. The first few frames grow the pool to the scene's item count and
 * then stop.
 *
 * ## `layerMask` (§46, §64 stage 2; R-38, 2026-08-08)
 *
 * ```ts
 * buildRenderList(scene, list, camera.layers);   // only what this camera sees
 * ```
 *
 * Only nodes sharing a bit with `layerMask` generate items; their children are
 * traversed regardless, because §46 layers do not inherit (see `collect`). The
 * default is `ALL_LAYERS`, which makes the test true for every node whose mask
 * is non-zero — i.e. every node that has not been explicitly removed from all
 * layers — so a caller that omits it gets exactly the list it got before the
 * parameter existed, in exactly the same order.
 *
 * This is the **build-time** half of §46 filtering, for the caller that builds
 * one list per view. The other half is {@link RenderItem}'s `layers` snapshot,
 * which lets one shared list be filtered per view at draw time; the WebGL
 * backend uses that today because it builds one list per frame (R-8).
 *
 * @throws FourError `INVALID_SCENE_GRAPH` **in a development build** when
 * `layerMask` is not an integer in `[0, 0xffffffff]` (§85) — a `NaN` mask would
 * otherwise empty the list with no diagnostic at all. §85 lets a production
 * build drop expensive validation, and this one costs bytes in every shipped
 * bundle for a mistake that is an authoring error by construction, so it is
 * gated: measured at ~115 B gzip on `ui-demo`, deleted entirely by
 * `__FOUR_DEV__: false` (R-38, 2026-08-08). The check itself,
 * `@four/scene`'s `assertLayerMask`, is unconditional there — `@four/scene` is a
 * §33 simulation package and may not branch on the build mode at all.
 */
export function buildRenderList(
  root: Node,
  out: RenderItem[],
  layerMask: LayerMask = ALL_LAYERS,
): RenderItem[] {
  if (DEV) assertLayerMask(layerMask, "buildRenderList(layerMask)");
  const pool = poolFor(out);
  const count = collect(root, out, pool, 0, null, 0, layerMask);
  out.length = count;
  out.sort(compareRenderItems);
  return out;
}

/**
 * Builds the sorted render list for `root`'s subtree into `out` using **§43
 * interpolated render poses** at `alpha`, and returns `out`.
 *
 * ```ts
 * // per rendered frame, between fixed steps:
 * buildInterpolatedRenderList(scene, poses, time.interpolationAlpha, list);
 * ```
 *
 * Identical to {@link buildRenderList} in traversal, filtering, sorting, and
 * pooling; the one difference is each item's `worldMatrix`, which is a pooled
 * matrix holding the world transform composed from interpolated local poses
 * root-first (see `composeRenderPoseMatrix`) instead of a reference to
 * the node's resolved world matrix. This is §43's fix for rendering faster than
 * the simulation steps: at `alpha = 0` every item matches the previous captured
 * pose, at `alpha = 1` the current one, and in between position lerps and
 * rotation slerps. `alpha` is clamped to `[0, 1]` by `PoseBuffer`.
 *
 * Nodes the buffer does not track — static geometry, anything moved directly by
 * the application — contribute their **live local transform** at every alpha, so
 * a mixed scene needs no bookkeeping: track what the simulation moves, leave
 * the rest alone.
 *
 * Because the poses are composed into pooled matrices, this function **never
 * writes scene state** (§43: the render transform must not feed back into the
 * simulation). It also does not need `resolveWorldTransforms` to have run: it
 * derives every matrix itself, at `O(depth)` per item.
 *
 * `layerMask` filters exactly as it does for {@link buildRenderList} — same
 * default, same semantics, same development-only §85 check — and interacts with nothing else
 * here: a filtered node contributes no item, so no render pose is composed for
 * it either.
 */
export function buildInterpolatedRenderList(
  root: Node,
  poses: PoseBuffer,
  alpha: number,
  out: RenderItem[],
  layerMask: LayerMask = ALL_LAYERS,
): RenderItem[] {
  if (DEV) assertLayerMask(layerMask, "buildInterpolatedRenderList(layerMask)");
  const pool = poolFor(out);
  const count = collect(root, out, pool, 0, poses, alpha, layerMask);
  out.length = count;
  out.sort(compareRenderItems);
  return out;
}
