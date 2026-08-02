/**
 * Spring-damper controller (§111), the game-smoothing primitive.
 *
 * §111 lists "spring-damper controllers" beside the PID utility; §13's damped
 * spring is the same physics expressed as a *trajectory* — a closed form of time
 * released from rest towards a fixed rest position. A controller is the other
 * half: the target moves every frame (a camera chasing a character, a UI value
 * chasing an input, a follow-cam chasing a springy offset), so what is needed is
 * a **step** — "given where I am, how fast I am going, and where I want to be,
 * where am I one `dt` later?" — not a sampler.
 *
 * The system is the unit-mass damped oscillator, identical to §13's:
 *
 * ```text
 * x'' = −stiffness · (x − target) − damping · x'
 * ```
 *
 * with the two standard parameterizations, which this class accepts
 * interchangeably and always reports both of:
 *
 * ```text
 * ωₙ = √stiffness              stiffness = ωₙ²
 * ζ  = damping / (2ωₙ)         damping   = 2ζωₙ         ωₙ = 2π · frequencyHz
 * ```
 *
 * `ζ = 1` is critical damping — the fastest approach with no overshoot, the
 * setting nearly every piece of camera and UI smoothing wants; `ζ < 1`
 * oscillates, `ζ > 1` crawls in.
 *
 * ## Exact exponential step, not semi-implicit Euler (decision, WP-8.1)
 *
 * Each step is the **analytic solution** of the differential equation over
 * `[0, dt]`, holding the target constant across the step (a zero-order hold on
 * the input, which is exactly what a per-frame target is). Because the system is
 * linear, that solution is a 2×2 state-transition matrix applied to
 * `(x − target, v)`:
 *
 * ```text
 * ⎡x(dt) − target⎤   ⎡a11 a12⎤ ⎡x₀ − target⎤
 * ⎢              ⎥ = ⎢       ⎥ ⎢           ⎥
 * ⎣    v(dt)     ⎦   ⎣a21 a22⎦ ⎣    v₀     ⎦
 * ```
 *
 * whose entries depend only on `(stiffness, damping, dt)`. Per regime, with
 * `σ = ζωₙ`, `ω_d = ωₙ√(1−ζ²)`, `µ = ωₙ√(ζ²−1)`, `E = e^(−σ·dt)`:
 *
 * ```text
 * ζ < 1   a11 = E(cos ω_d dt + σ·sin ω_d dt/ω_d)   a12 = E·sin ω_d dt/ω_d
 *         a21 = −E·ωₙ²·sin ω_d dt/ω_d              a22 = E(cos ω_d dt − σ·sin ω_d dt/ω_d)
 * ζ = 1   a11 = E(1 + ωₙ dt)                       a12 = E·dt
 *         a21 = −E·ωₙ²·dt                          a22 = E(1 − ωₙ dt)
 * ζ > 1   a11 = (r₂e^(r₁dt) − r₁e^(r₂dt))/(r₂−r₁)  a12 = (e^(r₁dt) − e^(r₂dt))/(r₁−r₂)
 *         a21 = ωₙ²(e^(r₂dt) − e^(r₁dt))/(r₁−r₂)   a22 = (r₁e^(r₁dt) − r₂e^(r₂dt))/(r₁−r₂)
 * ```
 *
 * with `r₁,₂ = −σ ± µ`.
 *
 * The alternative — running the spring force through one of the §38 integrators
 * — was rejected *for this class*: semi-implicit Euler on a spring is only
 * stable while `dt < 2/ωₙ`, so a stiff smoother explodes on a frame spike, and
 * even below that limit its frequency is detuned by `O(dt²)`. The exact form is
 * unconditionally stable at every `dt` and every stiffness (a one-second hitch on
 * a 30 Hz spring lands on the target instead of NaN), it reproduces the analytic
 * solution to round-off rather than approximating it, and it composes: `n` steps
 * of `dt` equal one step of `n·dt` exactly, which is what makes a variable frame
 * rate not change the motion. The cost is three transcendental calls per
 * distinct `dt`, which is why they are cached.
 *
 * This is *not* a replacement for §38. A spring that is one force among many —
 * gravity, drag, contacts — must be integrated together with them by one of the
 * §38 integrators; the exact form only applies when the spring is the whole
 * system, which is precisely the smoothing case.
 *
 * ## Allocation and aliasing (plan D7)
 *
 * `update` and `updateVector3` write into a caller-supplied `out` record and
 * allocate nothing; the state-transition entries are cached per `dt`, so a fixed
 * step (§10) recomputes them never. Omitting `out` allocates a fresh record,
 * which is the authoring convenience, not the engine path (matching §13's
 * samplers).
 *
 * Every input is read into locals before any output is written, so **aliasing is
 * safe**: passing the same objects as `current`/`velocity` and as `out.value`/
 * `out.velocity` updates them in place, which is the normal way to keep a
 * smoother's state.
 *
 * ## Determinism (§33)
 *
 * Nothing here reads a clock, and the `dt` cache is a pure memo — the same
 * `(construction options, dt)` always yields the same entries, so the cache can
 * never change a result, only its cost.
 */

