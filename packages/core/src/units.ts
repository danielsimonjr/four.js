/**
 * The §40 unit system — **display and authoring conversion only** (§40, §98).
 *
 * ## Read this before using anything below
 *
 * Declaring a {@link UnitSystem} **does not change what the engine computes**.
 * There is no unit mode. Nothing in `@four/scene`, `@four/motion`,
 * `@four/physics`, or any renderer reads a `UnitSystem`, and no engine
 * signature anywhere takes one. Internally and at every API boundary four.js is
 * and stays:
 *
 * - **angles in radians** — always, no exceptions (§7a);
 * - **times in seconds** — tween durations, timeline positions, clip keys,
 *   `fixedTimeStep`, joint damping; there are no milliseconds anywhere in the
 *   API (§7a);
 * - **lengths and masses in world units**, which the physics defaults treat as
 *   metres and kilograms (§23, Appendix A).
 *
 * §40 is explicit about this, and it is the one sentence in this module that
 * matters: *"The `angle` and `time` selections govern display and
 * authoring-input conversion only: the engine's internal representation and
 * every API signature remain radians and seconds (§7a). The `scale` factors
 * relate world units to SI for physics; they do not change API units."*
 * (Spec revision 1.3, 2026-07-29, which narrowed §40 to exactly this.)
 *
 * So the failure mode this header exists to prevent is someone reading
 * `{ angle: "degree" }` as "the engine now takes degrees". It does not. What a
 * `UnitSystem` buys you is that §40's audience — *"engineering applications
 * must be able to declare and display units explicitly"* — can carry one
 * declared record from its inspector to its readouts to its authoring fields,
 * instead of scattering `* 180 / Math.PI` through a UI layer.
 *
 * ## Where these functions may be called
 *
 * At the **edges**: a property inspector rendering a rotation, a form parsing
 * an authored duration, a CSV export, a debug overlay label. Author in display
 * units, convert **once** with {@link angleFromDisplay} and friends, and hand
 * the engine the radians/seconds/world-units value it has always taken.
 *
 * They must **never** be called from a simulation path — inside `fixedUpdate`,
 * a solver step, a motion integrator, a render-item loop, or anything reachable
 * from them. Two reasons, both hard:
 *
 * 1. **Determinism (§33–§34).** A conversion is a multiply and a divide by a
 *    factor that is generally not exact in binary floating point
 *    (`Math.PI / 180` is not; `0.001` is not). Round-tripping a value through
 *    display units and back changes it in the last bits for roughly one input
 *    in twelve — see "Round-tripping" below. A simulation that did that would
 *    diverge from a replay of itself, and the checksum tests would be right to
 *    fail. Nothing here contains a compensation trick or a tolerance fudge for
 *    this: the only safe answer is not to run conversions inside the loop.
 * 2. **They buy nothing there.** The solver has no notion of a display unit;
 *    converting into one and back is pure loss.
 *
 * `tests/integration/units-display.test.ts` enforces the rule mechanically: it
 * fails if any module under `packages/<name>/src` outside this file imports it.
 *
 * ## Round-tripping
 *
 * `fromDisplay(toDisplay(v))` is **exactly** `v` when the display unit is the
 * engine unit (`"radian"`, `"second"`, and any length/mass configuration whose
 * factor resolves to 1, including every `"custom"` one). Otherwise it is
 * correct to within a unit in the last place but **not bit-identical**:
 * measured over 2 000 samples, 8.8 % of degree round trips and 2.5 % of
 * millisecond round trips differ from their input in the last bit. That is
 * ordinary IEEE-754 behaviour, it is documented rather than papered over, and
 * it is the second reason these helpers stay out of the simulation.
 *
 * Both directions of a pair are written against the **same** constant (divide
 * one way, multiply the other) rather than against a precomputed reciprocal,
 * which is what makes the identity cases exact.
 *
 * ## What this module deliberately does not do
 *
 * - **No `PhysicsWorldOptions.units` and no `ApplicationOptions.units`.** §45's
 *   option record does not list one, so adding it would be inventing API. §101
 *   assigns *"unit application in simulation"* to `@four/physics` (reading
 *   `scale.lengthToMeters` for the §41 precision envelope, for instance); that
 *   is a `@four/physics` packet and is staged, not shipped here (2026-08-07).
 * - **No text parsing.** `parseAngle("90°")` needs a locale, a symbol table,
 *   and a failure policy; the numeric authoring direction
 *   ({@link angleFromDisplay}) is the part §40 actually asks for. Staged
 *   2026-08-07.
 * - **No label for `"custom"`.** §40's record carries a `"custom"` selector but
 *   no field naming the unit, so the engine has no name to print;
 *   {@link unitSymbol} returns `""` and the application supplies its own.
 * - **No serialization of the unit system into the §79 document header.** That
 *   depends on a format revision (gap item A-16) and is staged 2026-08-07.
 */

