export const PACKAGE_NAME = "@four/motion";

export type {
  ReadonlyTimeState,
  TimeState,
  TimeStateOptions,
} from "./clock.js";
export {
  DEFAULT_FIXED_DELTA_TIME,
  DEFAULT_MAXIMUM_SUB_STEPS,
  assertFixedDeltaTime,
  assertTimeScale,
  copyTimeState,
  createTimeState,
} from "./clock.js";
export type {
  AccelerationFn,
  Integrator,
  IntegratorFn,
  IntegratorState,
} from "./integrators.js";
export {
  DEFAULT_INTEGRATOR,
  INTEGRATORS,
  explicitEuler,
  rk2,
  rk4,
  semiImplicitEuler,
  velocityVerlet,
} from "./integrators.js";
export type {
  MotionComponentOptions,
  MotionSystemOptions,
} from "./motion-component.js";
export { MotionComponent, MotionSystem } from "./motion-component.js";
export type { SchedulerCallback, SchedulerOptions } from "./scheduler.js";
export { Scheduler } from "./scheduler.js";
export type {
  Detach,
  FixedUpdateContext,
  SimulationContext,
  SimulationSystem,
  Unregister,
} from "./systems.js";
export {
  PRIORITY_ANIMATION_TARGETS,
  PRIORITY_COMMANDS,
  PRIORITY_CONSTRAINTS,
  PRIORITY_EVENT_DISPATCH,
  PRIORITY_FORCES,
  PRIORITY_INPUT,
  PRIORITY_KINEMATICS,
  PRIORITY_PHYSICS_SOLVE,
  PRIORITY_RENDER_INTERPOLATION,
  PRIORITY_SENSOR_UPDATE,
  PRIORITY_SNAPSHOT,
  SystemRegistry,
} from "./systems.js";
export type {
  BallisticTrajectoryOptions,
  CatmullRomTrajectoryOptions,
  CircularTrajectoryOptions,
  CubicBezierTrajectoryOptions,
  DampedSpringTrajectoryOptions,
  EllipticalTrajectoryOptions,
  LinearTrajectoryOptions,
  ParabolicTrajectoryOptions,
  ParametricTrajectoryOptions,
  Trajectory,
} from "./trajectories.js";
export {
  BallisticTrajectory,
  CENTRAL_DIFFERENCE_STEP,
  CatmullRomTrajectory,
  CircularTrajectory,
  CubicBezierTrajectory,
  DEFAULT_BALLISTIC_ACCELERATION_Y,
  DampedSpringTrajectory,
  EllipticalTrajectory,
  LinearTrajectory,
  ParabolicTrajectory,
  ParametricTrajectory,
} from "./trajectories.js";
