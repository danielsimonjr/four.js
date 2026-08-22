/**
 * `StencilState` (§57, §67) — the per-material stencil test, write mask, and
 * pass/fail operations, and the validation that keeps them out of a frame.
 *
 * §57 declares one optional member on the material base:
 *
 * ```ts
 * stencil?: StencilState;
 * ```
 *
 * and §67 says what it is *for*: stencil masks, nested clipping, UI overflow
 * clipping — "draw a shape into the stencil buffer, then let only the fragments
 * that agree with it reach the colour buffer". This module is that record and
 * nothing more.
 *
 * ## What this is, and what it deliberately is not (decision, R-7, 2026-08-11)
 *
 * A `StencilState` is **render state**, in exactly the sense §57's other six
 * members are: a description of how the fixed-function stage should be
 * configured for the draws that use this material. It is the substrate §67's
 * masks are built *on*.
 *
 * It is not a clipping API. §67 also asks for rectangular scissor clipping,
 * path masks, alpha masks, nested clipping with a defined overflow behaviour,
 * and 3D clip planes — and none of those is a state record. A `clip()` on a
 * node is a *scene-graph* design: it has to decide what a clip inherits down a
 * subtree, how two nested clips intersect, which stencil **bit plane** each
 * nesting level owns, and what happens when the eight planes of an 8-bit buffer
 * run out (§67's "diagnostics when backend limits are exceeded"). That packet
 * needs a node-level API, a render-list pass that assigns bit planes, and a
 * `@four/scene` edit. Landing this record without it is the honest half: with
 * it, an application can compose a mask by hand today — write with one
 * material, test with another — and the clip API, when it comes, will be
 * *expressed* in these records rather than inventing a second stencil path.
 *
 * `tests/browser/stencil.spec.ts` is that composition on a real driver, and it
 * is what makes this tier a demonstration rather than a declaration.
 *
 * ## A class, not an object literal (decision, R-7)
 *
 * `StencilState` is nominal — its fields are private — so an object literal is
 * not assignable to `Material.stencil` and a caller reaches the backend only
 * through the constructor below. That is what lets `material.ts` import this
 * module **type-only**: a bundle whose scenes never mask does not carry this
 * class at all, so §67's substrate costs bytes exactly where it is used. A
 * `Material.stencil` accessor that normalized a literal would have been more
 * ergonomic and would have made that impossible (measured 2026-08-11:
 * 0.62 kB gzip in every bundle carrying a material, masked or not).
 *
 * ## Refuse, do not clamp (§85)
 *
 * Every value here is validated on assignment as well as at construction — the
 * F14 rule, for the F14 reason: the backend indexes a fixed table with these
 * names and hands the numbers straight to `stencilFunc`/`stencilOp`, and §61
 * forbids throwing inside a frame. An unknown comparison name or a reference
 * value the buffer cannot hold has to fail where the assignment that caused it
 * is on the stack.
 *
 * The reference and the two masks are integers in **0…255**, and that is a
 * refusal rather than a clamp on purpose. WebGL 2 has exactly two stencil
 * formats — `STENCIL_INDEX8` and `DEPTH24_STENCIL8` — so every stencil buffer
 * this engine can allocate is 8 bits deep, and GL *silently* masks a larger
 * reference down to those bits. A `ref: 256` that quietly becomes `0` is the
 * defect §85 exists to prevent: it does not draw wrong pixels loudly, it draws
 * a mask that never matches.
 */

/**
 * The comparison a fragment's reference value makes against the stencil buffer
 * (§67), spelled as §57's other vocabularies are — a string union, not an enum,
 * so it serializes, logs, and compares as itself.
 *
 * The test is `(ref & readMask) OP (stored & readMask)`, in that order: `"less"`
 * passes where the **reference** is less than what is stored.
 *
 * | value         | passes when                   | the mask idiom it serves |
 * | ------------- | ----------------------------- | ------------------------ |
 * | `"never"`     | never                         | write-only passes, with `failOp` |
 * | `"less"`      | `ref < stored`                | nesting depth comparisons |
 * | `"equal"`     | `ref === stored`              | **the mask test** — draw only inside the mask |
 * | `"lequal"`    | `ref <= stored`               | draw inside a mask of at least this depth |
 * | `"greater"`   | `ref > stored`                | the outside of a nested clip |
 * | `"notequal"`  | `ref !== stored`              | **the inverse mask** — draw only outside it |
 * | `"gequal"`    | `ref >= stored`               | the complement of `"less"` |
 * | `"always"`    | always                        | writing the mask itself (the default) |
 */
export type StencilFunc =
  | "never"
  | "less"
  | "equal"
  | "lequal"
  | "greater"
  | "notequal"
  | "gequal"
  | "always";

