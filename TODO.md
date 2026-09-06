# TODO

Task tracker for four.js. Keep entries short and actionable; move finished items to **Done**
(newest first) with the date. Larger context and decisions belong in `MEMORY.md`; released
changes in `CHANGELOG.md`.

## Priority order

Every open item in the **Now** section, ranked least-to-most complex. This is an *index*: each
entry keeps its body where it already lives, so the thematic grouping and the
`R-`/`PH-`/`A-` series stay readable. Line numbers drift — the titles are the key.

Ordered by complexity rather than importance on purpose: the cheap end clears fastest,
and tier 4 surfaces the decisions that block otherwise-small work.

Counts as of 2026-09-06 (fourth landing): **~22 open** (owner secrets, typedoc/TS 7, RFC §6 residues, lighting/shadow remainder, R-33 hardware), 176 done.

### 0 · Blocked on an event, not on effort

Each waits on a **second solver adapter** existing. None is minutes-work; none is work at
all yet. Listed first so they are not repeatedly re-triaged as quick wins — which is what
happened on 2026-09-06, when all three sat in the minutes tier until someone read them.

- Capability-table note: Rapier `inheritVelocityFrom` no-op — DONE 2026-09-06 (`COMPATIBILITY.md` deviations); other solvers still need a column when they land
- Document SolverBodyAccess — DONE 2026-09-06 (Rapier column in COMPATIBILITY.md; other adapters still get a column when they land)
- §28 motor cap — DONE 2026-09-06 (Rapier force-based gain named in COMPATIBILITY.md; Box2D column when it ships)

### 1 · Minutes — mechanical, no design in them

Config, a regeneration, or a sentence of prose. Nothing here needs a decision.

- Coverage thresholds are package-level — DONE 2026-09-06 (80% per-file floor under the 95% package gate).

### 2 · Hours — one contained fix, already diagnosed

Each has its cause written down. The thinking is done; what remains is the change and its test.

