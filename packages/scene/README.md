# @four/scene

Scene graph — the shared model all four pillars act on. Part of [four.js](../../README.md).

Implements §6–8, §42–43, and §46–48 of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped across Phases 1–3 and 7. Right-handed Y-up transforms, radians.

## What's here

- **Hierarchy** — `Node` (single inheritance over `@four/core`'s `EventEmitter`, typed `NodeEventMap`, component host), `Group`, `Scene`.
- **`Transform`** — position/rotation/scale with a dirty channel driven by math change-hooks, plus `resolveWorldTransform` / `resolveWorldTransforms` (world matrices resolve per fixed step; staleness tracking includes parent identity).
- **Transform authority (§42)** — `TransformAuthority` (`manual`, `animation`, `kinematic`, `physics`, `blended`, `constraint`, `network`), `DEFAULT_TRANSFORM_AUTHORITY`, and `warnAuthorityConflict` (conflicts warn, never silently overwrite; takes a structural `AuthorityNode`).
- **Cameras and viewport (§47–48)** — `PerspectiveCamera` / `OrthographicCamera` / `ScreenCamera` with depth-range-parameterized projection, `Viewport` / `createFullscreenViewport`. Camera _rigs/controls_ belong to `@four/motion` (`OrbitRig`, `FollowRig`, `LookAtConstraint`; `TrackballRig` lives here because it is defined over a viewport in screen space).
- **Render interpolation (§43)** — `PoseBuffer` (lerp/slerp between physics poses), `PoseSnapshotSystem` / `createSnapshotSystem`, and `PoseTarget` (position + rotation history; the §19 blending input captured by `@four/physics`'s capture system).

## Staged / not yet implemented

- Symbolic layers, tags, and indexed scene queries (§46).
- `PoseTarget` scale (position + rotation only; scale is backlog).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/scene`; publishes as `@danielsimonjr/fourjs-scene`.
