/**
 * §47's `ScreenCamera` — the pixel-rectangle camera (R-37, 2026-08-21).
 *
 * §47 lists five camera types and then pins this one's behaviour in a single
 * sentence: "ScreenCamera shall support top-left, bottom-left, and centered
 * origins with logical-pixel or physical-pixel units." §7a says what the
 * default has to be: "screen and viewport spaces (§8) use a top-left origin in
 * logical pixels by default; `ScreenCamera` (§47) can select other origins."
 * That is the whole contract, and this module is it.
 *
 * ```ts
 * const ui = new ScreenCamera();                 // top-left, logical pixels
 * ui.setSurfaceSize(app.width, app.height, app.resolution);
 * ui.updateProjectionMatrix();                   // §47: explicit, always
 *
 * const panel = new Rectangle({ width: 220, height: 96 });
 * panel.position.set(24, 24, 0);                 // 24 px from the top-left
 * panel.layers = layerMask("ui");
 * scene.add(panel);
 *
 * app.views.push(
 *   { ...createFullscreenViewport(worldCamera, "world"), layerMask: layerMask("default") },
 *   { ...createFullscreenViewport(ui, "ui"), layerMask: layerMask("ui") },
 * );
 * ```
 *
 * One world unit is one pixel for anything this camera draws, so UI content is
 * authored in the units a designer hands over and does not move when the world
 * camera does. That is what the flagship's camera-parented instrument panel was
 * working around (`R-37`): parenting to a camera keeps a panel on screen, but
 * its size is then a function of the field of view and its position is in world
 * units that mean nothing to a layout.
 *
 * ## Why an orthographic projection and not a subclass of one
 *
 * The matrix a screen camera needs *is* an orthographic box — but its six
 * bounds are **derived**, not authored, and `OrthographicCamera` documents its
 * bounds as "an authoring decision (how much world to show)". Extending it
 * would leave `left`/`right`/`bottom`/`top` writable and lying: a caller could
 * set them, and the next resize would silently overwrite the write. Extending
 * `Camera` directly and computing the same box from `(width, height,
 * resolution, origin, units)` keeps exactly one source of truth for the
 * rectangle. Both cameras call the same `Matrix4.setOrthographic`, so nothing
 * is duplicated but the four lines that choose the bounds.
 *
 * ## Origin, and which way Y points (§7a)
 *
 * §7a's screen space is top-left based, and the world is Y-up in both 2D and
 * 3D. The recorded reconciliation is that the two meet **at the camera**, and
 * this is that camera: `"top-left"` builds a projection with `bottom > top`, a
 * Y-flip that is one sign inside the projection matrix and is visible nowhere
 * else in the engine.
 *
 * | origin | X | Y | the rectangle in world units |
 * |---|---|---|---|
 * | `"top-left"` (default, §7a) | right | **down** | `[0, w] × [0, h]`, `(0, 0)` top-left |
 * | `"bottom-left"` | right | up | `[0, w] × [0, h]`, `(0, 0)` bottom-left |
 * | `"centered"` | right | up | `[-w/2, w/2] × [-h/2, h/2]` |
 *
 * `"bottom-left"` and `"centered"` are Y-**up** deliberately: they are the two
 * origins a caller picks *because* they want the world convention (§7a's +Y
 * up), and a centered origin with Y down would agree with neither convention.
 * Only `"top-left"` — the origin that exists to match CSS, pointer events and
 * design tools — flips.
 *
 * **The Y-flip mirrors triangle winding.** §7a winds front faces
 * counter-clockwise, and a projection with a negative determinant turns a
 * CCW triangle clockwise. This costs nothing today, because the MVP backend
 * leaves `GL_CULL_FACE` disabled and draws both faces (`gl-program.ts`), and
 * screen-space UI is exactly the content for which that is the right choice.
 * A backend that enables culling has to know the sign of its view-projection
 * determinant; that is a note for the packet that turns culling on, not a
 * reason to make the default origin disagree with §7a.
 *
 * ## Logical versus physical pixels
 *
 * `units` selects which pixel the rectangle is measured in. `"logical"` (the
 * §7a default, and §Glossary's "device-independent pixel unit used by screen
 * space and UI layout") means a 24 px margin is 24 px of *layout* on every
 * display — the same physical size on a 2× screen, drawn with twice the
 * samples. `"physical"` multiplies by {@link ScreenCamera.resolution}, so one
 * world unit is one device pixel and a 1 px hairline is genuinely one pixel.
 * Neither is a rendering setting: the drawing buffer is `width · resolution`
 * device pixels either way (§45/§61 own that), and this field only decides what
 * number a node's coordinate is counted in.
 *
 * ## Where the size comes from (decision, R-37)
 *
 * **The application pushes it, on resize.** {@link ScreenCamera.width} and
 * `height` are the *surface's*, and `Application.resize` already owns exactly
 * this knowledge for exactly this reason — A-7 records it: a renderer is handed
 * a finished `Viewport[]` and "has no way to know which of those rectangles a
 * given camera was authored for", while the application's `views` list *is*
 * that mapping. So `resize` grew one branch beside the `PerspectiveCamera`
 * aspect update, under the same **full-surface** rule (`normalized` and
 * `(0, 0, 1, 1)`), and the same explicit `updateProjectionMatrix` call.
 *
 * The rejected alternative was for the view loop to feed the camera per frame.
 * It would make a projection depend on a renderer having been *drawn* rather
 * than on a size having *changed*, would rebuild the matrix every frame for a
 * value that changes on resize, and would leave a headless application — which
 * §45 explicitly supports — with a camera that never learns its size. A camera
 * in a partial viewport is the caller's to size, exactly as a partial
 * viewport's perspective aspect already is; {@link ScreenCamera.setSurfaceSize}
 * is that one call.
 *
 * ## Refuse, don't clamp (§85)
 *
 * A zero, negative, or non-finite size is refused with
 * `FourError("INVALID_APPLICATION_STATE")` rather than clamped. The other
 * cameras deliberately *do not* validate — `OrthographicCamera` documents that
 * a degenerate box "produces non-finite elements rather than throwing" — and
 * the difference is real: their bounds are authored, so a bad one is a number
 * the author can see, whereas a screen camera's are pushed in from a surface
 * measurement, and a `NaN` there arrives from a `ResizeObserver` on a display
 * that has just been unplugged. Clamping it to 1 px would place every UI node
 * off screen and report nothing. `Application.resize` already returns early on
 * a `0 × 0` surface, so the refusal is reachable only from a direct call.
 *
 * ## Determinism (§33) and allocation
 *
 * Pure arithmetic on the caller's numbers — no clock, no RNG, no
 * transcendentals, no iteration order. The projection is written in place into
 * the matrix `Camera` allocated, so nothing here allocates after construction.
 * Bit-identical on repeats, and at §33's `cross-platform` tier for what it
 * computes; the inverse it also writes goes through `Matrix4.invert`, which is
 * where the usual `same-runtime` statement applies.
 */

