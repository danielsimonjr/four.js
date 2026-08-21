/**
 * §12's character controller and §44's first-person camera, across the
 * packages that have to agree (PH-11 residue + `R-36`'s staged first-person
 * rig, 2026-08-21).
 *
 * `R-36` staged §44's first-person rig on a single sentence: it *"writes a
 * rotation, so it collides with `LookAtConstraint` for §42's single authority
 * — it waits on §12's character controllers to settle aim-vs-free-look
 * arbitration"*. The settlement is a **decomposition**, and this file is its
 * proof, because the claim is one no unit test inside `@four/motion` can make:
 * it is about a *world* rotation composed by `@four/scene` from two nodes that
 * two different components wrote.
 *
 * What is checked:
 *
 * 1. **The composition is exactly `yaw ∘ pitch`.** A character walks a circle
 *    while its eye pitches up and down for 240 fixed steps; on **every** step
 *    the eye's world forward (`Node.getWorldDirection`, the §47 chain, not the
 *    components' own arithmetic) equals
 *    `(−cos p · sin yaw, sin p, −cos p · cos yaw)`.
 * 2. **No §42 conflict exists to arbitrate.** Two nodes, one writer each, both
 *    `"kinematic"`, one system: zero warnings over the run.
 * 3. **The aimed camera still composes.** A third camera under `"constraint"`
 *    authority follows and aims at the same character through
 *    `FollowRig` + `LookAtConstraint` in the same registry — the free-look eye
 *    and the aimed chase camera coexist because they are different nodes, not
 *    because anything negotiated.
 * 4. **The conflict that *would* have existed is still reported.** Putting a
 *    `LookAtConstraint` on the character's own node — the design §42 forbids —
 *    is the ordinary authority refusal, warned about once and writing nothing.
 */

import { Vector3 } from "@four/math";
import {
  CharacterController,
  ConstraintSystem,
  FirstPersonLook,
  FollowRig,
  KinematicSystem,
  LookAtConstraint,
  SystemRegistry,
  createTimeState,
} from "@four/motion";
import { Group, PerspectiveCamera, Scene } from "@four/scene";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/** §45 `fixedTimeStep`, in seconds (§7a). */
const DT = 1 / 60;

/** Fixed steps the walk covers (4 simulated seconds). */
const STEP_COUNT = 240;

/** Yaw fed per step, in radians — a full turn over the run. */
const YAW_PER_STEP = (2 * Math.PI) / STEP_COUNT;

/** Height of the eye above the character's origin, in metres (§7a). */
const EYE_HEIGHT = 1.7;

