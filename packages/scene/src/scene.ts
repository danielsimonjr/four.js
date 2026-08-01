/**
 * `Scene` (§6, §46, §104) — the root node, plus the indexed lookups of §46.
 *
 * ## Lookups
 *
 * §46 requires lookup by id, name, type, tag, and component. Each `find*`
 * returns the **first match or `null`**, where "first" is the depth-first,
 * insertion-ordered walk of {@link Node.traverse} — the same order everything
 * else in the engine uses, so a query's result is stable and deterministic
 * (§33).
 *
 * Two decisions the specification leaves open:
 *
 * - **The scene node is included in its own search.** A scene has a name, tags,
 *   metadata, and components like any other node, so excluding it would make
 *   `scene.findByName(scene.name)` return `null` — a surprise, and one that
 *   would force callers to special-case the root. Callers that want strictly
 *   descendants can search a child.
 * - **No `findAll*` variants.** §46 shows only the singular form, and a
 *   plural form has an unforced design question attached (allocate an array,
 *   fill a caller-supplied array, or return an iterator — §7b's `out` policy
 *   says the engine-internal answer is the second). It is deferred rather than
 *   guessed; nothing in Phase 1 needs it.
 *
 * The searches are linear walks with early exit. §46's word "indexed" describes
 * the intended end state, not this packet: an id/name/tag index has to be kept
 * live across every `add`/`remove`/`tags.add`, and the last of those is not
 * observable through a plain `Set`. Building the index before anything measures
 * it would be speculative; the walk is correct and allocation-free today.
 *
 * ## Selector syntax
 *
 * `scene.query("Mesh.dynamic[visible=true]")` (§46) is **not implemented** —
 * see the TODO below.
 */

import type { Component, ComponentType } from "@four/core";

import { Node, type NodeType } from "./node.js";

/**
 * Depth-first, insertion-ordered search with early exit. Module-private so the
 * recursion carries no `this`.
 */
function findFirst(
  root: Node,
  predicate: (node: Node) => boolean,
): Node | null {
  if (predicate(root)) {
    return root;
  }
  for (const child of root.children) {
    const found = findFirst(child, predicate);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

export class Scene extends Node {
  // TODO(§46, Phase 7+): selector syntax —
  //   `query(selector: string): Node | null` / `queryAll(selector: string)`
  // parsing `"Mesh.dynamic[visible=true]"` (type . tag [attribute = value]).
  // Deliberately absent: the grammar, its escaping rules, and its interaction
  // with layers are undefined by §46, and inventing them here would pin a
  // public API by accident. The plan defers it past Phase 1 (WP-1.8).

  /** The node whose {@link Node.id} is `id`, or `null` (§46). */
  findById(id: string): Node | null {
    return findFirst(this, (node) => node.id === id);
  }

  /**
   * The first node named `name`, or `null` (§46). Names are not unique; with
   * duplicates this returns the first in traversal order.
   */
  findByName(name: string): Node | null {
    return findFirst(this, (node) => node.name === name);
  }

  /** The first node carrying `tag`, or `null` (§46). */
  findByTag(tag: string): Node | null {
    return findFirst(this, (node) => node.tags.has(tag));
  }

  /**
   * The first node that is an `instanceof type`, or `null` (§46). Subclasses
   * match their bases, so `findByType(Node)` matches the scene itself.
   */
  findByType<T extends Node>(type: NodeType<T>): T | null {
    return findFirst(this, (node) => node instanceof type) as T | null;
  }

  /**
   * The first node carrying a component of `componentType`, or `null` (§46).
   * Returns the **node**, not the component — §46's example
   * (`scene.findByComponent(RigidBody)`) is a node query; read the component
   * back with `node.getComponent(componentType)`.
   */
  findByComponent<T extends Component>(
    componentType: ComponentType<T>,
  ): Node | null {
    return findFirst(
      this,
      (node) => node.getComponent(componentType) !== undefined,
    );
  }
}
