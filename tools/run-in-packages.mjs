/**
 * Run a command in every `packages/*` directory (RFC 0006).
 *
 * Replaces `pnpm -r --filter "./packages/*" exec …` for one-off workspace
 * commands that are not package.json scripts (notably the shared Vitest
 * coverage config). Packages are visited in lexicographic order; the first
 * non-zero exit aborts the rest.
 *
 * Usage: bun tools/run-in-packages.mjs [--sequential] <cmd> [args…]
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const packagesRoot = join(root, "packages");
const argv = process.argv.slice(2);
const sequential = argv[0] === "--sequential";
const cmdArgs = sequential ? argv.slice(1) : argv;

if (cmdArgs.length === 0) {
  console.error(
    "usage: bun tools/run-in-packages.mjs [--sequential] <cmd> [args…]",
  );
  process.exit(2);
}

const [command, ...args] = cmdArgs;
const packages = readdirSync(packagesRoot)
  .filter((name) => {
    try {
      return statSync(join(packagesRoot, name)).isDirectory();
    } catch {
      return false;
    }
  })
  .sort();

for (const name of packages) {
  const cwd = join(packagesRoot, name);
  console.log(`\n▸ ${name}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
