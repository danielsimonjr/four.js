/**
 * `Renderable` (§49) — the node that draws something.
 *
 * §49 puts one abstract class at the root of the drawing hierarchy
 * (`Shape2D`, `Sprite`, `Text`, `Mesh`, `Line3D`, `PointCloud`,
 * `ParticleSystem`, `CustomRenderable`) carrying
 *
 * ```ts
 * material: Material | Material[];
 * renderLayer: number;
 * renderOrder: number;
 * depthMode: "normal" | "always-front" | "always-back" | "disabled";
 * castShadow: boolean;
 * receiveShadow: boolean;
 * frustumCulled: boolean;
 * ```
 *
 * This packet implements the MVP-tier subset — geometry, material,
 * `renderLayer`, `renderOrder` — and makes two deliberate departures:
 *
 * - **It is concrete, not abstract.** §49's class is abstract because it is a
 *   family root, and the family (Mesh, Sprite, Text, the §50 shapes) arrives in
 *   Phase 3a and later. Until then a concrete `Renderable` is the only way to
 *   put geometry on screen at all, and `new Renderable(geometry, material)` is
 *   exactly what the MVP example needs. The subclasses will extend it
 *   unchanged.
 * - **It owns a `geometry` field.** §49 puts geometry on the subclasses
 *   (`Mesh.geometry: Geometry3D`, §54) because different renderables carry
 *   different geometry types. With one concrete class and one geometry type
 *   (`BufferGeometry`, §53) the field belongs here; when `Mesh` and `Shape2D`
 *   land they narrow it rather than introduce it.
 *
 * Deferred with their features, not silently dropped: `depthMode` (needs the
 * §61 depth-state contract), `castShadow`/`receiveShadow` (§69), and
 * `frustumCulled` (§87 culling — the render list does no culling yet, so the
 * flag would have nothing to switch off). `material` stays a single
 * `UnlitMaterial` until §57's `Material` base and multi-material submeshes
 * exist.
 *
 * ## Ownership
 *
 * A renderable **points at** its geometry and material; it does not own them
 * (§83). Both are routinely shared by hundreds of nodes, so `Renderable` has no
 * `dispose()` that would tear a shared resource out from under its siblings —
 * whoever created the geometry or material disposes it.
 */

import type { BufferGeometry } from "@four/geometry";
import type { UnlitMaterial } from "@four/materials";
import { Node } from "@four/scene";

/** Optional construction arguments of {@link Renderable}. */
export interface RenderableOptions {
  /** Initial {@link Renderable.renderLayer}; defaults to 0. */
  renderLayer?: number;
  /** Initial {@link Renderable.renderOrder}; defaults to 0. */
  renderOrder?: number;
}

/**
 * A node that contributes a draw to the render list (§49).
 *
 * ```ts
 * const square = new Renderable(planeGeometry(), new UnlitMaterial());
 * square.transform.position.set(2, 0, 0);
 * scene.add(square);
 * ```
 *
 * Visibility follows §6: `visible = false` hides this node **and its whole
 * subtree** from the render list, and `enabled = false` removes the subtree
 * from simulation and rendering alike — see `buildRenderList`.
 */
export class Renderable extends Node {
  /** Vertex data to draw (§53). Shared, not owned — see the module header. */
  geometry: BufferGeometry;

  /** Surface appearance (§57). Shared, not owned — see the module header. */
  material: UnlitMaterial;

  /**
   * Symbolic drawing group (§46, §66 sort key 1). The primary sort key of the
   * render list: everything in layer 0 draws before anything in layer 1.
   *
   * A plain number for now. §46 requires human-readable layer *names* that
   * "compile to efficient masks internally", and that mapping — shared with
   * camera visibility, physics interaction groups, and picking — is a packet of
   * its own; this field is the numeric slot it will resolve to.
   */
  renderLayer = 0;

  /**
   * Explicit ordering within a layer (§66 sort key 5). Lower draws first; ties
   * keep scene-graph order (see `buildRenderList`).
   */
  renderOrder = 0;

  /**
   * Builds a renderable for `geometry` and `material`. Both are required: a
   * renderable without either draws nothing, and defaulting them would hide the
   * mistake behind an invisible node rather than a type error.
   */
  constructor(
    geometry: BufferGeometry,
    material: UnlitMaterial,
    options: RenderableOptions = {},
  ) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.renderLayer = options.renderLayer ?? 0;
    this.renderOrder = options.renderOrder ?? 0;
  }
}
