# @four/diagnostics

Diagnostics, determinism checksums, replay, and debug-draw data. Part of [four.js](../../README.md).

Implements §33–34 (checksums, snapshots, replay) and the data side of §41/§84–85 (debug visualization) from [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phases 1 and 10.

## What's here

- **Checksums (§33)** — `createChecksum` / `Checksum` / `hashFloats`, the FNV-1a digest used by the determinism golden tests.
- **Replay (§34)** — `ReplayRecorder` and `ReplayPlayer` over a duck-typed `ReplayTarget` (any `PhysicsWorld`-shaped host; `applyInput` optional), plus the versioned recording envelope: `encodeReplayRecording` / `decodeReplayRecording` / `validateReplayRecording`, `isReplayCompatible` / `assertReplayCompatible`, `REPLAY_FORMAT_VERSION`, and strict canonical base64 (`encodeBase64` / `decodeBase64`). Recording is non-perturbing; replays are checksum-verified bit-identical.
- **Debug draw (§41)** — `DebugDrawBuffer` (world-space line list, 7 floats per vertex) fed by duck-typed collectors: `collectBodyOrigins`, `collectBodyVelocities`, `collectContactPoints`, `collectContactImpulses`.
- **Solver statistics** — `solverStatistics` / `solverJointStatistics` over the adapter access seams.

## Staged / not yet implemented

Read the exported `DEBUG_DRAW_STAGED` list for dated, per-item reasons: center-of-mass display, joint-anchor/constraint visualization, force vectors, and per-segment-colored drawing are staged. Replay compatibility checks compare adapter name/version only — world _configuration_ mismatches are not refused. The §84 `app.stats.*` overlay surface is not implemented.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/diagnostics`; publishes as `@danielsimonjr/fourjs-diagnostics`.
