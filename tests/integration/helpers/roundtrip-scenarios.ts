/**
 * The Phase 11 save → reload rig (plan §6j, WP-11.5; §79–§80, §113a) — one
 * headless 2D Rapier scenario, driven through the **shipped** `RigidBody` /
 * `Collider` component serializers.
 *
 * `@four/serialization` may depend on `core`, `math`, and `scene` only (plan
 * §3.1), so it can never name `RigidBody` or `Collider`: §79's answer is a
 * registry each package — or, when the matrix forbids even that, the
 * application wiring them together — registers its own serializers into. P11-1
 * pinned Phase 11's single cross-package registration to *this* layer, and from
 * WP-11.5 until 2026-08-06 this file also held the two **reference
 * serializers** an application was meant to copy out of it.
 *
 * It no longer does. `PH-17` shipped them: `@four/physics` exports
 * `RIGID_BODY_SERIALIZER` and `COLLIDER_SERIALIZER`, and the umbrella package's
 * `registerPhysicsSerializers()` performs the registration — which is what
 * {@link createRoundtripSerializers} now calls. The duplicates that used to
 * live here are deleted rather than kept in sync: a test-local copy of shipped
 * behaviour is a test that passes while the product is broken.
 *
 * ## The pattern
 *
 * ```ts
 * const registry = registerPhysicsSerializers(createDefaultComponentSerializers());
 *
 * const document = serializeScene(simRoot, registry);   // §79 write
 * const reloaded = instantiateScene(document, registry); // §79 read
 * for (const node of bodyNodes(reloaded)) world.addBody(node); // re-register
 * ```
 *
 * `register` takes the component **class** (the `static readonly typeName` is
 * the document key, §6a/§79), not an instance and not a string — and a
 * component whose class is not registered is *refused* at save time rather than
 * silently dropped (A-15, 2026-08-06), which is why both are registered
 * together by one function rather than left to a caller to remember.
 *
 * ## What round-trips, and what is world-registration state
 *
 * The authoritative table is `@four/physics`'s `serializers.ts` header. What
 * matters to *this* suite:
 *
 * | state | round-trips? |
 * | --- | --- |
 * | §22/§23/§31 body state, §19 blend weights | yes |
 * | §23 mass and centre of mass | yes, **only when authored** — see below |
 * | node pose, authority, name, tags, metadata | yes (`@four/scene`'s own serializer) |
 * | §24 shape, offset, sensor flag, groups, mask | yes |
 * | §25 friction / restitution / density | yes, **as authored**; the fallback chain re-resolves on load |
 * | §32 `sleeping` | recorded as diagnostics, never applied — a reloaded body starts awake |
 * | solver handles, body ids, contact manifolds, warm-start impulses | **no** — that is §34's snapshot, not §79's document |
 *
 * **Mass authoredness survives registration (corrected 2026-08-06).**
 * `PhysicsWorld.addBody` finishes by reading `getBodyMass` back onto the
 * component (`#refreshMassProperties`). Until 2026-08-06 that read went through
 * the `mass` *setter*, so a body that had asked the solver to derive its mass
 * from collider density (§23, §25) reported an **authored** mass from that
 * moment on — as did a **static** one, whose collider still has a density and
 * therefore a positive derived mass the solver never uses (measured 2026-08-02:
 * this scenario's ground reported 20 kg and its sensor 4.8 kg) — and
 * `toDescriptor()` re-emitted all of it, so the document froze a number nobody
 * had authored.
 *
 * The derived value now lands on `RigidBody.derivedMass`, a read-only mirror,
 * and `toDescriptor()` emits `mass` only for a body that really authored one.
 * So the document carries a mass for the authored ball and **none** for the
 * derived one, and the reload re-derives it from the collider it also carries —
 * behaviour-preserving (the reloaded masses are still bit-identical to the
 * save's, which this suite asserts) *and* authoring-preserving: a reloaded body
 * whose collider is later scaled follows it, exactly as the saved one did.
 *
 * ## The §79 / §34 line (the finding this rig exists to make)
 *
 * A §79 document carries **authored state**. A §34 snapshot carries the
 * **solver's world**: contact manifolds, warm-start impulses, island and sleep
 * bookkeeping — everything an iterative solver accumulates and nothing an author
 * ever wrote. So a save → load reproduces a scene, not a
 * simulation-in-progress.
 *
 * `../scene-roundtrip.test.ts` measures where that costs something, by saving
 * the *same* scene at two moments and reloading both. Measured 2026-08-02
 * against Rapier 2D 0.19.3:
 *
 * | save point | solver state | reloaded §33 checksum stream |
 * | --- | --- | --- |
 * | {@link CONTACT_FREE_SAVE_STEP} (both balls in free fall) | no contacts | **bit-identical** to the control for all 200 remaining steps — through every later collision, bounce, and §29 trigger |
 * | {@link SAVE_STEP} (both balls resting on the ground) | live manifolds | **parts from the control at step 2**; states stay within {@link CONTACT_RELOAD_POSITION_TOLERANCE} |
 *
 * In both cases the restored *authored* state is exact: poses, rotations,
 * velocities, and masses come back bit for bit (the suite asserts a drift of
 * exactly zero at step 0). So the boundary is not "§79 is lossy about numbers";
 * it is precisely **"§79 does not carry the solver's contact state"**. Where
 * there is none to carry, a §79 round trip is a perfect one; where there is,
 * bit-identity needs a §34 snapshot (`PhysicsWorld.createSnapshot`), which is
 * exactly what §34 is for.
 *
 * ## Conventions (plan §1)
 *
 * Y-up (2D gravity is negative Y, §7a), radians, **seconds** everywhere, no
 * clock and no `Math.random` anywhere in a scenario (§33): every run is driven
 * by `Application.step(DT)` with a constant, injected delta.
 */

