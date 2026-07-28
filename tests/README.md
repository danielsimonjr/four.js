# Cross-package test suites

Test taxonomy per the testing strategy (§92). **Unit tests are colocated in each package**
(`packages/<name>/tests/`); performance tests live in [`benchmarks/`](../benchmarks/).

- [`integration/`](integration/) — Cross-package integration tests (§92): scene+renderer, fixed-step physics with interpolated rendering, 2D/3D picking, assets+materials, animation-to-physics transitions, UI focus/accessibility bridge.
- [`visual/`](visual/) — Visual regression tests (§92): fills/strokes, joins/caps, transparency, materials/lighting, text layout, clipping, mixed 2D/3D ordering, debug overlays.
- [`determinism/`](determinism/) — Determinism tests (§33, §92): identical input streams produce identical checksums; snapshot restoration reproduces subsequent states; replay stays stable within the declared tier.
