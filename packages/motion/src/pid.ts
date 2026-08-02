/**
 * PID controller utility (§111).
 *
 * §111 sketches the constructor verbatim:
 *
 * ```ts
 * const controller = new Four.PIDController({
 *     kp: 2,
 *     ki: 0.5,
 *     kd: 0.1,
 *     outputLimits: [-10, 10]
 * });
 * ```
 *
 * That is the whole of the specification's guidance, so everything else here is
 * a decision. Each one is stated below with the reason, because a PID
 * implementation is defined far more by its anti-windup and derivative
 * conventions than by the textbook `u = kp·e + ki·∫e + kd·ė`.
 *
 * ## Update form: `(setpoint, measurement, dt)` (decision, WP-8.1)
 *
 * {@link PIDController.update} takes the **setpoint and the measurement**
 * separately rather than a pre-computed error. The controller cannot implement
 * derivative-on-measurement (below) from an error alone — `de/dt` and
 * `−d(measurement)/dt` differ by exactly the setpoint's rate of change, which is
 * the whole point — so an error-only signature would fix the derivative
 * convention at the API boundary. It is also the form every production PID
 * (`simple-pid`, the Arduino PID library, industrial function blocks) uses, for
 * the same reason.
 *
 * A caller that genuinely has only an error signal passes it as the setpoint
 * with a zero measurement — `update(error, 0, dt)` — and constructs the
 * controller with `derivativeOn: "error"`, since a constant zero measurement has
 * no derivative to act on.
 *
 * ## Derivative on measurement, by default (decision, WP-8.1)
 *
 * With `derivativeOn: "measurement"` (the default) the derivative term is
 *
 * ```text
 * D = −kd · (measurement − previousMeasurement) / dt
 * ```
 *
 * A step change in the setpoint therefore moves the output by `kp · Δsetpoint`
 * and nothing more, instead of the `kd · Δsetpoint / dt` spike ("derivative
 * kick") that differentiating the error produces — a spike that is an artifact
 * of the operator moving a slider, not of the plant doing anything. The two
 * conventions are identical whenever the setpoint is constant — algebraically
 * `Δerror = −Δmeasurement` there, and the two expressions differ only in the
 * order of their subtractions — which is why this costs nothing in the steady
 * case. `derivativeOn: "error"` selects the textbook
 * form for teaching, comparison, and the error-only shape above.
 *
 * ## First step: no derivative (decision, WP-8.1)
 *
 * On the first {@link PIDController.update} after construction or
 * {@link PIDController.reset}, there is no previous sample, and any invented one
 * (zero, the current value, the setpoint) is a fiction that the `1/dt` factor
 * amplifies. The derivative term is therefore **exactly zero** for that step.
 * A discrete derivative needs two samples; the controller waits for the second
 * rather than guessing.
 *
 * ## Anti-windup: conditional integration (decision, WP-8.1)
 *
 * The integrator is advanced tentatively, and the step is **rejected** when the
 * resulting output is saturated by {@link PIDController.outputLimits} *and* the
 * error would push it further into that same limit:
 *
 * ```text
 * trial   = integral + error · dt
 * u       = kp·e + ki·trial + D
 * if clamp(u) ≠ u and error · (u − clamp(u)) > 0   → keep the old integral
 * else                                             → integral = trial
 * ```
 *
 * Two standard cures were available. Back-calculation feeds the saturation
 * excess back into the integrator through a tracking gain `Kt`; it de-saturates
 * smoothly, but `Kt` is a *fourth* tuning constant that §111's sketch does not
 * have, and a wrong `Kt` is its own failure mode. Conditional integration
 * ("integrator clamping") needs no new constant, and — decisive here — it is
 * **bit-identical to a plain PID whenever the output is not saturated**, so the
 * unsaturated response stays exactly the textbook recurrence that
 * `tests/pid.test.ts` checks against a closed form, and nothing about it varies
 * with tuning (§33).
 *
 * Note that the rule freezes the integrator whenever the *output* is saturated,
 * whatever term saturated it: while the actuator is pinned, integrating error is
 * accumulating a demand that cannot be delivered. Integration in the
 * *unwinding* direction is always allowed, so the controller leaves saturation
 * on the step the error changes sign rather than after a windup debt is repaid.
 *
 * ## Integral units, and the recurrence
 *
 * {@link PIDController.integral} is the gain-free accumulation `∫e dt` in
 * error·seconds, not the `ki`-scaled term, so retuning `ki` at runtime rescales
 * the whole history instead of leaving a stale term behind. The accumulation is
 * a forward rectangle using the *current* error, and the output uses the
 * *updated* integral:
 *
 * ```text
 * I_k = I_{k−1} + e_k · dt
 * u_k = kp·e_k + ki·I_k + D_k
 * ```
 *
 * ## `dt` (decision, WP-8.1)
 *
 * `deltaSeconds` is seconds (§7a) and must be finite and strictly positive. A
 * zero or negative step is rejected with a `RangeError` rather than silently
 * skipped: the derivative divides by it, and a controller asked to advance by no
 * time at all is a caller bug — commonly a millisecond value that has been
 * rounded to zero, or a clock that ran backwards.
 *
 * ## Determinism and allocation (§33, plan D7)
 *
 * The controller is a pure function of its inputs and its own state — it reads
 * no clock, and `update` allocates nothing (it returns a `number`). Two
 * controllers fed the same `(setpoint, measurement, dt)` sequence produce
 * bit-identical outputs.
 */

