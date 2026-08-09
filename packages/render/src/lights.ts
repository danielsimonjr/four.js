/**
 * Light collection (§68, §64) — scene graph in, one flat light state out.
 *
 * The lit pipeline (§120 "lighting") needs three things a render item does not
 * carry: the scene ambient term, and the direction and color of the
 * directional light. This module gathers them into a {@link SceneLights}
 * record once per frame, the backend-independent way `render-list.ts` gathers
 * draws — a backend uploads the record's values as uniforms and never walks
 * the scene itself.
 *
 * ## The tier (R-17, 2026-08-09)
 *
 * One walk collects three things:
 *
 * - the scene **ambient** term, read off the root only;
 * - the first visible, enabled **directional** light — the sun. Exactly one,
 *   still: further directional lights are ignored, deterministically
 *   (scene-graph order decides which one wins, §33), for the reason
 *   `@four/scene`'s `light.ts` records;
 * - up to {@link MAX_PUNCTUAL_LIGHTS} **point and spot** lights, flattened
 *   into the four packed arrays a backend uploads as uniform arrays.
 *
 * and, since R-18 (2026-08-09), the **shadow** the directional light casts
 * when it is asked to (§69): a view-projection, a map size, and two biases,
 * which together are everything a backend needs to render a depth map and
 * compare against it. Only the *directional* light casts at this tier — see
 * `@four/scene`'s `DirectionalLightShadow` for §69's staged remainder.
 *
 * §68's hemisphere and rectangular-area types are staged, and so are light
 * layers, IBL, and the clustered/forward-plus path for *many* lights — see
 * `@four/scene`'s `light.ts`, which owns that list.
 *
 * ## Order, and what happens past the bound
 *
 * The walk is the depth-first, insertion-ordered traversal of §6 — the same
 * order `render-list.ts` builds draws in and the same "first match" rule
 * `Scene.find*` uses — with `visible` and `enabled` pruning **whole subtrees**.
 * A scene with more than {@link MAX_PUNCTUAL_LIGHTS} punctual lights therefore
 * keeps the **first `MAX_PUNCTUAL_LIGHTS` in that order** and skips the rest:
 * a deterministic, authored, reproducible choice (§33), never "the nearest"
 * (which would flicker as the camera moves) and never "the brightest" (which
 * would flicker as a light animates). Sort by moving the nodes.
 *
 * The overflow is reported **once per root**, through `console.warn`, because
 * a scene that quietly drops a lamp is exactly the bug nobody finds. It is not
 * gated on §85's build flag: unlike a per-frame validity check it costs one
 * `WeakSet` lookup per collection, and the message it protects is worth more
 * in production than the bytes it costs.
 *
 * ## Structural contracts, like `particles.ts`
 *
 * Lights are recognised by the {@link DirectionalLightSource} brand and the
 * ambient term is read off the root through {@link AmbientLightSource} —
 * duck-typing rather than `instanceof DirectionalLight` / `instanceof Scene`,
 * even though (unlike the particle case) the render → scene edge exists in
 * the frozen §3.1 matrix. The reason is one layer down: `@four/render-webgl`
 * may depend on `core`, `math`, and `render` only, so its unit tests build
 * scenes from typed doubles, and an `instanceof` here would make a fake light
 * impossible to write there. Unlike the particle contract, drift *is* caught
 * at type level: this package depends on `@four/scene`, and its unit tests
 * pin the real `DirectionalLight` and `Scene` against these shapes with plain
 * assignments.
 */

import { Matrix4, Vector3 } from "@four/math";
import type { Node } from "@four/scene";

/**
 * What the light collector reads from a directional light node — the
 * structural contract `@four/scene`'s `DirectionalLight` satisfies (§68).
 */
export interface DirectionalLightSource {
  /**
   * The brand {@link collectSceneLights} recognises. A literal `true`, not a
   * method, so the check is one property load per node per frame — exactly
   * `ParticleDrawable.isParticleDrawable`'s design.
   */
  readonly isDirectionalLight: true;

