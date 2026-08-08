# @four/diagnostics

Diagnostics, determinism checksums, replay, and debug-draw data. Part of [four.js](../../README.md).

Implements §33–34 (checksums, snapshots, replay) and the data side of §41/§84–85 (debug visualization) from [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phases 1 and 10.

## What's here

- **Checksums (§33)** — `createChecksum` / `Checksum` / `hashFloats`, the FNV-1a digest used by the determinism golden tests.
- **Replay (§34)** — `ReplayRecorder` and `ReplayPlayer` over a duck-typed `ReplayTarget` (any `PhysicsWorld`-shaped host; `applyInput` optional), plus the versioned recording envelope: `encodeReplayRecording` / `decodeReplayRecording` / `validateReplayRecording`, `isReplayCompatible` / `assertReplayCompatible`, `MINIMUM_REPLAY_FORMAT_VERSION` / `LATEST_REPLAY_FORMAT_VERSION` / `SUPPORTED_REPLAY_FORMAT_VERSIONS` (a document declares the _lowest_ version that can express it, so the version it carries is not always the latest — `REPLAY_FORMAT_VERSION` survives as a deprecated alias of `LATEST_…`), and strict canonical base64 (`encodeBase64` / `decodeBase64`). Recording is non-perturbing; replays are checksum-verified bit-identical.
- **§96 untrusted text** — `decodeReplayRecording(text, limits?)` takes `UntrustedJsonLimits` (`maximumTextLength`, `maximumDepth`; finite defaults) and refuses an over-budget or over-deep recording with `UNTRUSTED_INPUT_REJECTED` before `cloneJsonValue` recurses into it. `validateReplayRecording` is deliberately unguarded — recorders hand it live values.
- **Debug draw (§41)** — `DebugDrawBuffer` (world-space line list, 7 floats per vertex) fed by duck-typed collectors: `collectBodyOrigins`, `collectBodyVelocities`, `collectCentersOfMass`, `collectContactPoints`, `collectContactImpulses`.
- **Debug draw → render (§84/§113, R-35)** — `debugDrawStreams(buffer, out?)` de-interleaves the buffer into `positions` + `colors` `Float32Array`s sized exactly as `BufferGeometry` requires (this package has no `geometry` edge in the frozen §3.1 matrix, so it emits arrays, not a geometry); `applyDebugDrawStreams(streams, geometry)` re-points or `markDirty()`s a duck-typed sink. With `mode: "lines"` and `UnlitMaterial({ vertexColors: true })` the whole overlay is **one draw call** at any segment count.
- **Solver statistics** — `solverStatistics` / `solverJointStatistics` over the adapter access seams.

## Staged / not yet implemented

Read the exported `DEBUG_DRAW_STAGED` list for dated, per-item reasons: joint-anchor/constraint visualization and applied-force vectors are staged. (Center-of-mass display landed 2026-08-04 and per-segment-colored drawing 2026-08-07; both entries are gone from the list.) Replay compatibility checks compare adapter name/version only — world _configuration_ mismatches are not refused. The §84 `app.stats.*` overlay surface is not implemented.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/diagnostics`; publishes as `@danielsimonjr/fourjs-diagnostics`.