import { Quaternion, Vector2, Vector3 } from "@four/math";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  type CollisionShape,
} from "@four/physics";
import { Rapier2dAdapter } from "@four/physics-rapier";
import { Group, Node } from "@four/scene";
import {
  ComponentSerializerRegistry,
  createDefaultComponentSerializers,
} from "@four/serialization";
import { registerPhysicsSerializers } from "four";
import { Application } from "four/application";

// ---------------------------------------------------------------------------
// Scenario constants (§7a: seconds and world units, never milliseconds)
// ---------------------------------------------------------------------------

/** One fixed step in **seconds** (§7a, §10; Appendix A's 1/60). */
export const DT = 1 / 60;

/**
 * Fixed steps run before the scene is saved — 2 s at {@link DT}, the step the
 * packet names. By then both balls have landed and are **in resting contact**
 * with the ground, which is what makes this the interesting save point: the
 * solver is holding contact manifolds and warm-start impulses that no §79
 * document carries.
 */
export const SAVE_STEP = 120;

/**
 * The second save point — 0.667 s at {@link DT}, while both balls are still in
 * free fall and the solver holds **no contacts at all**.
 *
 * The controlled half of the experiment: same scene, same serializers, same
 * reload path, and the only difference is whether the solver had accumulated
 * contact state. See the module header's §79 / §34 section for what that
 * difference turns out to be worth.
 */
export const CONTACT_FREE_SAVE_STEP = 40;

/** Fixed steps the control run performs in one go — 4 s at {@link DT}. */
export const CONTROL_STEPS = 240;

/**
 * Position tolerance for the contact-carrying reload, in metres.
 *
 * Derived rather than tuned: the smaller ball's radius is 0.25 m, and 1 mm is
 * 0.4 % of it — far too small for any *behavioural* difference (a ball resting
 * somewhere else, or still bouncing when the control has settled) to hide under,
 * and far larger than the drift a lost warm-start actually produces. Measured on
 * 2026-08-02: **9.54e-7 m** after the 120 steps that follow the reload, which is
 * below §33's own 1e-6 quantization step.
 */
export const CONTACT_RELOAD_POSITION_TOLERANCE = 1e-3;

/**
 * Velocity tolerance for the contact-carrying reload, in metres per second.
 * Measured 2026-08-02: **7.15e-7 m/s**. See
 * {@link CONTACT_RELOAD_POSITION_TOLERANCE}.
 */
export const CONTACT_RELOAD_VELOCITY_TOLERANCE = 1e-2;

/**
 * The static ground: 20 units wide, half a unit thick, centred so its **top
 * surface sits at y = 0**, which is the datum every height below is measured
 * from.
 */
export const GROUND = { halfWidth: 10, halfHeight: 0.5, centerY: -0.5 };

