# @four/render-canvas

Canvas 2D backend — **interface reserved; not yet implemented.** Part of [four.js](../../README.md).

Reserved for the Canvas 2D rendering backend (2D scenes and fallback rendering) per §62 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md). The §120 MVP renders with WebGL 2 only (`@four/render-webgl`).

The package exists in the workspace so the §98 monorepo tree stays accurate. The barrel currently exports only `PACKAGE_NAME`, and `tests/` holds a single smoke test. When implemented, it will provide a `Renderer` implementation over `@four/render`'s backend-independent interface.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/render-canvas`; publishes as `@danielsimonjr/fourjs-render-canvas`.