import { FourError } from "./errors.js";

/** §40 length selector. `"custom"` means "the world unit is the display unit". */
export type LengthUnit = "meter" | "centimeter" | "millimeter" | "custom";

/** §40 mass selector. `"custom"` means "the world unit is the display unit". */
export type MassUnit = "kilogram" | "gram" | "custom";

/**
 * §40 time selector — **display only**. Every engine time stays in seconds
 * (§7a); selecting `"millisecond"` changes no signature anywhere.
 */
export type TimeUnit = "second" | "millisecond";

/**
 * §40 angle selector — **display only**. Every engine angle stays in radians
 * (§7a); selecting `"degree"` changes no signature anywhere.
 */
export type AngleUnit = "radian" | "degree";

/** Which physical quantity a symbol or conversion is about. */
export type UnitQuantity = "length" | "mass" | "time" | "angle";

/**
 * §40's SI relation for world units.
 *
 * These are the only two numbers in the record that mean anything to physics:
 * they say what one world unit *is*, so an application can state that its world
 * is authored in centimetres (`lengthToMeters: 0.01`) without every density,
 * gravity, and damping default silently lying about it. They do not change API
 * units — a position is still a number of world units on both sides.
 */
export interface UnitScale {
  /** Metres per world length unit. Finite and greater than zero. */
  readonly lengthToMeters: number;
  /** Kilograms per world mass unit. Finite and greater than zero. */
  readonly massToKilograms: number;
}

/**
 * The §40 record, verbatim in shape and read-only in fact.
 *
 * §40 writes the fields mutable; {@link resolveUnitSystem} returns a frozen
 * value and the type says so, because a record that half the UI has captured
 * and one component mutates is a bug with no good failure mode. Build a new one
 * instead — it is four strings and two numbers.
 */
export interface UnitSystem {
  readonly length: LengthUnit;
  readonly mass: MassUnit;
  readonly time: TimeUnit;
  readonly angle: AngleUnit;
  readonly scale: UnitScale;
}

/** Partial input to {@link resolveUnitSystem}; omitted fields take SI defaults. */
export interface UnitSystemInit {
  length?: LengthUnit;
  mass?: MassUnit;
  time?: TimeUnit;
  angle?: AngleUnit;
  scale?: {
    lengthToMeters?: number;
    massToKilograms?: number;
  };
}

/**
 * §40's *"recommended physics default"*: metre, kilogram, second, radian, and a
 * world unit that is exactly one metre and one kilogram.
 *
 * Frozen and shared. Every conversion in this module is the identity under this
 * system, which is the point: an application that never mentions units gets
 * precisely the behaviour it has today, at no cost, and
 * {@link resolveUnitSystem} returns this very object when called with nothing.
 */
export const SI_UNITS: UnitSystem = Object.freeze({
  length: "meter",
  mass: "kilogram",
  time: "second",
  angle: "radian",
  scale: Object.freeze({ lengthToMeters: 1, massToKilograms: 1 }),
});

/** Radians in one degree. One constant, used in both directions (see header). */
const RADIANS_PER_DEGREE = Math.PI / 180;

/** Seconds in one millisecond. Exact in binary? No — see "Round-tripping". */
const SECONDS_PER_MILLISECOND = 0.001;

/** Metres in one of each named §40 length unit. `"custom"` is resolved per system. */
const METERS_PER_LENGTH_UNIT: Readonly<Record<string, number>> = Object.freeze({
  meter: 1,
  centimeter: 0.01,
  millimeter: 0.001,
});

/** Kilograms in one of each named §40 mass unit. */
const KILOGRAMS_PER_MASS_UNIT: Readonly<Record<string, number>> = Object.freeze(
  {
    kilogram: 1,
    gram: 0.001,
  },
);

/** Display symbols, for {@link unitSymbol}. `"custom"` has no name in §40. */
const SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  meter: "m",
  centimeter: "cm",
  millimeter: "mm",
  kilogram: "kg",
  gram: "g",
  second: "s",
  millisecond: "ms",
  radian: "rad",
  degree: "°",
  custom: "",
});

const LENGTH_UNITS: readonly LengthUnit[] = [
  "meter",
  "centimeter",
  "millimeter",
  "custom",
];
const MASS_UNITS: readonly MassUnit[] = ["kilogram", "gram", "custom"];
const TIME_UNITS: readonly TimeUnit[] = ["second", "millisecond"];
const ANGLE_UNITS: readonly AngleUnit[] = ["radian", "degree"];

