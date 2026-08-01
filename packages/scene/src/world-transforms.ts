/**
 * World-transform resolution (§7) — the single writer of every
 * `Transform.worldMatrix` and `Transform.worldVersion`.
 *
 * §7 says world matrices "update lazily: they are resolved before each physics
 * synchronization point (once per fixed step, §37), before render-item
 * generation (§64), and on demand for queries". This module is those three
 * entry points: {@link resolveWorldTransforms} for the two per-frame passes and
 * {@link resolveWorldTransform} for the on-demand query.
 *
 * ## What resolution computes
 *
 * For every visited node, `updateLocalMatrix()` first (lazy per `Transform`,
 * so a clean transform costs one comparison), then
 *
 * ```text
 * worldMatrix = parentWorldMatrix · localMatrix     (root: worldMatrix = localMatrix)
 * ```
 *
 * written **into** the node's existing `Matrix4` instance — never a new one — so
 * a renderer, a physics adapter, or a `Float64Array` view that captured
 * `node.transform.worldMatrix` (or its `elements`) at construction stays valid
 * forever. The product is left-multiplied in `Matrix4`'s stated order (`this` is
 * the left operand, so the child's local transform applies first and the
 * parent's second), which is the same ordering §7's composition formula uses.
 *
 * ## Version-based caching
 *
 * A node's world matrix is recomputed only when something it depends on
 * changed. Per transform the resolver remembers three things, and any
 * disagreement forces a recompute:
 *
 * | remembered | catches |
 * |---|---|
 * | the `transform.version` folded in | any local mutation — method call, `markDirty`, `setLocalMatrix` |
 * | the parent node it was folded against | reparenting, which bumps no version at all |
 * | that parent's `worldVersion` | any ancestor recompute, at any depth |
 *
 * The third entry is what propagates a change downwards: an ancestor that
 * recomputes bumps its own `worldVersion`, its children see a stamp they have
 * not folded in yet, recompute, bump theirs, and so on to the leaves. A subtree
 * with no mutation anywhere above or inside it matches on all three and is
 * skipped — {@link WorldTransformStats.recomputed} is the observable proof.
 * Because the rule is stated per node rather than "an ancestor was recomputed
 * *during this pass*", it holds identically for the whole-subtree pass and for
 * a mid-frame single-node query, and the two share their caches.
 *
 * ## Where the bookkeeping lives (decision)
 *
 * In a module-private `WeakMap<Transform, ResolveRecord>` here, **not** in new
 * `Transform` fields: `Transform` (§7) publishes a fixed shape and this is the
 * resolver's private business, exactly as its documentation says ("the resolver
 * defines what it counts"). One record is allocated per transform on its first
 * resolve and mutated in place forever after, so the steady state is one
 * `WeakMap` hit per node per pass and zero allocation. The record holds the
 * parent `Node` reference for identity; a child that is reparented and then
 * never resolved again therefore keeps its former parent reachable until its
 * next resolve, which is a bounded and deliberate trade for exact reparenting
 * detection.
 *
 * `Transform.worldVersion` is the one piece of bookkeeping that is public,
 * because dependent systems cache against it: this module defines it as a
 * **count of recomputes** — bumped by one whenever, and only whenever, this
 * module writes the world matrix. Treat it as opaque and compare it for
 * inequality, exactly like `Transform.version`; it is monotonic and never
 * wraps in any realistic session.
 */

import type { Matrix4 } from "@four/math";

import type { Node } from "./node.js";
import type { Transform } from "./transform.js";

/**
 * What one call to {@link resolveWorldTransforms} did.
 *
 * `visited` counts the nodes examined (every node of the subtree, plus the
 * entry node's ancestors); `recomputed` counts the subset whose world matrix
 * was actually rewritten. `recomputed === 0` on a pass over an unmutated scene
 * is the invariant the caching exists for, and tests assert it directly.
 */
export interface WorldTransformStats {
  /** Nodes whose caches were checked. */
  visited: number;
  /** Nodes whose `worldMatrix` and `worldVersion` were rewritten. */
  recomputed: number;
}

/** Per-transform resolver bookkeeping. Allocated once per transform, then mutated. */
interface ResolveRecord {
  /** `transform.version` at the last recompute. */
  localVersion: number;
  /** The parent node the last recompute multiplied against, or `null` for a root. */
  parent: Node | null;
  /** That parent's `worldVersion` at the last recompute; `0` for a root. */
  parentWorldVersion: number;
}

const records = new WeakMap<Transform, ResolveRecord>();

/**
 * True when `node`'s world matrix cannot be trusted: never resolved, locally
 * mutated, reparented, or sitting under an ancestor that has moved.
 */
