# @four/animation

Animation system — the animation pillar (Part III). Part of [four.js](../../README.md).

Implements §14–§18 (§100, Part III) of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 4 (§107). All durations are in seconds; quaternion tracks interpolate by shortest-arc slerp.

## What's here

- **Easing** — the 34-name registry (`EASINGS`, `EASING_NAMES`, `resolveEasing`) covering the §15 families: quadratic through quintic, sine, circular, exponential, back, elastic, bounce, and a closed-form damped spring.
- **Tweens** — `Tween` / `tween()` builder with repeat semantics and the `TweenState` lifecycle.
- **Value adapters** — `numberAdapter`, `vector2Adapter`/`vector3Adapter`/`vector4Adapter`, `quaternionAdapter` (slerp), `colorAdapter`, `booleanAdapter`/`discreteAdapter`, and `detectAdapter`; primitives return values, reference types mutate `out` in place (`ValueAdapter.mutatesInPlace`).
- **Property binding** — `createBinding` / `PropertyBinding`: paths resolved once, in-place writes that preserve identity and change hooks. Conflicting writers resolve last-started-wins via a claim registry shared by tweens and the mixer.
- **Timelines** — `Timeline` with elapsed-space markers, seek suppression / `replayOnSeek`, and nestable `TimelineChild` entries.
- **Clips and tracks** — `AnimationTrack` / `AnimationClip` (§17 shape; step, linear, and cubic interpolation) with clip events.
- **Playback** — `AnimationMixer` (`prepare()` + `play()`, translation-only root-motion option) and `AnimationSystem` (priority 300, fixed-step advance, auto-untracks finished animations).

## Staged / not yet implemented

- State machines, blend trees, skeletal and morph-target animation (staged per plan P4-3).
- Rotational root motion (translation-only ships; staged 2026-08-02).
- Physics-animation blending itself lives in `@four/physics` (§19), driven by `@four/scene`'s `PoseTarget`.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/animation`; publishes as `@danielsimonjr/fourjs-animation`.
