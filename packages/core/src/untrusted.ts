/**
 * Untrusted-input guards for the document formats (§96).
 *
 * §96 opens *"asset loaders and scene deserializers shall treat external
 * content as untrusted"* and lists seven requirements. Two of them —
 * **input-size limits** and the bounds half of **bounds checking** — apply
 * identically to both persistence surfaces in the engine: `@four/serialization`'s
 * §79 scene document and `@four/diagnostics`' §34 replay recording. Neither
 * package may depend on the other (the §3.1 matrix puts them side by side with
 * no edge), and both already read their shared JSON vocabulary from here, so
 * this module is where one definition of "how much text, how deep" can live.
 * It is the same hoist, and for the same reason, as {@link cloneJsonValue}'s on
 * 2026-08-04.
 *
 * ## The attack this closes
 *
 * `JSON.parse` is not the vulnerable step: V8 parses a hundred thousand levels
 * of `[[[[…]]]]` without complaint. The vulnerable step is *ours*. Every
 * validator downstream — `validateSceneDocument`'s `validateNode` walking
 * `children`, `validateReplayRecording`'s payload copies, `cloneJsonValue`
 * itself — is **recursive**, one JavaScript frame per document level. A
 * megabyte of nested brackets therefore costs a `RangeError: Maximum call stack
 * size exceeded` thrown from somewhere deep inside the engine, on a stack too
 * short to say what happened, and in a host that shares its stack with
 * everything else. That is a denial of service reachable from a scene file.
 *
 * So the depth check runs **before** any recursive consumer sees the value, and
 * it is itself **iterative** — breadth-first over one level at a time
 * ({@link parseUntrustedJson}). A recursive depth checker would be the same
 * defect wearing the guard's name: it would overflow on precisely the input it
 * exists to refuse.
 *
 * ## Defaults are finite, and generous
 *
 * A limit that defaults to `Infinity` is documentation, not a limit. Both
 * defaults here are finite ({@link DEFAULT_MAXIMUM_TEXT_LENGTH},
 * {@link DEFAULT_MAXIMUM_DEPTH}) and both are orders of magnitude above
 * anything the engine's own documents, goldens, and examples produce — the
 * largest recording committed to this repository is under 50 kB and under ten
 * levels deep. An application with a genuinely larger or deeper document raises
 * the limit at the call site, explicitly, which is the point: the *decision* to
 * accept a 200 MB scene file should appear in someone's source, not in the
 * absence of a check.
 *
 * `Number.POSITIVE_INFINITY` is accepted for either limit and disables that
 * check. Zero, negatives, and `NaN` are refused as programming errors rather
 * than silently clamped — a limit of `0` accepts no document at all, which is
 * never what the caller meant.
 */

import { FourError } from "./errors.js";

/**
 * The default ceiling on document text, in UTF-16 code units (§96).
 *
 * 32 Mi units — roughly 32–96 MB of UTF-8, depending on the script. Chosen so
 * that no plausible authored scene or recording meets it while a runaway or
 * hostile response is refused before `JSON.parse` allocates a parse tree for
 * it. Code units rather than bytes because that is what a decoded `string`
 * can report without re-encoding it; a UTF-8 body is never *smaller* than its
 * code-unit count, so the check is conservative in the safe direction — it can
 * accept something slightly larger than the nominal budget, never reject
 * something smaller.
 */
export const DEFAULT_MAXIMUM_TEXT_LENGTH = 33_554_432;

/**
 * The default ceiling on JSON nesting levels (§96).
 *
 * Counting the parsed value itself as level 1, so `{}` is 1, `{"a": 1}` is 2,
 * and a scene document's root array plus one node is 3. A §79 node contributes
 * two levels per generation (the node object, then its `children` array), so
 * 1024 admits a subtree roughly 500 nodes deep — far past any authored scene,
 * far short of the ~8 000-frame recursion depth `benchmarks/scene-propagation.mjs`
 * measured as the practical ceiling for `resolveWorldTransforms`, and therefore
 * far short of the stack depth at which a recursive validator dies.
 */
export const DEFAULT_MAXIMUM_DEPTH = 1024;

/**
 * Size and nesting bounds for one untrusted document (§96).
 *
 * Both fields are optional; an omitted field takes its documented default, and
 * `Number.POSITIVE_INFINITY` disables that check for a caller who has decided,
 * in writing, that the input is trusted.
 */