import { FourError } from "@four/core";
import type { DepthRange } from "@four/math";

import { Camera } from "./camera.js";

/**
 * Which corner (or centre) of the surface is `(0, 0)` for a
 * {@link ScreenCamera} (§47, §7a).
 *
 * `"top-left"` also flips Y — see the module documentation's table.
 */
export type ScreenOrigin = "top-left" | "bottom-left" | "centered";

/** Every {@link ScreenOrigin}, in §47's order. For validation and UI. */
export const SCREEN_ORIGINS: readonly ScreenOrigin[] = [
  "top-left",
  "bottom-left",
  "centered",
];

/**
 * Which pixel a {@link ScreenCamera}'s world unit is (§47): device-independent
 * layout pixels, or device pixels.
 */
export type ScreenUnits = "logical" | "physical";

/** Every {@link ScreenUnits} value. For validation and UI. */
export const SCREEN_UNITS: readonly ScreenUnits[] = ["logical", "physical"];

/** The §7a default origin: `"top-left"`. */
export const DEFAULT_SCREEN_ORIGIN: ScreenOrigin = "top-left";

/** The §7a default units: `"logical"`. */
export const DEFAULT_SCREEN_UNITS: ScreenUnits = "logical";

/**
 * Default near plane of a {@link ScreenCamera}: `-1000`.
 *
 * Negative on purpose, and it is the one default in this file that is not
 * quoted from the specification. A screen camera exists to draw content
 * authored *on* the plane it sits on — `panel.position.set(24, 24, 0)` with the
 * camera at the origin — and the shared `Camera` default of `near = 0.1` puts
 * the near plane just in *front* of that content, so a camera nobody moved
 * would render nothing. (That trap is recorded twice already: `R-8` found three
 * integration harnesses asserting draws for frames where "a camera at the
 * origin cannot see `z = 0`".) A parallel projection has no reason to avoid it:
 * unlike a perspective frustum, an orthographic box may straddle the eye, so
 * the honest default is a symmetric slab that contains `z = 0` with a thousand
 * units of ordering room on each side for stacked UI.
 */
