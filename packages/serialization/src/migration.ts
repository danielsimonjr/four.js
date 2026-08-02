/**
 * Scene migration (§80) — the registry of upgrade steps and the chain runner
 * that applies them (plan P11-1).
 *
 * §80 requires that "scene format versioning is independent from package
 * semantic versioning" and that migrations be *explicit; testable;
 * deterministic; capable of producing warnings for lossy changes; composable
 * across multiple versions*. That is exactly this module: each step is a plain
 * function registered against the version it upgrades **from**, the runner walks
 * them in order, and every step is handed a {@link SceneMigrationContext} whose
 * `warn` is how a lossy change announces itself.
 *
 * ```ts
 * const migrations = new SceneMigrationRegistry();
 * migrations.registerMigration(0, (document, context) => {
 *   context.warn("v0 layer indices are dropped; layers moved to tags.");
 *   return { nodes: [document.root as JsonValue] };
 * });
 *
 * const document = migrateSceneDocument(JSON.parse(text), migrations, {
 *   onWarning: (warning) => { console.warn(warning.message); },
 * });
 * ```
 *
 * ## One step per version, and gaps are errors
 *
 * A step registered for version *n* upgrades to *n + 1* — never further. Two
 * reasons: a chain of single steps is the only shape in which "composable across
 * multiple versions" is *checkable* (the runner can say precisely which link is
 * missing), and it removes every question about which of two overlapping paths a
 * document takes, which §80's "deterministic" forbids. A missing link is a
 * `SERIALIZATION_VERSION_MISMATCH` naming the version, not a silent pass-through
 * of a document nobody upgraded.
 *
 * The runner — not the step — stamps `formatVersion` after each link, so a
 * migration author cannot forget it. Carrying the old stamp through (the
 * `{ ...document }` a step almost always starts from) is fine, and so is
 * stamping the new one explicitly; a *third* value is refused rather than
 * overridden, because a step that claims to produce version 7 while sitting in
 * the 0 → 1 link is a bug, and silently preferring one of the two numbers would
 * hide it.
 *
 * ## Steps are pure
 *
 * A step receives a deep-frozen document and returns a new one. Freezing is not
 * ceremony: the runner clones and revalidates between links anyway, so a step
 * that mutated its input would have its mutation discarded — better to fail at
 * the write than to leave an author debugging a migration that "does nothing".
 */

import { FourError } from "@four/core";

import {
  SCENE_FORMAT_VERSION,
  asJsonObject,
  validateSceneDocument,
  type JsonObject,
  type SceneDocument,
} from "./format.js";

/** What a migration step is told about the link it is performing (§80). */
export interface SceneMigrationContext {
  /** The version of the document handed to the step. */
  readonly fromVersion: number;
  /** The version the step's result is stamped with — always `fromVersion + 1`. */
  readonly toVersion: number;
  /**
   * Reports a lossy change (§80). Purely informational: the message reaches the
   * caller through {@link MigrateSceneDocumentOptions.onWarning} and nothing in
   * the engine reads it, so it should say what was dropped and what replaced it.
   */
  warn(message: string): void;
}

/**
 * One upgrade step (§80): a pure function from a document at `fromVersion` to
 * the same scene at `fromVersion + 1`.
 */
export type SceneMigration = (
  document: JsonObject,
  context: SceneMigrationContext,
) => JsonObject;

/** A lossy-change report raised by a step. */
export interface SceneMigrationWarning {
  /** The version the step upgraded from. */
  readonly fromVersion: number;
  /** The version the step upgraded to. */
  readonly toVersion: number;
  /** The step's message. */
  readonly message: string;
}

/**
 * The registered upgrade steps (§80), keyed by the version each upgrades from.
 *
 * An instance rather than a module-level singleton: migrations are application
 * (and test) state, and a shared mutable chain would make one suite's
 * registration visible to the next.
 */
export class SceneMigrationRegistry {
  readonly #steps = new Map<number, SceneMigration>();

  /**
   * Registers `migrate` as the step from `fromVersion` to `fromVersion + 1`.
   * Returns `this` so registrations chain.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` if `fromVersion` is not a
   * non-negative safe integer, or if a step is already registered for it —
   * replacing one silently would make the upgrade path depend on module
   * evaluation order, which §80's "deterministic" forbids.
   */
  registerMigration(fromVersion: number, migrate: SceneMigration): this {
    if (!Number.isSafeInteger(fromVersion) || fromVersion < 0) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `A scene migration's fromVersion must be a non-negative safe integer (got ${String(fromVersion)}).`,
        { context: { fromVersion } },
      );
    }
    if (this.#steps.has(fromVersion)) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `A scene migration from version ${String(fromVersion)} is already registered (§80).`,
        { context: { fromVersion } },
      );
    }
    this.#steps.set(fromVersion, migrate);
    return this;
  }

  /** Whether a step upgrading from `fromVersion` is registered. */
  has(fromVersion: number): boolean {
    return this.#steps.has(fromVersion);
  }

  /** The step upgrading from `fromVersion`, or `undefined`. */
  get(fromVersion: number): SceneMigration | undefined {
    return this.#steps.get(fromVersion);
  }

  /** The registered `fromVersion`s in ascending order. */
  get versions(): readonly number[] {
    return [...this.#steps.keys()].sort((a, b) => a - b);
  }
}

