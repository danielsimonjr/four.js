# @four/render-webgpu

WebGPU backend — **interface reserved; not yet implemented.** Part of [four.js](../../README.md).

Reserved for the WebGPU rendering backend (WGSL) per §62 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md) — the preferred backend once `renderer: "auto"` selection lands. WebGPU is an optional tier; the §120 MVP renders with WebGL 2 only (`@four/render-webgl`).

The package exists in the workspace so the §98 monorepo tree stays accurate. The barrel currently exports only `PACKAGE_NAME`, and `tests/` holds a single smoke test. When implemented, it will provide a `Renderer` implementation over `@four/render`'s backend-independent interface.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/render-webgpu`; publishes as `@danielsimonjr/fourjs-render-webgpu`.
