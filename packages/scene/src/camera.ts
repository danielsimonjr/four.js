/**
 * Cameras (§47).
 *
 * A camera is a {@link Node}: it sits in the scene graph, carries a transform,
 * and is parented, animated, and driven exactly like anything else — a camera
 * on a spring arm is a camera added under the arm's node, not a special case.
 * What it adds over `Node` is the pair of matrices a renderer needs, and §47
 * fixes their names:
 *
 * ```ts
 * abstract class Camera extends Node {
 *   near: number;
 *   far: number;
 *   projectionMatrix: Matrix4;
 *   inverseProjectionMatrix: Matrix4;
 *   viewMatrix: Matrix4;
 *   layers: LayerMask;
 * }
 * ```
 *
 * All six are shipped: `layers` joined them with §46's layer registry (R-38,
 * 2026-08-08 — it was deliberately absent until then, see {@link Camera.layers}).
 * The other two required §47 camera types (`ScreenCamera`, `ObliqueCamera`, plus
 * the custom projection camera and the camera rigs) are later phases. The MVP
 * (§120) needs perspective and orthographic, which is what this module ships.
 *
 * ## Where the matrices come from
 *
 * The projection is written by `Matrix4.setPerspective` / `setOrthographic`
 * (plan D8) — one convention for the whole engine, including the
 * `depthRange` argument that selects the backend's clip-space depth range
 * (`"negative-one-to-one"` for WebGL 2, `"zero-to-one"` for WebGPU). The view
 * matrix is the inverse of the camera node's **world** matrix (§7): the world
 * matrix maps camera space into world space, so its inverse maps world space
 * into camera space, which is what a renderer multiplies its model matrices by.
 * Cameras look down their own −Z with +Y up (§7a, D8).
 *
 * ## Aiming a camera (R-36, 2026-08-09)
 *
 * {@link Node.lookAt} is the orientation helper §44/§47 ask for, and it lives
 * on `Node` rather than here because −Z is every node's forward, not a camera's
 * privilege — the same call aims a directional or spot light (§68). It writes
 * exactly the orientation {@link Camera.updateViewMatrix} inverts, so
 * `camera.lookAt(target); camera.updateViewMatrix();` yields the classic
 * look-at view matrix. {@link Node.getWorldDirection} reads the aim back.
 * §44's *rigs* — orbit, fly, first-person, trackball, follow, spring arm,
 * shake — are still unshipped; `lookAt` is the primitive they will be built on,
 * not a substitute for them.
 *
 * ## Explicit recomputation (decision, WP-3.1)
 *
 * Mutating a projection parameter — `camera.fieldOfView = 1.2`, `camera.aspect
 * = w / h`, `camera.near = 0.01` — does **not** recompute anything. Call
 * {@link Camera.updateProjectionMatrix} afterwards. The projection parameters
 * are plain numbers precisely so that resizing a canvas is a field write, and
 * making them accessors purely to catch that write would put a hidden 4×4
 * rebuild plus a matrix inversion behind an innocuous assignment (and still
 * miss the case where several parameters change together). This matches the
 * idiom users already know from three.js, and it is why the constructors
 * compute the matrices once: a camera is usable the moment it exists, and only
 * *changes* need announcing.
 *
 * The same is true of {@link Camera.updateViewMatrix}: moving the camera does
 * not rewrite `viewMatrix`. A renderer calls it once per view per frame.
 */

import { Matrix4, type DepthRange } from "@four/math";

import { ALL_LAYERS, type LayerMask } from "./layers.js";
import { Node } from "./node.js";
import { resolveWorldTransform } from "./world-transforms.js";

/**
 * Clip-space depth convention assumed when a caller does not pass one: OpenGL's
 * `[-1, 1]`, i.e. WebGL 2 (plan D8; §120 makes WebGL 2 the MVP backend). WebGPU
 * passes `"zero-to-one"` explicitly.
 */
const DEFAULT_DEPTH_RANGE: DepthRange = "negative-one-to-one";

/** Default vertical field of view: 60° in radians (§7a, §97). */
const DEFAULT_FIELD_OF_VIEW = Math.PI / 3;

