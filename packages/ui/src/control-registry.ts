/**
 * The §81 UI-control registry — a named map of widget constructors a host
 * (or a plugin the host installed) can register into.
 *
 * The ten shipped controls (`Panel`, `Button`, `Label`, …) stay ordinary
 * classes an application constructs directly. This table is the named slot
 * §81's *"UI controls"* point needs: a plugin can register `"ColorWell"` →
 * a constructor, and a host that builds widgets from a document or a
 * palette looks them up by name.
 *
 * Re-adding the **identical** constructor under the same name is a no-op. A
 * *different* constructor under an occupied name throws — a silent
 * overwrite would make which class a name constructs depend on install
 * order (§33).
 *
 * No `unregister`. The capability token is therefore not revocable.
 */

import { FourError } from "@four/core";

import type { UIWidget } from "./widget.js";

/**
 * A widget constructor stored under a name.
 *
 * Options are control-specific; the registry stores the constructor, not a
 * uniform call shape. `options?: never` is the construct signature a
 * shipped control satisfies (every control's options argument is
 * optional), so `register("Button", Button)` type-checks without a cast.
 * A host that looks one up constructs it with the options that control
 * documents.
 */
export type UIControlConstructor = new (options?: never) => UIWidget;

/**
 * Named widget-constructor table for §81's *"UI controls"* point.
 *
 * `Map` preserves insertion order, which is the order {@link names} reports
 * (§33).
 */
export class UIControlRegistry {
  readonly #controls = new Map<string, UIControlConstructor>();

  /**
   * Registers `control` under `name`. Returns `this` so registrations chain.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` if `name` is empty, or if a
   * different constructor already occupies that name.
   */
  register(name: string, control: UIControlConstructor): this {
    requireName(name, "UI control");
    const existing = this.#controls.get(name);
    if (existing !== undefined) {
      if (existing === control) {
        return this;
      }
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `A UI control named ${JSON.stringify(name)} is already registered (§81).`,
        { context: { name, registered: this.names } },
      );
    }
    this.#controls.set(name, control);
    return this;
  }

  /** Whether `name` has a constructor. */
  has(name: string): boolean {
    return this.#controls.has(name);
  }

  /** The constructor for `name`, or `undefined`. */
  get(name: string): UIControlConstructor | undefined {
    return this.#controls.get(name);
  }

  /** Registered names, in insertion order. */
  get names(): readonly string[] {
    return [...this.#controls.keys()];
  }

  /** Number of registered controls. */
  get size(): number {
    return this.#controls.size;
  }
}

function requireName(name: string, kind: string): void {
  if (name === "") {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Cannot register a ${kind} under an empty name (§81).`,
      { context: { name } },
    );
  }
}
