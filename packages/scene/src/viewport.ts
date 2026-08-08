/**
 * Viewports (§48).
 *
 * "A viewport maps one camera to a rectangular region and optional render
 * target." One renderer pass takes a list of viewports, so split-screen,
 * minimaps, picture-in-picture, CAD panes, and editor panels are all the same
 * mechanism — a list with more than one entry (§48).
 *
 * This packet ships the subset the MVP renderer (§120) can honour: identity,
 * camera, rectangle, and clear colour. The deferred fields are named in
 * {@link Viewport}'s documentation rather than declared as optional properties
 * nothing reads, so that a renderer's support for a field and the field's
 * existence stay the same fact.
 */

import type { Camera } from "./camera.js";
import type { LayerMask } from "./layers.js";

/**
 * A camera rendered into a rectangular region of a surface (§48).
 *
 * ## The rectangle
 *
 * `x`, `y`, `width`, `height` are pixels by default, or fractions of the target
 * surface when `normalized` is true — so a full-screen viewport is
 * `{ x: 0, y: 0, width: 1, height: 1, normalized: true }` and stays correct
 * across resizes, while a fixed 256 px minimap is not normalized. The origin is
 * the **bottom-left** corner of the target and +Y is up, matching the world
 * convention (§7a) and the clip-space convention of the D8 projections; a
 * backend whose native scissor rectangle is top-left based flips it on the way
 * in.
 *
 * ## Deferred §48 fields
 *
 * §48's full interface additionally declares `clearDepth`, `layerMask`,
 * `renderTarget`, and `postProcessing`. `layerMask` landed with §46's layer
 * registry (R-38, 2026-08-08) and is documented below; of the rest:
 *
 * - `renderTarget?: RenderTarget` — off-screen targets are §63/§65 work
 *   (offscreen textures, mirrors, portals, 3D previews inside 2D UI); the MVP
 *   renders to the canvas only.
 * - `postProcessing?: RenderPipeline` — the §63 render graph.
 * - `clearDepth?: number` — meaningful once depth clearing is configurable per
 *   view; the MVP clears depth to 1 for every view.
 *
 * They are added to this interface, with the same names, by the packets that
 * implement them. Adding an optional property to an interface is
 * backwards-compatible, so nothing here has to be re-shaped for that.
 */
export interface Viewport {
  /**
   * Stable identity, unique within one render call (§48). Renderers key
   * per-view state by it and diagnostics name views by it; it is not a scene
   * node id.
   */
  id: string;

  /** The camera whose view of the scene fills this rectangle (§48). */
  camera: Camera;

  /** Left edge, in pixels — or a fraction of the surface width if `normalized`. */
  x: number;

  /** Bottom edge, in pixels — or a fraction of the surface height if `normalized`. */
  y: number;

  /** Width, in pixels — or a fraction of the surface width if `normalized`. */
  width: number;

  /** Height, in pixels — or a fraction of the surface height if `normalized`. */
  height: number;

  /**
   * When true, the rectangle is expressed as fractions of the target surface in
   * `[0, 1]` instead of pixels (§48). Absent means false — pixels.
   */
  normalized?: boolean;

  /**
   * Colour this viewport's rectangle is cleared to before drawing, as RGBA
   * components in `[0, 1]` with straight (non-premultiplied) alpha. Absent
   * means the renderer does not clear colour for this view — which is how a
   * picture-in-picture or minimap view draws over what the main view already
   * rendered.
   *
   * §48 types this as `Color`, the engine-wide colour type that also accepts
   * CSS-style strings. That type lands with `@four/materials` (§59, §60a), and
   * `@four/scene` may not depend on `@four/materials` (plan §3.1 pins the
   * dependency matrix and forbids adding edges), so the field is a numeric RGBA
   * tuple here (decision, WP-3.2). Components are **linear-light**, matching the
   * §60a pipeline: a CSS string denotes sRGB and would need decoding, which is
   * exactly the conversion `Color` will own. The tuple is a valid `Color` input
   * when that type arrives, so widening the field then is source-compatible.
   */
  clearColor?: [number, number, number, number];

  /**
   * Which §46 layers this view draws, narrowing (or replacing) its camera's own
   * `layers` (§48, R-38, 2026-08-08).
   *
   * ```ts
   * const world = { ...createFullscreenViewport(camera), layerMask: layerMask("default") };
   * const ui = { ...createFullscreenViewport(camera, "ui"), layerMask: layerMask("ui") };
   * renderer.render(scene, [world, ui]);   // one camera, two passes, no overdraw
   * ```
   *
   * **Absent means the camera decides**: the effective mask for a view is
   * `view.layerMask ?? view.camera.layers`, and `Camera.layers` defaults to
   * `ALL_LAYERS`, so a viewport that says nothing draws everything — exactly as
   * every viewport did before this field existed. A node is drawn into this view
   * when `layersMatch(node.layers, effectiveMask)`.
   *
   * Per-view rather than per-camera because that is the split §47 and §48 make:
   * a camera's mask is what that camera can see at all, a viewport's is what
   * *this* rectangle shows of it. Split-screen with a shared overlay, a minimap
   * that hides debug gizmos, and a screen-space UI pass over a world pass are all
   * the same one-camera, two-viewports arrangement.
   *
   * Honoured by the backend per view, from one shared render list: a filtered
   * item is skipped before any GPU resource is touched. When the per-view render
   * list arrives (R-8) the filter moves to list-construction time — the field's
   * meaning does not change.
   */
  layerMask?: LayerMask;
}

/**
 * Builds the viewport that covers the whole target surface — the single-view
 * case, which is most applications.
 *
 * Normalized (`0, 0, 1, 1`), so it needs no update when the canvas resizes; the
 * camera's own `aspect` still does (see `PerspectiveCamera`). No `clearColor`
 * is set: choose one explicitly, since a full-surface view that never clears is
 * usually a bug and a default colour would hide it.
 *
 * `id` defaults to `"main"`; pass one when an application has several
 * full-surface views (a render-to-texture pass and the on-screen pass, say) and
 * needs to tell them apart.
 */
export function createFullscreenViewport(
  camera: Camera,
  id = "main",
): Viewport {
  return {
    id,
    camera,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    normalized: true,
  };
}
