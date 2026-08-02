/**
 * The §79 scene document — its types, its JSON encoding, and its canonical
 * validation (plan P11-1).
 *
 * §79 fixes the goals a scene file has to meet: *versioned; deterministic;
 * backend-independent; schema-validatable; diff-friendly; extensible; capable of
 * preserving unknown extension data*, with node ids that "serialize with the
 * scene" and components that "serialize under registered type names". This
 * module is that document written down as a type plus the three operations a
 * document needs: **validate** an arbitrary value into canonical form, **encode**
 * it to text, and **decode** text back into it. Producing one from a live scene
 * graph is `serializer.ts`'s job; upgrading an older one is `migration.ts`'s.
 *
 * ## What the document holds — and what it deliberately does not
 *
 * A node carries its identity, its name, its type name, its transform, its §42
 * transform authority, the §6 display flags (`visible`, `enabled`, `opacity`),
 * its tags, its free-form metadata, its components, and its children. That is
 * everything `Node` itself owns.
 *
 * It does **not** carry subclass state — a camera's field of view, a mesh's
 * geometry reference, a sprite's texture key. `@four/serialization` may depend
 * on `core`, `math`, and `scene` only (plan §3.1), so it cannot even name those
 * types, and inventing a schema for them here would pin an API this packet may
 * not open. Subclass state belongs in a component (which *is* covered, through
 * the registry) or in a later revision of this format; until then a subclass
 * node round-trips its `Node` half only, and `instantiateScene`'s `nodeFactory`
 * is the seam through which an application reconstructs the rest.
 * **Staged 2026-08-02 (P11-1 MVP).**
 *
 * Physics state, animation state, and replay data are likewise absent — §79
 * requires exactly that ("separate optional sections so static scene definitions
 * remain clean"); the §34 replay document in `@four/diagnostics` is the sibling
 * format that carries simulation state.
 *
 * ## Canonical form
 *
 * {@link validateSceneDocument} does not merely check a document — it rebuilds
 * it, field by field, in a fixed key order, dropping every field it does not
 * know and every field that already holds its default. So one scene has exactly
 * one spelling, `encodeSceneDocument(decodeSceneDocument(text)) === text` for
 * every document this package produced, and
 * `serialize(instantiate(serialize(scene)))` is textually identical to
 * `serialize(scene)` — the round-trip gate of plan P11-1. Dropping unknown keys
 * is also what keeps a `__proto__` — or any other injected field — out of the
 * objects handed to the instantiator.
 *
 * ## Numbers
 *
 * Every number is finite: `NaN` and `±Infinity` are refused rather than written,
 * because `JSON.stringify` turns them into `null` and a scene that reloads with
 * a `null` position is a defect discovered far from its cause. `-0` is
 * normalized to `0`, matching `JSON.stringify` and the §33 checksum's treatment
 * of the two zeros. Angles are radians and times are seconds throughout (§7a);
 * this format contains neither, but the math types it stores are authored in
 * those units.
 */

import { FourError } from "@four/core";
import {
  DEFAULT_TRANSFORM_AUTHORITY,
  TRANSFORM_AUTHORITIES,
  type TransformAuthority,
} from "@four/scene";

/**
 * Any value JSON can carry, losslessly.
 *
 * **Transcribed, not imported.** `@four/diagnostics` declares the same type for
 * the §34 replay document, and its `cloneJsonValue` is the precedent this
 * module's validation follows — but the dependency matrix (plan §3.1) puts
 * `@four/serialization` above `core`, `math`, and `scene` only, and
 * `@four/diagnostics` sits beside it rather than beneath it. Copying twelve
 * lines is the honest cost of that boundary; hoisting one `JsonValue` into
 * `@four/core` is the fix, and it needs an owner decision because it widens a
 * published package's surface (backlog, 2026-08-02).
 *
 * Component payloads and node metadata are typed with this rather than
 * `unknown`: a scene file is JSON, so a value that cannot survive
 * `JSON.stringify` unchanged (a `Date`, a `Map`, `undefined`, a function, `NaN`)
 * is not serializable, and it is better to say so in the type than to discover
 * it as a silent `null` after a reload.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A JSON object — the shape of component payloads and node metadata. */
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * The scene-format version this build writes and is willing to read.
 *
 * §80 makes scene-format versioning independent of package semantic versioning,
 * so this number moves only when the document's *shape* changes, and every bump
 * ships a migration (`migration.ts`) from the version before it. A document
 * declaring any other version is refused by {@link validateSceneDocument} and
 * has to go through {@link runSceneMigrations} first.
 */