import { Vector3 } from "@four/math";

/** Spring described by its coefficients: `x'' = −stiffness·(x−target) − damping·x'`. */
export interface SpringDamperCoefficientOptions {
  /** Spring constant per unit mass, `ωₙ²`, in s⁻². Finite and `> 0`. */
  stiffness: number;
  /** Viscous damping per unit mass, `2ζωₙ`, in s⁻¹. Finite and `>= 0`. */
  damping: number;
}

/** Spring described by its natural frequency and damping ratio. */
export interface SpringDamperFrequencyOptions {
  /** Undamped natural frequency in hertz (§13 spelling). Finite and `> 0`. */
  frequencyHz: number;
  /** `< 1` oscillates, `1` critical, `> 1` overdamped. Finite and `>= 0`. */
  dampingRatio: number;
}

/**
 * Either parameterization of {@link SpringDamper}. The coefficient form is
 * distinguished at runtime by the presence of `stiffness`.
 */
export type SpringDamperOptions =
  SpringDamperCoefficientOptions | SpringDamperFrequencyOptions;

/** Scalar result record of {@link SpringDamper.update}. */
export interface SpringDamperResult {
  /** Value one step later. */
  value: number;
  /** Velocity one step later, per second. */
  velocity: number;
}

/** Vector result record of {@link SpringDamper.updateVector3}. */
export interface SpringDamperVector3Result {
  /** Value one step later. Written in place. */
  value: Vector3;
  /** Velocity one step later, per second. Written in place. */
  velocity: Vector3;
}

/** The three damping regimes, decided once at construction. */
type SpringRegime = "underdamped" | "critical" | "overdamped";

/** Throws unless `value` is a finite number satisfying the stated bound. */
function assertSpringParameter(
  value: number,
  what: string,
  allowZero: boolean,
): void {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new RangeError(
      `SpringDamper ${what} must be a finite number ${allowZero ? ">= 0" : "> 0"}; received ${String(value)}`,
    );
  }
}

/**
 * A spring-damper controller stepped by the exact exponential solution.
 *
 * ```ts
 * const smoother = new SpringDamper({ frequencyHz: 4, dampingRatio: 1 });
 * const state = { value: 0, velocity: 0 };
 *
 * // Once per frame or fixed step, with the injected delta:
 * smoother.update(state.value, target, state.velocity, deltaSeconds, state);
 * ```
 *
 * Construction is the only validated moment: the parameters are immutable, so a
 * retuned spring is a new instance (a mid-flight stiffness change would
 * invalidate the cached step and, more importantly, is a different physical
 * system — the caller should decide what happens to the velocity).
 */
export class SpringDamper {
  /** Spring constant per unit mass, `ωₙ²`, in s⁻². */
  readonly stiffness: number;

