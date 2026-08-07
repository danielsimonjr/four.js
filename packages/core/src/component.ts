/**
 * Component model (§6a, plan D2).
 *
 * Components attach typed behavior and state to a host — in practice a
 * `@four/scene` `Node`, which owns a {@link ComponentRegistry} and delegates
 * `addComponent` / `getComponent` / `removeComponent` to it (plan D1).
 * `@four/core` must not depend on `@four/scene`, so the host is expressed here
 * as the structural {@link ComponentHost} interface rather than as `Node`.
 *
 * Rules implemented (§6a):
 * - at most one component of a given type per host; adding a second replaces
 *   the first and emits a development warning;
 * - lifecycle is explicit — `onAttach` runs after the component is registered,
 *   `onDetach` runs when it is removed or replaced, and **detaching does not
 *   dispose**: `dispose` is only called by an explicit `dispose()` /
 *   {@link ComponentRegistry.disposeAll};
 * - components are keyed by `typeName`, which is also the §79 serialization
 *   name.
 */

import { DEV, devWarn } from "./dev.js";
import { FourError } from "./errors.js";

/**
 * What a component sees of its host. `@four/scene`'s `Node` satisfies this
 * structurally; so does {@link ComponentRegistry} itself.
 */
export interface ComponentHost {
  addComponent<T extends Component>(component: T): T;
  getComponent<T extends Component>(type: ComponentType<T>): T | undefined;
  removeComponent(component: Component): boolean;
}

/**
 * Typed behavior/state attached to a host.
 *
 * `host` is `readonly` in this contract because **only the registry writes
 * it**: implementations declare it as a plain mutable field (see
 * {@link ComponentHostBinding}) initialized to `null`, and
 * {@link ComponentRegistry} assigns it on attach and clears it on detach.
 * Application code must never assign `host`.
 */
export interface Component {
  readonly host: ComponentHost | null;
  onAttach?(host: ComponentHost): void;
  onDetach?(host: ComponentHost): void;
  dispose?(): void;
}

/**
 * The registry-writable view of {@link Component.host}. This is the only
 * declared mechanism by which `host` is assigned; it exists so the assignment
 * is a named, typed operation instead of an anonymous cast scattered through
 * the registry.
 */
export interface ComponentHostBinding {
  host: ComponentHost | null;
}

/**
 * Component class identity (plan D2). Components are classes carrying a
 * `static readonly typeName`; the registry is keyed by that name.
 *
 * The `never` constructor parameters make the type accept any component class
 * without inviting the registry to construct one — the registry only ever
 * reads `typeName`.
 */
export type ComponentType<T extends Component> = {
  readonly typeName: string;
  new (...args: never[]): T;
};

/**
 * Reads the `typeName` of a component instance through its constructor.
 * Throws nothing: a component whose class omits `typeName` yields `undefined`,
 * which {@link ComponentRegistry.add} rejects with a {@link FourError}.
 */
function typeNameOf(component: Component): string | undefined {
  const constructor = (component as { constructor?: unknown }).constructor as
    { typeName?: unknown } | undefined;
  const typeName = constructor?.typeName;
  return typeof typeName === "string" ? typeName : undefined;
}

/**
 * Assigns {@link Component.host}. Confined to this module: the `readonly`
 * modifier on the public contract exists to stop everyone else.
 */
function bindHost(component: Component, host: ComponentHost | null): void {
  (component as ComponentHostBinding).host = host;
}

/**
 * One-component-per-type storage with §6a lifecycle, in insertion order.
 *
 * Constructed with the host that components will see; a `Node` passes itself.
 * When no host is supplied the registry acts as its own host, which keeps it
 * usable standalone (and in tests).
 */
export class ComponentRegistry implements ComponentHost {
  /** Keyed by `typeName`; `Map` preserves insertion order (ground rule 5). */
  readonly #components = new Map<string, Component>();

  readonly #host: ComponentHost;

  constructor(host?: ComponentHost) {
    this.#host = host ?? this;
  }

  /** Live components in insertion order. */
  get components(): IterableIterator<Component> {
    return this.#components.values();
  }

  /** Number of attached components. */
  get size(): number {
    return this.#components.size;
  }

  /**
   * Registers `component`, replacing any existing component of the same
   * `typeName`. The replaced component is detached (never disposed) and a
   * development warning is emitted (§6a).
   *
   * Order: the new component is registered first, then `onAttach` runs, so a
   * component that inspects `host.getComponent(...)` from `onAttach` sees
   * itself. On replacement the old component's `onDetach` runs before the new
   * component's `onAttach`.
   */
  add<T extends Component>(component: T): T {
    const typeName = typeNameOf(component);
    if (typeName === undefined) {
      throw new FourError(
        "INVALID_SCENE_GRAPH",
        "Component class is missing a `static readonly typeName` (plan D2).",
        { context: { component: component.constructor.name } },
      );
    }

    const existing = this.#components.get(typeName);
    if (existing !== undefined) {
      if (existing === component) {
        return component;
      }
      // §6a development warning. Unconditional until 2026-08-07 ("there is no
      // build-mode flag in the engine yet"), now gated on §85's `DEV` (A-4):
      // the guard is at the call site rather than inside `devWarn`, so a
      // production bundle deletes the message text along with the call. One
      // call per replacement, never deduplicated across replacements — each one
      // is a distinct authoring mistake, which is why this is `devWarn` and not
      // `devWarnOnce`.
      if (DEV) {
        devWarn(
          `A component of type "${typeName}" is already attached; ` +
            "replacing it (§6a: at most one component of a given type per node).",
        );
      }
      this.#detach(typeName, existing);
    }

    this.#components.set(typeName, component);
    bindHost(component, this.#host);
    component.onAttach?.(this.#host);
    return component;
  }

  /** Returns the attached component of `type`, or `undefined`. */
  get<T extends Component>(type: ComponentType<T>): T | undefined {
    const component = this.#components.get(type.typeName);
    // Safe by construction: the map is keyed by the `typeName` of the
    // component's own class, so a hit is an instance of `type`.
    return component as T | undefined;
  }

  /** True when a component of `type` is attached. */
  has<T extends Component>(type: ComponentType<T>): boolean {
    return this.#components.has(type.typeName);
  }

  /**
   * Removes `component` and runs its `onDetach`. Returns `false` when the
   * component is not the one currently attached for its type. Detaching does
   * **not** dispose (§6a).
   */
  remove(component: Component): boolean {
    const typeName = typeNameOf(component);
    if (typeName === undefined) {
      return false;
    }
    if (this.#components.get(typeName) !== component) {
      return false;
    }
    this.#detach(typeName, component);
    return true;
  }

  /**
   * Disposes every component in **reverse insertion order** (teardown mirrors
   * construction, as in `disposeAll`), detaching each one first. The registry
   * is empty afterwards.
   */
  disposeAll(): void {
    const entries = [...this.#components.entries()].reverse();
    this.#components.clear();
    for (const [typeName, component] of entries) {
      // Re-add nothing: the map is already cleared, so `#detach`'s delete is a
      // no-op and the lifecycle call order stays detach-then-dispose.
      this.#detach(typeName, component);
      component.dispose?.();
    }
  }

  // --- ComponentHost ------------------------------------------------------

  addComponent<T extends Component>(component: T): T {
    return this.add(component);
  }

  getComponent<T extends Component>(type: ComponentType<T>): T | undefined {
    return this.get(type);
  }

  removeComponent(component: Component): boolean {
    return this.remove(component);
  }

  #detach(typeName: string, component: Component): void {
    this.#components.delete(typeName);
    component.onDetach?.(this.#host);
    bindHost(component, null);
  }
}
