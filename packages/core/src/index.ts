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
export type { FourErrorCode, FourErrorOptions } from "./errors.js";
export { FourError, isFourError } from "./errors.js";
export type { EventListener, Unsubscribe } from "./events.js";
export { EventEmitter } from "./events.js";
export type { UntrustedJsonLimits } from "./untrusted.js";
export {
  DEFAULT_MAXIMUM_DEPTH,
  DEFAULT_MAXIMUM_TEXT_LENGTH,
  parseUntrustedJson,
} from "./untrusted.js";