export const SCENE_FORMAT_VERSION = 1;

/** A `Vector3` as three finite numbers (§7a: right-handed, +Y up). */
export interface Vector3Document {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A `Quaternion` as four finite numbers; not renormalized on either side. */
export interface QuaternionDocument {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/**
 * A node's local transform (§7).
 *
 * Every field is optional and **absent means default**: the identity transform
 * serializes to `{}` (and is then dropped from the node entirely), which is what
 * makes a hand-edited scene file readable and its diffs small (§79).
 *
 * `matrixAutoUpdate: false` is §7's user-owned matrix: the authored
 * position/rotation/scale/pivot are still recorded (they are the node's stored
 * state, stale or not — §7 never back-derives them) and {@link
 * TransformDocument.localMatrix} carries the sixteen column-major elements the
 * user wrote. A document that supplies `localMatrix` while leaving
 * `matrixAutoUpdate` at its default is refused rather than silently stripped:
 * under auto-update the engine owns that matrix and would recompose over it.
 */
export interface TransformDocument {
  /** Local translation; absent means the origin. */
  readonly position?: Vector3Document;
  /** Local rotation; absent means identity. */
  readonly rotation?: QuaternionDocument;
  /** Local scale; absent means `(1, 1, 1)`. */
  readonly scale?: Vector3Document;
  /** Pivot the rotation and scale act about; absent means the node origin. */
  readonly pivot?: Vector3Document;
  /** Absent means `true` — the engine owns the local matrix (§7). */
  readonly matrixAutoUpdate?: boolean;
  /** Sixteen column-major elements; only with `matrixAutoUpdate: false`. */
  readonly localMatrix?: readonly number[];
}

/**
 * One component of a node (§6a, §79).
 *
 * `type` is the component class's `static readonly typeName` — §6a's registry
 * key, which §79 makes the serialization name too. `data` is whatever that
 * type's registered serializer produced; this module treats it as opaque JSON
 * and neither reads nor rewrites it, which is how a document carries component
 * data for types the reading build has never heard of.
 */
export interface ComponentDocument {
  /** The component class's `typeName` (§6a). */
  readonly type: string;
  /** The serializer's payload; `null` when the component has no state. */
  readonly data: JsonValue;
}

/**
 * One node of the scene tree (§6, §79).
 *
 * Optional fields are absent at their defaults, exactly as in
 * {@link TransformDocument}. `id` is optional because a *hand-authored* document
 * may leave identity to the engine; a document this package writes always
 * carries one, because §79 requires that a deserialized node keep the id it was
 * saved with.
 */
export interface SceneNodeDocument {
  /** Stable node id (§6, §79); unique within the document. */
  readonly id?: string;
  /** Human-readable name (§6); absent means `""`. */
  readonly name?: string;
  /** The node's type name — `"scene"`, `"group"`, or an application's own. */
  readonly type: string;
  /** Local transform (§7); absent means the identity transform. */
  readonly transform?: TransformDocument;
  /** Which system owns the transform (§42); absent means `"manual"`. */
  readonly transformAuthority?: TransformAuthority;
  /** §6 visibility; absent means `true`. */
  readonly visible?: boolean;
  /** §6 enablement; absent means `true`. */
  readonly enabled?: boolean;
  /** §6 opacity; absent means `1`. Not range-checked, as `Node` does not clamp. */
  readonly opacity?: number;
  /** §6 tags in insertion order, without duplicates; absent means none. */
  readonly tags?: readonly string[];
  /** §6 free-form user data; absent means empty. Must be representable JSON. */
  readonly metadata?: JsonObject;
  /** Components in registration order (§6a); absent means none. */
  readonly components?: readonly ComponentDocument[];
  /** Children in insertion order (§6); absent means none. */
  readonly children?: readonly SceneNodeDocument[];
}

/**
 * A complete §79 scene document.
 *
 * Directly `JSON.stringify`-able: every field is JSON already. `nodes` holds the
 * document's **root** nodes — one for a document written by `serializeScene`,
 * which serializes a single subtree; the array shape is what lets a document
 * carry several roots at all, and `instantiateSceneNodes` reads them back.
 */
export interface SceneDocument {
  /** Always {@link SCENE_FORMAT_VERSION} for a document this build accepted. */
  readonly formatVersion: number;
  /** The document's root nodes, in order. */
  readonly nodes: readonly SceneNodeDocument[];
}

// --- JSON payloads ----------------------------------------------------------

/**
 * Validates a value as JSON and returns a deep-frozen copy of it.
 *
 * Transcribed from `@four/diagnostics`'s `cloneJsonValue` (see {@link JsonValue}
 * for why it is a copy) with one deliberate strengthening: a `__proto__` own key
 * is **refused** rather than copied. `JSON.parse` makes `__proto__` an ordinary
 * own property, and copying it with `copy[key] = …` would run the inherited
 * setter and re-parent the fresh object instead of storing a key — silently
 * losing the value and handing the rest of the engine an object with a
 * surprising prototype. Nothing legitimate needs that key, so the document
 * refuses it and every consumer downstream (`instantiateScene`'s metadata copy
 * in particular) can assign keys without a guard.
 *
 * Values are copied rather than referenced because a caller usually hands over a
 * live object; a document that kept the reference would not be a snapshot.
 * `-0` is normalized to `0`.
 *
 * @param value the value to validate and copy
 * @param path a dotted path used in error messages, e.g. `"metadata"`
 * @returns a frozen deep copy
 * @throws TypeError if the value is not representable JSON
 */
export function cloneJsonValue(value: unknown, path = "value"): JsonValue {
  return cloneJson(value, path, new Set<object>());
}

function cloneJson(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): JsonValue {
  if (value === null) {
    return null;
  }
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `${path} is ${String(value)}, which JSON cannot represent (it would round-trip as null).`,
        );
      }
      return value === 0 ? 0 : value;
    case "object":
      break;
    default:
      throw new TypeError(
        `${path} is a ${typeof value}, which JSON cannot represent.`,
      );
  }
  // Narrowed to a non-null object by the switch above.
  const object = value;
  if (ancestors.has(object)) {
    throw new TypeError(`${path} is a circular reference.`);
  }
  ancestors.add(object);
  try {
    if (Array.isArray(object)) {
      const source = object as readonly unknown[];
      const copy: JsonValue[] = [];
      for (let i = 0; i < source.length; i += 1) {
        copy.push(cloneJson(source[i], `${path}[${String(i)}]`, ancestors));
      }
      return Object.freeze(copy);
    }
    const prototype = Object.getPrototypeOf(object) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `${path} is ${Object.prototype.toString.call(object)}, not a plain object; JSON cannot represent it losslessly.`,
      );
    }
    const source = object as Record<string, unknown>;
    const copy: Record<string, JsonValue> = {};
    // Own enumerable string keys in insertion order (plan §1) — the same set
    // and order `JSON.stringify` would emit.
    for (const key of Object.keys(source)) {
      if (key === "__proto__") {
        throw new TypeError(
          `${path} has a "__proto__" key, which no scene document may carry (it would re-parent the object it was copied into).`,
        );
      }
      const entry = source[key];
      if (entry === undefined) {
        throw new TypeError(
          `${path}.${key} is undefined; JSON would drop the key.`,
        );
      }
      copy[key] = cloneJson(entry, `${path}.${key}`, ancestors);
    }
    return Object.freeze(copy);
  } finally {
    ancestors.delete(object);
  }
}

