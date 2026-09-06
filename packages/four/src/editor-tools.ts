/**
 * The §81 editor-tool registry — a named map of tool factories the **host**
 * owns.
 *
 * Editor tools have no package in the §98 tree. The umbrella is the one
 * place that may name every other package, and a host (an application, an
 * editor shell, a test) is the one place that decides which tools exist.
 * This table is that host-side slot: a plugin can register `"translate"` →
 * a factory, and the host looks it up by name. four.js itself never
 * constructs a tool from this table.
 *
 * Re-adding the **identical** factory under the same name is a no-op. A
 * *different* factory under an occupied name throws — a silent overwrite
 * would make which factory a name builds depend on install order (§33).
 *
 * No `unregister`. The capability token is therefore not revocable.
 */

import { FourError } from "@four/core";

/**
 * Builds one host-side tool from host-supplied arguments. The factory's
 * argument list and return type are tool-specific; the registry stores the
 * function, not a uniform call shape.
 */
export type EditorToolFactory = (...args: readonly unknown[]) => unknown;

/**
 * Named editor-tool factory table for §81's *"editor tools"* point.
 *
 * Host-side: construct one and provide it through the capability token, or
 * through a standalone host. `Application` does not hold this registry —
 * naming a tool table in every bundle would invent an editor this package
 * does not ship.
 *
 * `Map` preserves insertion order, which is the order {@link names} reports
 * (§33).
 */
export class EditorToolRegistry {
  readonly #tools = new Map<string, EditorToolFactory>();

  /**
   * Registers `factory` under `name`. Returns `this` so registrations chain.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` if `name` is empty, or if a
   * different factory already occupies that name.
   */
  register(name: string, factory: EditorToolFactory): this {
    requireName(name, "editor tool");
    const existing = this.#tools.get(name);
    if (existing !== undefined) {
      if (existing === factory) {
        return this;
      }
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `An editor tool named ${JSON.stringify(name)} is already registered (§81).`,
        { context: { name, registered: this.names } },
      );
    }
    this.#tools.set(name, factory);
    return this;
  }

  /** Whether `name` has a factory. */
  has(name: string): boolean {
    return this.#tools.has(name);
  }

  /** The factory for `name`, or `undefined`. */
  get(name: string): EditorToolFactory | undefined {
    return this.#tools.get(name);
  }

  /** Registered names, in insertion order. */
  get names(): readonly string[] {
    return [...this.#tools.keys()];
  }

  /** Number of registered tools. */
  get size(): number {
    return this.#tools.size;
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
