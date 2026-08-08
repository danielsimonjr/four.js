/**
 * The build-mode flag (§85, A-4, 2026-08-07) — one place that answers "is this
 * a development build?", and the two helpers that hang off it.
 *
 * §85 ends with a sentence nothing in the engine could act on until this
 * module existed: _"Production builds may disable expensive validation while
 * preserving essential safety checks."_ Every development check the engine had
 * — §85's validation, §83's resource warnings, §84's statistics wiring, §6a's
 * duplicate-component warning — shipped unconditionally, because there was no
 * build-mode flag and therefore no way to say "this one is for authors".
 *
 * ## The contract, in one line
 *
 * ```ts
 * export const DEV: boolean =
 *   typeof __FOUR_DEV__ !== "undefined" ? __FOUR_DEV__ : true;
 * ```
 *
 * `__FOUR_DEV__` is a **global that need not exist**. Three things follow, and
 * all three are deliberate:
 *
 * 1. **Bare consumption is development.** A program that imports the engine
 *    from source, from `dist`, from a `<script type="module">`, or under
 *    Vitest, never defines the global — `typeof` finds nothing, and {@link DEV}
 *    is `true`. Nobody has to opt in to warnings; you opt *out*.
 * 2. **A bundler folds it away.** Give esbuild, Vite, Rollup, or webpack
 *    `define: { __FOUR_DEV__: "false" }` and the whole expression collapses at
 *    build time: `typeof false !== "undefined"` is a constant `true`, so the
 *    ternary is a constant `false`, so `DEV` is a literal `false`, so every
 *    `if (DEV) { … }` in every package is dead code the tree-shaker deletes.
 *    The identifier is never *read* at runtime under `typeof`, so a bundler
 *    that leaves it alone does not produce a `ReferenceError` either.
 * 3. **It cannot change a public shape.** The flag only ever removes internal
 *    work. `Application.stats` still has type `FrameStats | null` in both
 *    builds; what changes is that a production build always answers `null`.
 *    Nothing gated by this flag may alter a return type, an event payload, a
 *    serialized document, or a simulation result — see the §33 rule below.
 *
 * ## The §33 rule: nothing deterministic may branch on `DEV`
 *
 * Determinism (§33–§34) is defined over the simulation, and a replay recorded
 * in a development build must reproduce bit-exactly in a production one. So
 * **no value that reaches a solver, an integrator, a checksum, a snapshot, or
 * a serialized document may depend on {@link DEV}**. What may depend on it:
 * warnings, assertions, measurement, and diagnostic bookkeeping — work whose
 * only output is text a human reads or a number nothing feeds back.
 *
 * The mechanical form of the rule: if deleting the guarded block changed any
 * number the engine computes, the block does not belong behind this flag. The
 * repository's determinism suites (`tests/determinism/`) run un-bundled, where
 * `DEV` is `true`, and the browser suites run the example bundles, where it is
 * `false`; a violation shows up as a golden that only holds on one side.
 *
 * ## Guard at the call site, not only inside the helper
 *
 * {@link devWarn}, {@link devWarnOnce}, and {@link devAssert} each begin with
 * their own `if (!DEV) return;`, so a stray call in production is a no-op. That
 * is a safety net, not the mechanism: **the argument expressions still run**.
 *
 * ```ts
 * // Wrong: the template literal is built on every replacement, in every build.
 * devWarn(`replacing component "${typeName}" (§6a)`);
 *
 * // Right: the whole statement, message included, is deleted from production.
 * if (DEV) devWarn(`replacing component "${typeName}" (§6a)`);
 * ```
 *
 * Cheap constant messages may skip the outer guard; anything that formats,
 * walks, allocates, or reads a counter must not.
 *
 * @see docs/guides/performance-optimization.md — the consumer-facing contract
 * and the measured bundle savings.
 */

import { FourError } from "./errors.js";
import type { FourErrorCode } from "./errors.js";

