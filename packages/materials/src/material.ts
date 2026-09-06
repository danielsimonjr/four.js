/**
 * `Material` (§57) — the abstract base every material family member extends,
 * and the render state they all share.
 *
 * §57 puts one abstract class at the root of the material family
 * (`ShapeMaterial`, `SpriteMaterial`, `TextMaterial`, `LineMaterial`,
 * `UnlitMaterial`, `StandardMaterial`, `PhysicalMaterial`, `ShaderMaterial`,
 * `NodeMaterial`, `ComputeMaterial`) carrying
 *
 * ```ts
 * opacity: number;
 * transparent: boolean;
 * blendMode: BlendMode;
 * depthTest: boolean;
 * depthWrite: boolean;
 * colorWrite: boolean;
 * stencil?: StencilState;
 * dispose(): void;
 * ```
 *
 * WP-3.3 deliberately deferred this class — every field of it is render state
 * whose meaning is fixed by the backend that translates it into draw-time
 * calls, and the backend packet had not been written. It has been since
 * (`@four/render-webgl`), so the base landed here (2026-08-06) with six of
 * §57's seven members; the seventh, `stencil`, joined them on 2026-08-11 (R-7).
 *
 * ## What lives here, and what does not
 *
 * The base owns the state that is meaningful for *every* material: identity,
 * the version counter backends cache against, disposal, and the six render-state
 * fields. It owns **no colour**: `UnlitMaterial.color`, `LitMaterial.color`, and
 * `SpriteMaterial.tint` differ in meaning (a surface colour, a lit albedo, a
 * multiplier over a texel) and in count, and hoisting them would make the base
 * assert a shading model it does not have.
 *
 * ## Defaults are today's behaviour, exactly (decision, R-12/R-11)
 *
 * Every default below reproduces the frame the backend drew before this class
 * existed: `transparent: false` leaves blending off, `depthTest`/`depthWrite`/
 * `colorWrite` are the fixed GL state the backend already sets once at
 * initialization, `opacity: 1` multiplies alpha to no change, and `blendMode:
 * "normal"` is the straight-alpha `SRC_ALPHA`/`ONE_MINUS_SRC_ALPHA` function
 * the backend fixes at initialization (§66). A scene that names none of them
 * therefore renders byte-identically to one authored before the base landed —
 * which is the property that let this land under the pixel-golden gate.
 *
 * The one asymmetry worth stating: the sprite and particle pipelines blend
 * **by construction** and did so before `transparent` existed, so they still
 * do. `SpriteMaterial` therefore ships `transparent: false` — its pipeline
 * blends anyway — and the flag decides only where §66's sort key 2 places it.
 * Reclassifying those two pipelines as transparent is a *sorting* change and is
 * recorded as a follow-up (2026-08-06), not smuggled in here.
 *
 * ## Render state is read, not cached (decision, R-12)
 *
 * The six fields do **not** bump {@link Material.version}. A backend reads them
 * once per draw, where it is already deciding what to bind — there is nothing
 * to invalidate, so there is nothing to announce. {@link Material.markDirty}
 * stays what it always was: the announcement that a *colour array* was written
 * in place.
 *
 * **Amended 2026-08-07 (F14).** This section used to open "The six fields are
 * plain mutable properties", and the "a per-field setter would cost every
 * material an accessor to protect state nobody caches" clause was read as
 * covering *validation* too. It did not: the constructor rejected a non-finite
 * `opacity` (§85) and then exposed a writable field, so `material.opacity =
 * NaN` walked straight into the backend's `uniform4fv` and painted a scene
 * black with no diagnosable cause. {@link Material.opacity} and
 * {@link Material.blendMode} are therefore accessors that apply **the same
 * validation on assignment that the constructor applies**, matching
 * `UnlitMaterial.setColor`'s validate-before-write discipline. The other four
 * fields stay plain properties: they are booleans, a boolean has no invalid
 * value to reject, and the backend reads them as `!== false` anyway.
 *
 * The *version* half of the decision is unchanged and deliberate: neither
 * accessor calls {@link Material.markDirty}. Nothing caches render state — the
 * backend re-reads it per draw — so there is still nothing to invalidate, and
 * bumping would invalidate the geometry and texture bindings that *are* cached
 * against this counter for no reason.
 *
 * ## `stencil` landed 2026-08-11 (§67, R-7)
 *
 * This section used to say `stencil?: StencilState` was *staged*, because the
 * WebGL 2 backend acquired its context with `stencil: false` and there was no
 * buffer to configure. Both halves moved together in R-7: `StencilState` is
 * `stencil-state.ts`, the backend applies it per draw against a CPU mirror at
 * GL's initial values, and a stencil buffer is allocated where — and only
 * where — a renderer or a render target asks for one.
 *
 * The base is therefore **§57 complete**: seven members, of which six are
 * unconditional and the seventh is the optional one §57 declares optional.
 * `undefined` is its default and means what it meant before the field existed —
 * the stencil test stays disabled and the frame issues no stencil call at all.
 *
 * What is *still* staged is §67's clipping API, and `stencil-state.ts` says why
 * at length: a `clip()` is a scene-graph design (inheritance down a subtree,
 * nesting, bit-plane assignment, the limits diagnostic), not a state record.
 * This is the substrate it will be expressed in.
 */

