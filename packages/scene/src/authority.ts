/**
 * Transform authority (§42).
 *
 * §42's rule is short and absolute: **exactly one system owns a node's
 * transform at a time**, and "the engine must prevent multiple systems from
 * silently overwriting the same transform". This module holds the vocabulary
 * for that ownership ({@link TransformAuthority}) and the enforcement primitive
 * every writing system shares ({@link warnAuthorityConflict}); the field itself
 * lives on `Node` (§42 writes `node.transformAuthority = "physics"`), see
 * `Node.transformAuthority`.
 *
 * ## What enforcement means here (decision, WP-2.3)
 *
 * §42 says conflicts "should produce development warnings" and that a warning
 * "fires whenever a system writes a transform it does not own". A warning alone
 * would still leave the transform overwritten — the very thing §42's first
 * sentence forbids — so the engine pairs the two halves: **the owner keeps the
 * transform and the non-owner's write is refused**. A refused write is loud
 * (a `console.warn`) and lossless in the other direction: nothing about the
 * owner's state is touched, so authority conflicts can never corrupt a
 * simulation, only stall the system that mis-declared itself.
 *
 * The check belongs to the *writer*, not to `Transform`: transforms are written
 * through plain math methods on hot paths (`transform.position.set(...)`,
 * plan D3), and gating every one of those on an ownership test would put a
 * branch inside the innermost loop in the engine and still be trivially
 * bypassable. Each system instead tests once per node per step, immediately
 * before it would write — the shape {@link warnAuthorityConflict} is built for.
 *
 * ## Deduplication (§42: *development* warnings)
 *
 * A conflicting system conflicts every fixed step — 60 identical lines per
 * second per node is noise that hides the first one. Warnings are therefore
 * emitted **once per node per writing authority** and suppressed afterwards,
 * tracked in a module-level `WeakMap` keyed by node so the bookkeeping dies
 * with the node and holds nothing alive. Two different authorities fighting
 * over one node produce two warnings, which is the point: each names a distinct
 * mis-configured system.
 *
 * `writer` is a {@link TransformAuthority} rather than a free-form system name
 * (decision, WP-2.3) because §42 identifies writers by the authority they claim
 * — `MotionSystem` writes as `"kinematic"`, a solver as `"physics"` — which
 * keeps the value typo-checked and makes the suppression key the same
 * vocabulary as the field being violated. Two systems that both claim
 * `"kinematic"` over one node therefore share a suppression slot; they are, by
 * §42's model, the same writer.
 *
 * There is no build-mode flag in the engine yet (diagnostics arrive in a later
 * phase), so the warning is unconditional, exactly as §6a's component-replacement
 * warning is in `@four/core`.
 */

/**
 * The slice of `Node` this module reads — identity for the warning text plus
 * the owning {@link TransformAuthority} (§42).
 *
 * Structural rather than `import type { Node }` on purpose: `node.ts` imports
 * this module at runtime (for {@link DEFAULT_TRANSFORM_AUTHORITY}), so naming
 * the class here — even type-only — would close an import cycle between the
 * two files. Every `Node` satisfies this shape, and TypeScript's structural
 * typing means callers pass their nodes exactly as before.
 */
export interface AuthorityNode {
  /** `Node.id` — stable identity for the warning and its suppression. */
  readonly id: string;
  /** `Node.name` — empty when unnamed; used only to label the warning. */
  readonly name: string;
  /** `Node.transformAuthority` — the §42 owner being violated. */
  readonly transformAuthority: TransformAuthority;
}

/**
 * Which system owns a node's transform (§42).
 *
 * Listed in §42's order. Meanings, per §42 and §19:
 *
 * - `"manual"` — application code owns it; the default for a new node.
 * - `"animation"` — an animation clip or timeline drives it.
 * - `"kinematic"` — a kinematic/procedural controller drives it
 *   (`MotionSystem`, and the §12 controller of WP-2.5).
 * - `"physics"` — a solver drives it; the transform follows the rigid body.
 * - `"blended"` — the §19 physics-animation pipeline is the single owner; blend
 *   weights vary *inside* that pipeline without changing ownership. Assignable
 *   since WP-7.3, which built that pipeline into `PhysicsWorld`
 *   (`@four/physics`, plan P7-4); between WP-2.3 and WP-7.3 assigning it threw
 *   `FourError("NOT_IMPLEMENTED")`, because no system could have driven such a
 *   node. A `"blended"` node needs two more things `@four/scene` cannot see: a
 *   `RigidBody` registered with a `PhysicsWorld`, and a `PoseTarget` for
 *   animation to write. The world raises the first step that finds the target
 *   missing; a node registered with no world at all is simply a node nothing
 *   drives, which is true of every authority whose system was never wired up.
 * - `"constraint"` — a constraint/IK solve owns the final pose.
 * - `"network"` — the transform is externally replicated. §42 makes this an
 *   enabler only; transport and replication protocols are out of scope (§5).
 */
export type TransformAuthority =
  | "manual"
  | "animation"
  | "kinematic"
  | "physics"
  | "blended"
  | "constraint"
  | "network";

/**
 * Every {@link TransformAuthority} value, in §42's declaration order.
 *
 * Exported so validation, serialization (§79), and tests can enumerate the
 * authorities without restating the union. `satisfies` makes every entry a
 * checked member of {@link TransformAuthority} — an invented value is a compile
 * error — while `as const` keeps the literal types; completeness and ordering
 * are asserted in `tests/authority.test.ts` against §42.
 */
export const TRANSFORM_AUTHORITIES = [
  "manual",
  "animation",
  "kinematic",
  "physics",
  "blended",
  "constraint",
  "network",
] as const satisfies readonly TransformAuthority[];

/**
 * The authority a node has until something claims it: `"manual"`, i.e. owned by
 * application code. A node nobody has claimed is not owned by a *system*, so
 * direct writes from user code are always legal and never warn.
 */
export const DEFAULT_TRANSFORM_AUTHORITY: TransformAuthority = "manual";

/**
 * Nodes already warned about, per writing authority. `WeakMap` so a node that
 * goes away takes its suppression record with it, and `Set` values so the
 * per-writer granularity survives.
 */
const warnedWriters = new WeakMap<AuthorityNode, Set<TransformAuthority>>();

/**
 * Reports that `writer` tried to write the transform of `node`, which it does
 * not own (§42), and returns whether a warning was actually printed — `true`
 * the first time this `node`/`writer` pair conflicts, `false` for every
 * suppressed repeat.
 *
 * The caller is expected to **skip its write**; this function only reports.
 *
 * ```ts
 * if (node.transformAuthority !== "kinematic") {
 *   warnAuthorityConflict(node, "kinematic");
 *   continue; // the owner keeps the transform
 * }
 * ```
 */
export function warnAuthorityConflict(
  node: AuthorityNode,
  writer: TransformAuthority,
): boolean {
  let warned = warnedWriters.get(node);
  if (warned === undefined) {
    warned = new Set<TransformAuthority>();
    warnedWriters.set(node, warned);
  }
  if (warned.has(writer)) {
    return false;
  }
  warned.add(writer);

  const label = node.name === "" ? node.id : `${node.id} ("${node.name}")`;
  console.warn(
    `[four] A "${writer}" system tried to write the transform of node ` +
      `${label}, which is owned by "${node.transformAuthority}" authority; ` +
      "the write was refused (§42: exactly one system owns a node's " +
      `transform). Set node.transformAuthority = "${writer}" if that system ` +
      "should own it. Further conflicts from this writer on this node are " +
      "suppressed.",
  );
  return true;
}
