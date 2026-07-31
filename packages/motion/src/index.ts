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
export type { SchedulerCallback, SchedulerOptions } from "./scheduler.js";
export { Scheduler } from "./scheduler.js";
