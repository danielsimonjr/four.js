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

## Staged / not yet implemented

- The unit system (§40) as an API — degree/millisecond options are display/authoring conversion only (spec rev 1.3); engine times are seconds and angles radians throughout.
- The plugin host (§81).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/core`; publishes as `@danielsimonjr/fourjs-core`.
