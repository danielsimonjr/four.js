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
 * The `material` field reached §49's shape on 2026-08-06, when §57's abstract
 * `Material` base landed: see {@link Renderable.material} for what widened and
 * what deliberately did not.
 *
 * ## The family member that is *not* a subclass
 *
 * `Sprite` (§55) joined the family on 2026-08-06, when §57's `Material` base
 * made its material nameable in this class's slot. One of §49's family is still
 * outside it, for a reason that is recorded where it bites:
 *
 * - **`ParticleSystem`** (§36) is not in this package at all. It lives in
 *   `@four/particles`, which the frozen §3.1 dependency matrix forbids from
 *   importing `@four/render`, so it is recognised by `buildRenderList` through
 *   a **structural contract** instead of by inheritance — see `particles.ts`.
 *
 * It is treated as a first-class drawable by the render list, which tags every
 * item with a `RenderItemKind` discriminant; it costs the backend no
 * `instanceof`.
 *
 * Deferred with their features, not silently dropped: `depthMode` (§49's
 * four-state field — §57's `depthTest`/`depthWrite` now carry the two states
 * the backend can honour, and the rest needs the §61 depth-state contract),
 * `castShadow`/`receiveShadow` (§69), and `frustumCulled` (§87 culling — the
 * render list does no culling yet, so the flag would have nothing to switch
 * off). `material` is a single material rather than §49's `Material |
 * Material[]`: multi-material submeshes need §54's submesh ranges, which no
 * geometry carries.
 *
 * ## Ownership
 *
 * A renderable **points at** its geometry and material; it does not own them
 * (§83). Both are routinely shared by hundreds of nodes, so `Renderable` has no
 * `dispose()` that would tear a shared resource out from under its siblings —
 * whoever created the geometry or material disposes it.
 */

import type { BufferGeometry } from "@four/geometry";
import type { LitMaterial, Material, UnlitMaterial } from "@four/materials";
import { Node } from "@four/scene";

/** Optional construction arguments of {@link Renderable}. */
export interface RenderableOptions {
  /** Initial {@link Renderable.renderLayer}; defaults to 0. */
  renderLayer?: number;
  /** Initial {@link Renderable.renderOrder}; defaults to 0. */
  renderOrder?: number;
}

/**
 * The materials a plain {@link Renderable} shades a surface with (§57) — the
 * default of its `M` type parameter, and the reason a `Renderable` variable
 * still offers `setColor` after the base landed.
 *
 * `SpriteMaterial` is deliberately **not** in it: a sprite carries a texture,
 * derives its own quad, and is a `Renderable<SpriteMaterial>` (§55's `Sprite`),
 * so admitting it here would take `color` off every ordinary renderable's
 * material for a case that has its own class.
 */
export type SurfaceMaterial = UnlitMaterial | LitMaterial;

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
export class Renderable<M extends Material = SurfaceMaterial> extends Node {
  #geometry: BufferGeometry;

  /**
   * Surface appearance (§57). Shared, not owned — see the module header.
   *
   * Typed by the class's `M` parameter, which defaults to
   * {@link SurfaceMaterial} — so a plain `Renderable` still carries exactly the
   * `UnlitMaterial | LitMaterial` it carried before §57's base landed, and
   * `renderable.material.setColor(…)` still compiles. A subclass that draws
   * through a different pipeline **narrows** the parameter instead of
   * re-declaring the field: §55's `Sprite` is a `Renderable<SpriteMaterial>`,
   * and a family member a consumer writes is a `Renderable<TheirMaterial>`.
   *
   * The material's own `kind` discriminant — not an `instanceof`, and not the
   * node's class — decides which pipeline draws it (see `render-list.ts`).
   * That is what makes the parameter safe to widen: the render list learns the
   * pipeline from the material, so a new material type does not need a new
   * node type.
   */
  material: M;

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
    material: M,
    options: RenderableOptions = {},
  ) {
    super();
    this.#geometry = geometry;
    this.material = material;
    this.renderLayer = options.renderLayer ?? 0;
    this.renderOrder = options.renderOrder ?? 0;
  }

  /**
   * Vertex data to draw (§53). Shared, not owned — see the module header.
   *
   * An accessor pair rather than a plain field, since 2026-08-06: §55's
   * `Sprite` **derives** its geometry from its anchor and size and rebuilds it
   * lazily on read, and a subclass can only override a property the base
   * declares as an accessor (a base *field* is defined on the instance and
   * would shadow the override). Reading and assigning behave exactly as the
   * field did.
   */
  get geometry(): BufferGeometry {
    return this.#geometry;
  }

  set geometry(value: BufferGeometry) {
    this.#geometry = value;
  }
}
