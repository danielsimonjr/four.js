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
import type { Quaternion, Vector3 } from "@four/math";

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

/** The shape of an engine-assigned id: `node-` and a decimal counter value. */
const ENGINE_NODE_ID = /^node-(\d+)$/;

/**
 * Records that `id` is taken, so the counter never issues it again (§79,
 * 2026-08-06 A-17).
 *
 * §79 requires a deserialized node to keep the id it was saved with, and the
 * ids this module issues are `node-<n>` — so a load can hand back ids the
 * counter has not reached yet, and the *next* node constructed in that process
 * would be given one a loaded node already holds. `Scene.findById` would then
 * return whichever came first in traversal order, silently. Restoring into a
 * fresh process was always safe (the counter starts below every id it ever
 * issued); the in-process reload — an editor, a level restart, a replay seek —
 * is exactly the case a scene format exists to serve, and it was not.
 *
 * So every restored id is inspected: one shaped like an engine id advances the
 * counter past it, and one shaped like anything else (an application's own
 * `"player"`, a GUID) is left alone, because it can never collide with a
 * generated id in the first place. This is collision **avoidance**, not
 * detection — a document may still name the same id twice, which
 * `instantiateScene` refuses separately.
 */
function reserveNodeId(id: string): void {
  const match = ENGINE_NODE_ID.exec(id);
  if (match === null) {
    return;
  }
  const value = Number(match[1]);
  if (Number.isSafeInteger(value) && value >= nextNodeId) {
    nextNodeId = value + 1;
  }
}

function assignNodeId(id?: string): string {
  if (id !== undefined) {
    reserveNodeId(id);
    return id;
  }
  const assigned = `node-${String(nextNodeId)}`;
  nextNodeId += 1;
  return assigned;
}

/**
 * Construction options every node accepts (§6).
 *
 * Subclass option interfaces extend this, so `id` is available wherever a node
 * is constructed; a subclass whose constructor takes no options at all
 * inherits `Node`'s signature and accepts it unchanged.
 */
export interface NodeOptions {
  /**
   * The node's {@link Node.id}, for a node being **restored** rather than
   * created (§79: "the engine assigns ids only to newly created objects").
   *
   * Omit it — which is what every ordinary construction does — and the engine
   * assigns the next counter value. Supply one and it is used verbatim *and*
   * reserved, so no later node can be given the same id (2026-08-06, A-17).
   * Ids are opaque strings: the format does not require them to look like the
   * engine's own.
   */
  readonly id?: string;
}

/**
 * Writes a restored id onto an already-constructed node (§79, 2026-08-06
 * A-17) — the seam for a `nodeFactory` that built the node itself and so could
 * not pass {@link NodeOptions.id} to a constructor.
 *
 * Prefer the constructor option: it is checked, it needs no mutation of a
 * `readonly` field, and it is available to every node class. This function
 * exists because `@four/serialization`'s `nodeFactory` contract lets an
 * application construct its own classes with no id parameter at all, and §79
 * still requires those nodes to reload under their saved ids.
 *
 * It lives **here**, in the module that owns the field, rather than in the
 * package that needs it: `Node.id` is `readonly` in the type system and an
 * ordinary writable own property at runtime (a class field under
 * `useDefineForClassFields`), so writing it is a cast — and a cast at a foreign
 * class's field is exactly what a package boundary should not contain. The id
 * is reserved on the way through, so the counter cannot re-issue it.
 */