declare global {
  /**
   * Build-mode define (§85). Optional: absent means "development".
   *
   * Declared as a `const` rather than a `var` so that no code can assign it —
   * the value is fixed by whoever builds the bundle, not by the program. It is
   * only ever read through {@link DEV}, and only ever under `typeof`, so this
   * declaration describes a global that is allowed not to exist.
   */
  const __FOUR_DEV__: boolean;
}

/**
 * `true` in a development build (the default), `false` when a bundler has
 * defined `__FOUR_DEV__` as `false`.
 *
 * Use it as a plain `if` condition around author-facing work:
 *
 * ```ts
 * import { DEV, devWarn } from "@four/core";
 *
 * if (DEV && !Number.isFinite(mass)) {
 *   devWarn(`mass must be finite; got ${String(mass)} (§85).`);
 * }
 * ```
 *
 * Read the module header before gating anything: the flag must never change a
 * number the simulation computes (§33).
 */
export const DEV: boolean =
  typeof __FOUR_DEV__ !== "undefined" ? __FOUR_DEV__ : true;

/**
 * Messages already emitted by {@link devWarnOnce}, keyed by the caller's key.
 *
 * A `Set` of strings, never of objects — the same rule `resource-memory.ts`
 * follows for §83 accounting: a diagnostic that retained what it reported on
 * would be a leak of its own. It also means the set is bounded by the number of
 * *distinct authoring mistakes*, not by the number of nodes.
 */
const emittedWarnings = new Set<string>();

/** The prefix every engine console message carries, so a host can filter. */
const PREFIX = "[four]";

/**
 * Writes a development warning to `console.warn`, prefixed with `[four]`.
 *
 * A no-op in a production build. Prefer `if (DEV) devWarn(…)` whenever the
 * message costs anything to build (see the module header).
 */
export function devWarn(message: string): void {
  if (!DEV) return;
  console.warn(`${PREFIX} ${message}`);
}

/**
 * Writes a development warning at most once per `key` for the lifetime of the
 * module — §42's authority-conflict warning and §41's stability warnings are
 * both "true every frame, useful once", and a warning that fires 60 times a
 * second is a warning nobody reads.
 *
 * The key is the caller's identity for the mistake, not the message: two nodes
 * making the same mistake should generally warn twice, so keys usually embed an
 * id (`` `authority:${node.id}` ``). Returns `true` if this call emitted.
 *
 * A no-op returning `false` in a production build.
 */
export function devWarnOnce(key: string, message: string): boolean {
  if (!DEV) return false;
  if (emittedWarnings.has(key)) return false;
  emittedWarnings.add(key);
  console.warn(`${PREFIX} ${message}`);
  return true;
}

/**
 * Forgets every key {@link devWarnOnce} has seen.
 *
 * Exported for tests: "warns once" is only assertable if a suite can put the
 * deduplication back to its initial state between cases. Calling it in an
 * application is harmless and means "warn me about these again".
 */
export function resetDevWarnings(): void {
  emittedWarnings.clear();
}

/**
 * Throws a {@link FourError} when `condition` is false — **in development
 * builds only**.
 *
 * This is §85's "expensive validation", and the asymmetry is the point: a
 * production build skips the check entirely rather than checking and
 * continuing. So `devAssert` is for mistakes an author must fix before
 * shipping, never for conditions a shipped program is expected to hit.
 *
 * The rule for choosing between this and a plain `throw new FourError(...)`:
 *
 * - **Unconditional throw** when the check is *essential safety* — the
 *   operation cannot proceed, or proceeding corrupts state. §85 requires these
 *   to survive into production, and every `FourError` the engine throws today
 *   stays exactly where it is.
 * - **`devAssert`** when the check is a *scan* — walking a hierarchy, testing
 *   every element of an array, re-deriving something to compare it — and the
 *   code below it merely produces a wrong picture rather than a broken engine.
 *
 * Since the throw disappears in production, never write code whose correctness
 * depends on it having fired.
 */
export function devAssert(
  condition: boolean,
  code: FourErrorCode,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (!DEV) return;
  if (condition) return;
  throw new FourError(code, message, context ? { context } : undefined);
}