  /** Viscous damping per unit mass, `2ζωₙ`, in s⁻¹. */
  readonly damping: number;

  /** Undamped natural frequency `ωₙ` in radians per second. */
  readonly angularFrequency: number;

  /** Undamped natural frequency in hertz. */
  readonly frequencyHz: number;

  /** Damping ratio `ζ`: `< 1` oscillates, `1` critical, `> 1` overdamped. */
  readonly dampingRatio: number;

  /** Which closed form the step uses. */
  readonly #regime: SpringRegime;

  /** Decay rate `σ = ζωₙ`, in s⁻¹. */
  readonly #sigma: number;

  /** Damped frequency `ω_d`, or 0 when not underdamped. */
  readonly #dampedOmega: number;

  /** Slow pole `r₁ = −σ + µ` (overdamped only). */
  readonly #rate1: number;

  /** Fast pole `r₂ = −σ − µ` (overdamped only). */
  readonly #rate2: number;

  /** `dt` the cached entries belong to; `NaN` until the first step. */
  #cachedDelta = Number.NaN;

  /** Cached state-transition entries for {@link SpringDamper.#cachedDelta}. */
  #a11 = 1;

  #a12 = 0;

  #a21 = 0;

  #a22 = 1;

  constructor(options: SpringDamperOptions) {
    let stiffness: number;
    let damping: number;
    if ("stiffness" in options) {
      assertSpringParameter(options.stiffness, "stiffness", false);
      assertSpringParameter(options.damping, "damping", true);
      stiffness = options.stiffness;
      damping = options.damping;
    } else if ("frequencyHz" in options) {
      assertSpringParameter(options.frequencyHz, "frequencyHz", false);
      assertSpringParameter(options.dampingRatio, "dampingRatio", true);
      const omega = 2 * Math.PI * options.frequencyHz;
      stiffness = omega * omega;
      damping = 2 * options.dampingRatio * omega;
    } else {
      throw new TypeError(
        "SpringDamper options must supply either {stiffness, damping} or {frequencyHz, dampingRatio}",
      );
    }

    const omega = Math.sqrt(stiffness);
    const zeta = damping / (2 * omega);
    this.stiffness = stiffness;
    this.damping = damping;
    this.angularFrequency = omega;
    this.frequencyHz = omega / (2 * Math.PI);
    this.dampingRatio = zeta;
    this.#sigma = zeta * omega;

    // Regime by the same three-way comparison {@link DampedSpringTrajectory}
    // uses. The underdamped form divides by ω_d and the overdamped one by
    // 2µ; neither can be zero here, because in IEEE double a `ζ` strictly
    // below 1 has `ζ² < 1` (the square of the largest double below 1 is
    // `1 − 2⁻⁵²`, not 1) and likewise above.
    if (zeta < 1) {
      this.#regime = "underdamped";
      this.#dampedOmega = omega * Math.sqrt(1 - zeta * zeta);
      this.#rate1 = 0;
      this.#rate2 = 0;
    } else if (zeta === 1) {
      this.#regime = "critical";
      this.#dampedOmega = 0;
      this.#rate1 = 0;
      this.#rate2 = 0;
    } else {
      const mu = omega * Math.sqrt(zeta * zeta - 1);
      this.#regime = "overdamped";
      this.#dampedOmega = 0;
      this.#rate1 = -this.#sigma + mu;
      this.#rate2 = -this.#sigma - mu;
    }
  }

  /**
   * Advances one scalar spring by `deltaSeconds` towards `target`.
   *
   * @param current - Current value.
   * @param target - Value the spring pulls towards; held constant over the step.
   * @param velocity - Current rate of change, per second.
   * @param deltaSeconds - Step in seconds (§7a); finite and `> 0`.
   * @param out - Record written and returned; allocated when omitted.
   * @throws RangeError if `deltaSeconds` is not a finite positive number.
   */
  update(
    current: number,
    target: number,
    velocity: number,
    deltaSeconds: number,
    out?: SpringDamperResult,
  ): SpringDamperResult {
    this.#prepare(deltaSeconds);
    const displacement = current - target;
    const result = out ?? { value: 0, velocity: 0 };
    result.value = target + this.#a11 * displacement + this.#a12 * velocity;
    result.velocity = this.#a21 * displacement + this.#a22 * velocity;
    return result;
  }