  /**
   * Straight RGB in 0…1, in §60a's **linear-light working space** — uploaded to
   * the shader as it stands (the "no colour space attached" deferral this line
   * carried is resolved by R-15, 2026-08-08; an author with a CSS string decodes
   * it with `@four/math`'s `srgbToLinearRGB(parseColorRGB(css), out)`).
   */
  readonly color: readonly [number, number, number];

  /** Scalar multiplier on the color (§68); dimensionless in this tier. */
  readonly intensity: number;

  /**
   * Writes the world-space unit vector the light travels along into `out`
   * and returns it. `@four/scene`'s implementation derives it from the
   * node's world −Z axis; a double supplies whatever the test needs.
   */
  getWorldDirection(out: Vector3): Vector3;

  /**
   * Whether this light casts shadows (§69; R-18, 2026-08-09). Absent — like
   * every member below — reads as `false`.
   *
   * **Optional, and that is the compatibility contract**, not laziness: this
   * interface is satisfied structurally, and the doubles `@four/render-webgl`'s
   * unit tests build were written before §69 existed. A required member here
   * would have broken every one of them at *compile* time, and a host's own
   * minimal light object at run time — while an optional one reads `undefined`,
   * which {@link collectSceneLights} resolves to "does not cast", i.e. exactly
   * the behaviour every scene had before this field.
   */
  readonly castShadow?: boolean;

  /**
   * Resolution and bias of this light's shadow map (§69) — the half
   * {@link SceneLights} carries through to a backend. `@four/scene`'s
   * `DirectionalLightShadow` satisfies it; the volume controls it also carries
   * (`extent`, `near`, `far`) are consumed by
   * {@link DirectionalLightSource.computeShadowMatrix} and never reach a
   * backend, which is why they are not declared here.
   */
  readonly shadow?: DirectionalShadowSource;

  /**
   * Writes the light's world-space **shadow view-projection** into `out` and
   * returns it (§69) — see `@four/scene`'s `DirectionalLight` for the
   * derivation. A light that offers no such method never casts, whatever
   * {@link DirectionalLightSource.castShadow} says: the matrix is the shadow.
   */
  computeShadowMatrix?(out: Matrix4): Matrix4;
}

/**
 * The two shadow numbers a backend needs per frame (§69) — the structural half
 * of `@four/scene`'s `DirectionalLightShadow`.
 *
 * `mapSize` is here rather than derived because a backend has to *allocate* a
 * surface of that size before it can render into one, and `bias`/`normalBias`
 * because both are consumed by the fragment stage that samples it. Everything
 * else on §69's settings object shapes the matrix, which arrives already
 * multiplied out.
 */
export interface DirectionalShadowSource {
  /** Edge of the square shadow map in texels (§69 "configurable resolution"). */
  readonly mapSize: number;

  /** Constant depth offset, in clip-space depth units (§69 "bias"). */
  readonly bias: number;

  /** Offset along the receiver's normal, in metres (§69 "normal-bias"). */
  readonly normalBias: number;
}

/**
 * How many of §68's **positional** lights — point and spot together — one
 * frame may shade with (R-17, 2026-08-09).
 *
 * §68 states no number, and Appendix A pins no light defaults, so this is a
 * recorded decision rather than a quotation. **Eight**, because:
 *
 * - it is a *forward* renderer's bound, and the honest ceiling on one is what
 *   the fragment stage can afford to loop over per pixel. §68's own answer to
 *   "many lights" is the clustered/forward-plus extension path, which is where
 *   a scene with dozens of lamps belongs — not a larger array;
 * - the four arrays cost `8 × (3 + 3 + 3 + 4) = 104` floats, i.e. 32 uniform
 *   vectors. GLES 3.0 guarantees 224 fragment uniform vectors, and this
 *   backend's largest pipeline (§59's standard program) spends about 17 on
 *   everything else — so eight lights fit inside the *guaranteed* minimum with
 *   room to spare on every conformant WebGL 2 device, with no capability query
 *   and no shader variant;
 * - it is the number three of the four engines this project's positioning
 *   document compares against settle on for a forward path, so an author
 *   porting a scene meets no surprise.
 *
 * It is a compile-time constant of the *shader*, not a runtime option, which
 * is the point: a `maxLights` option would mean recompiling pipelines at run
 * time and a §61 renderer may not throw inside a frame.
 */
