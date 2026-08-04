/**
 * `UnlitMaterial` (§57) — a flat RGBA color, and nothing else.
 *
 * §57 defines a `Material` family (`ShapeMaterial`, `SpriteMaterial`,
 * `TextMaterial`, `LineMaterial`, `UnlitMaterial`, `StandardMaterial`,
 * `PhysicalMaterial`, `ShaderMaterial`, `NodeMaterial`, `ComputeMaterial`) over
 * an abstract base carrying `opacity`, `transparent`, `blendMode`, `depthTest`,
 * `depthWrite`, `colorWrite`, and an optional `stencil`. The §120 MVP renders
 * "unlit colored geometry" with WebGL 2, so this packet implements the one
 * family member that tier needs and **does not** introduce the abstract base:
 *
 * - every field of §57's base is a piece of render state the backend has to
 *   translate into GL calls, and the packet that writes those calls (WP-3.5) is
 *   the one that can say what each of them means for a WebGL 2 pipeline;
 * - an abstract class with a single subclass constrains nothing and would have
 *   to be re-opened anyway when `ShapeMaterial` and `StandardMaterial` arrive.
 *
 * `Renderable.material` (`@four/render`) is therefore typed as `UnlitMaterial`
 * for now, and widens to `Material | Material[]` (§49) when the base lands. The
 * deferral is deliberate and reported as a WP-3.3 decision.
 *
 * ## Version, not events
 *
 * Backends cache uniform uploads and pipeline state per material, keyed on
 * {@link UnlitMaterial.version} — the same contract `BufferGeometry.version`
 * and `Transform.version` offer. {@link UnlitMaterial.setColor} bumps it;
 * writing a component in place does not, and must be announced:
 *
 * ```ts
 * material.setColor(1, 0, 0);  // version += 1
 * material.color[3] = 0.5;     // in-place edit — invisible to the material
 * material.markDirty();        // announce it: version += 1
 * ```
 *
 * ## Color space (§60a)
 *
 * The four components are **plain numbers in the documented range 0…1**, with
 * no color space attached: §60a's working/output space policy, transfer
 * functions, and tone mapping are a later packet, and tagging a space here
 * would pin half of that design by accident. Values outside 0…1 are passed
 * through rather than clamped (decision, WP-3.3) — clamping would silently
 * rewrite authored data, and extended-range colors are exactly what §60a will
 * need to carry — but non-finite components are rejected (§85).
 */

import type { Disposable } from "@four/core";
import type { ColorRGBA } from "@four/math";

/**
 * Straight (non-premultiplied) RGBA, each component nominally in 0…1 —
 * `@four/math`'s {@link ColorRGBA}, re-exported (hoisted 2026-08-04;
 * `@four/animation` tweens the same tuple and §3.1 has no edge between the
 * two packages).
 *
 * A mutable 4-tuple rather than a `Vector4`: a color is not a geometric vector
 * (adding two colors is not a transform, and none of `Vector4`'s dot/normalize
 * surface means anything here), and a plain array uploads to
 * `uniform4fv`/`Float32Array.set` without an adapter.
 */
export type { ColorRGBA } from "@four/math";

/** Construction arguments of {@link UnlitMaterial}. */
export interface UnlitMaterialOptions {
  /**
   * Initial color, copied into the material's own array. Defaults to opaque
   * white `[1, 1, 1, 1]`, so an untinted material multiplies to no change.
   */
  color?: readonly [number, number, number, number];
}

/**
 * Source of material ids. Monotonic and process-wide, like `Node`'s and
 * `BufferGeometry`'s — §33 forbids random or clock-derived identity.
 */
let nextMaterialId = 1;

function assignMaterialId(): string {
  const id = `material-${String(nextMaterialId)}`;
  nextMaterialId += 1;
  return id;
}

/** Rejects non-finite color components (§85). */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Color component ${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/**
 * A material that shades every fragment with one color, ignoring lights (§57).
 *
 * ```ts
 * const material = new UnlitMaterial({ color: [1, 0.4, 0, 1] });
 * material.setColor(0, 0.6, 1);   // alpha defaults back to opaque
 * material.dispose();             // §83: explicit lifetime
 * ```
 *
 * Materials are **shared, not owned by nodes**: any number of `Renderable`s may
 * point at one, and disposing it is the job of whoever created it (§83).
 */
export class UnlitMaterial implements Disposable {
  /**
   * Stable identity (§57 inherits §83's resource model), assigned at
   * construction from a monotonic counter and formatted `material-<n>`. Unique
   * within a process, ascending in construction order, never reused.
   */
  readonly id: string = assignMaterialId();

  /**
   * Straight RGBA in 0…1; opaque white by default.
   *
   * The array instance is `readonly` — write *into* it — for the reason
   * `Transform`'s math members are: a backend may keep a reference to it, and
   * replacing the array wholesale would leave that reference pointing at the
   * old color forever. Use {@link UnlitMaterial.setColor}, or write components
   * directly and call {@link UnlitMaterial.markDirty}.
   */
  readonly color: ColorRGBA;

  #version = 0;

  #disposed = false;

  constructor(options: UnlitMaterialOptions = {}) {
    const color = options.color ?? [1, 1, 1, 1];
    this.color = [
      requireFinite("red", color[0]),
      requireFinite("green", color[1]),
      requireFinite("blue", color[2]),
      requireFinite("alpha", color[3]),
    ];
  }

  /**
   * Counter incremented on every mutation. Backends cache uniform uploads
   * against it; treat it as opaque and compare for inequality, exactly like
   * `Transform.version`. Monotonic, never wraps in a realistic session.
   */
  get version(): number {
    return this.#version;
  }

  /** Whether {@link UnlitMaterial.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Writes the color and bumps {@link UnlitMaterial.version} once. Returns
   * `this` for chaining, following the math types' mutate-and-return convention
   * (§7b).
   *
   * `alpha` defaults to `1` rather than to the current alpha: the three-argument
   * form reads as "make it this color", and silently inheriting a previous
   * transparency would make the same call mean different things at different
   * times.
   */
  setColor(red: number, green: number, blue: number, alpha = 1): this {
    this.color[0] = requireFinite("red", red);
    this.color[1] = requireFinite("green", green);
    this.color[2] = requireFinite("blue", blue);
    this.color[3] = requireFinite("alpha", alpha);
    this.markDirty();
    return this;
  }

  /**
   * Announces a mutation the material could not see — a direct write into
   * {@link UnlitMaterial.color}. Bumps the version by one. Calling it after
   * `setColor` is harmless, only wasteful.
   */
  markDirty(): void {
    this.#version += 1;
  }

  /**
   * Releases this material (§83). Idempotent.
   *
   * There is nothing GPU-side to free from here — the backend owns the pipeline
   * and uniform buffers built from this material and drops them when it sees
   * the material disposed — so this marks {@link UnlitMaterial.disposed} and
   * bumps the version, which is what invalidates those backend caches. The
   * color array is kept: it is four numbers, and clearing it would turn a
   * use-after-dispose bug into a silently black frame instead of a diagnosable
   * one (§83's "disposed resources still in use" warning).
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.markDirty();
  }
}
