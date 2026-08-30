/**
 * Error model (§89).
 *
 * Every engine failure that is worth naming is reported as a {@link FourError}
 * carrying a machine-readable {@link FourErrorCode}, optional structured
 * `context`, and an optional `cause`. Recoverable failures are additionally
 * reportable through events and diagnostics without terminating the
 * application (§89).
 */

/**
 * The §89 code list.
 *
 * §89 calls these "example codes", so the union is the engine's *current*
 * vocabulary rather than a closed set: later packets extend it in this file as
 * their spec sections require (WP-1.4/1.5/1.6 decision — keep one union in one
 * place instead of allowing arbitrary strings, so a typo is a compile error).
 */
export type FourErrorCode =
  | "RENDERER_INITIALIZATION_FAILED"
  | "UNSUPPORTED_GPU_FEATURE"
  | "ASSET_LOAD_FAILED"
  | "SHADER_COMPILATION_FAILED"
  | "CONTEXT_LOST"
  | "DEVICE_LOST"
  | "INVALID_SCENE_GRAPH"
  | "INVALID_APPLICATION_STATE"
  /**
   * A render graph was asked to exist in a shape that cannot: a duplicate
   * pass name, an unknown input, a removal that would orphan a consumer, an
   * execute of an effect pass on a backend that has no `renderEffect`.
   * Distinct from `"INVALID_APPLICATION_STATE"` so a host can tell a graph
   * authoring mistake from a lifecycle one without parsing the message
   * (R-5 follow-up, 2026-08-30). The code lives here because §89's vocabulary
   * is one union in this file; `@four/render` is the only thrower.
   */
  | "INVALID_RENDER_GRAPH"
  | "PHYSICS_SOLVER_FAILED"
  | "SERIALIZATION_VERSION_MISMATCH"
  /**
   * External content was refused by a §96 guard before anything parsed,
   * decoded, or walked it — a document longer than `maximumTextLength`, or one
   * nesting deeper than `maximumDepth`. Distinct from the `TypeError`s the
   * document validators throw for a malformed field: those say "this is not a
   * scene", this says "this is not something we are willing to look at". The
   * `context` names the `limitName`, its `limit`, and the `observed`
   * measurement, so a host can log the policy that fired without parsing a
   * message.
   */
  | "UNTRUSTED_INPUT_REJECTED"
  /**
   * A named part of the public API exists but its behaviour lands in a later
   * phase. Thrown at the point of use, never swallowed, so a reserved value can
   * be spelled out in the types (and serialized, and documented) long before it
   * does anything — the first case is `TransformAuthority`'s `"blended"` (§42),
   * which selects the §19 physics-animation pipeline built in Phase 7
   * (WP-2.3 addition, flagged by the WP-1.6 worker 2026-07-31).
   */
  | "NOT_IMPLEMENTED";

/** Optional extras attached to a {@link FourError}. */
export interface FourErrorOptions {
  /** Structured detail for diagnostics and logs. */
  context?: Record<string, unknown>;
  /** The underlying failure, if this error wraps one. */
  cause?: unknown;
}

/**
 * The engine's error type.
 *
 * `cause` is the standard `Error.cause` (ES2022) rather than a re-declared
 * field, so `new FourError(...).cause` and `error.cause` from any other error
 * behave identically and stack printing keeps the chain.
 */
export class FourError extends Error {
  override readonly name = "FourError";

  readonly code: FourErrorCode;

  readonly context?: Record<string, unknown>;

  constructor(
    code: FourErrorCode,
    message: string,
    options?: FourErrorOptions,
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = code;
    if (options?.context !== undefined) {
      this.context = options.context;
    }
  }
}

/** Type guard for {@link FourError}, usable across package boundaries. */
export function isFourError(value: unknown): value is FourError {
  return value instanceof FourError;
}
