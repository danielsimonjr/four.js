# Units and numerical stability

four.js has one set of unit conventions, enforced everywhere, and a body of
stability guidance (§41) that exists because floating-point simulation
punishes casual numbers. This guide states both, with the measured facts
behind the advice.

## The conventions (§7a, §40)

- **Length:** world units. For physics, treat one unit as one meter — every
  default (gravity −9.81, densities, damping) assumes SI.
- **Angle: radians.** Everywhere, no exceptions. `Math.PI / 2` is a quarter
  turn; `setFromAxisAngle(axis, Math.PI)` is half.
- **Time: seconds.** Every engine time — tween durations, timeline positions,
  clip keys, `fixedTimeStep`, joint damping — is seconds. There are **no
  milliseconds anywhere** in the API; the one conversion lives at the frame
  loop boundary (`(now - last) / 1000`).
- **Y is up, in 2D and in 3D** (§7a). 2D gravity is negative Y.
- **Mass: kilograms**, derived from collider density (kg/m² in 2D, kg/m³ in
  3D) unless explicitly authored (§23).

§40 sketches a `UnitSystem` record for engineering applications that must
_display_ other units. Honest state: no `UnitSystem` API has shipped. The
engine's internal representation and every signature are radians and seconds
regardless — §40 is explicit that the record would govern display and
authoring-input conversion only — so today the conversion layer is yours.

```ts
// Display-side conversion helpers stay outside the engine:
const RPM_TO_RAD_PER_S = (2 * Math.PI) / 60;
hinge.setMotor({
  enabled: true,
  targetVelocity: 300 * RPM_TO_RAD_PER_S, // the API takes rad/s, always
  maxTorque: 400,
});
```

## Fixed timesteps are the foundation (§10, §41)

A variable-step solver trades stability for convenience and loses. four.js
steps physics at a fixed `fixedTimeStep` (default 1/60 s) and renders by
interpolation — see the [fixed-step guide](fixed-step-simulation.md). Do not
shrink `maximumSubSteps` to "catch up" a slow machine; dropped time
(`TimeState.droppedTime`) is the designed overload behaviour.

## A worked stability example

Damping and stiffness interact with the step size. The spring in
`examples/mechanism` is a worked case; here is the same reasoning on a §27
drag field:

```ts
import {
  ParticleEmitter,
  dragField,
  uniformGravityField,
} from "four/particles";
import { Vector3 } from "four/math";

const emitter = new ParticleEmitter({
  maxParticles: 2000,
  seed: 1234, // §33: seeds are constants, never entropy
  position: new Vector3(0, 0, 0),
  emissionRate: 400,
  lifetime: { min: 1, max: 2 }, // seconds
  initialSpeed: { min: 4, max: 6 }, // units per second
  direction: new Vector3(0, 1, 0),
  spreadAngle: 0.3, // radians — a cone half-angle
  size: { start: 0.08, end: 0.02 },
  color: {
    start: { r: 1, g: 0.7, b: 0.3, a: 1 },
    end: { r: 1, g: 0.2, b: 0.1, a: 0 },
  },
  fields: [
    uniformGravityField(new Vector3(0, -9.81, 0)),
    // Explicit-Euler drag is stable only while c·dt < 1. At 60 Hz, c = 0.35
    // gives c·dt ≈ 0.0058 — far inside the bound. c = 70 would not be.
    dragField(0.35),
  ],
});
```

## The §41 checklist

- **Mass ratios.** Iterative solvers resolve a contact between a 1 kg and a
  10 000 kg body poorly; keep interacting bodies within ~100× of each other,
  or link them through intermediate masses.
- **World scale.** Sizes far from ~0.1–10 units strain contact tolerances
  (collision margins are absolute). Model a bearing in meters, not
  millimeters-as-units, or scale the whole world consistently.
- **Distance from origin.** 32-bit float positions lose sub-millimeter
  fidelity beyond roughly **1e5 units** from the origin. Release 1.0 supports
  coordinates within that envelope; validation (§85) warns beyond it.
  Camera-relative rendering is the reserved extension for larger worlds.
- **Long sessions.** `TimeState.realTime` is a double and stays precise over
  multi-day sessions; still prefer relative times in application math.
- **Damping is not friction.** Damping removes velocity proportionally
  everywhere; friction removes it at contacts against the normal force. A
  mechanism that "slows down in mid-air" has damping where it wanted
  friction.
- **Solver iterations.** More iterations stiffen constraint stacks at CPU
  cost. Honest gap: §28's iteration count is **not yet exposed** through the
  adapter seam (recorded TODO).
- **CCD.** `ccdMode: "speculative"` on a fast body's `RigidBody` prevents
  tunnelling and costs per-body; the default is `"disabled"` — leave it there
  for slow bodies (§31).
- **Determinism-sensitive math.** Checksums quantize to a 1e-6 grid (§33);
  keep gameplay thresholds coarser than that, and never compare floats for
  equality across platforms.

Two measured facts worth internalizing: the accumulator's own ULP drift can
move a boundary-sitting event by one step (pinned, Phase 4), and identical
scenes hash identically across 2D and 3D solvers — so any divergence you see
was authored, not accumulated (Phase 5 exit).

## Cross-references

- §7a/§7b (conventions), §40 (units), §41 (stability), §33 (quantization),
  §85 (validation warnings), §86 (targets).
- `examples/mechanism` — spring stiffness/damping chosen against the step;
  its module header derives every number.
