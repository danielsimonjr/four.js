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
export type { TwoBoneIKSolution } from "./ik.js";
export { createTwoBoneIKSolution, solveTwoBoneIK } from "./ik.js";
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
  KinematicSystemOptions,
  MoveOptions,
  PathFollowOptions,
  RotateOptions,
} from "./kinematic-controller.js";
export {
  KINEMATIC_COMPLETION_TOLERANCE,
  KinematicController,
  KinematicSystem,
} from "./kinematic-controller.js";
export type {
  MotionComponentOptions,
  MotionSystemOptions,
} from "./motion-component.js";
export { MotionComponent, MotionSystem } from "./motion-component.js";
export type { ComponentSerializerShape } from "./serializers.js";
export { MOTION_COMPONENT_SERIALIZER } from "./serializers.js";
export type { PIDControllerOptions, PIDDerivativeSource } from "./pid.js";
export { DEFAULT_PID_OUTPUT_LIMITS, PIDController } from "./pid.js";
export {
  ballisticApexHeight,
  ballisticTimeOfFlightToPlane,
  ballisticTimeToApex,
  interceptPoint,
  interceptTime,
  predictBallistic,
  predictLinear,
} from "./prediction.js";
export { SeededRandom } from "./random.js";
export type { SchedulerCallback, SchedulerOptions } from "./scheduler.js";
export { Scheduler } from "./scheduler.js";
export type {
  SpringDamperCoefficientOptions,
  SpringDamperFrequencyOptions,
  SpringDamperOptions,
  SpringDamperResult,
  SpringDamperVector3Result,
} from "./spring-damper.js";
export { SpringDamper } from "./spring-damper.js";
export type {
  SteeringAgentOptions,
  SteeringContext,
  SteeringNeighbor,
  WanderStateOptions,
} from "./steering.js";
export {
  SteeringAgent,
  WanderState,
  alignment,
  arrive,
  cohesion,
  evade,
  flee,
  pursue,
  seek,
  separation,
  truncate,
  wander,
} from "./steering.js";
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