export const MAX_PUNCTUAL_LIGHTS = 8;

/**
 * What the collector reads from **any** of §68's positional lights — the half
 * `@four/scene`'s `PunctualLight` base class satisfies (R-17, 2026-08-09).
 *
 * Structural, exactly like {@link DirectionalLightSource} and for exactly the
 * same reason: `@four/render-webgl` may depend on `core`, `math`, and `render`
 * only, so its unit tests build lights as typed doubles.
 */
export interface PunctualLightSourceBase {
  /**
   * The brand {@link collectSceneLights} recognises. A literal `true`, not a
   * method, so the check is one property load per node per frame.
   */
  readonly isPunctualLight: true;

  /** Straight RGB in §60a's linear-light working space (§68). */
  readonly color: readonly [number, number, number];

  /**
   * Scalar multiplier on the colour: the irradiance, over π, at **unit
   * distance** (§68; see `@four/scene`'s `light.ts` for the convention).
   */
  readonly intensity: number;

  /**
   * Distance at which the contribution reaches zero, or `0` for unbounded —
   * the `KHR_lights_punctual` window `@four/scene`'s `PunctualLight` documents.
   */
  readonly range: number;

  /** Writes this light's world-space position into `out` and returns it. */
  getWorldPosition(out: Vector3): Vector3;
}

/** A {@link PunctualLightSourceBase} with no axis — §68's point light. */
export interface PointLightSource extends PunctualLightSourceBase {
  readonly lightType: "point";
}

/** A {@link PunctualLightSourceBase} with a cone — §68's spot light. */
export interface SpotLightSource extends PunctualLightSourceBase {
  readonly lightType: "spot";

  /** Half-angle of the fully-lit core, in radians (§7a). */
  readonly innerConeAngle: number;

  /** Half-angle at which the cone reaches zero, in radians (§7a). */
  readonly outerConeAngle: number;

  /**
   * Writes the world-space unit vector the cone points along into `out` — the
   * node's −Z axis, the same convention {@link DirectionalLightSource} uses.
   */
  getWorldDirection(out: Vector3): Vector3;
}

/** Either of §68's positional light types, as the collector sees them. */
export type PunctualLightSource = PointLightSource | SpotLightSource;

/**
 * Where the scene ambient term comes from (§68 "ambient"): the render root,
 * when it offers one — `Scene.ambientLight` is the engine's carrier. A root
 * that is not a `Scene` (a subtree handed straight to `Renderer.render`)
 * simply has no ambient term, and lit surfaces shade from the directional
 * light alone.
 */
export interface AmbientLightSource {
  /** Straight RGB in 0…1, added uniformly to every lit surface (§68). */
  readonly ambientLight: readonly [number, number, number];
}

/**
 * The frame's flattened lighting (§68), as a backend consumes it. One
 * mutable record, rewritten in place by every {@link collectSceneLights}
 * call — the pooling policy every per-frame structure in this package
 * follows (plan D7). Copy anything you need to keep.
 */
export interface SceneLights {
  /** The scene ambient term; `[0, 0, 0]` when the root offers none. */
  readonly ambientColor: [number, number, number];

  /**
   * Whether a directional light was found. When `false` the other two
   * directional fields hold their documented no-light values, so a backend
   * may upload them unconditionally.
   */
  hasDirectionalLight: boolean;