// --- primitive validators ---------------------------------------------------

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  return value as readonly unknown[];
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string.`);
  }
  return value;
}

function asNonEmptyString(value: unknown, path: string): string {
  const text = asString(value, path);
  if (text === "") {
    throw new TypeError(`${path} must not be empty.`);
  }
  return text;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${path} must be a boolean.`);
  }
  return value;
}

/** A finite number with `-0` normalized to `0`. */
function asFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value === 0 ? 0 : value;
}

/**
 * Validates a value as three finite numbers.
 *
 * Exported because component serializers (§79 registers them per type) store
 * positions and directions constantly, and re-deriving this check per package
 * would be the same six lines with different error messages.
 *
 * @param value the candidate `{ x, y, z }`
 * @param path a dotted path used in error messages
 * @returns the frozen, canonical vector document
 * @throws TypeError if a component is missing or not finite
 */
export function validateVector3Document(
  value: unknown,
  path: string,
): Vector3Document {
  const record = asRecord(value, path);
  return Object.freeze({
    x: asFiniteNumber(record.x, `${path}.x`),
    y: asFiniteNumber(record.y, `${path}.y`),
    z: asFiniteNumber(record.z, `${path}.z`),
  });
}

/**
 * Validates a value as four finite numbers.
 *
 * The quaternion is **not** renormalized: a document stores what it was given
 * and restores it bit for bit, so a round trip cannot quietly change a rotation.
 *
 * @param value the candidate `{ x, y, z, w }`
 * @param path a dotted path used in error messages
 * @returns the frozen, canonical quaternion document
 * @throws TypeError if a component is missing or not finite
 */
