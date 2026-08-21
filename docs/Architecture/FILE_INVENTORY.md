# Complete File Inventory

**Generated**: 2026-08-21 (by tools/create-dependency-graph)

Every tracked `.ts` file in the repo — package `src/` and `tests/`, the repo-root cross-package `tests/`, `tools/`, build/test `*.config.ts`, `examples/`, and `docs/` reference sources — tagged with a disposition. A completeness census: no `.ts` may be silently missing. The self-check gate (`verifyFileCensus`) does a MAXIMAL, location-agnostic repo walk (broader than this census’s enumerated discovery) and HARD-FAILS `npm run docs:deps` if any `.ts` on disk is unaccounted, or if any `orphan` exists.

**Excluded by design (not source):** `node_modules/`, `dist/`, `*.d.ts` ambient declarations, and dot-directories (`.git/`, `.remember/`, `.changeset/`, …). The walk set equals the git-tracked `.ts` files, so there is no silent allowlist — every tracked `.ts` appears below with an explicit disposition.

**Total files**: 544

## Disposition counts

| Disposition | Count | Meaning |
| --- | --: | --- |
| `reachable` | 177 | A `src/` file in the module graph, reachable from a root. |
| `build-entry` | 48 | A detected build/subpath/`bin`/worker/`tsup.config` root (index, internal, cli, render-file, run-worker, …). |
| `test-only` | 0 | A `src/` file not reachable from src roots but imported by a test. |
| `orphan` | 0 | A `src/` file reachable from nothing — a delete/wire candidate (hard-fails the gate). |
| `test` | 297 | A test source file (under a `tests/` dir, or a `*.test.ts`/`*.spec.ts`). |
| `tool` | 1 | A file under `tools/` — agent-only meta-tooling (CDG/QDG/benchmarks). |
| `config` | 12 | A build/test config source (`*.config.ts`: vitest/tsup, per-package or root). |
| `example` | 9 | An `examples/` or `docs/` reference/illustration source. |
| **Total** | **544** | |

## Per-area counts

| Area | Files |
| --- | --: |
| `config` | 12 |
| `examples` | 9 |
| `src` | 225 |
| `tests` | 297 |
| `tools` | 1 |

## Per-package counts

| Package | Files |
| --- | --: |
| `(root)` | 132 |
| `@four/animation` | 25 |
| `@four/assets` | 14 |
| `@four/core` | 22 |
| `@four/diagnostics` | 19 |
| `@four/geometry` | 19 |
| `@four/input` | 13 |
| `@four/materials` | 11 |
| `@four/math` | 16 |
| `@four/motion` | 35 |
| `@four/particles` | 16 |
| `@four/physics` | 43 |
| `@four/physics-box2d` | 2 |
| `@four/physics-rapier` | 20 |
| `@four/physics-soft` | 2 |
| `@four/render` | 34 |
| `@four/render-canvas` | 2 |
| `@four/render-svg` | 2 |
| `@four/render-webgl` | 15 |
| `@four/render-webgpu` | 2 |
| `@four/scene` | 29 |
| `@four/serialization` | 9 |
| `@four/text` | 6 |
| `@four/ui` | 23 |
| `four` | 33 |

## All files