describe("PH-11/R-36: §12's character owns yaw, §44's first-person eye owns pitch", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  test("the eye's world orientation is yaw ∘ pitch on every step, with no §42 conflict", () => {
    const scene = new Scene();

    // The character: one node, one writer, `"kinematic"` (§42).
    const player = new Group();
    player.transformAuthority = "kinematic";
    const character = player.addComponent(
      new CharacterController({ moveSpeed: 3, jumpSpeed: 4, grounded: true }),
    );

    // The eye: a *child* node, its own writer, its own `"kinematic"` claim.
    const eye = new PerspectiveCamera({ aspect: 16 / 9 });
    eye.transform.position.set(0, EYE_HEIGHT, 0);
    eye.transformAuthority = "kinematic";
    const look = eye.addComponent(new FirstPersonLook());
    player.add(eye);
    scene.add(player);

    // A third-person camera watching the same character, under a *different*
    // authority on a *different* node — the coexistence claim.
    const chase = new PerspectiveCamera({ aspect: 16 / 9 });
    chase.transformAuthority = "constraint";
    chase.addComponent(
      new FollowRig({
        target: player,
        offset: new Vector3(0, 3, 6),
        frame: "target",
      }),
    );
    const chaseAim = chase.addComponent(
      new LookAtConstraint({ target: player }),
    );
    scene.add(chase);

    const kinematics = new KinematicSystem();
    const constraints = new ConstraintSystem();
    const registry = new SystemRegistry();
    registry.register(kinematics);
    registry.register(constraints);
    kinematics.track(player);
    kinematics.track(eye);
    constraints.track(chase);

    const time = createTimeState({ fixedDeltaTime: DT });
    const forward = new Vector3();
    let jumps = 0;
    let maxPitchReached = 0;
    let maxRadius = 0;

    for (let step = 1; step <= STEP_COUNT; step += 1) {
      // The application's parameter-driven input, exactly as a device layer
      // would feed it — `@four/motion` never reads `@four/input` (§3.1).
      character.turn(YAW_PER_STEP);
      character.setMoveIntent(1, 0);
      // A full sweep of the pitch channel: up, down, and back.
      look.look(0.02 * Math.cos((step * 2 * Math.PI) / STEP_COUNT));
      if (step === 60 && character.jump()) {
        jumps += 1;
      }

      time.frame = step;
      time.simulationStep = step;
      time.simulationTime = step * DT;
      time.deltaTime = DT;
      time.unscaledDeltaTime = DT;
      registry.runFixedStep(time);

      // The claim, on every step: the world forward of the eye is the yaw of
      // the character composed with the pitch of the eye, and nothing else —
      // no roll, no drift, no second writer.
      const yaw = character.yaw;
      const pitch = look.pitch;
      eye.getWorldDirection(forward);
      expect(forward.x).toBeCloseTo(-Math.cos(pitch) * Math.sin(yaw), 12);
      expect(forward.y).toBeCloseTo(Math.sin(pitch), 12);
      expect(forward.z).toBeCloseTo(-Math.cos(pitch) * Math.cos(yaw), 12);
      maxPitchReached = Math.max(maxPitchReached, Math.abs(pitch));
      maxRadius = Math.max(
        maxRadius,
        Math.hypot(player.transform.position.x, player.transform.position.z),
      );
    }

    // The run was a simulation, not a frozen scene.
    expect(jumps).toBe(1);
    expect(character.grounded).toBe(true);
    expect(maxPitchReached).toBeGreaterThan(0.5);
    expect(character.yaw).toBeCloseTo(2 * Math.PI, 12);
    // A closed circle of radius v/ω = 3 / (2π/4) ≈ 1.91 m: the walk came back
    // to where it started, having actually gone somewhere.
    expect(maxRadius).toBeGreaterThan(1.5);
    expect(maxRadius).toBeLessThan(4);
    const world = player.transform.position;
    expect(Math.hypot(world.x, world.z)).toBeLessThan(0.1);

    // The eye rides the character: same horizontal position, eye height above.
    expect(eye.transform.position.y).toBe(EYE_HEIGHT);

    // The chase camera aimed every step, and nothing was refused anywhere.
    expect(chaseAim.skippedSteps).toBe(0);
    expect(character.skippedSteps).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a look-at constraint on the character's own node is the ordinary §42 refusal", () => {
    // The design the decomposition avoids: two systems wanting one transform.
    // It is not a special case — it is exactly the conflict §42 already reports.
    const player = new Group();
    player.transformAuthority = "kinematic";
    const character = player.addComponent(
      new CharacterController({ moveSpeed: 2, gravity: 0, grounded: true }),
    );
    const subject = new Group();
    subject.transform.position.set(0, 0, -5);
    player.addComponent(new LookAtConstraint({ target: subject }));

    const kinematics = new KinematicSystem();
    const constraints = new ConstraintSystem();
    const registry = new SystemRegistry();
    registry.register(kinematics);
    registry.register(constraints);
    kinematics.track(player);
    constraints.track(player);

    const time = createTimeState({ fixedDeltaTime: DT });
    for (let step = 1; step <= 3; step += 1) {
      character.setMoveIntent(1, 0);
      time.simulationStep = step;
      time.simulationTime = step * DT;
      registry.runFixedStep(time);
    }

    // The character wrote (it owns `"kinematic"`); the constraint was refused
    // and warned about exactly once, never per step.
    expect(player.transform.position.z).toBeLessThan(0);
    expect(player.transform.rotation.x).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
