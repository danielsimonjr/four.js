/**
 * The §81 materials / shader-node registry — a named map of operator
 * factories a host (or a plugin the host installed) can register into.
 *
 * The shader graph's {@link ShaderNode} union stays **closed** (RFC 0001;
 * `shader-graph.ts`). Nothing here widens that union or lets a scene
 * document name a new operator. What this table is: RFC 0001's deferred
 * alternative E as a *named factory hook* — a plugin can stash
 * `"my-wrap"` → a function that returns a {@link ShaderNode} the closed
 * union already admits (a `unary`/`binary`/`mix`/… node), and an authoring
 * tool can look that factory up by name. The IR a backend compiles is still
 * only the closed set.
 *
 * There is no existing runtime operator table to wrap: the closed ops are
 * TypeScript union members, not registered values. This map is the first
 * runtime table.
 *
 * Re-adding the **identical** factory under the same name is a no-op. A
 * *different* factory under an occupied name throws — a silent overwrite
 * would make which factory a name resolves to depend on install order
 * (§33).
 *
 * No `unregister`. The capability token is therefore not revocable.
 */

import { FourError } from "@four/core";

import type { ShaderNode, ShaderNodeId } from "./shader-graph.js";

/**
 * Builds one closed {@link ShaderNode} from earlier-node operands.
 *
 * The factory may ignore operands it does not need (a `"time"` node takes
 * none). What it returns must still be a well-formed closed-union node —
 * this table does not validate the IR; {@link analyzeShaderGraph} does.
 */
export type ShaderOperatorFactory = (
  operands: readonly ShaderNodeId[],
) => ShaderNode;

/**
 * Named shader-operator factory table for §81's *"materials and shader
 * nodes"* point.
 *
 * `Map` preserves insertion order, which is the order {@link names} reports
 * (§33).
 */
export class ShaderOperatorRegistry {
  readonly #operators = new Map<string, ShaderOperatorFactory>();

  /**
   * Registers `factory` under `name`. Returns `this` so registrations chain.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` if `name` is empty, or if a
   * different factory already occupies that name.
   */
  register(name: string, factory: ShaderOperatorFactory): this {
    requireName(name, "shader operator");
    const existing = this.#operators.get(name);
    if (existing !== undefined) {
      if (existing === factory) {
        return this;
      }
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `A shader operator named ${JSON.stringify(name)} is already registered (§81).`,
        { context: { name, registered: this.names } },
      );
    }
    this.#operators.set(name, factory);
    return this;
  }

  /** Whether `name` has a factory. */
  has(name: string): boolean {
    return this.#operators.has(name);
  }

  /** The factory for `name`, or `undefined`. */
  get(name: string): ShaderOperatorFactory | undefined {
    return this.#operators.get(name);
  }

  /** Registered names, in insertion order. */
  get names(): readonly string[] {
    return [...this.#operators.keys()];
  }

  /** Number of registered operators. */
  get size(): number {
    return this.#operators.size;
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