export interface UntrustedJsonLimits {
  /**
   * Maximum document text length in UTF-16 code units. Defaults to
   * {@link DEFAULT_MAXIMUM_TEXT_LENGTH}.
   */
  readonly maximumTextLength?: number;
  /**
   * Maximum JSON nesting depth, counting the parsed value as level 1. Defaults
   * to {@link DEFAULT_MAXIMUM_DEPTH}.
   */
  readonly maximumDepth?: number;
}

/**
 * Validates a limit as a positive number, allowing `Infinity`.
 *
 * @param value the caller's value, or `undefined` for the default
 * @param fallback the documented default for this limit
 * @param name the option's name, for the error message
 * @returns the effective limit
 * @throws FourError `INVALID_APPLICATION_STATE` if the value is not a number
 * greater than zero
 */
function effectiveLimit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  // `!(value > 0)` rather than `value <= 0`, so `NaN` — which compares false
  // against everything — is refused by the same branch as zero and negatives.
  if (!(value > 0)) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `${name} must be a number greater than zero (or Number.POSITIVE_INFINITY to disable the check); got ${String(value)}.`,
      { context: { limitName: name, found: value } },
    );
  }
  return value;
}

/** Builds the §96 refusal, with the limit and the measurement that broke it. */
function rejected(
  label: string,
  detail: string,
  limitName: string,
  limit: number,
  observed: number,
): FourError {
  return new FourError(
    "UNTRUSTED_INPUT_REJECTED",
    `${label} ${detail} (§96: external content is untrusted).`,
    { context: { document: label, limitName, limit, observed } },
  );
}

/**
 * Whether every value in `root` sits at or above `maximum` nesting levels.
 *
 * Breadth-first over an explicit level array, never recursive — see the module
 * comment. Scalars end a branch; arrays and plain objects extend it. Returns as
 * soon as a level beyond `maximum` is reached, so a deep-and-narrow hostile
 * document is refused without walking whatever follows it.
 *
 * @param root the parsed document
 * @param maximum the inclusive ceiling, counting `root` itself as level 1
 * @returns the depth reached, capped at `maximum + 1` — so any result greater
 * than `maximum` means "deeper than allowed", and the reported figure is a
 * floor on the true depth rather than a full measurement of a hostile document
 */
function measureDepth(root: unknown, maximum: number): number {
  let level: unknown[] = [root];
  let depth = 0;
  while (level.length > 0) {
    depth += 1;
    if (depth > maximum) {
      return depth;
    }
    const next: unknown[] = [];
    for (const value of level) {
      if (typeof value !== "object" || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value as readonly unknown[]) {
          next.push(entry);
        }
        continue;
      }
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        next.push(record[key]);
      }
    }
    level = next;
  }
  return depth;
}

/**
 * Parses untrusted JSON text under §96's size and nesting bounds.
 *
 * The order is deliberate: the text length is checked **before** `JSON.parse`
 * allocates anything, and the depth is checked **before** the result reaches
 * any recursive validator. A caller that skips this and calls `JSON.parse`
 * itself gets neither guarantee.
 *
 * @param text the untrusted document text
 * @param label what the document is, e.g. `"Scene document"` — used in the
 *   message and carried as `context.document`
 * @param limits the caller's bounds; omitted fields take their defaults
 * @returns the parsed value, unvalidated beyond its size and shape bounds
 * @throws FourError `UNTRUSTED_INPUT_REJECTED` if the text is longer than
 * `maximumTextLength` or nests deeper than `maximumDepth`; `context` carries
 * `limitName`, `limit`, and the `observed` measurement
 * @throws FourError `INVALID_APPLICATION_STATE` if a supplied limit is not a
 * positive number
 * @throws SyntaxError if the text is not JSON
 */
export function parseUntrustedJson(
  text: string,
  label: string,
  limits?: UntrustedJsonLimits,
): unknown {
  const maximumTextLength = effectiveLimit(
    limits?.maximumTextLength,
    DEFAULT_MAXIMUM_TEXT_LENGTH,
    "maximumTextLength",
  );
  if (text.length > maximumTextLength) {
    throw rejected(
      label,
      `is ${String(text.length)} UTF-16 code units, over the ${String(maximumTextLength)} limit`,
      "maximumTextLength",
      maximumTextLength,
      text.length,
    );
  }
  const maximumDepth = effectiveLimit(
    limits?.maximumDepth,
    DEFAULT_MAXIMUM_DEPTH,
    "maximumDepth",
  );
  const value = JSON.parse(text) as unknown;
  const depth = measureDepth(value, maximumDepth);
  if (depth > maximumDepth) {
    throw rejected(
      label,
      `nests deeper than the ${String(maximumDepth)}-level limit`,
      "maximumDepth",
      maximumDepth,
      depth,
    );
  }
  return value;
}
