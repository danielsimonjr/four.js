/**
 * The §81 asset-format registry — a named map of {@link AssetLoader}s a
 * host (or a plugin the host installed) can register into.
 *
 * {@link AssetManager} still keys its cache by **loader object identity**
 * (`asset-manager.ts`); this table does not change that. What it adds is the
 * missing named slot §81's *"asset formats"* point needs: a plugin can
 * register `"ktx2"` → a loader, and an application that wants that format
 * looks it up by name. The manager is not consulted; the host decides when
 * a registered loader is passed to `load`.
 *
 * Re-adding the **identical** loader under the same name is a no-op, so a
 * plugin that merely wants a format to be available does not have to know
 * whether someone else got there first. A *different* loader under an
 * occupied name throws — a silent overwrite would make which decoder a
 * name resolves to depend on install order, and that is not reproducible
 * (§33).
 *
 * No `unregister`. The capability token is therefore not revocable.
 */

import { FourError } from "@four/core";

import type { AssetLoader } from "./asset-manager.js";

/** A loader stored under a name — the `T` is the asset the loader produces. */
export type RegisteredAssetLoader = AssetLoader<unknown>;

/**
 * Named {@link AssetLoader} table for §81's *"asset formats"* point.
 *
 * `Map` preserves insertion order, which is the order {@link names} reports
 * (§33).
 */
export class AssetLoaderRegistry {
  readonly #loaders = new Map<string, RegisteredAssetLoader>();

  /**
   * Registers `loader` under `name`. Returns `this` so registrations chain.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` if `name` is empty, or if a
   * different loader already occupies that name.
   */
  register(name: string, loader: RegisteredAssetLoader): this {
    requireName(name, "asset loader");
    const existing = this.#loaders.get(name);
    if (existing !== undefined) {
      if (existing === loader) {
        return this;
      }
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `An asset loader named ${JSON.stringify(name)} is already registered (§81).`,
        { context: { name, registered: this.names } },
      );
    }
    this.#loaders.set(name, loader);
    return this;
  }

  /** Whether `name` has a loader. */
  has(name: string): boolean {
    return this.#loaders.has(name);
  }

  /** The loader for `name`, or `undefined`. */
  get(name: string): RegisteredAssetLoader | undefined {
    return this.#loaders.get(name);
  }

  /** Registered names, in insertion order. */
  get names(): readonly string[] {
    return [...this.#loaders.keys()];
  }

  /** Number of registered loaders. */
  get size(): number {
    return this.#loaders.size;
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