  /**
   * World-space unit vector the light travels along; `(0, 0, -1)` — the
   * direction an unrotated light shines — when there is no light. Owned by
   * the record and rewritten by the next collection.
   */
  readonly direction: Vector3;

  /**
   * The light's color premultiplied by its intensity — the one product every
   * shaded fragment needs, computed once per frame here rather than per
   * fragment there. `[0, 0, 0]` when there is no light, which makes the
   * Lambert term vanish and is why a backend needs no shader variant for the
   * unlit-scene case.
   */
  readonly directionalColor: [number, number, number];

  /**
   * How many entries of the four arrays below are live — `0` through
   * {@link MAX_PUNCTUAL_LIGHTS} (R-17, 2026-08-09).
   *
   * **A backend that sees `0` here must upload nothing at all.** That is not
   * an optimisation, it is the compatibility contract: an `int` uniform's
   * initial value in GL is `0`, so a scene lit the way every scene was lit
   * before this field existed issues byte-for-byte the GL sequence it always
   * did — the same technique R-38's permissive layer mask and R-15's
   * `bool` encode switch used.
   */
  punctualCount: number;

  /**
   * World-space positions, `x, y, z` per light, `MAX_PUNCTUAL_LIGHTS` entries
   * long and only the first `punctualCount` of them meaningful.
   *
   * `Float32Array` rather than the `number[]` the fields above use, because
   * these are uploaded **as a block**: a backend hands the array straight to
   * `uniform3fv` with no per-frame copy into scratch, which is the whole
   * reason the packing is done here instead of there. The trailing entries are
   * zeroed by every collection so a transcript of the upload is deterministic
   * rather than showing the previous frame's leftovers.
   */
  readonly punctualPositions: Float32Array;

  /**
   * Each light's colour premultiplied by its intensity, `r, g, b` per light —
   * the same product `directionalColor` carries, for the same reason
   * (computed once per frame here rather than per fragment there).
   */
  readonly punctualColors: Float32Array;

  /**
   * Each light's cone axis, `x, y, z` per light: the world-space unit vector
   * the light **travels along**, matching {@link SceneLights.direction}'s
   * convention. A point light has no axis and writes `(0, 0, 0)`.
   */
  readonly punctualDirections: Float32Array;

  /**
   * Four scalars per light, packed so the fragment stage needs no branching on
   * a light *kind* beyond one comparison:
   *
   * ```text
   * x  range, or 0 for unbounded — the KHR_lights_punctual window
   * y  cos(outerConeAngle);              0 for a point light
   * z  1 / max(cos inner − cos outer, 1e-6);   0 for a point light
   * w  1 for a spot light, 0 for a point light
   * ```
   *
   * The reciprocal in `z` is precomputed **here**, once per light per frame,
   * rather than in the shader once per light per *fragment*; the `max` is what
   * makes an `inner ≥ outer` cone a hard edge instead of a division by zero
   * (see `@four/scene`'s `SpotLight`).
   */
  readonly punctualParams: Float32Array;

  /**
   * Whether the frame's directional light casts a shadow map (§69; R-18,
   * 2026-08-09) — `true` only when that light exists, sets `castShadow`, and
   * offers a `computeShadowMatrix`.
   *
   * **A backend that sees `false` here must issue no shadow call at all** —
   * not a framebuffer bind, not a uniform, not a texture. That is the same
   * compatibility contract {@link SceneLights.punctualCount} states, kept the
   * same way: a `bool` uniform's initial value in GL is `false`, so a scene lit
   * the way every scene was lit before §69 shipped emits byte-for-byte the GL
   * sequence it always did.
   */
  hasShadow: boolean;

  /**
   * World space → shadow-map clip space (§69), written by the casting light's
   * own `computeShadowMatrix`. Identity when {@link SceneLights.hasShadow} is
   * `false`, and owned by the record — read it, upload it, do not mutate it.
   */
  readonly shadowMatrix: Matrix4;

