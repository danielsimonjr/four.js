/**
 * Scene ⇄ document (§79) — the component-serializer registry, the writer, and
 * the reader (plan P11-1).
 *
 * `format.ts` defines what a scene document *is*; this module is the pair of
 * functions that turn a live scene graph into one ({@link serializeScene}) and
 * back ({@link instantiateScene}), plus the registry that decides how components
 * cross that boundary.
 *
 * ## Why components go through a registry
 *
 * §79 says components "serialize under registered type names; plugins register
 * theirs (§81)", and the dependency matrix (plan §3.1) makes that the only
 * possible design: `@four/serialization` may depend on `core`, `math`, and
 * `scene` only, so it can never name `RigidBody`, an animation component, or an
 * application's own. Each package (or the application wiring them together)
 * registers a serializer for the components it owns, keyed by the component
 * class's `static readonly typeName` — the §6a registry key, which §79 makes the
 * serialization name too. This package ships the serializers for the components
 * it *can* see: `PoseTarget` (§19, §42), which lives in `@four/scene`.
 *
 * ## The registry drives the writer, too (decision, WP-11.1)
 *
 * `Node` exposes `addComponent` / `getComponent` / `removeComponent` and no way
 * to *enumerate* what is attached — §6a's `ComponentRegistry` is private to the
 * node. So the writer cannot walk a node's components; it walks the
 * **serializer** registry instead and probes each registered type with
 * `node.getComponent(type)`. Two consequences, both deliberate and both worth
 * stating out loud:
 *
 * - components appear in the document in **registration order**, which is
 *   deterministic for a given registry (ground rule 5: insertion order) but is
 *   not the node's own attach order, which nothing can observe;
 * - a component whose type has **no registered serializer is not saved, and the
 *   omission cannot be detected here**. A save that silently drops state is the
 *   one failure mode this design cannot warn about; closing it needs a component
 *   enumeration on `Node` (`@four/scene`, not this packet's files).
 *   **Staged 2026-08-02 (P11-1).**
 *
 * The reading side has no such blind spot: an unknown component type in a
 * document is visible, and {@link InstantiateSceneOptions.unknownComponents}
 * decides whether it throws (the default) or is skipped.
 *
 * ## Node types
 *
 * A node's `type` is `"scene"` for a `Scene` and `"group"` for a `Group` —
 * matched by **exact class identity**, not `instanceof`. A subclass is not a
 * `Group` for this purpose: writing `class Mesh extends Group {}` out as
 * `"group"` would reload it as a plain group and lose everything that made it a
 * mesh, silently. Applications map their own classes through
 * {@link SerializeSceneOptions.nodeTypeOf} and reconstruct them through
 * {@link InstantiateSceneOptions.nodeFactory}; a node with no mapping is a
 * `FourError`, never a silent downgrade.
 *
 * ## Identity (§79)
 *
 * §79 requires that "node and resource ids are stable: they serialize with the
 * scene, and deserialization restores them (the engine assigns ids only to newly
 * created objects)". `Node.id` is `readonly` and assigned from `@four/scene`'s
 * monotonic counter at construction; `node.ts` anticipates this exact packet
 * ("that restore path needs a construction-time id … it belongs to the
 * serialization packet, which will widen the constructor"), but WP-11.1 may not
 * edit `@four/scene`, so {@link instantiateScene} restores the saved id by
 * writing the instance's own `id` property directly — see `restoreNodeId`. The
 * *proper* mechanism is still a widened `Node` constructor, and the known
 * boundary of the current one is recorded there.
 */

import { FourError, type Component, type ComponentType } from "@four/core";
import type { Quaternion, Vector3 } from "@four/math";
import { Group, Node, PoseTarget, Scene, type Transform } from "@four/scene";

import {
  SCENE_FORMAT_VERSION,
  asJsonObject,
  isJsonArray,
  isJsonObject,
  validateQuaternionDocument,
  validateSceneDocument,
  validateVector3Document,
  type ComponentDocument,
  type JsonObject,
  type JsonValue,
  type SceneDocument,
  type SceneNodeDocument,
  type TransformDocument,
} from "./format.js";

/** The `type` a `Scene` (§46) serializes as. */
export const SCENE_NODE_TYPE = "scene";

/** The `type` a `Group` (§6, §104) serializes as. */
export const GROUP_NODE_TYPE = "group";

// --- component serializers ---------------------------------------------------

