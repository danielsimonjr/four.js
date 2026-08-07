# @four/core

Shared foundation infrastructure — the dependency-free base of every other package. Part of [four.js](../../README.md).

Implements §6a (component model), §6b (eventing), and the §83/§85 error model from [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 1 (§104), with later hoists of shared utilities.

## What's here

- **`EventEmitter`** — the one typed emitter API used by nodes and the application (§6b); re-entrant emissions queue and defer.
- **Component model (§6a)** — `Component`, `ComponentType`, `ComponentHost`, and `ComponentRegistry`; one component per type per host.
- **Errors** — `FourError` / `FourErrorCode` / `isFourError` (§83, §85).
- **Lifecycle** — `Disposable` and `disposeAll`.
- **`SeededRandom`** — xorshift128 with splitmix32 seeding; the deterministic RNG the §33–34 machinery relies on (`@four/motion` and `@four/particles` re-export it).
- **JSON utilities** — `JsonValue` and `cloneJsonValue` (refuses payloads carrying a `__proto__` own key).
- **`DEFAULT_GRAVITY_Y`** — the shared gravity convention (§7a: right-handed Y-up world; gravity is negative Y in both 2D and 3D).
- **Unit system (§40)** — `UnitSystem`, `SI_UNITS`, `resolveUnitSystem`, and the `…ToDisplay` / `…FromDisplay` / `format…` helpers. **Display and authoring conversion only** (spec rev 1.3): declaring a unit system changes nothing the engine computes — every API signature stays radians, seconds, and world units, and the helpers are barred from simulation paths because their arithmetic is inexact in the last bits (§33–§34). Read the header of `src/units.ts` before using them.

## Staged / not yet implemented

- §101's _"unit application in simulation"_ — `@four/physics` reading `scale.lengthToMeters` for the §41 precision envelope (2026-08-07).
- Serializing the unit system into the §79 document header, so a scene reloads in its authored units; waits on a format revision (2026-08-07).
- Text parsing of authored units (`"90°"` → radians) — the numeric direction (`angleFromDisplay`) is what §40 asks for; a locale-aware parser is not (2026-08-07).
- The plugin host (§81).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/core`; publishes as `@danielsimonjr/fourjs-core`.
