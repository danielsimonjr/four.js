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
 * ## MVP tier, staged (2026-08-04)
 *
 * Exactly **one** directional light is collected — the first in the
 * depth-first, insertion-ordered walk of §6, the same "first match" rule
 * `Scene.find*` uses — plus the scene ambient term. Further directional
 * lights are ignored (deterministically: scene-graph order decides which one
 * wins, §33). Multi-light, and §68's point/spot/hemisphere/area types, need
 * per-light uniform arrays and the §68 clustered/forward-plus path; they are
 * staged with the dated note in `@four/scene`'s `light.ts`, which also stages
 * shadows (§69) and light layers.
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

import { Vector3 } from "@four/math";
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

  /** Straight RGB in 0…1, no color space attached (§60a deferral). */
  readonly color: readonly [number, number, number];

  /** Scalar multiplier on the color (§68); dimensionless in this tier. */
  readonly intensity: number;

  /**
   * Writes the world-space unit vector the light travels along into `out`
   * and returns it. `@four/scene`'s implementation derives it from the
   * node's world −Z axis; a double supplies whatever the test needs.
   */
  getWorldDirection(out: Vector3): Vector3;
}

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
 * Allocates a {@link SceneLights} record holding the documented no-light
 * state. Create one per consumer and reuse it every frame (plan D7).
 */
export function createSceneLights(): SceneLights {
  return {
    ambientColor: [0, 0, 0],
    hasDirectionalLight: false,
    direction: new Vector3(0, 0, -1),
    directionalColor: [0, 0, 0],
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
}

/**
 * Depth-first search for the first visible, enabled directional light —
 * `render-list.ts`'s `collect` filtering exactly: both flags prune **whole
 * subtrees**, so a light under a hidden group does not illuminate, just as a
 * drawable under one does not draw.
 */
function findDirectionalLight(node: Node): DirectionalLightSource | null {
  if (!node.visible || !node.enabled) {
    return null;
  }
  if (isDirectionalLightSource(node)) {
    return node;
  }
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    const found = findDirectionalLight(children[i]);
    if (found !== null) {
      return found;
    }
  }
  return null;
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
 * in scene-graph order, visibility-filtered — see the module header for the
 * one-light tier and the render-list-identical subtree pruning.
 * A hidden root yields the full no-light state, matching `buildRenderList`'s
 * empty list for a hidden root.
 *
 * The light's direction is read through `getWorldDirection`, which resolves
 * the light's own ancestor chain on demand — so the result is correct even
 * before a frame-wide resolve pass, the guarantee `Camera.updateViewMatrix`
 * makes. Directions are **not** §43-interpolated (staged, 2026-08-04): a
 * light animated by the simulation reads its last resolved transform, one
 * step behind the interpolated geometry at most — the trade `particles.ts`
 * records for particle positions, made for the same reason.
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

  const light = findDirectionalLight(root);
  if (light !== null) {
    out.hasDirectionalLight = true;
    light.getWorldDirection(out.direction);
    out.directionalColor[0] = light.color[0] * light.intensity;
    out.directionalColor[1] = light.color[1] * light.intensity;
    out.directionalColor[2] = light.color[2] * light.intensity;
  }
  return out;
}
