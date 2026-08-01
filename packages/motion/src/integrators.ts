/**
 * Numerical integrators (§38).
 *
 * §38 names five integrators for "built-in lightweight motion":
 *
 * ```ts
 * type Integrator =
 *   | "explicit-euler"
 *   | "semi-implicit-euler"
 *   | "velocity-verlet"
 *   | "rk2"
 *   | "rk4";
 * ```
 *
 * All five are implemented here as plain functions over the same
 * {@link IntegratorState} / {@link IntegratorFn} pair, plus the name-keyed
 * {@link INTEGRATORS} record so a `Integrator` string (from options, a scene
 * file, or a UI) resolves to a function without a `switch`.
 *
 * Every integrator advances one second-order system
 *
 * ```text
 * x' = v
 * v' = a(x, v, t)
 * ```
 *
 * by `dt` seconds (§7a: all times are seconds), **mutating `state` in place**
 * and returning nothing. The acceleration is supplied as a callback rather than
 * a force list so the same integrators serve motion components, particles, and
 * spring/ballistic previews without any of them agreeing on a force model.
 *
 * ## Allocation (§7b, plan D7)
 *
 * Stepping allocates nothing. The intermediate evaluation points live in
 * module-level scratch objects that are fully overwritten before they are read,
 * and the callback is handed an `out` vector to write into. The consequence is
 * that these functions are **not re-entrant**: an acceleration callback must not
 * itself call an integrator (directly or indirectly), because the nested call
 * would overwrite the outer call's scratch. Nothing in the engine does this, and
 * the alternative — a fresh scratch state per step — would allocate on the hot
 * path.
 *
 * The scratch is write-before-read, so it carries no state between calls and is
 * never part of a determinism checksum (§33). Nothing here reads a clock: `t` is
 * injected by the caller.
 *
 * ## Contract for the acceleration callback
 *
 * - It receives the state to evaluate at (which is the caller's own `state`
 *   object only for the first evaluation of a step — the intermediate ones are
 *   scratch), the absolute time of that evaluation in seconds, and an `out`
 *   vector.
 * - It must **not** mutate the state it is given.
 * - It should write its result into `out` and return it. Returning a different
 *   vector is supported (the integrators read the returned value, never `out`),
 *   but that vector must stay valid until the integrator's next call.
 *
 * ## Choosing one (§38 recommendations)
 *
 * - {@link semiImplicitEuler} — simple real-time rigid motion; the engine
 *   default ({@link DEFAULT_INTEGRATOR}) and the update rule the §11
 *   `MotionComponent` uses.
 * - {@link velocityVerlet} — conservative particle systems; second order and
 *   symplectic, so orbital and spring energy stays bounded.
 * - {@link rk4} — small, smooth engineering demonstrations where accuracy
 *   matters more than cost (four acceleration evaluations per step).
 * - {@link explicitEuler} — reference and teaching only. It is first order and
 *   *anti*-damped on oscillatory systems: a spring integrated with it gains
 *   energy every step. `tests/integrators.test.ts` asserts exactly that, so the
 *   difference is not folklore.
 * - {@link rk2} — midpoint method; second order, two evaluations, no symplectic
 *   guarantee.
 */

import { Vector3 } from "@four/math";

/**
 * The §38 integrator names, verbatim. Keys of {@link INTEGRATORS}.
 */
export type Integrator =
  "explicit-euler" | "semi-implicit-euler" | "velocity-verlet" | "rk2" | "rk4";

/**
 * The pair of vectors an integrator advances.
 *
 * A structural type on purpose: any object exposing a `position` and a
 * `velocity` — a `MotionComponent` paired with a transform, a particle record,
 * a throwaway literal in a test — can be integrated without adapting to a class.
 * The vectors are mutated in place, so hooked vectors (plan D3) fire their
 * change hook once per component write.
 */
export type IntegratorState = { position: Vector3; velocity: Vector3 };

/**
 * Acceleration of `state` at absolute time `t`, written into `out`.
 *
 * See the module documentation for the full contract (do not mutate `state`;
 * write into `out` and return it).
 */
export type AccelerationFn = (
  state: IntegratorState,
  t: number,
  out: Vector3,
) => Vector3;

/**
 * Advances `state` from `t` to `t + dt` in place, using `acceleration` for the
 * right-hand side. Returns nothing — the result *is* the mutated state.
 *
 * This is exactly the signature pinned by the implementation plan (WP-2.1);
 * {@link AccelerationFn} is a name for the callback type, not a change to it.
 */
export type IntegratorFn = (
  state: IntegratorState,
  acceleration: AccelerationFn,
  t: number,
  dt: number,
) => void;