/**
 * The static sensor volume (§24 `sensor`, §29 triggers): a box the falling
 * balls pass through on their way down, so a reloaded scene can be shown to
 * still *be* a sensor rather than merely to have the flag set.
 */
export const SENSOR = {
  halfWidth: 3,
  halfHeight: 0.4,
  centerX: 0,
  centerY: 1.4,
};

/**
 * The two dynamic balls, in registration order — which is §33's checksum order,
 * so reordering this array changes every digest in the suite.
 *
 * Masses are **authored** on one ball and **derived** on the other, on purpose:
 * the derived one is what makes the mass-authoredness paragraph in the module
 * header a claim this suite tests rather than a claim it asserts.
 */
export const BALLS = [
  {
    name: "ball-authored",
    x: -1.4,
    y: 3.2,
    radius: 0.3,
    mass: 1.5,
    restitution: 0.45,
    friction: 0.3,
    velocityX: 1.1,
  },
  {
    name: "ball-derived",
    x: 1.1,
    y: 4.1,
    radius: 0.25,
    mass: undefined,
    restitution: 0.2,
    friction: 0.6,
    velocityX: -0.8,
  },
] as const;

/** Bodies the scenario registers: the ground, the sensor, and {@link BALLS}. */
export const BODY_COUNT = 2 + BALLS.length;

/** Name of the `Group` that roots the serialized subtree. */
export const SIM_ROOT_NAME = "sim-root";

/**
 * The registry this suite saves and loads with: `@four/serialization`'s own
 * (`PoseTarget`) plus the two physics components (§79, plan P11-1, PH-17).
 *
 * The **shipped** registration, not a copy of it: `registerPhysicsSerializers`
 * is the umbrella function an application calls, so a defect in either shipped
 * serializer fails this suite instead of hiding behind a test-local duplicate.
 * `registerSceneNodeTypes()` is the same registration plus the §73 widgets and
 * `MotionComponent`; this scenario has neither, and keeping the UI packages out
 * of its import graph keeps it a physics test.
 *
 * A fresh instance per call — registries are mutable and `register` refuses a
 * duplicate `typeName`, so a shared singleton would make two tests collide.
 */
export function createRoundtripSerializers(): ComponentSerializerRegistry {
  return registerPhysicsSerializers(createDefaultComponentSerializers());
}

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

/** A node plus the two §6a components a physics body is made of. */
export interface BodyParts {
  readonly node: Node;
  readonly body: RigidBody;
  readonly collider: Collider;
}

/** Everything a case needs to drive, save, reload, or inspect the scenario. */
export interface RoundtripRig {
  /** The headless application (no renderer anywhere in the import graph). */
  readonly app: Application;
  /** The one §39 system, at `PRIORITY_PHYSICS_SOLVE`. */
  readonly system: PhysicsSystem;
  /** The one 2D Rapier world. */
  readonly world: PhysicsWorld;
  /** The node that roots the serialized subtree. */
  readonly root: Node;
  /** Every registered body's node, in registration order (§33). */
  readonly nodes: readonly Node[];
  /** §29 trigger events the sensor dispatched, in dispatch order. */
  readonly triggers: string[];
  /** One fixed step of this rig's application. */
  stepOnce(): void;
  /** Disposes the world and then the application (§83). */
  dispose(): void;
}

/** Subscribes to the sensor's §29 trigger events, appending their names. */
function watchSensor(collider: Collider, log: string[]): void {
  collider.on("triggerenter", () => log.push("triggerenter"));
  collider.on("triggerexit", () => log.push("triggerexit"));
}

/**
 * Builds a headless application with one {@link PhysicsSystem} and one 2D Rapier
 * world, and returns the empty rig; callers populate it.
 *
 * `poseInterpolation` is **off**: §43 pose capture is a render concern and never
 * feeds back into physics state (§10, §42), so every number this suite compares
 * is the solver's alone.
 */
async function createEmptyRig(): Promise<{
  app: Application;
  system: PhysicsSystem;
  world: PhysicsWorld;
}> {
  const app = new Application({ fixedTimeStep: DT, poseInterpolation: false });
  const system = new PhysicsSystem();
  app.systems.register(system);
  await app.initialize();

  const world = new PhysicsWorld({
    dimension: "2d",
    adapter: new Rapier2dAdapter(),
  });
  await world.initialize();
  system.track(world);
  return { app, system, world };
}

