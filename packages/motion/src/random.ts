/**
 * `SeededRandom`'s original home (WP-8.2), now a re-export of `@four/core`.
 *
 * The seeded RNG was born here while §111's wander was its only consumer,
 * with a dated note promising the hoist into `@four/core` once a second
 * consumer appeared. `@four/particles` (WP-9.1) was that consumer — the §3.1
 * matrix has no particles → motion edge, so it had to carry a verbatim copy —
 * and the hoist landed 2026-08-04. The class, the seeding rule, and every
 * stream are exactly what shipped from this file; `@four/motion`'s public
 * surface is unchanged.
 */

export { SeededRandom } from "@four/core";