/**
 * What happens to the stored stencil value at one of the three outcomes of a
 * fragment (§67).
 *
 * `"increment"` and `"decrement"` **saturate** at 0 and 255; the `-wrap` forms
 * wrap modulo 256. Saturating is the right default for nested clipping — a
 * depth counter that wrapped past 255 would silently re-enter the region it was
 * supposed to have left — and the wrapping forms are named because a
 * bit-plane-parity mask wants them.
 */
export type StencilOp =
  | "keep"
  | "zero"
  | "replace"
  | "increment"
  | "increment-wrap"
  | "decrement"
  | "decrement-wrap"
  | "invert";

/**
 * What a {@link StencilState} is asked for. Every field is optional and every
 * default is GL's own initial state, so `new StencilState()` describes a
 * material that *enables the stencil test and changes nothing* — see
 * {@link StencilState}.
 */
export interface StencilStateOptions {
  /** Initial {@link StencilState.func}; defaults to `"always"`. */
  func?: StencilFunc;
  /** Initial {@link StencilState.ref}; defaults to 0. */
  ref?: number;
  /** Initial {@link StencilState.readMask}; defaults to `0xff`. */
  readMask?: number;
  /** Initial {@link StencilState.writeMask}; defaults to `0xff`. */
  writeMask?: number;
  /** Initial {@link StencilState.failOp}; defaults to `"keep"`. */
  failOp?: StencilOp;
  /** Initial {@link StencilState.depthFailOp}; defaults to `"keep"`. */
  depthFailOp?: StencilOp;
  /** Initial {@link StencilState.passOp}; defaults to `"keep"`. */
  passOp?: StencilOp;
}

/** §67's eight comparisons as a runtime list — the type erases at compile time. */
const STENCIL_FUNCS: readonly StencilFunc[] = [
  "never",
  "less",
  "equal",
  "lequal",
  "greater",
  "notequal",
  "gequal",
  "always",
];

/** §67's eight operations as a runtime list, for {@link STENCIL_FUNCS}' reason. */
const STENCIL_OPS: readonly StencilOp[] = [
  "keep",
  "zero",
  "replace",
  "increment",
  "increment-wrap",
  "decrement",
  "decrement-wrap",
  "invert",
];

/**
 * The largest value an 8-bit stencil buffer can hold, and therefore the largest
 * reference or mask this engine accepts — see the module header for why this is
 * a refusal and not a clamp.
 */
export const MAX_STENCIL_VALUE = 0xff;

/** Rejects a value outside {@link StencilFunc} (§85). */
function requireFunc(value: StencilFunc): StencilFunc {
  if (!STENCIL_FUNCS.includes(value)) {
    throw new RangeError(
      `StencilState func must be one of ${STENCIL_FUNCS.join(", ")}; ` +
        `got ${String(value)} (§67).`,
    );
  }
  return value;
}

/** Rejects a value outside {@link StencilOp} (§85). */
function requireOp(name: string, value: StencilOp): StencilOp {
  if (!STENCIL_OPS.includes(value)) {
    throw new RangeError(
      `StencilState ${name} must be one of ${STENCIL_OPS.join(", ")}; ` +
        `got ${String(value)} (§67).`,
    );
  }
  return value;
}

/**
 * Rejects a reference or mask that is not an integer in 0…255 (§85).
 *
 * `Number.isInteger` covers `NaN`, both infinities, and `1.5` in one predicate;
 * the range covers the silent-truncation case the module header describes.
 */
function requireStencilValue(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_STENCIL_VALUE) {
    throw new RangeError(
      `StencilState ${name} must be an integer in 0…${String(
        MAX_STENCIL_VALUE,
      )}; got ${String(value)} (§85: every stencil buffer WebGL 2 can ` +
        "allocate is 8 bits deep, and GL would mask a larger value down " +
        "silently).",
    );
  }
  return value;
}

/**
 * §57's `stencil` member: the stencil test a material's draws run under, and
 * what they write back (§67).
 *
 * ```ts
 * // Pass 1 — punch the mask. Writes 1 wherever this shape covers, and no colour.
 * const write = new UnlitMaterial({
 *   color: [0, 0, 0, 0],
 *   colorWrite: false,
 *   depthWrite: false,
 *   stencil: { func: "always", ref: 1, passOp: "replace" },
 * });
 *
 * // Pass 2 — draw only inside it. Tests, never writes.
 * const inside = new UnlitMaterial({
 *   color: [0.9, 0.3, 0.2, 1],
 *   stencil: { func: "equal", ref: 1, writeMask: 0 },
 * });
 * ```
 *
 * A material that declares **no** `stencil` leaves the stencil test disabled,
 * which is GL's initial state and the state every frame this engine drew before
 * this class existed ran in. That is the byte-identity guarantee, and it is the
 * property that let this land under the pixel-golden gate.
 *
 * ## The defaults are GL's initial state, deliberately
 *
 * `new StencilState()` is `always`/`ref 0`/`0xff`/`0xff`/`keep`/`keep`/`keep` —
 * a stencil test that is *enabled* and passes everything, changing no stored
 * value. It is a no-op with a cost, and that is the point: the only thing a
 * bare `StencilState` changes is that `enable(STENCIL_TEST)` is issued, so a
 * material that opts in and then names nothing gets the same picture, and every
 * field it *does* name is the only thing that moved.
 *
 * ## Validated on assignment, like `opacity` and `blendMode` (F14)
 *
 * Every property below is an accessor applying the same rule the constructor
 * applies. The backend maps these names through a fixed table and passes the
 * numbers to `stencilFunc`, `stencilOp`, and `stencilMask`; §61 forbids
 * throwing inside a frame, so the assignment is where a bad value has to fail.
 * A rejected write leaves the previous value in place.
 *
 * Mutating a `StencilState` does **not** announce anything to a material's
 * version counter, for the reason §57's other render state does not: a backend
 * reads render state per draw and caches none of it.
 */
