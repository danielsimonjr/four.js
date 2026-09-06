/**
 * The §81 compute-workload registry — a named map of
 * {@link ComputePassDescriptor} factories a host (or a plugin the host
 * installed) can register into.
 *
 * Lives here, not in `@four/render-webgpu`, because §82's descriptor is
 * already backend-independent (`compute.ts`) and a host that has no WebGPU
 * device still needs a place to *name* a workload. Presence of
 * `Renderer.compute?()` is how a backend says it can dispatch; this table
 * is how a plugin says a named kernel exists.
 *
 * Re-adding the **identical** factory under the same name is a no-op. A
 * *different* factory under an occupied name throws — a silent overwrite
 * would make which descriptor a name builds depend on install order (§33).
 *
 * No `unregister`. The capability token is therefore not revocable.
 */

import { FourError } from "@four/core";

import type { ComputePassDescriptor } from "./compute.js";

/**
 * Builds one {@link ComputePassDescriptor} from host-supplied arguments
 * (buffers, workgroup counts, …). The factory's argument list is
 * workload-specific; the registry stores the function, not a uniform call
 * shape.
 */
export type ComputeWorkloadFactory = (
  ...args: readonly unknown[]
) => ComputePassDescriptor;

/**
 * Named compute-workload factory table for §81's *"compute workloads"*
 * point.
 *
 * `Map` preserves insertion order, which is the order {@link names} reports
 * (§33).
 */
export class ComputeWorkloadRegistry {
  readonly #workloads = new Map<string, ComputeWorkloadFactory>();

  /**
   * Registers `factory` under `name`. Returns `this` so registrations chain.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` if `name` is empty, or if a
   * different factory already occupies that name.
   */
  register(name: string, factory: ComputeWorkloadFactory): this {
    requireName(name, "compute workload");
    const existing = this.#workloads.get(name);
    if (existing !== undefined) {
      if (existing === factory) {
        return this;
      }
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `A compute workload named ${JSON.stringify(name)} is already registered (§81).`,
        { context: { name, registered: this.names } },
      );
    }
    this.#workloads.set(name, factory);
    return this;
  }

  /** Whether `name` has a factory. */
  has(name: string): boolean {
    return this.#workloads.has(name);
  }

  /** The factory for `name`, or `undefined`. */
  get(name: string): ComputeWorkloadFactory | undefined {
    return this.#workloads.get(name);
  }

  /** Registered names, in insertion order. */
  get names(): readonly string[] {
    return [...this.#workloads.keys()];
  }

  /** Number of registered workloads. */
  get size(): number {
    return this.#workloads.size;
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