/** Registers one body under `root` and with `world`, and returns its parts. */
function addBody(
  world: PhysicsWorld,
  root: Group,
  name: string,
  type: "dynamic" | "static",
  shape: CollisionShape,
  options: {
    x: number;
    y: number;
    mass?: number;
    restitution?: number;
    friction?: number;
    sensor?: boolean;
    velocityX?: number;
  },
): BodyParts {
  const node = new Group();
  node.name = name;
  node.transform.position.set(options.x, options.y, 0);
  node.transformAuthority = type === "dynamic" ? "physics" : "manual";

  const body = new RigidBody({
    type,
    ...(options.mass === undefined ? {} : { mass: options.mass }),
    ...(options.velocityX === undefined
      ? {}
      : { linearVelocity: new Vector3(options.velocityX, 0, 0) }),
  });
  node.addComponent(body);
  const collider = new Collider({
    shape,
    ...(options.restitution === undefined
      ? {}
      : { restitution: options.restitution }),
    ...(options.friction === undefined ? {} : { friction: options.friction }),
    ...(options.sensor === undefined ? {} : { sensor: options.sensor }),
  });
  node.addComponent(collider);

  root.add(node);
  world.addBody(node);
  return { node, body, collider };
}

/**
 * Builds the scenario from scratch: the ground, the sensor volume, and
 * {@link BALLS}, in that registration order (§33's checksum order).
 *
 * Awaited twice over — `Application.initialize` (§45) and
 * `PhysicsWorld.initialize` (where Rapier's wasm image loads, cached per
 * process).
 */
export async function createRoundtripRig(): Promise<RoundtripRig> {
  const { app, system, world } = await createEmptyRig();
  const root = new Group();
  root.name = SIM_ROOT_NAME;
  app.scene.add(root);
  const nodes: Node[] = [];
  const triggers: string[] = [];

  nodes.push(
    addBody(
      world,
      root,
      "ground",
      "static",
      {
        type: "rectangle",
        halfExtents: new Vector2(GROUND.halfWidth, GROUND.halfHeight),
      },
      { x: 0, y: GROUND.centerY, friction: 0.8 },
    ).node,
  );

  const sensor = addBody(
    world,
    root,
    "sensor",
    "static",
    {
      type: "rectangle",
      halfExtents: new Vector2(SENSOR.halfWidth, SENSOR.halfHeight),
    },
    { x: SENSOR.centerX, y: SENSOR.centerY, sensor: true },
  );
  watchSensor(sensor.collider, triggers);
  nodes.push(sensor.node);

  for (const ball of BALLS) {
    nodes.push(
      addBody(
        world,
        root,
        ball.name,
        "dynamic",
        { type: "circle", radius: ball.radius },
        {
          x: ball.x,
          y: ball.y,
          ...(ball.mass === undefined ? {} : { mass: ball.mass }),
          restitution: ball.restitution,
          friction: ball.friction,
          velocityX: ball.velocityX,
        },
      ).node,
    );
  }

  app.start();
  return {
    app,
    system,
    world,
    root,
    nodes,
    triggers,
    stepOnce(): void {
      app.step(DT);
    },
    dispose(): void {
      world.dispose();
      app.dispose();
    },
  };
}

/**
 * Every node of `root`'s subtree that carries a `RigidBody`, in depth-first
 * insertion order (§6) — which is the order {@link createRoundtripRig}
 * registered them in, and therefore the §33 checksum order a reload must
 * reproduce.
 *
 * The one piece of glue a §79 document cannot carry: which nodes are bodies is
 * visible from the document, but *registering* them is an act on a world, and
 * §33's body ids are assigned by that act.
 */
export function collectBodyNodes(root: Node, out: Node[] = []): Node[] {
  if (root.getComponent(RigidBody) !== undefined) {
    out.push(root);
  }
  for (const child of root.children) {
    collectBodyNodes(child, out);
  }
  return out;
}

