# @four/render-svg

SVG backend — **interface reserved; not yet implemented.** Part of [four.js](../../README.md).

Reserved for the SVG rendering backend (vector output and 2D fallback) per §62 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md). The §120 MVP renders with WebGL 2 only (`@four/render-webgl`).

The package exists in the workspace so the §98 monorepo tree stays accurate. The barrel currently exports only `PACKAGE_NAME`, and `tests/` holds a single smoke test. When implemented, it will provide a `Renderer` implementation over `@four/render`'s backend-independent interface.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/render-svg`; publishes as `@danielsimonjr/fourjs-render-svg`.
