# query-dependency-graph

The **read-only consumer** counterpart to `create-dependency-graph` (CDG). It reads
CDG's `docs/Architecture/dependency-graph.json` (+ `package-export-surfaces.json`) — it
does **not** re-parse the codebase — and answers the structural questions an agent
otherwise greps for, plus emits two derived artifacts.

Zero dependencies (plain Node ESM). CDG generates; this tool queries.

## Usage

```bash
# Query surface (instant — reads the generated JSON)
npm run docs:graph -- dependents <file>       # intra-package files importing <file>
npm run docs:graph -- symbol-users <symbol>   # files importing <symbol> (any package)
npm run docs:graph -- is-public <pkg> <sym>   # is <sym> in <pkg>'s public export surface?
npm run docs:graph -- node-safety [pkg]       # node:-using files reachable from a browser `.` entry
npm run docs:graph -- cycles                  # circular dependencies

# Gate — exit 1 if a browser-safe package's `.` entry reaches node: code
npm run check:browser-safety

# Emit derived artifacts (run as part of `npm run docs:deps`)
npm run docs:deps:derive
#   → docs/Architecture/dependency-reverse.json  (reverse edges: "who imports X")
#   → docs/Architecture/node-safety.json         (node:-taint + browser-safety leaks)

# Or run directly
node tools/query-dependency-graph/query-dependency-graph.mjs <command> [args]

# Extractor unit tests
npm run docs:graph:test
```

## Browser-safety model

Every package's `.` (browser-facing) entry must stay free of `node:` builtins, EXCEPT
the designated Node runtimes (currently just `workbook`, the CLI/serve runtime). The set
is derived from the graph's main entry points, so new packages are enforced by default.
`--check-browser-safety` fails (exit 1) if any browser-safe package's `.` entry
transitively reaches a `node:`-using file.

## Relationship to create-dependency-graph (CDG)

```
create-dependency-graph  →  dependency-graph.json  →  query-dependency-graph
   (parse, ~40s, tsx)         (the interface)          (instant, node .mjs)
```

Deliberately kept separate: CDG is a heavy TypeScript parse; this is an instant JSON
reader. See `docs/FEATURE_WORKFLOW.md` for how CDG is used at brainstorm (placement
probe) and merge-gate (0 cycles / 0 new dormant / 0 browser-safety leaks) time.