  /**
   * Edge of the square shadow map in texels; `0` when nothing casts. The
   * backend allocates its off-screen depth surface at this size and derives
   * the PCF tap offset (`1 / shadowMapSize`) from it.
   */
  shadowMapSize: number;

  /** Constant depth bias, in clip-space depth units (§69); `0` when nothing casts. */
  shadowBias: number;

  /** Normal-space bias, in metres (§69, §40); `0` when nothing casts. */
  shadowNormalBias: number;
}

/** Narrows any value to a {@link DirectionalLightSource} — see `isParticleDrawable`. */
export function isDirectionalLightSource(
  value: unknown,
): value is DirectionalLightSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<DirectionalLightSource>;
  return (
    candidate.isDirectionalLight === true &&
    typeof candidate.getWorldDirection === "function"
  );
}

/**
 * Narrows the render root to an {@link AmbientLightSource}: it must carry an
 * `ambientLight` array of at least three numbers. The element check is on the
 * first component only — one load, like the brand checks — because a root
 * that offers a partially-numeric ambient array is broken in a way §85's
 * development diagnostics own, not this per-frame path.
 */
function isAmbientLightSource(value: unknown): value is AmbientLightSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AmbientLightSource>;
  return (
    Array.isArray(candidate.ambientLight) &&
    candidate.ambientLight.length >= 3 &&
    typeof candidate.ambientLight[0] === "number"
  );
}

/**
 * Narrows any value to a {@link PunctualLightSource} — the point/spot brand,
 * checked exactly as {@link isDirectionalLightSource} checks its own.
 */
export function isPunctualLightSource(
  value: unknown,
): value is PunctualLightSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<PunctualLightSourceBase>;
  return (
    candidate.isPunctualLight === true &&
    typeof candidate.getWorldPosition === "function"
  );
}

/**
 * Allocates a {@link SceneLights} record holding the documented no-light
 * state. Create one per consumer and reuse it every frame (plan D7).
 */
export function createSceneLights(): SceneLights {
  return {
    ambientColor: [0, 0, 0],
    hasDirectionalLight: false,
    direction: new Vector3(0, 0, -1),
    directionalColor: [0, 0, 0],
    punctualCount: 0,
    punctualPositions: new Float32Array(MAX_PUNCTUAL_LIGHTS * 3),
    punctualColors: new Float32Array(MAX_PUNCTUAL_LIGHTS * 3),
    punctualDirections: new Float32Array(MAX_PUNCTUAL_LIGHTS * 3),
    punctualParams: new Float32Array(MAX_PUNCTUAL_LIGHTS * 4),
    hasShadow: false,
    shadowMatrix: new Matrix4(),
    shadowMapSize: 0,
    shadowBias: 0,
    shadowNormalBias: 0,
  };
}

/** Resets `out` to the documented no-light values. */
function clearSceneLights(out: SceneLights): void {
  out.ambientColor[0] = 0;
  out.ambientColor[1] = 0;
  out.ambientColor[2] = 0;
  out.hasDirectionalLight = false;
  out.direction.set(0, 0, -1);
  out.directionalColor[0] = 0;
  out.directionalColor[1] = 0;
  out.directionalColor[2] = 0;
  out.punctualCount = 0;
  // Whole-array fills rather than "clear what the last frame wrote": the dead
  // tail is uploaded along with the live head (one `uniform3fv` per array, no
  // sub-range), so leaving last frame's numbers there would make the upload
  // depend on history and a recorded transcript unreadable.
  out.punctualPositions.fill(0);
  out.punctualColors.fill(0);
  out.punctualDirections.fill(0);
  out.punctualParams.fill(0);
  // §69, and the same argument as the array fills above: the shadow matrix is
  // uploaded whole whenever it is uploaded at all, so leaving last frame's
  // numbers in it would make the upload depend on history. `identity()` costs
  // sixteen stores on a path that already zeroes 104 floats.
  out.hasShadow = false;
  out.shadowMatrix.identity();
  out.shadowMapSize = 0;
  out.shadowBias = 0;
  out.shadowNormalBias = 0;
}