/** Which signal {@link PIDController} differentiates. See the module note. */
export type PIDDerivativeSource = "measurement" | "error";

/** §111's constructor options, plus the two documented convention knobs. */
export interface PIDControllerOptions {
  /** Proportional gain. Finite; may be zero or negative. */
  kp: number;
  /** Integral gain, per second. Finite. Default `0`. */
  ki?: number;
  /** Derivative gain, in seconds. Finite. Default `0`. */
  kd?: number;
  /**
   * `[minimum, maximum]` bounds on the returned output, in output units.
   * Neither may be `NaN`, `minimum <= maximum`, and infinities are allowed.
   * Default {@link DEFAULT_PID_OUTPUT_LIMITS} (unbounded). The pair is copied.
   */
  outputLimits?: readonly [number, number];
  /**
   * Signal the derivative term acts on. Default `"measurement"` (kick-free);
   * see the module note.
   */
  derivativeOn?: PIDDerivativeSource;
}

/** Unbounded output: `[-Infinity, Infinity]`. The default `outputLimits`. */
export const DEFAULT_PID_OUTPUT_LIMITS: readonly [number, number] =
  Object.freeze<[number, number]>([
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]);

/** Throws unless `value` is a finite number. */
function assertFiniteGain(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `PIDController ${what} must be a finite number; received ${String(value)}`,
    );
  }
}

/**
 * A textbook PID controller with the §111 constructor, clamped output, and the
 * anti-windup and derivative conventions documented on this module.
 *
 * ```ts
 * const controller = new PIDController({ kp: 2, ki: 0.5, kd: 0.1, outputLimits: [-10, 10] });
 *
 * // Once per fixed step (§10), with the injected simulation delta:
 * const torque = controller.update(targetSpeed, measuredSpeed, time.fixedDeltaTime);
 * ```
 *
 * The three gains are plain mutable fields so a control-system demonstration can
 * retune them live (§111's stated use). They are validated at construction only;
 * assigning a non-finite gain afterwards is the caller's responsibility.
 * {@link PIDController.outputLimits} and {@link PIDController.derivativeOn} are
 * fixed for the controller's lifetime — both change what the accumulated
 * integral *means*, so changing them would need a reset to be meaningful, and
 * building a second controller is clearer.
 */
export class PIDController {
  /** Proportional gain. Mutable for live tuning; see the class note. */
  kp: number;

  /** Integral gain, per second. Mutable for live tuning. */
  ki: number;

  /** Derivative gain, in seconds. Mutable for live tuning. */
  kd: number;

  /** `[minimum, maximum]` output bounds (§111 `outputLimits`). Frozen copy. */
  readonly outputLimits: readonly [number, number];

  /** Signal the derivative term acts on. */
  readonly derivativeOn: PIDDerivativeSource;

  /** `∫e dt` in error·seconds. */
  #integral = 0;

  /** Output returned by the most recent {@link PIDController.update}. */
  #lastOutput = 0;

  /** Error seen by the most recent {@link PIDController.update}. */
  #lastError = 0;

  /** Previous measurement, for the derivative. Meaningless until `#primed`. */
  #previousMeasurement = 0;

  /** Previous error, for the derivative. Meaningless until `#primed`. */
  #previousError = 0;

  /** Whether a previous sample exists (false on the first step after reset). */
  #primed = false;

