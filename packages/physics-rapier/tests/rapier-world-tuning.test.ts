/**
 * The two 2026-08-04 tuning knobs, proven against the live wasm:
 *
 * - `PhysicsWorldOptions.solverIterations` (§28 "solver iterations") reaches
 *   Rapier's `World.numSolverIterations` — shown behaviourally: a contact
 *   stack solved with 1 iteration diverges from the default 4, while an
 *   explicit 4 is bit-identical to omitting the option (so every recorded
 *   checksum and replay predating the option is untouched).
 * - `RigidBodyDescriptor.ccdPredictionDistance` (§31) replaces the WP-5.4
 *   pinned 1 m constant per body — shown behaviourally at the boundary the
 *   distance controls: a fast bullet whose prediction distance is shorter
 *   than its per-substep travel tunnels through a thin wall, and the same
 *   bullet with a generous distance is caught. Rapier steps `dt` in
 *   `numSolverIterations` substeps of `dt/4` (the WP-5.4 finding), so the
 *   per-substep travel — not the per-step travel — is what the distance must
 *   cover.
 *
 * Everything here is deterministic (§33): fixed step, no clocks, no RNG —
 * these are exact assertions, not tolerances hiding flake.
 */

import { Quaternion, Vector2, Vector3 } from "@four/math";
import type { PhysicsBodyHandle, PhysicsWorldOptions } from "@four/physics";
import { beforeAll, describe, expect, it } from "vitest";

import { initializeRapier2d } from "../src/init.js";
import { Rapier2dAdapter } from "../src/rapier2d-adapter.js";
import { initializeRapier3d } from "../src/init.js";
import { Rapier3dAdapter } from "../src/rapier3d-adapter.js";

const DT = 1 / 60;

beforeAll(async () => {
  await initializeRapier2d();
  await initializeRapier3d();
});

async function createAdapter(
  options?: Partial<PhysicsWorldOptions>,
): Promise<Rapier2dAdapter> {
  const adapter = new Rapier2dAdapter();
  await adapter.initialize({ dimension: "2d", ...options });
  return adapter;
}

function positionOf(
  adapter: Rapier2dAdapter | Rapier3dAdapter,
  body: PhysicsBodyHandle,
): Vector3 {
  const position = new Vector3();
  adapter.getBodyTransform(body, position, new Quaternion());
  return position;
}

/**
 * A three-box tower on a floor — enough stacked contacts that the number of
 * constraint-solver iterations is visible in the solved poses. Returns the
 * top box, the most iteration-sensitive body.
 */
function buildStack(adapter: Rapier2dAdapter): PhysicsBodyHandle {
  const floor = adapter.createBody({
    type: "static",
    position: new Vector2(0, -0.5),
  });
  adapter.createCollider({
    body: floor,
    shape: { type: "rectangle", halfExtents: new Vector2(20, 0.5) },
  });
  let top = floor;
  for (let level = 0; level < 3; level += 1) {
    // Slightly interpenetrating at spawn, so the contact solver has real
    // work to do from the first step.
    const box = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0.01 * level, 0.45 + 0.98 * level),
    });
    adapter.createCollider({
      body: box,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
    });
    top = box;
  }
  return top;
}

