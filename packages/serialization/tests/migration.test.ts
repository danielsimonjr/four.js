/**
 * Scene migration (§80), plan P11-1 — the registry, the chain runner, and its
 * refusals.
 *
 * The worked example is a **v0 → v1 upgrade**: a hypothetical first format that
 * stored a single `root` node under its own key, spelled the §42 authority
 * `authority`, and carried a `layer` index the current format has no home for.
 * The migration renames, rewraps, and reports the loss through `context.warn` —
 * §80's four requirements (explicit, testable, deterministic, warns on lossy
 * changes) in one function, with the fifth (composable) covered by the
 * multi-link chain below it.
 */

import { isFourError } from "@four/core";
import { describe, expect, it } from "vitest";

import {
  SCENE_FORMAT_VERSION,
  SceneMigrationRegistry,
  createDefaultComponentSerializers,
  instantiateScene,
  isJsonArray,
  isJsonObject,
  migrateSceneDocument,
  runSceneMigrations,
  type JsonObject,
  type JsonValue,
  type SceneMigration,
  type SceneMigrationWarning,
} from "../src/index.js";

/** A v0 document: one `root` node, `authority`, and a `layer` index. */
function v0Document(): JsonObject {
  return {
    formatVersion: 0,
    root: {
      id: "node-1",
      type: "scene",
      name: "level",
      layer: 2,
      authority: "physics",
      children: [
        {
          id: "node-2",
          type: "group",
          layer: 5,
          transform: { position: { x: 1, y: 2, z: 3 } },
        },
      ],
    },
  };
}

/** The v0 → v1 step: rewrap, rename, and report the dropped layer. */
const v0ToV1: SceneMigration = (document, context) => {
  const upgradeNode = (value: JsonValue): JsonValue => {
    if (!isJsonObject(value)) {
      return value;
    }
    const node = value;
    const upgraded: Record<string, JsonValue> = {};
    for (const key of Object.keys(node)) {
      if (key === "layer") {
        context.warn(
          `Node ${JSON.stringify(node.id ?? "?")} had layer ${JSON.stringify(node.layer)}; v1 has no layers.`,
        );
        continue;
      }
      if (key === "authority") {
        upgraded.transformAuthority = node.authority;
        continue;
      }
      if (key === "children" && isJsonArray(node.children)) {
        upgraded.children = node.children.map(upgradeNode);
        continue;
      }
      upgraded[key] = node[key];
    }
    return upgraded;
  };

  return { nodes: [upgradeNode(document.root)] };
};

function v0Registry(): SceneMigrationRegistry {
  return new SceneMigrationRegistry().registerMigration(0, v0ToV1);
}

