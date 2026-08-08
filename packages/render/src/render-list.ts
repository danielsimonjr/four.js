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
 * material compatibility, depth, explicit render order. This packet sorts by
 * **render layer, then opaque before transparent, then explicit render order,
 * then scene-graph order** — keys 1, 2, and 5 — and defers keys 3 and 4:
 *
 * - material and pipeline sorting needs the backend's notion of a pipeline
 *   (WP-3.5) — sorting by `material.id` here would encode an ordering the
 *   backend then has to fight — and, unlike key 2, it **reorders scenes that
 *   never asked for it**: every existing scene would have its draws permuted by
 *   material identity, which is exactly what a pixel-golden gate refuses.
 *   Deferred 2026-08-06 with that reason, and it wants `pipelineKey` on
 *   `RenderItemBase` (R-10, R-9);
 * - depth sorting needs a camera (WP-3.1/3.2) to measure distance along, and a
 *   per-view render list to measure it in (§87 culling, R-8).
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

import type { BufferGeometry } from "@four/geometry";
import { Matrix4, Quaternion, Vector3 } from "@four/math";
import type {
  LitMaterial,
  Material,
  SpriteMaterial,
  StandardMaterial,
  UnlitMaterial,
} from "@four/materials";
import type { Node, PoseBuffer } from "@four/scene";

import { isParticleDrawable, particleQuadGeometry } from "./particles.js";
import { Renderable } from "./renderable.js";

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
   * §66 sort key 2, read off the item's material (§57's `transparent`) at
   * generation time: `false` for an opaque draw, `true` for a blended one.
   *
   * Snapshotted onto the item rather than reached through `material.transparent`
   * inside the comparator, for the reason §64 gives for compact render items —
   * a comparator runs O(n log n) times and must not chase a reference per
   * call — and because a particle item has no material to ask.
   */
  transparent: boolean;
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
 * item, `count` is `0` and `instances` empty on the other two. The exported
 * union is what hides them, which is why a caller never sees a sprite item
 * offering a particle count.
 *
 * Not exported: outside this module an item is always a {@link RenderItem}, and
 * the correlation between `kind` and the arm-specific fields is an invariant the
 * builders maintain rather than a contract callers may break.
 */
interface MutableRenderItem extends RenderItemBase {
  kind: RenderItemKind;
  material?: UnlitMaterial | LitMaterial | StandardMaterial | SpriteMaterial;
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
      renderOrder: 0,
      renderLayer: 0,
      transparent: false,
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
 * Filtering is §64 stage 2 and prunes **whole subtrees**:
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
 */
function collect(
  node: Node,
  out: RenderItem[],
  pool: ListPool,
  count: number,
  poses: PoseBuffer | null,
  alpha: number,
): number {
  if (!node.visible || !node.enabled) {
    return count;
  }

  let next = count;
  if (isRenderable(node)) {
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
    item.renderLayer = node.renderLayer;
    item.renderOrder = node.renderOrder;
    // §66 key 2, snapshotted from §57's flag. `=== true` rather than a truthy
    // read: a material double built before the flag existed reports
    // `undefined`, which classifies opaque — the behaviour every scene had
    // before the key landed.
    item.transparent = material.transparent === true;
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
  } else if (isParticleDrawable(node)) {
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
    item.id = node.id;
    item.count = node.particleCount;
    item.instances = node.particleInstances;
    item.renderLayer = node.renderLayer;
    item.renderOrder = node.renderOrder;
    // §66 key 2: a particle system has no material to declare `transparent`,
    // and its pipeline blends by construction (§36's colour ramp). It is
    // classified **opaque** so that key 2 leaves particle scenes in exactly the
    // order they drew in before the key existed; giving §36 a render-state
    // carrier of its own is the follow-up (2026-08-06).
    item.transparent = false;
    writeWorldMatrix(item, node, pool, next, poses, alpha);
    out[next] = item as RenderItem;
    next += 1;
  }

  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    next = collect(children[i], out, pool, next, poses, alpha);
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
 */
export function buildRenderList(root: Node, out: RenderItem[]): RenderItem[] {
  const pool = poolFor(out);
  const count = collect(root, out, pool, 0, null, 0);
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
 */
export function buildInterpolatedRenderList(
  root: Node,
  poses: PoseBuffer,
  alpha: number,
  out: RenderItem[],
): RenderItem[] {
  const pool = poolFor(out);
  const count = collect(root, out, pool, 0, poses, alpha);
  out.length = count;
  out.sort(compareRenderItems);
  return out;
}