/**
 * How one component type crosses the document boundary (§79).
 *
 * Declared with method syntax on purpose: TypeScript's methods are bivariant in
 * their parameters, which is what lets a `ComponentSerializer<PoseTarget>` be
 * stored in a registry that hands out `ComponentSerializer<Component>`. The
 * substitution is sound here because the registry is keyed by `typeName`, so the
 * component a serializer is handed is always an instance of the very class it
 * was registered with.
 */
export interface ComponentSerializer<T extends Component> {
  /**
   * Produces the component's payload. Must return representable JSON — the
   * document validator refuses anything else, naming the field.
   */
  serialize(component: T): JsonValue;
  /**
   * Rebuilds the component from a payload.
   *
   * `node` is the node the component is about to be attached to, for the rare
   * component that needs it while constructing. Attaching is the caller's job:
   * {@link instantiateScene} calls `node.addComponent` on the returned instance.
   * A deserializer that attaches it itself is harmless — §6a's registry treats
   * re-adding the same instance as a no-op — but it is not required.
   */
  deserialize(data: JsonValue, node: Node): T;
}

interface RegisteredSerializer {
  readonly type: ComponentType<Component>;
  readonly serializer: ComponentSerializer<Component>;
}

/**
 * The per-type component serializers a document is read and written with
 * (§79, §81).
 *
 * Keyed by the component class's `typeName`; iteration — and therefore the
 * order components appear in a document — is registration order.
 *
 * ```ts
 * const registry = createDefaultComponentSerializers();
 * registry.register(RigidBody, {
 *   serialize: (body) => ({ kind: body.kind }),
 *   deserialize: (data) => new RigidBody(readKind(data)),
 * });
 * ```
 */
export class ComponentSerializerRegistry {
  /** `Map` preserves insertion order (ground rule 5). */
  readonly #entries = new Map<string, RegisteredSerializer>();

  /**
   * Registers `serializer` for the component class `type`, keyed by its
   * `typeName` (§6a, §79). Returns `this` so registrations chain.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` if the class carries no
   * `typeName`, or if that name is already registered — a silent overwrite would
   * make the shape of a document depend on module evaluation order. Build a
   * fresh registry to serialize a type differently.
   */
  register<T extends Component>(
    type: ComponentType<T>,
    serializer: ComponentSerializer<T>,
  ): this {
    const typeName: unknown = type.typeName;
    if (typeof typeName !== "string" || typeName === "") {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "Component class is missing a usable `static readonly typeName` (plan D2); it cannot be serialized (§79).",
        { context: { typeName } },
      );
    }
    if (this.#entries.has(typeName)) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `A serializer for component type ${JSON.stringify(typeName)} is already registered (§79).`,
        { context: { typeName } },
      );
    }
    this.#entries.set(typeName, { type, serializer });
    return this;
  }

  /** Whether a serializer is registered under `typeName`. */
  has(typeName: string): boolean {
    return this.#entries.has(typeName);
  }

  /** Number of registered serializers. */
  get size(): number {
    return this.#entries.size;
  }

  /** Registered `typeName`s in registration order. */
  get typeNames(): IterableIterator<string> {
    return this.#entries.keys();
  }

  /**
   * The document entries for every registered component type attached to
   * `node`, in registration order.
   *
   * Probing beats enumeration only because `Node` offers no enumeration; see the
   * module documentation for what that costs.
   */
  serializeComponents(node: Node): ComponentDocument[] {
    const documents: ComponentDocument[] = [];
    for (const entry of this.#entries.values()) {
      const component = node.getComponent(entry.type);
      if (component === undefined) {
        continue;
      }
      documents.push({
        type: entry.type.typeName,
        data: entry.serializer.serialize(component),
      });
    }
    return documents;
  }

  /**
   * Rebuilds one component from its document, or returns `undefined` when no
   * serializer is registered for its type. Attaching is the caller's job.
   */
  deserializeComponent(
    document: ComponentDocument,
    node: Node,
  ): Component | undefined {
    const entry = this.#entries.get(document.type);
    if (entry === undefined) {
      return undefined;
    }
    return entry.serializer.deserialize(document.data, node);
  }
}

/**
 * The `PoseTarget` (§19, §42) serializer.
 *
 * Stores the target pose only. `previousPosition` / `previousRotation` are the
 * finite-difference history of a *running* simulation, and §79 keeps simulation
 * state out of a static scene definition ("physics state, animation state, and
 * replay data must be separate optional sections"), so the history is not
 * written; on load it is seeded to the restored pose (`capturePrevious`), which
 * is the same state a freshly authored target has and differences to zero
 * velocity rather than to a spurious spike.
 *
 * Scale is absent because `PoseTarget` has none (P7-1: a solver body has no
 * scale to blend against).
 */
