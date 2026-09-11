# RFC 0001 implementation addendum: safe shader composition

Date: 2026-09-11. Implements additional slices of the owner's request to finish
the RFCs. This records implementation choices; it does not assert that the
remaining storage-buffer and scene-light contracts have shipped.

## Decision and compatibility

Reusable operators are `ShaderFunction` data declarations containing an existing
validated `ShaderGraph`, a name, an ordered list of uniform parameters, and an
optional result node (default: colour output). The graph's ordinary colour output
still validates independently; a function can return any typed intermediate.
Calls inline the graph with remapped node IDs. Each call therefore has an isolated
emission scope without introducing a second shader language, recursion or raw
source. Repeated calls of the same function object with the same receiving builder
and argument node IDs reuse the result. Names and arguments are validated; the
constructor copies and freezes declarations, so later JSON mutation cannot change
existing operators. All uniforms must be explicit parameters; samplers keep their
explicit names so resource feedback remains checkable. Inlined graphs remain
subject to the existing 1,024-node limit.

`ShaderOperatorRegistry.registerDefinition()` adds this data-only route to the
existing `SHADER_OPERATORS` capability. `getDefinition()` returns the compiled
safe declaration. Native factory registration remains compatible, and either
registration route refuses an occupied name. No scene file can inject GLSL/WGSL.
Runtime validation now also rejects non-enumerated unary/binary operator strings:
TypeScript unions alone were insufficient protection for JSON input. Inherited
object properties are rejected as value types and attributes.

`ShaderVariantSet` provides bounded, immutable, named graph alternatives with
sorted keys and explicit selection. Each variant has its own complete graph and
reflection; inactive alternatives do not reserve resources. Existing backend
structural-source caches share equivalent variants and separate distinct ones.
This finite family is not an IR-level Boolean define/specialization system;
such conditional expressions and their additional cache key remain future work.

GLSL and WGSL emission results now expose frozen per-node source maps. Locations
are one-based generated lines/columns and identify the original graph node and
shader stage. Maps are extracted from deterministic local declarations, preserving
all pre-existing shader bytes and structural cache keys. WebGL compile errors
include the map alongside the existing driver error context. WGSL requests standard `getCompilationInfo()` when available and retains
source-map-enriched `FourError` records in
`WgpuNodePipelineStore.compilationErrors`, with development warnings. Late
reports after disposal are ignored and rejected diagnostic requests are contained.

## Opt-in std140 transport and measured tradeoff

`ShaderGraphBuilder.useUniformBlock()` sets `uniformTransport: "std140"` in the
serializable graph. WebGL emits a shared `FourNodeUniforms` block in both stages,
with identical field order. Scalars/vectors occupy one padded vec4 lane;
matrices occupy four lanes (mat3 is read from a padded mat4). This matches the
existing WebGPU packing philosophy and avoids cross-driver vec3 packing ambiguity.
Logical reflected types and `setUniform()` values do not change. WebGPU already
uses a uniform block and retains its established layout and emitted bytes.

A WebGL surface material packs and uploads the block once per draw. Screen-effect
`setUniform()` calls upload after each changed field, preserving that existing
immediate API. Each program owns its buffer, binds it explicitly when used, and
releases it on disposal or failed initialization. Missing WebGL 2 block APIs,
missing linked blocks, and allocation failures are explicit compilation errors.
The ordinary individual-uniform path stays the default and is byte-identical.

Reproduce with `node benchmarks/shader-uniform-block.mjs` after building packages.
The instrumented WebGL call measurement (16 scalar uniforms, 1,000 material draws,
excluding initial buffer allocation and opacity setup) reports:

| Transport     | Upload calls | Payload bytes |
| ------------- | -----------: | ------------: |
| Individual    |       16,000 |        64,000 |
| Padded std140 |        1,000 |       256,000 |

This measures a 16-fold call reduction at a 4-fold scalar payload increase, not a
GPU speedup. No hardware-dependent performance claim follows from a mock driver.
The opt-in choice keeps small materials and current application bundles stable.
Per-renderable uniform overrides are a separate API and are not implied here.

## Validation and remaining work

Tests cover parameter typing and scope, deterministic call caching, every closed
IR node form, safe registry collisions, immutable variants, both source maps,
all six uniform packing types, upload counts, cleanup and allocation/driver
failures, empty blocks, and unsupported contexts. Existing shader generation
stays unchanged without opt-in transport.

Storage-buffer bindings for graph shaders, automatic scene-light uniforms, and
IR-level conditional specialization are not implemented by this addendum.
