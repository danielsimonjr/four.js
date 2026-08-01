/**
 * The unified node model (§6), its component delegation (§6a), and its event
 * surface (§6b).
 *
 * `Node` is the one base class of the scene graph: 2D shapes, 3D meshes, text,
 * UI, rigid-body hosts, and particle emitters are all nodes, and everything a
 * node *does* beyond hierarchy and transform arrives either as a subclass or —
 * preferably — as a component (§6a). The base class therefore stays
 * lightweight: hierarchy, transform, identity, visibility, tags, metadata,
 * components, events.
 *
 * ## Inheritance (plan D1)
 *
 * `abstract class Node extends EventEmitter<NodeEventMap>` — single
 * inheritance, no mixins. Components are **composed**, not inherited: every
 * node owns a private `ComponentRegistry` (`@four/core`) and delegates
 * `addComponent` / `getComponent` / `removeComponent` to it, passing *itself*
 * as the registry's host. `@four/core` cannot name `Node` (the dependency runs
 * the other way, plan §3.1), so it describes the host structurally as
 * `ComponentHost`; `Node` implements that interface, which is what makes
 * `component.host` the owning node at runtime. §6a's `Component.node` is that
 * same reference under core's package-neutral name.
 *
 * ## Events (§6b)
 *
 * Nodes emit through the shared `EventEmitter`, so all four §6b rules
 * (unsubscriber return, registration-order dispatch, mutation-takes-effect-next
 * -dispatch, no self re-entrancy) hold here without restatement. This packet
 * defines only the two structural events, `added` and `removed`; see
 * {@link NodeEventMap} for how later packets widen the map.
 */

import {
  ComponentRegistry,
  EventEmitter,
  FourError,
  type Component,
  type ComponentHost,
  type ComponentType,
} from "@four/core";

import {
  DEFAULT_TRANSFORM_AUTHORITY,
  type TransformAuthority,
} from "./authority.js";
import { Transform } from "./transform.js";

/**
 * Payload of the `added` and `removed` events.
 *
 * `node` is the node whose parentage changed — always the emitter, since both
 * events fire on the child (see {@link Node.add}). `parent` is the node it was
 * added to, or the node it was removed from.
 */
export interface NodeHierarchyEvent {
  readonly node: Node;
  readonly parent: Node;
}

/**
 * Events every node emits.
 *
 * Deliberately minimal — this packet owns only the structural pair. The map is
 * an `interface` precisely so it is a **widening point**: later packets add
 * their keys here (or, for out-of-package events, by declaration merging), and
 * every `Node` subclass inherits the widened map because plan D1 fixes the base
 * class as `EventEmitter<NodeEventMap>` with no generic parameter of its own.
 * A subclass that needs private event types therefore adds them to this map
 * rather than re-parameterizing the emitter.
 */
export interface NodeEventMap {
  /** Fired on a node after it has been attached to a new parent. */
  added: NodeHierarchyEvent;
  /** Fired on a node after it has been detached from its parent. */
  removed: NodeHierarchyEvent;
}

/**
 * A node class usable with `instanceof` — the argument shape of
 * `Scene.findByType` (§46).
 *
 * `abstract new` so abstract bases (`Node` itself, and later `Camera`) can be
 * passed; `never` parameters so the type accepts any node class without
 * inviting anyone to construct one from it.
 */
export type NodeType<T extends Node> = abstract new (...args: never[]) => T;

/**
 * Source of engine-assigned node ids.
 *
 * Monotonic and process-wide: id assignment is part of the deterministic
 * construction order (§33 forbids `Math.random` and wall-clock derivation
 * outright, and a counter makes two identical construction sequences produce
 * identical ids). Never reset — a reused id would alias two nodes in
 * serialized references (§79).
 */
let nextNodeId = 1;

function assignNodeId(): string {
  const id = `node-${String(nextNodeId)}`;
  nextNodeId += 1;
  return id;
}

