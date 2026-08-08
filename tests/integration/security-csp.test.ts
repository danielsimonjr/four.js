/**
 * §96's *"documented content-security-policy behavior"*, enforced rather than
 * asserted in prose.
 *
 * `docs/guides/security-and-untrusted-content.md` tells a deployer that four.js
 * runs under a policy with **no `'unsafe-eval'` and no `'unsafe-inline'`**:
 * nothing in the engine calls `eval`, constructs a `Function` from a string,
 * writes markup into the document, or hands a string to a timer. That claim is
 * worth exactly as much as the mechanism that keeps it true — the sweep
 * recorded in `MEMORY.md` (2026-08-05) found several prose claims that were
 * false when written and survived for months, because prose has no type
 * checker.
 *
 * So this suite greps every package's shipped source, plus the example apps, for
 * the constructs a strict CSP forbids. It is deliberately a *source* scan rather
 * than a `dist` scan: `dist` is `tsc` output of exactly these files with the
 * types erased, it does not exist until someone has built, and a grep over
 * source fails in the pull request that introduced the call instead of after a
 * full monorepo build.
 *
 * A package that genuinely needs one of these — a future §60 shader
 * hot-reloader, say — does not silence the test; it changes the guide first,
 * because that is the document a deployer's policy is written from.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");

/** One CSP-relevant construct: what it is called, and how to spot it. */
interface ForbiddenConstruct {
  /** The directive a deployer would otherwise have to relax. */
  readonly directive: string;
  /** What the engine must not do. */
  readonly what: string;
  /** The matcher, applied per line. */
  readonly pattern: RegExp;
  /** A line that must match, so the matcher itself cannot rot into a no-op. */
  readonly example: string;
}

const FORBIDDEN: readonly ForbiddenConstruct[] = [
  {
    directive: "script-src (no 'unsafe-eval')",
    what: "call eval",
    pattern: /\beval\b\s*\(/,
    example: "const value = eval(text);",
  },
  {
    directive: "script-src (no 'unsafe-eval')",
    what: "build a function from a string",
    pattern: /\bnew\s+Function\s*\(/,
    example: "const fn = new Function('return 1');",
  },
  {
    directive: "script-src (no 'unsafe-eval')",
    what: "hand a string to a timer",
    pattern: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/,
    example: 'setTimeout("tick()", 16);',
  },
  {
    directive: "script-src / style-src (no 'unsafe-inline')",
    what: "inject markup into the document",
    pattern: /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/,
    example: "element.innerHTML = untrusted;",
  },
  {
    directive: "script-src / style-src (no 'unsafe-inline')",
    what: "write into the parser",
    pattern: /\bdocument\s*\.\s*write(?:ln)?\s*\(/,
    example: "document.write(chunk);",
  },
  {
    directive: "style-src (no 'unsafe-inline')",
    what: "assign a raw style string",
    pattern: /\.\s*cssText\s*=/,
    example: "element.style.cssText = theme;",
  },
];

/** Every `.ts` file under `dir`, recursively; `[]` when `dir` is absent. */
function typescriptFilesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      files.push(...typescriptFilesUnder(full));
      continue;
    }
    if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Every shipped source file the engine and its examples are built from.
 *
 * `packages/*​/src` rather than the whole package, so a package's own tests —
 * which may legitimately name a construct in order to assert it is absent —
 * are out of scope. This file lives under `tests/`, so it excludes itself.
 */
function shippedSources(): string[] {
  const files: string[] = [];
  for (const name of readdirSync(join(root, "packages"))) {
    files.push(...typescriptFilesUnder(join(root, "packages", name, "src")));
  }
  files.push(...typescriptFilesUnder(join(root, "examples")));
  return files;
}

describe("content-security-policy posture (§96)", () => {
  const sources = shippedSources();

  it("scans a non-trivial number of shipped sources", () => {
    // Guards against the scan silently finding nothing to scan — the failure
    // mode that would make every assertion below pass vacuously.
    expect(sources.length).toBeGreaterThan(100);
  });

  it.each(FORBIDDEN)(
    "no shipped source may $what — $directive",
    ({ pattern, example }: ForbiddenConstruct) => {
      // The matcher must still match something, or the check is a no-op.
      expect(pattern.test(example)).toBe(true);

      const offenders: string[] = [];
      for (const file of sources) {
        const text = readFileSync(file, "utf8");
        text.split("\n").forEach((line, index) => {
          if (pattern.test(line)) {
            offenders.push(
              `${relative(root, file)}:${String(index + 1)}: ${line.trim()}`,
            );
          }
        });
      }
      expect(
        offenders,
        `four.js documents a CSP with no 'unsafe-eval' and no 'unsafe-inline' ` +
          `(docs/guides/security-and-untrusted-content.md). Update that guide ` +
          `before introducing this construct.`,
      ).toEqual([]);
    },
  );
});
