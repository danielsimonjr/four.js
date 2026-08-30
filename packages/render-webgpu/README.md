# @four/render-webgpu

WebGPU backend — §62 backend 1. Part of [four.js](../../README.md).

Implements `@four/render`'s `Renderer` over WebGPU (WP-R1.1–R1.9, 2026-08-21…29; the R-1 plan is complete). Applications select a backend at the edge — nothing in `@four/scene`, `@four/motion`, or `@four/physics` may name anything in this package. **Calling `registerWebgpuRenderer()` moves an application off WebGL 2**, because `AUTO_RENDERER_ORDER` prefers WebGPU.

This package was a reserved stub until WP-R1.1 landed 2026-08-21. The barrel no longer exports only `PACKAGE_NAME`.

## What's here

- **`WebgpuRenderer`** — the one public entry point. Unlit / sprite / lit / standard families, opt-in §65 batching, textures + samplers, §67 clips + §57 stencil parity, render targets / §70 effects / `readPixels`, the §69 directional shadow tier, §36 instanced particles, §82 compute, and §60 node materials + §70 graph effects behind `registerWebgpuNodeMaterialPipeline()`.
- **`registerWebgpuRenderer` / `isWebgpuSupported`** — §62's opt-in registry seam.
- **Testing seams** — the structural device surface, pipeline cache, bind-group layouts, and WGSL builders, so the backend can be unit-tested against a fake device with no GPU and no browser (Node has no `navigator.gpu`; see `tests/integration/helpers/recording-gpu.ts`).

Absent, not stubbed: RFC 0003's skinned pipelines and §71 picking (`createPickingService` is not declared).

Unit tests are colocated in `tests/` per §92. Browser-pixel coverage lives under `tests/browser/webgpu/`.

Workspace name `@four/render-webgpu`; publishes as `@danielsimonjr/fourjs-render-webgpu`.