/**
 * Validates one selector against its §40 union.
 *
 * TypeScript catches a bad literal at compile time; this catches the values
 * that arrive from a JSON settings file, a `<select>`, or a plugin — the
 * "invalid" half of §85's development detection, which is about values the type
 * system never saw.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` naming the field and the
 * accepted set
 */
function selector<T extends string>(
  value: T | undefined,
  allowed: readonly T[],
  fallback: T,
  field: string,
): T {
  if (value === undefined) {
    return fallback;
  }
  if (!allowed.includes(value)) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `UnitSystem.${field} must be one of ${allowed.join(", ")} (§40); got ${JSON.stringify(value)}.`,
      { context: { field, allowed: [...allowed], found: value } },
    );
  }
  return value;
}

/**
 * Validates one §40 scale factor.
 *
 * §85 asks development builds to detect *"NaN and infinite values"* and
 * *"unstable scales and extreme ratios"*. A scale factor is the extreme case of
 * both: zero makes every SI conversion collapse to zero, a negative one mirrors
 * the world, and `NaN` or `Infinity` poisons every derived readout silently.
 * All four are refused here rather than clamped, because a clamp would hide the
 * authoring mistake that produced them.
 *
 * This runs once, when a unit system is resolved — never per value converted —
 * so it is a §85 check with no production cost to disable.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` if the factor is not a finite
 * number greater than zero
 */
function factor(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  // `!(value > 0)` rather than `value <= 0`, so `NaN` — false against
  // everything — is refused by the same branch as zero and negatives.
  if (!Number.isFinite(value) || !(value > 0)) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `UnitSystem.scale.${field} must be a finite number greater than zero (§40); got ${String(value)}.`,
      { context: { field: `scale.${field}`, found: value } },
    );
  }
  return value;
}

/**
 * Completes and validates a partial §40 record.
 *
 * Omitted fields take their {@link SI_UNITS} defaults, so
 * `resolveUnitSystem({ angle: "degree" })` is "SI, displayed in degrees" and
 * nothing else. The result is frozen, including `scale`.
 *
 * Calling it with nothing returns the shared {@link SI_UNITS} object itself and
 * allocates nothing.
 *
 * @param init the caller's partial record, or `undefined` for SI
 * @returns a complete, frozen unit system
 * @throws FourError `INVALID_APPLICATION_STATE` if a selector is outside its
 * §40 union, or a scale factor is not finite and greater than zero
 *
 * @example
 * ```ts
 * // A CAD-style application: world authored in millimetres, angles shown in
 * // degrees. The engine still runs in world units and radians.
 * const units = resolveUnitSystem({
 *   length: "millimeter",
 *   angle: "degree",
 *   scale: { lengthToMeters: 0.001, massToKilograms: 1 },
 * });
 * angleToDisplay(Math.PI / 2, units); // 90 — for the readout, not the solver
 * ```
 */
export function resolveUnitSystem(init?: UnitSystemInit): UnitSystem {
  if (init === undefined) {
    return SI_UNITS;
  }
  return Object.freeze({
    length: selector(init.length, LENGTH_UNITS, SI_UNITS.length, "length"),
    mass: selector(init.mass, MASS_UNITS, SI_UNITS.mass, "mass"),
    time: selector(init.time, TIME_UNITS, SI_UNITS.time, "time"),
    angle: selector(init.angle, ANGLE_UNITS, SI_UNITS.angle, "angle"),
    scale: Object.freeze({
      lengthToMeters: factor(
        init.scale?.lengthToMeters,
        SI_UNITS.scale.lengthToMeters,
        "lengthToMeters",
      ),
      massToKilograms: factor(
        init.scale?.massToKilograms,
        SI_UNITS.scale.massToKilograms,
        "massToKilograms",
      ),
    }),
  });
}

/**
 * Metres in one unit of `units.length`.
 *
 * `"custom"` resolves to `scale.lengthToMeters`, i.e. the display unit *is* the
 * world unit — which is what makes {@link lengthToDisplay} the exact identity
 * under a custom system, as it must be: §40 gives `"custom"` no name and no
 * second factor, so there is nothing else it could mean.
 */
function displayMeters(units: UnitSystem): number {
  return units.length === "custom"
    ? units.scale.lengthToMeters
    : METERS_PER_LENGTH_UNIT[units.length];
}

/** Kilograms in one unit of `units.mass`; `"custom"` is the world mass unit. */
function displayKilograms(units: UnitSystem): number {
  return units.mass === "custom"
    ? units.scale.massToKilograms
    : KILOGRAMS_PER_MASS_UNIT[units.mass];
}

