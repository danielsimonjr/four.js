/**
 * §82's `Four.ComputePass` — the named-map sugar over `@four/render`'s
 * ordered {@link ComputePassDescriptor} (the Q3 promotion, 2026-08-29).
 *
 * §82's example is the reason this class exists, and names its home:
 *
 * ```ts
 * const compute = new Four.ComputePass({
 *   shader: particleShader,
 *   workgroups: [1024, 1, 1],
 *   bindings: { positions, velocities, parameters },
 * });
 * ```
 *
 * — an umbrella-level `Four.*` spelling with `bindings` as a **named map**.
 * The engine seam underneath (`Renderer.compute?()`, WP-R1.8) takes an
 * **ordered array**, because binding order is what a bind-group layout
 * actually consumes; this class is the bridge, and it lives in the umbrella —
 * the fourth API `four` owns rather than re-exports — because the recorded
 * WP-R1.8 decision assigns the named-map spelling to `Four.ComputePass`
 * exactly, and `@four/render`'s descriptor stays the one canonical shape
 * every backend consumes.
 *
 * ## How names become binding indices (decision, this packet)
 *
 * A named map's keys are taken in **insertion order** — the map's *i*-th own
 * enumerable string key becomes `@binding(i)`. That is well-defined
 * (JavaScript preserves string-key insertion order) and deterministic (§33),
 * and it makes the spec's example mean what it visibly says: `positions` at
 * binding 0, `velocities` at 1, `parameters` at 2 — *for that kernel*. The
 * names themselves are documentation: nothing parses the shader to match
 * WGSL identifiers against them, because §82's descriptor carries an opaque
 * kernel string and reflecting on it would be a guess. Write the map in the
 * kernel's binding order. (The engine's own §36 integrator binds
 * `parameters` first — `{ parameters, positions, velocities }` is its
 * spelling; the spec's ordering above is §82's illustration, not a layout.)
 *
 * An ordered array is accepted too, verbatim, so one type serves both
 * spellings and a caller migrating from the backend seam changes nothing.
 *
 * ## What an instance *is*
 *
 * A `ComputePass` **implements** {@link ComputePassDescriptor}: construction
 * resolves the map once into a frozen array, and the instance is handed
 * straight to `renderer.compute?.(pass)` (gate on §62's
 * `capabilities.computeShaders`, or narrow with `supportsCompute`). It holds
 * no device resource and needs no disposal — buffers are the backend's
 * (`WebgpuRenderer.createComputeBuffer`) and §83 leaves them with their
 * creator.
 */

import type {
  ComputeBinding,
  ComputeBuffer,
  ComputePassDescriptor,
} from "@four/render";

/** One `bindings` entry, either spelling: a bare buffer or a record. */
export type ComputePassBindingEntry = ComputeBuffer | ComputeBinding;

/**
 * §82's `bindings`, in either spelling: a named map whose key insertion
 * order is the binding order, or the ordered array the descriptor carries.
 */
export type ComputePassBindings =
  | Readonly<Record<string, ComputePassBindingEntry>>
  | readonly ComputePassBindingEntry[];

/** Options of {@link ComputePass} — §82's example shape. */
export interface ComputePassOptions {
  /** Diagnostic name, echoed on backend pass and pipeline labels. */
  readonly label?: string;
  /** The compute kernel, as shader source (WGSL on the WebGPU backend). */
  readonly shader: string;
  /** The kernel's entry point; the backend's default when omitted. */
  readonly entryPoint?: string;
  /** Workgroup counts along x, y, z — §82's `workgroups: [1024, 1, 1]`. */
  readonly workgroups: readonly [number, number, number];
  /** The storage buffers; omitted means a binding-less kernel. */
  readonly bindings?: ComputePassBindings;
}

/**
 * §82's `Four.ComputePass` — see the module header for the named-map rule.
 *
 * ```ts
 * const pass = new Four.ComputePass({
 *   shader: kernelWgsl,
 *   workgroups: [Math.ceil(count / 64), 1, 1],
 *   bindings: {
 *     parameters: { buffer: params, access: "read-only" },
 *     positions,
 *     velocities,
 *   },
 * });
 * if (supportsCompute(renderer)) {
 *   renderer.compute(pass);
 * }
 * ```
 */
export class ComputePass implements ComputePassDescriptor {
  /** Diagnostic name, as given. */
  readonly label?: string;

  /** The kernel source, as given. */
  readonly shader: string;

  /** The entry point, as given; `undefined` selects the backend's default. */
  readonly entryPoint?: string;

  /** The workgroup grid, copied and frozen at construction. */
  readonly workgroups: readonly [number, number, number];

  /**
   * The resolved **ordered** bindings — the descriptor's shape, frozen. For
   * a named map, index *i* is the map's *i*-th key ({@link
   * ComputePass.bindingNames}); for an array, the array verbatim.
   */
  readonly bindings: readonly ComputePassBindingEntry[];

  /**
   * The binding names in binding order — the named map's keys as consumed,
   * exposed so a caller (or a test) can see exactly which name landed on
   * which `@binding(i)`. Empty for the ordered-array spelling, which carries
   * no names.
   */
  readonly bindingNames: readonly string[];

  constructor(options: ComputePassOptions) {
    this.label = options.label;
    this.shader = options.shader;
    this.entryPoint = options.entryPoint;
    this.workgroups = Object.freeze<[number, number, number]>([
      options.workgroups[0],
      options.workgroups[1],
      options.workgroups[2],
    ]);

    const bindings = options.bindings ?? [];
    if (isOrderedBindings(bindings)) {
      this.bindings = Object.freeze([...bindings]);
      this.bindingNames = Object.freeze([]);
    } else {
      // String-key insertion order (module header): `Object.entries` reports
      // own enumerable string keys in exactly that order.
      const entries = Object.entries(bindings);
      this.bindings = Object.freeze(entries.map(([, entry]) => entry));
      this.bindingNames = Object.freeze(entries.map(([name]) => name));
    }
  }
}

/** Narrows §82's two `bindings` spellings — the array wins `Array.isArray`. */
function isOrderedBindings(
  bindings: ComputePassBindings,
): bindings is readonly ComputePassBindingEntry[] {
  return Array.isArray(bindings);
}