/** Default near plane distance (§97). */
const DEFAULT_NEAR = 0.1;

/** Default far plane distance (§97). */
const DEFAULT_FAR = 1000;

/**
 * Base class of every camera (§47).
 *
 * Abstract because a camera without a projection is not a camera: subclasses
 * own the projection parameters and implement
 * {@link Camera.updateProjectionMatrix}. Everything shared — the near/far
 * planes, the three matrices, and the view-matrix derivation, which is
 * identical for every projection — lives here.
 *
 * ## The matrices are `readonly` instances (decision, WP-3.1)
 *
 * All three are `Matrix4` instances created once and **written in place**,
 * never replaced, exactly as `Transform` treats its matrices: a renderer that
 * captured `camera.projectionMatrix.elements` when it built a uniform buffer
 * keeps a valid view of the live value for the camera's lifetime. §47 declares
 * them as mutable fields; `readonly` here refers to the binding only and is the
 * stronger guarantee — write *into* them.
 *
 * ## `layers` (R-38, 2026-08-08)
 *
 * §47's declaration ends with `layers: LayerMask`, the per-camera visibility
 * mask of §46 ("symbolic layers control camera visibility"). It waited for the
 * layer registry §46 actually requires — named layers that "compile to efficient
 * masks internally while preserving human-readable names in the public API and
 * serialized scene files" — rather than being invented as a bare number here.
 * That registry now exists (`layers.ts`), so the field does too; see
 * {@link Camera.layers}.
 */
export abstract class Camera extends Node {
  /**
   * Distance from the camera to the near clip plane, along its −Z view
   * direction (§47). A positive distance, not a Z coordinate (D8).
   */
  near: number = DEFAULT_NEAR;

  /** Distance to the far clip plane, same convention as {@link Camera.near}. */
  far: number = DEFAULT_FAR;

  /**
   * Camera space → clip space (§47). Written by
   * {@link Camera.updateProjectionMatrix}; the instance is never replaced.
   */
  readonly projectionMatrix: Matrix4 = new Matrix4();

  /**
   * Inverse of {@link Camera.projectionMatrix} (§47) — clip space back to
   * camera space, the first half of unprojecting a pointer position (§71) or
   * building a picking ray. Recomputed by
   * {@link Camera.updateProjectionMatrix}, so it is never out of step with the
   * projection it inverts.
   */
  readonly inverseProjectionMatrix: Matrix4 = new Matrix4();

  /**
   * World space → camera space (§47): the inverse of this node's world matrix.
   * Written by {@link Camera.updateViewMatrix}; the instance is never replaced.
   */
  readonly viewMatrix: Matrix4 = new Matrix4();

  /**
   * Which §46 layers this camera can see (§47, R-38, 2026-08-08).
   *
   * ```ts
   * worldCamera.layers = layerMask("default");  // everything but the UI
   * uiCamera.layers = layerMask("ui");          // only the UI
   * ```
   *
   * A node is drawn for this camera when `layersMatch(node.layers,
   * camera.layers)` — the two masks share at least one bit. Defaults to
   * {@link ALL_LAYERS}: a camera sees every layer until told otherwise, which is
   * what keeps a scene that never mentions layers identical to the one it was
   * before they existed.
   *
   * This is the **fallback**, not the last word: §48 lets a viewport narrow it
   * further with its own `layerMask`, so one camera can feed two views that show
   * different slices of the same scene (`Viewport.layerMask`). A camera's mask
   * is per-camera state; a viewport's is per-view.
   *
   * ## It **overrides** `Node.layers` (decision, R-38)
   *
   * There is one property, not two: §47 spells the camera's visibility mask
   * `layers`, and `Node.layers` — this engine's object-side membership mask,
   * which §6 does not declare — has the same name. Redeclaring the field here
   * narrows its meaning for cameras from "layers this node belongs to" to
   * "layers this camera looks at", and changes its default from
   * `DEFAULT_LAYER_MASK` to {@link ALL_LAYERS}.
   *
   * That is safe rather than merely convenient: **nothing ever reads a camera's
   * membership**. A `Camera` is not a `Renderable`, so §64's list generates no
   * item for it whatever its mask says; it is not a picking candidate; and §46's
   * remaining consumers (physics groups, post-processing inclusion) do not apply
   * to a camera either. The alternative — a second field with a different name —
   * would contradict §47's declaration to preserve a fact no code can use.
   *
   * One consequence worth knowing: `applyLayers(scene, mask)` walks *every*
   * node, so it rewrites the visibility mask of any camera inside that subtree.
   * Apply layers to the branch you mean, or re-set the camera afterwards.
   */
  layers: LayerMask = ALL_LAYERS;

