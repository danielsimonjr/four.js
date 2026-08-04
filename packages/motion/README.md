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
- **Prediction and IK** — `predictLinear` / `predictBallistic`, intercept solving, and analytic two-bone IK (`solveTwoBoneIK`; positions, not joint angles).

## Staged / not yet implemented

- Camera rigs and controls (§44) — assigned here per §98, not yet implemented.
- Path-planning adapters (RFC), CCD/FABRIK IK, spatial-hash steering neighbors (brute force ships), spherical wander, and robotic joint-command mapping (the PID → joint-motor cascade is demonstrated in tests instead).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/motion`; publishes as `@danielsimonjr/fourjs-motion`.
