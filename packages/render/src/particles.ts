/**
 * The particle drawing contract (§36, §49, plan P9-3) — one batched render item
 * per particle system.
 *
 * §112 asks for ≥100 000 particles "simulated and rendered at interactive
 * rates", and §64 stage 6 says the way to get there is batching: one draw for
 * the whole system, not one per particle. This module is the backend-independent
 * half of that — the data a batched particle draw needs, written down once so
 * `@four/particles` can produce it and every backend can consume it.
 *
 * ## Why this is a *structural* contract and not a base class
 *
 * The obvious shape is `class ParticleRenderable extends Renderable` in
 * `@four/particles` (§49 lists `ParticleSystem` in the renderable family). It
 * cannot be written, and the reason is a hard constraint rather than a
 * preference: the frozen §3.1 dependency matrix gives `particles` exactly
 * `core`, `math`, `scene`, and gives `render` exactly `core`, `math`, `scene`,
 * `geometry`, `materials`. Neither package may import the other — they are in
 * the same dispatch wave — so
 *
 * - `@four/particles` cannot `extends Renderable`, cannot name `RenderItem`,
 *   and cannot construct a `BufferGeometry` or a material; and
 * - `@four/render` cannot name `ParticleEmitter` or `ParticlePool`.
 *
 * What is left is a **duck-typed contract**: `@four/render` declares
 * {@link ParticleDrawable}, `buildRenderList` recognises any node carrying the
 * {@link ParticleDrawable.isParticleDrawable} brand, and `@four/particles`
 * implements the shape without importing it. `@four/particles`'s
 * `ParticleRenderable` re-declares the members with a comment pointing here.
 *
 * The honest cost, stated plainly: **nothing type-checks the two declarations
 * against each other.** A change to this interface will not fail
 * `@four/particles`'s build; it will fail its *tests*, which assert the shape
 * member by member, and the backend's, which assert the items. Both suites pin
 * the same field names and the same interleaved layout. If a later revision of
 * the matrix lets particles depend on render, `ParticleRenderable` re-parents
 * onto `Renderable`, this interface becomes the type it `implements`, and
 * nothing else changes (decision, WP-9.3 — reported to the orchestrator).
 *
 * ## The upload layout (decision, WP-9.3)
 *
 * A particle's *drawn* state is its world-space centre, its **current** size and
 * its **current** colour — the §36 over-lifetime ramps already evaluated. The
 * pool stores ramp *endpoints* plus age (see `@four/particles`'s `pool.ts`), so
 * something has to evaluate `start + (end − start) · normalizedAge` before the
 * GPU sees it. That happens **once per frame on the CPU, into an array the node
 * owns and reuses**, because:
 *
 * - the alternative — uploading endpoints plus age and lerping in the vertex
 *   stage — costs 12 floats per particle instead of 8 and puts §36's ramp
 *   semantics into every backend's shader, where they would drift;
 * - the alternative — one array per channel — costs three `bufferSubData` calls
 *   and three attribute bindings instead of one.
 *
 * So the item carries **one interleaved `Float32Array`**, stride
 * {@link PARTICLE_INSTANCE_FLOATS} = 8 floats (32 bytes):
 *
 * | Offset (floats) | Components | Meaning                                   |
 * | --------------: | ---------: | ----------------------------------------- |
 * | 0               | 3          | centre `x, y, z`, in the node's local space |
 * | 3               | 1          | current size, in world units (diameter)   |
 * | 4               | 4          | current colour, **straight** RGBA         |
 *
 * The first `count × 8` floats are live; everything after them is stale and must
 * not be uploaded. The array itself is capacity-sized and **allocated once**, so
 * a frame costs one `bufferSubData` of `count × 32` bytes and no allocation at
 * all (plan D7).
 *
 * Positions are in the emitting node's **local** space and the item's
 * `worldMatrix` places them, exactly as for every other render item — which is
 * what lets a particle system be parented, moved, and drawn through the §43
 * interpolated pose path without the simulation knowing.
 *
 * ## What a backend owes this item
 *
 * - **One draw call.** The reference implementation
 *   (`@four/render-webgl`) draws `count` instances of {@link particleQuadGeometry}
 *   with `drawArraysInstanced`.
 * - **Alpha blending.** Particles are transparent by nature — the §36 colour
 *   ramp's whole point is fading out — so the particle pass runs with blending
 *   enabled. The engine's stated policy is **straight (non-premultiplied)
 *   alpha** (§66), the same as sprites and `UnlitMaterial.color`, so the
 *   fragment colour is used as authored and the blend is
 *   `SRC_ALPHA`/`ONE_MINUS_SRC_ALPHA`. Additive particles — the other look §36
 *   implies — need per-material blend state from §57 and are **staged**.
 * - **Screen-aligned quads.** The instance mesh is a unit quad centred on the
 *   origin; a backend billboards it. Nothing about that is in the item, because
 *   it is the backend's projection to do.
 *
 * ## No per-particle interpolation (§43)
 *
 * §43 interpolates *node poses* between fixed steps, from the previous/current
 * pose pair a `PoseBuffer` captures. Particles have no such pair: the pool holds
 * one state, the state the last fixed step left. So a particle system's
 * **transform** interpolates like any other node's, and its **particles** are
 * drawn at their last simulated positions — visual-frame data, one step behind
 * at most, never extrapolated. Capturing a previous pool to interpolate against
 * would double the memory of the §112 100 000-particle budget to hide at most
 * one step of motion on objects that are a few pixels across (decision,
 * WP-9.3).
 */

