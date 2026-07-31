/**
 * Allocation instrumentation for the math types (§7b, §83).
 *
 * §7b requires that steady-state per-frame engine code never allocates math
 * objects. Identity checks cannot prove that — a pooled object looks identical
 * to a fresh one — so every math constructor reports itself here and tests
 * assert the count instead.
 *
 * Module-level mutable state is deliberate: this is dev/test instrumentation,
 * not simulation state, so it is never part of a determinism checksum (§33).
 * The counter is monotonic between resets and wraps at `Number.MAX_SAFE_INTEGER`
 * back to 0 so long-running sessions cannot lose precision.
 */

let constructions = 0;

/**
 * Records the construction of one math object. Called by every math
 * constructor; not part of the user-facing API surface.
 */
export function noteConstruction(): void {
  constructions =
    constructions < Number.MAX_SAFE_INTEGER ? constructions + 1 : 0;
}

/** Number of math objects constructed since the last {@link resetConstructionCount}. */
export function constructionCount(): number {
  return constructions;
}

/** Resets the construction counter to zero. */
export function resetConstructionCount(): void {
  constructions = 0;
}
