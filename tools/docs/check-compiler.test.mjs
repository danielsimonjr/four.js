import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

for (const [declared, resolved, accepted] of [
  ["6.0.3", "6.0.3", true],
  ["7.0.2", "6.0.3", false],
  ["6.0.3", "7.0.2", false],
  ["7.0.2", "7.0.2", false],
]) {
  test(`compiler guard: declared ${declared}, resolved ${resolved}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "fourjs-docs-compiler-"));
    try {
      mkdirSync(join(directory, "node_modules/typescript"), {
        recursive: true,
      });
      writeFileSync(
        join(directory, "node_modules/typescript/package.json"),
        JSON.stringify({ version: resolved }),
      );
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({ devDependencies: { typescript: declared } }),
      );
      copyFileSync(
        new URL("check-compiler.mjs", import.meta.url),
        join(directory, "check.mjs"),
      );
      const result = spawnSync(
        process.execPath,
        [join(directory, "check.mjs")],
        { encoding: "utf8" },
      );
      assert.equal(result.status, accepted ? 0 : 1, result.stderr);
      assert.match(
        accepted ? result.stdout : result.stderr,
        accepted ? /TypeDoc will use/ : /Declared .*resolved/,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