import type { Disposable } from "@four/core";

import {
  noteMaterial,
  releaseMaterialDisposable,
  trackMaterialDisposable,
} from "./resource-memory.js";

// **Type-only**, deliberately (R-7): `Material` never *constructs* a
// `StencilState`, so a bundle whose scenes never mask does not carry the class
// at all. See {@link Material.stencil} for what makes that safe.
import type { StencilState } from "./stencil-state.js";

/**
 * How a transparent material's fragments combine with what is already in the
 * colour buffer (§57, §66).
 *
 * Four modes, chosen because each is one blend *function* over straight
 * (non-premultiplied) alpha — the policy §66 requires the engine to state and
 * this tier commits to — and therefore reachable on every backend the
 * specification names, WebGL 2 included:
 *
 * | mode         | source × | destination ×       | reads as            |
 * | ------------ | -------- | ------------------- | ------------------- |
 * | `"normal"`   | `SRC_ALPHA` | `ONE_MINUS_SRC_ALPHA` | ordinary alpha blending |
 * | `"additive"` | `SRC_ALPHA` | `ONE`               | light, glow, fire   |
 * | `"multiply"` | `DST_COLOR` | `ZERO`             | shadow, tint, stain |
 * | `"screen"`   | `ONE`    | `ONE_MINUS_SRC_COLOR` | haze, bloom-ish lift |
 *
 * A string union rather than an enum, matching `TransformAuthority`,
 * `RendererBackend`, and `RenderItemKind`: it serializes, logs, and compares as
 * itself. The mode is honoured only while a material actually blends — see
 * {@link Material.transparent}.
 */
export type BlendMode = "normal" | "additive" | "multiply" | "screen";

/**
 * The §57 render state every material constructor accepts, on top of whatever
 * its own family member adds.
 *
 * Every field is optional and every default is documented on the property it
 * initializes — see {@link Material}.
 */
export interface MaterialOptions {
  /** Initial {@link Material.opacity}; defaults to 1 (fully opaque). */
  opacity?: number;
  /** Initial {@link Material.transparent}; defaults to `false`. */
  transparent?: boolean;
  /** Initial {@link Material.blendMode}; defaults to `"normal"`. */
  blendMode?: BlendMode;
  /** Initial {@link Material.depthTest}; defaults to `true`. */
  depthTest?: boolean;
  /** Initial {@link Material.depthWrite}; defaults to `true`. */
  depthWrite?: boolean;
  /** Initial {@link Material.colorWrite}; defaults to `true`. */
  colorWrite?: boolean;
  /**
   * Initial {@link Material.stencil}; defaults to `undefined` (no stencil
   * test). A `StencilState`, which validates itself at construction.
   */
  stencil?: StencilState;
}

/**
 * Source of material ids, shared by the whole family.
 *
 * Monotonic and process-wide, like `Node`'s and `BufferGeometry`'s — §33
 * forbids random or clock-derived identity. **One** counter for every subclass,
 * which is the id-space merge `sprite-material.ts` predicted: two counters
 * behind two prefixes could never collide, but one counter behind one prefix
 * per family member cannot collide *and* cannot be got wrong by a subclass
 * author who forgets to pick a new prefix.
 */
let nextMaterialId = 1;