/** Scratch for the world position and axis reads below (plan D7). */
const lightScratch = new Vector3();

/**
 * Roots already warned about a light-set overflow.
 *
 * Keyed on the **root**, not on a module-level flag, so each scene reports its
 * own overflow once and a second scene in the same process still reports its.
 * A `WeakSet` holds no scene alive.
 */
const warnedOverflowRoots = new WeakSet<object>();

/** Punctual lights the current walk *saw*, including any past the bound. */
let walkPunctualFound = 0;

/**
 * Packs one punctual light into the next free slot of `out`.
 *
 * A point light writes its position, its premultiplied colour, and its range;
 * everything else it leaves at the zero {@link clearSceneLights} put there,
 * which is exactly the `w = 0` the fragment stage reads as "no cone". A spot
 * light additionally writes its axis and the two cone scalars.
 */
function writePunctualLight(
  light: PunctualLightSource,
  out: SceneLights,
): void {
  const index = out.punctualCount;
  out.punctualCount = index + 1;
  const vector = index * 3;
  const params = index * 4;

  light.getWorldPosition(lightScratch);
  out.punctualPositions[vector] = lightScratch.x;
  out.punctualPositions[vector + 1] = lightScratch.y;
  out.punctualPositions[vector + 2] = lightScratch.z;

  out.punctualColors[vector] = light.color[0] * light.intensity;
  out.punctualColors[vector + 1] = light.color[1] * light.intensity;
  out.punctualColors[vector + 2] = light.color[2] * light.intensity;

  out.punctualParams[params] = light.range;
  if (light.lightType === "spot") {
    light.getWorldDirection(lightScratch);
    out.punctualDirections[vector] = lightScratch.x;
    out.punctualDirections[vector + 1] = lightScratch.y;
    out.punctualDirections[vector + 2] = lightScratch.z;

    const cosOuter = Math.cos(light.outerConeAngle);
    const cosInner = Math.cos(light.innerConeAngle);
    out.punctualParams[params + 1] = cosOuter;
    // The floor is what makes `inner >= outer` a hard edge instead of a
    // division by zero; see `@four/scene`'s `SpotLight`.
    out.punctualParams[params + 2] = 1 / Math.max(cosInner - cosOuter, 1e-6);
    out.punctualParams[params + 3] = 1;
  }
}

/**
 * One depth-first, insertion-ordered walk (§6) gathering the sun and the
 * light set — `render-list.ts`'s `collect` filtering exactly: `visible` and
 * `enabled` prune **whole subtrees**, so a light under a hidden group does not
 * illuminate, just as a drawable under one does not draw.
 *
 * Unlike the single-light collector this replaces, the walk cannot stop early:
 * a directional light found at the first node says nothing about the point
 * lights further along. That is one extra traversal of the scene per frame
 * *that draws something lit* — the same shape of walk `buildRenderList`
 * already performs, and cheaper per node (two flag loads and two brand loads,
 * no material or geometry access).
 *
 * Punctual lights are written into `out` as they are met; the directional
 * light is **returned** rather than stashed, so "first in scene-graph order"
 * is expressed as "a subtree's answer only counts if everything before it had
 * none" and needs no mutable module state to say so.
 */
function collectFrom(
  node: Node,
  out: SceneLights,
): DirectionalLightSource | null {
  if (!node.visible || !node.enabled) {
    return null;
  }
  let directional: DirectionalLightSource | null = null;
  if (isDirectionalLightSource(node)) {
    directional = node;
  } else if (isPunctualLightSource(node)) {
    walkPunctualFound += 1;
    if (out.punctualCount < MAX_PUNCTUAL_LIGHTS) {
      writePunctualLight(node, out);
    }
  }
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    const found = collectFrom(children[i], out);
    if (directional === null) {
      directional = found;
    }
  }
  return directional;
}