/**
 * Intermediate evaluation point shared by every integrator. Fully overwritten
 * before each use; see the module note on re-entrancy.
 */
const scratchState: IntegratorState = {
  position: new Vector3(),
  velocity: new Vector3(),
};

/** `out` handed to the acceleration callback. */
const scratchAcceleration = new Vector3();

/**
 * Explicit (forward) Euler — first order.
 *
 * ```text
 * a = f(x, v, t)
 * x += v · dt          (the *old* velocity)
 * v += a · dt
 * ```
 *
 * Position uses the velocity from the start of the step, which is what makes it
 * differ from {@link semiImplicitEuler} and what makes it inject energy into
 * oscillators. Under constant acceleration it lags the exact solution by
 * `0.5 · a · t · dt`.
 */
export const explicitEuler: IntegratorFn = (
  state,
  acceleration,
  t,
  dt,
): void => {
  const { position, velocity } = state;
  const vx = velocity.x;
  const vy = velocity.y;
  const vz = velocity.z;
  const a = acceleration(state, t, scratchAcceleration);
  const ax = a.x;
  const ay = a.y;
  const az = a.z;
  position.set(
    position.x + vx * dt,
    position.y + vy * dt,
    position.z + vz * dt,
  );
  velocity.set(vx + ax * dt, vy + ay * dt, vz + az * dt);
};

/**
 * Semi-implicit (symplectic) Euler — first order, energy-bounded.
 *
 * ```text
 * a = f(x, v, t)
 * v += a · dt
 * x += v · dt          (the *new* velocity)
 * ```
 *
 * §38's recommended default for simple real-time rigid motion, and the shape of
 * the `MotionComponent` update (which additionally applies damping and the
 * speed clamp between the two half-updates). Under constant acceleration it
 * leads the exact solution by `0.5 · a · t · dt`.
 */
export const semiImplicitEuler: IntegratorFn = (
  state,
  acceleration,
  t,
  dt,
): void => {
  const { position, velocity } = state;
  const a = acceleration(state, t, scratchAcceleration);
  const vx = velocity.x + a.x * dt;
  const vy = velocity.y + a.y * dt;
  const vz = velocity.z + a.z * dt;
  velocity.set(vx, vy, vz);
  position.set(
    position.x + vx * dt,
    position.y + vy * dt,
    position.z + vz * dt,
  );
};

/**
 * Velocity Verlet — second order, symplectic, two acceleration evaluations.
 *
 * ```text
 * a0     = f(x, v, t)
 * x     += v · dt + 0.5 · a0 · dt²
 * vHalf  = v + 0.5 · a0 · dt
 * a1     = f(x, vHalf, t + dt)
 * v      = vHalf + 0.5 · a1 · dt
 * ```
 *
 * §38's recommendation for conservative particle systems. The second evaluation
 * needs a velocity that is not yet known, so the half-step velocity is used —
 * the standard treatment, exact for velocity-independent forces and first-order
 * accurate in the velocity-dependent term. It is exact for constant
 * acceleration.
 *
 * The caller's `state` is written once, at the end: the second evaluation sees a
 * scratch state, so a hooked position/velocity fires its change hook exactly
 * once per step.
 */
export const velocityVerlet: IntegratorFn = (
  state,
  acceleration,
  t,
  dt,
): void => {
  const { position, velocity } = state;
  const x = position.x;
  const y = position.y;
  const z = position.z;
  const vx = velocity.x;
  const vy = velocity.y;
  const vz = velocity.z;

  const a0 = acceleration(state, t, scratchAcceleration);
  const half = dt * 0.5;
  const halfDtSquared = dt * half;

  const nx = x + vx * dt + a0.x * halfDtSquared;
  const ny = y + vy * dt + a0.y * halfDtSquared;
  const nz = z + vz * dt + a0.z * halfDtSquared;
  const hvx = vx + a0.x * half;
  const hvy = vy + a0.y * half;
  const hvz = vz + a0.z * half;

  scratchState.position.set(nx, ny, nz);
  scratchState.velocity.set(hvx, hvy, hvz);
  const a1 = acceleration(scratchState, t + dt, scratchAcceleration);

  position.set(nx, ny, nz);
  velocity.set(hvx + a1.x * half, hvy + a1.y * half, hvz + a1.z * half);
};

/**
 * Midpoint Runge-Kutta (RK2) — second order, two acceleration evaluations.
 *
 * The state derivative is evaluated at the start of the step and again at the
 * midpoint of the resulting trajectory; the midpoint derivative advances the
 * whole step. Exact for constant acceleration. Not symplectic — an undamped
 * spring loses a little energy per step rather than gaining it.
 */