/** Options for {@link runSceneMigrations} and {@link migrateSceneDocument}. */
export interface MigrateSceneDocumentOptions {
  /**
   * The version to upgrade to; {@link SCENE_FORMAT_VERSION} by default. A
   * document already at that version is returned unchanged (validated, in
   * `migrateSceneDocument`'s case), and a *newer* one is refused — this build
   * cannot know what a later format means, and §80 defines upgrades only.
   */
  readonly targetVersion?: number;
  /** Called for each lossy-change report a step raises (§80). */
  readonly onWarning?: (warning: SceneMigrationWarning) => void;
}

/** Reads and checks a candidate document's declared `formatVersion`. */
function readFormatVersion(document: JsonObject): number {
  const version = document.formatVersion;
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 0
  ) {
    throw new TypeError(
      `document.formatVersion must be a non-negative safe integer (got ${JSON.stringify(version)}).`,
    );
  }
  return version;
}

/**
 * Runs the registered chain over `value` until it reaches the target version
 * (§80), without validating the result against the current schema.
 *
 * The document is deep-copied and validated as JSON on the way in, and again
 * after every step, so a step that returns something JSON cannot carry fails at
 * that step rather than at the end of the chain.
 *
 * @param value the candidate document (typically `JSON.parse` output)
 * @param registry the registered upgrade steps
 * @param options target version and lossy-change reporting
 * @returns the migrated document, at `targetVersion`
 * @throws FourError `SERIALIZATION_VERSION_MISMATCH` if the document is newer
 * than the target, or if a link in the chain is missing
 * @throws TypeError if the document is not representable JSON, declares no
 * usable `formatVersion`, or a step returns something that is not a JSON object
 * (or one whose `formatVersion` is neither the version it was handed nor the
 * version it produces)
 */
export function runSceneMigrations(
  value: unknown,
  registry: SceneMigrationRegistry,
  options: MigrateSceneDocumentOptions = {},
): JsonObject {
  const targetVersion = options.targetVersion ?? SCENE_FORMAT_VERSION;
  if (!Number.isSafeInteger(targetVersion) || targetVersion < 0) {
    throw new TypeError(
      `targetVersion must be a non-negative safe integer (got ${String(targetVersion)}).`,
    );
  }

  let document = asJsonObject(value, "document");
  const startVersion = readFormatVersion(document);
  if (startVersion > targetVersion) {
    throw new FourError(
      "SERIALIZATION_VERSION_MISMATCH",
      `Scene document declares formatVersion ${String(startVersion)}, which is newer than the target ${String(targetVersion)}; scene migrations upgrade only (§80).`,
      { context: { expected: targetVersion, found: startVersion } },
    );
  }

  for (
    let fromVersion = startVersion;
    fromVersion < targetVersion;
    fromVersion += 1
  ) {
    const toVersion = fromVersion + 1;
    const migrate = registry.get(fromVersion);
    if (migrate === undefined) {
      throw new FourError(
        "SERIALIZATION_VERSION_MISMATCH",
        `No scene migration is registered from format version ${String(fromVersion)} to ${String(toVersion)}; the upgrade path from ${String(startVersion)} to ${String(targetVersion)} has a gap (§80).`,
        { context: { fromVersion, toVersion, targetVersion } },
      );
    }
    const context: SceneMigrationContext = {
      fromVersion,
      toVersion,
      warn(message: string): void {
        options.onWarning?.({ fromVersion, toVersion, message });
      },
    };
    const migrated = asJsonObject(
      migrate(document, context),
      `migration ${String(fromVersion)} → ${String(toVersion)} result`,
    );
    if (
      migrated.formatVersion !== undefined &&
      migrated.formatVersion !== fromVersion &&
      migrated.formatVersion !== toVersion
    ) {
      throw new TypeError(
        `The migration from version ${String(fromVersion)} returned a document declaring formatVersion ${JSON.stringify(migrated.formatVersion)}; it upgrades to ${String(toVersion)}. Leave the field alone — the runner stamps it.`,
      );
    }
    document = Object.freeze({ ...migrated, formatVersion: toVersion });
  }

  return document;
}

/**
 * Upgrades `value` to the current scene format and validates it (§79, §80).
 *
 * The one call a loader needs: it accepts a document of any version the
 * registered chain can reach {@link SCENE_FORMAT_VERSION} from — including the
 * current version, which passes straight through to validation — and returns a
 * canonical {@link SceneDocument} ready for `instantiateScene`.
 *
 * @param value the candidate document (typically `JSON.parse` output)
 * @param registry the registered upgrade steps
 * @param options lossy-change reporting (`targetVersion` is ignored: the result
 * has to be a document *this* build can validate)
 * @returns the canonical, frozen document at {@link SCENE_FORMAT_VERSION}
 * @throws FourError / TypeError exactly as {@link runSceneMigrations}, then as
 * `validateSceneDocument`
 */
export function migrateSceneDocument(
  value: unknown,
  registry: SceneMigrationRegistry,
  options: Omit<MigrateSceneDocumentOptions, "targetVersion"> = {},
): SceneDocument {
  return validateSceneDocument(
    runSceneMigrations(value, registry, {
      ...options,
      targetVersion: SCENE_FORMAT_VERSION,
    }),
  );
}
