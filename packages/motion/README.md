# @four/motion

Motion system — time, the fixed-step loop, kinematics, and controllers. Part of [four.js](../../README.md).

Implements §9–§13, §38–§39, and the §111 advanced-motion tier (§99, Parts II & VI) of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped across Phases 1, 2, and 8. All times are seconds.

## What's here

- **Time (§9)** — `TimeState` / `createTimeState` / `copyTimeState` distinguishing real, render, simulation, scaled, and unscaled time.
- **Scheduler (§10)** — the fixed-delta accumulator (`Scheduler`, `DEFAULT_FIXED_DELTA_TIME`, `DEFAULT_MAXIMUM_SUB_STEPS`, dropped-time surfacing, `interpolationAlpha`).
- **System registry (§39)** — `SystemRegistry`, `SimulationSystem`, and the `PRIORITY_*` step-order constants; nothing edits the scheduler directly.
- **Integrators (§38)** — `explicitEuler`, `semiImplicitEuler`, `rk2`, `rk4`, `velocityVerlet` (`INTEGRATORS`).
- **Kinematics** — `MotionComponent` / `MotionSystem` (velocity/acceleration) and `KinematicController` / `KinematicSystem` (per-channel move/rotate/path-follow commands under §42 transform authority).
- **Trajectories (§13)** — linear, parabolic, ballistic, circular, elliptical, cubic Bézier, Catmull-Rom, damped spring, and parametric.
- **Controllers and steering (§111)** — `PIDController` (conditional-integration anti-windup), `SpringDamper` (exact ZOH matrix-exponential step, unconditionally stable), the Reynolds steering set (`seek`, `flee`, `pursue`, `evade`, `arrive`, `wander`) plus flocking (`separation`, `cohesion`, `alignment`) via `SteeringAgent`.
- **Camera rigs (§44)** — `OrbitRig`, `FollowRig` (follow target and spring arm), `LookAtConstraint` + `ConstraintSystem` at §39 step 7 under §42's `"constraint"` authority; `CharacterController` / `FirstPersonLook` under `"kinematic"`.
- **Prediction and IK** — `predictLinear` / `predictBallistic`, intercept solving, and analytic two-bone IK (`solveTwoBoneIK`; positions, not joint angles).

## Staged / not yet implemented

- Fly (two lines of application code over the shipped orbit/dolly surface), shake/impulse (wants interpolated value-noise, not per-step white noise), stereo/XR.
- Path-planning adapters (RFC), CCD/FABRIK IK limits/ownership/convergence, spherical wander, and robotic joint-command mapping (the PID → joint-motor cascade is demonstrated in tests instead). `SpatialHash` ships for radius neighbour queries (WP-8.2).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/motion`; publishes as `@danielsimonjr/fourjs-motion`.