import { BufferGeometry } from "@four/geometry";

/**
 * Floats per particle in {@link ParticleDrawable.particleInstances} — the
 * interleaved stride. See the module header for the layout table.
 */
export const PARTICLE_INSTANCE_FLOATS = 8;

/** Offset, in floats, of a particle's centre (`vec3`) within its instance. */
export const PARTICLE_POSITION_OFFSET = 0;

/** Offset, in floats, of a particle's current size (`float`). */
export const PARTICLE_SIZE_OFFSET = 3;

/** Offset, in floats, of a particle's current straight-alpha RGBA (`vec4`). */
export const PARTICLE_COLOR_OFFSET = 4;

/**
 * Floats per trail ribbon vertex — position `xyz` plus straight-alpha `rgba`.
 *
 * Duplicated in `@four/particles`' `trail.ts` for the same reason as
 * {@link PARTICLE_INSTANCE_FLOATS}.
 */
export const TRAIL_VERTEX_FLOATS = 7;

/** Offset, in floats, of a trail vertex centre within its stride. */
export const TRAIL_POSITION_OFFSET = 0;

/** Offset, in floats, of a trail vertex straight-alpha RGBA. */
export const TRAIL_COLOR_OFFSET = 3;

/**
 * A scene node that draws a particle system (§36, §49's `ParticleSystem`).
 *
 * Implemented **structurally** — see the module header for why there is no base
 * class. A node satisfying this shape is picked up by `buildRenderList` and
 * turned into exactly one `ParticleRenderItem`.
 *
 * ```ts
 * // in @four/particles, with no import from @four/render:
 * class ParticleRenderable extends Node {
 *   readonly isParticleDrawable = true;
 *   renderLayer = 0;
 *   renderOrder = 0;
 *   get particleCount(): number { … }
 *   get particleInstances(): Float32Array { … }
 *   updateParticleInstances(): void { … }
 * }
 * ```
 */
export interface ParticleDrawable {
  /**
   * The brand `buildRenderList` recognises. A literal `true`, not a method, so
   * the check is one property load per node per frame.
   */
  readonly isParticleDrawable: true;

  /**
   * Stable identity of the emitting node (§6 `Node.id`), used by a backend as
   * the cache key for this system's GPU buffers — the role
   * `BufferGeometry.id` plays for geometry (§53).
   */
  readonly id: string;

  /** Symbolic drawing group (§46, §66 sort key 1), as on `Renderable`. */
  renderLayer: number;