export class StencilState {
  #func: StencilFunc = "always";

  #ref = 0;

  #readMask: number = MAX_STENCIL_VALUE;

  #writeMask: number = MAX_STENCIL_VALUE;

  #failOp: StencilOp = "keep";

  #depthFailOp: StencilOp = "keep";

  #passOp: StencilOp = "keep";

  /**
   * Builds the record, assigning **through** the accessors so one copy of each
   * rule covers the option and every later write alike (the F14 discipline
   * `Material`'s constructor follows).
   */
  constructor(options: StencilStateOptions = {}) {
    this.func = options.func ?? "always";
    this.ref = options.ref ?? 0;
    this.readMask = options.readMask ?? MAX_STENCIL_VALUE;
    this.writeMask = options.writeMask ?? MAX_STENCIL_VALUE;
    this.failOp = options.failOp ?? "keep";
    this.depthFailOp = options.depthFailOp ?? "keep";
    this.passOp = options.passOp ?? "keep";
  }

  /**
   * The comparison, `"always"` by default — see {@link StencilFunc} for the
   * argument order (`ref OP stored`).
   */
  get func(): StencilFunc {
    return this.#func;
  }

  set func(value: StencilFunc) {
    this.#func = requireFunc(value);
  }

  /**
   * The reference value the test compares and `"replace"` writes; 0 by default,
   * an integer in 0…{@link MAX_STENCIL_VALUE}.
   */
  get ref(): number {
    return this.#ref;
  }

  set ref(value: number) {
    this.#ref = requireStencilValue("ref", value);
  }

  /**
   * The bits of the reference and the stored value the **test** looks at;
   * `0xff` (all eight) by default.
   *
   * This is the bit-plane selector nested clipping needs: a clip that owns bit 2
   * tests with `readMask: 0b100` and is blind to every other level's bits.
   */
  get readMask(): number {
    return this.#readMask;
  }

  set readMask(value: number) {
    this.#readMask = requireStencilValue("readMask", value);
  }

  /**
   * The bits a stencil **write** may change; `0xff` by default, and `0` for the
   * common "test but never write" material.
   *
   * A write mask of 0 makes {@link StencilState.failOp},
   * {@link StencilState.depthFailOp}, and {@link StencilState.passOp} inert —
   * which is a legitimate way to say "read-only", and cheaper than setting all
   * three to `"keep"`, because it also protects against a later edit that
   * changes one of them.
   */
  get writeMask(): number {
    return this.#writeMask;
  }

  set writeMask(value: number) {
    this.#writeMask = requireStencilValue("writeMask", value);
  }

  /** What to store when the **stencil** test fails; `"keep"` by default. */
  get failOp(): StencilOp {
    return this.#failOp;
  }

  set failOp(value: StencilOp) {
    this.#failOp = requireOp("failOp", value);
  }

  /**
   * What to store when the stencil test passes and the **depth** test fails;
   * `"keep"` by default.
   *
   * The one worth stating: a mask pass usually runs with `depthTest: false` or
   * `depthWrite: false`, because a mask that is occluded by the geometry it is
   * masking would punch a hole in itself.
   */
  get depthFailOp(): StencilOp {
    return this.#depthFailOp;
  }

  set depthFailOp(value: StencilOp) {
    this.#depthFailOp = requireOp("depthFailOp", value);
  }

  /** What to store when both tests pass; `"keep"` by default. */
  get passOp(): StencilOp {
    return this.#passOp;
  }

  set passOp(value: StencilOp) {
    this.#passOp = requireOp("passOp", value);
  }

  /**
   * An independent copy. Materials share a `StencilState` by reference — like
   * every other resource in §83's model — so this is how a caller derives a
   * second pass from a first without editing the first.
   */
  clone(): StencilState {
    return new StencilState({
      func: this.#func,
      ref: this.#ref,
      readMask: this.#readMask,
      writeMask: this.#writeMask,
      failOp: this.#failOp,
      depthFailOp: this.#depthFailOp,
      passOp: this.#passOp,
    });
  }
}