  /**
   * Advances three independent springs — one per component — by `deltaSeconds`.
   *
   * Component-wise by construction: the entries depend only on the spring and
   * `deltaSeconds`, so each component is exactly what {@link SpringDamper.update}
   * would return for it. The vectors may alias `out`'s (see the module note).
   *
   * @param current - Current value.
   * @param target - Value the spring pulls towards; held constant over the step.
   * @param velocity - Current rate of change, per second.
   * @param deltaSeconds - Step in seconds (§7a); finite and `> 0`.
   * @param out - Record written and returned; allocated when omitted.
   * @throws RangeError if `deltaSeconds` is not a finite positive number.
   */
  updateVector3(
    current: Vector3,
    target: Vector3,
    velocity: Vector3,
    deltaSeconds: number,
    out?: SpringDamperVector3Result,
  ): SpringDamperVector3Result {
    this.#prepare(deltaSeconds);
    const a11 = this.#a11;
    const a12 = this.#a12;
    const a21 = this.#a21;
    const a22 = this.#a22;
    const dx = current.x - target.x;
    const dy = current.y - target.y;
    const dz = current.z - target.z;
    const vx = velocity.x;
    const vy = velocity.y;
    const vz = velocity.z;
    const result = out ?? { value: new Vector3(), velocity: new Vector3() };
    result.value.set(
      target.x + a11 * dx + a12 * vx,
      target.y + a11 * dy + a12 * vy,
      target.z + a11 * dz + a12 * vz,
    );
    result.velocity.set(
      a21 * dx + a22 * vx,
      a21 * dy + a22 * vy,
      a21 * dz + a22 * vz,
    );
    return result;
  }

  /** Validates `deltaSeconds` and refreshes the cached transition entries. */
  #prepare(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      throw new RangeError(
        `SpringDamper step deltaSeconds must be a finite positive number of seconds (§7a); received ${String(deltaSeconds)}`,
      );
    }
    if (deltaSeconds === this.#cachedDelta) {
      return;
    }
    this.#cachedDelta = deltaSeconds;

    const omega = this.angularFrequency;
    const sigma = this.#sigma;
    if (this.#regime === "underdamped") {
      const wd = this.#dampedOmega;
      const decay = Math.exp(-sigma * deltaSeconds);
      const cos = Math.cos(wd * deltaSeconds);
      const sinOverWd = Math.sin(wd * deltaSeconds) / wd;
      this.#a11 = decay * (cos + sigma * sinOverWd);
      this.#a12 = decay * sinOverWd;
      this.#a21 = -decay * omega * omega * sinOverWd;
      this.#a22 = decay * (cos - sigma * sinOverWd);
      return;
    }
    if (this.#regime === "critical") {
      const decay = Math.exp(-omega * deltaSeconds);
      this.#a11 = decay * (1 + omega * deltaSeconds);
      this.#a12 = decay * deltaSeconds;
      this.#a21 = -decay * omega * omega * deltaSeconds;
      this.#a22 = decay * (1 - omega * deltaSeconds);
      return;
    }
    const r1 = this.#rate1;
    const r2 = this.#rate2;
    const e1 = Math.exp(r1 * deltaSeconds);
    const e2 = Math.exp(r2 * deltaSeconds);
    const span = r1 - r2;
    this.#a11 = (r1 * e2 - r2 * e1) / span;
    this.#a12 = (e1 - e2) / span;
    this.#a21 = (omega * omega * (e2 - e1)) / span;
    this.#a22 = (r1 * e1 - r2 * e2) / span;
  }
}