  /**
   * Rebuilds {@link Camera.projectionMatrix} from this camera's projection
   * parameters, and {@link Camera.inverseProjectionMatrix} from the result.
   *
   * Call it after changing any projection parameter — nothing recomputes
   * implicitly (see the module documentation). Constructors call it once, so a
   * freshly built camera already projects.
   *
   * `depthRange` is the target backend's clip-space depth convention (D8) and
   * defaults to `"negative-one-to-one"`. It is an argument rather than camera
   * state because it belongs to the *renderer*, not to the camera: the same
   * camera feeding a WebGL 2 and a WebGPU view differs only in this, and a
   * renderer that owns the value cannot get it wrong. A camera rendered by a
   * `"zero-to-one"` backend must therefore have its projection updated with
   * that argument — the backend does it as part of preparing the view.
   *
   * Implementations write in place and allocate nothing.
   */
  abstract updateProjectionMatrix(depthRange?: DepthRange): void;

  /**
   * Rebuilds {@link Camera.viewMatrix} as the inverse of this camera node's
   * current world matrix (§7, §47).
   *
   * World transforms are resolved on demand first
   * (`resolveWorldTransform(this)`), so the result is correct at any point in a
   * frame, including immediately after moving the camera or one of its
   * ancestors and before any full resolution pass has run. That resolution
   * walks this node's ancestor chain only — O(depth), nothing below the camera
   * — and is version-cached, so when the caller has already resolved the scene
   * (the normal render path: §7 resolves before render-item generation, §64)
   * this costs one comparison per ancestor and no arithmetic. Callers that want
   * to guarantee that cheap path resolve the scene before calling; correctness
   * never depends on it.
   *
   * Allocates nothing. A camera whose world matrix is singular — only possible
   * with a zero scale somewhere up the chain — leaves `viewMatrix` holding that
   * un-inverted world matrix rather than infinities or `NaN`, because
   * `Matrix4.invert` refuses singular input and leaves its elements alone. The
   * result is meaningless either way; the point is that a degenerate camera
   * poisons nothing downstream and raises no error on a per-frame path.
   */
  updateViewMatrix(): void {
    this.viewMatrix.copy(resolveWorldTransform(this)).invert();
  }
}

/** Construction options for {@link PerspectiveCamera} (§47, §97). */
export interface PerspectiveCameraOptions {
  /**
   * Full **vertical** field of view in radians (§7a — there is no degree
   * overload). Default `Math.PI / 3` (60°).
   */
  fieldOfView?: number;
  /** Viewport width ÷ height. Default `1`. */
  aspect?: number;
  /** Near plane distance. Default `0.1`. */
  near?: number;
  /** Far plane distance. Default `1000`. */
  far?: number;
}

/**
 * Perspective camera (§47): objects shrink with distance, the projection of a
 * symmetric frustum.
 *
 * ```ts
 * const camera = new PerspectiveCamera({ fieldOfView: Math.PI / 3, near: 0.1, far: 1000 });
 * camera.aspect = canvas.width / canvas.height;
 * camera.updateProjectionMatrix(); // explicit, see the module documentation
 * ```
 *
 * Degenerate configurations (`near === far`, a zero `aspect`, a field of view
 * at or beyond π) produce non-finite matrix elements rather than throwing, as
 * `Matrix4.setPerspective` documents. Nothing validates them here either: there
 * is no §89 error code for a configuration mistake yet, and inventing one is a
 * `@four/core` change this packet may not make (decision, WP-3.1 — revisit when
 * the diagnostics phase adds validation).
 */
