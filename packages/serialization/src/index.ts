/**
 * `@four/serialization` — the §79 scene document and its §80 migrations.
 *
 * Three modules: `format.ts` is the document (types, canonical validation, JSON
 * text), `serializer.ts` turns a live scene graph into one and back through a
 * per-type component-serializer registry, and `migration.ts` upgrades older
 * documents.
 *
 * ```ts
 * const registry = createDefaultComponentSerializers();
 * const text = encodeSceneDocument(serializeScene(scene, registry));
 * // … later, possibly from an older build:
 * const document = migrateSceneDocument(JSON.parse(text), migrations);
 * const reloaded = instantiateScene(document, registry);
 * ```
 */

export const PACKAGE_NAME = "@four/serialization";

// §81's serialization-side capability tokens (RFC 0002), declared by the
// package that owns the §79/§80 registries; `@four/four`'s `plugins.ts`
// re-exports the same objects, so both import paths hand out one identity.
// Declaring a token does not reach the §96 plugin host — `capabilities.ts`
// states the boundary argument.
export { COMPONENT_SERIALIZERS, SCENE_MIGRATIONS } from "./capabilities.js";

export type {
  ComponentDocument,
  JsonObject,
  JsonValue,
  QuaternionDocument,
  SceneDocument,
  SceneNodeDocument,
  TransformDocument,
  UntrustedJsonLimits,
  Vector3Document,
} from "./format.js";
export {
  SCENE_FORMAT_VERSION,
  asJsonObject,
  cloneJsonValue,
  decodeSceneDocument,
  encodeSceneDocument,
  isJsonArray,
  isJsonObject,
  validateQuaternionDocument,
  validateSceneDocument,
  validateVector3Document,
} from "./format.js";

export type {
  MigrateSceneDocumentOptions,
  SceneMigration,
  SceneMigrationContext,
  SceneMigrationWarning,
} from "./migration.js";
export {
  SceneMigrationRegistry,
  migrateSceneDocument,
  runSceneMigrations,
} from "./migration.js";

export type {
  ComponentSerializer,
  InstantiateSceneOptions,
  SerializeSceneOptions,
  UnknownComponentPolicy,
} from "./serializer.js";
export {
  ComponentSerializerRegistry,
  GROUP_NODE_TYPE,
  POSE_TARGET_SERIALIZER,
  SCENE_NODE_TYPE,
  applyTransformDocument,
  createDefaultComponentSerializers,
  instantiateScene,
  instantiateSceneNodes,
  serializeScene,
} from "./serializer.js";