- `smoothness.spec.ts` aliasing — DONE 2026-09-06 (virtual-frame parity sampler).
- `blending.spec.ts` RECOVER / sample-count — DONE 2026-09-06 (page `data-chain-y` watches).
- Run the README snippet in the browser gate — DONE 2026-09-06 (`tests/browser/readme.spec.ts`).
- Scissor clipping (§67's first bullet, small) — DONE 2026-09-06.
- §59 second texture unit — DONE 2026-09-06 (`StandardMaterial.metalRoughnessMap`).
- Dogfooding coverage map (standing assignment) — surfaces DONE, so they are not redone.

### 3 · A day — a real packet, cause known

Bounded work with a clear shape, but more than a single edit.

- The browser gate on Windows — DONE 2026-09-06 (WebGPU 22/22 via platform argv; `animation.spec` simulation-bound `#status` sampling; Windows timeout 180 s; `smoothness.spec` uses `page.evaluate` parity wait per #72).
- Unlit materials render with GL_BLEND off — DONE 2026-09-06 (alpha / `transparent` enables SRC_ALPHA blend).
- Size budgets are thin after R-36 — DONE 2026-09-06 (`.size-limit.json` bumped; `tools/size-budgets.mjs` records A/B; branch limits 39/37.5/46 kB after trails).
- Replace the transcribed Rapier type subset in `physics-rapier/src/init.ts` — DONE 2026-09-06 (package `moduleResolution: bundler`; upstream type aliases).
- Extend `tools/check-docs.mjs` — DONE 2026-09-06 (24 packages, suite counts, AUDIT-120 census).

### 4 · Blocked on a decision, then small

The work is modest; the judgement in front of it is not. Cheapest to unblock, so worth raising early.

- rapier 0.20 adoption — DONE 2026-09-06 (0.20.0; contactPair takes bodies; goldens re-recorded from scenario helpers).
- Lift the TypeScript/vitest pin once typedoc supports TS 7.
- PoseTarget scale channel — DONE 2026-09-06 (physical side is identity).
- Rotational root motion — DONE 2026-09-06 (quaternion track extracts local rotation).
- A-25 owner decisions before first publish:
- A-25 remainder:

### 5 · Feature packets — multi-day, deliberately deferred

The RFC residues and the R-/PH-/A- series. Several are parked by their own RFC's §6 table; these are the post-1.0 roadmap rather than release work.

- Fold steering's private interceptTime into prediction's export — interceptTime fold DONE 2026-09-06; ~~spatial-hash neighbors~~ DONE 2026-09-06; ~~spherical wander~~ DONE 2026-09-06; ~~CCD/FABRIK~~ DONE 2026-09-06; ~~path-planning adapters (RFC)~~ **Proposed 2026-09-06** (`docs/rfcs/0007-path-planning-adapters.md`); robotic joint commands utility (MAY declined — see prediction.ts staging note)
- RFC 0004 residue (all deferred by the RFC's own §6 table, none scheduled):
- RFC 0005 residue (staged in source, 2026-08-29):
- RFC 0001 residue (staged in source, 2026-08-28):
- RFC 0003 residue (staged in source, 2026-08-28):
- RFC 0003 prototype measurements still owed:
- Tokens for the five absent §81 extension points — DONE 2026-09-06 (`ASSET_LOADERS`, `SHADER_OPERATORS`, `UI_CONTROLS`, `EDITOR_TOOLS`, `COMPUTE_WORKLOADS`)
- Lighting follow-ups (MVP tier shipped 2026-08-04 — see Done): multi-light + point/spot/hemisphere/area (§68 uniform arrays / clustered path), shadows (§69 — directional tier shipped 2026-08-09; cascades, point/spot maps, the atlas, transparent masks and contact shadows remain), §59 StandardMaterial/PBR, §60a color management + tone mapping + CSS color strings on lights, light layers; hoist the lit shader's per-vertex inverse-transpose to a per-draw normal-matrix uniform when @four/math grows a Matrix3 utility (dated note in gl-program.ts)
- First publish (§94 0.1): Changesets release workflow + the @danielsimonjr/fourjs publish-name mapping — owner step
- Follow-ups the R-1 plan explicitly defers
- PH-11c — character/dynamics push interaction — DONE 2026-09-06 (`pushMass` / reduced-mass impulse / wake).
- R-32 — textured / rotated / soft particles.
- R-33 — §112's exit, rendered as well as simulated.
- R-31 — GPU particle simulation integrator tier — DONE 2026-08-29 (`simulation: "gpu"`); §27 GPU fields / depth-buffer collision / GPU snapshots remain under R-31 residue.
- PH-22 residue (re-read 2026-08-21):
- R-8 follow-ups:
- §8 node-level `NodeSpace` component — DONE 2026-09-06.
- §21 `"local-plane"` simulation frame — DONE 2026-09-06.
- §27 field torque and field-driven waking — DONE 2026-09-06 (`sampleTorque` + per-entry `wakesSleepingBodies`).
- Batching follow-ups (§65, after R-9's consecutive-run tier, 2026-08-09): instanced meshes for the shaded pipelines (`R-22` — a baked batch has no normals); glyph batching once `R-30` → `R-28` land a `Text` node (its sprites over one atlas material batch as they are); texture-atlas _grouping_ of distinct textures (needs a packer); a change-detecting batch cache so a still scene re-uploads nothing (§86's idle-scene row — today a batched run re-uploads every frame); making batching the default, which needs A-4's build-time pipeline-selection seam (the opt-in seam already costs every bundle +0.17 kB).
- `buildRenderList` optimization — DONE 2026-09-06 (homogeneous sort skip + sprite fast path; benchmark re-recorded).
- R-30c — the rest of §77, scoped by why each is not ordinary work:
- §12 character controllers + first-person look — DONE (PH-11/PH-11b 2026-08-21; `examples/character-controller` browser gate 2026-08-29).
- Staged rigs (R-36/R-37 residue, 2026-08-09):
- §44/§47 camera rigs residue
- R-23 follow-ups (solid-fill tier shipped 2026-08-09):
- R-26 follow-ups (path-data tier shipped 2026-08-09):
- Auto-selection follow-ups: **CLOSED 2026-09-06** — ui-demo budget reviewed
  (45 kB limit); real WebGPU rung in `backend-selection.test.ts`.
- PH-9 follow-ups (staged 2026-08-07):
- R-6 follow-ups (§70 tier 2):
- §40 follow-ups:
- PH-1 follow-ups:
- A-4 remainder — PARTIAL 2026-09-06: §85 validation catalogue + §83 dev warnings (disposed-in-use, detached listeners, per-frame allocations); systematic `devAssert` migration still open.
- A-5 remainder — PARTIAL 2026-09-06: duplicate-load DONE; `RenderTarget.byteLength` format-aware; materials/solver live counts; leak audit extended.
- A-5 follow-ups: materials + solver handles accounted at count tier; `RenderTarget.byteLength` moved with §67 formats.
- A-1 follow-ups: contacts wired via `SolverStatistics.contactCount` → `app.stats.contacts` (2026-09-06); `physicsStepTime`/`gpuFrameTime` still wait on their packets.
- A-18 remainder — DONE 2026-09-06 (progress, stream, dependency graph, injected worker decode, injected watch).
- A-16 remainder (manifest half): DONE 2026-09-06 (`preloadManifestIntoCatalog`).
- A-19 remainder:
- §96 residue:
- R-19/R-20 follow-ups:
- Flaky gate — DONE 2026-09-06 (smoothness parity + blending page watches).
- A-13 — DONE 2026-09-06 (`installAccessibilityMirror` opt-in DOM mirror).
- Particle trails — PARTIAL 2026-09-06: CPU ring buffer + ribbon path + multi-stop ramps; GPU compute, depth-buffer collision, spatial-hash neighbors still open.
- §24 remaining shapes — DONE (PH-22a, 2026-08-02); compound = multiple colliders by design.

## Now

- [x] **`smoothness.spec.ts` "frames are drawn between simulation states" aliases against
      its own virtual frame clock.** DONE 2026-09-06 — sampler is now
      frame-synchronised (`window.__fourVirtualFrames`, alternating odd/even
      counts) so mid-step and on-step poses are chosen rather than inherited
      from wall-clock aliasing. Failed CI on `dd03d1a` and `94860b0`; passed on
      `d704cd8` and `c14dafa`, and `94860b0`'s *Release* run passed the same job the CI run
      failed — so roughly 2 in 5, and not caused by any change of mine.
      **Follow-up 2026-09-06:** `waitForFunction` + default rAF polling hung
      the same test for 120 s on `b55a8c1`. `waitForVirtualFrameParity` now
      polls via `page.evaluate` with a 15 s budget (see Done).

      Diagnosis, from reading the mechanism rather than the failure rate. The test installs
      `useVirtualFrameClock(page, 1.5 × FIXED_DELTA)`, which overrides
      `requestAnimationFrame` so each callback advances the page's clock by exactly 1.5
      fixed steps. That makes `interpolationAlpha` alternate **0.5, 0.0, 0.5, 0.0** — a
      *two-frame cycle*, deterministic and machine-independent, which is the clever part.

      But sampling is on **real** time: the loop screenshots every
      `INTERPOLATION_SAMPLE_INTERVAL_SECONDS`, and however many virtual frames elapse
      between two screenshots is whatever the machine managed to render. If that count is
      consistently **even**, every one of the 12 samples lands on the same phase of the
      cycle, `midStep` is 0, and the test reports "every frame landed on an exact
      fixed-step pose" while §43's interpolation is working perfectly.

      So the assertion is sound and the sampler is aliased against the very cycle it is
      trying to observe. Raising `INTERPOLATION_SAMPLE_COUNT` does not help: if the parity
      is stable, more samples are more samples of the same phase.

      The fix has to break the lock between the sampling interval and the two-frame cycle —
      most directly by making the *sampler* frame-synchronised (screenshot after a known
      number of virtual frames) rather than time-synchronised, so the phase is chosen
      instead of inherited.

      **Not attempted**, deliberately: it does not reproduce locally, so I cannot tell a fix
      from a coincidence. Guessing at a change I cannot verify is how the blending
      step-bound attempt made things worse earlier today.

- [x] **De-flake the browser gate: sample counts no longer measure the runner.** DONE
      2026-09-06 — both watches now require a sample floor as well as the window; 1 of 4
      passing → 3 of 4 on Windows. Details in the CHANGELOG.
- [x] **`blending.spec.ts` "RECOVER" still fails on a slow machine, and the reason is now
      measured.** DONE 2026-09-06 — RECOVER / ANIMATED / RAGDOLL watches now
      read `data-chain-y` until the span/floor is met; screenshots are only
      for pixel assertions, so the observer no longer starves the simulation. Its span assertion needs a full `WAVE_PERIOD` (**3.6 s**) to see both
      extremes, but the watch runs 4 s of *wall clock* and §10 drops simulation time — so a
      slow machine samples a fraction of the wave and a running chain measures 0.156
      against 0.2.
      Bounding by `data-step` (the fixed-step counter the page publishes) is the right fix
      and **was tried and reverted**: 216 steps exceeds the 60 s test timeout here, and
      raising it to 180 s made things worse (3 of 4 failing vs 1 of 4). The screenshots the
      loop takes are part of what starves the simulation, so watching harder slows the
      thing being watched.
      A real fix probably has to sample *without* screenshotting — read the centroid from
      the page (it already publishes `chain-y`) instead of from a framebuffer grab — which
      removes the observer's cost from the measurement entirely.
      `blending.spec.ts` watches for a fixed `WATCH_SECONDS = 4`, taking a screenshot every
      `FRAME_GAP_MS = 200`, then asserts it collected `>= 8` samples. Each iteration costs
      200 ms plus one screenshot, so a fast runner gets ~10 and a 19%-slower one gets 7 —
      the assertion is on the RUNNER'S THROUGHPUT, not on §110.
      The file's own comment already states the intent: *"a machine slower than that must
      weaken the sample count rather than fail"*. A fixed count delivers exactly that — the
      window simply grows in wall-clock on a slow machine, which only strengthens the
      "did the chain actually move" assertions it wraps.
      Not widening the threshold: that moves the cliff instead of removing it.
      Failed CI twice today (blending x2, then smoothness x1) and fails locally on Windows.

- [x] **Three cross-package suites failed on Windows — a test handed a native path where
      a URL belongs.** `bun run test:suites` is now **90/90 green here**, for the first time.

      **My first diagnosis was wrong and is recorded as such.** I filed this as a missing
      `.gitattributes`, on the evidence that `tests/fixtures/gltf/quad.gltf` checks out
      with 104 CRLF and 0 LF. That observation is true and irrelevant: the pinned digest is
      taken over *parsed* content, and `JSON.parse` does not care about line endings.

      The real error was `ENOENT: open 'C:/Users/danie/Github/four.js/quad.bin'` — the
      buffer URI resolving against the process CWD. `resolveUri` in `@four/assets`
      resolves a glTF's relative URIs against the asset's **URL**, lexically, splitting on
      `/`. That is correct and deliberate (§33: the package names no `URL` global). The
      tests passed `fileURLToPath(...)` — a *native* path — so on Windows
      `lastIndexOf("/")` returns −1, the base collapses to `""`, and `quad.bin` went to
      the CWD. Invisible on POSIX, where a native path is also `/`-separated.

      Fixed in `tests/determinism/gltf-load.test.ts` and `tests/integration/gltf-scene.test.ts`:
      the fixture directory stays a URL all the way to the loader, and becomes a path only
      at the single call that touches the filesystem. The library was not changed — it was
      never wrong. The third failure, `determinism/path.test.ts`, passes on a quiet machine;
      it was contention, not a defect.
- [x] **Five tests time out under `bun run test` on Windows; none is a code defect.**
      DONE 2026-09-06 — barrels now import lazily inside each test so the first
      await no longer pays every dynamic import; `svg-path` and `random` take a
      30 s describe timeout (Vitest 3.2 options object, not `describe.configure`).
      Surfaced the moment the runner above started working. All are 5 s `testTimeout`
      expiries, not wrong answers:
      - `four/tests/barrels.test.ts` — the **first** barrel awaited times out while the
        other 24 pass in ~0 ms. Every dynamic import is started at module load and the
        first `await` pays the whole cold-start cost. Fails even with the package run
        alone, so it is not contention.
      - `geometry/tests/svg-path.test.ts` and `core/tests/random.test.ts` — pass when
        their package runs alone, fail under `--concurrency=4`. Contention.
      Both shapes are the charter's "flaky by design" axis: a wall-clock budget that
      happens to hold on CI's hardware and not here. A fix is a real decision (raise
      `testTimeout` for cold-start-bound suites? await the barrels serially?), so it is
      filed rather than guessed at.

- [x] **`bun run test` and `bun run coverage` are broken on Windows.** FIXED 2026-09-06.
      `tools/run-in-packages.mjs:20` builds its root as
      `new URL("..", import.meta.url).pathname`. On Windows that yields `/C:/Users/...`
      — with a leading slash — and `join()` turns it into a path beginning `\C:`, so the
      run dies before a single test executes:

      ```text
      ENOENT: no such file or directory, scandir '\C:\Users\danie\Github\four.js\packages'
      ```

      It is the **only** tool in `tools/` with this bug — `apply-publish-names`,
      `check-docs`, `check-spec` and `generate-compatibility` all use `fileURLToPath`
      already — so the fix is to adopt the idiom the rest of the directory already uses.
      Invisible on CI, where `.pathname` needs no translation, which is how the repo's two
      most important scripts can be dead on a platform while every gate stays green.

- [x] **Make the WebGPU gate run on Windows: `--use-angle=swiftshader` is what blocks it.** DONE — 22 passed, 0 skipped.
      Measured 2026-09-06, both binaries x four flag sets, on a served origin:

      | binary | flags | `requestAdapter()` |
      | --- | --- | --- |
      | full | `--use-gl=angle --use-angle=swiftshader --enable-unsafe-webgpu` (today's) | **null** |
      | shell | same | **null** |
      | full | `--enable-unsafe-webgpu` only | nvidia / pascal, 20 features |
      | full | `+ --use-webgpu-adapter=swiftshader` | **google / swiftshader, 18 features** |
      | shell | `--use-gl=angle --enable-unsafe-webgpu` | nvidia / pascal, 20 features |

      `--use-angle=swiftshader` governs ANGLE (WebGL) and is right for the `chromium` and
      `visual` projects — it is what makes a GPU machine measure like CI. But on Windows it
      also denies Dawn an adapter, so all 22 `webgpu` specs skip.
      `--use-webgpu-adapter=swiftshader` is the WebGPU-side equivalent and keeps the
      determinism the config is actually after: a *software* adapter, not this box's NVIDIA.
      Fix must be platform-conditional. CI (Linux) runs 103/103 with today's flags, so the
      non-Windows argument list must not change at all.

- [x] **`KeyboardInput` is UI focus-routing, and its name sends game code to the wrong
      tool.** Found by the flight-sim persona; never filed until now, which is why it is
      dated late. `@four/input`'s `KeyboardInput` takes
      `(surface, { focusTarget: () => Node | null })` and dispatches to a *focused scene
      node* — it pairs with `@four/ui`'s `keyboardFocusTarget(root)`. A game reading WASD
      wants none of that, and four offers no first-class alternative: its own
      `examples/character-controller` uses raw `window.addEventListener("keydown")`. So the
      sanctioned path for game input is the DOM, undocumented, while the class whose name
      says "keyboard input" is for widgets.
      Second half, cheap and separable: passing the wrong shape throws
      `TypeError: Cannot read properties of undefined (reading 'focusTarget')` — an internal
      property access, where `SpringDamper` in the same package family names both accepted
      option shapes. **Validation half DONE 2026-09-06** — a `FourError` now names the call
      shape and points game input at DOM listeners. The naming/first-class-game-input half
      remains open: it is an API-surface decision (a new class? a documented recipe?) and
      belongs to the owner.

- [x] **A dynamic body with no collider cannot rotate, and nothing says so.** Found by the
      two-piston-engine persona dogfood. A flat-twin built from `RigidBody({ type:
      "dynamic", mass: 1 })` with no colliders — reasonable for a pure linkage, where the
      joints are the only constraints — sat frozen at its assembly angle forever. Every
      accuracy invariant scored a **perfect 0.0 error**, because nothing moved: the exact
      shape of a green result that means nothing. Adding a `Collider` was the whole fix.
      Cause: `mass` supplies mass, not the **inertia tensor**. Without a collider to derive
      it from and with no explicit `inertiaTensor`, angular inertia is zero and the solver
      will not turn the body. The adapter states this — but only inside a *3D-only*
      validation message ("omit inertiaTensor and let the solver derive it from the collider
      geometry"), which never fires when the tensor is simply absent.
      A `#warnOnce`-style diagnostic would fit: `PhysicsWorld` already has that pattern for
      §32 sleeping thresholds. **Not implemented, and the reason is a real design tension,
      not scope:** PH-5 supports adding colliders at runtime
      (`#refreshMassAfterColliderChange`), so a body may legitimately register with none and
      gain them later — a warning at `addBody` would false-positive on a supported
      workflow. Where it should fire (first step? first non-zero motor torque?) is an owner
      call.
      **DECIDED and DONE 2026-09-06: warn at the FIRST STEP, not at `addBody`.** That
      placement is what resolves the PH-5 tension I filed this under — `addCollider` after
      registration is supported, so a registration-time check fires on a working workflow,
      while by the first step the mass properties are the ones the solver will use. A control
      test covers the late-collider path explicitly.
      Unconditional rather than `DEV`-gated, because §33 forbids a simulation package from
      branching on the build flag; that matches the diagnostics already in `world.ts`.
      Dogfooded against the original frozen engine in a browser: five warnings, one per
      dynamic body, where there had been silence.
- [x] **The `world.initialize()` ordering rule is demonstrated but never stated.** DONE b9ee8aa — stated in docs/guides/fixed-step-simulation.md.
      `addBody` throws unless `world.initialize()` has already run, because that call
      decodes the wasm solver (§37). The error text is excellent and says exactly what to
      do. But the rule appears in no guide and no README as a *rule* — it is only modelled,
      in `docs/guides/collision-filtering.md` and `examples/mechanism`. Building the scene
      first and initializing last is the order the rest of four reads in (`app.initialize()`
      comes after the scene is built), so the natural guess is the wrong one.
- [x] **Physics accuracy verified against closed form — the joint solver is good.** A
      flat-twin's pistons tracked the slider-crank equation
      `x = r·cos(θ) + √(L² − r²sin²θ)` to a **mean 1.56 mm error on a 1.0 m stroke**
      (0.16%), max 9.2 mm. The opposed-piston mirror invariant `x_A + x_B = 0` held to
      3.6 mm. Piston drift off the slider axis was **exactly 0** — the prismatic constraint
      is not approximate. The hinge motor held 6.23 rad/s against a commanded 6.0 (3.7%).
      Measured over a full revolution from outside the library, via the published packages.

- [x] **`FollowRig.apply()` kills the frame loop on a zero-delta frame.** FIXED — skips a Found by the
      flight-sim persona dogfood: the chase camera threw on frame 1 and the rAF loop never
      recovered. `apply()` passes `deltaSeconds` straight into `SpringDamper`, which
      deliberately rejects `0` (`it.each([0, -DT, NaN, Infinity])` asserts the throw), and
      the RangeError propagates out of `app.step()`. The README’s own loop shape produces
      the zero: `app.step(Math.max(0, now - last) / 1000)` clamps to 0 when rAF’s frame
      timestamp precedes the `performance.now()` captured just before the loop. Never caught
      because `FollowRig` appears only in unit tests — no example drives it in a real loop.
      Fix belongs in the rig, not the spring: `FollowRig` already has `skippedSteps` for
      "could not act this frame" (three call sites), so a zero-length step is that same case.
      NOT changing `SpringDamper`’s rejection of 0 — that is a deliberate, tested invariant
      and widening it is the owner’s call. Fixed with a failing test first; motion's
      full suite stays green at 476/476, and the flight-sim page now survives frame 1
      with the workaround removed.

- [x] **The browser gate on Windows — WebGPU fixed; chromium/visual timeouts
      closed.** DONE 2026-09-06. Two causes were filed; both closed:
      - **WebGPU (2026-09-06).** All 22 specs had skipped when
        `requestAdapter()` was `null`. **`--use-angle=swiftshader` was the cause**
        — it is right for the `chromium` and `visual` projects on Linux but on
        Windows it also denied Dawn an adapter. Platform-conditional argv:
        `--use-webgpu-adapter=swiftshader` on Windows only. Result: **22 passed,
        0 skipped**.
      - **Chromium/visual (2026-09-06).** Screenshot-bound `animation.spec`
        sampling replaced with simulation-progress watches on `#status`
        (`data-beacon-y`, `data-vane-*`, `data-sim`). Windows Playwright
        timeout 180 s (Linux/CI 120 s). Complements #72's
        `smoothness.spec` `page.evaluate` parity wait. (#73's shared
        16-screenshot sweep superseded on this branch.)
- [x] **`playwright.config.ts`'s `CHROMIUM_BINARIES` has no Windows entry.** DONE
      2026-09-06 — `chrome-win64/chrome.exe`, `chrome-win/chrome.exe`, and the
      headless-shell-win64 layout are in the candidate list. Only matters when
      `PLAYWRIGHT_BROWSERS_PATH` is set (unset locally and in CI). `windowsFullChromium`
      was deleted on `main` (it never matched); Playwright already resolves the
      full build.

- [x] **The README quick-start could not run — no `app.start()`.** Found by extracting the
      block verbatim and loading it in a browser; it threw §45's error and drew nothing.
      Fixed, and gated in `tools/check-docs.mjs` so it cannot silently return. Evidence and
      the two ways the guard itself was initially wrong are in the CHANGELOG.
- [x] **Run the README snippet in the browser gate, not just a text check.** DONE
      2026-09-06 — `tests/browser/readme.spec.ts` serves the extracted
      `fixtures/readme-page.ts` block and asserts a two-colour frame (single
      unlit circle on a uniform clear). Check-docs still pins the
      `start()`/`step()` pairing.
- [x] **`examples/README.md` never says how to *view* an example.** DONE b9ee8aa — a "Running one" section. Every entry gives
      `bun run <name>:build`, which writes `dist/` and shows nothing. The dev-server
      command (`bunx vite examples/<name>`) is in the root `README.md` only, which is not
      where a reader browsing `examples/` is looking.

- [ ] **Dogfooding coverage map (standing assignment) — surfaces DONE, so they are not redone.**
      Verified from a clean consumer against the staged published-name packages, each with a
      control: JS runtime · TypeScript types (strict, `skipLibCheck: false`) · publish/staging
      path · all 25 umbrella subpaths · §33/§34 determinism · §34 snapshot round-trip · §7a
      Y-up in 2D. Evidence in MEMORY.md under 2026-09-06.
      NOT yet exercised: the browser/render path (WebGL + WebGPU, all 10 browser examples are `index.html` + vite and
      I have only run headless), animation/tweens (§93 timeline), assets/glTF loading, UI, input,
      particles, and the 2D↔3D mixed-scene story. Those are where the next findings are.

- [x] **`registerRapierSolver()` throws on a second call — awkward for anything building more than
      one world.** Registration is process-global, so a test suite or a probe with a `makeWorld()`
      helper hits `INVALID_APPLICATION_STATE` on the second construction. The error is explicit and
      carries context (`solver: "rapier", registered: ["rapier"]`), and `clearRegisteredSolvers()`
      exists, so this is a usability question rather than a defect: should a re-register of the
      SAME solver be idempotent (or take an `{ override }` flag) instead of throwing? Filed, not
      changed — registry semantics are a §37 call.

      **DECIDED and DONE 2026-09-06: idempotent for an identical registration.**
      §37's refusal exists to stop a silent *overwrite* making `"auto"`'s choice depend on
      module evaluation order (§33). Re-adding the same entry overwrites nothing, so that
      reasoning never applied to it; a *different* solver under the name still throws, with
      the same message and context. Compared by function identity, since
      `registerRapierSolver()` builds a fresh literal each call but its `isSupported` and
      `create` are module-level bindings.
      `physics-rapier`'s own test changed with it, deliberately — the contract narrowed, and
      it now covers both halves. Dogfooded from outside with the `makeWorld()` helper from
      the finding above: second call threw before, all three build after.
- [x] **`new Node()` is unguarded at runtime — a JS consumer can instantiate an abstract class.**
      **REOPENED 2026-09-06.** A DEV-gated `devWarnOnce` was implemented and then reverted:
      `tests/integration/dev-build-mode.test.ts` forbids *any* build-flag branch in a
      simulation package (`math`, `motion`, `scene`, `physics`, `animation`, `particles`),
      because those are the packages a replay's numbers come from (§33). Registering it in
      `GATED` fails the same test's other half. Running it unconditionally is not free
      either: ~100 B gzip in every bundle carrying `@four/scene`, and `examples/ui-demo`
      sits **at** its 45 kB §86 budget. So the fix is an owner call — accept the bytes and
      raise that budget, put the check somewhere outside the simulation envelope, or leave
      the mistake to TypeScript.
      `Node` is `export abstract class Node`; `Group extends Node {}` is the concrete one, and the
      guides use `Group` correctly. But TypeScript's `abstract` is erased at compile time, so a
      JavaScript user who guesses `new Node()` gets a working-looking object with no signal — mine
      simulated a full bouncing ball before TypeScript told me it was wrong.
      Proposal, NOT applied (base-class constructor = broad blast radius, and it is a §6a call):
      a `new.target === Node` guard throwing the same quality of message this library already gives
      elsewhere (the `PhysicsWorld` solver error names exactly what to pass and cites §20/§37).
      Cost is one reference comparison per node; the repo tracks allocation closely, so the
      performance objection deserves a real answer rather than my assumption either way.

      **DECIDED 2026-09-06: leave it to TypeScript. Closed, with the cost measured.**
      The DEV-gated version is forbidden — §33 bars a simulation package from branching on
      the build flag, and `scene` is one. So the only remaining shape is an unconditional
      guard, which every shipped bundle carrying `@four/scene` pays for forever.
      Measured rather than estimated: a guard whose entire message is
      `"Node is abstract; use Group (§6)."` — 49 characters, about as terse as a useful
      error gets — put `examples/ui-demo` **41 B over** its 45 kB §86 budget
      (45.04 kB against 45 kB; reverting restored `bun run size` to exit 0). There is no
      version of this that is free, and no version that fits.
      Against that: `Node` is `abstract`, so **TypeScript already rejects `new Node()`** for
      the library's primary audience, and the published packages ship `.d.ts`. The guard
      would buy a runtime message for JavaScript-only consumers, on a mistake the compiler
      catches at the point of writing — paid for by every user of every app, in bytes, in
      perpetuity. That is the wrong trade.
      Reopening this needs one of two things to change: `ui-demo`'s §86 budget rising for a
      reason of its own, or a home for the check outside the simulation envelope.
- [x] **Publish path was broken — `apply-publish-names` exited 1, so four.js could not be
      published at all.** Found by dogfooding the publish path rather than the API. Rewriter did
      not match subpath specifiers while the validator flagged them; two renderer error messages
      also named `@four/*` to consumers who would have `@danielsimonjr/fourjs-*`. Both fixed;
      the tool now exits 0 (24 packages staged, 724 specifiers rewritten).

- [x] **Dogfooding session 1 finding: `transformAuthority` defaults to `"manual"`, so a physics
      body silently does not move if you forget one line.** Following
      `docs/guides/collision-filtering.md` I skipped `node.transformAuthority = "physics"` and got
      a body that never fell and never bounced — the sim ran, stepped, and produced a frozen
      position. The §42 warning is excellent (it names the exact fix and the spec section), but it
      is a `console.warn` on a run that otherwise looks healthy.
      Worth a decision, NOT a unilateral change: should `world.addBody(node)` default an
      unclaimed node to `"physics"` authority, or throw rather than warn? Defaulting is friendlier;
      throwing is truer to §42's "exactly one system owns a node's transform". Either beats a
      silent no-op. (The guide itself is CORRECT — I misread it; this is about the default, not the
      docs.)

      **DECIDED 2026-09-06: no change. The design is right and I was wrong about it.**
      I implemented "`addBody` claims an unclaimed node" and two existing tests refused it:
      `world.test.ts` → "refuses the write and warns once for a node it does not own (§42)"
      sets `transformAuthority = "manual"` on a *dynamic* body **on purpose** and asserts the
      write is refused and warned. So `"manual"` is not a blank — it is an explicit claim
      meaning *the author writes this transform*. `DEFAULT_TRANSFORM_AUTHORITY` being
      `"manual"` makes the default "the app owns it", which is the safe default: claiming it
      for physics would take the transform away from code that legitimately owns it, and my
      own control test said never to overrule a chosen authority.
      The diagnostic is also better than my note implied. It names the writer, the node, the
      current owner, that the write was **refused**, §42, and the exact line to add
      (`Set node.transformAuthority = "physics"`), then suppresses repeats. That is a good
      error, not a silent failure — my complaint was that a `console.warn` is easy to miss on
      a busy page, which is a property of console warnings, not a defect in §42.
      Reverted cleanly; physics is 25/25.
- [x] **`main` was RED on CI, Docs and Release; reverted #62 and #63 to restore it.** Both had been
      merged over documented failures. Full evidence in CHANGELOG; the short version is that
      vitest 4 and typedoc 0.28.20 have no TypeScript version in common.
- [ ] **Lift the TypeScript/vitest pin once typedoc supports TS 7.** Currently ignored in
      `.github/dependabot.yml`. Both must move in ONE PR — bumping either alone re-breaks a gate.
      Check `npm view typedoc peerDependencies` for a range that includes 7.x.
- [x] **Pre-existing test-isolation defect (Vitest 4 spy history).** DONE
      2026-09-06 — unrestored `console.warn` spies in `world-blend.test.ts`
      and `world-joints.test.ts`. Vitest 4 reuses the spy and keeps history;
      Vitest 3 hid it. `afterEach(vi.restoreAllMocks)` plus a leak-regression
      in each file. Unblocks #62 and the eslint 10 Dependabot ignore (#66
      closed for the same reason). The defect was spy history, not leftover
      worlds — failing tests passed in isolation.
- [x] **rapier 0.20 adoption is a real decision, not a bump.** DONE 2026-09-06 —
      adopted `@dimforge/rapier{2,3}d-compat` **0.20.0**. `contactPair` now
      takes `bodies`. CCD / contact-distance / snapshot-joint assertions
      updated to the measured 0.20 behaviour. Dependabot ignore for 0.20
      removed.

- [x] **Open-PR sweep 2026-09-06: Dependabot hygiene + stale branches.** #65
      (rapier 0.20) and #66 (eslint 10 dev-deps) **closed** and ignored in
      `.github/dependabot.yml` with recorded reasons — both went red on known
      blockers, not fresh defects. Three stale branches deleted after content
      verification against `main` (`claude/tools-integration-rji2sr`,
      `cursor/sanitize-todo-security-coverage-28a3`, `cursor/typescript-on-bun-b951`).
      **#67 ("Release: version packages") deliberately left open** — Changesets'
      standing release-staging PR; merge when 0.1 is actually cut. **#69** (six
      dev-deps) is the live Dependabot PR; the bun-lock workflow should keep it
      green. Remaining tracked branches: `main`, `changeset-release/main`.

- [x] **Open-PR sweep 2026-09-05: 4 open -> 2.** #58 MERGED (conflicted only on trackers, all of
      whose entries were already on `main`; its real contribution was one changeset file, and
      `main` had no pending changesets). #56 CLOSED — byte-identical to the already-closed #54,
      same branch and commit, and re-measured at **0 files / +0-0** against current `main`.
      #63 MERGED (rapier bump, later reverted on `main`); #62 MERGED then reverted — the
      vitest-4 / eslint-10 blocker is fixed separately (spy restore, 2026-09-06).
- [x] **four.js #62 blocked on a PRE-EXISTING test-isolation defect, not a bad dependency.**
      DONE 2026-09-06 with the spy-restore fix above. #62 can be retried once
      typedoc supports TS 7 (the vitest/eslint pin remains).

- [x] **Repository configuration repaired 2026-09-05.** Pages enabled (`build_type: workflow`) —
      `Docs` green and the site serves HTTP 200 at https://danielsimonjr.github.io/four.js/;
      Actions permitted to create PRs (`default_workflow_permissions` left at **read**) — `Release`
      green and its version PR (#55) merged; Dependabot security updates enabled and
      `.github/dependabot.yml` added (npm ecosystem, not bun). All four workflows green on `main`.
- [x] **PR #54 closed as fully superseded** — zero code delta against `main`; 0 of 104 CHANGELOG and
      0 of 117 MEMORY entries were absent from `main`. Evidence recorded on the PR.
- [x] **Dependabot bumps will need manual `bun.lock` regeneration.** DONE 2026-09-06 —
      `.github/workflows/dependabot-bun-lock.yml` runs `bun install` on
      dependabot[bot] PRs only, commits `bun.lock` when it changes, and
      dispatches CI onto that SHA. Frozen lockfile on the main CI job is
      unchanged. Dependabot cannot write
      `bun.lock`, and CI runs `bun install --frozen-lockfile`, so any bump whose resolution changes
      will fail until the lockfile is regenerated on the branch — and a human push costs that PR
      its automerge. Same tax as math-mcp #103. Needs a pipeline answer, not a per-PR fix.

- [x] **RFC 0006 TypeScript-on-Bun toolchain — DONE 2026-09-05.** Bun is the
      workspace package manager/script runner; `bun.lock` + `bunfig.toml`;
      Vitest/`tsc -b` retained; spec revision 1.14. Follow-up (not scheduled):
      optional migration of unit suites to `bun:test` once coverage parity is
      proven.

- [x] **The implementation plan is COMPLETE (2026-08-02).** All 13 phase sections
      (§103–§113a) built, tested, verified. What remains is post-plan work, in the
      verifier's priority order:

- [x] **Gap-analysis campaign CLOSED 2026-08-29 — v2 written.**
      `docs/GAP ANALYSIS v2.md` supersedes v1 (banner added): 74 closed / 21
      partial / 2 open (`R-32`, `R-33`) / 0 RFC-blocked of 97 filings. The
      owner-only remainder is v2 §5's table: stub packaging (row 10),
      NPM_TOKEN + Pages (row 11), §93 stand-ins (row 12), the spec-amendment
      successor queue (row 13 — its original four items were discharged by
      revision 1.8; only §60's angle operator survives), payload policy
      (row 14), PH-11c, the §60a defaults flip, the prettier exemption,
      PH-22f/j/l, R-26's XML seam, A-24's §83 corner. Full gate suite green on
      `df572c6` incl. the 101-test browser gate (readpixels-region first run
      recorded, goldens byte-unchanged).
- [x] **RFC implementation queue (accepted 2026-08-21):** 0002 plugins → 0003
      skinning → 0001 shader/node materials → 0005 pixel picking → 0004 raster
      painting. **The RFC queue (0001–0005) is COMPLETE** (2026-08-29). R-1
      completed 2026-08-29 (WP-R1.1–R1.9 all landed).
- [ ] **RFC 0004 residue (all deferred by the RFC's own §6 table, none
      scheduled):** video textures (frame-arrival signal, DOM-free);
      `ImageBitmap`/decoded-image raster sources (A-18's generic
      `FetchLike<TSignal>` half + the §96 decode row); in-place resize +
      partial/dirty-rect upload + mipmaps/filter modes for raster surfaces (all
      R-30); ~~GPU readback as a raster source (wants its own RFC)~~ **Proposed
      2026-09-06** (`docs/rfcs/0009-gpu-readback-raster-source.md` — display-only
      snapshot, not riding 0004/0005); the §62
      Canvas 2D backend (stays a stub **by decision** — and if ever built,
      refusing a feedback `CanvasTexture` sampling the surface being rendered is
      that packet's named obligation); ~~a docs/guides page carrying the browser adapter~~ (done 2026-08-29:
      `docs/guides/raster-painting.md`, listed as guide 15).

- [x] **A-11 analytic tier (`"geometry"`) — DONE 2026-08-29** (adopted RFC 0005
      Q3 executed): `node.hitTestMode` (`null` default = engine-selects;
      `"custom"` omitted until a callback strategy exists) +
      `Pickable.triangles` + exact ray/triangle in `@four/input` (no new edge),
      §79 via one wrapper over every umbrella pair (unset scenes
      byte-identical), §85 refusals, §33 pure-math determinism pinned. 36 new
      tests; input/four/geometry 100×4. **A-11 is closed.** ui-demo budget
      bumped 44 → 44.5 kB at landing (A/B: the tier riding ui-demo's `pick()`).
- [ ] **RFC 0005 residue (staged in source, 2026-08-29):** the instanced particle
      id arm (a `ParticleIdProgram` sharing the §36 billboard vertex stage — until
      then particle systems pick by bounds only); §86 rows still owed: id-pass
      cost vs the flagship list and measured fence-vs-stall pick latency;
      WebGPU's `PickingService` (`mapAsync`) is WP-R1.x material; §72
      pointer-event dispatch on a `PickProvider` result is an input packet. The analytic
      `"geometry"` tier + `node.hitTestMode` landed 2026-08-29 — A-11 closed;
      only the render-side residues above remain here.
- [x] **docs/COMPATIBILITY.md §2 — DONE 2026-08-29** (documentation truth
      sweep): §2 rewritten to the tip — seven init pipelines + three registered
      seams, punctual lights, opt-in §65 batching, §69/§70 rows, all-eleven
      capability fields across fourteen members with per-backend honesty,
      WP-R1.9 declaration, "auto" implemented; WebGPU row moved to
      R-1-complete; two §1 consequences corrected. check-compat green.
- [x] **packages/render/src/renderer.ts capability doc-comment overclaims — DONE
      2026-08-29**: the doc now records the R-30b omissions
      (`maxUniformBufferBytes`/`maxBindings` on `WebglRenderer`) and
      `WebgpuRenderer`'s absent `maximumSkinningJoints`; the phantom
      `MAX_VERTEX_UNIFORM_VECTORS` conversion aside is deleted. Comment-only;
      `@four/render` 627 tests and `pnpm run docs` (0 warnings) green.
- [x] **docs/guides/materials-and-render-graph.md — DONE 2026-08-29**: rewritten
      to the tip (§60 RFC 0001, §62 R-1 complete, §65 opt-in R-9, §68–§70
      R-17/R-18/R-6, §55 `frame` R-29), every claim verified in source; four
      further stale claims found and fixed (§57–§59 row, class count, blending
      and colour-edit bullets, sort keys). Guides README item 5 updated. The
      packet's own found-not-fixed items (AUDIT-120 sprites row, CLAUDE.md stub
      count) were fixed at landing.
- [x] **tools/check-docs.mjs §55-batched pin — DONE 2026-08-29**: pin kept
      (batching is opt-in — `renderer.batching` defaults to `null`, so the
      unqualified "batched" is still false of the default path; a truthful
      sentence says "opt-in" and cannot match the retired form); rationale
      rewritten to say so. check-docs green, 10 pins.

      0001's landing decides WP-R1.9's
                                              input: the WGSL emitter is now unblocked — the IR, analysis, reflection and
                                              reachability are backend-independent and re-exported through `@four/render`;
                                              the WebGPU packet mirrors `gl-node-program.ts` over the wgpu pipeline cache
                                              (screen domain included, for §70 graph effects).

- [ ] **RFC 0001 residue (staged in source, 2026-08-28):** uniform blocks (std140,
      with a measurement), reusable functions (named subgraphs need an emission
      scope + call-site key), conditional variants (a second cache dimension),
      storage buffers (§82, WebGPU), source maps (per-node provenance; the error
      path ships source + driver log); lighting-aware graphs (R-17's light-uniform
      contract first); alternative E (data-declared custom operators — a follow-up
      RFC; `SHADER_OPERATORS` token shipped 2026-09-06); ~~an angle operator
      (unlocks §58's conic gradient)~~ **DONE 2026-09-06** (`angle` +
      `registerShapePaints` conic lowering); ~~the §58 Paint-object tier on `Shape2D`~~ (done 2026-08-29).
- [x] **docs/guides/custom-shaders.md — DONE 2026-08-29**: rewritten around the
      landed §60 (builders, registration per backend, closed operator set,
      GraphEffect, deferred list); samples typechecked against dist and graphs
      validated at runtime.

- [ ] **RFC 0003 residue (staged in source, 2026-08-28):** GPU morph path (the
      extra-vertex-stream layout decision, stated in `mesh.ts`/`render-list.ts`/§54);
      skinned shadow caster program (the §69 pass skips skinned draws — a bind-pose
      shadow is a different picture); CPU skinning (Canvas/SVG tiers + the skinned
      bounds/picking home, with its own `same-runtime` golden); bone-texture palette
      (unbounds `MAX_SKINNING_JOINTS = 48`; needs a render-target format union +
      vertex texture fetch); §43-interpolated palettes (today the palette is the
      last resolved pose).
- [ ] **RFC 0003 prototype measurements still owed:** bones-as-nodes resolve cost at
      60 bones ×1/×10 (the number that decides whether alternative A ever returns)
      and controller channel cost at 180 channels. §86 has no skinned-mesh
      performance target yet — propose one from those measurements.
- [x] **glTF loader (§78) shipped 2026-08-29** — `createGltfLoader`/`GltfAsset`
      (`@four/assets`) + `instantiateGltf` (`four`), glTF 2.0 core tier: both
      containers, all six §53 attributes, §59 factors + base-colour texture,
      skins (landed 48-joint refusal), LINEAR/STEP animations via the RFC 0003
      binding form. Refusal list recorded in `gltf.ts`'s header; digests pinned
      in `tests/determinism/gltf-load.test.ts`; browser gate
      `tests/browser/gltf.spec.ts`.
- [x] **§59 second texture unit** (R-13 follow-up, flagged by the §78 packet):
      DONE 2026-09-06 — `StandardMaterial.metalRoughnessMap` (glTF G=roughness,
      B=metalness). WebGL binds unit 2. WebGPU field is staged inert.
      The glTF loader decodes that slot as linear and drops `ignoredTextures`
      for it. Normal/occlusion/emissive remain warned-inert until further
      units land.

- [x] **Move the six capability tokens to their owning packages — DONE
      2026-08-29** (RFC 0002 §2's spelling executed): each owner declares its
      token in `capabilities.ts`; `four/plugins.ts` re-exports the very objects
      (identity pinned by `toBe`); §96 boundary test now splits host machinery
      (banned) from token declaration (the four owners, dated).
- [x] **Tokens for the five absent §81 extension points** DONE 2026-09-06 —
      `ASSET_LOADERS`, `SHADER_OPERATORS`, `UI_CONTROLS`, `EDITOR_TOOLS`,
      `COMPUTE_WORKLOADS` each land with a minimal registry; umbrella
      re-exports the same objects.

### Post-plan backlog (final exit verifier, 2026-08-02)

- [ ] Lighting follow-ups (MVP tier shipped 2026-08-04 — see Done): multi-light +
      point/spot/hemisphere/area (§68 uniform arrays / clustered path), shadows (§69 —
      directional tier shipped 2026-08-09; cascades, point/spot maps, the atlas,
      transparent masks and contact shadows remain),
      §59 StandardMaterial/PBR, §60a color management + tone mapping + CSS color
      strings on lights, light layers; hoist the lit shader's per-vertex
      inverse-transpose to a per-draw normal-matrix uniform when @four/math grows a
      Matrix3 utility (dated note in gl-program.ts)
- [x] Spec-revisit note (2026-08-04) — **done, spec revision 1.8 (2026-08-08)**: §57's
      family list now names `LitMaterial`
- [ ] First publish (§94 0.1): Changesets release workflow + the
      @danielsimonjr/fourjs publish-name mapping — owner step

### Gap-closure wave 3 (2026-08-07) — in progress

> **2026-08-08:** `docs/GAP ANALYSIS v1.md` supersedes v0 as the working gap document —
> its §4.6 attack order and §5 owner-decision register are the tracker for what
> remains; the wave sections below are the historical per-batch record. v1 also
> recorded nine closures from `ab13840`/`fe8eb6f` (2026-08-06) that these sections
> never listed: PH-2, PH-3, PH-4, PH-7, PH-14, PH-15, PH-16, PH-1 stage 1, R-11, and
> the R-12/R-10 base tiers — all closed, now in CHANGELOG.

- [x] **R-1 / WP-R1.1 — WebGPU device, registry, clear, unlit triangle, fake-device
      harness. Landed 2026-08-21.** `RendererCapabilities` widened once (additive,
      optional members); `webgpu` Playwright project added with the flag confined to it
      (globally it perturbs the flagship's frame-pacing spec); render-list consumption
      harness added under `tests/determinism/`.
- [x] **R-1 / WP-R1.2 — WebGPU geometry, texture and sampler caches** (§77, §83) —
      **done 2026-08-28, all gates green.** Sampler cache keyed on the five resolved
      values; blit-based lazy mip generation; unlit `map` variant at bind group 1.
- [x] **R-1 / WP-R1.3 — sprites, text and `wgpu-batch.ts`** — landed 2026-08-28.
      Sprite pipeline over a second lazy group-0 layout; text proved as the textured
      unlit tier (R-28); `createWgpuBatching` uploader (buffer pair per batch slot —
      queue-order rationale in the module header; staging ring noted, not built).
      Browser specs written (sprites/batch + WP-R1.2's deferred texture evidence,
      stencil intersection), self-skipping; validated with the wave's browser gate
      at the RFC 0003 landing.
- [x] **R-1 / WP-R1.4 — WebGPU shapes and vertex colours** — landed 2026-08-28,
      tests-only as predicted (skinned-kind absence pinned; vc browser spec added,
      self-skipping — runs with the wave's browser gate at the RFC 0001 landing).
- [x] **R-1 / WP-R1.5 — lit and standard pipelines, lights** — landed 2026-08-28.
      One per-view light uniform block at group 1 (all-vec4, 592 B, count as f32),
      shaded `map` at group 2, §59's block as a third group-0 layout, normals per
      shaded acquisition (litless byte-identity incl. normal-carrying geometry),
      eight lazy WGSL variants each with its own browser compile line
      (`tests/browser/webgpu/webgpu-lit.spec.ts`, written, awaiting the wave's
      browser run). Shadows on the shaded families ride WP-R1.7.
- [x] **R-1 / WP-R1.6 — render targets, effects, graph participation** — landed
      2026-08-28. Format table as data (`depthTexture` → **`depth32float`**, the
      sampleable-and-copyable choice; stencil → `depth24plus-stencil8`, the
      exclusivity's independent reason); `renderEffect` per (kind × format)
      through the shared lazy cache (`|e:` conditional suffix, landed keys
      byte-identical); `readPixels` whole-target via `copyTextureToBuffer` +
      `mapAsync` (region form landed 2026-08-29), rows
      bottom-to-top by decision; R-4 feedback refusal restated at both seams and
      cross-checked against `RenderGraph.validate()`; `RenderGraph` unchanged,
      graph-vs-hand tape identity pinned. Browser specs written
      (`webgpu-effects.spec.ts`, one compile line per module, self-skipping —
      runs with the wave's browser gate). RFC 0001's `"graph"` effect kind absent
      on WebGPU until the WGSL emitter. (The WP-R1.5-era size overruns were RFC
      0001's and were bumped at its landing.)
- [x] **R-1 / WP-R1.7 — shadows and stencil parity** — landed 2026-08-29.
      Caster pass into the R1.6 `depth32float` row; nine explicit
      `textureSampleCompareLevel` taps through a nearest comparison sampler on a
      widened lights layout (spare stride bytes; no landed transcript moved);
      lazy `|sh` variants; R1.3's material-stencil residue retired by
      `frameWantsStencil`. Browser specs written under `tests/browser/webgpu/`
      (shadow threshold + the stencil 1/6 mirror), pending the next
      `test:browser` run — record first-run measurements into the spec headers
      then, per the gate convention.
- [x] **R-1 / WP-R1.8 — compute (§82) and GPU particles (R-31)** — landed
      2026-08-29. Instanced billboard draw (the `gl-particles.ts` port: third
      group-0 layout, once-per-frame instance uploads, §67 clips honoured,
      zero-count skipped before the geometry cache); §82 `compute()`/buffer
      create/write/read over optional device members; the §36 integrator kernel.
      `ComputePass` descriptor in `render-webgpu` pending the Q3 one-re-export
      promotion (RFC 0004 held `packages/render`). Browser specs written under
      `tests/browser/webgpu/` (particle rasterisation + exact integrator
      readback), pending the next `test:browser` run — record first-run
      measurements into the spec headers then. `simulation: "gpu"` deliberately
      unwidened (WP-9.1 rule).
- [x] **R-1 / WP-R1.9 — §62 capability declaration + the WGSL node pipeline —
      landed 2026-08-29. R-1 COMPLETE.** Declaration at the resolve tier
      (tri-state honesty, refuse-not-warn, §45 forwarded); `wgpu-node-program.ts`
      behind `registerWebgpuNodeMaterialPipeline()` (source-keyed lazy modules,
      per-program strided block, groups as data, §33 golden
      `node-material-wgsl.json` over the GLSL golden's graphs); §70 `"graph"`
      drawn on WebGPU (R1.6 pin flipped); undisplaced node casters cast; full
      browser gate 91/91 with the deferred R1.7/R1.8 first-runs recorded.
- [x] **R-31 residue DONE 2026-08-29** — `simulation: "gpu"` widened in the
      same change that wired the integrator (WP-9.1 rule held). Remaining §36
      GPU items, each its own packet: §27 GPU fields,
      `collisions: "depth-buffer"`, GPU-side bounds (a `computeBounds` on a GPU
      system honestly returns `false` — RFC 0005 bounds-picking reports nothing
      for it), GPU-emitter §79 serialization + §34 snapshots (blocked on the
      GPU-readback RFC), device-loss recovery (today: new emitter).
      particles-demo budget bumped 35.5 → 36 kB with the +0.55 kB measurement.
- [x] **Q3 promotion DONE 2026-08-29** — `ComputePassDescriptor` (+ structural
      `ComputeBuffer`, `supportsCompute`) in `@four/render`; optional
      `Renderer.compute?()` (fourth optional-member instance); `render-webgpu`
      re-exports the very tokens; the umbrella's `Four.ComputePass` named-map
      sugar landed with it (§82 names it — key insertion order = binding
      order). Buffer allocation deliberately stays backend API. WP-R1.9 landed 2026-08-29 — the R-1 plan (R1.1–R1.9) is complete. What
      remains around R-1 is not R-1's: this Q3 one-re-export promotion, the R-31
      emitter wiring, the §62 canvas2d/svg stub tiers, and WebGPU skinned kinds
      (joint-palette pipeline, unstaged — RFC 0003's successor filing).
- [x] **§62's "applications may declare required and optional capabilities" —
      DONE 2026-08-29 (WP-R1.9 first half).** `RendererResolveOptions.capabilities`
      (+ §45's `rendererCapabilities`/`onRendererCapabilityShortfall`), closed
      name union, §85 validation, tri-state honesty (`undefined` never satisfies
      a requirement), `"auto"` skip with `"missing-capability"` reports, named
      fail-fast, optional-never-gates.

- [x] **R-31 mechanism closed on WebGPU (WP-R1.8, 2026-08-29)** — see the R-31
      residue item above for the remaining `@four/particles` wiring; WebGL 2
      declares the tier absent.
- [ ] **Follow-ups the R-1 plan explicitly defers** (each needs its own filing): §63
      transient-target pooling and barrier scheduling (must land on both backends or
      neither); §65's persistent-mapped/staging-ring buffers; §27 GPU fields and §36
      `collisions: "depth-buffer"`; RFC 0005's `Rectangle2` prerequisite for a regional
      `readPixels`.
- [x] **PH-11 residue — §12 character controllers DONE 2026-08-21.**
      `CharacterController` + `FirstPersonLook` in `@four/motion`, advanced by the
      existing `KinematicSystem` under §42's `"kinematic"` authority; §79 pair
      registered; new §33 golden; first-person closed by composition (character yaw +
      child-node pitch), not by a new rig class. Playground sensor-zone test verified
      green on the settled tree (the earlier failure was the in-flight build state).
- [x] **PH-11b — solver-backed character controller DONE 2026-08-21.**
      `SweptCharacterController` + `SweptCharacterSystem` in `@four/physics` over
      `PhysicsWorld.shapeCast` (§30): capsule sweep, slide-along-wall, step height,
      slope limit, ground snap. The recorded question is answered — it **holds** a
      `CharacterController` (its vertical state is ES-private with no setters, and
      `grounded` is a promise about a plane), so `@four/motion` needed no edit. §39
      step 4 before the solve, §42 `"kinematic"`, §79 with the physics family, new §33
      golden on real Rapier 3D. Platform carry and pushing dynamics staged with seams
      named (`groundBody` + `translate()` published for the first).
- [x] **PH-11c — character/dynamics push interaction (`@four/physics`).** DONE
      2026-09-06 — reduced-mass impulse `μ · closingSpeed · (−n) · scale` at
      `ShapeCastHit.point`; `pushMass` default 80 kg; wakes sleepers;
      `pushDynamics` opt-out.
- [x] **Character-controller example follow-up — DONE 2026-08-29 (both
      filings, one page):** `examples/character-controller`, a first-person
      example exercising `CharacterController` (patrolling plane tier),
      `FirstPersonLook` (child-eye pitch) and `SweptCharacterController`
      (WASD capsule: slide, 3-riser step-up, jump) plus the §39
      input → kinematics → solve ordering. Tenth browser-gate site (4182),
      5 threshold specs; one Rapier wasm image, 0.90 MB gzip, budgeted
      0.95 MB; landed atomically with AUDIT-120's examples row 9 → 10.

- [x] **Tests typecheck sweep DONE 2026-08-21** — `pnpm typecheck:tests` added and
      wired into CI after `Build`; 21 errors in five classes fixed as the misspelled
      intent; the text visual golden regenerated deliberately (the fixture now clears
      as it always intended). Closes the hole R-8 identified.
- [x] **`Rectangle2` in `@four/math` — DONE 2026-08-29**, and §61's
      `readPixels(target, region?)` landed with it on the interface and both
      backends (WebGPU region via `copyTextureToBuffer` origin; WebGL via the
      stalling form in the promise shape, defended in-source). RFC 0005 Q5's
      adopted disposition stands: picking's single-texel path still bypasses
      `readPixels`; a _regional pick_ form remains that packet's residue.
- [x] **Playground sensor-zone browser test — re-checked 2026-08-29** at the
      controllers landing and again in the v2 closing gate (101/101); the
      2026-08-21 failure was the in-flight `packages/motion`/`physics` tree.
- [x] **R-37 CLOSED 2026-08-21** — §47's `ScreenCamera` (three origins × two unit
      systems, §7a defaults, negative near, §85 refusals, §79 pair) plus
      `Application.resize` feeding it through the structural `SurfaceSizedCamera`
      opt-in, and `TrackballRig`, the last staged §44/§47 rig. 27 new package tests, 4
      integration, 1 new browser test with pixel-exact placement on SwiftShader. 0 B in
      bundles that do not register serializers.
- [x] **Flagship UI-panel follow-up — DONE 2026-08-21 (examples packet).** Both
      flagships on the ScreenCamera recipe; workaround notes deleted; AUDIT-120 and
      the text README corrected with a new check-docs pin.
- [x] **Stale trackball staging note — DONE 2026-08-21** (rig table points at
      `@four/scene`'s `TrackballRig`).
- [x] **R-21 — §53 geometry model (2026-08-21).** `Geometry` base, `clone()`,
      `BoundingVolume` (box + circumscribing sphere). `GeometryBounds` aliased, R-8
      unmodified. Seven §53 subclasses and hierarchical volumes deliberately staged with
      the 2026-08-02 argument intact.
- [x] **R-34 — §27 field batching (2026-08-21).** `ParticleForceField.sampleAll`, all
      seven built-ins, bit-identical, per-field cost 5.15 → 1.12 ms;
      `benchmarks/results/particles-100k.json` re-recorded (3-field 100k stack
      16.58 → 4.51 ms).
- [x] **R-32 — textured / rotated / soft particles.** DONE 2026-09-06 — opt-in
      10-float stream (`rotation` + `softness`); default 8-float stream and
      goldens unchanged. WebGL appearance program is lazy.
- [ ] **R-33 — §112's exit, rendered as well as simulated.** Owner: the browser-gate
      packet, on non-SwiftShader hardware. Now has headroom (see R-34). Report
      simulate-ms and present-ms separately.
- [x] **R-31 — GPU particle simulation integrator tier.** DONE 2026-08-29 (WP-R1.8 +
      R-31 residue) — `simulation: "gpu"` on `ParticleEmitter` with a bound
      `ParticleGpuSimulation`; CPU spawn, GPU semi-implicit Euler under constant
      gravity. §27 GPU fields, `collisions: "depth-buffer"`, GPU-emitter §79/§34,
      and device-loss recovery remain separate follow-up packets (see R-31
      residue above). The stale "blocked by R-1" note predated WP-R1.8.
- [x] **R-7 — §67 stencil support (2026-08-21).** `StencilState` in `@four/materials`,
      `RendererOptions.stencil` / `RenderTargetOptions.stencil`, backend application and
      packed `DEPTH24_STENCIL8` allocation, `FRAME_BEFORE_R7` recorded on the reverted
      build, real-driver masking proof (browser gate now 64 tests). Budgets bumped
      34/31/39.5 kB with A/B measurements.
- [x] **§67 clipping API (from R-7's residue) — closed 2026-08-28.** `node.clip` in
      `@four/scene`; allocator/mask emission in `@four/render/src/clip.ts`; backend
      application, §79 pair, batching break, per-view masks; browser proof
      `tests/browser/clipping.spec.ts` (nested intersection measured at exactly 1/6).
      §73's scroll view now waits only on §74 overflow/scroll extent + a gesture
      source (staging note updated in `widget.ts`); §119's section views unblocked
      (a section view = a clip whose source is a §50 shape). Staged with named
      owners in `clip.ts`: alpha masks, 3D clip planes; the scissor fast-path
      bullet below is unchanged and still open.
- [x] **render-webgpu ignores `item.clip`** — closed by WP-R1.3 (2026-08-28): masks
      write bit planes / content tests them, `item.clip` outranks `material.stencil`,
      batch runs break on record identity; `depth24plus-stencil8` chosen per frame
      from R-23's O(1) first-item read; clipless transcripts byte-identical. Residue
      (rides WP-R1.7's stencil-parity packet): §57 `material.stencil` on a frame that
      never clips is inert on WebGPU — GL-without-`{stencil:true}` parity, stated in
      source.
- [x] **Sprite §79 flag drop — DONE 2026-08-30.** `SpriteOptions` now
      _extends_ `RenderableOptions` and the constructor forwards the whole
      record to `super` (the Shape2D pattern). Restating a subset had dropped
      `castShadow`/`receiveShadow`/`frustumCulled`; a new drawable field
      cannot be dropped the same way again. Round-trip asserted in
      `scene-serializers.test.ts` and a constructor unit in `sprite.test.ts`.
- [x] **Scissor clipping (§67's first bullet, small)** — DONE 2026-09-06.
      `Renderable.scissor` / `RenderItem.scissor` is a drawing-buffer rectangle
      (bottom-left, +Y up). The backend intersects it with `view.rect` and
      restores the view scissor after the item. Default-off: a scene that
      never names one issues the same scissor calls it issued before. The
      batcher breaks a run where the rectangle changes.
- [x] **Flake to watch — DONE 2026-08-30:** `packages/render/tests/shape.test.ts`'s
      "widens to a 32-bit index buffer" now has a 20 s timeout so `--coverage`
      on a loaded box cannot flake the assertion.
- [x] **PH-21 — §39 step 9 occupiable (2026-08-21).** `PhysicsEventSystem` at
      `PRIORITY_EVENT_DISPATCH` + `PhysicsSystemOptions.dispatchEvents`; golden
      `event-dispatch-split.json`. Steps 7–8 closed as not splittable, documented in
      `physics-event-system.ts`.
- [x] **PH-20 — §33 rollback (2026-08-21).** `RollbackBuffer` + `RollbackTarget` in
      `@four/diagnostics`; `tests/determinism/rollback.test.ts`.
- [ ] **PH-22 residue (re-read 2026-08-21):** `PH-22f` joint-anchor mutability still
      blocked on the which-pose decision (physics-joints packet); ~~CCD/FABRIK/limits~~
      **DONE 2026-09-06** (`solveCCD` / `solveFABRIK` + joint limits + iteration
      budget); ~~path-planning adapters still want an RFC~~ **Proposed
      2026-09-06** (`docs/rfcs/0007-path-planning-adapters.md`);
      ~~`PH-22l` `Clock`~~ **DONE 2026-09-06** (type alias for `TimeState`);
      ~~`PH-22n` remainder — §10's dropped-time warning is app-tier in
      `packages/four`'s `Application`~~
      (**done 2026-08-30**: `Application.step` emits a `devWarnOnce` when
      `TimeState.droppedTime` is non-zero).
- [x] **Step-8 sensor bookkeeping example — DONE 2026-08-29.**
      `examples/physics-playground` runs PH-21's split
      (`dispatchEvents: false` + `PhysicsEventSystem` at 900) with a
      `ZoneTallySystem` at 800: §30 `overlapBox` re-measure per step, consumed
      by the step-9 listeners for the repaint; `data-tally*` mirrored beside
      `data-zone*` and gated by `tests/browser/sensor-tally.spec.ts` (±1
      agreement band — an exact contact boundary may legitimately disagree by
      one). +405 B gzip; existing playground specs untouched and green.
- [x] **R-8 DONE 2026-08-09** — §64 per-view render lists (`buildViewRenderList`, derive
      not rebuild), §87 frustum culling (`Frustum` in `@four/math`,
      `computeWorldBoundingSphere`, default-on, fails towards drawing), §49
      `frustumCulled` (§79-serialized), and §66 key 4 (`sortRenderListByDepth`, opt-in
      verb). Budgets bumped 32.5/30/38 kB with A/B measurements. Residue: occlusion
      culling and a spatial index — neither blocks anything.
- [x] **R-8 follow-ups:** DONE 2026-09-06 — (a) `compareRenderItems` (key 3 beats
      key 4; transparent depth within the same pipeline/material);
      (b) structural `computeBounds` copied onto `RenderItem`;
      (c) excess-property cases already rewritten.
- [x] **PH-8 — §26/§27 force fields for rigid bodies.** Closed 2026-08-09: `ForceField` +
      `ForceFieldSystem` at §39's `PRIORITY_FORCES`, `PhysicsWorld.forEachActiveBody`,
      required per-field units, structural reuse of `@four/particles`' §27 field set with
      no new §3.1 edge, new same-runtime golden
      `tests/determinism/golden/force-fields.json`.
- [x] **PH-12 — §8 space modes, physics tier.** Closed 2026-08-09: `SpaceMode` vocabulary
      in `@four/core`, `RigidBody.space`, `PhysicsWorld.addBody` enforcing §8's sentence
      with two distinct refusals, §79 round trip.
- [x] **§8 node-level `NodeSpace` component (PH-12 remainder).** DONE 2026-09-06
      — class + `NODE_SPACE_SERIALIZER` + `registerSceneNodeTypes`. Presentation
      placement is still a render/UI consumer.
- [x] **§21 `"local-plane"` simulation frame (PH-12 remainder).** DONE 2026-09-06
      — `PhysicsWorldOptions.localPlane` (default XY); feed/publish map;
      golden `local-plane.json`.
- [x] **§27 field torque and field-driven waking (PH-8 remainders).** DONE
      2026-09-06: optional `ForceField.sampleTorque` (always N·m; linear
      `units` do not scale it, so `sample` stays one vector and a particle
      field stays assignable). Per-entry `wakesSleepingBodies` (default
      off) walks `forEachSleepingDynamicBody`; two entries that disagree
      do not share a visit — persistent gravity cannot defeat §32 because
      an explosion field is also registered. A zero sample still leaves
      the body asleep; `applyForce`/`applyTorque` do not wake (WP-5.2), so
      a non-zero waking contribution calls `RigidBody.wake()`.
- [x] **R-10 keys 3–4 DONE 2026-08-09 (key 3 shipped, key 4 staged on R-8)** —
      `groupRenderListByPipeline` puts §66's key 3 in a second verb, stably, with
      `RenderItem.materialId` as its material half; `buildRenderList` untouched and every
      existing scene byte-identical. Key 4 deferred on `R-8`'s per-view list with a dated
      argument (one list, many views ⇒ a depth key would be wrong, not merely
      disruptive).
- [x] **R-9 DONE 2026-08-09 (consecutive-run tier)** — §65 sprite and compatible-shape
      batching: `RenderBatcher` (`@four/render`) + `createGlBatching()`
      (`@four/render-webgl`), opt-in per renderer and 0 B in bundles that do not ask.
      Drawn through the existing unlit program (no new pipeline, no shader edit); pixel-
      identical on SwiftShader (0/76 800 differ, 13 draws → 3); 100 k sprites → 7 draws,
      50 k shapes → 4. Two §86 rows moved from feature-blocked to half-measured.
- [ ] Batching follow-ups (§65, after R-9's consecutive-run tier, 2026-08-09):
      instanced meshes for the shaded pipelines (`R-22` — a baked batch has no normals);
      glyph batching once `R-30` → `R-28` land a `Text` node (its sprites over one atlas
      material batch as they are); texture-atlas _grouping_ of distinct textures (needs a
      packer); a change-detecting batch cache so a still scene re-uploads nothing (§86's
      idle-scene row — today a batched run re-uploads every frame); making batching the
      default, which needs A-4's build-time pipeline-selection seam (the opt-in seam
      already costs every bundle +0.17 kB).
- [x] **`buildRenderList` is now ~40% of a 100 000-sprite frame's preparation**
      DONE 2026-09-06 — homogeneous sort skip, sprite fast path, and
      `ALL_LAYERS` layer test. `benchmarks/results/render-batching.json`
      re-recorded (~10 ms list median at 100k sprites on this host vs ~34 ms
      prior baseline).
- [x] **R-36 DONE 2026-08-09 (helper tier)** — `Node.lookAt(target, up?)` +
      `Node.getWorldDirection(out)` over `Quaternion.setFromLookDirection`; −Z confirmed
      as every node's forward, world-space target with the parent rotation divided out,
      §85 refusals, `same-runtime` determinism. `getWorldDirection` hoisted off the two
      light classes; `Matrix4.decompose` now shares one Shepperd implementation (goldens
      bit-identical, `matrix4.ts` to 100%). 36 tests. **Rig half still open.**
- [x] **R-28 DONE 2026-08-13 (bitmap-label tier)** — the `Text` node in `four`
      (dependency matrix forbids `render`↔`text`), one geometry over one atlas material,
      one draw per label; §65 glyph batching closed by construction; §56 alignment on
      `layoutText` (cross-platform §33 tier, stated mechanically); §79 pair with loud
      atlas refusal; `castShadow` false-by-data on this class alone. §86's
      animated-glyph row now `half`-measured.
- [x] **R-30 advanced 2026-08-13 (sampler-state tier)** — `TextureSource.filter`/`wrap`
      through `Texture`/`MaterialTexture` to `TextureCache`; structural byte-identity;
      +0.11 kB per Texture-carrying bundle.
- [x] **R-30b advanced 2026-08-21 (mipmap + anisotropy tier)** — `TextureSource.mipmaps`
      / `.minFilter` / `.anisotropy`, applied by `TextureCache` at upload
      (`generateMipmap`, the min/mag split, a lazily negotiated
      `EXT_texture_filter_anisotropic`). `Texture.byteLength` bills the chain.
      Byte-identity structural, asserted as whole transcripts; new integration + browser
      gates. `@four/assets` deliberately untouched — mipmap generation is an upload
      decision, and `new Texture({ ...asset, mipmaps: true })` already works. Budgets
      bumped 34.5/32/40.5 kB with A/B numbers.
- [ ] **R-30c — the rest of §77, scoped by why each is not ordinary work:**
      ~~`capabilities.maxAnisotropy` / texture-format report~~ **DONE 2026-09-06**
      (lazy after init; `textureFormats` already shipped). `TextureSource.dimension`
      refuses non-2d. Still open: cube/array/3D uploads, compressed containers,
      video/`ImageBitmap`, map roles, async upload.

- [x] **Examples onto `Text` — DONE 2026-08-21**, extended to both flagships
      (layer assignment needs one node per label). Draw calls: first-2d 30 → 1,
      ui-demo 44 → 3, twin 159 → 59; bundles shrank; two ui-demo goldens
      regenerated deliberately (glyph pixels only, crisper).
- [x] **§44/§47 camera rigs DONE 2026-08-09 (R-36 rig half + PH-11)** — `OrbitRig`,
      `FollowRig` (follow target **and** spring arm, one class switched by `frame`,
      smoothed by `SpringDamper`), `LookAtConstraint` and `ConstraintSystem` at §39
      step 7 under §42's `"constraint"` authority — the first producing system that
      authority has ever had. A rig places, a constraint aims, both in one system
      because §42 gives a node one owner. Path animation and physics attachment close
      by composition (no class). §85 refusals at authoring, counted skips
      mid-simulation, §79 serializers registered in the same batch, new determinism
      golden. 0 B in five of six bundles, +2.8 kB in `motor-digital-twin`.
- [x] **§12 character controllers + first-person look (PH-11 residue).** DONE —
      `CharacterController` + `FirstPersonLook` in `@four/motion` (2026-08-21),
      `SweptCharacterController` + `SweptCharacterSystem` in `@four/physics`
      (PH-11b, same date), and `examples/character-controller` as the tenth
      browser-gate site (2026-08-29). First-person closed by composition
      (character yaw + child-eye pitch), not a new rig class. PH-11c
      (kinematic→dynamic push) remains the only staged half.
- [x] **Staged rigs — trackball and fly DONE 2026-09-06.** `TrackballRig` verified
      in `@four/scene` (`packages/scene/src/trackball.ts`,
      `packages/scene/tests/trackball.test.ts`, R-37 2026-08-21). Fly documented as
      a working application snippet in
      `docs/guides/cameras-and-coordinate-conversion.md` (no class — reuses
      `OrbitRig.orbit()` for yaw/pitch state).
- [x] **Staged rigs — shake/impulse (R-36/R-37 residue):** DONE 2026-09-06 —
      `CameraShake` additive offset over interpolated hash value-noise sampled
      at `simulationTime` (rate-independent). Seed is a salt, not a stream.
- [x] **Nothing exercises a rig against a live solver — DONE 2026-08-30.**
      `tests/integration/camera-rigs.test.ts` now chases a Rapier 3D dynamic
      body with `FollowRig` + `LookAtConstraint`; priority 600 then 700 is
      the observable, not an argument.
- [x] **§44/§47 camera rigs residue — trackball and fly DONE 2026-09-06.**
      Shipped: orbit, follow, spring arm, look-at, path-composed aim, physics
      attachment, first-person look (`OrbitRig`, `FollowRig` + `SpringDamper`,
      `LookAtConstraint` + `ConstraintSystem` at 700, Rapier chase in
      `camera-rigs.test.ts`, `FirstPersonLook` + `CharacterController`),
      `TrackballRig` (`@four/scene`, R-37), fly (guide snippet in
      `docs/guides/cameras-and-coordinate-conversion.md`). Remaining:
      shake/impulse (`CameraShake`, staged under "Staged rigs" above).
- [x] **Examples onto `lookAt` — DONE 2026-08-21.** Camera and sun in
      `first-3d-scene`; the aim moved 2×10⁻⁴ rad, no golden at risk, thresholds
      held. Rigs declined on merit (nothing moves).
- [x] **Size budgets are thin after R-36 (measured A/B, 2026-08-09)** — DONE
      2026-09-06. #70 landed 38.5 / 37 / 45.5 kB on main; this branch re-measured
      after trails + contacts: first-3d 38.51 → **39 kB**, particles 37.11 →
      **37.5 kB**, ui-demo 45.55 → **46 kB**. Rationale in `tools/size-budgets.mjs`.
- [x] **R-16 DONE 2026-08-09 (solid-paint + full-stroke tier)** — `Paint`/`SolidPaint`,
      `ShapeFill`, `StrokeStyle` whole (alignment, caps, joins with miter-limit
      fallback, dashes with phase offset) over `expandStroke` in §52's tessellation
      module; `Line`/`Polyline`/`Arc` complete all fourteen §50 rows (twelve classes);
      fill+stroke travel as per-vertex colour — no `RenderItemKind`, no pipeline, no
      frame-path edit. **Group 5 (the 2D vector stack) is closed.**
- [x] **The shape paint pipeline — the §58 `Paint`-object tier DONE 2026-08-29**
      (`registerShapePaints()`: linear/radial gradients + image/render-target
      patterns lowered to `NodeMaterial` graphs; unregistered =
      skipped-not-approximated; golden `shape-paint-glsl.json`). What remains,
      each with a named owner: **conic** (waits solely on §60's angle operator —
      RFC 0001's one-row closed-union amendment); **§52's anti-alias fringe**
      (per-vertex coverage attribute no §57 pipeline reads). **`ShapeMaterial`'s
      fate is settled** — unshipped a third time, argument recorded in
      `shape.ts`'s header. New staged residue: values-as-uniforms lowering for
      animated gradient stops (noted in `shape-paint.ts`'s determinism section).
- [x] **R-23 follow-ups (solid-fill tier shipped 2026-08-09):** Boolean ops
      DONE 2026-09-06 (`booleanOp` / Path.union|intersect|subtract|xor).
      Residue: alpha masks, 3D clip planes, screen-space flattening tolerance.
- [x] **R-26 follow-ups (path-data tier shipped 2026-08-09):** SVG document
      tokenizer DONE 2026-09-06 (`parseSvgDocument`, no DOMParser; DOCTYPE
      refused). `formatSvgPathData({ precision })` opt-in; default bytes
      unchanged. Arc→arc seam residual remains.
- [x] **RFCs 0001–0003 drafted 2026-08-07** (R-14, A-3, PH-10/R-22) — all three
      **owner decision pending**; packets blocked on acceptance: - R-14 packet gate: byte-identical GL for node-material-free scenes (F13 method) + grep-proven bundle A/B; sequence R-12 (done) → R-14 → {R-1, R-6 widening,
      R-13} - PH-10/R-22 named owner question: bone-axis convention (RFC recommends imposing
      none; +Y for helpers only). Packet gates: `MorphWeights` is the sixth
      `static typeName` and fails the registry-completeness test until registered - Cross-RFC coordination: 0001 and 0003 both widen `RenderItemKind` — whichever
      packet lands first owns the `pipelineId` shape - New spec-revisit items: §57 `ShaderMaterial` row may become permanently
      unshipped (0001 Q1); §54 `morphTargetWeights` placement conflicts with §3.1
      (0003); §17's track-type promise in `track.ts:40-45` is wrong (binding forms,
      not `ValueKind`s)
- [x] **A-8/R-2/PH-19 CLOSED 2026-08-07** (one design, three filings): renderer +
      solver registries with explicit registration; `renderer: "auto"` /
      `solver: "auto"`; instance-naming apps keep tree-shaking (grep-proven)
- [x] **Auto-selection follow-ups CLOSED 2026-09-06:** ui-demo §86 budget is
      **45 kB** in `.size-limit.json` (the 30.74/31 kB note was stale after
      later bumps); `backend-selection.test.ts` now registers real
      `registerWebgpuRenderer()` for §62's WebGPU rung (fallback + preference
      over WebGL 2) — upper rungs no longer exercised only against doubles
- [x] **PH-9 CLOSED (state-machine tier) 2026-08-07:** `AnimationController` — seven
      of §18's nine features, typed predicates, own determinism golden, animation
      package still 100% coverage
- [x] **PH-9 follow-ups (staged 2026-08-07):** DONE 2026-09-06 — blend trees
      (1D/2D), `ValueAdapter.add` + `AnimationLayerStack`, controller clip
      events, `from: "*"`, `liveInterrupt` (one depth), `when` string sugar.
      Serialization and unbounded interrupt chains remain unshipped.
- [x] Spec-revisit note (2026-08-07) — **done, spec revision 1.8**: §18 + §97a rewritten
      to shipped; §100 triaged out (a requirements list, never a status claim)
- [x] **R-6 CLOSED (full-screen effect tier) 2026-08-07:** `EffectRenderPass` as a
      third graph pass kind; copy + colour grade; separate `renderEffect` verb keeps
      `render` byte-identical; ui-demo budget bumped 30 → 31 kB on a proven structural
      conflict (even a stubbed renderEffect exceeded by 99 B)
- [x] **R-6 follow-ups (§70 tier 2):** per-viewport effect rectangles DONE
      2026-09-06 (`EffectRenderPass.rect`). Tone mapping / sRGB encode / pass
      inspector / outlines remain.
- [x] **A-2/PH-13 CLOSED 2026-08-07** (one item, filed twice): §40 `UnitSystem` in
      `@four/core` at the conversion/authoring tier the spec specifies; display-only
      rule enforced by an integration test that forbids any other package importing it
- [x] **§40 follow-ups:** `PhysicsWorldOptions.units` DONE 2026-09-06
      (`PhysicsWorldUnits` scale; omitted = identity). §79 header units and
      `parseAngle("90°")` locale/failure policy remain.
- [x] **R-5 CLOSED (linear-pass tier) 2026-08-07:** `RenderGraph` in `@four/render` —
      passes over R-4's target seam, transcript-identical to hand-written calls,
      tree-shakes out of all bundles. **R-6 (§70 post-FX) now unblocked — effects are
      graph passes; do not build a parallel mechanism**
- [x] **R-5 follow-ups — `INVALID_RENDER_GRAPH` + prettier DONE 2026-08-30.**
      Added to §89's `FourErrorCode` union (spec revision 1.13) and
      `GRAPH_ERROR_CODE` switched; `errors.test.ts` exhaustiveness-checks the
      whole union. The two pre-existing prettier warnings
      (`packages/render/package.json`,
      `tests/integration/examples-build-coverage.test.ts`) formatted.
      Remaining: adopt `tests/integration/helpers/recording-gl.ts` in
      `render-to-texture.test.ts` (mechanical dedupe; helper header still
      warns against rewriting a landed gate); §63's on-screen pass-output
      debug view waits on §70's full-screen blit.
- [x] **PH-5 CLOSED 2026-08-07:** `PhysicsWorld.addCollider`/`removeCollider` — one
      collider on a live body, handle/id/checksum position/joints/pose all surviving;
      mass proven both directions on authored- and derived-mass bodies; §34 needed
      nothing. PH-1's post-registration-collider refusal blocker lifted
- [x] **PH-1 CLOSED 2026-08-07** (stage 1 truth table 2026-08-06; stage 2 live writes
      2026-08-07): `SolverBodyTuningAccess` + step-top drain; mass/damping/gravity/CCD/
      collider material/filter live on Rapier; `PhysicsWorld.teleport` ships
- [x] **PH-1 follow-ups:** (c) live velocity writes DONE 2026-09-06 —
      `world.setLinearVelocity` / `setAngularVelocity` only when
      `transformAuthority === "physics"`. (a) `refreshCollider` still refuses a
      collider added after registration without PH-5's live add (PH-5 itself
      already shipped). (b) public-field accessors still deferred (serialization
      risk).
- [x] **A-1 DONE (measurable tier) 2026-08-07:** `app.stats` (`FrameStats`, §84's
      eleven counters; opt-in, default off; byte-identical GL + allocation-free when
      off). The A-6 `app.stats` slice is closed
- [x] **A-4 CLOSED (build-mode tier) 2026-08-07:** `DEV`/`devWarn*`/`devAssert` behind
      optional `__FOUR_DEV__` (dev-default, opt-out); §84 stats + §6a duplicate warn +
      §83 leak audit gated; eight example configs define it false; 0.46–0.52 kB gzip
      saved each (ui-demo 30.46/31); §33 allowlist enforced by an integration test.
      A-1 follow-up (d) closed; A-5's dev-flag dependency discharged
- [ ] **A-4 remainder:** the `@four/diagnostics` §85 validation catalogue (closure
      step 2); converting scattered scene/physics checks to `devAssert` (step 3);
      ~~routing §42's authority-conflict warn through `devWarnOnce` (step 4 — scene
      package)~~ **REVERTED on `main` 2026-09-06** — `@four/scene` cannot import
      `DEV` (§33 simulation envelope); `warnAuthorityConflict` stays
      `console.warn` + WeakMap once-per-pair suppress;
      define (0.75 kB); remaining §83 warnings: ~~disposed-in-use~~ **DONE 2026-09-06**
      (`warnDisposedInUse` in render backends); duplicate asset loads **DONE**;
      ~~detached-node listeners~~ **DONE 2026-09-06** (`Node.#detach` →
      `devWarnOnce`); ~~stale physics handles~~ **DONE 2026-09-06**
      (`rejectStalePhysicsHandle`); ~~per-frame allocations~~ **DONE 2026-09-06**
      (`auditFrameAllocations`); leaked resources / FinalizationRegistry still open
- [x] **§118 flagship DONE 2026-08-07** (A-21's second half):
      `flagship/one-scene-everything-moves` — §118's full list in one scene, 6
      measuring browser tests (49 total), first user of the §62/§37 registries and
      the §113 overlay streams. Remaining under A-21/S-8: the three §93 stand-in
      scenes (owner retire-or-write decision) and §119's motor-digital-twin
- [x] **Flagship follow-up (b) — DONE 2026-08-30.** `examples-build-coverage`
      captures nested paths (`flagship/one-scene-everything-moves`,
      `flagship/motor-digital-twin`); the original `[a-z0-9-]+` capture
      collapsed both to `"flagship"`. Remaining: (a) per-dimension Rapier
      registration; (c) `collectBodyOrigins` default cross size; (d) §46
      layers for the panel viewport.
- [x] **A-5 partial DONE 2026-08-07 (accounting tier):** byte + live-instance
      accounting on BufferGeometry/Texture/RenderTarget; §84's two memory counters
      live. A-1 follow-up (b) closed
- [ ] **A-5 remainder (dev-warning tier, folded into A-4):** the six §83 development
      warnings — leaked resources (now _derivable_ from the counters, but nothing
      warns), ~~disposed-in-use~~ **DONE 2026-09-06** (`warnDisposedInUse` in
      WebGL/WebGPU backends), ~~duplicate asset loads~~ **DONE 2026-09-06**
      (`AssetManager.load` of a settled slot → `devWarnOnce`), ~~detached-node
      listeners~~ **DONE 2026-09-06** (`Node.#detach`), ~~stale physics handles~~
      **DONE 2026-09-06** (`rejectStalePhysicsHandle` in Rapier + fake adapters),
      ~~per-frame allocations~~ **DONE 2026-09-06** (`auditFrameAllocations`);
      creation-site capture and FinalizationRegistry leak detection need A-4's dev flag
- [ ] **A-5 follow-ups:** ~~AssetManager duplicate-load warning~~ **DONE 2026-09-06**;
      materials + solver
      handles unaccounted (§83 names "GPU and solver resources");
      ~~`RenderTarget.byteLength` hardcodes DEPTH_COMPONENT16 (2 B/texel) — must move
      with §67's DEPTH24_STENCIL8 and float formats~~ **DONE 2026-09-06**
- [ ] **A-1 follow-ups:** (a) `physicsStepTime`/`contacts`/`activeBodies` wiring
      belongs to the packet that gives `Application` a physics world (A-6);
      (c) `gpuFrameTime` waits on `RendererCapabilities` growing §62's timestamp-query
      field; (d) **A-4's `__FOUR_DEV__` define should drop the §84 path from production
      bundles** — now the practical blocker: ui-demo is at **30.96/31 kB (~40 B
      headroom)** after A-5; Application's unconditional stats references cost ~0.4 kB gzip per
      example and ui-demo is at 29.68/30 kB (0.32 kB headroom); (e) `WorldTransformStats`
      (visited/recomputed) is computed every frame and unexposed — deliberately, §84
      does not name it

- [x] **A-12 cheap tier DONE 2026-08-07:** `Toggle`, `Checkbox`, `RadioButton`,
      `Slider`, `ProgressIndicator`, `ImageWidget` — nine of §73's sixteen now ship.
      Follow-ups now recorded per blocker: menu/tooltip need a widget-reachable §9
      update hook; list/virtual list/scroll view need §74 overflow + §67 clipping; text
      input needs §56 (S-6); embedded viewport needs §48; slider drag-past-the-track
      needs §71's analytic drag plane
- [x] **R-4 DONE 2026-08-07:** `RenderTarget` (@four/render) + `RenderTargetCache`
      (@four/render-webgl), `Renderer.render(..., target?)`; render-to-texture through
      the untouched `MaterialTexture` seam; no-target frames issue zero framebuffer
      calls (byte-identical 449-call proof). **R-5 (§63 graph) and R-6 (§70 post-FX)
      now unblocked.** Follow-ups: `Viewport.renderTarget` (needs @four/scene),
      `readPixels` + `Rectangle2` in @four/math (§92 first consumer), stencil (R-7),
      MRT/multisample/float formats, samplable depth (§69)

### Gap-closure wave 2 (2026-08-07) — in progress

- [x] **A-23 DONE 2026-08-07** (§96): asset `maximumBytes`/`timeoutSeconds`,
      `decodeSceneDocument`/`decodeReplayRecording` over `parseUntrustedJson`
      (text-length + iterative depth limits), `UNTRUSTED_INPUT_REJECTED`, the
      security guide, and the CSP grep test
- [x] **A-18 abort half DONE 2026-08-09** (§76): `load(url, loader, { signal })` over a
      structural `AbortSignalLike`, refcounted (last waiter's abort abandons the load),
      `AssetManagerOptions.abortController` + `canAbortTransport` for transport-level
      abort, which the §96 deadline now uses too. The generic `FetchLike<TSignal>`
      design recorded on 2026-08-07 was built as recorded; the variance trap it did not
      foresee (a `TSignal` field breaks `AssetManager<AbortSignal>` → `AssetManager`) is
      solved by erasing the parameter at the constructor, and both properties are
      compile-time assertions in `tests/integration/asset-abort.test.ts`
- [x] **A-18 remainder:** DONE 2026-09-06 — `onProgress`, `stream()`,
      `loadWithDependencies` / `loadGraph`, injected `workerFactory` decode,
      injected `watch`. Content hashing already shipped 2026-08-21.
- [x] **A-16 remainder (manifest half):** DONE 2026-09-06 —
      `preloadManifestIntoCatalog` in `@four/four` walks a manifest, loads each
      key, and returns `resourceCatalog(...)`. `get(key)` stays synchronous.
      `tests/integration/texture-manifest.test.ts` uses the helper; the
      hand-rolled walk remains as a lower-level proof.
- [ ] **A-19 remainder:** renderer-side §77 only (`R-30b`: cube/array/3D,
      compressed containers, video). §78 glTF/GLB shipped 2026-08-29 at the
      glTF 2.0-core tier; its staged residue lives with other rows: morph
      targets wait on the GPU morph path (RFC 0003 staging), CUBICSPLINE waits
      on a squad/tangent decision in `@four/animation`, and the four
      unsampleable material texture slots (`ignoredTextures`) wait on the
      multi-texture-unit widening `gl-program.ts` records (R-13 follow-up) —
      metallic-roughness landed 2026-09-06; normal/occlusion/emissive remain.
      The loader parses them already and widens without a format change.
- [ ] **§96 residue:** decompression limits — **half done 2026-08-21**: `createTextureLoader` enforces an absolute decoded-size bound and an expansion-ratio bound (pre-decode with a `probe`, post-decode without). Still open for gzip/Draco/Basis when they land, and for platform decoders that cannot be pre-bounded at all; shader trust boundary still open (RFC 0001's, not A-3's — shading is a graph of
      closed operators and a new operator is out of scope in both RFCs). **Plugin trust
      boundary discharged 2026-08-28 with A-3**: a plugin is a value, never a name from a
      document; enforced by `tests/integration/plugin-boundary.test.ts`; explicitly not a
      sandbox. Guide row moved absent → partial
- [x] **Regenerate `docs/Architecture/` graph artifacts** (`pnpm graph`) — dependency
      graph + export surfaces are stale for the wave-2 exports (new input/ui/geometry/
      materials/assets/core/serialization/diagnostics surface)

- [x] **R-19 + R-20 DONE 2026-08-07** (render-tier keystones): `BufferGeometry.uvs`/
      `.colors`, `UnlitMaterial.map`/`.vertexColors`, `LitMaterial.map`, nine 3D
      primitives. **R-35 is now unblocked** (data path + vertexColors exist; what's left
      is wiring `DebugDrawBuffer`'s 7-float layout into a `BufferGeometry` — a
      `@four/diagnostics` packet). R-9/R-13/R-22/R-30/R-32 lose their R-19 dependency
- [ ] **R-19/R-20 follow-ups:** §52 tessellation module (lifts the concave-extrude
      restriction); §55 atlas packet (retires the sprite `quad` uniform with authored
      uvs); qualify `docs/AUDIT-120.md`'s "basic 3D meshes: shipped" row honestly
- [x] **Flaky gate (pre-existing, confirmed at baseline 2026-08-07):**
      DONE 2026-09-06 — RECOVER / ANIMATED / RAGDOLL now watch `data-chain-y`
      until span/floor; smoothness samples on virtual-frame parity. The
      original RECOVER isolation flake was the same sampling strategy.

      **Widened 2026-09-06: it is the file's sampling strategy, not one test.** A CI run
      failed two *different* tests in the same file — "ANIMATED" (`:836`) and "RAGDOLL"
      (`:907`) — and both failed on **sample counts**, not on physics:

      | assertion | expected | got |
      | --- | --- | --- |
      | `bandDeltas.length` | `>= 8` | 7 |
      | `samples.length` | `> 10` | 8 |

      The run was simply slower: **101 passed in 8.1 min**, against **103 passed in
      6.8 min** on the last green run — the same suite, 19% slower, on a different
      runner. A test that samples over wall-clock and then asserts it collected enough
      samples is asserting the runner's throughput, which is not what §110 is about.
      The fix is to make the sampling bounded by *simulation* progress rather than
      elapsed real time, or to sample until the count is met with a generous deadline —
      not to widen the threshold, which would just move the cliff.

- [x] **A-26 DONE 2026-08-07.** `docs/COMPATIBILITY.md` (§90's five tables) +
      `tools/generate-compatibility.mjs` (solver-adapter block generated from live
      capability declarations; `--check` detects drift)
- [x] **A-26 follow-up done 2026-08-07:** `check-compat` root script + ci.yml step wired
      once A-25's agent freed those files; `tools/README.md` documents the three new tools
- [x] **A-26 follow-up:** extend the generated block to renderer backends once
      `RendererCapabilities` grows past 2 fields — DONE 2026-09-06. Live table
      from constructed `NullRenderer` / `WebglRenderer` / `WebgpuRenderer`
      (pre-`initialize`; device-derived floors captioned). `--check` covers both
      blocks.
- [x] **A-25 machinery DONE 2026-08-07** (publish itself stays owner-gated): Changesets
      config, `apply-publish-names.mjs` (+tests; rewrites emitted code, not just
      manifests), `release.yml` reusing ci.yml via `workflow_call`, `docs.yml` Pages
      deploy, honest `website/`
- [x] **A-25 owner decisions before first publish:** (1) DONE 2026-09-06 —
      publish the reserved stubs as real 0.x packages (umbrella keeps the
      deps). (2) `NPM_TOKEN` remains an owner secret. (3) Pages already
      enabled.
- [x] **A-25 remainder:** guides hosted on Pages 2026-09-06
      (`tools/render-guides.mjs` → `/guides/`). Demos section on
      `website/index.html`. `NPM_TOKEN` still owner-gated.
- [x] **Closure-diff review findings — 24 of 25 fixed 2026-08-07** (adversarial pass over
      commits 93cda8d, ab13840, fe8eb6f, c843e2d, b48f053): KinematicController
      serializer + mechanical registry-completeness test, physics teardown O(N·M) →
      one destroyBody + per-body collider ids, keyboard wrap:false trap, Button
      preventDefault-only-when-consumed, pointer re-entrancy, KeyboardInput dispose
      guard, resolution validation, reserveNodeId saturation, loud inertiaTensor
      refusal, fabricated-§61-quote and lifecycle-count doc corrections, plus the
      simplification set (#massAuthored, no-op warn guards, scratch allocation,
      capture-key type pairing)
- [x] **Review findings — ALL 25 closed 2026-08-07:** the render-tier set landed
      (per-renderer `glState` + try/finally, validated `opacity`/`blendMode` accessors,
      restoreGlState coherence, dead-fallback cleanup) and F7 landed
      (`LATEST_REPLAY_FORMAT_VERSION`/`MINIMUM_REPLAY_FORMAT_VERSION` with the old name
      as a deprecated alias; document bytes proven unchanged)

- [x] **A-10 DONE 2026-08-07.** `@four/input` gains `KeyboardInput` over a duck-typed
      `KeySurface`, `SceneKeyEvent` with `preventDefault()`, `dispatchKeyEvent`, and the
      shared three-phase `propagation.ts`. Remaining input sources (wheel, gamepad, XR)
      plus `keypress` and focus/blur-as-input-events are recorded in
      `packages/input/README.md`, not here
- [x] **A-13 PARTIAL** — DONE 2026-09-06 — `installAccessibilityMirror` (opt-in,
      duck-typed `DocumentLike`): role/label/disabled/valuenow, high contrast,
      fontScale, reducedMotion option. Keyboard traversal already shipped.

### Gap-closure wave 1 (2026-08-06) — follow-ups left open

Closed this wave, with tests: `A-7` (`Application.resize`), `A-9` (`PointerInput` dead-pointer
leak + `pointercancel`), `A-15` (unregistered components no longer dropped on save), `A-17`
(restored ids reserve against the counter; duplicate-id refusal), `A-14`/`PH-17` **partially**
(`MOTION_COMPONENT_SERIALIZER`, `registerSceneNodeTypes()`/`registerUISerializers()`), `PH-6`
(§34 `worldConfiguration`). What they left behind:

- [x] **PH-17 remainder — done 2026-08-06.** `@four/physics` exports
      `RIGID_BODY_SERIALIZER` / `COLLIDER_SERIALIZER` (plus `serializeCollisionShape` /
      `deserializeCollisionShape` and the three document types), typed against the
      `ComponentSerializerShape` `@four/motion` declares — imported over the existing
      `physics → motion` edge, so there is one transcription in the repo and no new §3.1
      edge. Registered by the umbrella's new `registerPhysicsSerializers()`, which
      `registerSceneNodeTypes()` calls; a physics scene now saves with no
      `{ unknownComponents: "skip" }`. `tests/integration/helpers/roundtrip-scenarios.ts`
      lost its WP-11.5 duplicates and calls the shipped registration, and
      `scene-roundtrip.test.ts` proves a contact-free save reloads bit-identically through
      `registerSceneNodeTypes()` alone. **One behaviour changed:** §25's friction /
      restitution / density are written **as authored** rather than as the effective values
      the reference wrote, so the fallback chain re-resolves on load instead of pinning
      today's defaults into every document (a `PhysicsMaterial` round-trips by value, not
      by identity — resource-keyed sharing is a §79 resource concern)
- [x] **PH-17 doc follow-up — done by 2026-08-07:** the serializer references in
      `docs/Architecture/API.md` and `docs/guides/digital-twin.md` were updated in an
      earlier pass; the gap-doc banner was fixed by the 2026-08-07 branch merge; API.md's
      adjacent stale "silently unsaved" claim corrected 2026-08-07 (A-15 made it throw)
- [x] **A-9 remainder DONE 2026-08-09:** `pointerType` runs end to end — platform
      `string` in, `PointerDeviceType` (`"mouse" | "pen" | "touch"`) on every
      `ScenePointerEvent`, unknown values reported as absent rather than refused. A
      mouse now keeps its hover across its own release (a `@four/ui` button no longer
      un-highlights when clicked — `tests/integration/pointer-type.test.ts`);
      `pointercancel`, pen, and device-less sources keep the old teardown. Bounded:
      10 000 mouse clicks leave `trackedPointerCount` at 1
- [x] **A-16 remainder — done 2026-08-07:** `Renderable`, `Sprite`, both cameras and
      `DirectionalLight` have §79 node-type pairs (`registerRenderSerializers`, chained
      by `composeSceneNodeTypes`). Geometry/material are **references** resolved through
      the injected `SceneResourceCatalog` seam; §79's manifest (key → URL + content
      hash) remains staged behind A-18 content hashing. Still open under A-16: the §80
      `.four` binary package format and the manifest document itself
- [x] **A-6 remainder — re-read 2026-08-30.** `app.assets`, `app.stats`
      (`FrameStats`; this is §45's diagnostics surface), `app.physics`,
      `autoResize`, and `reducedMotion` all shipped. `app.input` is
      **refused by design** (`application.ts` header: §45 names "input
      routing" in prose, lists no input option, and `@four/input` has two
      coequal subsystems — electing one to _be_ `app.input` would invent
      an API).

### Backlog additions (doc-truth sweep, 2026-08-05)

- [x] **The §93/§118–119 examples — truth as of 2026-08-30.** Ten runnable
      `examples/**/main.ts`: both flagships, `first-2d-scene`, `first-3d-scene`,
      `physics-playground`, `blending`, `particles-demo`, `ui-demo`,
      `mechanism`, `character-controller`. Remaining: owner retire-or-write
      on the three unused §93 directory names (`first-animated-scene`,
      `first-physics-scene`, `mixed-scene`) whose content lives in stand-ins.
- [x] **§65 sprite/glyph batching — opt-in shipped 2026-08-09 (R-9).**
      `renderer.batching = createGlBatching()`; default remains one draw per
      sprite (`docs/AUDIT-120.md` sprites row). Glyphs batch as consecutive
      same-material `Text` (R-28). Residue: grouping labels that do not share
      a material (atlas grouping, R-9's own remainder).
- [x] Extend `tools/check-docs.mjs` as new mechanically-checkable claims appear
      — DONE 2026-09-06: pins 24 packages, `tests/README.md` suite counts,
      and the AUDIT-120 43-item census. Further claims still welcome if they
      stay decidable by reading files.

### Backlog additions (Phase 10, 2026-08-02)

- [x] Debug overlay render wiring — **done 2026-08-07** (R-35 closed:
      `debugDrawStreams`/`applyDebugDrawStreams` + R-19's vertex colors; one draw call,
      demonstrated in `tests/integration/debug-overlay-render.test.ts`)

### Backlog additions (Phase 9, 2026-08-02)

- [x] §27 field batching (each polymorphic sample() costs ~5.3 ms/100k — a batch API
      is the scoped fix; benchmark attribution in benchmarks/results/) —
      DONE 2026-09-06: `ForceField.sampleAll` + `ForceFieldSystem` uses it when present.
- [x] Particle trails (position-history ring buffer + ribbon path), multi-stop ramps
      — CPU DONE 2026-09-06; R-32 appearance + GPU radial field +
      `collisions: "depth-buffer"` ground-rest stub DONE 2026-09-06. True
      depth-texture collide-and-kill and GPU snapshots remain.
- [x] spatial-hash neighbors — DONE 2026-09-06 (`SpatialHash` in `@four/motion`, WP-8.2)

### Backlog additions (Phase 8, 2026-08-02)

- [x] Fold steering's private interceptTime into prediction's export (dated note in
      steering.ts) — **interceptTime fold DONE 2026-09-06**; ~~spatial-hash neighbors~~
      **DONE 2026-09-06**; ~~spherical wander~~ **DONE 2026-09-06**;
      ~~CCD/FABRIK~~ **DONE 2026-09-06**; path-planning adapters (RFC);
      robotic joint commands utility (MAY declined — see prediction.ts staging note)
- [x] §111 namespace note — **already satisfied by spec revision 1.7** (§111 cites
      `Four.motion.PIDController` via §97a); this entry was the stale artifact

### Backlog additions (Phase 7, 2026-08-02)

- [x] Rotational root motion (staged 2026-08-02 — quaternion track throws)
      — DONE 2026-09-06: a quaternion `rootMotion` track differences
      `conjugate(previous) * sampled` and multiplies onto
      `transform.rotation`. Loops compose the same way translation adds.
- [x] PoseTarget scale channel (P7-1 MVP cut — needs a decision on what scale blends
      against; solver bodies have no scale) — DONE 2026-09-06: physical side
      is identity `(1, 1, 1)`. `copyFrom` copies scale; §79 omits identity.
- [x] Capability-table note: Rapier derives kinematic velocity itself, so
      inheritVelocityFrom is nearly a no-op there — DONE 2026-09-06, documented
      in `docs/COMPATIBILITY.md` deviations. Other solvers still get a column
      when they land.

### Backlog additions (Phase 6 exit, 2026-08-02)

- [x] §28 motor cap: DONE 2026-09-06 — Rapier force-based gain named in
      `docs/COMPATIBILITY.md`; Box2D column when a capping adapter arrives.

### Backlog additions (Phase 5, 2026-08-01)

- [x] **Replace the transcribed Rapier type subset in `physics-rapier/src/init.ts`**
      DONE 2026-09-06 — package tsconfig uses `moduleResolution: bundler`;
      init re-exports upstream `@dimforge/rapier*` types instead of the
      ~1200-line transcription.
- [ ] §24 remaining shapes (polyline/chain/cylinder/cone/convex hull/trimesh/
      heightfield/compound) — staged out by P5-6, widen in a later packet
- [x] Document SolverBodyAccess in the §90/§102 compatibility material — DONE
      2026-09-06 for Rapier (required engine surface beyond §37). Other
      adapters still get a column when they land.

### Chores (Phase 4 exit-verifier notes, 2026-08-01)

- [x] Coverage thresholds are package-level; consider per-file granularity so a weak file
      can't hide behind a strong package average — DONE 2026-09-06: 80%
      lines/functions/statements per file via `tools/per-file-coverage-floor.cjs`;
      package gate stays ≥95%. Weakest real file is `physics-rapier/src/init.ts`
      at 86.95%. Branches stay package-only (`alloc-counter.ts` is 75% on the
      wrap).
- [x] Unlit materials render with GL_BLEND off (WP-4.7 finding) — DONE
      2026-09-06: unlit enables `SRC_ALPHA` / `ONE_MINUS_SRC_ALPHA` when
      `color[3] !== 1` or `transparent === true`; opaque unlit stays
      `GL_BLEND` off. §60a color management remains a separate follow-up.

### Backlog additions (Phase 3 exit findings)

- [x] §45 renderer-string ("auto") selection — **done 2026-08-07** (A-8/R-2/PH-19
      closure; the 2026-08-01 instance-injection deferral is retired, not reversed)

## Backlog

### Later milestones (decided 2026-07-29)

- [x] Deploy the public interactive demo — Pages already deploys examples
      (2026-09-05); 2026-09-06 added a Demos section and `--base` docs.
      `NPM_TOKEN` / a custom domain remain owner steps.
- [x] §55 frame regions + §65 sprite batching — `Sprite.frame` already
      shipped; `groupSpritesByTexture` consecutive-run helper DONE 2026-09-06.
      Atlas *packing* of distinct textures remains.
- [x] Before §56 full text shaping: RFC the shaping engine (HarfBuzz-wasm vs native)
      — **Proposed 2026-09-06** (`docs/rfcs/0008-text-shaping-engine.md`). Owner
      decision pending; default stays the identity pen walk.
- [ ] First publish (§94 0.1): Changesets release workflow + apply the
      `@danielsimonjr/fourjs` publish-name mapping (spec §98, rev 1.6)

### Documentation

- [x] Optionally regenerate the specification PDF — `tools/render-spec-pdf.mjs`
      added 2026-09-06 (no-ops without pandoc). Does not replace the archived
      pre-1.0 PDF.

## Done

- [x] 2026-09-06 — **Open-TODO subagent pass (fourth landing).** Parallel
      packets: Rapier 0.20; `NodeSpace` + local-plane; PH-11c push; §40 units;
      live velocity writes; CameraShake / spherical wander / CCD+FABRIK;
      PH-9 blend trees/layers/events; §81 tokens; A-13 a11y mirror; A-18
      remainder; R-32 appearance; Boolean + SVG document; R-8/R-6/R-30c
      render follow-ups; angle operator + conic + CSS light colors; Pages
      guides/demos; SolverBodyAccess + motor-cap docs. Still owner-gated:
      typedoc/TS 7, `NPM_TOKEN`, RFC §6 residues, R-33 hardware, full
      lighting/shadow remainder.

- [x] 2026-09-06 — **Smoothness parity waiter (#72).** `waitForVirtualFrameParity`
      polls `__fourVirtualFrames` through `page.evaluate`, not
      `waitForFunction` — Playwright's default rAF polling deadlocks against
      the test's overridden `requestAnimationFrame` and ate the 120 s CI
      timeout on `b55a8c1`. Size budgets after #70: first-3d 38 → 38.5 kB
      (38.18), particles-demo 36.5 → 37 kB (36.77), ui-demo 45 → 45.5 kB
      (45.27).

- [x] 2026-09-06 — **WebGL F13 / metal-roughness restore.** Unlit texture bind
      and `setFeatures` run before `unlitColorBlends` reads `color`, so a
      throwing accessor still restores the borrowed unit and program-lifetime
      flags. Metal-roughness unit 2 skips redundant `activeTexture(TEXTURE2)`
      when that unit is already active.

- [x] 2026-09-06 — **Open-TODO subagent pass (third landing).** Windows browser
      gate (`animation.spec` simulation-bound sampling; 180 s Windows timeout);
      `buildRenderList` optimization; size budgets bumped; Rapier upstream
      types; `app.stats.contacts`; A-4/A-5 partial (validation catalogue,
      format-aware `RenderTarget.byteLength`); CPU particle trails +
      multi-stop ramps; stale §24/§12 entries retired.

- [x] 2026-09-06 — **§83 dev warnings (A-5 remainder, #73).** `warnDisposedInUse`,
      `rejectStalePhysicsHandle`, `auditFrameAllocations`, detached-node listener
      warn on `Node.#detach`. Leaked-resource / FinalizationRegistry tier still open.

- [x] 2026-09-06 — **RenderTarget.byteLength (A-5, #73).** `render-target-bytes.ts`
      for depth/stencil/samplable-depth accounting.

- [x] 2026-09-06 — **SpatialHash (WP-8.2, #73).** Uniform-grid neighbours in
      `@four/motion`.

- [x] 2026-09-06 — **Auto-selection §62 (#73).** Real WebGPU rung in integration tests.

- [x] 2026-09-06 — **Camera rigs docs (#73).** Trackball + fly snippet; shake open.

- [x] 2026-09-06 — **Platform and repository hygiene.** `js-yaml >=5` ignored
      (#68 — vendored graph tool needs default export). ESLint ignores
      `.dogfood/**` so local dogfood runs do not break `bun run lint`. Dynamic
      body with no collider/`inertiaTensor` warns once at first step (§23).
      Identical `registerRapierSolver()` re-registration is a no-op (§37).
      glTF suite tests pass Windows paths as URLs, not native paths. `FollowRig`
      skips non-positive `deltaSeconds`. `KeyboardInput` rejects malformed
      options with a `FourError`. `new Node()` left to TypeScript (unconditional
      guard over §86 budget). `transformAuthority` default stays `"manual"` (§42
      warn is sufficient). Deleted `windowsFullChromium()` (never matched);
      `CHROMIUM_BINARIES` lists Windows layouts.

- [x] 2026-09-06 — **§83 duplicate asset loads.** `AssetManager.load` of a
      settled `(url, loader)` slot warns once; in-flight coalescing does
      not.

- [x] 2026-09-06 — **§27 field torque + field-driven waking.** Optional
      `ForceField.sampleTorque` (N·m). Per-entry `wakesSleepingBodies`
      visits sleepers without letting a sibling gravity field defeat §32.
      A-4 step 4: `warnAuthorityConflict` stays `console.warn` (§33 bars
      `devWarnOnce` in `@four/scene`; reverted on `main` 2026-09-06).

- [x] 2026-09-06 — **PoseTarget scale channel.** Physical side of the §19
      blend is identity `(1, 1, 1)` — the only scale a rigid body has.
      `copyFrom` copies `transform.scale`. §79 omits identity so old
      documents stay identical.

- [x] 2026-09-06 — **Rotational root motion.** A quaternion `rootMotion`
      track extracts `conjugate(previous) * sampled` and multiplies it onto
      the target's `transform.rotation`. Translation path unchanged.

- [x] 2026-09-06 — **§67 scissor clipping.** `Renderable.scissor` snapshots onto
      the render item; WebGL and WebGPU intersect with the view rect and
      restore it after the draw. Batcher breaks on rectangle change.
      Serialization omits the key when null.

- [x] 2026-09-06 — **Open-TODO pass (second landing).** Browser-gate flakes:
      smoothness samples on virtual-frame parity; blending RECOVER/ANIMATED/
      RAGDOLL watch `data-chain-y` instead of screenshot throughput. README
      snippet runs in `tests/browser/readme.spec.ts`. `check-docs` pins
      package / suite / AUDIT-120 counts. `StandardMaterial.metalRoughnessMap`
      on WebGL unit 2; unlit alpha enables `GL_BLEND`.

- [x] 2026-09-06 — **Open-TODO pass (first landing).** Windows Chromium binary
      layouts + lazy umbrella barrel imports + slower-runner Vitest/Playwright
      timeouts; Dependabot `bun.lock` regeneration workflow; generated §62
      renderer-backend compatibility table (A-26 follow-up); Rapier
      `inheritVelocityFrom` deviation noted; §42 warn-spy isolation
      (unblocks #62 / eslint 10). Remaining open items are still in
      flight or owner-gated — see Now.

- **2026-09-05 — RFC 0006 TypeScript-on-Bun toolchain.** Bun workspace; spec 1.14; Vitest/`tsc -b` retained.

- [x] 2026-09-04 — **WebGL geometry-buffer reuse** (§53, §64, §83).
      Preserve handles for unchanged layouts, keep full data-store replacement,
      reject acquisition after disposal, and centralize attribute setup/cleanup.
      Add 76 unit regressions, two browser pixel comparisons and a registered
      benchmark. Public API and size limits unchanged; WebGPU lifetime handling
      and hardware frame-time profiling are outside this patch.

- [x] 2026-08-30 — **Unblocked-defect sanitization.** Sprite §79 flags via
      `SpriteOptions extends RenderableOptions`; `INVALID_RENDER_GRAPH` + §89
      list (spec 1.13); PH-22n dropped-time `devWarnOnce`; nested example-path
      coverage; shape 32-bit timeout; Rapier chase in `camera-rigs.test.ts`;
      docs truth (WebGPU not a stub; camera rigs shipped; A-6/examples/§65
      tracker rows); `check-docs` scans package READMEs + Architecture prose.
      Per-item scissor, RFC residue, R-32/R-33, PH-11c remain owner-gated.
- [x] 2026-08-04 — **Lighting MVP shipped** (§120's last unshipped bullet; owner-directed,
      minimal tier): `DirectionalLight` node + `Scene.ambientLight` in @four/scene (§68),
      `LitMaterial` + `kind` discriminants in @four/materials (§57), optional `normals`
      vertex attribute in @four/geometry (box now 24 verts with per-face normals, plane
      +Z; 2D shapes stay unlit), `"lit"` render-item kind + duck-typed `collectSceneLights`
      in @four/render, `LitProgram` (Lambert + ambient) + normal-stream upload in
      @four/render-webgl. Unlit path untouched — every browser spec and pixel golden
      passes; merged tree: 3,077 unit + 174 suite + 38 browser/visual tests, coverage
      ≥95% everywhere, TypeDoc 0 warnings, §86 gate 33.28/150 kB. Wider §68/§69/§59/§60a scope staged
      with dated notes (see backlog and docs/AUDIT-120.md S-5)
- [x] 2026-08-04 — **Zero-findings sweep** (owner-directed): consolidated all 5
      baselined TRUE_DUPLICATE names (SeededRandom → core, JsonValue/cloneJsonValue →
      core with the **proto** strengthening, DEFAULT_GRAVITY_Y → core, ColorRGBA →
      math; includes the Phase 9 "hoist SeededRandom" item), broke both type-only
      import cycles (AuthorityNode structural seam; RigidBodyEventMap declaration
      merging), un-exported physics-rapier's 21 in-file-only transcribed interfaces;
      every docs/Architecture report now 0, duplicate baseline empty, all gates green
- [x] 2026-08-02 — **Phase 11 complete — THE PLAN IS DONE** (§113a): 5 packets, final
      exit GREEN — serialization (byte-identical round trips + the proven §79/§34
      boundary), assets, UI MVP, benchmark harness with committed records, the §120
      audit (42/43 shipped-or-MVP, lighting staged); whole-plan audit clean; final
      totals 2,971 unit + 172 suite + 32 browser tests, coverage ≥95% everywhere
- [x] 2026-08-02 — **Phase 10 complete** (§113): 5 packets, exit GREEN zero defects —
      §34 replay format with canonical serialization, ReplayRecorder/ReplayPlayer over
      duck-typed targets, debug-draw providers with honestly-staged seam gaps, the
      §113 exit proven end-to-end on Rapier (bit-identical replay, snapshot-seek,
      frame stepping, slow motion); 2,766 unit + 159 suite + 32 browser tests
- [x] 2026-08-02 — **Phase 9 complete** (§112): 5 packets — SoA particle core, §27
      fields, one-draw-call instanced rendering, ParticleSystem, 100k benchmark
      (16.5 ms/step recorded honestly on CI hardware with per-field cost attribution),
      phase9 determinism golden, particles-demo (fifth example site); 2,585 unit +
      138 suite + 32 browser tests
- [x] 2026-08-02 — **Phase 8 complete** (§111): 5 packets + 1 doc fix — PID/spring-
      damper/steering/RNG/prediction/IK in @four/motion, all six modules at 100%
      coverage with genuinely independent analytic oracles; PID closes a real Rapier
      hinge loop to exact setpoint; every declined §111 component staged with a dated
      note; 2,359 unit + 131 suite + 27 browser tests
- [x] 2026-08-02 — **Phase 7 complete** (§110): 8 packets + 1 fix, exit GREEN zero
      defects — "blended" authority live with the §19 pipeline inside PhysicsWorld,
      in-place retype + velocity inheritance, root-motion MVP, mode-cycle example;
      both control switches measured below the animation's own per-step motion;
      2,176 unit + 124 suite + 27 browser tests
- [x] 2026-08-02 — **Phase 6 complete** (§109): 7 packets + 2 fixes — §28 joint tier
      shipped honestly against measured Rapier 0.19.3 behavior (breakage via the engine
      seam, refused where solvers can't report reactions; spherical without fake cone
      limits), slider-crank mechanism demo, jointed determinism golden, mechanism
      browser spec; 1,998 unit + 95 suite + 23 browser tests; §109 stability proven
      over 3600 steps with drift ≤1.3e-5 m
- [x] 2026-08-01 — **Phase 5 complete** (§108): 9 packets + 2 fixes, exit GREEN zero
      defects — full physics API over the §37 adapter contract, Rapier 2D+3D on pinned
      -compat@0.19.3 wasm, density-derived mass end-to-end, mixed 2D/3D proven by
      integration tests, the physics-playground demo with browser-pixel evidence, and a
      600-step cross-process determinism golden; 1,827 unit + 60 suite + 19 browser
      tests; physics 100% coverage
- [x] 2026-08-01 — **Phase 4 complete** (§107): 10 packets, exit GREEN zero defects —
      numeric/vector/quaternion/color/transform properties all animatable, proven at
      unit, determinism-golden (cross-process, marker steps pinned), and browser-pixel
      layers; 1,363 unit + 26 suite + 15 browser tests; animation package 100% coverage;
      coverage gate now tooling-enforced repo-wide; example 30.19 kB gzip
- [x] 2026-08-01 — **Phase 3a complete** (§106a): 7 packets, exit GREEN — pointer events,
      picking, dragging, sprites, and text labels proven working together in the mixed
      2D/3D example via real Chromium input + framebuffer assertions; 1,015 unit + 11
      browser tests, coverage 100% on input/text/render/materials (render-webgl 99.42%),
      demo-ready static build at 21.46 kB gzip
- [x] 2026-08-01 — **Phase 3 complete** (§106): 9 packets, browser-verified rendering
      (SwiftShader gate caught a real rAF defect), interpolated draws proven at alpha 0.5,
      example at 14.88 kB gzip, coverage ≥95% everywhere
- [x] 2026-08-01 — **Phase 2 complete** (§105): 7 packets, repo at 545 tests, coverage
      ≥95% every package, demos verified against independently derived closed forms,
      cross-process determinism vs goldens
- [x] 2026-08-01 — **Phase 1 complete** (§104): 14 packets, 405 tests, coverage ≥95% every
      package, deterministic headless stepping proven in-process + fresh-process against
      committed golden digests
- [x] 2026-07-31 — **Phase 0 complete** (§103): all 15 packets landed via Opus workers,
      independent exit verifier GREEN with zero defects — 24-package monorepo installs,
      compiles (cold+warm), tests, lints; docs/example/size/CI gates live
- [x] 2026-07-29 — npm naming decided (owner): publish under `@danielsimonjr/fourjs` /
      `@danielsimonjr/fourjs-<name>` (spec revision 1.6); no org claim or dispute needed
- [x] 2026-07-29 — Stress-test the implementation plan (5 passes: Haiku dry-run,
      executability, spec fidelity, Sonnet orchestration, Opus design; ~85 findings) and
      apply all findings as plan revision 2 + spec revision 1.4 (§98 Application → `four`)
- [x] 2026-07-29 — Write `docs/plans/IMPLEMENTATION_PLAN.md` (Phase 0 deliverable, §103): subagent-
      driven work packets WP-N.M with [H]/[S] model tiers, mechanical Done-checks,
      Phase 0–2 fully decomposed, Phases 3–10 rolling-wave; §98 directory tree verified
      complete (already built 2026-07-28)
- [x] 2026-07-29 — Confirm the §86 payload budget (minimal 2D app ≤ 150 kB gzip): owner
      confirmed; provisional marker removed (spec revision 1.2)
- [x] 2026-07-28 — Disposition the specification review: all 35 items (R-1…R-35) accepted
      and applied as `SPECIFICATION.md` revision 1.1 (lettered sections 6a/6b/7a/7b/60a,
      Appendices A–B; §1–120 numbering unchanged)
- [x] 2026-07-28 — Typeset `SPECIFICATION.md`: 96 fenced code/diagram blocks (with restored
      indentation), Markdown bullet lists, §86 performance table, parts TOC; word-for-word
      equivalence machine-verified
- [x] 2026-07-28 — Build out the directory tree from the spec: per-package `README.md` +
      `src/`/`tests/` for all 24 packages; `examples/` (§93 + flagship §118–119); `tests/`
      categories (§92); READMEs for `benchmarks/`, `tools/`, `website/`
- [x] 2026-07-28 — Move original spec PDF to `docs/archive/`; update all path references
- [x] 2026-07-28 — Correct `SPECIFICATION.md` (E-1/E-2/E-3 resolved: parts I–XIII, sections
      1–120, solver-package list fixed, extraction artifacts repaired); rewrite `ERRATA.md`
      as a correction log with a PDF→Markdown numbering map
- [x] 2026-07-28 — Add `AGENTS.md` (detailed agent orientation)
- [x] 2026-07-28 — Add `CLAUDE.md` (Claude Code guidance)