export function validateQuaternionDocument(
  value: unknown,
  path: string,
): QuaternionDocument {
  const record = asRecord(value, path);
  return Object.freeze({
    x: asFiniteNumber(record.x, `${path}.x`),
    y: asFiniteNumber(record.y, `${path}.y`),
    z: asFiniteNumber(record.z, `${path}.z`),
    w: asFiniteNumber(record.w, `${path}.w`),
  });
}

/**
 * Whether a JSON value is an array.
 *
 * A named guard rather than a bare `Array.isArray`: the standard library types
 * that predicate as `arg is any[]`, which does not narrow a `readonly` array out
 * of a union, and {@link JsonValue}'s array member is `readonly`.
 */
export function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** Whether a JSON value is an object — neither `null` nor an array. */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !isJsonArray(value);
}

/**
 * Validates a value as a JSON object and returns a deep-frozen copy.
 *
 * The object form of {@link cloneJsonValue}, exported for the same reason as
 * {@link validateVector3Document}: a component serializer's payload is nearly
 * always an object, and its `deserialize` has to say so before reading fields.
 *
 * @param value the candidate object
 * @param path a dotted path used in error messages
 * @returns the frozen deep copy
 * @throws TypeError if the value is not a plain JSON object
 */
export function asJsonObject(value: unknown, path: string): JsonObject {
  const clone = cloneJsonValue(value, path);
  if (!isJsonObject(clone)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return clone;
}

// --- document validation ----------------------------------------------------

/** §42's authorities as a lookup, so validation states the vocabulary once. */
const AUTHORITIES = new Set<string>(TRANSFORM_AUTHORITIES);

function validateTransform(value: unknown, path: string): TransformDocument {
  const record = asRecord(value, path);
  const canonical: Record<string, unknown> = {};

  if (record.position !== undefined) {
    const position = validateVector3Document(
      record.position,
      `${path}.position`,
    );
    if (position.x !== 0 || position.y !== 0 || position.z !== 0) {
      canonical.position = position;
    }
  }
  if (record.rotation !== undefined) {
    const rotation = validateQuaternionDocument(
      record.rotation,
      `${path}.rotation`,
    );
    if (
      rotation.x !== 0 ||
      rotation.y !== 0 ||
      rotation.z !== 0 ||
      rotation.w !== 1
    ) {
      canonical.rotation = rotation;
    }
  }
  if (record.scale !== undefined) {
    const scale = validateVector3Document(record.scale, `${path}.scale`);
    if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) {
      canonical.scale = scale;
    }
  }
  if (record.pivot !== undefined) {
    const pivot = validateVector3Document(record.pivot, `${path}.pivot`);
    if (pivot.x !== 0 || pivot.y !== 0 || pivot.z !== 0) {
      canonical.pivot = pivot;
    }
  }

  const matrixAutoUpdate =
    record.matrixAutoUpdate === undefined
      ? true
      : asBoolean(record.matrixAutoUpdate, `${path}.matrixAutoUpdate`);
  if (!matrixAutoUpdate) {
    canonical.matrixAutoUpdate = false;
  }

  if (record.localMatrix !== undefined) {
    if (matrixAutoUpdate) {
      throw new TypeError(
        `${path}.localMatrix is only recorded with "matrixAutoUpdate": false; with auto-update on the engine owns the local matrix and would recompose over it (§7).`,
      );
    }
    const source = asArray(record.localMatrix, `${path}.localMatrix`);
    if (source.length !== 16) {
      throw new TypeError(
        `${path}.localMatrix must hold 16 column-major elements (got ${String(source.length)}).`,
      );
    }
    const elements: number[] = [];
    for (let i = 0; i < source.length; i += 1) {
      elements.push(
        asFiniteNumber(source[i], `${path}.localMatrix[${String(i)}]`),
      );
    }
    canonical.localMatrix = Object.freeze(elements);
  }

  return Object.freeze(canonical);
}

