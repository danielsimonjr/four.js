/**
 * Clock and time domains (§9).
 *
 * `TimeState` is the single time record the engine passes around: the
 * {@link Scheduler} (`./scheduler.ts`) owns one instance and advances it, and
 * every system reads the domain it cares about from it (§9: "Individual
 * systems may select a time source").
 *
 * All fields are **seconds** (§7a) — durations included; nothing in four.js
 * takes milliseconds.
 *
 * Time domains and the fields that carry them (§9):
 *
 * | Domain      | Field(s)                                             |
 * |-------------|------------------------------------------------------|
 * | real        | `realTime`, `unscaledDeltaTime`                       |
 * | render      | `renderTime`, `interpolationAlpha`                    |
 * | simulation  | `simulationTime`, `simulationStep`, `fixedDeltaTime`  |
 * | scaled      | `deltaTime`, `renderTime` (both scaled by `timeScale`)|
 * | unscaled    | `unscaledDeltaTime`, `realTime`                       |
 *
 * Animation time is deliberately absent: §9 states it is clip-local and lives
 * on players and timelines (§16-17), not in the global `TimeState`.
 *
 * Nothing in this module reads a wall clock. Time is injected into
 * `Scheduler.step(elapsedRealSeconds)` by the caller (§33, plan ground rule 5),
 * which is what makes replay and determinism tests possible.
 */

/**
 * Normative default fixed simulation step (Appendix A: `fixedTimeStep` = 1/60 s;
 * §10, §45).
 */
export const DEFAULT_FIXED_DELTA_TIME = 1 / 60;

/**
 * Normative default substep clamp (Appendix A: `maximumSubSteps` = 5; §10,
 * §45). Bounds simulation work after a long frame; the excess is dropped into
 * {@link TimeState.droppedTime} rather than spiralling.
 */
export const DEFAULT_MAXIMUM_SUB_STEPS = 5;

/**
 * The §9 time record, verbatim in field set and order.
 *
 * The fields are writable because exactly one owner — the {@link Scheduler} —
 * advances them. Everyone else receives the value as {@link ReadonlyTimeState}.
 */
export interface TimeState {
  /** Wall-clock time accumulated from the injected elapsed values. Unscaled. */
  realTime: number;
  /**
   * Presentation clock: advances by `deltaTime`, so it slows under
   * `timeScale` and freezes while `paused` (§9, scaled-time domain).
   */
  renderTime: number;
  /** Deterministic physics clock: advances by `fixedDeltaTime` per fixed step. */
  simulationTime: number;
  /** Scaled frame delta: `unscaledDeltaTime * timeScale`, or 0 while paused. */
  deltaTime: number;
  /** Unscaled frame delta: exactly the elapsed value injected into `step`. */
  unscaledDeltaTime: number;
  /** Constant simulation step size (Appendix A default 1/60 s). */
  fixedDeltaTime: number;
  /** Simulation time scale. Preserved across pause and resume (§10). */
  timeScale: number;
  /** Pause flag. Freezes the accumulator and zeroes `deltaTime` (§10). */
  paused: boolean;
  /** Leftover-accumulator fraction in [0, 1] used to interpolate the render pose (§10, §43). */
  interpolationAlpha: number;
  /** Number of completed `step` calls (frames). */
  frame: number;
  /** Number of completed fixed simulation steps. */
  simulationStep: number;
  /** Simulation time discarded by the substep clamp (§9, §10). */
  droppedTime: number;
}

/**
 * A `TimeState` as consumers see it.
 *
 * Scheduler callbacks receive the scheduler's **live** state object under this
 * type: mutating it is forbidden (it would desynchronise the loop), and the
 * type makes an attempt a compile error. The object is deliberately *not*
 * `Object.freeze`d — the scheduler must keep mutating that same instance every
 * frame, and freezing would force a fresh allocation per frame in the hot path
 * (plan D7 allocation policy). Consumers that need to retain a value across
 * frames must copy it with {@link copyTimeState}.
 */
export type ReadonlyTimeState = Readonly<TimeState>;

/** Options for {@link createTimeState}. */
export interface TimeStateOptions {
  /** Fixed simulation step in seconds. Default {@link DEFAULT_FIXED_DELTA_TIME}. */
  fixedDeltaTime?: number;
  /** Initial simulation time scale. Default 1. */
  timeScale?: number;
  /** Initial pause flag. Default `false`. */
  paused?: boolean;
}

/**
 * Creates a zeroed {@link TimeState}: every clock and counter starts at 0,
 * `timeScale` at 1, `paused` false.
 *
 * @throws RangeError if `fixedDeltaTime` is not a finite positive number, or
 * `timeScale` is not a finite non-negative number.
 */
export function createTimeState(options: TimeStateOptions = {}): TimeState {
  const fixedDeltaTime = options.fixedDeltaTime ?? DEFAULT_FIXED_DELTA_TIME;
  const timeScale = options.timeScale ?? 1;
  assertFixedDeltaTime(fixedDeltaTime);
  assertTimeScale(timeScale);
  return {
    realTime: 0,
    renderTime: 0,
    simulationTime: 0,
    deltaTime: 0,
    unscaledDeltaTime: 0,
    fixedDeltaTime,
    timeScale,
    paused: options.paused ?? false,
    interpolationAlpha: 0,
    frame: 0,
    simulationStep: 0,
    droppedTime: 0,
  };
}

/**
 * Copies every field of `source` into `out` (allocating a fresh record when
 * `out` is omitted, per the plan's `out?` policy) and returns `out`.
 *
 * Used by snapshot, replay (§34), and test code that must retain a frame's
 * time values after the scheduler has moved on.
 */
export function copyTimeState(
  source: ReadonlyTimeState,
  out?: TimeState,
): TimeState {
  const target =
    out ?? createTimeState({ fixedDeltaTime: source.fixedDeltaTime });
  target.realTime = source.realTime;
  target.renderTime = source.renderTime;
  target.simulationTime = source.simulationTime;
  target.deltaTime = source.deltaTime;
  target.unscaledDeltaTime = source.unscaledDeltaTime;
  target.fixedDeltaTime = source.fixedDeltaTime;
  target.timeScale = source.timeScale;
  target.paused = source.paused;
  target.interpolationAlpha = source.interpolationAlpha;
  target.frame = source.frame;
  target.simulationStep = source.simulationStep;
  target.droppedTime = source.droppedTime;
  return target;
}

/**
 * Validates a fixed step size.
 *
 * Argument validation throws the platform's `RangeError` rather than a
 * `FourError`: §89's code union has no argument-validation member, and
 * `packages/core/src/errors.ts` is outside this packet's scope (WP-1.9
 * decision).
 */
export function assertFixedDeltaTime(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `fixedDeltaTime must be a finite number of seconds greater than 0 (§10); received ${String(value)}`,
    );
  }
}

/** Validates a time scale: finite and non-negative (negative time is not a §9 domain). */
export function assertTimeScale(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `timeScale must be a finite number >= 0 (§9); received ${String(value)}`,
    );
  }
}