/**
 * Gathers `root`'s lighting into `out` and returns `out` (§68).
 *
 * ```ts
 * const lights = createSceneLights();        // allocated once
 * // per frame, when the render list contains a lit item:
 * collectSceneLights(scene, lights);
 * ```
 *
 * The ambient term is read from the **root only** (see
 * {@link AmbientLightSource}); the directional light is the first one found
 * in scene-graph order, visibility-filtered; the punctual lights are the first
 * {@link MAX_PUNCTUAL_LIGHTS} found in that same order — see the module header
 * for the tier, the ordering rule, and the render-list-identical subtree
 * pruning. A hidden root yields the full no-light state, matching
 * `buildRenderList`'s empty list for a hidden root.
 *
 * Positions and directions are read through `getWorldPosition` /
 * `getWorldDirection`, which resolve the light's own ancestor chain on demand
 * — so the result is correct even before a frame-wide resolve pass, the
 * guarantee `Camera.updateViewMatrix` makes. Neither is **§43-interpolated**
 * (staged, 2026-08-04): a light animated by the simulation reads its last
 * resolved transform, one step behind the interpolated geometry at most — the
 * trade `particles.ts` records for particle positions, made for the same
 * reason.
 *
 * Allocates nothing; every field of `out` is rewritten in place.
 */
export function collectSceneLights(root: Node, out: SceneLights): SceneLights {
  clearSceneLights(out);

  if (!root.visible || !root.enabled) {
    return out;
  }

  if (isAmbientLightSource(root)) {
    out.ambientColor[0] = root.ambientLight[0];
    out.ambientColor[1] = root.ambientLight[1];
    out.ambientColor[2] = root.ambientLight[2];
  }

  walkPunctualFound = 0;
  const light = collectFrom(root, out);
  if (light !== null) {
    out.hasDirectionalLight = true;
    light.getWorldDirection(out.direction);
    out.directionalColor[0] = light.color[0] * light.intensity;
    out.directionalColor[1] = light.color[1] * light.intensity;
    out.directionalColor[2] = light.color[2] * light.intensity;
    // §69 (R-18). The shadow belongs to the *same* light that lights the frame
    // — the first one in scene-graph order — so this is read here rather than
    // in the walk: a second directional light's `castShadow` is ignored exactly
    // as its colour is, and for the same recorded reason (§33: authored order
    // decides, never proximity or brightness).
    //
    // All three members are optional on the contract, so all three are checked:
    // a structurally-typed light double predating §69 offers none of them and
    // resolves to "does not cast", which is what keeps a pre-R-18 scene on the
    // pre-R-18 path.
    const shadow = light.shadow;
    if (
      light.castShadow === true &&
      shadow !== undefined &&
      typeof light.computeShadowMatrix === "function"
    ) {
      out.hasShadow = true;
      light.computeShadowMatrix(out.shadowMatrix);
      out.shadowMapSize = shadow.mapSize;
      out.shadowBias = shadow.bias;
      out.shadowNormalBias = shadow.normalBias;
    }
  }

  if (
    walkPunctualFound > MAX_PUNCTUAL_LIGHTS &&
    !warnedOverflowRoots.has(root)
  ) {
    warnedOverflowRoots.add(root);
    console.warn(
      `[four] ${String(walkPunctualFound)} point and spot lights, but a frame ` +
        `shades with at most ${String(MAX_PUNCTUAL_LIGHTS)} (§68): the first ` +
        "in scene-graph order are used and the rest are skipped. Reorder the " +
        "nodes to choose differently. Further overflows in this scene are " +
        "suppressed.",
    );
  }
  return out;
}