function isStale(node: Node, record: ResolveRecord | undefined): boolean {
  if (record === undefined) {
    return true;
  }
  const parent = node.parent;
  if (
    record.parent !== parent ||
    record.localVersion !== node.transform.version
  ) {
    return true;
  }
  return (
    parent !== null &&
    record.parentWorldVersion !== parent.transform.worldVersion
  );
}

/**
 * Brings one node's world matrix up to date, assuming its ancestors already
 * are. Returns `true` when it recomputed. Allocates only the node's record, and
 * only on its first ever resolve.
 */
function resolveNode(node: Node): boolean {
  const transform = node.transform;
  transform.updateLocalMatrix();

  const record = records.get(transform);
  if (!isStale(node, record)) {
    return false;
  }

  const parent = node.parent;
  if (parent === null) {
    transform.worldMatrix.copy(transform.localMatrix);
  } else {
    transform.worldMatrix
      .copy(parent.transform.worldMatrix)
      .multiply(transform.localMatrix);
  }
  transform.worldVersion += 1;

  const parentWorldVersion =
    parent === null ? 0 : parent.transform.worldVersion;
  if (record === undefined) {
    records.set(transform, {
      localVersion: transform.version,
      parent,
      parentWorldVersion,
    });
  } else {
    record.localVersion = transform.version;
    record.parent = parent;
    record.parentWorldVersion = parentWorldVersion;
  }
  return true;
}

/**
 * Resolves `node`'s ancestors, outermost first, then `node` itself, counting
 * into `stats` when one is supplied (the query path passes `null`). Recursion
 * depth is the node's depth in the graph, and nothing is allocated along the
 * way.
 */
function resolveChain(node: Node, stats: WorldTransformStats | null): void {
  const parent = node.parent;
  if (parent !== null) {
    resolveChain(parent, stats);
  }
  const recomputed = resolveNode(node);
  if (stats !== null) {
    stats.visited += 1;
    if (recomputed) {
      stats.recomputed += 1;
    }
  }
}

/** Resolves `node`'s subtree, depth-first in insertion order (§6). */
function resolveSubtree(node: Node, stats: WorldTransformStats): void {
  stats.visited += 1;
  if (resolveNode(node)) {
    stats.recomputed += 1;
  }
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    resolveSubtree(children[i], stats);
  }
}

/**
 * Resolves the world matrix of `root` and of every node beneath it, depth-first
 * in insertion order, and returns what the pass did.
 *
 * This is the per-frame entry point: §7 requires one call per fixed step before
 * physics synchronization and one before render-item generation. Unchanged
 * subtrees are skipped (see the module documentation), so a pass over a static
 * scene is a version comparison per node and no arithmetic at all.
 *
 * `root` need not be a scene root. Passing an interior node resolves that
 * node's **ancestors** first — a no-op when they are already current — so the
 * subtree is always multiplied against a fresh parent world matrix rather than
 * a stale one; the ancestors count towards the returned stats. A true root
 * (`parent === null`) simply copies its local matrix into its world matrix.
 *
 * Pass `out` to reuse a stats object and make the call allocation-free, per the
 * §7b/D7 `out` policy — engine-internal per-frame callers always do; omitting
 * it allocates one small object for authoring convenience. `out`'s counters are
 * reset on entry, so a reused instance never accumulates across passes.
 *
 * Structurally mutating the graph from a listener during the pass is not
 * supported, for the same reason `Node.traverse` does not support it: children
 * are read live by index so that the walk allocates nothing.
 */
export function resolveWorldTransforms(
  root: Node,
  out?: WorldTransformStats,
): WorldTransformStats {
  const stats = out ?? { visited: 0, recomputed: 0 };
  stats.visited = 0;
  stats.recomputed = 0;

  const parent = root.parent;
  if (parent !== null) {
    resolveChain(parent, stats);
  }

  resolveSubtree(root, stats);
  return stats;
}

/**
 * Resolves one node's world matrix on demand and returns it — §7's third
 * resolution point, the mid-frame query.
 *
 * Correct at any time, including after a mutation that no pass has seen yet: it
 * walks up to the root, resolves each ancestor that is stale, and then the node
 * itself. Ancestors that are already current are not recomputed, and everything
 * it does compute is recorded in the same caches the full pass uses, so a query
 * makes the next pass cheaper rather than duplicating its work. Nothing below
 * the node is touched — the node's own descendants keep whatever world matrices
 * they last resolved.
 *
 * Without `out` the node's **own** `worldMatrix` instance is returned, not a
 * copy: it is live scene state, and the next resolution of that node overwrites
 * it. Read it immediately, or pass `out` to copy the value out and keep it.
 */
export function resolveWorldTransform(node: Node, out?: Matrix4): Matrix4 {
  resolveChain(node, null);

  const world = node.transform.worldMatrix;
  return out === undefined ? world : out.copy(world);
}
