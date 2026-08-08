# @four/serialization

Scene serialization and migrations. Part of [four.js](../../README.md).

Implements §79–80 of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 11 (§113a). Documents are versioned (`SCENE_FORMAT_VERSION` = 1), canonical, and diff-friendly; round trips are byte-identical.

## What's here

- **Format** — `SceneDocument` / `SceneNodeDocument` / `ComponentDocument` types, `encodeSceneDocument` / `decodeSceneDocument` (canonical JSON text), and validators (`validateSceneDocument`, transform/vector/quaternion document validation).
- **§96 untrusted text** — `decodeSceneDocument(text, limits?)` takes `UntrustedJsonLimits` (`maximumTextLength`, `maximumDepth`; finite defaults) and refuses an over-budget or over-deep document with `UNTRUSTED_INPUT_REJECTED` before `validateNode` recurses. `validateSceneDocument` is deliberately unguarded — it takes values, not text.
- **Serializer** — `serializeScene` / `instantiateScene` over a `ComponentSerializerRegistry` keyed by component class; `createDefaultComponentSerializers` covers the built-in components (including `PoseTarget`).
- **Migrations (§80)** — `SceneMigration` / `SceneMigrationRegistry`, `migrateSceneDocument` / `runSceneMigrations`, with structured warnings.
- **JSON utilities** — `JsonValue` guards (`isJsonObject`, `isJsonArray`, `asJsonObject`) and `cloneJsonValue` (re-exported from `@four/core`, `__proto__`-refusing).

## Known boundaries / staged

- Components without a registered serializer are silently unsaved (documented boundary); restored node ids can collide with the live counter.
- §79 documents deliberately do not carry solver warm-start state — a contact-free save replays bit-identically, an in-contact save diverges only through warm-start; §34 snapshots (`@four/diagnostics`) carry that state.
- The binary `.four` format is not implemented; the JSON document is the shipped format.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/serialization`; publishes as `@danielsimonjr/fourjs-serialization`.
