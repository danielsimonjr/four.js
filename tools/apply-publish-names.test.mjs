// Unit tests for tools/apply-publish-names.mjs.
// Usage: node --test tools/apply-publish-names.test.mjs   (pnpm publish-names:test)
//
// Half of these run against fixtures and half against the real workspace. The
// real-workspace half is the point: the §98 mapping has exactly one chance to be
// right — the first publish — and the failure it would produce (a package whose
// subpath exports or workspace deps changed shape during the rename) is not
// visible in a diff of the checkout, because the tool never writes to it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUBLISH_PREFIX,
  PUBLISH_UMBRELLA,
  applyPublishNames,
  checkRewrite,
  publishName,
  readWorkspacePackages,
  resolveWorkspaceRange,
  rewriteCode,
  rewriteManifest,
} from "./apply-publish-names.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- name mapping ----------------------------------------------------------

test("publishName maps the umbrella and the scoped packages, and only those", () => {
  assert.equal(publishName("four"), "@danielsimonjr/fourjs");
  assert.equal(publishName("@four/core"), "@danielsimonjr/fourjs-core");
  assert.equal(
    publishName("@four/physics-rapier"),
    "@danielsimonjr/fourjs-physics-rapier",
  );
  assert.equal(publishName("@dimforge/rapier2d-compat"), null);
  assert.equal(publishName("vite"), null);
  assert.equal(publishName("fourier"), null); // a prefix of "four" is not "four"
});

test("resolveWorkspaceRange reproduces pnpm's publish-time substitution", () => {
  assert.equal(resolveWorkspaceRange("workspace:*", "0.1.0"), "0.1.0");
  assert.equal(resolveWorkspaceRange("workspace:^", "0.1.0"), "^0.1.0");
  assert.equal(resolveWorkspaceRange("workspace:~", "0.1.0"), "~0.1.0");
  assert.equal(resolveWorkspaceRange("workspace:^1.2.3", "0.1.0"), "^1.2.3");
  assert.equal(resolveWorkspaceRange("^0.19.3", "0.1.0"), "^0.19.3"); // registry dep
});

// --- manifest rewrite ------------------------------------------------------

const FIXTURE = {
  name: "@four/render-webgl",
  version: "0.1.0",
  exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  files: ["dist"],
  dependencies: { "@four/core": "workspace:*", "gl-matrix": "^3.4.3" },
  devDependencies: { four: "workspace:^", vitest: "3.2.7" },
};

test("rewriteManifest renames keys, resolves workspace ranges, and leaves the rest alone", () => {
  const versions = new Map([
    ["@four/core", "0.1.0"],
    ["four", "0.1.0"],
  ]);
  const out = rewriteManifest(FIXTURE, versions);
  assert.equal(out.name, "@danielsimonjr/fourjs-render-webgl");
  assert.deepEqual(out.dependencies, {
    "@danielsimonjr/fourjs-core": "0.1.0",
    "gl-matrix": "^3.4.3",
  });
  assert.deepEqual(out.devDependencies, {
    "@danielsimonjr/fourjs": "^0.1.0",
    vitest: "3.2.7",
  });
  assert.deepEqual(out.exports, FIXTURE.exports);
  assert.deepEqual(out.files, FIXTURE.files);
  assert.equal(out.version, "0.1.0");
  assert.deepEqual(Object.keys(out), Object.keys(FIXTURE)); // key order preserved
  assert.equal(FIXTURE.name, "@four/render-webgl"); // source untouched
});

test("checkRewrite rejects a lost export, a missed rename, and an unresolved range", () => {
  const versions = new Map([["@four/core", "0.1.0"]]);
  const good = rewriteManifest(FIXTURE, versions);
  assert.deepEqual(checkRewrite(FIXTURE, good), []);

  const droppedExport = { ...good, exports: {} };
  assert.match(checkRewrite(FIXTURE, droppedExport)[0], /`exports` changed/);

  const missedRename = {
    ...good,
    dependencies: { "@four/core": "workspace:*" },
  };
  const problems = checkRewrite(FIXTURE, missedRename);
  assert.ok(
    problems.some((p) => /still carries a workspace-only name/.test(p)),
  );
  assert.ok(
    problems.some((p) => /still carries the unresolvable range/.test(p)),
  );

  const noFiles = { ...good, files: [] };
  assert.ok(
    checkRewrite(FIXTURE, noFiles).some((p) => /no `files` array/.test(p)),
  );
});

// --- code rewrite ----------------------------------------------------------

