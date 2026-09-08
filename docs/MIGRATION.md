# Migration: TypeScript-on-Bun

**Status as of 2026-09-08.** Half of this migration is done and shipped. The other
half is blocked by facts outside this repository. This document records which half
is which, what the evidence is, and what must change before the rest can move.

The short answer to *"why can't we migrate fourJS to TypeScript-on-Bun?"* is:

> **We did migrate the compiler.** fourJS builds and type-checks with
> **TypeScript 7.0.2** on **Bun 1.4.2**, and CI is green.
> **We cannot yet make Bun the whole toolchain**, and we cannot yet run **one**
> TypeScript. Both limits share one root cause: **TypeScript 7 deleted the compiler
> API that every type-aware tool consumes**, and Bun does not implement the two
> capabilities a *library* needs — declaration emit and threshold-gated coverage.

Everything below is measured on this repository. Commands to re-measure are in
[section 7](#7-how-to-re-measure).

---

## 1. What "TypeScript-on-Bun" actually means

The phrase covers five independent layers. They are usually said in one breath, but
they succeed and fail separately, so this document scores them separately.

| # | Layer | Today | Can Bun own it? |
|---|---|---|---|
| L1 | **Package manager / workspaces** | Bun 1.4.2 | **Yes — already does** |
| L2 | **Type checking** | TypeScript 7.0.2 | not Bun's job — this is `tsc` |
| L3 | **Library build (JS + `.d.ts`)** | `tsc -b`, TS 7.0.2 | **No** — section 4.1 |
| L4 | **Test runner** | Vitest 3.2.7 | **No** — section 4.2 |
| L5 | **Example bundling** | Vite 8 | **Probably — but do not** — section 4.3 |

A sixth concern, **API docs and lint**, is not Bun's business at all. It is the thing
that pins the second TypeScript. See section 3.

---

## 2. What is already done (2026-09-08)

- **TypeScript 7.0.2** builds and type-checks the library.
- **Bun 1.4.2** locally, in `packageManager`, in `engines`, and in all five
  workflows. Before this, local ran 1.4.0 while CI ran 1.4.2 — every local gate ran
  on a different runtime from the one that gated merges.

Evidence, taken from a clean tree rather than from an exit code:

| Check | Result |
|---|---|
| Packages built from scratch | **24** |
| Emitted | **315 `.js` + 315 `.d.ts`** |
| Suite against TS-7-built artifacts | **7,246 tests / 282 files, 0 failing** |
| Injected type error (`TS2322`) | **Caught, correct line** |
| CI (Linux), Docs, Release | **All green** |

The injected-error check matters. A compiler that silently checks nothing also exits
zero. This green is a real check.

---

## 3. The hard blocker: TypeScript 7 removed the compiler API

TypeScript 7 is the **Go port**. It is not TypeScript 6 plus features. It is a
different program that accepts the same language.

The problem is visible in one line of the published package — its `"."` export:

```
"exports": {
  ".":               "./lib/version.cjs",     <-- the whole JS API is now a version string
  "./unstable/ast":  "./dist/ast/index.js",
  "./unstable/sync": "./dist/api/sync/api.js",
  ...
}
```

`typescript@7.0.2` is **2.4 MB** and ships **per-platform Go binaries** as optional
dependencies (`@typescript/typescript-win32-x64`, `-linux-x64`, and 18 more). Its
`bin` contains **only `tsc`** — there is no `tsserver`. There is no
`import ts from "typescript"` giving `ts.createProgram`, `ts.SyntaxKind` or
`ts.PropertyDeclaration`. Those now sit behind `unstable/*` entry points, with a
different shape and a stability warning in the path name itself.

**Every type-aware tool consumes that deleted API.** They therefore do not warn or
degrade. They crash or refuse:

| Tool | Version | Result on TypeScript 7.0.2 | Failure |
|---|---|---|---|
| **TypeDoc** | 0.28.20 (latest) | crash | `TypeError: Cannot read properties of undefined (reading 'PropertyDeclaration')` |
| **typescript-eslint** | 8.70.0 (latest) | refuses | `Error: typescript-eslint does not support TS 7.0.` |

Both lines were produced by running the tools against this repository. Neither is a
guess, and neither is a peer-range warning. `typescript-eslint` ships a
purpose-built error message for TypeScript 7, which is a stronger signal than any
version range: the maintainers know, and their answer is "not yet".

### 3.1 Why the peer ranges are not the real constraint

It is tempting to read this as a version-range problem:

```
typedoc@0.28.20          peers typescript: "5.0.x || ... || 5.9.x || 6.0.x"
typescript-eslint@8.70.0 peers typescript: ">=4.8.4 <6.1.0"
```

That reading produced the previous, wrong policy in `COMPATIBILITY.md` — *"do not
lift the pin until TypeDoc accepts 7.x"* — which put this library's compiler on
another project's release schedule.

**A peer range constrains the tool, not the compiler that builds the library.** The
ranges are a symptom. The deleted API is the cause. Widening a range changes
nothing, because the call still throws.

### 3.1a TypeDoc's own timeline, and why waiting is not a plan

**Researched 2026-09-08.** [TypeStrong/typedoc#3098](https://github.com/TypeStrong/typedoc/issues/3098)
is **open**, with no fix and no date. The maintainer's own account of the work:

- TypeScript 7's API is *"a complete rewrite"*, and TypeDoc *"heavily depends on some
  internal features in TypeScript 6 which are not present in the TypeScript 7 API"* —
  so this is not a peer-range bump, it is a port.
- The plan is a **feature freeze** once TS 7.0 ships, then the port.
- *"There is no timeline for how long this will take"*, as the work happens *"during
  free time on weekends, usually an hour or two per week."*

Depending on **internal** APIs is the important detail. Those carry no compatibility
promise even between minor versions, so there is no shortcut and no shim.

**Conclusion: "wait for TypeDoc" is an open-ended bet, not a schedule.** If a single
root TypeScript is ever a hard requirement, TypeDoc has to be isolated or replaced.

### 3.1b Isolating or replacing the docs step

Two options exist, and one is already proven by a shipping package:

1. **Isolate TypeDoc with its own nested TypeScript.** `@microsoft/api-extractor`
   demonstrates the pattern: it declares `typescript: 5.9.3` as a **direct
   dependency**, not a peer, so it resolves its own compiler and constrains nothing
   above it. Moving TypeDoc into its own workspace tool package with
   `typescript@6.0.3` as a direct dependency would free the root entirely.
2. **Replace TypeDoc with API Extractor + API Documenter.** These consume the
   emitted `.d.ts` rather than the source graph, and bundle their own TypeScript by
   construction — so they are immune to the root compiler version.

Neither is urgent. Today TypeDoc works, and `typescript@6.0.3` costs one dependency.
Both matter the moment "one TypeScript at the root" becomes a requirement rather
than a preference.

### 3.2 The consequence: two TypeScripts, deliberately

| Installed as | Version | Serves |
|---|---|---|
| `ts7` (alias of `typescript`) | **7.0.2** | `bun run build`, every `typecheck:*` |
| `typescript` | **6.0.3** | TypeDoc, typescript-eslint |

`typescript@6.0.3` is the **newest release both tools accept**, and both tools are
already at their latest published versions. **This is not a stale pin.** No release
of either supports TypeScript 7.

`typescript` keeps the plain name because module resolution decides which compiler
the tools receive. TypeDoc and typescript-eslint both resolve `"typescript"` by
name and offer no option to point elsewhere. Inverting the naming would hand them
TypeScript 7 and break both.

### 3.3 Two compilers over one source will diverge, so that is gated

Running two compilers over the same code creates a second source of truth about
types. It must be watched, not trusted. `typecheck:ts6` is a CI gate for exactly
this, and it found a divergence within minutes of existing:

> TypeScript **6.0.3** rejects `import "../first-2d-scene/main.ts"` with **TS5097**
> (*"An import path can only end with a '.ts' extension when
> 'allowImportingTsExtensions' is enabled"*). TypeScript **5.9.3 and 7.0.2 both
> accept it.**

Three section-93 example entries do this. Without the gate, the examples would have
quietly become TS7-only, and nobody would have learned until the next compiler move.
Fixed with `allowImportingTsExtensions` on the examples project, which is `noEmit`
and bundled by Vite.

### 3.4 A trap this created, worth knowing

Both packages ship a binary named `tsc`. `node_modules/.bin/tsc` is therefore
decided by **install order** — and it was pointing at TypeScript 7 while
`typescript` resolved to 6.0.3. The build had already switched compilers by
accident rather than by decision.

Every `tsc` invocation now names its compiler by path
(`node ../../node_modules/ts7/bin/tsc`). Nothing uses the ambiguous shim.

---

## 4. Why Bun cannot own the rest of the toolchain yet

### 4.1 L3 — `bun build` cannot emit `.d.ts` (hard blocker)

fourJS is a **library**. Its product is not only JavaScript. It is JavaScript plus
**315 declaration files** that every consumer's editor and type-checker reads.

`bun build --help` lists **60 flags**. **None emits declarations.** There is no
`--dts` and no `--declaration`.

The build is also not a flat transpile. `tsconfig.base.json` sets
`"composite": true`, and **22 of 24 packages declare `references`**, so `tsc -b`
builds a dependency-ordered project graph and reuses prior outputs. Bun has no
equivalent.

**Verdict: blocked today, but the gap is smaller than it looks.** This paragraph
originally read "not by a small gap". That was wrong, and is corrected here after
measuring rather than reasoning.

There is a real path, and it does not wait on Bun. `oxc-transform`, `tsdown` and
`rolldown-plugin-dts` all emit declarations from **`isolatedDeclarations`** — a mode
that needs no type-checker, only explicit annotations at the module boundary. So the
question is not "can Bun emit `.d.ts`" but "does this codebase satisfy
`isolatedDeclarations`". Measured across all 24 packages with TypeScript 7:

| Result | Count |
|---|---|
| Packages already **clean** | **9** (including `core` and `math`) |
| Packages with violations | 15 |
| **Total violations repo-wide** | **107** |

Worst offenders: `render-webgpu` (28), `physics` (19), `geometry` (16), `ui` (9).
Almost all are missing explicit return types — mechanical, not architectural.

The honest verdict: **about 107 annotations stand between this repo and a tsc-free
declaration emit.** That is a bounded task, not a blocker.

Whether it is worth doing is a different question, and the answer today is probably
no. `tsc -b` under TypeScript 7 already builds a package in **211–401 ms**, which is
where the speed people expect from Bun actually arrived. Project references are still
tsc-only. The case for switching is thinner than the case for keeping it.

### 4.2 L4 — `bun test` is not a drop-in for this suite (blocked today)

Bun's runner is genuinely fast and *partly* compatible. Measured, not assumed:

| Package | `bun test` result |
|---|---|
| `packages/math` | **209 pass, 0 fail, 115 ms** |
| `packages/core` | **186 pass, 29 fail, 305 ms** |

The failures are a **missing API surface**, not broken tests:

| Missing API | Failures caused | Uses in this repo |
|---|---|---|
| `vi.unstubAllGlobals` | 29 | **22** |
| `vi.stubGlobal` | 9 | **24** |
| `vi.resetModules` | 1 | **22** |

**375 test files** import from `vitest`. `vi.spyOn` (194 uses) and `vi.fn` (73 uses)
do work. The global-stubbing and module-registry APIs do not.

A second obstacle is larger, and no shim fixes it: **`bun test` has no coverage
thresholds.** It offers `--coverage`, `--coverage-reporter` and `--coverage-dir`,
and nothing that fails a build on a number. fourJS gates on a deliberate two-tier
rule: **95% package aggregate** plus an **80% per-file floor**. Moving to `bun test`
would silently delete that gate. That is a downgrade wearing a speed improvement.

**Verdict: blocked** on `stubGlobal` / `unstubAllGlobals` / `resetModules`, and on
coverage thresholds. The first three are plausible near-term Bun features. The
fourth is a design gap.

### 4.3 L5 — Vite is the replaceable one

The example configs are thin. `examples/first-2d-scene/vite.config.ts` is:

```ts
export default defineConfig({
  define: { __FOUR_DEV__: "false" },
  build: { outDir: "dist" },
});
```

`bun build` has `--define` and an output directory. Nothing here needs Vite's plugin
system.

**Verdict: probably possible, and not recommended now.** This is the layer with the
least to gain — these are demos, not the shipped artifact — and moving it would cost
the 14 examples' browser gate a known-good bundler. It is the only layer where the
answer is "we could, and chose not to."

### 4.4 What is *not* a blocker

Stated so that nobody re-investigates them:

- **The codebase itself.** TypeScript 7 type-checks every project with **zero
  errors**. No syntax, library type, or `lib` setting had to change.
- **Windows.** The TypeScript 7 Go binary runs natively;
  `@typescript/typescript-win32-x64` resolves.
- **Linux CI.** Verified green, including the per-platform binary and the explicit
  relative compiler path.
- **Vitest's version.** Vitest declares **no `typescript` peer**. It was never
  blocked by TypeDoc, despite a tracker row that said so for months.

---

## 4a. Oxlint: the one blocker with a real, available answer

**Researched and tested on this repository, 2026-09-08.** Of the three blockers,
exactly one has a shipping alternative today, and it inverts the problem rather than
working around it.

`typescript-eslint` cannot run on TypeScript 7. **Oxlint's type-aware mode
*requires* TypeScript 7.** It is powered by `oxlint-tsgolint`, described by its own
package as *"High-performance type-aware TypeScript linter powered by
typescript-go"* — and `typescript-go` **is** TypeScript 7. Its version line
(`7.0.2001`) tracks the compiler it binds to.

So swapping the linter does not merely tolerate the migration. **It removes one of
the two reasons `typescript@6.0.3` is installed at all.**

### 4a.1 What was verified here, not read

| Question | Result |
|---|---|
| Does type-aware linting actually work? | **Yes** — an injected `JSON.parse("{}")` misuse is caught as `typescript(no-unsafe-call)` and `no-unsafe-member-access` at the right positions |
| Rule coverage vs typescript-eslint | **59 of 61** type-aware rules (upstream docs) |
| Whole-repo run, no type-awareness | **4.4 s** |
| Whole-repo run, **with** `--type-aware` | **13 s** |
| Current `bun run lint` (eslint, type-checked) | **3 min 56 s** |
| False alarms against this codebase | **none** — the 27 findings all came from rules this repo does not enable, and each was inspected |

That is roughly **18x faster with type-awareness on**, and **53x** without.

### 4a.2 The three repo-specific guards all survive

`eslint.config.js` is lean — `recommendedTypeChecked` plus two custom rules — but
those two rules are load-bearing. Each was reproduced in Oxlint and verified against
a probe file:

| Guard | Why it exists | Oxlint |
|---|---|---|
| ban `Date.now` | §33/§34 determinism | ✅ `no-restricted-properties` |
| ban `Math.random` | §33/§34 determinism | ✅ `no-restricted-properties` |
| ban `export default` | named exports only (plan §1 rule 7) | ✅ `import/no-default-export` |

### 4a.3 The one genuine gap

**Oxlint does not implement `no-restricted-syntax`.** This is not inference — Oxlint
says so itself when the rule appears in a config:

```
Failed to parse oxlint configuration file.
  x Rule 'no-restricted-syntax' not found in plugin 'eslint'
```

This repo uses that rule for exactly one thing: banning `ExportDefaultDeclaration`.
`import/no-default-export` covers it, and covers it **better** — a purpose-built rule
rather than a raw AST selector. So the gap is real but does not bite here.

It would bite a config that used `no-restricted-syntax` for arbitrary AST patterns.
Check before assuming this transfers to another repository.

### 4a.4 Recommendation

**Adopt Oxlint, and treat it as a gate-semantics change rather than a dependency
bump.** The speed is the least interesting part. The reasons that matter:

1. It **removes typescript-eslint as a TS 7 blocker**, leaving TypeDoc as the only
   reason `typescript@6.0.3` exists.
2. A 3m56s lint is a gate people learn to skip locally. A 13s lint is one they run.

Two conditions before it replaces ESLint rather than joining it:

- **Prove rule parity explicitly.** `recommendedTypeChecked` is ~60 rules; this
  research exercised a handful. Run both linters over the same tree and diff the
  findings before deleting the ESLint config. A quietly weaker lint gate is the
  exact defect class this repository keeps rediscovering.
- **Do not run both as gates.** Two linters over one tree is a second source of
  truth about what is allowed. Swap, or stay.

---

## 5. Adjacent finding: the coverage gate is partly illusory

While testing whether Vitest 5 could land (3.2.7 is two majors behind 5.0.0), the
runner half proved clean: **all 7,246 tests pass on Vitest 5**, plus `test:suites`,
with no API breakage.

What blocks that bump is the coverage gate — and **the gate is what turned out to be
wrong**. Vitest 4 and later remap V8 coverage accurately; Vitest 3 over-reports.
Proven on one file rather than asserted:

> `packages/render/src/resource-warnings.ts` reports **100% under Vitest 3** and
> **66.66% statements under Vitest 5**. The file contains `if (!DEV) return;`, and
> **no test sets `DEV` false**. 100% was impossible. Vitest 3 was over-reporting.

Under honest measurement, six thresholds fail across five packages: global branch
coverage in **physics (92.1%)**, **render-webgl (92.1%)** and **text (94.64%)**,
plus per-file failures in `physics-rapier/src/init.ts`,
`render/src/resource-warnings.ts` and `render-webgl/src/gl-particles.ts`.

**Do the coverage work first; the Vitest bump then falls out for free.** Bumping
first converts a real quality gap into a red build with no owner.

---

## 6. Exit criteria — what unblocks each layer

| Blocked thing | Unblocked when | What to watch |
|---|---|---|
| Drop `typescript@6.0.3` | **TypeDoc** alone, now — Oxlint removes the typescript-eslint half (section 4a) | typedoc#3098: open, no timeline |
| typescript-eslint blocks TS 7 | **Already solved** — Oxlint's type-aware mode requires TS 7 | needs a rule-parity diff before the swap |
| `bun build` replaces `tsc -b` | Bun emits `.d.ts` **and** follows project references | `bun build --help` for `--dts` |
| `bun test` replaces Vitest | the three `vi.*` APIs exist **and** coverage thresholds can fail a build | run `bun test` in `packages/core` |
| Vitest 5 | the five-package coverage campaign in section 5 lands | `bun run coverage` |

None of the first three is a fourJS task; they are other projects' roadmaps. The
fourth is ours, and is the only one worth scheduling.

---

## 7. How to re-measure

Do not trust this document's numbers after the tools move. A measurement expires
when its instrument changes.

```bash
# Which TypeScript is which
node node_modules/ts7/bin/tsc --version
node -p "require('./node_modules/typescript/package.json').version"

# Does TypeScript 7 still type-check everything?
bun run typecheck:tests && bun run typecheck:examples && bun run typecheck:config

# Do the two compilers still agree?
bun run typecheck:ts6

# Do the tools still break on TS 7?  (destructive: reinstall 6.0.3 afterwards)
bun add -d typescript@7.0.2 && bun run docs; bunx eslint playwright.config.ts
bun add -d typescript@6.0.3

# Can Bun emit declarations yet?
bun build --help | grep -iE "dts|declaration"

# How far off is bun test?
cd packages/core && bun test
```

---

## 8. Summary

**We can and did migrate to TypeScript 7 on Bun 1.4.2.** What remains impossible is
narrower than the question implies, and is worth stating exactly:

1. **One TypeScript** is impossible because TypeScript 7 deleted the compiler API.
   Their peer ranges are a symptom, not the cause. **Research on 2026-09-08 halved
   this**: Oxlint's type-aware mode *requires* TS 7, so swapping the linter removes
   typescript-eslint from the blocker list entirely (section 4a). **TypeDoc is then
   the only reason `typescript@6.0.3` exists** — and its own issue is open with no
   timeline, so it must be isolated or replaced rather than waited on (3.1a, 3.1b).
2. **Bun as the build tool** is blocked because a library ships `.d.ts` and
   `bun build` cannot emit them, nor follow the 22-package project-reference graph.
   But "impossible" was too strong: `isolatedDeclarations` gives a tsc-free
   declaration path, and this codebase is **107 annotations away** from satisfying
   it, with 9 of 24 packages already clean (section 4.1). The reason not to do it is
   now cost/benefit, not capability — `tsc -b` on TS 7 builds a package in
   211–401 ms.
3. **Bun as the test runner** is impossible because three `vi.*` APIs this suite
   uses **68 times** (`stubGlobal` 24, `unstubAllGlobals` 22, `resetModules` 22) do
   not exist there, and because `bun test` cannot fail a build on a coverage
   threshold.

None of the three is caused by fourJS. **One now waits on a decision here**: whether
to swap typescript-eslint for Oxlint, which is a gate-semantics change and needs a
rule-parity diff first, not a dependency bump.