export const rk2: IntegratorFn = (state, acceleration, t, dt): void => {
  const { position, velocity } = state;
  const x = position.x;
  const y = position.y;
  const z = position.z;
  const vx = velocity.x;
  const vy = velocity.y;
  const vz = velocity.z;
  const half = dt * 0.5;

  const a1 = acceleration(state, t, scratchAcceleration);
  const k1vx = a1.x;
  const k1vy = a1.y;
  const k1vz = a1.z;

  // Midpoint of the step: position advanced by the current velocity, velocity
  // advanced by the current acceleration.
  const k2xx = vx + k1vx * half;
  const k2xy = vy + k1vy * half;
  const k2xz = vz + k1vz * half;
  scratchState.position.set(x + vx * half, y + vy * half, z + vz * half);
  scratchState.velocity.set(k2xx, k2xy, k2xz);
  const a2 = acceleration(scratchState, t + half, scratchAcceleration);

  position.set(x + k2xx * dt, y + k2xy * dt, z + k2xz * dt);
  velocity.set(vx + a2.x * dt, vy + a2.y * dt, vz + a2.z * dt);
};

/**
 * Classical Runge-Kutta (RK4) — fourth order, four acceleration evaluations.
 *
 * §38's recommendation for "small, smooth engineering demonstrations where
 * accuracy matters more than cost". Exact for constant acceleration, and
 * accurate to `O(dt⁴)` on smooth systems; like every explicit RK method it is
 * not symplectic, so an undamped spring decays very slowly over long runs.
 *
 * `k1…k4` below are the four `(velocity, acceleration)` derivative samples of
 * the standard tableau; the position slopes `kNx` are the velocities of the
 * evaluation points.
 */
export const rk4: IntegratorFn = (state, acceleration, t, dt): void => {
  const { position, velocity } = state;
  const x = position.x;
  const y = position.y;
  const z = position.z;
  const vx = velocity.x;
  const vy = velocity.y;
  const vz = velocity.z;
  const half = dt * 0.5;

  const a1 = acceleration(state, t, scratchAcceleration);
  const k1vx = a1.x;
  const k1vy = a1.y;
  const k1vz = a1.z;

  const k2xx = vx + k1vx * half;
  const k2xy = vy + k1vy * half;
  const k2xz = vz + k1vz * half;
  scratchState.position.set(x + vx * half, y + vy * half, z + vz * half);
  scratchState.velocity.set(k2xx, k2xy, k2xz);
  const a2 = acceleration(scratchState, t + half, scratchAcceleration);
  const k2vx = a2.x;
  const k2vy = a2.y;
  const k2vz = a2.z;

  const k3xx = vx + k2vx * half;
  const k3xy = vy + k2vy * half;
  const k3xz = vz + k2vz * half;
  scratchState.position.set(x + k2xx * half, y + k2xy * half, z + k2xz * half);
  scratchState.velocity.set(k3xx, k3xy, k3xz);
  const a3 = acceleration(scratchState, t + half, scratchAcceleration);
  const k3vx = a3.x;
  const k3vy = a3.y;
  const k3vz = a3.z;

  const k4xx = vx + k3vx * dt;
  const k4xy = vy + k3vy * dt;
  const k4xz = vz + k3vz * dt;
  scratchState.position.set(x + k3xx * dt, y + k3xy * dt, z + k3xz * dt);
  scratchState.velocity.set(k4xx, k4xy, k4xz);
  const a4 = acceleration(scratchState, t + dt, scratchAcceleration);

  const sixth = dt / 6;
  position.set(
    x + sixth * (vx + 2 * k2xx + 2 * k3xx + k4xx),
    y + sixth * (vy + 2 * k2xy + 2 * k3xy + k4xy),
    z + sixth * (vz + 2 * k2xz + 2 * k3xz + k4xz),
  );
  velocity.set(
    vx + sixth * (k1vx + 2 * k2vx + 2 * k3vx + a4.x),
    vy + sixth * (k1vy + 2 * k2vy + 2 * k3vy + a4.y),
    vz + sixth * (k1vz + 2 * k2vz + 2 * k3vz + a4.z),
  );
};

/**
 * The five §38 integrators keyed by their §38 names.
 *
 * Frozen so a caller cannot swap an integrator out from under everyone else;
 * pick one with `INTEGRATORS[name]`.
 */
export const INTEGRATORS: Readonly<Record<Integrator, IntegratorFn>> =
  Object.freeze({
    "explicit-euler": explicitEuler,
    "semi-implicit-euler": semiImplicitEuler,
    "velocity-verlet": velocityVerlet,
    rk2,
    rk4,
  });

/**
 * §38's recommended default for simple real-time rigid motion, and what the
 * §11 motion system uses.
 */
export const DEFAULT_INTEGRATOR: Integrator = "semi-implicit-euler";