export const DEFAULT_SCREEN_NEAR = -1000;

/** Default far plane of a {@link ScreenCamera}: `1000`. See {@link DEFAULT_SCREEN_NEAR}. */
export const DEFAULT_SCREEN_FAR = 1000;

/**
 * The protocol a camera declares to be told the surface's size on resize
 * (§45, R-37) — implemented by {@link ScreenCamera}.
 *
 * `Application.resize` tests for this **structurally** (`typeof
 * camera.setSurfaceSize === "function"`) rather than with `instanceof
 * ScreenCamera`, and that is a decision with two arguments behind it:
 *
 * - **§47's fifth camera type is "custom projection camera".** A user's own
 *   camera whose projection depends on the surface has exactly the same need,
 *   and there is no reason the application should feed the one camera class
 *   that ships and refuse the one the user wrote. Declaring a method is how a
 *   camera opts in.
 * - **Bytes.** `@four/four`'s `Application` is in every bundle; an `instanceof`
 *   would name the class and pull `ScreenCamera` into all of them whether or
 *   not the application has one. The structural test names nothing, so a scene
 *   without a screen camera pays zero for this feature.
 *
 * The contract is {@link ScreenCamera.setSurfaceSize}'s: record the size,
 * validate it (§85), and do **not** rebuild the projection — the application
 * calls `updateProjectionMatrix` itself, with the renderer's `depthRange`.
 */
export interface SurfaceSizedCamera {
  /** Records a surface size in logical pixels, with its device-pixel ratio (§45). */
  setSurfaceSize(width: number, height: number, resolution?: number): unknown;
}

/** Construction options for {@link ScreenCamera} (§47). */
export interface ScreenCameraOptions {
  /** Which corner is `(0, 0)`. Default `"top-left"` (§7a). */
  origin?: ScreenOrigin;
  /** Logical or physical pixels. Default `"logical"` (§7a). */
  units?: ScreenUnits;
  /** Surface width in **logical** pixels. Finite and `> 0`. Default `1`. */
  width?: number;
  /** Surface height in **logical** pixels. Finite and `> 0`. Default `1`. */
  height?: number;
  /** Device pixels per logical pixel (§45). Finite and `> 0`. Default `1`. */
  resolution?: number;
  /** Near plane. Default `-1000` — see {@link DEFAULT_SCREEN_NEAR}. */
  near?: number;
  /** Far plane. Default `1000`. */
  far?: number;
}

/** §85 refusal shared by the constructor and the projection write. */
function refuse(what: string, value: unknown): FourError {
  return new FourError(
    "INVALID_APPLICATION_STATE",
    `ScreenCamera ${what} must be a finite number of pixels > 0 (§85, §47); received ${String(value)}.`,
  );
}

/** Throws unless `value` is a finite, positive pixel count (§85). */
function assertPixels(value: number, what: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw refuse(what, value);
  }
}

/**
 * A camera whose projection is the surface's pixel rectangle (§47).
 *
 * Everything about it — the origin conventions, the two unit systems, where its
 * size comes from, why it refuses a degenerate one, and why `"top-left"` flips
 * Y — is argued in the module documentation above. What follows is the API.
 *
 * A `ScreenCamera` is a `Node` like every other camera, so it can be moved:
 * scrolling a screen-space layer is `camera.position.x += dx`, and nothing
 * about the projection changes. Its `layers` (§46/§47) are how a screen-space
 * pass is separated from a world pass — one camera per layer, two viewports,
 * one render list (`Viewport.layerMask`).
 */
export class ScreenCamera extends Camera {
  /**
   * Which corner of the surface is `(0, 0)` (§47, §7a). Plain field: assign it
   * and call {@link ScreenCamera.updateProjectionMatrix}, exactly as with every
   * other projection parameter in §47.
   */
  origin: ScreenOrigin;

  /** Logical or physical pixels (§47). Assign, then update the projection. */
  units: ScreenUnits;

  /**
   * Surface width in **logical** pixels — always logical, whatever
   * {@link ScreenCamera.units} says, because that is what §45 measures and what
   * `Application.width` reports. `units` converts on the way into the
   * projection; it does not reinterpret this number.
   */
  width: number;