function validateComponents(
  value: unknown,
  path: string,
): readonly ComponentDocument[] {
  const source = asArray(value, path);
  const components: ComponentDocument[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < source.length; i += 1) {
    const entryPath = `${path}[${String(i)}]`;
    const entry = asRecord(source[i], entryPath);
    const type = asNonEmptyString(entry.type, `${entryPath}.type`);
    if (seen.has(type)) {
      throw new TypeError(
        `${entryPath}.type is ${JSON.stringify(type)}, which this node already carries; a node holds at most one component of a given type (§6a).`,
      );
    }
    seen.add(type);
    components.push(
      Object.freeze({
        type,
        data:
          entry.data === undefined
            ? null
            : cloneJsonValue(entry.data, `${entryPath}.data`),
      }),
    );
  }
  return Object.freeze(components);
}

function validateTags(value: unknown, path: string): readonly string[] {
  const source = asArray(value, path);
  const tags: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < source.length; i += 1) {
    const tag = asNonEmptyString(source[i], `${path}[${String(i)}]`);
    if (seen.has(tag)) {
      throw new TypeError(
        `${path}[${String(i)}] repeats the tag ${JSON.stringify(tag)}; tags are a set (§6).`,
      );
    }
    seen.add(tag);
    tags.push(tag);
  }
  return Object.freeze(tags);
}

function validateNode(
  value: unknown,
  path: string,
  ids: Set<string>,
): SceneNodeDocument {
  const record = asRecord(value, path);
  const canonical: Record<string, unknown> = {};

  if (record.id !== undefined) {
    const id = asNonEmptyString(record.id, `${path}.id`);
    if (ids.has(id)) {
      throw new TypeError(
        `${path}.id is ${JSON.stringify(id)}, which another node in this document already uses; node ids are unique and references resolve by id (§79).`,
      );
    }
    ids.add(id);
    canonical.id = id;
  }
  if (record.name !== undefined) {
    const name = asString(record.name, `${path}.name`);
    if (name !== "") {
      canonical.name = name;
    }
  }
  canonical.type = asNonEmptyString(record.type, `${path}.type`);

  if (record.transform !== undefined) {
    const transform = validateTransform(record.transform, `${path}.transform`);
    if (Object.keys(transform).length > 0) {
      canonical.transform = transform;
    }
  }
  if (record.transformAuthority !== undefined) {
    const authority = asString(
      record.transformAuthority,
      `${path}.transformAuthority`,
    );
    if (!AUTHORITIES.has(authority)) {
      throw new TypeError(
        `${path}.transformAuthority is ${JSON.stringify(authority)}; expected one of ${TRANSFORM_AUTHORITIES.join(", ")} (§42).`,
      );
    }
    if (authority !== DEFAULT_TRANSFORM_AUTHORITY) {
      canonical.transformAuthority = authority;
    }
  }
  if (record.visible !== undefined) {
    const visible = asBoolean(record.visible, `${path}.visible`);
    if (!visible) {
      canonical.visible = false;
    }
  }
  if (record.enabled !== undefined) {
    const enabled = asBoolean(record.enabled, `${path}.enabled`);
    if (!enabled) {
      canonical.enabled = false;
    }
  }
  if (record.opacity !== undefined) {
    const opacity = asFiniteNumber(record.opacity, `${path}.opacity`);
    if (opacity !== 1) {
      canonical.opacity = opacity;
    }
  }
  if (record.tags !== undefined) {
    const tags = validateTags(record.tags, `${path}.tags`);
    if (tags.length > 0) {
      canonical.tags = tags;
    }
  }
  if (record.metadata !== undefined) {
    const metadata = asJsonObject(record.metadata, `${path}.metadata`);
    if (Object.keys(metadata).length > 0) {
      canonical.metadata = metadata;
    }
  }
  if (record.components !== undefined) {
    const components = validateComponents(
      record.components,
      `${path}.components`,
    );
    if (components.length > 0) {
      canonical.components = components;
    }
  }
  if (record.children !== undefined) {
    const source = asArray(record.children, `${path}.children`);
    if (source.length > 0) {
      const children: SceneNodeDocument[] = [];
      for (let i = 0; i < source.length; i += 1) {
        children.push(
          validateNode(source[i], `${path}.children[${String(i)}]`, ids),
        );
      }
      canonical.children = Object.freeze(children);
    }
  }

  return Object.freeze(canonical) as unknown as SceneNodeDocument;
}

