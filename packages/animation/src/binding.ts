/**
 * Property bindings (§16).
 *
 * §16: *"property bindings are typed property references; string-path
 * convenience forms are resolved once, at creation time."* This module is the
 * second half of that sentence. {@link createBinding} walks a dot-separated
 * path **once**, at creation, caching the owning object and the final key; from
 * then on `get`/`set` are a property read and a property write with no string
 * work, no allocation, and no re-resolution.
 *
 * Resolving once is a semantic commitment, not just an optimization: a binding
 * created against `node.transform.position` keeps writing *that* vector even if
 * something later replaces `node.transform`. A tween therefore animates the
 * object it was pointed at, which is what "typed property reference" means —
 * and any surprise is visible at creation time rather than mid-playback.
 *
 * ## Writing in place (§7b)
 *
 * When the bound value is a mutable reference type, `set` copies **into the
 * existing object** through the adapter and never replaces the reference.
 * `Transform` depends on this: its `position`/`rotation`/`scale` are `readonly`
 * and carry change hooks that bump the transform's version, so replacing one
 * would drop the hook and leave the transform permanently stale (§7). Primitive
 * and discrete values have nothing to write through and are assigned.
 *
 * ## Not handled here
 *
 * Transform authority (§42) and last-started-wins conflict warnings (§16) are
 * the tween layer's concern: a binding is a mechanism for reading and writing
 * one property, deliberately with no policy of its own.
 */

import { FourError } from "@four/core";

import { detectAdapter, type ValueAdapter } from "./values.js";

/**
 * A resolved reference to one property, plus the adapter for its value type.
 *
 * Instances come from {@link createBinding}. The read/write pair is `unknown`-
 * typed because a binding is normally reached through a path string, where the
 * value type is a runtime fact; the {@link PropertyBinding.adapter} is what
 * gives typed code something to hold on to.
 */
export interface PropertyBinding {
  /** The object {@link createBinding} was called with — the path's root. */
  readonly target: object;

  /** The original dot-separated path, kept for diagnostics and errors. */
  readonly path: string;

  /**
   * The object that actually owns the final property, resolved once at
   * creation. Equal to {@link PropertyBinding.target} for a single-segment
   * path.
   */
  readonly owner: object;

  /** The final path segment — the property key on {@link PropertyBinding.owner}. */
  readonly key: string;

  /** Adapter for the bound value's type; detected at creation unless supplied. */
  readonly adapter: ValueAdapter<unknown>;

  /** Reads the current value. Allocates nothing. */
  get(): unknown;

  /**
   * Writes `value`. For an in-place adapter this copies into the existing
   * object and preserves its identity; otherwise it assigns the property.
   * Allocates nothing.
   */
  set(value: unknown): void;
}

/** Short human-readable description of a value, for error messages. */
function describe(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "object") {
    const name = (value as { constructor?: { name?: string } }).constructor
      ?.name;
    return name === undefined ? "an object" : `an instance of ${name}`;
  }
  return `a ${typeof value}`;
}

/** Throws the §89 error used for every malformed binding. */
function invalidBinding(
  message: string,
  context: Record<string, unknown>,
): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/** True for values that can carry properties (excludes `null`). */
function isPropertyOwner(value: unknown): value is Record<string, unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

/**
 * Resolves `path` against `target` **once** and returns a binding for the
 * property it names.
 *
 * `path` is dot-separated (`"opacity"`, `"transform.position"`). Every
 * intermediate segment must already resolve to an object, and the final
 * property must exist on its owner — inherited accessors count, so a getter or
 * setter declared on a prototype binds fine.
 *
 * @param target Root object of the path.
 * @param path Dot-separated property path; must be non-empty.
 * @param adapter Pre-typed adapter, skipping detection. Supply it when the
 * value type is known statically, when the property is currently `null`, or to
 * disambiguate a four-number array (see {@link detectAdapter}). No check is
 * made that it matches the current value: this is the "typed property
 * reference" form of §16, where the caller owns the type.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` — the path is empty or has an
 * empty segment; an intermediate segment is missing or is not an object; the
 * final property does not exist; or no adapter was supplied and the current
 * value's type is not detectable.
 */
export function createBinding(
  target: object,
  path: string,
  adapter?: ValueAdapter<unknown>,
): PropertyBinding {
  if (path.length === 0) {
    invalidBinding("Cannot create a property binding from an empty path.", {
      path,
    });
  }

  const segments = path.split(".");
  let owner: Record<string, unknown> = target as Record<string, unknown>;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment.length === 0) {
      invalidBinding(
        `Property path "${path}" has an empty segment at position ${String(index)}.`,
        { path, index },
      );
    }
    const next: unknown = owner[segment];
    if (!isPropertyOwner(next)) {
      invalidBinding(
        `Property path "${path}" cannot be resolved: segment "${segment}" is ${describe(next)}, which has no properties.`,
        { path, segment, index },
      );
    }
    owner = next;
  }

  const key = segments[segments.length - 1];
  if (key.length === 0) {
    invalidBinding(`Property path "${path}" has an empty final segment.`, {
      path,
    });
  }
  if (!(key in owner)) {
    invalidBinding(
      `Property path "${path}" cannot be resolved: "${key}" does not exist on its owner.`,
      { path, key },
    );
  }

  const resolvedAdapter = adapter ?? detectAdapter(owner[key]);
  if (resolvedAdapter === undefined) {
    invalidBinding(
      `Property path "${path}" holds ${describe(owner[key])}, which has no value adapter. Pass one explicitly.`,
      { path, key },
    );
  }

  // `owner` and `key` are captured here and never recomputed — the whole point
  // of §16's "resolved once, at creation time".
  const binding: PropertyBinding = {
    target,
    path,
    owner,
    key,
    adapter: resolvedAdapter,
    get(): unknown {
      return owner[key];
    },
    set: resolvedAdapter.mutatesInPlace
      ? (value: unknown): void => {
          // Write through the existing object: never replace the reference
          // (§7b — `transform.position` must be mutated in place).
          resolvedAdapter.copy(value, owner[key]);
        }
      : (value: unknown): void => {
          owner[key] = value;
        },
  };
  return binding;
}