/**
 * Rebuilds a rig from a §79 document: a fresh application, a fresh 2D Rapier
 * world, the instantiated subtree, and one `world.addBody` per body node.
 *
 * `instantiateScene`'s result is the caller's — this function takes it rather
 * than a document, so a test can inspect the reloaded tree before it is
 * registered.
 *
 * The sensor is re-watched by node name, which is the honest reference pattern:
 * listeners are application code and a document carries none (§79), so an
 * application that reloads a scene re-attaches its own behaviour by whatever
 * stable identity it authored — here, `Node.name`.
 */
export async function loadRoundtripRig(root: Node): Promise<RoundtripRig> {
  const rig = await createEmptyRig();
  rig.app.scene.add(root);

  const nodes = collectBodyNodes(root);
  const triggers: string[] = [];
  for (const node of nodes) {
    rig.world.addBody(node);
    if (node.name === "sensor") {
      const collider = node.getComponent(Collider);
      if (collider !== undefined) {
        watchSensor(collider, triggers);
      }
    }
  }

  rig.app.start();
  return {
    app: rig.app,
    system: rig.system,
    world: rig.world,
    root,
    nodes,
    triggers,
    stepOnce(): void {
      rig.app.step(DT);
    },
    dispose(): void {
      rig.world.dispose();
      rig.app.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Runs and readbacks
// ---------------------------------------------------------------------------

/**
 * Runs `steps` fixed steps and returns `world.checksum()` after each (§33).
 *
 * One checksum per step, in step order, which is the sequence two runs must
 * agree on element by element to be called identical.
 */
export function stepChecksums(rig: RoundtripRig, steps: number): number[] {
  const digests: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    rig.stepOnce();
    digests.push(rig.world.checksum());
  }
  return digests;
}

/** One body's §33-relevant state, read back through the public API. */
export interface BodyState {
  /** `Node.name`, the stable identity this suite matches bodies by. */
  readonly name: string;
  /** World position (§42: written by the solver under `"physics"` authority). */
  readonly position: Vector3;
  /** World rotation. */
  readonly rotation: Quaternion;
  /** §23 linear velocity, refreshed from the solver every step. */
  readonly linearVelocity: Vector3;
  /** §23 angular velocity. */
  readonly angularVelocity: Vector3;
  /** §23 mass in kilograms, or `undefined` when the body has none. */
  readonly mass: number | undefined;
  /** §32 sleep flag. */
  readonly sleeping: boolean;
}

/**
 * Reads every registered body's §33-relevant state, in registration order.
 *
 * Copies, not references: the vectors are the components' live state, and a
 * caller comparing two runs needs the values as they were at the call.
 */
export function readBodyStates(rig: RoundtripRig): BodyState[] {
  const states: BodyState[] = [];
  for (const node of rig.nodes) {
    const body = node.getComponent(RigidBody);
    if (body === undefined) {
      continue;
    }
    states.push({
      name: node.name,
      position: new Vector3().copy(node.transform.position),
      rotation: new Quaternion().copy(node.transform.rotation),
      linearVelocity: new Vector3().copy(body.linearVelocity),
      angularVelocity: new Vector3().copy(body.angularVelocity),
      mass: body.mass,
      sleeping: body.sleeping,
    });
  }
  return states;
}

/**
 * The largest absolute component-wise difference between two state readbacks,
 * over positions and linear velocities.
 *
 * Bodies are matched by index — both runs registered the same scene in the same
 * order — and a length mismatch is a failure the caller should assert on before
 * calling this.
 */
export function maxStateDrift(
  a: readonly BodyState[],
  b: readonly BodyState[],
): { position: number; velocity: number } {
  let position = 0;
  let velocity = 0;
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i += 1) {
    position = Math.max(
      position,
      Math.abs(a[i].position.x - b[i].position.x),
      Math.abs(a[i].position.y - b[i].position.y),
      Math.abs(a[i].position.z - b[i].position.z),
    );
    velocity = Math.max(
      velocity,
      Math.abs(a[i].linearVelocity.x - b[i].linearVelocity.x),
      Math.abs(a[i].linearVelocity.y - b[i].linearVelocity.y),
      Math.abs(a[i].linearVelocity.z - b[i].linearVelocity.z),
    );
  }
  return { position, velocity };
}

/**
 * The 0-based index of the first element two checksum streams disagree on, or
 * `-1` when they are identical over their common length.
 */
export function firstDivergence(
  a: readonly number[],
  b: readonly number[],
): number {
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i += 1) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return -1;
}