  /** Explicit ordering within a layer (§66 sort key 5), as on `Renderable`. */
  renderOrder: number;

  /**
   * Live particle count for the frame — valid only after
   * {@link ParticleDrawable.updateParticleInstances}.
   */
  readonly particleCount: number;

  /**
   * The interleaved upload array described in the module header. Owned by the
   * node, reused every frame, and valid for `particleCount × 8` floats.
   *
   * Read it, upload it, do not mutate it and do not retain it past the frame:
   * the next `updateParticleInstances` rewrites it in place.
   */
  readonly particleInstances: Float32Array;

  /**
   * Refreshes {@link ParticleDrawable.particleCount} and
   * {@link ParticleDrawable.particleInstances} from the current simulation
   * state.
   *
   * Called by `buildRenderList` once per node per build — so a two-viewport
   * frame that builds two lists repacks twice, which is the price of not
   * caching state that a mid-frame `step()` could invalidate. Must not
   * allocate (plan D7) and must not touch the scene (§42).
   */
  updateParticleInstances(): void;

  /**
   * Whether this node produces an optional trail ribbon mesh. When `true`,
   * {@link ParticleDrawable.trailVertexCount} and
   * {@link ParticleDrawable.trailVertices} are valid after
   * {@link ParticleDrawable.updateParticleInstances}.
   */
  readonly hasTrail?: boolean;

  /**
   * Trail ribbon vertex count for the frame. `0` when {@link hasTrail} is
   * false or no segment has ≥ 2 samples yet.
   */
  readonly trailVertexCount?: number;

  /**
   * Interleaved trail vertices (`TRAIL_VERTEX_FLOATS` stride). Valid for
   * `trailVertexCount × TRAIL_VERTEX_FLOATS` floats after repack.
   */
  readonly trailVertices?: Float32Array;
}

/**
 * Narrows any value to a {@link ParticleDrawable}.
 *
 * Both the brand and the method are checked: the brand is the contract, and the
 * method check is what turns a node that claims the brand without implementing
 * the shape — the failure mode a structural contract has and a base class does
 * not — into a node that simply does not draw, rather than a `TypeError` inside
 * the render loop.
 */
export function isParticleDrawable(value: unknown): value is ParticleDrawable {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ParticleDrawable>;
  return (
    candidate.isParticleDrawable === true &&
    typeof candidate.updateParticleInstances === "function"
  );
}

/**
 * The per-instance mesh, lazily created and shared by every particle item: a
 * **unit quad centred on the origin**, six vertices, no indices.
 *
 * ```text
 * (-0.5, +0.5) ── (+0.5, +0.5)
 *      │       ╲        │
 * (-0.5, -0.5) ── (+0.5, -0.5)
 * ```
 *
 * Its positions are **corner offsets, not object-space positions**: a backend
 * multiplies `corner.xy` by the per-instance size and adds it to the projected
 * centre, which is what makes the quads screen-aligned. Counter-clockwise seen
 * from +Z, matching `planeGeometry` and §7a.
 *
 * Non-indexed on purpose (decision, WP-9.3): six vertices of a shared quad cost
 * nothing next to the instance stream, and `drawArraysInstanced` avoids putting
 * an element buffer into every particle vertex array.
 *
 * Created on first use rather than at module load, so importing `@four/render`
 * does not consume a geometry id or allocate a buffer for an application with no
 * particles. Never disposed: it is process-wide shared state, and disposing it
 * would empty the quad under every particle system at once (§83 — the creator
 * owns disposal, and the creator here is the module).
 */
export function particleQuadGeometry(): BufferGeometry {
  quad ??= new BufferGeometry({
    // prettier-ignore
    positions: new Float32Array([
      -0.5, -0.5, 0,
       0.5, -0.5, 0,
       0.5,  0.5, 0,
      -0.5, -0.5, 0,
       0.5,  0.5, 0,
      -0.5,  0.5, 0,
    ]),
    mode: "triangles",
  });
  return quad;
}

/** Backing store of {@link particleQuadGeometry}. */
let quad: BufferGeometry | undefined;
