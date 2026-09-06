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
 * made its material nameable in this class's slot. Two of §49's family live
 * outside this package, for reasons that are recorded where they bite — and in
 * both cases the reason is the frozen §3.1 dependency matrix, not a design
 * preference:
 *
 * - **`ParticleSystem`** (§36) is not in this package at all. It lives in
 *   `@four/particles`, which the matrix forbids from
 *   importing `@four/render`, so it is recognised by `buildRenderList` through
 *   a **structural contract** instead of by inheritance — see `particles.ts`.
 * - **`Text`** (§56) lives in the umbrella package `four` (R-28, 2026-08-13),
 *   because it needs `@four/text`'s layout and this package may not import it.
 *   It really does `extend Renderable`, though — `four` sits *above* this
 *   package rather than beside it — so it needs no structural contract and no
 *   special case anywhere: it is an unlit, textured drawable whose geometry is
 *   one buffer of glyph quads.
 *
 * It is treated as a first-class drawable by the render list, which tags every
 * item with a `RenderItemKind` discriminant; it costs the backend no
 * `instanceof`.
 *
 * `castShadow` and `receiveShadow` joined on 2026-08-09 with §69's directional
 * shadow-map tier (R-18) — see the two properties for what each drives and
 * what still ignores them.
 *
 * `frustumCulled` joined on 2026-08-09 with §87's per-view culling tier (R-8).
 *
 * Deferred with its feature, not silently dropped: `depthMode` (§49's
 * four-state field — §57's `depthTest`/`depthWrite` now carry the two states
 * the backend can honour, and the rest needs the §61 depth-state contract).
 * `material` is a single material rather than §49's `Material | Material[]`:
 * multi-material submeshes need §54's submesh ranges, which no geometry
 * carries.
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

import type { ScissorRect } from "./scissor.js";

/** Optional construction arguments of {@link Renderable}. */
export interface RenderableOptions {
  /** Initial {@link Renderable.renderLayer}; defaults to 0. */
  renderLayer?: number;
  /** Initial {@link Renderable.renderOrder}; defaults to 0. */
  renderOrder?: number;
  /** Initial {@link Renderable.castShadow}; defaults to `true` (§69). */
  castShadow?: boolean;
  /** Initial {@link Renderable.receiveShadow}; defaults to `true` (§69). */
  receiveShadow?: boolean;
  /** Initial {@link Renderable.frustumCulled}; defaults to `true` (§87). */
  frustumCulled?: boolean;
  /**
   * Initial `Node.clip`; defaults to `false` (§67).
   *
   * Here rather than on a `Node` options record because a clip is only
   * meaningful on a node that draws — the mask is the node's own geometry —
   * and this is the options record every drawable funnels through. It is also
   * what gives the §79 readers one spelling for the field beside the three
   * §49 flags above.
   */
  clip?: boolean;
  /**
   * Initial {@link Renderable.scissor}; defaults to `null` (§67).
   *
   * A per-draw axis-aligned rectangle in drawing-buffer pixels. `null` (the
   * default) leaves the view scissor alone, so existing scenes stay
   * transcript-identical. See `scissor.ts`.
   */
  scissor?: ScissorRect | null;
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
   * Whether this renderable is drawn into a shadow map (§49, §69). **Defaults
   * to `true`.**
   *
   * ```ts
   * floor.castShadow = false;   // a ground plane occludes nothing useful
   * ```
   *
   * `true` by default, unlike the light's own `castShadow`, and the asymmetry
   * is the point: switching a *light* on is a decision to pay for a whole extra
   * pass, while switching a *node* off is a per-object exclusion. With the
   * light's flag at `false` — every scene that predates §69 — these two never
   * run at all, so the default costs nothing until an author asks for shadows,
   * and when they do the answer is "everything casts", which is what an author
   * who just enabled a sun expects to see.
   *
   * Honoured by the shadow pass for the three surface pipelines (unlit, lit,
   * standard). A §55 `Sprite` never casts whatever this says: a depth-only pass
   * writes geometry, not alpha, so a textured quad would cast its *rectangle* —
   * §69's transparent shadow masks are what fix that, and they are staged (see
   * `@four/scene`'s `DirectionalLightShadow`).
   */
  castShadow = true;

  /**
   * Whether this renderable is darkened where a shadow map says it is occluded
   * (§49, §69). **Defaults to `true`**, for {@link Renderable.castShadow}'s
   * reason.
   *
   * Honoured by the two *shaded* pipelines — §57's `LitMaterial` and §59's
   * `StandardMaterial` — because a shadow attenuates a lighting term and an
   * unlit surface has none to attenuate. Setting it on an unlit or sprite
   * renderable is therefore accepted and inert, which is the honest reading of
   * §49 putting the flag on the family root: it is a property of the node, and
   * whether a given pipeline can act on it is the pipeline's business.
   */
  receiveShadow = true;

  /**
   * Whether this renderable may be dropped from a view whose frustum its world
   * bounds lie entirely outside (§49, §87). **Defaults to `true`.**
   *
   * ```ts
   * skybox.frustumCulled = false;   // its bounds do not describe where it draws
   * ```
   *
   * `true` by default because culling is an optimisation that is invisible when
   * it is right: a view drops draws it could not have shown, and every pixel is
   * where it was. The flag exists for the cases where the *bounds* are the
   * thing that is wrong — geometry a vertex shader displaces, a skybox drawn at
   * the origin but meant to fill the view, a node whose geometry is a
   * placeholder for something drawn elsewhere. Setting it `false` says "trust
   * me, draw this", and the engine does, in every view.
   *
   * The bound tested is a **world-space sphere** derived from §53's cached
   * local box (see `bounds.ts`), so it is conservative: an item is dropped only
   * when that sphere lies wholly beyond one of the six planes. A geometry that
   * cannot state its bounds — an empty one, or a structurally-typed geometry
   * with no `computeBounds` — is drawn whatever this says.
   *
   * Honoured by `view-list.ts`'s `buildViewRenderList`, which is what the
   * WebGL 2 backend derives each view's draws with. §36's particle systems are
   * exempt whatever their node says, and the reason is on
   * `RenderItem.frustumCulled`.
   */
  frustumCulled = true;

  /**
   * §67 rectangular scissor — a per-draw axis-aligned rectangle in
   * drawing-buffer pixels, or `null` to inherit the view scissor only.
   *
   * Default-off so a scene that never names one issues the same backend
   * scissor calls it issued before the field existed. The backend intersects
   * this rectangle with `view.rect` and restores the view rect after the
   * draw. Stencil `clip = true` is a different mechanism and composes: a
   * node can punch a path mask *and* restrict its pixels to this rectangle.
   */
  scissor: ScissorRect | null = null;

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
    this.castShadow = options.castShadow ?? true;
    this.receiveShadow = options.receiveShadow ?? true;
    this.frustumCulled = options.frustumCulled ?? true;
    this.clip = options.clip ?? false;
    this.scissor = options.scissor ?? null;
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
