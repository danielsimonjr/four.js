export const PACKAGE_NAME = "@four/core";

export { DEFAULT_GRAVITY_Y } from "./conventions.js";
export type { JsonValue } from "./json.js";
export { cloneJsonValue } from "./json.js";
export { SeededRandom } from "./random.js";
export type {
  Component,
  ComponentHost,
  ComponentHostBinding,
  ComponentType,
} from "./component.js";
export { ComponentRegistry } from "./component.js";
export type { Disposable } from "./disposable.js";
export { disposeAll } from "./disposable.js";
// §85 build mode (A-4, 2026-08-07). `DEV` is the flag every other package
// gates author-facing work behind; see `dev.ts` for the §33 rule that keeps it
// out of anything the simulation computes.
export {
  DEV,
  devAssert,
  devWarn,
  devWarnOnce,
  resetDevWarnings,
} from "./dev.js";
export type { FourErrorCode, FourErrorOptions } from "./errors.js";
export { FourError, isFourError } from "./errors.js";
export type { EventListener, Unsubscribe } from "./events.js";
export { EventEmitter } from "./events.js";
// §8 space modes (PH-12, 2026-08-09). The vocabulary lives here because §8's
// two halves belong to two pillars that may not import each other; see
// `space.ts` for what declaring a mode does and does not do today.
export type { SpaceMode } from "./space.js";
export {
  DEFAULT_SPACE_MODE,
  SPACE_MODES,
  isSimulationSpaceMode,
} from "./space.js";
export type {
  AngleUnit,
  LengthUnit,
  MassUnit,
  TimeUnit,
  UnitQuantity,
  UnitScale,
  UnitSystem,
  UnitSystemInit,
} from "./units.js";
export {
  SI_UNITS,
  angleFromDisplay,
  angleToDisplay,
  formatAngle,
  formatLength,
  formatMass,
  formatTime,
  kilogramsToWorldMass,
  lengthFromDisplay,
  lengthToDisplay,
  massFromDisplay,
  massToDisplay,
  metersToWorldLength,
  resolveUnitSystem,
  timeFromDisplay,
  timeToDisplay,
  unitSymbol,
  worldLengthToMeters,
  worldMassToKilograms,
} from "./units.js";
export type { UntrustedJsonLimits } from "./untrusted.js";
export {
  DEFAULT_MAXIMUM_DEPTH,
  DEFAULT_MAXIMUM_TEXT_LENGTH,
  parseUntrustedJson,
} from "./untrusted.js";