export const POSE_TARGET_SERIALIZER: ComponentSerializer<PoseTarget> = {
  serialize(component: PoseTarget): JsonValue {
    return {
      position: vector3Json(component.position),
      rotation: quaternionJson(component.rotation),
    };
  },
  deserialize(data: JsonValue): PoseTarget {
    const record = asJsonObject(data, "pose-target");
    const target = new PoseTarget();
    if (record.position !== undefined) {
      const position = validateVector3Document(
        record.position,
        "pose-target.position",
      );
      target.position.set(position.x, position.y, position.z);
    }
    if (record.rotation !== undefined) {
      const rotation = validateQuaternionDocument(
        record.rotation,
        "pose-target.rotation",
      );
      target.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
    // Seed the history to the restored pose; see the doc comment above.
    target.capturePrevious();
    return target;
  },
};

/**
 * A registry holding the serializers this package ships — `PoseTarget` today.
 *
 * A fresh instance per call, never a shared singleton: registries are mutable,
 * and two applications (or two tests) registering their own component types must
 * not see each other's.
 */
export function createDefaultComponentSerializers(): ComponentSerializerRegistry {
  return new ComponentSerializerRegistry().register(
    PoseTarget,
    POSE_TARGET_SERIALIZER,
  );
}

// --- transforms --------------------------------------------------------------

function vector3Json(v: Vector3): JsonObject {
  return { x: v.x, y: v.y, z: v.z };
}

function quaternionJson(q: Quaternion): JsonObject {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/**
 * The raw (pre-canonical) transform document for `transform`. Defaults are
 * dropped by `validateSceneDocument`, which every writer output passes through.
 */
function serializeTransform(transform: Transform): Record<string, unknown> {
  const document: Record<string, unknown> = {
    position: vector3Json(transform.position),
    rotation: quaternionJson(transform.rotation),
    scale: vector3Json(transform.scale),
    pivot: vector3Json(transform.pivot),
  };
  if (!transform.matrixAutoUpdate) {
    // §7: the user owns the matrix, and the authored position/rotation/scale no
    // longer describe the node. Both are recorded — the matrix because it is the
    // node's actual pose, the authored values because they are its stored state.
    document.matrixAutoUpdate = false;
    document.localMatrix = Array.from(transform.localMatrix.elements);
  }
  return document;
}

/**
 * Writes `document` into `transform`, restoring absent fields to their §7
 * defaults.
 *
 * Values are restored exactly as stored — no renormalization of the quaternion,
 * no recomposition of a user-owned matrix — so a round trip is bit-for-bit.
 * Exported because a {@link InstantiateSceneOptions.nodeFactory} that builds a
 * node from more than the base document may want to apply the transform itself.
 */
export function applyTransformDocument(
  document: TransformDocument | undefined,
  transform: Transform,
): void {
  const position = document?.position;
  transform.position.set(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0);
  const rotation = document?.rotation;
  transform.rotation.set(
    rotation?.x ?? 0,
    rotation?.y ?? 0,
    rotation?.z ?? 0,
    rotation?.w ?? 1,
  );
  const scale = document?.scale;
  transform.scale.set(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1);
  const pivot = document?.pivot;
  transform.pivot.set(pivot?.x ?? 0, pivot?.y ?? 0, pivot?.z ?? 0);

  transform.matrixAutoUpdate = document?.matrixAutoUpdate ?? true;
  if (document?.localMatrix !== undefined) {
    // Auto-update is already off (the document format forbids the pair), so
    // nothing will recompose over this; `markDirty` is what a direct write into
    // `elements` owes the version channel (§7, plan D3).
    transform.localMatrix.fromArray(document.localMatrix);
    transform.markDirty();
  }
}

// --- writing -----------------------------------------------------------------

/** Options for {@link serializeScene}. */
export interface SerializeSceneOptions {
  /**
   * The document `type` for a node this package has no name for — an
   * application's own `Node` subclass. Returning `undefined` falls back to the
   * built-in `Scene` / `Group` names, and a node with neither is a `FourError`.
   */
  readonly nodeTypeOf?: (node: Node) => string | undefined;
}

function resolveNodeType(node: Node, options: SerializeSceneOptions): string {
  const custom = options.nodeTypeOf?.(node);
  if (custom !== undefined) {
    return custom;
  }
  // Exact class identity, not `instanceof`: see the module documentation.
  const constructor = node.constructor;
  if (constructor === Scene) {
    return SCENE_NODE_TYPE;
  }
  if (constructor === Group) {
    return GROUP_NODE_TYPE;
  }
  throw new FourError(
    "INVALID_APPLICATION_STATE",
    `Node ${node.id} is a ${constructor.name}, which this scene format has no type name for; supply serializeScene's \`nodeTypeOf\` option and the matching \`nodeFactory\` on load (§79).`,
    { context: { node: node.id, nodeClass: constructor.name } },
  );
}

function serializeNode(
  node: Node,
  registry: ComponentSerializerRegistry,
  options: SerializeSceneOptions,
): Record<string, unknown> {
  const children: Record<string, unknown>[] = [];
  for (const child of node.children) {
    children.push(serializeNode(child, registry, options));
  }
  return {
    id: node.id,
    name: node.name,
    type: resolveNodeType(node, options),
    transform: serializeTransform(node.transform),
    transformAuthority: node.transformAuthority,
    visible: node.visible,
    enabled: node.enabled,
    opacity: node.opacity,
    tags: [...node.tags],
    // Validated (and refused, if it holds anything JSON cannot carry) by
    // `validateSceneDocument` below, which names the offending path.
    metadata: node.metadata,
    components: registry.serializeComponents(node),
    children,
  };
}

/**
 * Serializes the subtree rooted at `root` into a canonical §79 document.
 *
 * The document holds one root node, whose `type` records whether it was a
 * `Scene` or a `Group` so the reader rebuilds the same class. Traversal is
 * depth-first in insertion order (§6), and components appear in the registry's
 * registration order, so serializing one scene twice yields identical text
 * (§33).
 *
 * @param root the node to serialize, with its descendants
 * @param registry the component serializers to apply
 * @param options node-type mapping for application classes
 * @returns the canonical, frozen document
 * @throws FourError `INVALID_APPLICATION_STATE` for a node class with no type
 * name
 * @throws TypeError if any value cannot be represented as JSON — a `NaN` in a
 * transform, a `Map` in `metadata`, a component payload holding `undefined`
 */
export function serializeScene(
  root: Node,
  registry: ComponentSerializerRegistry,
  options: SerializeSceneOptions = {},
): SceneDocument {
  return validateSceneDocument({
    formatVersion: SCENE_FORMAT_VERSION,
    nodes: [serializeNode(root, registry, options)],
  });
}

// --- reading -----------------------------------------------------------------

/** Options for {@link instantiateScene} and {@link instantiateSceneNodes}. */
export interface InstantiateSceneOptions {
  /**
   * Constructs a node for a document this package has no class for — the
   * counterpart of {@link SerializeSceneOptions.nodeTypeOf}. Returning
   * `undefined` falls back to the built-in `"scene"` / `"group"` types, and a
   * document type with neither is a `FourError`.
   *
   * The returned node's transform, flags, tags, metadata, components, and
   * children are applied afterwards by the instantiator; the factory only has to
   * produce the right class.
   */
  readonly nodeFactory?: (document: SceneNodeDocument) => Node | undefined;
  /**
   * What to do with a component whose `type` has no registered serializer.
   *
   * `"throw"` (the default) refuses the load: an unknown component is unsaved
   * state, and continuing would hand the application a scene that is quietly
   * missing behavior. `"skip"` drops it — the right choice for a viewer or an
   * inspector that only needs the hierarchy, and the reason the choice is the
   * caller's rather than this package's.
   *
   * Note that the *document* preserves unknown component data either way (§79:
   * "capable of preserving unknown extension data"): validation keeps every
   * component entry whatever its type, so decode → encode round-trips data this
   * build cannot instantiate. Only the live scene loses it.
   */
  readonly unknownComponents?: "throw" | "skip";
}

/**
 * Restores a saved node id (§79).
 *
 * `Node.id` is `readonly` in the type system and an ordinary writable own
 * property at runtime (a class field under `useDefineForClassFields`), so the
 * write is a cast rather than a redefinition. It is confined to this one
 * function, which exists because WP-11.1 may not edit `@four/scene`; `node.ts`
 * already names the real fix (a construction-time id parameter).
 *
 * **Known boundary:** `@four/scene`'s id counter does not know about restored
 * ids, so a node constructed *after* a load can be assigned an id a loaded node
 * already holds. Restoring into a fresh process — the normal case — is safe
 * because the counter starts below every id it ever issued. Closing it needs the
 * constructor change above. **Staged 2026-08-02 (P11-1).**
 */
function restoreNodeId(node: Node, id: string): void {
  (node as unknown as { id: string }).id = id;
}

/** A deep, *unfrozen* copy of a validated JSON value. */
function thawJson(value: JsonValue): JsonValue {
  if (isJsonArray(value)) {
    const copy: JsonValue[] = [];
    for (const entry of value) {
      copy.push(thawJson(entry));
    }
    return copy;
  }
  if (isJsonObject(value)) {
    return thawJsonObject(value);
  }
  return value;
}

function thawJsonObject(source: JsonObject): Record<string, JsonValue> {
  const copy: Record<string, JsonValue> = {};
  // `__proto__` cannot appear: `cloneJsonValue` refuses it, so this assignment
  // can never re-parent `copy` (see `format.ts`).
  for (const key of Object.keys(source)) {
    copy[key] = thawJson(source[key]);
  }
  return copy;
}

function createNode(
  document: SceneNodeDocument,
  options: InstantiateSceneOptions,
): Node {
  const custom = options.nodeFactory?.(document);
  if (custom !== undefined) {
    return custom;
  }
  if (document.type === SCENE_NODE_TYPE) {
    return new Scene();
  }
  if (document.type === GROUP_NODE_TYPE) {
    return new Group();
  }
  throw new FourError(
    "INVALID_SCENE_GRAPH",
    `Scene document uses node type ${JSON.stringify(document.type)}, which this build has no class for; supply instantiateScene's \`nodeFactory\` option (§79).`,
    { context: { type: document.type, node: document.id } },
  );
}

function instantiateNode(
  document: SceneNodeDocument,
  registry: ComponentSerializerRegistry,
  options: InstantiateSceneOptions,
): Node {
  const node = createNode(document, options);

  if (document.id !== undefined) {
    restoreNodeId(node, document.id);
  }
  node.name = document.name ?? "";
  applyTransformDocument(document.transform, node.transform);
  node.transformAuthority = document.transformAuthority ?? "manual";
  node.visible = document.visible ?? true;
  node.enabled = document.enabled ?? true;
  node.opacity = document.opacity ?? 1;
  node.tags = new Set<string>(document.tags ?? []);
  node.metadata = thawJsonObject(document.metadata ?? {});

  for (const componentDocument of document.components ?? []) {
    const component = registry.deserializeComponent(componentDocument, node);
    if (component === undefined) {
      if (options.unknownComponents === "skip") {
        continue;
      }
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `Scene document carries a component of type ${JSON.stringify(componentDocument.type)}, which has no registered serializer (§79); register one, or pass { unknownComponents: "skip" } to drop it.`,
        { context: { typeName: componentDocument.type, node: node.id } },
      );
    }
    node.addComponent(component);
  }

  for (const childDocument of document.children ?? []) {
    node.add(instantiateNode(childDocument, registry, options));
  }
  return node;
}

/**
 * Rebuilds every root node of `document`, in document order.
 *
 * @param document a validated §79 document
 * @param registry the component serializers to apply
 * @param options node factory and unknown-component policy
 * @returns the root nodes, each with its subtree attached
 * @throws FourError `INVALID_SCENE_GRAPH` for an unknown node type,
 * `INVALID_APPLICATION_STATE` for an unknown component type under the default
 * policy
 */
export function instantiateSceneNodes(
  document: SceneDocument,
  registry: ComponentSerializerRegistry,
  options: InstantiateSceneOptions = {},
): Node[] {
  const roots: Node[] = [];
  for (const nodeDocument of document.nodes) {
    roots.push(instantiateNode(nodeDocument, registry, options));
  }
  return roots;
}

/**
 * Rebuilds the single-root scene held by `document`.
 *
 * The returned node is the class the document names — a `Scene` for
 * `"scene"`, a `Group` for `"group"`, whatever
 * {@link InstantiateSceneOptions.nodeFactory} returns otherwise — so a document
 * written by {@link serializeScene} reloads as the same class it was saved
 * from.
 *
 * A document with several roots is refused rather than silently reduced to its
 * first: use {@link instantiateSceneNodes}, which returns all of them.
 *
 * @param document a validated §79 document holding exactly one root
 * @param registry the component serializers to apply
 * @param options node factory and unknown-component policy
 * @returns the root node, with its subtree attached
 * @throws FourError `INVALID_SCENE_GRAPH` if the document does not hold exactly
 * one root, or names a node type this build has no class for
 */
export function instantiateScene(
  document: SceneDocument,
  registry: ComponentSerializerRegistry,
  options: InstantiateSceneOptions = {},
): Node {
  if (document.nodes.length !== 1) {
    throw new FourError(
      "INVALID_SCENE_GRAPH",
      `Scene document holds ${String(document.nodes.length)} root nodes; instantiateScene rebuilds exactly one — use instantiateSceneNodes for the rest (§79).`,
      { context: { roots: document.nodes.length } },
    );
  }
  return instantiateNode(document.nodes[0], registry, options);
}