  constructor(options: PIDControllerOptions) {
    const ki = options.ki ?? 0;
    const kd = options.kd ?? 0;
    assertFiniteGain(options.kp, "kp");
    assertFiniteGain(ki, "ki");
    assertFiniteGain(kd, "kd");

    const limits = options.outputLimits ?? DEFAULT_PID_OUTPUT_LIMITS;
    const [minimum, maximum] = limits;
    if (Number.isNaN(minimum) || Number.isNaN(maximum)) {
      throw new RangeError(
        `PIDController outputLimits must not contain NaN; received [${String(minimum)}, ${String(maximum)}]`,
      );
    }
    if (!(minimum <= maximum)) {
      throw new RangeError(
        `PIDController outputLimits must be [minimum, maximum] with minimum <= maximum; received [${String(minimum)}, ${String(maximum)}]`,
      );
    }

    this.kp = options.kp;
    this.ki = ki;
    this.kd = kd;
    this.outputLimits = Object.freeze<[number, number]>([minimum, maximum]);
    this.derivativeOn = options.derivativeOn ?? "measurement";
  }

  /** `∫e dt` so far, in error·seconds. Zero after {@link PIDController.reset}. */
  get integral(): number {
    return this.#integral;
  }

  /** The value the most recent {@link PIDController.update} returned; `0` after a reset. */
  get lastOutput(): number {
    return this.#lastOutput;
  }

  /** `setpoint − measurement` of the most recent update; `0` after a reset. */
  get lastError(): number {
    return this.#lastError;
  }

  /** Whether a previous sample exists, i.e. whether the next step has a derivative. */
  get primed(): boolean {
    return this.#primed;
  }

  /**
   * Advances the controller by `deltaSeconds` and returns the clamped output.
   *
   * Only `deltaSeconds` is validated: the setpoint and the measurement come from
   * the plant on the hot path and are taken as given, so a `NaN` measurement
   * propagates into the integrator rather than throwing. Validate sensor data
   * before it reaches a controller.
   *
   * @param setpoint - Desired value of the controlled quantity.
   * @param measurement - Current value of the controlled quantity.
   * @param deltaSeconds - Step in seconds (§7a); finite and `> 0`.
   * @throws RangeError if `deltaSeconds` is not a finite positive number.
   */
  update(setpoint: number, measurement: number, deltaSeconds: number): number {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      throw new RangeError(
        `PIDController.update deltaSeconds must be a finite positive number of seconds (§7a); received ${String(deltaSeconds)}`,
      );
    }

    const error = setpoint - measurement;
    const proportional = this.kp * error;

    let derivative = 0;
    if (this.#primed && this.kd !== 0) {
      derivative =
        this.derivativeOn === "measurement"
          ? (-this.kd * (measurement - this.#previousMeasurement)) /
            deltaSeconds
          : (this.kd * (error - this.#previousError)) / deltaSeconds;
    }

    const held = this.#integral;
    const trial = held + error * deltaSeconds;
    const minimum = this.outputLimits[0];
    const maximum = this.outputLimits[1];

    const unlimited = proportional + this.ki * trial + derivative;
    let output = unlimited < minimum ? minimum : unlimited;
    output = output > maximum ? maximum : output;

    if (output !== unlimited && error * (unlimited - output) > 0) {
      // Saturated, and this error would drive it further into the same limit:
      // reject the integration and re-evaluate with the held integral.
      const frozen = proportional + this.ki * held + derivative;
      output = frozen < minimum ? minimum : frozen;
      output = output > maximum ? maximum : output;
    } else {
      this.#integral = trial;
    }

    this.#previousMeasurement = measurement;
    this.#previousError = error;
    this.#primed = true;
    this.#lastError = error;
    this.#lastOutput = output;
    return output;
  }

  /**
   * Clears the integrator, the derivative history, and the reported last
   * output/error, returning the controller to its just-constructed state. The
   * gains, limits, and derivative convention are untouched.
   *
   * Reset when the loop is re-enabled, when the plant is teleported, or when a
   * replay rewinds (§33) — anything that makes the accumulated history describe
   * a plant that no longer exists.
   */
  reset(): void {
    this.#integral = 0;
    this.#lastOutput = 0;
    this.#lastError = 0;
    this.#previousMeasurement = 0;
    this.#previousError = 0;
    this.#primed = false;
  }
}