describe("SceneMigrationRegistry", () => {
  it("reports the steps it holds, in ascending version order", () => {
    const registry = new SceneMigrationRegistry()
      .registerMigration(2, (document) => document)
      .registerMigration(0, v0ToV1);

    expect(registry.versions).toEqual([0, 2]);
    expect(registry.has(0)).toBe(true);
    expect(registry.has(1)).toBe(false);
    expect(registry.get(0)).toBe(v0ToV1);
    expect(registry.get(1)).toBeUndefined();
  });

  it("refuses a second step for one version", () => {
    const registry = v0Registry();
    let thrown: unknown;
    try {
      registry.registerMigration(0, v0ToV1);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(String(thrown)).toMatch(/already registered/);
  });

  it("refuses a fromVersion that is not a non-negative safe integer", () => {
    const registry = new SceneMigrationRegistry();
    expect(() => registry.registerMigration(-1, v0ToV1)).toThrow(
      /non-negative safe integer \(got -1\)/,
    );
    expect(() => registry.registerMigration(1.5, v0ToV1)).toThrow(
      /non-negative safe integer/,
    );
    expect(() => registry.registerMigration(Number.NaN, v0ToV1)).toThrow(
      /non-negative safe integer/,
    );
  });
});

describe("migrateSceneDocument", () => {
  it("upgrades a v0 document into a loadable v1 scene", () => {
    const warnings: SceneMigrationWarning[] = [];
    const document = migrateSceneDocument(v0Document(), v0Registry(), {
      onWarning: (warning) => warnings.push(warning),
    });

    expect(document).toEqual({
      formatVersion: SCENE_FORMAT_VERSION,
      nodes: [
        {
          id: "node-1",
          name: "level",
          type: "scene",
          transformAuthority: "physics",
          children: [
            {
              id: "node-2",
              type: "group",
              transform: { position: { x: 1, y: 2, z: 3 } },
            },
          ],
        },
      ],
    });

    // §80: lossy changes announce themselves, tagged with the link that made
    // them, in the order the step raised them.
    expect(warnings).toEqual([
      {
        fromVersion: 0,
        toVersion: 1,
        message: 'Node "node-1" had layer 2; v1 has no layers.',
      },
      {
        fromVersion: 0,
        toVersion: 1,
        message: 'Node "node-2" had layer 5; v1 has no layers.',
      },
    ]);

    const scene = instantiateScene(
      document,
      createDefaultComponentSerializers(),
    );
    expect(scene.id).toBe("node-1");
    expect(scene.children[0].transform.position.z).toBe(3);
  });

  it("passes a current document straight through to validation", () => {
    const current = {
      formatVersion: SCENE_FORMAT_VERSION,
      nodes: [{ type: "group", opacity: 1 }],
    };

    expect(migrateSceneDocument(current, new SceneMigrationRegistry())).toEqual(
      { formatVersion: SCENE_FORMAT_VERSION, nodes: [{ type: "group" }] },
    );
  });

  it("still validates the migrated document against the current schema", () => {
    const registry = new SceneMigrationRegistry().registerMigration(0, () => ({
      nodes: [{ type: "group", opacity: "half" }],
    }));

    expect(() => migrateSceneDocument({ formatVersion: 0 }, registry)).toThrow(
      /document\.nodes\[0\]\.opacity must be a finite number/,
    );
  });

  it("needs no warning sink", () => {
    expect(migrateSceneDocument(v0Document(), v0Registry()).nodes[0].id).toBe(
      "node-1",
    );
  });
});

describe("runSceneMigrations", () => {
  it("composes several links in order (§80)", () => {
    const seen: number[] = [];
    const registry = new SceneMigrationRegistry();
    for (const from of [0, 1, 2]) {
      registry.registerMigration(from, (document, context) => {
        seen.push(context.fromVersion);
        expect(context.toVersion).toBe(context.fromVersion + 1);
        // Each link sees the previous link's stamp, never a stale one.
        expect(document.formatVersion).toBe(context.fromVersion);
        return { ...document, [`step${String(from)}`]: true };
      });
    }

    const document = runSceneMigrations({ formatVersion: 0 }, registry, {
      targetVersion: 3,
    });

    expect(seen).toEqual([0, 1, 2]);
    expect(document).toEqual({
      formatVersion: 3,
      step0: true,
      step1: true,
      step2: true,
    });
  });

  it("detects a gap in the chain and names the missing link", () => {
    const registry = new SceneMigrationRegistry()
      .registerMigration(0, (document) => document)
      .registerMigration(2, (document) => document);

    let thrown: unknown;
    try {
      runSceneMigrations({ formatVersion: 0 }, registry, { targetVersion: 3 });
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "SERIALIZATION_VERSION_MISMATCH",
    );
    expect(isFourError(thrown) && thrown.context).toEqual({
      fromVersion: 1,
      toVersion: 2,
      targetVersion: 3,
    });
    expect(String(thrown)).toMatch(/has a gap/);
  });

  it("refuses a document newer than the target", () => {
    let thrown: unknown;
    try {
      runSceneMigrations({ formatVersion: 4 }, v0Registry());
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "SERIALIZATION_VERSION_MISMATCH",
    );
    expect(String(thrown)).toMatch(/scene migrations upgrade only/);
  });

  it("refuses a document with no usable formatVersion", () => {
    expect(() => runSceneMigrations({}, v0Registry())).toThrow(
      /document\.formatVersion must be a non-negative safe integer \(got undefined\)/,
    );
    expect(() =>
      runSceneMigrations({ formatVersion: "0" }, v0Registry()),
    ).toThrow(/formatVersion must be a non-negative safe integer/);
    expect(() =>
      runSceneMigrations({ formatVersion: -1 }, v0Registry()),
    ).toThrow(/formatVersion must be a non-negative safe integer/);
    expect(() =>
      runSceneMigrations({ formatVersion: 0.5 }, v0Registry()),
    ).toThrow(/formatVersion must be a non-negative safe integer/);
  });

  it("refuses a value that is not a JSON object", () => {
    expect(() => runSceneMigrations([], v0Registry())).toThrow(
      /document must be an object/,
    );
    expect(() => runSceneMigrations({ a: undefined }, v0Registry())).toThrow(
      /document\.a is undefined/,
    );
  });

  it("refuses an unusable targetVersion", () => {
    expect(() =>
      runSceneMigrations({ formatVersion: 0 }, v0Registry(), {
        targetVersion: 1.5,
      }),
    ).toThrow(/targetVersion must be a non-negative safe integer/);
    expect(() =>
      runSceneMigrations({ formatVersion: 0 }, v0Registry(), {
        targetVersion: -2,
      }),
    ).toThrow(/targetVersion must be a non-negative safe integer/);
  });

  it("refuses a step that returns something that is not a JSON object", () => {
    const registry = new SceneMigrationRegistry().registerMigration(
      0,
      () => [] as unknown as JsonObject,
    );

    expect(() => runSceneMigrations({ formatVersion: 0 }, registry)).toThrow(
      /migration 0 → 1 result must be an object/,
    );
  });

  it("lets a step carry the old stamp through untouched", () => {
    const registry = new SceneMigrationRegistry().registerMigration(
      0,
      (document) => ({ ...document, nodes: [] }),
    );

    expect(runSceneMigrations({ formatVersion: 0 }, registry)).toEqual({
      formatVersion: 1,
      nodes: [],
    });
  });

  it("refuses a step whose formatVersion contradicts the link", () => {
    const registry = new SceneMigrationRegistry().registerMigration(0, () => ({
      formatVersion: 7,
    }));

    expect(() => runSceneMigrations({ formatVersion: 0 }, registry)).toThrow(
      /declaring formatVersion 7; it upgrades to 1/,
    );
  });

  it("accepts a step that stamps the version it is producing", () => {
    const registry = new SceneMigrationRegistry().registerMigration(0, () => ({
      formatVersion: 1,
      nodes: [],
    }));

    expect(runSceneMigrations({ formatVersion: 0 }, registry)).toEqual({
      formatVersion: 1,
      nodes: [],
    });
  });

  it("hands each step a frozen document, so a mutating step fails loudly", () => {
    const registry = new SceneMigrationRegistry().registerMigration(
      0,
      (document) => {
        expect(Object.isFrozen(document)).toBe(true);
        (document as unknown as Record<string, unknown>).nodes = [];
        return document;
      },
    );

    expect(() => runSceneMigrations({ formatVersion: 0 }, registry)).toThrow(
      TypeError,
    );
  });
});
