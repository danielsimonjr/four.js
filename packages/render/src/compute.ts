/**
 * §82's `ComputePass`, as the backend-independent descriptor — the Q3
 * promotion (R-1 plan §9, recorded at WP-R1.8; executed 2026-08-29).
 *
 * ## Where this came from, and why it moved
 *
 * WP-R1.8 landed §82's compute tier — pipelines, storage-buffer bind groups,
 * dispatch, exact readback — in `@four/render-webgpu`, the only backend that
 * can run it, because `packages/render` was inside RFC 0004's concurrent
 * scope at the time. The R-1 plan's owner question **Q3** recommends this
 * package as the descriptor's home ("a backend-independent descriptor,
 * matching every other render type", with the spec's own `Four.ComputePass`
 * example arguing umbrella-level reach), and the recorded promotion is **one
 * re-export**: the types now live here, `@four/render-webgpu` re-exports them
 * (the capability-token identity precedent — a migration is a re-export, and
 * no call site moves), and {@link Renderer.compute} joins the interface as an
 * optional member.
 *
 * ## Presence is the capability (§62, §82)
 *
 * `compute?()` is the **fourth** instance of the optional-member pattern
 * `statistics`, `renderEffect` and `createPickingService` established: a
 * backend that can dispatch declares the member, one that cannot omits it,
 * and {@link supportsCompute} tells them apart. WebGL 2 has no compute stage
 * and never grows the member; §62's `computeShaders` capability is how an
 * application asks *before* reaching for it, and §82's closing sentence —
 * *"basic graphics and physics functionality must not require compute
 * support"* — is honoured structurally: nothing in any frame path calls it.
 *
 * ## What deliberately did *not* move
 *
 * Buffer **allocation** stays a backend API (`WebgpuRenderer.
 * createComputeBuffer` and friends): a storage buffer is a device allocation,
 * and pretending a backend-independent verb exists for it would only wrap the
 * same call. What crosses the seam instead is {@link ComputeBuffer} — the
 * *structural* face of a backend's buffer handle (§83's lifecycle trio), so a
 * descriptor, a diagnostic, or the umbrella's named-map sugar can carry
 * buffers without naming the backend that minted them. A backend's `compute`
 * refuses a buffer another backend created (`INVALID_APPLICATION_STATE`) —
 * the handle is structural, the allocation is not.
 *
 * ## Bindings are an ordered array (decision, WP-R1.8)
 *
 * §82's spec example spells `bindings` as a named map
 * (`{ positions, velocities, parameters }`); the descriptor here takes an
 * **ordered array**, where index *i* is `@group(0) @binding(i)` — order is
 * what a bind-group layout actually consumes. The named-map spelling is the
 * umbrella's `Four.ComputePass` sugar (this same promotion packet), which
 * maps a record's keys to binding indices in insertion order and produces
 * exactly this descriptor.
 */

/** Entry point name a backend's compute stage uses when none is given. */
export const COMPUTE_ENTRY_POINT = "computeMain";

/**
 * How a dispatch binds one storage buffer: writable, or read-only.
 *
 * `"read-write"` is WGSL's `var<storage, read_write>`; `"read-only"` is
 * `var<storage, read>`. The access mode is **layout identity** — WebGPU
 * validates the shader's declared access against the bind-group layout's
 * buffer type — which is why it is part of the descriptor rather than assumed.
 */
export type ComputeBindingAccess = "read-write" | "read-only";

/**
 * The structural face of a backend's storage-buffer handle (§82, §83).
 *
 * Created by a backend (`WebgpuRenderer.createComputeBuffer` is the only
 * implementor today) and disposed by whoever created it. The brand is what
 * lets a descriptor distinguish a bare buffer from a {@link ComputeBinding}
 * record without `instanceof` — the `isParticleDrawable` technique, §82's
 * turn. A buffer is only meaningful to the backend that allocated it; a
 * backend's `compute` refuses foreign handles loudly rather than guessing.
 */
export interface ComputeBuffer {
  /** The brand — a literal `true`, so one property load discriminates. */
  readonly isComputeBuffer: true;
  /** Allocation size in bytes. */
  readonly byteLength: number;
  /** Whether {@link ComputeBuffer.dispose} has run (§83). */
  readonly disposed: boolean;
  /** Releases the allocation (§83). Idempotent. */
  dispose(): void;
}

/** One storage-buffer binding of a {@link ComputePassDescriptor}. */
export interface ComputeBinding {
  /** The buffer to bind. */
  readonly buffer: ComputeBuffer;
  /** The shader's declared access; `"read-write"` when omitted. */
  readonly access?: ComputeBindingAccess;
}

/**
 * §82's `ComputePass`, backend-independent: a compute kernel's source, the
 * workgroup grid to dispatch, and the storage buffers it reads and writes —
 * bound at `@group(0)`, `@binding(i)` for array index *i* (module header on
 * the ordered-array shape).
 *
 * The `shader` string is in the dispatching backend's kernel language — WGSL
 * on the one backend that declares `Renderer.compute?()` today. The
 * descriptor does not name the language, exactly as `ScreenEffect` does not
 * name GLSL: a future compute-capable backend declares what it compiles.
 */
export interface ComputePassDescriptor {
  /** Diagnostic name, echoed on the pass and pipeline labels. */
  readonly label?: string;
  /** The compute kernel, as shader source. */
  readonly shader: string;
  /** The kernel's entry point; {@link COMPUTE_ENTRY_POINT} when omitted. */
  readonly entryPoint?: string;
  /**
   * Workgroup counts along x, y, z — §82's `workgroups: [1024, 1, 1]`.
   * Non-negative integers; a zero count is a defined no-op dispatch.
   */
  readonly workgroups: readonly [number, number, number];
  /** The storage buffers, in binding order. A bare buffer binds read-write. */
  readonly bindings: readonly (ComputeBuffer | ComputeBinding)[];
}

/**
 * The shape a compute-capable renderer adds to {@link Renderer} — what
 * {@link supportsCompute} narrows to.
 */
export interface ComputeDispatcher {
  /** Records and submits one §82 dispatch. See {@link Renderer.compute}. */
  compute(pass: ComputePassDescriptor): void;
}

/**
 * Whether `renderer` declares §82's optional {@link Renderer.compute} member —
 * presence is the capability, and this is the one honest test for it
 * (`supportsRenderStatistics`' shape, fourth application).
 *
 * Prefer asking §62's `capabilities.computeShaders` *before* building compute
 * work at all; this guard is the type-level narrowing at the call site.
 */
export function supportsCompute<TRenderer extends object>(
  renderer: TRenderer,
): renderer is TRenderer & ComputeDispatcher {
  return "compute" in renderer;
}