/**
 * Converts an engine angle in radians to the declared display unit.
 *
 * Display only — the value you pass back to any engine API stays radians.
 *
 * @param radians the engine value (§7a)
 * @param units the declared system
 * @returns the same angle expressed in `units.angle`
 */
export function angleToDisplay(radians: number, units: UnitSystem): number {
  return units.angle === "degree" ? radians / RADIANS_PER_DEGREE : radians;
}

/**
 * Converts an authored angle in the declared display unit to engine radians.
 *
 * This is the call that belongs between a form field and an engine API:
 * `node.rotateZ(angleFromDisplay(input.valueAsNumber, units))`.
 *
 * @param displayed the authored value, in `units.angle`
 * @param units the declared system
 * @returns radians (§7a)
 */
export function angleFromDisplay(displayed: number, units: UnitSystem): number {
  return units.angle === "degree" ? displayed * RADIANS_PER_DEGREE : displayed;
}

/**
 * Converts an engine time in seconds to the declared display unit.
 *
 * @param seconds the engine value (§7a — every engine time is seconds)
 * @param units the declared system
 * @returns the same duration expressed in `units.time`
 */
export function timeToDisplay(seconds: number, units: UnitSystem): number {
  return units.time === "millisecond"
    ? seconds / SECONDS_PER_MILLISECOND
    : seconds;
}

/**
 * Converts an authored time in the declared display unit to engine seconds.
 *
 * @param displayed the authored value, in `units.time`
 * @param units the declared system
 * @returns seconds (§7a)
 */
export function timeFromDisplay(displayed: number, units: UnitSystem): number {
  return units.time === "millisecond"
    ? displayed * SECONDS_PER_MILLISECOND
    : displayed;
}

/**
 * Converts an engine length in world units to the declared display unit.
 *
 * The conversion is `worldUnits × scale.lengthToMeters ÷ (metres per display
 * unit)`, so a world authored in centimetres and displayed in centimetres is
 * the exact identity, while the same world displayed in millimetres reads ten
 * times larger — which is the whole point of declaring both.
 *
 * @param worldUnits the engine value (a position component, a radius, …)
 * @param units the declared system
 * @returns the same length expressed in `units.length`
 */
export function lengthToDisplay(worldUnits: number, units: UnitSystem): number {
  const meters = displayMeters(units);
  return meters === units.scale.lengthToMeters
    ? worldUnits
    : (worldUnits * units.scale.lengthToMeters) / meters;
}

/**
 * Converts an authored length in the declared display unit to world units.
 *
 * @param displayed the authored value, in `units.length`
 * @param units the declared system
 * @returns world units, the only length the engine API takes
 */
export function lengthFromDisplay(
  displayed: number,
  units: UnitSystem,
): number {
  const meters = displayMeters(units);
  return meters === units.scale.lengthToMeters
    ? displayed
    : (displayed * meters) / units.scale.lengthToMeters;
}

/**
 * Converts an engine mass in world mass units to the declared display unit.
 *
 * @param worldMass the engine value (`RigidBody.mass`, a derived mass, …)
 * @param units the declared system
 * @returns the same mass expressed in `units.mass`
 */
export function massToDisplay(worldMass: number, units: UnitSystem): number {
  const kilograms = displayKilograms(units);
  return kilograms === units.scale.massToKilograms
    ? worldMass
    : (worldMass * units.scale.massToKilograms) / kilograms;
}

/**
 * Converts an authored mass in the declared display unit to world mass units.
 *
 * @param displayed the authored value, in `units.mass`
 * @param units the declared system
 * @returns world mass units, the only mass the engine API takes
 */
export function massFromDisplay(displayed: number, units: UnitSystem): number {
  const kilograms = displayKilograms(units);
  return kilograms === units.scale.massToKilograms
    ? displayed
    : (displayed * kilograms) / units.scale.massToKilograms;
}

/**
 * The SI value of a world length, independent of the display selector.
 *
 * This is the §40 `scale` factor applied on its own — what §101's *"unit
 * application in simulation"* will read when `@four/physics` checks §41's
 * 1e5-length-unit precision envelope in SI terms, and what an engineering
 * readout wants when it must report metres regardless of what the inspector is
 * currently showing.
 *
 * @param worldUnits the engine value
 * @param units the declared system
 * @returns metres
 */
export function worldLengthToMeters(
  worldUnits: number,
  units: UnitSystem,
): number {
  return worldUnits * units.scale.lengthToMeters;
}

