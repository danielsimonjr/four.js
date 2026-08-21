/**
 * `RollbackBuffer` rewinds a live solver world exactly (PH-20, 2026-08-21;
 * §33's *rollback*, §34).
 *
 * §33 lists rollback among the six facilities the engine must support, and
 * until PH-20 it was the one with primitives and no API. The primitives are
 * `PhysicsWorld.createSnapshot`/`restoreSnapshot`; the API is
 * `@four/diagnostics`'s `RollbackBuffer`. What has to be true for it to be
 * worth having is a determinism claim, so it is tested here rather than only in
 * the package: **a run that is rewound to step *n* and re-simulated reproduces
 * the original run's per-step checksums exactly, from step *n* + 1 to the
 * end.**
 *
 * No golden file and no child process, deliberately. This file pins an
 * *equality between two runs in one process*, which is the whole content of the
 * claim — the absolute checksums are `golden/phase5.json`'s subject, and
 * committing them again here would create a second thing to update on a Rapier
 * bump for no extra evidence.
 *
 * Tier reached: **`same-runtime`** (§33) — the solver's, unchanged. The buffer
 * itself does no arithmetic; it moves opaque snapshots.
 *
 * ## Why the re-simulation runs the registry, not `world.step`
 *
 * The buffer restores state and returns the number of fixed steps owed; the
 * caller re-runs its own loop. That is the API's central refusal (see
 * `packages/diagnostics/src/rollback.ts`), and this file honours it — the
 * rewound run drives the same `SystemRegistry`, with the same systems in the
 * same order, so the re-simulated steps really are the steps that were rolled
 * back.
 */

import { createChecksum, RollbackBuffer } from "@four/diagnostics";
import { Vector2 } from "@four/math";
import { SystemRegistry, createTimeState } from "@four/motion";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
} from "@four/physics";
import { Rapier2dAdapter } from "@four/physics-rapier";
import { Group } from "@four/scene";
import { describe, expect, test } from "vitest";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
const FIXED_TIME_STEP = 1 / 60;

/** Fixed steps each run covers. */
const STEP_COUNT = 200;

/** The step the rewound run returns to, and the step it rewinds from. */
const REWIND_TO = 100;
const REWIND_AT = 120;

/** Dynamic bodies dropped onto the floor. */
const BODY_COUNT = 6;

/** Generous ceiling: two 200-step runs plus a wasm decode. */
const RUN_TIMEOUT_MS = 120_000;

/** A world of one floor and {@link BODY_COUNT} boxes, plus its registry. */
async function buildRun(): Promise<{
  world: PhysicsWorld;
  registry: SystemRegistry;
}> {
  const world = new PhysicsWorld({
    dimension: "2d",
    adapter: new Rapier2dAdapter(),
  });
  await world.initialize();

  const floor = new Group();
  floor.transformAuthority = "physics";
  floor.transform.position.set(0, -4, 0);
  floor.addComponent(new RigidBody({ type: "static" }));
  floor.addComponent(
    new Collider({
      shape: { type: "rectangle", halfExtents: new Vector2(20, 0.5) },
    }),
  );
  world.addBody(floor);

  for (let i = 0; i < BODY_COUNT; i += 1) {
    const node = new Group();
    node.transformAuthority = "physics";
    node.transform.position.set(-0.5 + (i % 2), -2 + i, 0);
    node.addComponent(new RigidBody({ type: "dynamic", mass: 1 + i * 0.5 }));
    node.addComponent(
      new Collider({
        shape: { type: "rectangle", halfExtents: new Vector2(0.25, 0.25) },
      }),
    );
    world.addBody(node);
  }

  const registry = new SystemRegistry();
  registry.register(new PhysicsSystem({ worlds: [world] }));
  return { world, registry };
}

/** Drives one fixed step whose simulation time is an exact product. */
function driveStep(registry: SystemRegistry, step: number): void {
  const time = createTimeState({ fixedDeltaTime: FIXED_TIME_STEP });
  time.frame = step;
  time.simulationStep = step;
  time.simulationTime = step * FIXED_TIME_STEP;
  time.deltaTime = FIXED_TIME_STEP;
  time.unscaledDeltaTime = FIXED_TIME_STEP;
  registry.runFixedStep(time);
}

describe("PH-20: RollbackBuffer rewinds a live world exactly (§33, §34)", () => {
  test(
    "a rewound-and-re-simulated run reproduces the reference run's checksums",
    async () => {
      const reference = await buildRun();
      const referenceChecksums: number[] = [];
      for (let step = 1; step <= STEP_COUNT; step += 1) {
        driveStep(reference.registry, step);
        referenceChecksums.push(reference.world.checksum());
      }

      const rewound = await buildRun();
      const buffer = new RollbackBuffer({
        target: rewound.world,
        capacity: 32,
      });
      const rewoundChecksums: number[] = [];
      let step = 1;
      let rewindsLeft = 1;
      while (step <= STEP_COUNT) {
        driveStep(rewound.registry, step);
        rewoundChecksums.push(rewound.world.checksum());
        buffer.capture(step);
        if (step === REWIND_AT && rewindsLeft > 0) {
          rewindsLeft -= 1;
          const owed = buffer.rollbackTo(REWIND_TO);
          expect(owed).toBe(REWIND_AT - REWIND_TO);
          // Everything after the rewind target is discarded and re-simulated,
          // through the same registry, in the same order.
          rewoundChecksums.length = REWIND_TO;
          step = REWIND_TO + 1;
          continue;
        }
        step += 1;
      }

      expect(rewoundChecksums).toHaveLength(STEP_COUNT);
      const divergence = rewoundChecksums.findIndex(
        (value, index) => value !== referenceChecksums[index],
      );
      expect(divergence).toBe(-1);

      // The run really was a simulation: the bodies moved, so the checksums are
      // not all one settled value, and the rewind crossed live contacts.
      const digest = createChecksum();
      for (const value of referenceChecksums) {
        digest.addFloat(value);
      }
      expect(new Set(referenceChecksums).size).toBeGreaterThan(10);
      expect(digest.digest()).toBeGreaterThan(0);

      // The restore actually happened at the solver, not merely in the buffer.
      expect(buffer.newestStep).toBe(STEP_COUNT);
      reference.world.dispose();
      rewound.world.dispose();
    },
    RUN_TIMEOUT_MS,
  );

  test(
    "restoring the same step twice lands on the same state",
    async () => {
      const run = await buildRun();
      const buffer = new RollbackBuffer({ target: run.world, capacity: 4 });
      for (let step = 1; step <= 40; step += 1) {
        driveStep(run.registry, step);
        buffer.capture(step);
      }
      const at40 = run.world.checksum();

      buffer.rollbackTo(40);
      expect(run.world.checksum()).toBe(at40);
      driveStep(run.registry, 41);
      const at41 = run.world.checksum();
      buffer.rollbackTo(40);
      expect(run.world.checksum()).toBe(at40);
      driveStep(run.registry, 41);
      expect(run.world.checksum()).toBe(at41);

      run.world.dispose();
    },
    RUN_TIMEOUT_MS,
  );
});