export class PerspectiveCamera extends Camera {
  /** Full vertical field of view in radians (§7a). */
  fieldOfView: number;

  /** Viewport width ÷ height. */
  aspect: number;

  constructor(options: PerspectiveCameraOptions = {}) {
    super();
    this.fieldOfView = options.fieldOfView ?? DEFAULT_FIELD_OF_VIEW;
    this.aspect = options.aspect ?? 1;
    this.near = options.near ?? DEFAULT_NEAR;
    this.far = options.far ?? DEFAULT_FAR;
    this.#writeProjection(DEFAULT_DEPTH_RANGE);
  }

  override updateProjectionMatrix(
    depthRange: DepthRange = DEFAULT_DEPTH_RANGE,
  ): void {
    this.#writeProjection(depthRange);
  }

  /**
   * The projection write, private so that the constructor can call it without
   * calling an overridable method on a half-constructed subclass.
   */
  #writeProjection(depthRange: DepthRange): void {
    this.projectionMatrix.setPerspective(
      this.fieldOfView,
      this.aspect,
      this.near,
      this.far,
      depthRange,
    );
    this.inverseProjectionMatrix.copy(this.projectionMatrix).invert();
  }
}

/** Construction options for {@link OrthographicCamera} (§47). */
export interface OrthographicCameraOptions {
  /** Left edge of the view volume in camera space. Default `-1`. */
  left?: number;
  /** Right edge of the view volume in camera space. Default `1`. */
  right?: number;
  /** Bottom edge of the view volume in camera space (+Y is up, §7a). Default `-1`. */
  bottom?: number;
  /** Top edge of the view volume in camera space. Default `1`. */
  top?: number;
  /** Near plane distance. Default `0.1`. */
  near?: number;
  /** Far plane distance. Default `1000`. */
  far?: number;
}

/**
 * Orthographic camera (§47): parallel projection of a box-shaped view volume —
 * the 2D and CAD workhorse (§48 lists "CAD orthographic views" among the
 * viewport use cases).
 *
 * The six bounds are given in camera space with +Y up (§7a), so a 2D scene
 * showing world units `[-8, 8] × [-4.5, 4.5]` is
 * `new OrthographicCamera({ left: -8, right: 8, bottom: -4.5, top: 4.5 })`.
 *
 * Defaults are the unit box `[-1, 1]²` with the same near/far as
 * {@link PerspectiveCamera} (decision, WP-3.1 — §47 and §97 pin no orthographic
 * defaults; `[-1, 1]²` makes the default projection map camera space straight
 * onto normalized device coordinates, which is the least surprising identity
 * for a camera nobody has configured, and sharing near/far keeps the two camera
 * types consistent).
 *
 * A degenerate box (`right === left`, `top === bottom`, `far === near`)
 * produces non-finite elements rather than throwing — see
 * {@link PerspectiveCamera}.
 */
export class OrthographicCamera extends Camera {
  /** Left edge of the view volume in camera space. */
  left: number;

  /** Right edge of the view volume in camera space. */
  right: number;

  /** Bottom edge of the view volume in camera space. */
  bottom: number;

  /** Top edge of the view volume in camera space. */
  top: number;

  constructor(options: OrthographicCameraOptions = {}) {
    super();
    this.left = options.left ?? -1;
    this.right = options.right ?? 1;
    this.bottom = options.bottom ?? -1;
    this.top = options.top ?? 1;
    this.near = options.near ?? DEFAULT_NEAR;
    this.far = options.far ?? DEFAULT_FAR;
    this.#writeProjection(DEFAULT_DEPTH_RANGE);
  }

  override updateProjectionMatrix(
    depthRange: DepthRange = DEFAULT_DEPTH_RANGE,
  ): void {
    this.#writeProjection(depthRange);
  }

  /** See {@link PerspectiveCamera}'s private writer. */
  #writeProjection(depthRange: DepthRange): void {
    this.projectionMatrix.setOrthographic(
      this.left,
      this.right,
      this.bottom,
      this.top,
      this.near,
      this.far,
      depthRange,
    );
    this.inverseProjectionMatrix.copy(this.projectionMatrix).invert();
  }
}
