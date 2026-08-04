# create-dependency-graph (CDG)

The MathTS dependency-graph **generator** — a heavy TypeScript parse (run via `tsx`) that
scans the whole codebase and emits the `docs/Architecture/*` documentation. Its read-only
consumer counterpart is `tools/query-dependency-graph` (QDG), which reads the JSON this
tool produces without re-parsing.

> **CDG** is the current nickname; the legacy nickname **DGT** refers to this same tool.

## create-dependency-graph.ts

Scans the codebase and generates comprehensive dependency documentation.

**Usage:**

```bash
# Run via npm script (recommended)
npm run docs:deps

# Or run directly with tsx
npx tsx tools/create-dependency-graph.ts
```

**Output:**

- `docs/Architecture/DEPENDENCY_GRAPH.md` - Markdown documentation
- `docs/Architecture/dependency-graph.json` - JSON data structure
- `docs/Architecture/unused-analysis.md` - unused exports **and dormant files**: source
  files reachable from no entry/build root, split into _orphaned_ (reachable from nothing
  — delete/wire candidates) and _test-only_ (imported by a test, ships nothing); `.d.ts`
  ambient declarations excluded
- `docs/Architecture/wasm-pairing.md` / `wasm-pairing.json` - WASM accelerator ↔
  function pairing: which public `mathTyped` functions route to a WASM bridge
  (`*Dispatch`) vs run pure-JS (generated only when `functions/src/typed/` is in scope)
- `docs/Architecture/parallel-pairing.md` / `parallel-pairing.json` - worker-pool
  (parallel) ↔ function pairing: which public `mathTyped` functions dispatch to
  `computePool` (named op or generic kernel) and whether that op's threshold is
  active or `'never'` (wired but always inline JS). Thresholds are parsed from
  `parallel/src/ComputePool.ts` (`DEFAULT_THRESHOLD_BY_OP` + `thresholdElements`);
  generated only when `functions/src/typed/` is in scope
- `docs/Architecture/webgpu-pairing.md` / `webgpu-pairing.json` - the GPU analog of
  wasm-pairing. Reports GPU routing in **two buckets**, because the GPU pays off in a
  different shape than WASM does:
  - **`standaloneAccelerated`** — plain exported functions that route to WebGPU
    (`fuseUnaryChainAsync`, `elementwiseChainGpuDispatch`, `gpuMatmul`/`gpuAdd`/
    `gpuTranspose`/`gpuScale`). **This is where the GPU acceleration actually lives.**
  - **`gpuAccelerated`** — public `mathTyped` typed-dispatch functions that route to
    WebGPU. **A count of 0 here is EXPECTED and correct, not a gap:** a GPU dispatch
    costs an upload + readback, so a _single_ typed op (`sin(xs)`) is transfer-dominated
    and would be _slower_ on the GPU than JS/WASM. The GPU only wins where the work
    amortizes that transfer — a fused chain, or a large matmul — and those are
    standalone functions. Wiring every typed function to a GPU path would improve the
    number and degrade the library.

  Detected via a `*GpuDispatch` bridge or a direct GPU backend/device reference
  (`GPUBackend` / `gpuMatrixBackend` / `getGpuDevice`)

**Features:**

- Scans all TypeScript files in `src/`
- Parses imports and exports — including bare side-effect `import '…'`, inline
  `import('…')` type expressions, and npm-scoped workspace imports
- Seeds reachability from every build root it can discover: `src/index.ts`, `exports`
  subpaths, `bin` targets, extra `tsup src/*.ts` entries, and secondary `tsc -p <cfg>`
  includes parsed from the package scripts
- Categorizes files into logical modules
- Detects circular dependencies
- Reports dormant files (orphaned vs test-only) and unused exports
- Generates statistics (file count, export count, etc.)
- Produces both human-readable Markdown and machine-readable JSON
- Fully typed TypeScript for type safety

**Generated Documentation Includes:**

- External dependencies (npm packages)
- Node.js built-in dependencies
- Internal dependencies (relative imports)
- Exported classes, interfaces, functions, constants
- Circular dependency analysis
- Visual dependency graph (Mermaid diagram)
- Summary statistics

## Adding New Tools

1. Create a new `.ts` file in this directory
2. Add a corresponding npm script in `package.json`
3. Document the tool in this README
4. Run typecheck before committing: `npm run typecheck`
