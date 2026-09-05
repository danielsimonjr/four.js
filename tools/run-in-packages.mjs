/**
 * Run a command (or package script) across every `packages/*` directory
 * (RFC 0006).
 *
 * Replaces `pnpm -r --filter "./packages/*" …` for workspace sweeps. Packages
 * are visited in lexicographic order. Use `--concurrency=N` to bound parallel
 * work (CI runners OOM / time out glyph-atlas suites when every package runs
 * at once). The first non-zero exit wins; in-flight siblings are still allowed
 * to finish so logs stay readable, then the process exits with that status.
 *
 * Usage:
 *   bun tools/run-in-packages.mjs [--concurrency=N] <cmd> [args…]
 *   bun tools/run-in-packages.mjs [--concurrency=N] --script <name>
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const packagesRoot = join(root, "packages");
const argv = process.argv.slice(2);

let concurrency = 1;
let scriptName = null;
const cmdArgs = [];

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--sequential") {
    concurrency = 1;
    continue;
  }
  if (arg.startsWith("--concurrency=")) {
    concurrency = Number(arg.slice("--concurrency=".length));
    continue;
  }
  if (arg === "--concurrency") {
    concurrency = Number(argv[++i]);
    continue;
  }
  if (arg === "--script") {
    scriptName = argv[++i];
    continue;
  }
  cmdArgs.push(arg);
}

if (
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  (scriptName == null && cmdArgs.length === 0) ||
  (scriptName != null && cmdArgs.length !== 0)
) {
  console.error(
    "usage: bun tools/run-in-packages.mjs [--concurrency=N] (<cmd> [args…] | --script <name>)",
  );
  process.exit(2);
}

const packages = readdirSync(packagesRoot)
  .filter((name) => {
    try {
      return statSync(join(packagesRoot, name)).isDirectory();
    } catch {
      return false;
    }
  })
  .sort();

function runOne(name) {
  const cwd = join(packagesRoot, name);
  const command = scriptName == null ? cmdArgs[0] : "bun";
  const args =
    scriptName == null ? cmdArgs.slice(1) : ["run", "--silent", scriptName];
  console.log(`\n▸ ${name}`);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
      env: process.env,
    });
    child.on("error", (error) => {
      console.error(error);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  let next = 0;
  let failure = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, packages.length) },
    async () => {
      while (next < packages.length) {
        const index = next++;
        const code = await runOne(packages[index]);
        if (code !== 0 && failure === 0) failure = code;
      }
    },
  );
  await Promise.all(workers);
  if (failure !== 0) process.exit(failure);
}

await main();