/**
 * The world length of an SI value. Inverse of {@link worldLengthToMeters}.
 *
 * @param meters a length in metres
 * @param units the declared system
 * @returns world units
 */
export function metersToWorldLength(meters: number, units: UnitSystem): number {
  return meters / units.scale.lengthToMeters;
}

/**
 * The SI value of a world mass, independent of the display selector.
 *
 * @param worldMass the engine value
 * @param units the declared system
 * @returns kilograms
 */
export function worldMassToKilograms(
  worldMass: number,
  units: UnitSystem,
): number {
  return worldMass * units.scale.massToKilograms;
}

/**
 * The world mass of an SI value. Inverse of {@link worldMassToKilograms}.
 *
 * @param kilograms a mass in kilograms
 * @param units the declared system
 * @returns world mass units
 */
export function kilogramsToWorldMass(
  kilograms: number,
  units: UnitSystem,
): number {
  return kilograms / units.scale.massToKilograms;
}

/**
 * The display symbol for one quantity under this system.
 *
 * Returns `""` for a `"custom"` length or mass: §40's record selects `"custom"`
 * but carries no field naming it, so the engine has no name to print and will
 * not invent one. An application with a custom unit knows what it is called and
 * supplies the label itself.
 *
 * @param units the declared system
 * @param quantity which of the four §40 selectors to read
 * @returns `"m"`, `"cm"`, `"mm"`, `"kg"`, `"g"`, `"s"`, `"ms"`, `"rad"`,
 * `"°"`, or `""`
 */
export function unitSymbol(units: UnitSystem, quantity: UnitQuantity): string {
  return SYMBOLS[units[quantity]];
}

/**
 * `"12.5 cm"` — a value and its symbol.
 *
 * Two symbols take no separator: `""` (a `"custom"` unit, which has no name in
 * §40) and `"°"`, which SI style writes tight against the number while every
 * other symbol takes a space. `"90°"`, `"1.57 rad"`.
 *
 * @param value the already-converted display value
 * @param symbol the result of {@link unitSymbol}
 * @param fractionDigits forwarded to `Number.prototype.toFixed`; omitted means
 * the value's own shortest representation
 */
function labelled(
  value: number,
  symbol: string,
  fractionDigits?: number,
): string {
  const text =
    fractionDigits === undefined
      ? String(value)
      : value.toFixed(fractionDigits);
  if (symbol === "") {
    return text;
  }
  return symbol === "°" ? `${text}°` : `${text} ${symbol}`;
}

/**
 * Formats an engine length for display: convert, then label.
 *
 * Formatting is the one place in this module that allocates, which is a second
 * reason it belongs nowhere near a simulation path.
 *
 * @param worldUnits the engine value
 * @param units the declared system
 * @param fractionDigits forwarded to `Number.prototype.toFixed`, which throws
 * `RangeError` outside 0–100; omitted means no rounding
 * @returns e.g. `"150 cm"`
 */
export function formatLength(
  worldUnits: number,
  units: UnitSystem,
  fractionDigits?: number,
): string {
  return labelled(
    lengthToDisplay(worldUnits, units),
    unitSymbol(units, "length"),
    fractionDigits,
  );
}

/**
 * Formats an engine mass for display.
 *
 * @param worldMass the engine value
 * @param units the declared system
 * @param fractionDigits forwarded to `Number.prototype.toFixed`
 * @returns e.g. `"2.50 kg"`
 */
export function formatMass(
  worldMass: number,
  units: UnitSystem,
  fractionDigits?: number,
): string {
  return labelled(
    massToDisplay(worldMass, units),
    unitSymbol(units, "mass"),
    fractionDigits,
  );
}

/**
 * Formats an engine time for display.
 *
 * @param seconds the engine value (§7a)
 * @param units the declared system
 * @param fractionDigits forwarded to `Number.prototype.toFixed`
 * @returns e.g. `"16.67 ms"`
 */
export function formatTime(
  seconds: number,
  units: UnitSystem,
  fractionDigits?: number,
): string {
  return labelled(
    timeToDisplay(seconds, units),
    unitSymbol(units, "time"),
    fractionDigits,
  );
}

/**
 * Formats an engine angle for display.
 *
 * @param radians the engine value (§7a)
 * @param units the declared system
 * @param fractionDigits forwarded to `Number.prototype.toFixed`
 * @returns e.g. `"90.0°"`
 */
export function formatAngle(
  radians: number,
  units: UnitSystem,
  fractionDigits?: number,
): string {
  return labelled(
    angleToDisplay(radians, units),
    unitSymbol(units, "angle"),
    fractionDigits,
  );
}
