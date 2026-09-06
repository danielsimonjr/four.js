/**
 * §83 resource accounting for materials — how many are live (A-5 follow-up).
 *
 * The twin of `@four/geometry`'s and `@four/render`'s `resource-memory.ts`,
 * which document the design in full: **numbers, not references**, so the
 * tracker cannot itself become the leak it reports; process-wide rather than
 * per-application, because a material belongs to whoever created it (§83);
 * absolute and never reset, because these are levels rather than per-frame
 * accumulations; and never healed by garbage collection, because §83's
 * contract is that lifetimes are *explicit*.
 *
 * ## Count only — no byte total
 *
 * A material is CPU-side state (colour arrays, sampler pointers, a stencil
 * record). The GPU objects a backend builds from it — pipelines, uniform
 * buffers — are the backend's, and the textures a material samples are
 * already billed by `@four/render`. There is no honest byte length here that
 * is not already counted elsewhere, so this module holds **one number**.
 *
 * {@link liveMaterialCount} is what a caller passes to
 * `@four/diagnostics`' `auditResourceLeaks` as `LiveResourceCounts.materials`.
 * There is no §84 `app.stats` slot for materials; the audit is the surface.
 *
 * ## Always on
 *
 * The counter is a number, §33-safe: it does not change simulation, and it
 * does not import `DEV`. Production gating lives on the *message*
 * (`auditResourceLeaks` returns a frozen empty report when `DEV` is false),
 * not on the count.
 */

/** Live (constructed, undisposed) {@link Material} instances. */
let liveMaterials = 0;

/**
 * Records a change to the live material accounting: `instances` is `+1` at
 * construction and `-1` at disposal.
 *
 * Internal to `@four/materials` — exported so `material.ts` can reach it,
 * deliberately absent from the package index, exactly as `@four/math`'s
 * `noteConstruction` is.
 */
export function noteMaterial(instances: number): void {
  liveMaterials += instances;
}

/**
 * How many materials have been constructed and not yet disposed (§83).
 *
 * Every family member (`UnlitMaterial`, `LitMaterial`, `SpriteMaterial`,
 * `StandardMaterial`, `NodeMaterial`, and any subclass of {@link Material})
 * counts as one: they all go through the base constructor and
 * {@link Material.dispose}.
 *
 * ```ts
 * const before = liveMaterialCount();
 * const material = new UnlitMaterial();
 * liveMaterialCount() - before; // 1
 * material.dispose();
 * liveMaterialCount(); // === before
 * ```
 *
 * Reading it allocates nothing and costs one property read. A material that
 * is collected without `dispose()` is never subtracted — that is the leak
 * signal, not an oversight.
 */
export function liveMaterialCount(): number {
  return liveMaterials;
}
