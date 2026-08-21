#!/usr/bin/env node
// Mechanical doc-truth checks for the repository's prose.
// Usage: node tools/check-docs.mjs   (exit 0 = clean, 1 = violations)
//
// Sibling of tools/check-spec.mjs, and deliberately the same shape: a handful of
// checks that can be decided by reading files, no engine imports, no network.
//
// It exists because the 2026-08-05 documentation-truth sweep found claims that
// were false when written and stayed false for months — an example count nobody
// recounted, a "there are no golden images" doctrine that a later packet
// contradicted, a sort order the comparator never implemented. Each check below
// is a specific defect that was fixed by hand once; the check is what stops it
// coming back, since prose has no type checker and no test suite.
//
// Scope discipline: a check here must be *mechanical*. It may count files, match
// a fixed string, or compare a number in a document against the filesystem. It
// must never try to judge whether a paragraph is true in general — that is a
// review, and a gate that pretends to do it would be its own false claim.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

/** Reads a repo-relative file, or returns null if it is absent. */
function read(rel) {
  const path = join(root, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Every tracked path under `examples/`, from git — the source of truth for "exists". */
function trackedExampleFiles() {
  const out = execFileSync("git", ["ls-files", "examples/"], {
    cwd: root,
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

/** Repo-relative paths of every `.md` file under `docs/guides/`, plus the two root-ish READMEs. */
function docFiles() {
  const files = ["README.md", "examples/README.md"];
  const guides = join(root, "docs", "guides");
  if (existsSync(guides)) {
    for (const name of readdirSync(guides)) {
      if (name.endsWith(".md")) files.push(join("docs", "guides", name));
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// 1. Example directories: real ones have a main.ts; references to the others
//    must carry the placeholder marker.
//
//    An `examples/<name>` directory is REAL if git tracks a `main.ts` in it, and
//    a PLACEHOLDER otherwise (in practice: a lone `.gitkeep`). A doc may name a
//    placeholder — the §93 tables have to, to say what is missing — but only in
//    a paragraph that also says so, so a reader is never sent to an empty
//    directory expecting code.
// ---------------------------------------------------------------------------

// Matched against whitespace-collapsed text, so a marker that wraps across a
// line break in the source still counts. Two spellings are accepted: the
// canonical list/table marker, and the prose form a guide uses mid-sentence.
const PLACEHOLDER_MARKER = /not yet written|(the )?directory is a placeholder/i;

/** Collapses newlines and indentation so a wrapped sentence reads as one line. */
const flatten = (s) => s.replace(/\s+/g, " ");

const tracked = trackedExampleFiles();
/** Example directory name (possibly nested, e.g. `flagship/motor-digital-twin`) → has a main.ts. */
const exampleDirs = new Map();
for (const file of tracked) {
  const rest = file.slice("examples/".length);
  const parts = rest.split("/");
  if (parts.length < 2) continue; // examples/README.md, examples/tsconfig.json
  // `flagship/<demo>` nests one level; everything else is a single directory.
  const dir =
    parts[0] === "flagship" && parts.length > 2
      ? `${parts[0]}/${parts[1]}`
      : parts[0];
  const isMain = file.endsWith("/main.ts");
  exampleDirs.set(dir, (exampleDirs.get(dir) ?? false) || isMain);
}

const realExamples = [...exampleDirs]
  .filter(([, has]) => has)
  .map(([d]) => d)
  .sort();
const placeholderExamples = [...exampleDirs]
  .filter(([, has]) => !has)
  .map(([d]) => d)
  .sort();

if (realExamples.length === 0) {
  errors.push(
    "no examples/* directory has a tracked main.ts — is git ls-files working?",
  );
}

// A reference is "marked" if the placeholder marker appears in the mention's own
// Markdown block — the line itself plus its wrapped continuation lines. The
// window deliberately stops at the next table row, list item, heading or blank
// line: in a table of four consecutive placeholder rows, a fixed line window
// would let row 2's marker excuse a missing marker on row 1, which is exactly
// the kind of near-miss this gate exists to catch. Capped so a runaway block
// cannot swallow the rest of a file.
const REFERENCE_WINDOW_LINES = 6;

/** The mention's own block: `lines[i]` plus its continuation lines. */
function blockAt(lines, i) {
  const block = [lines[i]];
  for (
    let j = i + 1;
    j < lines.length && block.length <= REFERENCE_WINDOW_LINES;
    j += 1
  ) {
    const line = lines[j];
    if (line.trim() === "" || /^\s*([|\-*+#>]|\d+\.)/.test(line)) break;
    block.push(line);
  }
  return flatten(block.join("\n"));
}

for (const rel of docFiles()) {
  const text = read(rel);
  if (text === null) continue;
  const lines = text.split("\n");
  for (const dir of placeholderExamples) {
    lines.forEach((line, i) => {
      // `examples/<dir>` or, inside examples/README.md, a bare `` `<dir>/` `` link.
      const mentions =
        line.includes(`examples/${dir}`) ||
        (rel === "examples/README.md" && line.includes(`](${dir}/)`));
      if (!mentions) return;
      if (!PLACEHOLDER_MARKER.test(blockAt(lines, i))) {
        errors.push(
          `${rel}:${i + 1}: references empty example "examples/${dir}" without the ` +
            `placeholder marker ("not yet written; directory is a placeholder"). ` +
            `That directory holds a .gitkeep and no main.ts (docs/AUDIT-120.md S-8).`,
        );
      }
    });
  }
}

// Conversely: a real example must not be labelled a placeholder. A line that
// names a placeholder *and* points at its shipped stand-in ("…is a placeholder.
// Use `examples/physics-playground`") is the correct form and is skipped — the
// marker on such a line belongs to the placeholder, not to the real example.
for (const rel of docFiles()) {
  const text = read(rel);
  if (text === null) continue;
  const lines = text.split("\n");
  for (const dir of realExamples) {
    lines.forEach((line, i) => {
      if (!line.includes(`examples/${dir}`)) return;
      if (!PLACEHOLDER_MARKER.test(line)) return;
      const alsoNamesPlaceholder = placeholderExamples.some((p) =>
        line.includes(`examples/${p}`),
      );
      if (alsoNamesPlaceholder) return;
      errors.push(
        `${rel}:${i + 1}: calls "examples/${dir}" a placeholder, but it has a tracked main.ts`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// 2. docs/AUDIT-120.md's example count matches the filesystem.
//
//    The row said "10 example applications" for three days past the point anyone
//    could have counted six. The audit is the document most likely to be quoted,
//    so its count is pinned to git rather than to a reviewer's memory.
//
//    A nested example counts too: `examples/flagship/<demo>` is keyed by its
//    two-segment name above, so both flagships are among the directories this
//    count compares against (8 since 2026-08-07; 9 since 2026-08-08, when §119's
//    `flagship/motor-digital-twin` was written).
// ---------------------------------------------------------------------------

const auditRel = "docs/AUDIT-120.md";
const audit = read(auditRel);
if (audit === null) {
  errors.push(`${auditRel} is missing`);
} else {
  const row = audit.split("\n").find((l) => /^\| examples\s/.test(l));
  if (!row) {
    errors.push(`${auditRel}: no "| examples" row found in the tooling table`);
  } else {
    // The row states the count as `**N**` runnable examples.
    const m = row.match(/\*\*(\d+)\*\*\s+runnable example/);
    if (!m) {
      errors.push(
        `${auditRel}: the examples row must state its count as "**N** runnable example ` +
          `applications" so this check can compare it against git ls-files`,
      );
    } else if (Number(m[1]) !== realExamples.length) {
      errors.push(
        `${auditRel}: the examples row claims ${m[1]}, but ${realExamples.length} ` +
          `examples/* directories have a tracked main.ts (${realExamples.join(", ")})`,
      );
    }
    // And each named example must be one that exists.
    for (const name of row.matchAll(/`([a-z0-9-]+)`/g)) {
      if (!realExamples.includes(name[1])) {
        errors.push(
          `${auditRel}: the examples row names \`${name[1]}\`, which has no tracked main.ts`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Retired claims. Each entry is a claim that was verified false and fixed by
//    hand on the stated date; the regex matches the *original wording*, so a
//    revert, a copy-paste from an old revision, or a well-meaning "restore the
//    concise version" fails here instead of shipping.
//
//    `allow` lists files permitted to contain the string because they *quote* it
//    while correcting it — the house style is to keep the superseded wording
//    visible, so the corrections themselves would otherwise trip their own gate.
// ---------------------------------------------------------------------------

const RETIRED = [
  {
    re: /`?ScreenCamera`? is absent/i,
    where: [],
    allow: [
      "CHANGELOG.md",
      "MEMORY.md",
      "TODO.md",
      "docs/GAP ANALYSIS v0.md",
      "docs/GAP ANALYSIS v1.md",
    ],
    why: "R-37 closed 2026-08-21; both flagships draw UI through a second viewport under ScreenCamera",
  },
  {
    re: /nothing on this roadmap has shipped yet/i,
    where: ["ROADMAP.md"],
    allow: ["ROADMAP.md", "CHANGELOG.md"],
    why: "the implementation plan completed 2026-08-02 (docs/AUDIT-120.md)",
  },
  {
    re: /lighting is the single staged absence/i,
    where: ["README.md"],
    allow: ["README.md", "CHANGELOG.md"],
    why: "lighting shipped at its MVP tier 2026-08-04 (AUDIT-120 S-5); the audit is 43/43",
  },
  {
    re: /10 example applications/i,
    where: ["docs/AUDIT-120.md"],
    allow: ["docs/AUDIT-120.md", "CHANGELOG.md"],
    why:
      "nine examples/* directories have a main.ts (six until 2026-08-07, when " +
      "first-3d-scene and then §118's flagship were written; nine since " +
      "2026-08-08, when §119's motor digital twin was written); the remaining " +
      "three are .gitkeep (S-8)",
  },
  {
    re: /tests\/visual\/.*empty placeholder/i,
    where: ["docs/AUDIT-120.md"],
    allow: ["docs/AUDIT-120.md", "CHANGELOG.md", "tests/README.md"],
    why: "a golden-image suite landed in tests/visual/ on 2026-08-04",
  },
  {
    re: /§55; batched/,
    where: ["docs/AUDIT-120.md"],
    allow: ["CHANGELOG.md"],
    why: "the WebGL backend draws one sprite per draw call; §65 batching is unshipped",
  },
  {
    re: /There are no golden images/,
    where: ["playwright.config.ts"],
    allow: ["playwright.config.ts", "CHANGELOG.md"],
    why: "true of the chromium project only; the visual project compares committed goldens",
  },
  {
    re: /by render layer, then kind/i,
    where: ["docs/guides/materials-and-render-graph.md"],
    allow: ["docs/guides/materials-and-render-graph.md", "CHANGELOG.md"],
    why: "compareRenderItems sorts renderLayer then renderOrder, and nothing else",
  },
  {
    re: /three fixed, internal programs/i,
    where: ["docs/guides/custom-shaders.md"],
    allow: ["docs/guides/custom-shaders.md", "CHANGELOG.md"],
    why: "LitProgram made it four on 2026-08-04",
  },
  {
    re: /panel parented to the$|panel parented to the camera/i,
    where: ["examples/README.md"],
    allow: ["examples/README.md", "CHANGELOG.md"],
    why:
      "both flagships moved onto the standard §46/§47/§48 screen-space recipe " +
      'on 2026-08-21 (a "ui" layer, a second full-surface viewport with a ' +
      "ScreenCamera, layerMask per view); the camera-parenting workaround R-37 " +
      "unblocked is gone from examples/flagship/*",
  },
];

// Documents whose *subject* is the false claims: a gap analysis or a review
// quotes the defective wording in order to report it, so scanning them would
// make the gate fire on the very document that found the problem. Excluded by
// name, deliberately short, and each entry needs a reason.
// Append-only records whose stated convention is to keep superseded wording
// visible — `MEMORY.md` says "never silently rewrite a recorded decision —
// supersede it with a new entry", and `CHANGELOG.md` does not rewrite history.
// Both therefore quote retired claims on purpose, so the retired-claim scan
// skips them. (They are still scanned by check 1: a record may not send a reader
// to an empty example directory either.)
const APPEND_ONLY_RECORDS = new Set(["CHANGELOG.md", "MEMORY.md"]);

const QUOTES_DEFECTS = new Set([
  // The doc-truth gap analysis: an inventory of these exact claims, with file
  // and line, written by the audit that produced the 2026-08-05 sweep.
  "docs/GAP ANALYSIS v0.md",
  // The pre-1.0 specification review: quotes superseded wording throughout.
  "docs/SPEC-REVIEW.md",
]);

// Files worth scanning: the repository's prose and the one config whose comment
// carries a claim. Kept explicit rather than walking the tree, so the gate stays
// fast and never reads node_modules, dist, or the generated API docs.
function prosePaths() {
  const paths = new Set([
    "README.md",
    "ROADMAP.md",
    "CHANGELOG.md",
    "MEMORY.md",
    "TODO.md",
    "AGENTS.md",
    "CLAUDE.md",
    "playwright.config.ts",
    "examples/README.md",
    "tests/README.md",
    "benchmarks/README.md",
  ]);
  for (const dir of [join("docs"), join("docs", "guides")]) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const full = join(abs, name);
      if (statSync(full).isFile() && name.endsWith(".md")) {
        paths.add(relative(root, full).split("\\").join("/"));
      }
    }
  }
  return [...paths].filter(
    (p) => existsSync(join(root, p)) && !QUOTES_DEFECTS.has(p),
  );
}

for (const rel of prosePaths()) {
  if (APPEND_ONLY_RECORDS.has(rel)) continue;
  const text = read(rel);
  if (text === null) continue;
  for (const claim of RETIRED) {
    if (claim.allow.includes(rel)) continue;
    text.split("\n").forEach((line, i) => {
      if (claim.re.test(line)) {
        errors.push(
          `${rel}:${i + 1}: retired claim ${claim.re} — ${claim.why}`,
        );
      }
    });
  }
  // Inside an `allow`ed file the claim may appear only alongside a dated
  // correction: the house style quotes the old wording and says when it stopped
  // being true. A bare reappearance is a revert.
  for (const claim of RETIRED) {
    if (!claim.allow.includes(rel) || !claim.where.includes(rel)) continue;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (!claim.re.test(line)) return;
      const window = lines.slice(Math.max(0, i - 6), i + 7).join("\n");
      if (!/until 2026-|superseded|corrected 20\d\d-/i.test(window)) {
        errors.push(
          `${rel}:${i + 1}: retired claim ${claim.re} reappears without a dated ` +
            `correction nearby — ${claim.why}`,
        );
      }
    });
  }
}

if (errors.length) {
  console.error(`check-docs: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `check-docs: OK (${realExamples.length} runnable examples, ` +
    `${placeholderExamples.length} placeholders, ${RETIRED.length} retired claims pinned)`,
);