export function restoreNodeId(node: Node, id: string): void {
  reserveNodeId(id);
  (node as unknown as { id: string }).id = id;
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
   * created objects"): pass {@link NodeOptions.id} to restore one, which also
   * reserves it against the counter (2026-08-06, A-17 — the note that used to
   * stand here deferred this to the serialization packet, which shipped without
   * it).
   */
  readonly id: string;

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

  /** Insertion-ordered children; the array instance is never replaced. */
  readonly #children: Node[] = [];

  /**
   * Components attached to this node (§6a). The registry receives `this` as its
   * host, so `component.host` — §6a's `Component.node` — is this node.
   */
  readonly #components: ComponentRegistry = new ComponentRegistry(this);

  /**
   * Constructs a node (§6).
   *
   * The only base-class option is {@link NodeOptions.id}, and it is only for
   * restoring a saved node — everything else about a node is a field you assign
   * afterwards, which is what keeps `class Group extends Node {}` a complete
   * class. Subclasses that take options of their own extend
   * {@link NodeOptions} and pass the whole object up, so `new Sprite({ id })`
   * works for the same reason `new Group({ id })` does.
   */
  constructor(options: NodeOptions = {}) {
    super();
    this.id = assignNodeId(options.id);
  }

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

  // --- Transform aliases (§15/§97 idiom) ------------------------------------

  /**
   * Alias for `this.transform.position` — the same live {@link Vector3}, never
   * a copy, so `node.position.set(1, 2, 3)` and
   * `node.transform.position.set(1, 2, 3)` are one and the same write and both
   * run the transform's change hook (plan D3: the version bumps, dependent
   * caches invalidate).
   *
   * The spec writes this spelling throughout — `Four.animate(node.position)`
   * (§15), `camera.position.set(0, 2, 6)` and `label.position.set(0, 1.2, 0)`
   * (§97) — while `Transform` is where the value actually lives (§7). This
   * getter makes both spellings work, resolving the WP-3.1 ergonomics flag
   * (TODO: `Node.position/rotation/scale` aliases onto `transform.*`).
   *
   * Getter only, deliberately: `Transform.position` is a `readonly` property
   * holding a mutable vector — replacing the instance would silently drop the
   * change hook — and the alias mirrors exactly that contract. Assignment
   * (`node.position = v`) is not the API; write *into* the vector with
   * `.set(...)` / `.copy(...)`.
   *
   * Transform authority (§42) is unmoved by the spelling: a write through this
   * alias is a write to the node's transform, and a system that is not the
   * node's {@link Node.transformAuthority} must not make it either way.
   */
  get position(): Vector3 {
    return this.transform.position;
  }

  /**
   * Alias for `this.transform.rotation` — the same live {@link Quaternion},
   * never a copy. Radians semantics per §7a; getter only, for the reasons
   * documented on {@link Node.position} (mutate via quaternion methods, never
   * by assignment). Writes through it bump the transform version exactly as
   * `transform.rotation` writes do, and §42 authority applies unchanged.
   */
  get rotation(): Quaternion {
    return this.transform.rotation;
  }

  /**
   * Alias for `this.transform.scale` — the same live {@link Vector3}, never a
   * copy. Getter only, for the reasons documented on {@link Node.position}
   * (mutate via `.set(...)` / `.copy(...)`, never by assignment). Writes
   * through it bump the transform version exactly as `transform.scale` writes
   * do, and §42 authority applies unchanged.
   */
  get scale(): Vector3 {
    return this.transform.scale;
  }

  // --- Transform authority (§42) --------------------------------------------

  /**
   * Which system owns this node's transform (§42). Default `"manual"`.
   *
   * §42 spells this as a plain assignable field —
   * `node.transformAuthority = "physics"` — and that is exactly what it is:
   * read it, write it, one value at a time. **Every** value of
   * {@link TransformAuthority} assigns, `"blended"` included: it was guarded
   * by a `FourError("NOT_IMPLEMENTED")` between WP-2.3 and WP-7.3, because
   * nothing implemented §19's physics-animation pipeline and a node claiming
   * it would have been owned by a system that did not exist. `PhysicsWorld`
   * now runs that pipeline (`@four/physics`, plan P7-4), so the guard is gone
   * and the value means what §42 says it means.
   *
   * A `"blended"` node is driven by §19's pipeline, which needs two more things
   * this field cannot check for — a `RigidBody` registered with a
   * `PhysicsWorld` and a `PoseTarget` on the node. The first step that
   * tries to blend a node with no target throws `FourError` naming it; see
   * `PhysicsWorld.step`. Assigning the authority is never itself an error,
   * exactly as `"kinematic"` on a node no controller drives is not.
   *
   * Enforcement lives in the writing systems (see `warnAuthorityConflict`), not
   * here: `Node` records ownership, systems honour it.
   */
  transformAuthority: TransformAuthority = DEFAULT_TRANSFORM_AUTHORITY;

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
   * The components attached to this node, in attach order (§6a, 2026-08-06
   * A-15).
   *
   * A live iterator over the registry's own map, so reading it allocates
   * nothing and reflects the node's current state; do not attach or detach
   * while iterating (the underlying `Map` would be mutated mid-walk). Copy it
   * first — `[...node.components]` — for a snapshot.
   *
   * Enumeration exists for §79. Without it a serializer cannot walk what a node
   * *has*; it can only probe for what it knows about, and a component whose
   * type has no registered serializer is then dropped from the document with
   * nobody able to notice — a save that silently loses state, which is the one
   * failure mode that design could not warn about. `@four/serialization` walks
   * this getter and refuses an unserializable component by name.
   *
   * `ComponentHost` (§6a, `@four/core`) does not declare it: the host contract
   * is what a *component* sees of its owner, and a component enumerating its
   * siblings is not something §6a sanctions.
   */
  get components(): IterableIterator<Component> {
    return this.#components.components;
  }

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
