/**
 * §21 `"local-plane"` determinism scenario — two dynamic bodies on a tilted
 * plane, under in-plane gravity, checksummed for 180 fixed steps.
 *
 * Node poses are the plane's 2D frame; `PhysicsWorld` maps through the plane
 * basis on feed/publish. Gravity is the world −Y projected onto the plane so
 * the bodies stay in it. Rapier 3D, `same-runtime` tier.
 */

import { Vector3 } from "@four/math";
import { Collider, PhysicsWorld, RigidBody } from "@four/physics";
import { Rapier3dAdapter } from "@four/physics-rapier";
import { Group } from "@four/scene";

/** §45 `fixedTimeStep`, in seconds. */
export const FIXED_TIME_STEP = 1 / 60;

/** Fixed steps the run covers (3 simulated seconds). */
export const STEP_COUNT = 180;

/** 1-based fixed step of the one-second probe. */
export const PROBE_STEP_ONE_SECOND = 60;

const PLANE_TILT = Math.PI / 6;

/** Tilted plane: 30° about +X, xAxis stays +X. */
export function tiltedPlane(): {
  origin: Vector3;
  normal: Vector3;
  xAxis: Vector3;
} {
  const normal = new Vector3(0, Math.sin(PLANE_TILT), Math.cos(PLANE_TILT));
  return {
    origin: new Vector3(0, 0, 0),
    normal,
    xAxis: new Vector3(1, 0, 0),
  };
}

/** World gravity = Appendix A −Y projected onto the plane, so motion stays in it. */
export function inPlaneGravity(normal: Vector3): Vector3 {
  const gravity = new Vector3(0, -9.81, 0);
  const along = gravity.dot(normal);
  return new Vector3(
    gravity.x - normal.x * along,
    gravity.y - normal.y * along,
    gravity.z - normal.z * along,
  );
}

export type Triple = readonly [number, number, number];

export interface BodySample {
  position: Triple;
  velocity: Triple;
}

export interface LocalPlaneSummary {
  stepCount: number;
  bodyCount: number;
  checksums: number[];
  atOneSecond: BodySample[];
  atEnd: BodySample[];
  /** Plane-frame v of the first body at the end — must have slid "down". */
  firstBodyV: number;
}

export type LocalPlaneScenarioResult = LocalPlaneSummary;

function sample(node: Group, body: RigidBody): BodySample {
  const p = node.transform.position;
  const v = body.linearVelocity;
  return {
    position: [p.x, p.y, p.z],
    velocity: [v.x, v.y, v.z],
  };
}

export async function runLocalPlaneScenario(): Promise<LocalPlaneScenarioResult> {
  const plane = tiltedPlane();
  const world = new PhysicsWorld({
    dimension: "3d",
    adapter: new Rapier3dAdapter(),
    gravity: inPlaneGravity(plane.normal),
    localPlane: plane,
    sleeping: { enabled: false },
  });
  await world.initialize();

  const nodes: Group[] = [];
  const bodies: RigidBody[] = [];
  for (const [u, mass] of [
    [0, 1],
    [1.2, 2],
  ] as const) {
    const node = new Group();
    node.transformAuthority = "physics";
    node.transform.position.set(u, 2, 0);
    const body = node.addComponent(
      new RigidBody({
        type: "dynamic",
        mass,
        space: "local-plane",
        linearDamping: 0,
        angularDamping: 0,
      }),
    );
    node.addComponent(
      new Collider({ shape: { type: "sphere", radius: 0.25 } }),
    );
    world.addBody(node);
    nodes.push(node);
    bodies.push(body);
  }

  const checksums: number[] = [];
  let atOneSecond: BodySample[] = [];
  for (let step = 0; step < STEP_COUNT; step += 1) {
    world.step(FIXED_TIME_STEP);
    checksums.push(world.checksum());
    if (step + 1 === PROBE_STEP_ONE_SECOND) {
      atOneSecond = nodes.map((node, i) => sample(node, bodies[i]));
    }
  }

  const atEnd = nodes.map((node, i) => sample(node, bodies[i]));
  const result: LocalPlaneScenarioResult = {
    stepCount: STEP_COUNT,
    bodyCount: nodes.length,
    checksums,
    atOneSecond,
    atEnd,
    firstBodyV: nodes[0].transform.position.y,
  };
  world.dispose();
  return result;
}
