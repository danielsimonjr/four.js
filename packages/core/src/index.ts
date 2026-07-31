export const PACKAGE_NAME = "@four/core";

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