test("rewriteCode renames quoted workspace names in emitted code", () => {
  const source = [
    'import { Node } from "@four/scene";',
    'export * from "@four/math";',
    'const mod = await import("four");',
    'export const PACKAGE_NAME = "@four/core";',
    ' * import { Application } from "four";',
  ].join("\n");
  const { text, count } = rewriteCode(source);
  assert.equal(count, 5);
  assert.ok(!/["']@four\//.test(text));
  assert.ok(text.includes(`from "${PUBLISH_PREFIX}scene"`));
  assert.ok(text.includes(`import("${PUBLISH_UMBRELLA}")`));
  assert.ok(text.includes(`PACKAGE_NAME = "${PUBLISH_PREFIX}core"`));
});

test("rewriteCode leaves the English word `four` and unquoted prose alone", () => {
  const source = [
    'const label = "four";',
    'assert.equal(count, "four");',
    " * `@four/animation` — the public surface of the animation pillar.",
  ].join("\n");
  const { text, count } = rewriteCode(source);
  assert.equal(count, 0);
  assert.equal(text, source);
});

// --- the real workspace ----------------------------------------------------

const packages = readWorkspacePackages(root);
const versions = new Map(
  packages.map((p) => [p.manifest.name, p.manifest.version]),
);

test("every workspace package maps to a published name and checks clean", () => {
  assert.ok(
    packages.length >= 24,
    `found only ${packages.length} workspace packages`,
  );
  for (const pkg of packages) {
    const expected = publishName(pkg.manifest.name);
    assert.notEqual(
      expected,
      null,
      `${pkg.relDir}: name "${pkg.manifest.name}" is unmapped`,
    );
    const rewritten = rewriteManifest(pkg.manifest, versions);
    assert.equal(rewritten.name, expected);
    assert.deepEqual(
      checkRewrite(pkg.manifest, rewritten),
      [],
      `${pkg.relDir} rewrites cleanly`,
    );
  }
});

test("no @four/ string survives in any rewritten package.json", () => {
  for (const pkg of packages) {
    const json = JSON.stringify(rewriteManifest(pkg.manifest, versions));
    assert.ok(
      !json.includes("@four/"),
      `${pkg.relDir} still carries an @four/ name`,
    );
    assert.ok(
      !json.includes('"four"'),
      `${pkg.relDir} still carries the bare name "four"`,
    );
  }
});

test("the umbrella's subpath exports survive the rewrite intact (§91 tree-shaking)", () => {
  const umbrella = packages.find((p) => p.manifest.name === "four");
  assert.ok(umbrella, "workspace package `four` not found");
  const rewritten = rewriteManifest(umbrella.manifest, versions);

  // Byte for byte: same keys, same order, same condition objects.
  assert.equal(
    JSON.stringify(rewritten.exports),
    JSON.stringify(umbrella.manifest.exports),
  );
  const keys = Object.keys(rewritten.exports);
  assert.ok(
    keys.length >= 25,
    `umbrella has ${keys.length} exports, expected at least 25`,
  );
  for (const subpath of [
    ".",
    "./scene",
    "./physics-rapier",
    "./render-webgl",
    "./application",
  ]) {
    assert.ok(keys.includes(subpath), `umbrella export "${subpath}" was lost`);
    assert.equal(
      rewritten.exports[subpath].import,
      umbrella.manifest.exports[subpath].import,
    );
    assert.equal(
      rewritten.exports[subpath].types,
      umbrella.manifest.exports[subpath].types,
    );
  }

  // Every subpath other than "." and "./application" names a package the
  // umbrella depends on, so a renamed dependency map and an unrenamed export
  // map cannot drift apart unnoticed.
  const deps = new Set(Object.keys(rewritten.dependencies));
  for (const subpath of keys) {
    if (subpath === "." || subpath === "./application") continue;
    assert.ok(
      deps.has(PUBLISH_PREFIX + subpath.slice(2)),
      `umbrella subpath "${subpath}" has no matching published dependency`,
    );
  }
});

test("a check-only run of the whole workspace reports no problems and writes nothing", () => {
  const { problems, staged } = applyPublishNames({ root });
  assert.deepEqual(problems, []);
  assert.equal(staged.length, packages.length);
  for (const pkg of packages) {
    const onDisk = JSON.parse(
      readFileSync(join(pkg.dir, "package.json"), "utf8"),
    );
    assert.equal(
      onDisk.name,
      pkg.manifest.name,
      "the checkout must not be rewritten in place",
    );
  }
});