export abstract class Node
  extends EventEmitter<NodeEventMap>
  implements ComponentHost
{
  /**
   * Stable identity (§6). Engine-assigned at construction from a monotonic
   * counter, formatted `node-<n>`; ids are unique within a process and
   * ascending in construction order.
   *
   * `readonly`, as §6 requires. §79 additionally requires that a *deserialized*
   * node keep the id it was saved with ("the engine assigns ids only to newly
   * created objects"); that restore path needs a construction-time id and is
   * deliberately not invented here — it belongs to the serialization packet,
   * which will widen the constructor.
   */
  readonly id: string = assignNodeId();

  /** Human-readable name (§6); not unique and not an identity. Empty by default. */
  name = "";

  /** Local transform (§7). Never replaced — write into it. */
  readonly transform: Transform = new Transform();

  /** Whether this node renders (§6). Default `true`. */
  visible = true;

  /** Whether this node participates in simulation and updates (§6). Default `true`. */
  enabled = true;

  /** Opacity in [0, 1] (§6). Default `1`. Not clamped here. */
  opacity = 1;

  /** Free-form tags, queried by `Scene.findByTag` (§46). Empty by default. */
  tags: Set<string> = new Set<string>();

  /** Free-form user data (§6). Its own object per node. */
  metadata: Record<string, unknown> = {};

  #parent: Node | null = null;

  /**
   * Backing store for {@link Node.transformAuthority}. Declared before the
   * accessor pair reads it; `"manual"` per §42/{@link DEFAULT_TRANSFORM_AUTHORITY}.
   */
  #transformAuthority: TransformAuthority = DEFAULT_TRANSFORM_AUTHORITY;

  /** Insertion-ordered children; the array instance is never replaced. */
  readonly #children: Node[] = [];

  /**
   * Components attached to this node (§6a). The registry receives `this` as its
   * host, so `component.host` — §6a's `Component.node` — is this node.
   */
  readonly #components: ComponentRegistry = new ComponentRegistry(this);

  /**
   * This node's parent, or `null` when it is a root (§6).
   *
   * Assignment is supported and is defined in terms of the hierarchy methods:
   * `node.parent = other` is `other.add(node)` (including its cycle check and
   * its detach-from-the-old-parent step) and `node.parent = null` is
   * `oldParent.remove(node)`. It is never a bare field write, because a bare
   * write could not keep the two children arrays consistent.
   */
  get parent(): Node | null {
    return this.#parent;
  }

  set parent(value: Node | null) {
    if (value === this.#parent) {
      return;
    }
    if (value === null) {
      this.#parent?.remove(this);
      return;
    }
    value.add(this);
  }

  /**
   * Children in insertion order (§6).
   *
   * The live array is returned as a `readonly` view rather than a copy, so
   * reading children allocates nothing on hot paths. It is a view, not a
   * snapshot: it reflects later mutations, and casting the `readonly` away to
   * mutate it corrupts the parent pointers this class maintains.
   */
  get children(): readonly Node[] {
    return this.#children;
  }

  // --- Transform authority (§42) --------------------------------------------

  /**
   * Which system owns this node's transform (§42). Default `"manual"`.
   *
   * §42 spells this as a plain assignable field —
   * `node.transformAuthority = "physics"` — and structurally it is exactly
   * that: read it, write it, one value at a time. It is implemented as an
   * accessor pair over a private field for one reason: `"blended"` is declared
   * by §42 but implemented by §19's physics-animation pipeline, which is Phase
   * 7 work. Assigning it therefore throws `FourError("NOT_IMPLEMENTED")` rather
   * than leaving a node in a state no system knows how to drive; the reserved
   * value stays visible in the type (and in `TRANSFORM_AUTHORITIES`) so
   * nothing has to be renumbered when Phase 7 lands and the guard is deleted.
   * Every other value assigns normally, and a rejected assignment leaves the
   * previous authority in place.
   *
   * Enforcement lives in the writing systems (see `warnAuthorityConflict`), not
   * here: `Node` records ownership, systems honour it.
   */
  get transformAuthority(): TransformAuthority {
    return this.#transformAuthority;
  }

  set transformAuthority(value: TransformAuthority) {
    if (value === "blended") {
      throw new FourError(
        "NOT_IMPLEMENTED",
        'The "blended" transform authority selects the §19 ' +
          "physics-animation blending pipeline, which is not implemented " +
          "yet (Phase 7).",
        { context: { node: this.id, authority: value } },
      );
    }
    this.#transformAuthority = value;
  }

  /**
   * Attaches `nodes` as children, in argument order, appending each to the end
   * of {@link Node.children}. Returns `this`.
   *
   * Rules:
   * - **Cycles (§85).** Adding a node to itself, or to any of its own
   *   descendants, throws `FourError("INVALID_SCENE_GRAPH")`. Nothing is
   *   attached for that argument.
   * - **Reparenting.** A node that already has a parent is detached from it
   *   first, which fires `removed` on the node before `added` fires.
   * - **Re-adding.** Adding a node that is already a child of this node is a
   *   no-op: it keeps its current index and fires no event. (Decision — the
   *   alternative, move-to-end, would make `add` silently reorder siblings and
   *   emit a spurious `removed`/`added` pair; callers that want a new index can
   *   `remove` then `add`.)
   * - **Partial application.** Arguments are validated and attached one at a
   *   time, so a throw on the third argument leaves the first two attached.
   *   The graph is always left consistent; it is not rolled back.
   */
  add(...nodes: Node[]): this {
    for (const node of nodes) {
      if (node === this) {
        throw new FourError(
          "INVALID_SCENE_GRAPH",
          "A node cannot be added to itself (§85: scene graph cycles).",
          { context: { node: node.id } },
        );
      }
      if (node.#isAncestorOf(this)) {
        throw new FourError(
          "INVALID_SCENE_GRAPH",
          "A node cannot be added to one of its own descendants " +
            "(§85: scene graph cycles).",
          { context: { node: node.id, parent: this.id } },
        );
      }
      if (node.#parent === this) {
        continue;
      }
      const previousParent = node.#parent;
      if (previousParent !== null) {
        previousParent.#detach(node);
      }
      this.#children.push(node);
      node.#parent = this;
      node.emit("added", { node, parent: this });
    }
    return this;
  }

  /**
   * Detaches `nodes` from this node, in argument order. Returns `this`.
   *
   * Removing a node that is not a child of this node is a no-op — no throw, no
   * event (decision: removal is idempotent, so teardown paths can call it
   * without first testing parentage).
   */
  remove(...nodes: Node[]): this {
    for (const node of nodes) {
      if (node.#parent === this) {
        this.#detach(node);
      }
    }
    return this;
  }

  /**
   * Calls `visitor` on this node, then on every descendant, depth-first in
   * insertion order (§6).
   *
   * Children are read live by index rather than from a snapshot, so the walk
   * allocates nothing; the price is that structurally mutating the hierarchy
   * from inside `visitor` is not supported (removing the current node's
   * successor skips it). Collect first, mutate after.
   *
   * Recursive, so depth is bounded by the JS stack — scene graphs thousands of
   * levels deep are out of scope.
   */
  traverse(visitor: (node: Node) => void): void {
    visitor(this);
    for (let i = 0; i < this.#children.length; i += 1) {
      this.#children[i].traverse(visitor);
    }
  }

  // --- Components (§6a, ComponentHost) -------------------------------------

  /**
   * Attaches `component` to this node (§6a), replacing any component of the
   * same type (with a development warning) and running `onAttach` with this
   * node as the host. Returns the component.
   */
  addComponent<T extends Component>(component: T): T {
    return this.#components.add(component);
  }

  /** The attached component of `type`, or `undefined` (§6a). */
  getComponent<T extends Component>(type: ComponentType<T>): T | undefined {
    return this.#components.get(type);
  }

  /**
   * Detaches `component`, running its `onDetach`; returns `false` when it is
   * not the component currently attached for its type. Detaching does not
   * dispose (§6a).
   */
  removeComponent(component: Component): boolean {
    return this.#components.remove(component);
  }

  // --- internals ------------------------------------------------------------

  /**
   * True when this node is `candidate` or one of its ancestors — the cycle
   * test of {@link Node.add}, walking up from `candidate` so the cost is the
   * candidate's depth rather than the subtree size.
   */
  #isAncestorOf(candidate: Node): boolean {
    for (let n: Node | null = candidate; n !== null; n = n.#parent) {
      if (n === this) {
        return true;
      }
    }
    return false;
  }

  /**
   * Removes `child` (assumed to be a child of this node) and fires `removed`
   * **on the child**, after the mutation is complete: a listener always
   * observes the final `parent`/`children` state, never an intermediate one.
   *
   * Neither `added` nor `removed` is re-emitted on ancestors (decision, §6b:
   * "all other events fire on their emitter only" — only input events
   * propagate through the graph, §72). A listener that needs to watch a whole
   * subtree subscribes per node.
   */
  #detach(child: Node): void {
    const index = this.#children.indexOf(child);
    if (index === -1) {
      return;
    }
    this.#children.splice(index, 1);
    child.#parent = null;
    child.emit("removed", { node: child, parent: this });
  }
}