/**
 * Validates an arbitrary value as a §79 scene document and returns it in
 * canonical form.
 *
 * The result is a fresh, deep-frozen document holding *only* the fields this
 * format defines, in a fixed key order, with every default omitted — so
 * re-encoding it is byte-stable and no unknown field from an untrusted document
 * survives into the instantiator.
 *
 * @param value the candidate document (typically `JSON.parse` output)
 * @returns the canonical, frozen document
 * @throws FourError `SERIALIZATION_VERSION_MISMATCH` if `formatVersion` is not
 * {@link SCENE_FORMAT_VERSION} — run the value through `runSceneMigrations`
 * (§80) first
 * @throws TypeError if any field is missing, mistyped, or out of range; the
 * message names the field's path
 */
export function validateSceneDocument(value: unknown): SceneDocument {
  const record = asRecord(value, "document");
  const formatVersion = asFiniteNumber(
    record.formatVersion,
    "document.formatVersion",
  );
  if (formatVersion !== SCENE_FORMAT_VERSION) {
    throw new FourError(
      "SERIALIZATION_VERSION_MISMATCH",
      `Scene document declares formatVersion ${String(formatVersion)}; this build reads ${String(SCENE_FORMAT_VERSION)} only. Migrate it first (§80).`,
      {
        context: { expected: SCENE_FORMAT_VERSION, found: formatVersion },
      },
    );
  }
  const source = asArray(record.nodes, "document.nodes");
  const ids = new Set<string>();
  const nodes: SceneNodeDocument[] = [];
  for (let i = 0; i < source.length; i += 1) {
    nodes.push(validateNode(source[i], `document.nodes[${String(i)}]`, ids));
  }
  return Object.freeze({
    formatVersion: SCENE_FORMAT_VERSION,
    nodes: Object.freeze(nodes),
  });
}

/**
 * Serializes a document to its JSON text, validating it on the way out.
 *
 * Compact rather than indented: the text is a wire and storage format, and a
 * caller who wants it readable can `JSON.stringify(document, null, 2)` — the
 * document is a plain JSON value, and its key order is already canonical.
 *
 * @param document the document to encode
 * @returns compact JSON text in canonical key order
 * @throws FourError / TypeError exactly as {@link validateSceneDocument}
 */
export function encodeSceneDocument(document: SceneDocument): string {
  return JSON.stringify(validateSceneDocument(document));
}

/**
 * Parses and validates JSON text as a §79 scene document.
 *
 * @param text JSON text, typically read from a `.four.json` file (§79)
 * @returns the canonical, frozen document
 * @throws SyntaxError if the text is not JSON; then exactly as
 * {@link validateSceneDocument}
 */
export function decodeSceneDocument(text: string): SceneDocument {
  return validateSceneDocument(JSON.parse(text) as unknown);
}
