/**
 * `LitMaterial` (§57, §68, §120) — one RGBA color that responds to lights.
 *
 * §120's rendering list names "lighting" as MVP scope, and §68 defines the
 * light set. This is the material half of that tier: a surface shaded as
 *
 * ```text
 * fragment = color.rgb × (sceneAmbient + lightColor × intensity × max(N·−L, 0))
 * ```
 *
 * — Lambert diffuse under §68's directional light plus the scene ambient term,
 * nothing else. §57's family puts `StandardMaterial` (§59's metallic-roughness
 * PBR workflow) above this; `LitMaterial` is the minimal lit member the MVP
 * ships **below** it, exactly as `UnlitMaterial` is the minimal unlit member.
 * §57's family list does not name `LitMaterial` — the addition is recorded as
 * a spec-revisit item (TODO 2026-08-04) rather than silently absorbed.
 * Staged with that dated note, not sketched: per-material specular terms,
 * emissive, maps (§59), shadows (§69), and tone mapping (§60a) all belong to
 * the packets that own those designs.
 *
 * The class deliberately mirrors `UnlitMaterial` member for member — id,
 * version counter, `setColor`, `markDirty`, `dispose` — so the two read as the
 * §57 siblings they are; see that module's headers for the reasoning behind
 * each convention. The one structural addition is {@link LitMaterial.kind},
 * the pipeline discriminant both siblings now carry.
 *
 * ## Color space (§60a)
 *
 * Identical to `UnlitMaterial`, stated once more because lighting is where it
 * starts to matter: the four components are **plain numbers in the documented
 * range 0…1** with no color space attached. §60a makes lighting linear-light
 * on the GPU backends, and the lit pipeline multiplies these numbers as-is —
 * so they are *treated* as linear-light — but the working/output space policy,
 * transfer functions, and tone mapping are a later packet, and tagging a space
 * here would pin half of that design by accident. Values outside 0…1 pass
 * through rather than clamp (the WP-3.3 decision `UnlitMaterial` records);
 * non-finite components are rejected (§85).
 */

import type { Disposable } from "@four/core";

import type { ColorRGBA } from "./unlit-material.js";

/** Construction arguments of {@link LitMaterial}. */
export interface LitMaterialOptions {
  /**
   * Initial color, copied into the material's own array. Defaults to opaque
   * white `[1, 1, 1, 1]`, so an untinted material shows the lighting alone.
   */
  color?: readonly [number, number, number, number];
}

/**
 * Source of lit-material ids. Monotonic and process-wide — §33 forbids random
 * or clock-derived identity. A separate counter from `UnlitMaterial`'s (that
 * one is module-private); the `lit-material-<n>` prefix keeps the two id
 * spaces from colliding.
 */
let nextLitMaterialId = 1;

function assignLitMaterialId(): string {
  const id = `lit-material-${String(nextLitMaterialId)}`;
  nextLitMaterialId += 1;
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
 * A material shaded by the scene's lights: Lambert diffuse plus the scene
 * ambient term (§57, §68).
 *
 * ```ts
 * const material = new LitMaterial({ color: [1, 0.4, 0, 1] });
 * material.setColor(0, 0.6, 1);   // alpha defaults back to opaque
 * material.dispose();             // §83: explicit lifetime
 * ```
 *
 * A `Renderable` carrying one produces a `"lit"` render item and draws through
 * the lit pipeline; with no directional light in the scene it shades from the
 * ambient term alone, and with a black (default) ambient it renders black —
 * lights are part of the scene, not of the material. A geometry without a
 * `normals` attribute also shades ambient-only (see `BufferGeometry.normals`).
 *
 * Materials are **shared, not owned by nodes**: any number of `Renderable`s may
 * point at one, and disposing it is the job of whoever created it (§83).
 */
export class LitMaterial implements Disposable {
  /** Pipeline discriminant (§57, §64) — see `UnlitMaterial.kind`. */
  readonly kind = "lit" as const;

  /**
   * Stable identity (§57 inherits §83's resource model), formatted
   * `lit-material-<n>` — unique within a process, ascending in construction
   * order, never reused.
   */
  readonly id: string = assignLitMaterialId();

  /**
   * Straight RGBA in 0…1; opaque white by default. The array instance is
   * `readonly` — write *into* it — for the reason `UnlitMaterial.color`
   * documents: a backend may keep a reference to it. Use
   * {@link LitMaterial.setColor}, or write components directly and call
   * {@link LitMaterial.markDirty}.
   */
  readonly color: ColorRGBA;

  #version = 0;

  #disposed = false;

  constructor(options: LitMaterialOptions = {}) {
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
   * `UnlitMaterial.version`. Monotonic, never wraps in a realistic session.
   */
  get version(): number {
    return this.#version;
  }

  /** Whether {@link LitMaterial.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Writes the color and bumps {@link LitMaterial.version} once. Returns
   * `this` for chaining (§7b). `alpha` defaults to `1` rather than to the
   * current alpha, for the reason `UnlitMaterial.setColor` documents.
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
   * {@link LitMaterial.color}. Bumps the version by one. Calling it after
   * `setColor` is harmless, only wasteful.
   */
  markDirty(): void {
    this.#version += 1;
  }

  /**
   * Releases this material (§83). Idempotent. Marks
   * {@link LitMaterial.disposed} and bumps the version — nothing GPU-side to
   * free from here, and the color array is kept, for the reasons
   * `UnlitMaterial.dispose` documents.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.markDirty();
  }
}
