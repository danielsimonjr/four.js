# Duplicate Symbols

**Generated**: 2026-08-04 (by tools/create-dependency-graph)

Names that are OWN-DEFINED (not merely re-exported) by >= 2 distinct files across the monorepo, then CLASSIFIED (see `DupEntryTag`) so the actionable subset is clear: `TRUE_DUPLICATE` (real merge targets) vs `DISPATCH_VARIANT` (>=2 `mathTyped(...)` registrations of the same public name — distinct dispatch surfaces, Bucket C delegation candidates, not copy-paste bodies), `ALIAS_DELEGATION` (a `const X = importedY` forward, excluded once <2 real bodies remain), and `ALLOWLISTED` (matches `duplicate-allowlist.json`: hot-path `is*` guards, AssemblyScript mirrors, per-package `VERSION` strings).

> **Note:** This report groups names by OWN definition, not by call graph, then classifies each flagged name (see DupEntryTag): TRUE_DUPLICATE (the actionable merge targets), DISPATCH_VARIANT (>=2 mathTyped(...) registrations of the same public name — distinct dispatch surfaces, Bucket C delegation candidates, not copy-paste bodies), ALIAS_DELEGATION (a const-alias forward to an imported symbol, not an independent body — excluded once fewer than 2 real bodies remain), and ALLOWLISTED (matches duplicate-allowlist.json: hot-path is* guards, AssemblyScript mirrors, per-package VERSION strings). NOT detected: same-file typed-dispatch overload polymorphism for different argument shapes within one registration — a human still triages TRUE_DUPLICATE entries using the defining files + public flags before merging anything.

## Summary — runtime (function/constant/class)

| Category | Count |
| --- | --: |
| **TRUE_DUPLICATE** (actionable) | 5 |
| DISPATCH_VARIANT | 0 |
| ALIAS_DELEGATION | 0 |
| ALLOWLISTED | 0 |
| _Total flagged names_ | 5 |

## Summary — types (interface/type/enum)

| Category | Count |
| --- | --: |
| **TRUE_DUPLICATE** (actionable) | 2 |
| DISPATCH_VARIANT | 0 |
| ALIAS_DELEGATION | 0 |
| ALLOWLISTED | 0 |
| _Total flagged names_ | 2 |

## Runtime duplicates

### TRUE_DUPLICATE — actionable merge targets

| Name | Category | Defining files (package, public?, sub-tag) | Canonical hint |
| --- | --- | --- | --- |
| `PACKAGE_NAME` | constant | `packages/animation/src/index.ts` (@four/animation, public, PLAIN)<br>`packages/assets/src/index.ts` (@four/assets, public, PLAIN)<br>`packages/core/src/index.ts` (@four/core, public, PLAIN)<br>`packages/diagnostics/src/index.ts` (@four/diagnostics, public, PLAIN)<br>`packages/geometry/src/index.ts` (@four/geometry, public, PLAIN)<br>`packages/input/src/index.ts` (@four/input, public, PLAIN)<br>`packages/materials/src/index.ts` (@four/materials, public, PLAIN)<br>`packages/math/src/index.ts` (@four/math, public, PLAIN)<br>`packages/motion/src/index.ts` (@four/motion, public, PLAIN)<br>`packages/particles/src/index.ts` (@four/particles, public, PLAIN)<br>`packages/physics-box2d/src/index.ts` (@four/physics-box2d, public, PLAIN)<br>`packages/physics-rapier/src/index.ts` (@four/physics-rapier, public, PLAIN)<br>`packages/physics-soft/src/index.ts` (@four/physics-soft, public, PLAIN)<br>`packages/physics/src/index.ts` (@four/physics, public, PLAIN)<br>`packages/render-canvas/src/index.ts` (@four/render-canvas, public, PLAIN)<br>`packages/render-svg/src/index.ts` (@four/render-svg, public, PLAIN)<br>`packages/render-webgl/src/index.ts` (@four/render-webgl, public, PLAIN)<br>`packages/render-webgpu/src/index.ts` (@four/render-webgpu, public, PLAIN)<br>`packages/render/src/index.ts` (@four/render, public, PLAIN)<br>`packages/scene/src/index.ts` (@four/scene, public, PLAIN)<br>`packages/serialization/src/index.ts` (@four/serialization, public, PLAIN)<br>`packages/text/src/index.ts` (@four/text, public, PLAIN)<br>`packages/ui/src/index.ts` (@four/ui, public, PLAIN) | **AMBIGUOUS** |
| `cloneJsonValue` | function | `packages/diagnostics/src/replay-format.ts` (@four/diagnostics, public, PLAIN)<br>`packages/serialization/src/format.ts` (@four/serialization, public, PLAIN) | **AMBIGUOUS** |
| `DEFAULT_GRAVITY_Y` | constant | `packages/particles/src/fields.ts` (@four/particles, public, PLAIN)<br>`packages/physics/src/descriptors.ts` (@four/physics, public, PLAIN) | **AMBIGUOUS** |
| `PARTICLE_INSTANCE_FLOATS` | constant | `packages/particles/src/particle-renderable.ts` (@four/particles, public, PLAIN)<br>`packages/render/src/particles.ts` (@four/render, public, PLAIN) | **AMBIGUOUS** |
| `SeededRandom` | class | `packages/motion/src/random.ts` (@four/motion, public, PLAIN)<br>`packages/particles/src/random.ts` (@four/particles, public, PLAIN) | **AMBIGUOUS** |

### DISPATCH_VARIANT — distinct public typed-dispatch surfaces (Bucket C candidates)

_None._

### ALIAS_DELEGATION — const-alias forwards (not independent bodies)

_None._

### ALLOWLISTED — accepted layering (see duplicate-allowlist.json)

_None._

## Type duplicates (lower priority)

### TRUE_DUPLICATE

| Name | Category | Defining files (package, public?, sub-tag) | Canonical hint |
| --- | --- | --- | --- |
| `ColorRGBA` | type | `packages/animation/src/values.ts` (@four/animation, public, PLAIN)<br>`packages/materials/src/unlit-material.ts` (@four/materials, public, PLAIN) | **AMBIGUOUS** |
| `JsonValue` | type | `packages/diagnostics/src/replay-format.ts` (@four/diagnostics, public, PLAIN)<br>`packages/serialization/src/format.ts` (@four/serialization, public, PLAIN) | **AMBIGUOUS** |

### DISPATCH_VARIANT

_None._

### ALIAS_DELEGATION

_None._

### ALLOWLISTED

_None._