| file | package | area | disposition |
| --- | --- | --- | --- |
| `examples/blending/main.ts` | (root) | examples | example |
| `examples/blending/vite.config.ts` | (root) | config | config |
| `examples/first-2d-scene/main.ts` | (root) | examples | example |
| `examples/first-2d-scene/vite.config.ts` | (root) | config | config |
| `examples/first-3d-scene/main.ts` | (root) | examples | example |
| `examples/first-3d-scene/vite.config.ts` | (root) | config | config |
| `examples/flagship/motor-digital-twin/main.ts` | (root) | examples | example |
| `examples/flagship/motor-digital-twin/vite.config.ts` | (root) | config | config |
| `examples/flagship/one-scene-everything-moves/main.ts` | (root) | examples | example |
| `examples/flagship/one-scene-everything-moves/vite.config.ts` | (root) | config | config |
| `examples/mechanism/main.ts` | (root) | examples | example |
| `examples/mechanism/vite.config.ts` | (root) | config | config |
| `examples/particles-demo/main.ts` | (root) | examples | example |
| `examples/particles-demo/vite.config.ts` | (root) | config | config |
| `examples/physics-playground/main.ts` | (root) | examples | example |
| `examples/physics-playground/vite.config.ts` | (root) | config | config |
| `examples/ui-demo/main.ts` | (root) | examples | example |
| `examples/ui-demo/vite.config.ts` | (root) | config | config |
| `packages/animation/src/animation-system.ts` | @four/animation | src | reachable |
| `packages/animation/src/binding.ts` | @four/animation | src | reachable |
| `packages/animation/src/clip.ts` | @four/animation | src | reachable |
| `packages/animation/src/controller.ts` | @four/animation | src | reachable |
| `packages/animation/src/easing.ts` | @four/animation | src | reachable |
| `packages/animation/src/index.ts` | @four/animation | src | build-entry |
| `packages/animation/src/mixer.ts` | @four/animation | src | reachable |
| `packages/animation/src/timeline.ts` | @four/animation | src | reachable |
| `packages/animation/src/track.ts` | @four/animation | src | reachable |
| `packages/animation/src/tween.ts` | @four/animation | src | reachable |
| `packages/animation/src/values.ts` | @four/animation | src | reachable |
| `packages/animation/tests/adapter-surface.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/animation-system.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/binding.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/clip.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/controller.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/easing.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/mixer.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/pose-target-binding.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/root-motion.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/smoke.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/timeline.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/track.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/tween.test.ts` | @four/animation | tests | test |
| `packages/animation/tests/values.test.ts` | @four/animation | tests | test |
| `packages/assets/src/asset-manager.ts` | @four/assets | src | reachable |
| `packages/assets/src/content-hash.ts` | @four/assets | src | reachable |
| `packages/assets/src/index.ts` | @four/assets | src | build-entry |
| `packages/assets/src/loaders.ts` | @four/assets | src | reachable |
| `packages/assets/src/manifest.ts` | @four/assets | src | reachable |
| `packages/assets/src/texture.ts` | @four/assets | src | reachable |
| `packages/assets/tests/asset-manager.test.ts` | @four/assets | tests | test |
| `packages/assets/tests/cancellation.test.ts` | @four/assets | tests | test |
| `packages/assets/tests/content-hash.test.ts` | @four/assets | tests | test |
| `packages/assets/tests/loaders.test.ts` | @four/assets | tests | test |
| `packages/assets/tests/manifest.test.ts` | @four/assets | tests | test |
| `packages/assets/tests/security.test.ts` | @four/assets | tests | test |
| `packages/assets/tests/smoke.test.ts` | @four/assets | tests | test |
| `packages/assets/tests/texture.test.ts` | @four/assets | tests | test |
| `packages/core/src/component.ts` | @four/core | src | reachable |
| `packages/core/src/conventions.ts` | @four/core | src | reachable |
| `packages/core/src/dev.ts` | @four/core | src | reachable |
| `packages/core/src/disposable.ts` | @four/core | src | reachable |
| `packages/core/src/errors.ts` | @four/core | src | reachable |
| `packages/core/src/events.ts` | @four/core | src | reachable |
| `packages/core/src/index.ts` | @four/core | src | build-entry |
| `packages/core/src/json.ts` | @four/core | src | reachable |
| `packages/core/src/random.ts` | @four/core | src | reachable |
| `packages/core/src/space.ts` | @four/core | src | reachable |
| `packages/core/src/units.ts` | @four/core | src | reachable |
| `packages/core/src/untrusted.ts` | @four/core | src | reachable |
| `packages/core/tests/component.test.ts` | @four/core | tests | test |
| `packages/core/tests/dev.test.ts` | @four/core | tests | test |
| `packages/core/tests/errors.test.ts` | @four/core | tests | test |
| `packages/core/tests/events.test.ts` | @four/core | tests | test |
| `packages/core/tests/json.test.ts` | @four/core | tests | test |
| `packages/core/tests/random.test.ts` | @four/core | tests | test |
| `packages/core/tests/smoke.test.ts` | @four/core | tests | test |
| `packages/core/tests/space.test.ts` | @four/core | tests | test |
| `packages/core/tests/units.test.ts` | @four/core | tests | test |
| `packages/core/tests/untrusted.test.ts` | @four/core | tests | test |
| `packages/diagnostics/src/checksum.ts` | @four/diagnostics | src | reachable |
| `packages/diagnostics/src/debug-draw.ts` | @four/diagnostics | src | reachable |
| `packages/diagnostics/src/index.ts` | @four/diagnostics | src | build-entry |
| `packages/diagnostics/src/recorder.ts` | @four/diagnostics | src | reachable |
| `packages/diagnostics/src/replay-format.ts` | @four/diagnostics | src | reachable |
| `packages/diagnostics/src/replay-player.ts` | @four/diagnostics | src | reachable |
| `packages/diagnostics/src/resource-audit.ts` | @four/diagnostics | src | reachable |
| `packages/diagnostics/src/rollback.ts` | @four/diagnostics | src | reachable |
| `packages/diagnostics/src/stats.ts` | @four/diagnostics | src | reachable |
| `packages/diagnostics/tests/checksum.test.ts` | @four/diagnostics | tests | test |
| `packages/diagnostics/tests/debug-draw.test.ts` | @four/diagnostics | tests | test |
| `packages/diagnostics/tests/recorder.test.ts` | @four/diagnostics | tests | test |
| `packages/diagnostics/tests/replay-format.test.ts` | @four/diagnostics | tests | test |
| `packages/diagnostics/tests/replay-player.test.ts` | @four/diagnostics | tests | test |
| `packages/diagnostics/tests/resource-audit.test.ts` | @four/diagnostics | tests | test |
| `packages/diagnostics/tests/rollback.test.ts` | @four/diagnostics | tests | test |
| `packages/diagnostics/tests/smoke.test.ts` | @four/diagnostics | tests | test |
| `packages/diagnostics/tests/stats.test.ts` | @four/diagnostics | tests | test |
| `packages/diagnostics/tests/untrusted.test.ts` | @four/diagnostics | tests | test |
| `packages/four/src/animation.ts` | four | src | build-entry |
| `packages/four/src/application.ts` | four | src | build-entry |
| `packages/four/src/assets.ts` | four | src | build-entry |
| `packages/four/src/core.ts` | four | src | build-entry |
| `packages/four/src/diagnostics.ts` | four | src | build-entry |
| `packages/four/src/geometry.ts` | four | src | build-entry |
| `packages/four/src/index.ts` | four | src | build-entry |
| `packages/four/src/input.ts` | four | src | build-entry |
| `packages/four/src/materials.ts` | four | src | build-entry |
| `packages/four/src/math.ts` | four | src | build-entry |
| `packages/four/src/motion.ts` | four | src | build-entry |
| `packages/four/src/particles.ts` | four | src | build-entry |
| `packages/four/src/physics-box2d.ts` | four | src | build-entry |
| `packages/four/src/physics-rapier.ts` | four | src | build-entry |
| `packages/four/src/physics-soft.ts` | four | src | build-entry |
| `packages/four/src/physics.ts` | four | src | build-entry |
| `packages/four/src/render-canvas.ts` | four | src | build-entry |
| `packages/four/src/render-svg.ts` | four | src | build-entry |
| `packages/four/src/render-webgl.ts` | four | src | build-entry |
| `packages/four/src/render-webgpu.ts` | four | src | build-entry |
| `packages/four/src/render.ts` | four | src | build-entry |
| `packages/four/src/scene-serializers.ts` | four | src | reachable |
| `packages/four/src/scene.ts` | four | src | build-entry |
| `packages/four/src/serialization.ts` | four | src | build-entry |
| `packages/four/src/text-node.ts` | four | src | reachable |
| `packages/four/src/text.ts` | four | src | build-entry |
| `packages/four/src/ui.ts` | four | src | build-entry |
| `packages/four/tests/application.test.ts` | four | tests | test |
| `packages/four/tests/barrels.test.ts` | four | tests | test |
| `packages/four/tests/scene-serializers.test.ts` | four | tests | test |
| `packages/four/tests/shape-serializers.test.ts` | four | tests | test |
| `packages/four/tests/smoke.test.ts` | four | tests | test |
| `packages/four/tests/text-node.test.ts` | four | tests | test |
| `packages/geometry/src/buffer-geometry.ts` | @four/geometry | src | reachable |
| `packages/geometry/src/geometry.ts` | @four/geometry | src | reachable |
| `packages/geometry/src/index.ts` | @four/geometry | src | build-entry |
| `packages/geometry/src/path.ts` | @four/geometry | src | reachable |
| `packages/geometry/src/primitive-support.ts` | @four/geometry | src | reachable |
| `packages/geometry/src/primitives-3d.ts` | @four/geometry | src | reachable |
| `packages/geometry/src/primitives.ts` | @four/geometry | src | reachable |
| `packages/geometry/src/resource-memory.ts` | @four/geometry | src | reachable |
| `packages/geometry/src/svg-path.ts` | @four/geometry | src | reachable |
| `packages/geometry/src/tessellation.ts` | @four/geometry | src | reachable |
| `packages/geometry/tests/geometry-base.test.ts` | @four/geometry | tests | test |
| `packages/geometry/tests/geometry.test.ts` | @four/geometry | tests | test |
| `packages/geometry/tests/path.test.ts` | @four/geometry | tests | test |
| `packages/geometry/tests/primitives-3d.test.ts` | @four/geometry | tests | test |
| `packages/geometry/tests/resource-memory.test.ts` | @four/geometry | tests | test |
| `packages/geometry/tests/smoke.test.ts` | @four/geometry | tests | test |
| `packages/geometry/tests/stroke.test.ts` | @four/geometry | tests | test |
| `packages/geometry/tests/svg-path.test.ts` | @four/geometry | tests | test |
| `packages/geometry/tests/tessellation.test.ts` | @four/geometry | tests | test |
| `packages/input/src/drag.ts` | @four/input | src | reachable |
| `packages/input/src/index.ts` | @four/input | src | build-entry |
| `packages/input/src/key-events.ts` | @four/input | src | reachable |
| `packages/input/src/keyboard-input.ts` | @four/input | src | reachable |
| `packages/input/src/pick.ts` | @four/input | src | reachable |
| `packages/input/src/pointer-events.ts` | @four/input | src | reachable |
| `packages/input/src/pointer-input.ts` | @four/input | src | reachable |
| `packages/input/src/propagation.ts` | @four/input | src | reachable |
| `packages/input/tests/keyboard.test.ts` | @four/input | tests | test |
| `packages/input/tests/pick.test.ts` | @four/input | tests | test |
| `packages/input/tests/pointer-type.test.ts` | @four/input | tests | test |
| `packages/input/tests/pointer.test.ts` | @four/input | tests | test |
| `packages/input/tests/smoke.test.ts` | @four/input | tests | test |
| `packages/materials/src/index.ts` | @four/materials | src | build-entry |
| `packages/materials/src/lit-material.ts` | @four/materials | src | reachable |
| `packages/materials/src/material.ts` | @four/materials | src | reachable |
| `packages/materials/src/sprite-material.ts` | @four/materials | src | reachable |
| `packages/materials/src/standard-material.ts` | @four/materials | src | reachable |
| `packages/materials/src/stencil-state.ts` | @four/materials | src | reachable |
| `packages/materials/src/texture.ts` | @four/materials | src | reachable |
| `packages/materials/src/unlit-material.ts` | @four/materials | src | reachable |
| `packages/materials/tests/materials.test.ts` | @four/materials | tests | test |
| `packages/materials/tests/smoke.test.ts` | @four/materials | tests | test |
| `packages/materials/tests/stencil-state.test.ts` | @four/materials | tests | test |
| `packages/math/src/alloc-counter.ts` | @four/math | src | reachable |
| `packages/math/src/color.ts` | @four/math | src | reachable |
| `packages/math/src/frustum.ts` | @four/math | src | reachable |
| `packages/math/src/index.ts` | @four/math | src | build-entry |
| `packages/math/src/matrix3.ts` | @four/math | src | reachable |
| `packages/math/src/matrix4.ts` | @four/math | src | reachable |
| `packages/math/src/quaternion.ts` | @four/math | src | reachable |
| `packages/math/src/vector2.ts` | @four/math | src | reachable |
| `packages/math/src/vector3.ts` | @four/math | src | reachable |
| `packages/math/src/vector4.ts` | @four/math | src | reachable |
| `packages/math/tests/color.test.ts` | @four/math | tests | test |
| `packages/math/tests/frustum.test.ts` | @four/math | tests | test |
| `packages/math/tests/matrices.test.ts` | @four/math | tests | test |
| `packages/math/tests/quaternion.test.ts` | @four/math | tests | test |
| `packages/math/tests/smoke.test.ts` | @four/math | tests | test |
| `packages/math/tests/vectors.test.ts` | @four/math | tests | test |
| `packages/motion/src/camera-rigs.ts` | @four/motion | src | reachable |
| `packages/motion/src/character-controller.ts` | @four/motion | src | reachable |
| `packages/motion/src/clock.ts` | @four/motion | src | reachable |
| `packages/motion/src/constraints.ts` | @four/motion | src | reachable |
| `packages/motion/src/ik.ts` | @four/motion | src | reachable |
| `packages/motion/src/index.ts` | @four/motion | src | build-entry |
| `packages/motion/src/integrators.ts` | @four/motion | src | reachable |
| `packages/motion/src/kinematic-controller.ts` | @four/motion | src | reachable |
| `packages/motion/src/motion-component.ts` | @four/motion | src | reachable |
| `packages/motion/src/pid.ts` | @four/motion | src | reachable |
| `packages/motion/src/prediction.ts` | @four/motion | src | reachable |
| `packages/motion/src/random.ts` | @four/motion | src | reachable |
| `packages/motion/src/rig-target.ts` | @four/motion | src | reachable |
| `packages/motion/src/scheduler.ts` | @four/motion | src | reachable |
| `packages/motion/src/serializers.ts` | @four/motion | src | reachable |
| `packages/motion/src/spring-damper.ts` | @four/motion | src | reachable |
| `packages/motion/src/steering.ts` | @four/motion | src | reachable |
| `packages/motion/src/systems.ts` | @four/motion | src | reachable |
| `packages/motion/src/trajectories.ts` | @four/motion | src | reachable |
| `packages/motion/tests/camera-rigs.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/character-controller.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/constraints.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/ik.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/integrators.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/kinematic.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/motion-component.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/pid.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/prediction.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/scheduler.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/serializers.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/smoke.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/spring-damper.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/steering.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/systems.test.ts` | @four/motion | tests | test |
| `packages/motion/tests/trajectories.test.ts` | @four/motion | tests | test |
| `packages/particles/src/emitter.ts` | @four/particles | src | reachable |
| `packages/particles/src/fields.ts` | @four/particles | src | reachable |
| `packages/particles/src/index.ts` | @four/particles | src | build-entry |
| `packages/particles/src/particle-renderable.ts` | @four/particles | src | reachable |
| `packages/particles/src/particle-system.ts` | @four/particles | src | reachable |
| `packages/particles/src/pool.ts` | @four/particles | src | reachable |
| `packages/particles/src/random.ts` | @four/particles | src | reachable |
| `packages/particles/src/types.ts` | @four/particles | src | reachable |
| `packages/particles/tests/emitter.test.ts` | @four/particles | tests | test |
| `packages/particles/tests/field-batching.test.ts` | @four/particles | tests | test |
| `packages/particles/tests/fields.test.ts` | @four/particles | tests | test |
| `packages/particles/tests/particle-renderable.test.ts` | @four/particles | tests | test |
| `packages/particles/tests/particle-system.test.ts` | @four/particles | tests | test |
| `packages/particles/tests/pool.test.ts` | @four/particles | tests | test |
| `packages/particles/tests/random.test.ts` | @four/particles | tests | test |
| `packages/particles/tests/smoke.test.ts` | @four/particles | tests | test |
| `packages/physics-box2d/src/index.ts` | @four/physics-box2d | src | build-entry |
| `packages/physics-box2d/tests/smoke.test.ts` | @four/physics-box2d | tests | test |
| `packages/physics-rapier/src/ccd.ts` | @four/physics-rapier | src | reachable |
| `packages/physics-rapier/src/conversions2d.ts` | @four/physics-rapier | src | reachable |
| `packages/physics-rapier/src/conversions3d.ts` | @four/physics-rapier | src | reachable |
| `packages/physics-rapier/src/index.ts` | @four/physics-rapier | src | build-entry |
| `packages/physics-rapier/src/init.ts` | @four/physics-rapier | src | reachable |
| `packages/physics-rapier/src/rapier2d-adapter.ts` | @four/physics-rapier | src | reachable |
| `packages/physics-rapier/src/rapier3d-adapter.ts` | @four/physics-rapier | src | reachable |
| `packages/physics-rapier/src/register.ts` | @four/physics-rapier | src | reachable |
| `packages/physics-rapier/tests/conversions2d.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-rapier/tests/conversions3d.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-rapier/tests/rapier-live-properties.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-rapier/tests/rapier-retype.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-rapier/tests/rapier-shapes.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-rapier/tests/rapier-world-tuning.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-rapier/tests/rapier2d-adapter.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-rapier/tests/rapier2d-joints.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-rapier/tests/rapier3d-adapter.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-rapier/tests/rapier3d-joints.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-rapier/tests/register.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-rapier/tests/smoke.test.ts` | @four/physics-rapier | tests | test |
| `packages/physics-soft/src/index.ts` | @four/physics-soft | src | build-entry |
| `packages/physics-soft/tests/smoke.test.ts` | @four/physics-soft | tests | test |
| `packages/physics/src/adapter.ts` | @four/physics | src | reachable |
| `packages/physics/src/body-access.ts` | @four/physics | src | reachable |
| `packages/physics/src/collider.ts` | @four/physics | src | reachable |
| `packages/physics/src/descriptors.ts` | @four/physics | src | reachable |
| `packages/physics/src/events.ts` | @four/physics | src | reachable |
| `packages/physics/src/force-field.ts` | @four/physics | src | reachable |
| `packages/physics/src/index.ts` | @four/physics | src | build-entry |
| `packages/physics/src/joints.ts` | @four/physics | src | reachable |
| `packages/physics/src/material.ts` | @four/physics | src | reachable |
| `packages/physics/src/physics-event-system.ts` | @four/physics | src | reachable |
| `packages/physics/src/physics-system.ts` | @four/physics | src | reachable |
| `packages/physics/src/queries.ts` | @four/physics | src | reachable |
| `packages/physics/src/rigid-body.ts` | @four/physics | src | reachable |
| `packages/physics/src/serializers.ts` | @four/physics | src | reachable |
| `packages/physics/src/shapes.ts` | @four/physics | src | reachable |
| `packages/physics/src/solver-registry.ts` | @four/physics | src | reachable |
| `packages/physics/src/types.ts` | @four/physics | src | reachable |
| `packages/physics/src/validation.ts` | @four/physics | src | reachable |
| `packages/physics/src/world.ts` | @four/physics | src | reachable |
| `packages/physics/tests/collider.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/descriptors.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/fake-adapter.ts` | @four/physics | tests | test |
| `packages/physics/tests/force-field.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/joints.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/material.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/physics-event-system.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/physics-system.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/queries.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/rigid-body.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/serializers.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/shapes.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/smoke.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/solver-registry.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/validation.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/world-active-bodies.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/world-blend.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/world-colliders.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/world-diagnostics.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/world-joints.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/world-properties.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/world-space-mode.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/world-transitions.test.ts` | @four/physics | tests | test |
| `packages/physics/tests/world.test.ts` | @four/physics | tests | test |
| `packages/render-canvas/src/index.ts` | @four/render-canvas | src | build-entry |
| `packages/render-canvas/tests/smoke.test.ts` | @four/render-canvas | tests | test |
| `packages/render-svg/src/index.ts` | @four/render-svg | src | build-entry |
| `packages/render-svg/tests/smoke.test.ts` | @four/render-svg | tests | test |
| `packages/render-webgl/src/gl-batch.ts` | @four/render-webgl | src | reachable |
| `packages/render-webgl/src/gl-effect.ts` | @four/render-webgl | src | reachable |
| `packages/render-webgl/src/gl-geometry.ts` | @four/render-webgl | src | reachable |
| `packages/render-webgl/src/gl-particles.ts` | @four/render-webgl | src | reachable |
| `packages/render-webgl/src/gl-program.ts` | @four/render-webgl | src | reachable |
| `packages/render-webgl/src/gl-render-target.ts` | @four/render-webgl | src | reachable |
| `packages/render-webgl/src/gl-shadow.ts` | @four/render-webgl | src | reachable |
| `packages/render-webgl/src/gl-standard.ts` | @four/render-webgl | src | reachable |
| `packages/render-webgl/src/gl-texture.ts` | @four/render-webgl | src | reachable |
| `packages/render-webgl/src/index.ts` | @four/render-webgl | src | build-entry |
| `packages/render-webgl/src/register.ts` | @four/render-webgl | src | reachable |
| `packages/render-webgl/src/webgl-renderer.ts` | @four/render-webgl | src | reachable |
| `packages/render-webgl/tests/register.test.ts` | @four/render-webgl | tests | test |
| `packages/render-webgl/tests/smoke.test.ts` | @four/render-webgl | tests | test |
| `packages/render-webgl/tests/webgl-renderer.test.ts` | @four/render-webgl | tests | test |
| `packages/render-webgpu/src/index.ts` | @four/render-webgpu | src | build-entry |
| `packages/render-webgpu/tests/smoke.test.ts` | @four/render-webgpu | tests | test |
| `packages/render/src/batch.ts` | @four/render | src | reachable |
| `packages/render/src/bounds.ts` | @four/render | src | reachable |
| `packages/render/src/effect-pass.ts` | @four/render | src | reachable |
| `packages/render/src/index.ts` | @four/render | src | build-entry |
| `packages/render/src/lights.ts` | @four/render | src | reachable |
| `packages/render/src/particles.ts` | @four/render | src | reachable |
| `packages/render/src/render-graph.ts` | @four/render | src | reachable |
| `packages/render/src/render-list.ts` | @four/render | src | reachable |
| `packages/render/src/render-target.ts` | @four/render | src | reachable |
| `packages/render/src/renderable.ts` | @four/render | src | reachable |
| `packages/render/src/renderer-registry.ts` | @four/render | src | reachable |
| `packages/render/src/renderer.ts` | @four/render | src | reachable |
| `packages/render/src/resource-memory.ts` | @four/render | src | reachable |
| `packages/render/src/shape.ts` | @four/render | src | reachable |
| `packages/render/src/sprite.ts` | @four/render | src | reachable |
| `packages/render/src/statistics.ts` | @four/render | src | reachable |
| `packages/render/src/texture.ts` | @four/render | src | reachable |
| `packages/render/src/view-list.ts` | @four/render | src | reachable |
| `packages/render/tests/batch.test.ts` | @four/render | tests | test |
| `packages/render/tests/bounds.test.ts` | @four/render | tests | test |
| `packages/render/tests/effect-pass.test.ts` | @four/render | tests | test |
| `packages/render/tests/lights.test.ts` | @four/render | tests | test |
| `packages/render/tests/particles.test.ts` | @four/render | tests | test |
| `packages/render/tests/render-graph.test.ts` | @four/render | tests | test |
| `packages/render/tests/render-list.test.ts` | @four/render | tests | test |
| `packages/render/tests/render-target.test.ts` | @four/render | tests | test |
| `packages/render/tests/renderer-registry.test.ts` | @four/render | tests | test |
| `packages/render/tests/renderer.test.ts` | @four/render | tests | test |
| `packages/render/tests/resource-memory.test.ts` | @four/render | tests | test |
| `packages/render/tests/shape.test.ts` | @four/render | tests | test |
| `packages/render/tests/smoke.test.ts` | @four/render | tests | test |
| `packages/render/tests/sprite.test.ts` | @four/render | tests | test |
| `packages/render/tests/statistics.test.ts` | @four/render | tests | test |
| `packages/render/tests/view-list.test.ts` | @four/render | tests | test |
| `packages/scene/src/authority.ts` | @four/scene | src | reachable |
| `packages/scene/src/camera.ts` | @four/scene | src | reachable |
| `packages/scene/src/group.ts` | @four/scene | src | reachable |
| `packages/scene/src/index.ts` | @four/scene | src | build-entry |
| `packages/scene/src/interpolation.ts` | @four/scene | src | reachable |
| `packages/scene/src/layers.ts` | @four/scene | src | reachable |
| `packages/scene/src/light.ts` | @four/scene | src | reachable |
| `packages/scene/src/node.ts` | @four/scene | src | reachable |
| `packages/scene/src/pose-target.ts` | @four/scene | src | reachable |
| `packages/scene/src/scene.ts` | @four/scene | src | reachable |
| `packages/scene/src/screen-camera.ts` | @four/scene | src | reachable |
| `packages/scene/src/trackball.ts` | @four/scene | src | reachable |
| `packages/scene/src/transform.ts` | @four/scene | src | reachable |
| `packages/scene/src/viewport.ts` | @four/scene | src | reachable |
| `packages/scene/src/world-transforms.ts` | @four/scene | src | reachable |
| `packages/scene/tests/authority.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/camera.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/interpolation.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/layers.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/light.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/look-at.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/node.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/pose-target.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/scene.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/screen-camera.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/smoke.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/trackball.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/transform.test.ts` | @four/scene | tests | test |
| `packages/scene/tests/world-transforms.test.ts` | @four/scene | tests | test |
| `packages/serialization/src/format.ts` | @four/serialization | src | reachable |
| `packages/serialization/src/index.ts` | @four/serialization | src | build-entry |
| `packages/serialization/src/migration.ts` | @four/serialization | src | reachable |
| `packages/serialization/src/serializer.ts` | @four/serialization | src | reachable |
| `packages/serialization/tests/format.test.ts` | @four/serialization | tests | test |
| `packages/serialization/tests/migration.test.ts` | @four/serialization | tests | test |
| `packages/serialization/tests/serializer.test.ts` | @four/serialization | tests | test |
| `packages/serialization/tests/smoke.test.ts` | @four/serialization | tests | test |
| `packages/serialization/tests/untrusted.test.ts` | @four/serialization | tests | test |
| `packages/text/src/bitmap-font.ts` | @four/text | src | reachable |
| `packages/text/src/glyph-atlas.ts` | @four/text | src | reachable |
| `packages/text/src/index.ts` | @four/text | src | build-entry |
| `packages/text/src/text-layout.ts` | @four/text | src | reachable |
| `packages/text/tests/smoke.test.ts` | @four/text | tests | test |
| `packages/text/tests/text.test.ts` | @four/text | tests | test |
| `packages/ui/src/button.ts` | @four/ui | src | reachable |
| `packages/ui/src/checkable.ts` | @four/ui | src | reachable |
| `packages/ui/src/image.ts` | @four/ui | src | reachable |
| `packages/ui/src/index.ts` | @four/ui | src | build-entry |
| `packages/ui/src/keyboard.ts` | @four/ui | src | reachable |
| `packages/ui/src/label.ts` | @four/ui | src | reachable |
| `packages/ui/src/numbers.ts` | @four/ui | src | reachable |
| `packages/ui/src/panel.ts` | @four/ui | src | reachable |
| `packages/ui/src/progress.ts` | @four/ui | src | reachable |
| `packages/ui/src/radio.ts` | @four/ui | src | reachable |
| `packages/ui/src/slider.ts` | @four/ui | src | reachable |
| `packages/ui/src/widget.ts` | @four/ui | src | reachable |
| `packages/ui/tests/button.test.ts` | @four/ui | tests | test |
| `packages/ui/tests/checkable.test.ts` | @four/ui | tests | test |
| `packages/ui/tests/image.test.ts` | @four/ui | tests | test |
| `packages/ui/tests/keyboard.test.ts` | @four/ui | tests | test |
| `packages/ui/tests/label.test.ts` | @four/ui | tests | test |
| `packages/ui/tests/panel.test.ts` | @four/ui | tests | test |
| `packages/ui/tests/progress.test.ts` | @four/ui | tests | test |
| `packages/ui/tests/radio.test.ts` | @four/ui | tests | test |
| `packages/ui/tests/slider.test.ts` | @four/ui | tests | test |
| `packages/ui/tests/smoke.test.ts` | @four/ui | tests | test |
| `packages/ui/tests/widget.test.ts` | @four/ui | tests | test |
| `playwright.config.ts` | (root) | config | config |
| `tests/browser/animation.spec.ts` | (root) | tests | test |
| `tests/browser/batching.spec.ts` | (root) | tests | test |
| `tests/browser/blending.spec.ts` | (root) | tests | test |
| `tests/browser/context-loss.spec.ts` | (root) | tests | test |
| `tests/browser/culling.spec.ts` | (root) | tests | test |
| `tests/browser/example.spec.ts` | (root) | tests | test |
| `tests/browser/first-3d-scene.spec.ts` | (root) | tests | test |
| `tests/browser/fixtures/batching-page.ts` | (root) | tests | test |
| `tests/browser/fixtures/culling-page.ts` | (root) | tests | test |
| `tests/browser/fixtures/screen-camera-page.ts` | (root) | tests | test |
| `tests/browser/fixtures/stencil-page.ts` | (root) | tests | test |
| `tests/browser/fixtures/text-page.ts` | (root) | tests | test |
| `tests/browser/interaction.spec.ts` | (root) | tests | test |
| `tests/browser/mechanism.spec.ts` | (root) | tests | test |
| `tests/browser/motor-digital-twin.spec.ts` | (root) | tests | test |
| `tests/browser/one-scene-everything-moves.spec.ts` | (root) | tests | test |
| `tests/browser/particles.spec.ts` | (root) | tests | test |
| `tests/browser/playground.spec.ts` | (root) | tests | test |
| `tests/browser/screen-camera.spec.ts` | (root) | tests | test |
| `tests/browser/smoothness.spec.ts` | (root) | tests | test |
| `tests/browser/stencil.spec.ts` | (root) | tests | test |
| `tests/browser/text.spec.ts` | (root) | tests | test |
| `tests/browser/ui.spec.ts` | (root) | tests | test |
| `tests/determinism/animation-controller.test.ts` | (root) | tests | test |
| `tests/determinism/camera-rigs.test.ts` | (root) | tests | test |
| `tests/determinism/character-controller.test.ts` | (root) | tests | test |
| `tests/determinism/event-dispatch-split.test.ts` | (root) | tests | test |
| `tests/determinism/force-fields.test.ts` | (root) | tests | test |
| `tests/determinism/helpers/animation-controller-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/camera-rig-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/character-controller-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/event-split-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/force-field-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/path-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/phase1-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/phase10-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/phase2-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/phase4-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/phase5-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/phase6-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/phase7-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/phase9-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/stroke-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/svg-path-scenario.ts` | (root) | tests | test |
| `tests/determinism/helpers/tessellation-scenario.ts` | (root) | tests | test |
| `tests/determinism/path.test.ts` | (root) | tests | test |
| `tests/determinism/phase1-headless-stepping.test.ts` | (root) | tests | test |
| `tests/determinism/phase10-replay.test.ts` | (root) | tests | test |
| `tests/determinism/phase2-motion.test.ts` | (root) | tests | test |
| `tests/determinism/phase4-animation.test.ts` | (root) | tests | test |
| `tests/determinism/phase5-physics.test.ts` | (root) | tests | test |
| `tests/determinism/phase6-joints.test.ts` | (root) | tests | test |
| `tests/determinism/phase7-blending.test.ts` | (root) | tests | test |
| `tests/determinism/phase9-particles.test.ts` | (root) | tests | test |
| `tests/determinism/rollback.test.ts` | (root) | tests | test |
| `tests/determinism/stroke.test.ts` | (root) | tests | test |
| `tests/determinism/svg-path.test.ts` | (root) | tests | test |
| `tests/determinism/tessellation.test.ts` | (root) | tests | test |
| `tests/integration/application-physics.test.ts` | (root) | tests | test |
| `tests/integration/asset-abort.test.ts` | (root) | tests | test |
| `tests/integration/backend-selection.test.ts` | (root) | tests | test |
| `tests/integration/camera-rigs.test.ts` | (root) | tests | test |
| `tests/integration/color-management.test.ts` | (root) | tests | test |
| `tests/integration/debug-overlay-render.test.ts` | (root) | tests | test |
| `tests/integration/dev-build-mode.test.ts` | (root) | tests | test |
| `tests/integration/examples-build-coverage.test.ts` | (root) | tests | test |
| `tests/integration/first-person-camera.test.ts` | (root) | tests | test |
| `tests/integration/frame-statistics.test.ts` | (root) | tests | test |
| `tests/integration/helpers/blending-scenarios.ts` | (root) | tests | test |
| `tests/integration/helpers/joint-scenarios.ts` | (root) | tests | test |
| `tests/integration/helpers/losable-canvas.ts` | (root) | tests | test |
| `tests/integration/helpers/motion-advanced-scenarios.ts` | (root) | tests | test |
| `tests/integration/helpers/physics-scenarios.ts` | (root) | tests | test |
| `tests/integration/helpers/recording-gl.ts` | (root) | tests | test |
| `tests/integration/helpers/replay-scenarios.ts` | (root) | tests | test |
| `tests/integration/helpers/roundtrip-scenarios.ts` | (root) | tests | test |
| `tests/integration/look-at.test.ts` | (root) | tests | test |
| `tests/integration/motion-advanced.test.ts` | (root) | tests | test |
| `tests/integration/multi-light.test.ts` | (root) | tests | test |
| `tests/integration/path-tessellation.test.ts` | (root) | tests | test |
| `tests/integration/physics-blending.test.ts` | (root) | tests | test |
| `tests/integration/physics-force-fields.test.ts` | (root) | tests | test |
| `tests/integration/physics-joints.test.ts` | (root) | tests | test |
| `tests/integration/physics-live-properties.test.ts` | (root) | tests | test |
| `tests/integration/physics-rapier.test.ts` | (root) | tests | test |
| `tests/integration/physics-replay.test.ts` | (root) | tests | test |
| `tests/integration/physics-runtime-colliders.test.ts` | (root) | tests | test |
| `tests/integration/pointer-type.test.ts` | (root) | tests | test |
| `tests/integration/render-batching.test.ts` | (root) | tests | test |
| `tests/integration/render-effects.test.ts` | (root) | tests | test |
| `tests/integration/render-graph.test.ts` | (root) | tests | test |
| `tests/integration/render-to-texture.test.ts` | (root) | tests | test |
| `tests/integration/renderer-context-loss.test.ts` | (root) | tests | test |
| `tests/integration/scene-layers.test.ts` | (root) | tests | test |
| `tests/integration/scene-roundtrip.test.ts` | (root) | tests | test |
| `tests/integration/screen-camera.test.ts` | (root) | tests | test |
| `tests/integration/security-csp.test.ts` | (root) | tests | test |
| `tests/integration/shadows.test.ts` | (root) | tests | test |
| `tests/integration/shape-paints.test.ts` | (root) | tests | test |
| `tests/integration/shape-rendering.test.ts` | (root) | tests | test |
| `tests/integration/sprite-frames.test.ts` | (root) | tests | test |
| `tests/integration/standard-material.test.ts` | (root) | tests | test |
| `tests/integration/stencil-masking.test.ts` | (root) | tests | test |
| `tests/integration/svg-path-pipeline.test.ts` | (root) | tests | test |
| `tests/integration/text-rendering.test.ts` | (root) | tests | test |
| `tests/integration/texture-manifest.test.ts` | (root) | tests | test |
| `tests/integration/units-display.test.ts` | (root) | tests | test |
| `tests/integration/view-culling.test.ts` | (root) | tests | test |
| `tests/visual/text.spec.ts` | (root) | tests | test |
| `tests/visual/ui-demo.spec.ts` | (root) | tests | test |
| `tools/create-dependency-graph/create-dependency-graph.ts` | (root) | tools | tool |
| `vitest.coverage.config.ts` | (root) | config | config |
| `vitest.suites.config.ts` | (root) | config | config |
