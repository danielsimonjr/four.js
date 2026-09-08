/**
 * `SeededRandom` for particles — a re-export of `@fourjs/core`.
 *
 * WP-9.1 carried a verbatim copy of `@fourjs/motion`'s WP-8.2 generator here,
 * because the §3.1 matrix has no particles → motion edge and `@fourjs/core` had
 * no RNG yet; the copy's provenance note named the hoist into `@fourjs/core` as
 * the fix once a shared home existed. That hoist landed 2026-08-04. Streams
 * are unchanged for every seed — the class is byte-for-byte the original the
 * copy was taken from — and `tests/random.test.ts` still pins the shared
 * known-answer vectors against an independent BigInt oracle.
 */

export { SeededRandom } from "@fourjs/core";