/** Rejects a non-finite scalar (§85). */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Material ${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/**
 * §57's four blend modes as a runtime list — the type erases at compile time,
 * and {@link Material.blendMode} is assignable from outside TypeScript.
 */
const BLEND_MODES: readonly BlendMode[] = [
  "normal",
  "additive",
  "multiply",
  "screen",
];

/**
 * Rejects a value outside {@link BlendMode}.
 *
 * The backend indexes a four-entry table with this string (`@four/render-webgl`,
 * `BLEND_FUNCTIONS`), so an unknown mode has to fail here, where the assignment
 * that caused it is on the stack, rather than at draw time inside a frame.
 */
function requireBlendMode(value: BlendMode): BlendMode {
  if (!BLEND_MODES.includes(value)) {
    throw new RangeError(
      `Material blendMode must be one of ${BLEND_MODES.join(", ")}; ` +
        `got ${String(value)} (§57).`,
    );
  }
  return value;
}

/**
 * The root of §57's material family: identity, lifetime, and shared render
 * state.
 *
 * ```ts
 * class GlowMaterial extends Material {
 *   readonly kind = "glow" as const;
 *   constructor(options: MaterialOptions = {}) {
 *     super("glow-material", { transparent: true, blendMode: "additive", ...options });
 *   }
 * }
 * ```
 *
 * Abstract because it shades nothing on its own; a family member supplies the
 * {@link Material.kind} discriminant a render list dispatches on and whatever
 * colour, texture, or program it needs.
 *
 * Materials are **shared, not owned by nodes** (§83): any number of drawables
 * may point at one, and disposing it is the job of whoever created it.
 */
export abstract class Material implements Disposable {
  /**
   * Pipeline discriminant (§57, §64, §66 sort key 3) — `"unlit"`, `"lit"`,
   * `"sprite"`, and whatever a later family member declares.
   *
   * A literal string on each subclass, not an `instanceof` check: the render
   * list picks an item's pipeline with **one property load**, which is what
   * §64's "compact render items" require and what lets a structurally-typed
   * test double stand in for a material at all.
   */
  abstract readonly kind: string;

  /**
   * Stable identity (§57 inherits §83's resource model), assigned at
   * construction from the family-wide monotonic counter and prefixed by the
   * subclass — `material-7`, `lit-material-8`, `sprite-material-9`. Unique
   * within a process, ascending in construction order, never reused.
   */
  readonly id: string;

  /**
   * Uniform transparency multiplier over the material's own alpha (§57),
   * nominally in 0…1 and **1 by default**.
   *
   * The alpha a backend uploads is `color[3] × opacity` (`tint[3] × opacity`
   * for a sprite), so the two compose rather than compete: a shared material's
   * authored alpha stays where the artist put it and `opacity` is the knob an
   * animation or a fade-out drives. At the default `1` the product is the
   * authored alpha unchanged, bit for bit.
   *
   * Like the colour components, values outside 0…1 pass through rather than
   * clamp (the WP-3.3 decision `UnlitMaterial` records); non-finite values are
   * rejected (§85) — **on every assignment, not only at construction** (F14,
   * 2026-08-07; see the module header). A rejected write leaves the previous
   * opacity in place, exactly as a rejected `setColor` leaves the previous
   * colour. Assigning does **not** bump {@link Material.version}: render state
   * is read per draw, never cached.
   *
   * **Opacity alone does not make a material blend** — set
   * {@link Material.transparent} too, or the alpha is written into the colour
   * buffer without being blended against it.
   */
  get opacity(): number {
    return this.#opacity;
  }

  set opacity(value: number) {
    this.#opacity = requireFinite("opacity", value);
  }

  /**
   * Whether this material's fragments are **blended** with the colour buffer
   * (§57, §66); `false` by default.
   *
   * Two consequences, both stated because a flag that quietly did one of them
   * would be the defect this replaced:
   *
   * 1. the backend enables blending for the draw and applies
   *    {@link Material.blendMode}. With `false` — the default — blending stays
   *    off and the material's alpha is written to the buffer unblended, which
   *    is exactly what every scene authored before this flag existed did;
   * 2. §66's sort key 2 places transparent items **after** opaque ones inside
   *    their render layer, so a blended surface composites over what it
   *    overlaps instead of racing it in scene order.
   *
   * Transparency is a property of the *material*, not of its alpha: an alpha of
   * 0.5 on an opaque material is a deliberate way to write a half-alpha pixel
   * into the framebuffer (for compositing the canvas with the page), and
   * inferring `transparent` from it would take that away and make an
   * animated alpha change the sort order mid-frame.
   */
  transparent: boolean;

  /**
   * How blended fragments combine with the buffer (§57, §66); `"normal"` — the
   * straight-alpha blend — by default. Read only while
   * {@link Material.transparent} is `true`, except on pipelines that blend by
   * construction (sprites, particles), where it always applies.
   *
   * A value outside {@link BlendMode} is rejected on assignment as well as at
   * construction (F14, 2026-08-07): the type is gone at runtime, and a backend
   * that meets an unknown mode can only guess. Assigning does **not** bump
   * {@link Material.version}.
   */
  get blendMode(): BlendMode {
    return this.#blendMode;
  }

  set blendMode(value: BlendMode) {
    this.#blendMode = requireBlendMode(value);
  }

  /**
   * Whether fragments are tested against the depth buffer (§57); `true` by
   * default, which is the fixed state the backend sets at initialization.
   *
   * `false` draws the material over everything already in the buffer, whatever
   * its depth — the "always front" overlay case §49's `depthMode` will
   * generalise.
   */
  depthTest: boolean;

  /**
   * Whether fragments **write** depth (§57); `true` by default.
   *
   * The usual setting for a transparent surface is `depthWrite: false` with
   * `depthTest: true`: it is occluded by opaque geometry in front of it but
   * does not occlude the transparent surfaces drawn after it, which is what
   * keeps a stack of blended quads from punching holes in each other.
   */
  depthWrite: boolean;

  /**
   * Whether fragments write colour at all (§57); `true` by default. `false`
   * draws the material into the depth buffer only — a depth-prepass or an
   * occluder, visible to the depth test and to nothing else.
   */
  colorWrite: boolean;

  /**
   * §57's optional stencil state (§67); `undefined` by default, which leaves
   * the stencil test disabled — GL's initial state, and the state every frame
   * this engine drew before R-7 ran in.
   *
   * ```ts
   * material.stencil = new StencilState({ func: "equal", ref: 1, writeMask: 0 });
   * ```
   *
   * A **plain property**, like the four booleans above and unlike
   * {@link Material.opacity}, and the F14 rule is satisfied a different way:
   * every field of a `StencilState` is validated by the class itself, on
   * construction and on every later write, and the class is *nominal* — its
   * fields are private, so an object literal is not assignable to it. A caller
   * therefore cannot reach the backend with an unchecked comparison name
   * without going through a validating constructor, and this property has
   * nothing left to check.
   *
   * That is also what keeps it free. The import above is type-only, so a
   * bundle whose scenes never mask does not carry `StencilState` — masking
   * costs bytes only where it is used, which a validating accessor here would
   * have made impossible (measured 2026-08-11 over four example bundles:
   * 0.62 kB gzip each, which is 42% of what the whole packet costs them).
   *
   * Like the rest of §57's render state, assigning does **not** bump
   * {@link Material.version}: a backend re-reads it per draw and caches none of
   * it. Mutating the `StencilState` in place is therefore live too, with no
   * announcement needed — and two materials may share one record, which is how
   * the two passes of one mask stay in step.
   *
   * A backend that cannot allocate a stencil buffer honours this by drawing
   * without the mask, never by failing the frame (§61) — see
   * `@four/render-webgl`'s `RendererOptions.stencil`.
   */
  stencil: StencilState | undefined;

  /**
   * Backing fields for the two validated accessors. Seeded with the documented
   * defaults so the constructor can assign *through* the setters — one copy of
   * each rule, checked wherever the value arrives from.
   */
  #opacity = 1;

  #blendMode: BlendMode = "normal";

  #version = 0;

  #disposed = false;

  /**
   * Initializes the shared state. `idPrefix` names the family member and
   * becomes the leading part of {@link Material.id}, e.g. `"sprite-material"`.
   *
   * `protected` because a bare `Material` shades nothing: a subclass calls it,
   * a caller never does.
   */
  protected constructor(idPrefix: string, options: MaterialOptions = {}) {
    this.id = `${idPrefix}-${String(nextMaterialId)}`;
    nextMaterialId += 1;
    // Through the setters: the validation lives in one place and applies to
    // the option and to every later write alike (F14, 2026-08-07).
    this.opacity = options.opacity ?? 1;
    this.transparent = options.transparent ?? false;
    this.blendMode = options.blendMode ?? "normal";
    this.depthTest = options.depthTest ?? true;
    this.depthWrite = options.depthWrite ?? true;
    this.colorWrite = options.colorWrite ?? true;
    // `undefined` in the overwhelmingly common case, which is what leaves the
    // stencil test disabled and the frame's GL sequence unchanged.
    this.stencil = options.stencil;
    noteMaterial(1);
    trackMaterialDisposable(this, this.id);
  }

  /**
   * Counter incremented on every announced mutation. Backends cache uniform
   * uploads and texture bindings against it; treat it as opaque and compare for
   * inequality, exactly like `Transform.version`. Monotonic, never wraps in a
   * realistic session.
   *
   * It tracks **colour and resource** edits, not render state — see the module
   * header for why the six §57 fields do not bump it.
   */
  get version(): number {
    return this.#version;
  }

  /** Whether {@link Material.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Announces a mutation the material could not see — a direct write into a
   * colour array. Bumps the version by one. Calling it after a setter that
   * already bumped is harmless, only wasteful.
   */
  markDirty(): void {
    this.#version += 1;
  }

  /**
   * Releases this material (§83). Idempotent.
   *
   * There is nothing GPU-side to free from here — the backend owns the pipeline
   * and uniform buffers built from this material and drops them when it sees
   * the material disposed — so this marks {@link Material.disposed} and bumps
   * the version, which is what invalidates those backend caches. Colour arrays
   * and texture references are kept: clearing them would turn a
   * use-after-dispose bug into a silently black frame instead of a diagnosable
   * one (§83's "disposed resources still in use" warning).
   *
   * It **does** remove this material from the process-wide §83 live-instance
   * total (`liveMaterialCount`), exactly once: the idempotence guard above is
   * what makes a double `dispose()` subtract once rather than twice.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    noteMaterial(-1);
    releaseMaterialDisposable(this);
    this.markDirty();
  }
}