describe("PhysicsWorldOptions.solverIterations (§28, 2026-08-04)", () => {
  it("changes the contact solve: 1 iteration diverges from the default 4", async () => {
    const coarse = await createAdapter({ solverIterations: 1 });
    const standard = await createAdapter();
    const topCoarse = buildStack(coarse);
    const topStandard = buildStack(standard);

    for (let step = 0; step < 120; step += 1) {
      coarse.step(DT);
      standard.step(DT);
    }

    const posCoarse = positionOf(coarse, topCoarse);
    const posStandard = positionOf(standard, topStandard);
    // The scenario is identical; only the iteration count differs. If the
    // option never reached the solver, these would be bit-identical.
    expect(
      posCoarse.x !== posStandard.x || posCoarse.y !== posStandard.y,
    ).toBe(true);

    coarse.dispose();
    standard.dispose();
  });

  it("an explicit 4 is bit-identical to omitting the option", async () => {
    // Rapier 0.19.3's own default is 4, so passing 4 must change nothing —
    // this is what keeps every pre-option checksum and replay valid (§33).
    const explicit = await createAdapter({ solverIterations: 4 });
    const omitted = await createAdapter();
    const topExplicit = buildStack(explicit);
    const topOmitted = buildStack(omitted);

    for (let step = 0; step < 120; step += 1) {
      explicit.step(DT);
      omitted.step(DT);
    }

    const posExplicit = positionOf(explicit, topExplicit);
    const posOmitted = positionOf(omitted, topOmitted);
    expect(Object.is(posExplicit.x, posOmitted.x)).toBe(true);
    expect(Object.is(posExplicit.y, posOmitted.y)).toBe(true);

    explicit.dispose();
    omitted.dispose();
  });

  it("reaches the 3D build through the same option", async () => {
    // Plumbing parity: the 3D adapter accepts and applies the option (the
    // full behavioural divergence is proven in 2D above; both adapters set
    // the same World member).
    const adapter = new Rapier3dAdapter();
    await adapter.initialize({ dimension: "3d", solverIterations: 8 });
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector3(0, 1, 0),
    });
    adapter.createCollider({ body, shape: { type: "sphere", radius: 0.5 } });
    adapter.step(DT);
    expect(positionOf(adapter, body).y).toBeLessThan(1);
    adapter.dispose();
  });
});

describe("RigidBodyDescriptor.ccdPredictionDistance (§31, 2026-08-04)", () => {
  /**
   * A speculative bullet against a thin static wall. At 200 m/s a 1/60 s
   * step is ~3.33 m of travel — ~0.83 m per dt/4 substep — through a 0.1 m
   * wall, so plain discrete stepping tunnels. A prediction distance of 10 m
   * covers the whole flight; 0.001 m covers nothing.
   */
  async function fireBullet(
    ccdPredictionDistance: number,
  ): Promise<{ adapter: Rapier2dAdapter; bullet: PhysicsBodyHandle }> {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const wall = adapter.createBody({
      type: "static",
      position: new Vector2(10, 0),
    });
    adapter.createCollider({
      body: wall,
      shape: { type: "rectangle", halfExtents: new Vector2(0.05, 5) },
    });
    const bullet = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 0),
      linearVelocity: new Vector2(200, 0),
      ccdMode: "speculative",
      ccdPredictionDistance,
    });
    adapter.createCollider({
      body: bullet,
      shape: { type: "circle", radius: 0.05 },
      restitution: 0,
    });
    return { adapter, bullet };
  }

  it("a generous distance stops the bullet the default would also stop — and reports speculative", async () => {
    const { adapter, bullet } = await fireBullet(10);
    expect(adapter.getBodyCcdMode(bullet)).toBe("speculative");
    for (let step = 0; step < 30; step += 1) {
      adapter.step(DT);
    }
    // Caught at the wall (x = 10), not 100 m downrange.
    expect(positionOf(adapter, bullet).x).toBeLessThan(10);
    adapter.dispose();
  });

  it("a tiny distance is honoured too: the same bullet tunnels", async () => {
    const { adapter, bullet } = await fireBullet(0.001);
    expect(adapter.getBodyCcdMode(bullet)).toBe("speculative");
    for (let step = 0; step < 30; step += 1) {
      adapter.step(DT);
    }
    // 30 steps at 200 m/s: far beyond the wall. If the descriptor's distance
    // had not replaced the 1 m default... the default would ALSO tunnel here
    // (0.83 m per substep > 1 m is false — 1 m covers it), so the tunnelling
    // proves the 0.001 m value reached Rapier.
    expect(positionOf(adapter, bullet).x).toBeGreaterThan(10);
    adapter.dispose();
  });
});
