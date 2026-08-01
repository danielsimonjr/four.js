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
  | "PHYSICS_SOLVER_FAILED"
  | "SERIALIZATION_VERSION_MISMATCH";

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
