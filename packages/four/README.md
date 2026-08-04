# four

Umbrella package and application composition root. Part of [four.js](../../README.md).

Implements §45 and §98 of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md). `import * as Four from "four"` exposes every workspace package as a namespace (`Four.scene`, `Four.physics`, `Four.animation`, …).

## What's here

- **`Application`** — the §45 composition root and the only API this package owns rather than re-exports: it wires the §10 fixed-step scheduler, the §39 system registry, world-transform resolution, and the `fixedUpdate` / `update` / `render` events (`ApplicationEventMap`), with an optional injected renderer.
- **Namespace re-exports** — one namespace per package (`core`, `math`, `scene`, `geometry`, `materials`, `assets`, `motion`, `input`, `serialization`, `diagnostics`, `particles`, `text`, `render`, `animation`, `physics`, the render backends, `ui`, and the physics solver packages).
- A renderer-free headless composition path via the `four/application` subpath.

## Notes and deviations

- `ApplicationOptions.renderer` takes a `Renderer` **instance**, not §45's string union — string/`"auto"` backend selection is deferred to a §62 registry so this package never imports backends at runtime (recorded spec §45 departure).

Unit tests are colocated in `tests/` per §92.

Workspace name `four`; publishes as `@danielsimonjr/fourjs`.
