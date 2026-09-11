/**
 * Size-limit budget rationale for §86 example bundles (2026-09-07).
 *
 * Limits live in `.size-limit.json`. JSON has no comment field, so A/B
 * justification is recorded here and referenced from that file by path.
 *
 * Measure after `bun run examples:build` with `bun run size`. The numbers
 * below are the CI measurement from `cursor/browser-gate-after-76-8caa`
 * (run 34068239028) after #76 — that PR never reached the size step.
 *
 * | Example            | Measured (gzip) | Prior limit | New limit | Rationale |
 * |--------------------|-----------------|-------------|-----------|-----------|
 * | first-3d-scene     | 42.1 kB         | 39 kB       | 43 kB     | +3.1 kB — #76 production path (gpu-timer getter, resource-memory helpers that DCE, render/particle follow-ups). A: hold at 39 → red; B: 43 kB → ~2 % headroom. |
 * | particles-demo     | 42.21 kB        | 37.5 kB     | 43 kB     | +4.71 kB — R-32 wide instance layout + trail/appearance in the demo graph. B keeps ~1.8 % margin. |
 * | ui-demo            | 48.47 kB        | 46 kB       | 49.5 kB   | +2.47 kB — A-13 a11y mirror + A-5 stats seams already in the retained-mode graph. B avoids toolchain-flake on Vite 8.2. |
 * | flagship           | 1.98 MB         | 1.65 MB     | 2.05 MB   | +328 kB — Rapier 0.20.0 ships larger wasm; this site registers both 2d and 3d adapters. |
 * | motor-digital-twin | 1.22 MB         | 1.00 MB     | 1.25 MB   | +219 kB — one Rapier 0.20 wasm image (directly constructed 3d adapter). |
 * | character-controller | 1.15 MB       | 0.95 MB     | 1.20 MB   | +203 kB — same single 0.20 wasm image as the twin. |
 *
 * first-2d-scene (56.23 / 150 kB) unchanged — still well under §86's
 * minimal-2D-app gate. `__FOUR_DEV__: false` on every production example
 * except the twin; the wasm deltas are the solver bump, not DEV leftovers.
 *
 * **2026-09-11 (after #92, measured locally on the rebased RFC-audit branch):**
 * #92's `HemisphereLight` (§68) grew **every** example bundle by ~480–520 B
 * gzip, light-free ones included — the A/B at 07d4eab (pre-#92) vs 318e6bd:
 * first-2d 57.60 → 58.08, first-3d 42.93 → 43.42, particles-demo 43.20 → 43.72,
 * ui-demo 49.75 → 50.25. Traced in the built bundles: the node class does
 * **not** ride (it tree-shakes); what does is the structural collector branch
 * + three `SceneLights` fields in `@fourjs/render`, and the GLSL chunk +
 * `HemisphereLightUniforms` spliced into the lit / standard / skinned-lit
 * programs the WebGL renderer compiles at init (the 0.75 kB law). Collapsing
 * the two GLSL helpers into one and compacting the uploader recovered
 * ~20–30 B (58.06 / 43.41 / 43.70 / 50.22); the rest is the feature. Three
 * budgets rose to keep ~1.4–2 % headroom; first-2d stays far under §86's gate.
 *
 * | Example        | Measured (gzip) | Prior limit | New limit | Rationale |
 * |----------------|-----------------|-------------|-----------|-----------|
 * | first-3d-scene | 43.41 kB        | 43 kB       | 44 kB     | +0.48 kB hemisphere in lit/standard programs compiled at init |
 * | particles-demo | 43.70 kB        | 43.5 kB     | 44.5 kB   | same mechanism |
 * | ui-demo        | 50.22 kB        | 50 kB       | 51 kB     | same mechanism (no lights in the demo; the programs still ship) |
 *
 * **2026-09-09 (#86 squash on main, run 34339266079):** PickProvider,
 * WebGL `ParticleIdProgram`, 192-byte `DrawUniforms`, and the particles-demo
 * simulate/present split pushed two gzip bundles over the 2026-09-07
 * ceilings. Browser tests were green (107/107). first-3d 42.74/43 kB holds.
 *
 * | Example        | Measured (gzip) | Prior limit | New limit | Rationale |
 * |----------------|-----------------|-------------|-----------|-----------|
 * | particles-demo | 43.04 kB        | 43 kB       | 43.5 kB   | +38 B over — id-pass / appearance already in the demo graph. A: hold at 43 → red; B: 43.5 kB. |
 * | ui-demo        | 49.51 kB        | 49.5 kB     | 50 kB     | +11 B over — PickProvider on `@fourjs/input` rides the retained-mode graph. B: 50 kB. |
 */

export const SIZE_BUDGETS_DOC = "tools/size-budgets.mjs";
