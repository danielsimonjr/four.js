/**
 * The §81 materials / shader-node registry — a named map of operator
 * factories a host (or a plugin the host installed) can register into.
 *
 * The shader graph's {@link ShaderNode} union stays closed. Native factories
 * construct its existing nodes; {@link ShaderOperatorRegistry.registerDefinition}
 * accepts JSON-safe named subgraphs with typed parameters, which
 * {@link ShaderFunction} validates and inlines into that same closed IR.
 * Neither route accepts executable shader source.
 *
 * Re-adding the **identical** factory under the same name is a no-op. A
 * *different* factory under an occupied name throws — a silent overwrite
 * would make which factory a name resolves to depend on install order
 * (§33).
 *
 * No `unregister`. The capability token is therefore not revocable.
 */

import { FourError } from "@fourjs/core";

import {
  ShaderFunction,
  type ShaderFunctionDefinition,
} from "./shader-function.js";

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
  readonly #definitions = new Map<string, ShaderFunction>();
  readonly #names: string[] = [];

  /**
   * Registers `factory` under `name`. Returns `this` so registrations chain.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` if `name` is empty, or if a
   * different factory already occupies that name.
   */
  register(name: string, factory: ShaderOperatorFactory): this {
    requireName(name, "shader operator");
    if (this.#definitions.has(name)) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `A data-declared shader operator named ${JSON.stringify(name)} is already registered (§81).`,
      );
    }
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
    this.#names.push(name);
    return this;
  }

  /**
   * Registers a JSON-declared reusable operator. The declaration is copied,
   * validated, frozen and lowered only through the closed node IR (§96).
   * Existing names cannot be overwritten by either registration form.
   */
  registerDefinition(definition: ShaderFunctionDefinition): this {
    if (this.has(definition.name)) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `A shader operator named ${JSON.stringify(definition.name)} is already registered (§81).`,
      );
    }
    const fn = new ShaderFunction(definition);
    this.#definitions.set(definition.name, fn);
    this.#names.push(definition.name);
    return this;
  }

  /** The safe data-declared operator for a name, or undefined. */
  getDefinition(name: string): ShaderFunction | undefined {
    return this.#definitions.get(name);
  }

  /** Whether `name` has a factory or data declaration. */
  has(name: string): boolean {
    return this.#operators.has(name) || this.#definitions.has(name);
  }

  /** The factory for `name`, or `undefined`. */
  get(name: string): ShaderOperatorFactory | undefined {
    return this.#operators.get(name);
  }

  /** Registered names, in insertion order. */
  get names(): readonly string[] {
    return [...this.#names];
  }

  /** Number of registered operators. */
  get size(): number {
    return this.#names.length;
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
