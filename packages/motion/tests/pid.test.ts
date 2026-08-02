import { describe, expect, it } from "vitest";

import {
  DEFAULT_PID_OUTPUT_LIMITS,
  PIDController,
  type PIDControllerOptions,
} from "../src/pid.js";

const DT = 0.01;

/**
 * The §111 sketch, verbatim, as the options object.
 */
const SPEC_OPTIONS: PIDControllerOptions = {
  kp: 2,
  ki: 0.5,
  kd: 0.1,
  outputLimits: [-10, 10],
};

/**
 * A deliberately naive PID: the integrator always accumulates and the output is
 * clamped afterwards. This is the "no anti-windup" reference the module claims
 * to match while unsaturated and to beat while saturated.
 */
class NaivePID {
  integral = 0;

  #previousMeasurement = 0;

  #primed = false;

  constructor(
    readonly kp: number,
    readonly ki: number,
    readonly kd: number,
    readonly minimum = Number.NEGATIVE_INFINITY,
    readonly maximum = Number.POSITIVE_INFINITY,
  ) {}

  update(setpoint: number, measurement: number, dt: number): number {
    const error = setpoint - measurement;
    this.integral += error * dt;
    const derivative = this.#primed
      ? (-this.kd * (measurement - this.#previousMeasurement)) / dt
      : 0;
    this.#previousMeasurement = measurement;
    this.#primed = true;
    const output = this.kp * error + this.ki * this.integral + derivative;
    return Math.min(this.maximum, Math.max(this.minimum, output));
  }
}

describe("PIDController construction (§111)", () => {
  it("accepts the §111 sketch verbatim", () => {
    const controller = new PIDController(SPEC_OPTIONS);
    expect(controller.kp).toBe(2);
    expect(controller.ki).toBe(0.5);
    expect(controller.kd).toBe(0.1);
    expect(controller.outputLimits).toEqual([-10, 10]);
  });

  it("copies and freezes the output limits", () => {
    const limits: [number, number] = [-10, 10];
    const controller = new PIDController({ kp: 1, outputLimits: limits });
    limits[1] = 1000;
    expect(controller.outputLimits).toEqual([-10, 10]);
    expect(Object.isFrozen(controller.outputLimits)).toBe(true);
  });

  it("defaults ki, kd, the limits and the derivative source", () => {
    const controller = new PIDController({ kp: 1 });
    expect(controller.ki).toBe(0);
    expect(controller.kd).toBe(0);
    expect(controller.outputLimits).toEqual(DEFAULT_PID_OUTPUT_LIMITS);
    expect(controller.derivativeOn).toBe("measurement");
    expect(Object.isFrozen(DEFAULT_PID_OUTPUT_LIMITS)).toBe(true);
  });

  it("starts unprimed, with a zero integral and a zero last output", () => {
    const controller = new PIDController(SPEC_OPTIONS);
    expect(controller.primed).toBe(false);
    expect(controller.integral).toBe(0);
    expect(controller.lastOutput).toBe(0);
    expect(controller.lastError).toBe(0);
  });

  it("rejects non-finite gains", () => {
    expect(() => new PIDController({ kp: Number.NaN })).toThrow(RangeError);
    expect(
      () => new PIDController({ kp: 1, ki: Number.POSITIVE_INFINITY }),
    ).toThrow(/ki must be a finite number/);
    expect(() => new PIDController({ kp: 1, kd: Number.NaN })).toThrow(
      /kd must be a finite number/,
    );
  });

  it("rejects malformed output limits", () => {
    expect(
      () => new PIDController({ kp: 1, outputLimits: [Number.NaN, 1] }),
    ).toThrow(/must not contain NaN/);
    expect(
      () => new PIDController({ kp: 1, outputLimits: [0, Number.NaN] }),
    ).toThrow(/must not contain NaN/);
    expect(() => new PIDController({ kp: 1, outputLimits: [1, -1] })).toThrow(
      /minimum <= maximum/,
    );
  });

  it("accepts equal limits and infinite limits", () => {
    const pinned = new PIDController({ kp: 1, outputLimits: [2, 2] });
    expect(pinned.update(10, 0, DT)).toBe(2);
    const unbounded = new PIDController({
      kp: 1,
      outputLimits: [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
    });
    expect(unbounded.update(1e9, 0, DT)).toBe(1e9);
  });
});

describe("proportional-only response (exact)", () => {
  it("returns kp · error on every step", () => {
    const controller = new PIDController({ kp: 2 });
    for (let step = 0; step < 5; step += 1) {
      expect(controller.update(1, 0.25, DT)).toBe(1.5);
    }
    expect(controller.lastOutput).toBe(1.5);
    expect(controller.lastError).toBe(0.75);
  });

  it("still accumulates the (gain-free) integral when ki is zero", () => {
    const controller = new PIDController({ kp: 2 });
    controller.update(1, 0, DT);
    controller.update(1, 0, DT);
    expect(controller.integral).toBeCloseTo(2 * DT, 15);
    expect(controller.lastOutput).toBe(2);
  });

  it("is unaffected by the derivative on the first step", () => {
    const controller = new PIDController({ kp: 1, kd: 1000 });
    // A huge kd cannot matter: there is no previous sample yet.
    expect(controller.update(1, 0, DT)).toBe(1);
    expect(controller.primed).toBe(true);
    // The second step sees a measurement change and does differentiate it.
    expect(controller.update(1, 0.5, DT)).toBeCloseTo(
      0.5 - (1000 * 0.5) / DT,
      6,
    );
  });
});

describe("PI on a first-order plant vs the closed-form recurrence", () => {
  // Plant (explicit Euler):    y_{k+1} = y_k + dt · (−A·y_k + B·u_k)
  // Controller (this module):  I_k = I_{k−1} + e_k·dt,  u_k = kp·e_k + ki·I_k
  //
  // Substituting the controller into the plant makes the closed loop a linear
  // recurrence in z = [y, I]:
  //
  //   z_{k+1} = M·z_k + w
  //
  // whose solution is z_n = Mⁿ·(z₀ − z*) + z*, with the fixed point z* solving
  // (Id − M)·z* = w and Mⁿ evaluated by Cayley-Hamilton on the two eigenvalues.
  const A = 1;
  const B = 1;
  const KP = 0.5;
  const KI = 0.2;
  const R = 1;

  const gain = KP + KI * DT;
  const m11 = 1 - A * DT - B * DT * gain;
  const m12 = B * DT * KI;
  const m21 = -DT;
  const m22 = 1;

  // Fixed point: y* = R (row 2), and A·R = B·ki·I* ⇒ I* = A·R/(B·ki).
  const yStar = R;
  const iStar = (A * R) / (B * KI);

  const trace = m11 + m22;
  const determinant = m11 * m22 - m12 * m21;
  const discriminant = trace * trace - 4 * determinant;
  const root = Math.sqrt(discriminant);
  const lambda1 = (trace + root) / 2;
  const lambda2 = (trace - root) / 2;

  /** Closed-form output `y_n` of the loop started from `y₀ = 0`, `I₀ = 0`. */
  function closedFormY(n: number): number {
    // Mⁿ = c1·M + c0·Id  (distinct eigenvalues).
    const c1 = (lambda1 ** n - lambda2 ** n) / (lambda1 - lambda2);
    const c0 =
      -determinant *
      ((lambda1 ** (n - 1) - lambda2 ** (n - 1)) / (lambda1 - lambda2));
    const dy = 0 - yStar;
    const di = 0 - iStar;
    return (c1 * m11 + c0) * dy + c1 * m12 * di + yStar;
  }

  it("has two distinct real eigenvalues (the closed form is valid)", () => {
    expect(discriminant).toBeGreaterThan(0);
    expect(lambda1).not.toBe(lambda2);
  });

  it("tracks the closed form for 6000 steps", () => {
    const controller = new PIDController({ kp: KP, ki: KI });
    let y = 0;
    for (let n = 1; n <= 6000; n += 1) {
      const u = controller.update(R, y, DT);
      y += DT * (-A * y + B * u);
      expect(y).toBeCloseTo(closedFormY(n), 10);
    }
    // …and converges on the analytic fixed point.
    expect(y).toBeCloseTo(yStar, 3);
    expect(controller.integral).toBeCloseTo(iStar, 2);
  });
});

describe("derivative on measurement vs on error", () => {
  it("produces no derivative kick when the setpoint steps", () => {
    const onMeasurement = new PIDController({ kp: 1, kd: 0.5 });
    const onError = new PIDController({
      kp: 1,
      kd: 0.5,
      derivativeOn: "error",
    });
    // Prime both against a constant plant and a constant setpoint.
    for (const controller of [onMeasurement, onError]) {
      controller.update(0, 3, DT);
      controller.update(0, 3, DT);
    }
    // Now step the setpoint by +1 with the plant still frozen at 3.
    const kickFree = onMeasurement.update(1, 3, DT);
    const kicked = onError.update(1, 3, DT);
    expect(kickFree).toBeCloseTo(-2, 12);
    expect(kicked).toBeCloseTo(-2 + 0.5 / DT, 12);
    expect(Math.abs(kicked - kickFree)).toBeGreaterThan(45);
  });

  it("agrees with the error form to round-off while the setpoint is constant", () => {
    const onMeasurement = new PIDController({ kp: 1.5, ki: 0.3, kd: 0.2 });
    const onError = new PIDController({
      kp: 1.5,
      ki: 0.3,
      kd: 0.2,
      derivativeOn: "error",
    });
    let measurement = 0;
    for (let step = 0; step < 20; step += 1) {
      measurement += Math.sin(step) * 0.1;
      // Not bit-identical: `Δerror` subtracts the two setpoints back out, so the
      // two expressions round differently — they agree to ~1e-15, not to a bit.
      expect(onMeasurement.update(1, measurement, DT)).toBeCloseTo(
        onError.update(1, measurement, DT),
        12,
      );
    }
  });

  it("matches a naive PID exactly while nothing saturates", () => {
    const controller = new PIDController({ kp: 1.5, ki: 0.3, kd: 0.2 });
    const naive = new NaivePID(1.5, 0.3, 0.2);
    let measurement = 0;
    for (let step = 0; step < 50; step += 1) {
      measurement += Math.cos(step * 0.3) * 0.05;
      expect(controller.update(1, measurement, DT)).toBe(
        naive.update(1, measurement, DT),
      );
      expect(controller.integral).toBe(naive.integral);
    }
  });
});

describe("output limits", () => {
  it("clamps the output to both bounds", () => {
    const controller = new PIDController({ kp: 1000, outputLimits: [-10, 10] });
    expect(controller.update(1, 0, DT)).toBe(10);
    expect(controller.update(-1, 0, DT)).toBe(-10);
    expect(controller.lastOutput).toBe(-10);
  });

  it("leaves an unsaturated output untouched", () => {
    const controller = new PIDController({ kp: 2, outputLimits: [-10, 10] });
    expect(controller.update(1, 0, DT)).toBe(2);
  });
});

describe("anti-windup (conditional integration)", () => {
  it("freezes the integrator while the error drives further into a limit", () => {
    const controller = new PIDController({
      kp: 1,
      ki: 2,
      outputLimits: [-0.1, 0.1],
    });
    expect(controller.update(1, 0, DT)).toBe(0.1);
    expect(controller.integral).toBe(0);
    expect(controller.update(1, 0, DT)).toBe(0.1);
    expect(controller.integral).toBe(0);
  });

  it("still integrates in the unwinding direction while saturated", () => {
    // Build a large integral with a small ki (nothing saturates), then raise ki
    // so the accumulated term alone pins the output at its limit.
    const controller = new PIDController({
      kp: 0,
      ki: 0.1,
      outputLimits: [-1, 1],
    });
    expect(controller.update(5, 0, 1)).toBeCloseTo(0.5, 12);
    expect(controller.update(5, 0, 1)).toBeCloseTo(1, 12);
    expect(controller.integral).toBeCloseTo(10, 12);

    controller.ki = 0.5;
    // Error is now negative while the output is still saturated high: the step
    // unwinds the integrator instead of freezing it.
    expect(controller.update(-1, 0, 1)).toBe(1);
    expect(controller.integral).toBeCloseTo(9, 12);
  });

  it("bounds the integral and the overshoot on a rate-limited plant", () => {
    // Pure integrator plant driven by the (limited) controller output.
    const limits: [number, number] = [-0.1, 0.1];
    const controller = new PIDController({
      kp: 1,
      ki: 2,
      outputLimits: limits,
    });
    const naive = new NaivePID(1, 2, 0, limits[0], limits[1]);

    let clamped = 0;
    let naivePlant = 0;
    let clampedPeakIntegral = 0;
    let naivePeakIntegral = 0;
    let clampedOvershoot = 0;
    let naiveOvershoot = 0;

    const steps = 3000; // 30 s at dt = 0.01
    for (let step = 0; step < steps; step += 1) {
      clamped += controller.update(1, clamped, DT) * DT;
      naivePlant += naive.update(1, naivePlant, DT) * DT;
      clampedPeakIntegral = Math.max(
        clampedPeakIntegral,
        Math.abs(controller.integral),
      );
      naivePeakIntegral = Math.max(naivePeakIntegral, Math.abs(naive.integral));
      clampedOvershoot = Math.max(clampedOvershoot, clamped - 1);
      naiveOvershoot = Math.max(naiveOvershoot, naivePlant - 1);
    }

    // The clamped controller never accumulates a debt it cannot deliver…
    expect(clampedPeakIntegral).toBeLessThan(0.2);
    expect(naivePeakIntegral).toBeGreaterThan(4);
    // …so it settles onto the setpoint instead of overshooting it hugely…
    expect(clampedOvershoot).toBeLessThan(0.05);
    expect(naiveOvershoot).toBeGreaterThan(10 * clampedOvershoot);
    // …and it has left saturation by the end of the run, on target.
    expect(clamped).toBeCloseTo(1, 3);
    expect(Math.abs(controller.lastOutput)).toBeLessThan(limits[1]);
  });
});

describe("reset", () => {
  it("clears the integrator, the history and the reported state", () => {
    const controller = new PIDController(SPEC_OPTIONS);
    controller.update(1, 0, DT);
    controller.update(1, 0.4, DT);
    expect(controller.integral).not.toBe(0);
    expect(controller.primed).toBe(true);

    controller.reset();
    expect(controller.integral).toBe(0);
    expect(controller.lastOutput).toBe(0);
    expect(controller.lastError).toBe(0);
    expect(controller.primed).toBe(false);
    // Gains and limits survive.
    expect(controller.kp).toBe(2);
    expect(controller.outputLimits).toEqual([-10, 10]);
  });

  it("restores the first-step derivative behaviour", () => {
    const fresh = new PIDController({ kp: 1, kd: 1000 });
    const reused = new PIDController({ kp: 1, kd: 1000 });
    reused.update(0, 7, DT);
    reused.update(0, 7.5, DT);
    reused.reset();
    expect(reused.update(1, 0, DT)).toBe(fresh.update(1, 0, DT));
  });
});

describe("deltaSeconds validation", () => {
  const controller = new PIDController(SPEC_OPTIONS);

  it.each([0, -DT, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects deltaSeconds %p",
    (dt) => {
      expect(() => controller.update(1, 0, dt)).toThrow(RangeError);
      expect(() => controller.update(1, 0, dt)).toThrow(
        /finite positive number of seconds/,
      );
    },
  );

  it("leaves the controller untouched by a rejected step", () => {
    const rejected = new PIDController({ kp: 1, ki: 1 });
    rejected.update(1, 0, DT);
    const integral = rejected.integral;
    expect(() => rejected.update(1, 0, 0)).toThrow(RangeError);
    expect(rejected.integral).toBe(integral);
    expect(rejected.primed).toBe(true);
  });
});

describe("determinism (§33)", () => {
  it("two controllers fed the same sequence agree bit for bit", () => {
    const a = new PIDController(SPEC_OPTIONS);
    const b = new PIDController(SPEC_OPTIONS);
    let measurement = 0;
    for (let step = 0; step < 100; step += 1) {
      measurement += Math.sin(step * 0.7) * 0.3;
      expect(a.update(1, measurement, DT)).toBe(b.update(1, measurement, DT));
    }
    expect(a.integral).toBe(b.integral);
  });
});