  /** Surface height in logical pixels. See {@link ScreenCamera.width}. */
  height: number;

  /** Device pixels per logical pixel (§45) — only read when `units` is `"physical"`. */
  resolution: number;

  constructor(options: ScreenCameraOptions = {}) {
    super();
    const width = options.width ?? 1;
    const height = options.height ?? 1;
    const resolution = options.resolution ?? 1;
    assertPixels(width, "width");
    assertPixels(height, "height");
    assertPixels(resolution, "resolution");
    this.origin = options.origin ?? DEFAULT_SCREEN_ORIGIN;
    this.units = options.units ?? DEFAULT_SCREEN_UNITS;
    this.width = width;
    this.height = height;
    this.resolution = resolution;
    this.near = options.near ?? DEFAULT_SCREEN_NEAR;
    this.far = options.far ?? DEFAULT_SCREEN_FAR;
    this.#writeProjection("negative-one-to-one");
  }

  /**
   * Width of the visible rectangle in this camera's own units — `width`, or
   * `width · resolution` when {@link ScreenCamera.units} is `"physical"`.
   *
   * This is the number a layout wants: the right edge of the screen is
   * `pixelWidth` (or `pixelWidth / 2` with a centered origin).
   */
  get pixelWidth(): number {
    return this.units === "physical"
      ? this.width * this.resolution
      : this.width;
  }

  /** Height of the visible rectangle in this camera's own units. */
  get pixelHeight(): number {
    return this.units === "physical"
      ? this.height * this.resolution
      : this.height;
  }

  /**
   * Records a new surface size (§45), validating all three numbers (§85).
   *
   * Deliberately **does not** rebuild the projection: §47 keeps recomputation
   * explicit for every camera, and a caller that changes the size and the
   * origin together should pay for one matrix write, not two. Call
   * {@link ScreenCamera.updateProjectionMatrix} afterwards — which is what
   * `Application.resize` does.
   *
   * @param width surface width in logical pixels; finite and `> 0`
   * @param height surface height in logical pixels; finite and `> 0`
   * @param resolution device pixels per logical pixel; finite and `> 0`.
   * Defaults to the current value, so `setSurfaceSize(w, h)` never silently
   * drops a 2× buffer — `Application.resize`'s rule, for the same reason.
   * @returns this camera, so the update call can be chained
   * @throws FourError `INVALID_APPLICATION_STATE` on a non-finite or
   * non-positive number. Nothing is written when it throws.
   */
  setSurfaceSize(width: number, height: number, resolution?: number): this {
    assertPixels(width, "width");
    assertPixels(height, "height");
    if (resolution !== undefined) {
      assertPixels(resolution, "resolution");
      this.resolution = resolution;
    }
    this.width = width;
    this.height = height;
    return this;
  }

  /**
   * Rebuilds the projection (and its inverse) from the current size, origin and
   * units (§47).
   *
   * @throws FourError `INVALID_APPLICATION_STATE` when the size or resolution
   * is not a finite positive number — the fields are plain, so a direct write
   * is checked here rather than on assignment (§85).
   */
  override updateProjectionMatrix(
    depthRange: DepthRange = "negative-one-to-one",
  ): void {
    this.#writeProjection(depthRange);
  }

  /**
   * The projection write, private so the constructor can call it without
   * dispatching to an override — `PerspectiveCamera`'s pattern.
   */
  #writeProjection(depthRange: DepthRange): void {
    assertPixels(this.width, "width");
    assertPixels(this.height, "height");
    assertPixels(this.resolution, "resolution");
    const w = this.pixelWidth;
    const h = this.pixelHeight;
    let left = 0;
    let right = w;
    let bottom = 0;
    let top = h;
    if (this.origin === "top-left") {
      // The Y-flip: screen Y grows downwards, so the *bottom* of the world box
      // is the largest screen Y. One sign, here and nowhere else (§7a).
      bottom = h;
      top = 0;
    } else if (this.origin === "centered") {
      left = -w / 2;
      right = w / 2;
      bottom = -h / 2;
      top = h / 2;
    }
    this.projectionMatrix.setOrthographic(
      left,
      right,
      bottom,
      top,
      this.near,
      this.far,
      depthRange,
    );
    this.inverseProjectionMatrix.copy(this.projectionMatrix).invert();
  }
}
