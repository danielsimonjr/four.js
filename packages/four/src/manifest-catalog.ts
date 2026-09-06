/**
 * Preload a §79 manifest into a synchronous {@link SceneResourceCatalog}
 * (A-16's remaining half, 2026-09-06).
 *
 * `@four/assets` already resolves a logical key to verified bytes
 * (`loadFromManifest`). Deserialization cannot wait on that: {@link
 * SceneResourceCatalog.get} is synchronous, because `instantiateScene` is.
 * The wiring is therefore preload-then-catalog — walk the keys a document
 * names, load each, hand the resulting map to {@link resourceCatalog}. This
 * function is that walk, so an application does not write it by hand.
 *
 * It lives here, not in `@four/assets`, for the same reason `instantiateGltf`
 * does: the catalog holds a `BufferGeometry`, a `Material`, or a `Texture`,
 * and the frozen §3.1 matrix gives the asset package `core` alone. The
 * umbrella is the one place that may name both ends. `Application` never
 * references this; it tree-shakes when unused.
 *
 * ```ts
 * const manifest = await assets.load("/assets.json", manifestLoader);
 * const textures = await preloadManifestIntoCatalog(
 *   assets,
 *   manifest,
 *   pngLoader,
 *   { requireHash: true, map: (asset) => new Texture(asset) },
 * );
 * const io = registerSceneNodeTypes({ textures });
 * ```
 *
 * `get(key)` stays synchronous. Streaming and hot-reload are A-18; the
 * §80 `.four` binary is the other A-16 half — neither is this packet.
 */

import {
  loadFromManifest,
  type AssetLoader,
  type AssetManager,
  type AssetManifest,
  type ManifestLoadOptions,
} from "@four/assets";

import {
  resourceCatalog,
  type SceneResourceCatalog,
} from "./scene-serializers.js";

/**
 * Options for {@link preloadManifestIntoCatalog}, over {@link
 * ManifestLoadOptions}.
 *
 * @typeParam T the value the loader produces
 * @typeParam R the catalog entry, after an optional {@link
 *   PreloadManifestIntoCatalogOptions.map}
 */
export interface PreloadManifestIntoCatalogOptions<
  T,
  R extends object,
> extends ManifestLoadOptions {
  /**
   * Load only these keys, in this order. Defaults to every key the
   * manifest names, in the document's own order.
   *
   * Duplicates are dropped after the first, so a document that names the
   * same material twice still takes one reference. A key the manifest
   * does not name is refused by {@link loadFromManifest}, at the call.
   */
  readonly keys?: readonly string[];
  /**
   * Lift a loaded asset into the catalog entry. A `TextureAsset` becomes
   * a `Texture` here — `@four/assets` cannot name `@four/render`, which
   * is why this helper lives on the umbrella.
   *
   * Omit it when the loader already produces the catalog's type
   * (a `BufferGeometry` loader, a material factory).
   */
  readonly map?: (loaded: T, key: string) => R;
}

/**
 * First-seen order of `keys`, so a document that repeats a resource
 * still loads it once.
 */
function uniqueKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }
  return unique;
}

/**
 * Walks a §79 manifest (or a document's named keys) through
 * {@link loadFromManifest} and returns a catalog whose {@link
 * SceneResourceCatalog.get} is synchronous.
 *
 * @param assets the manager that fetches and verifies
 * @param manifest the key → URL + hash map
 * @param loader the decoder for every named key
 * @param options {@link ManifestLoadOptions} plus an optional key list
 *   and an optional lift into the catalog's type
 * @returns a catalog with both `get` and `keyOf` populated
 * @throws FourError `ASSET_LOAD_FAILED` exactly as {@link
 *   loadFromManifest} does — an unknown key, a missing hash under
 *   `requireHash`, or a hash mismatch included
 */
export function preloadManifestIntoCatalog<T extends object>(
  assets: AssetManager,
  manifest: AssetManifest,
  loader: AssetLoader<T>,
  options?: Omit<PreloadManifestIntoCatalogOptions<T, T>, "map">,
): Promise<Required<SceneResourceCatalog<T>>>;
export function preloadManifestIntoCatalog<T, R extends object>(
  assets: AssetManager,
  manifest: AssetManifest,
  loader: AssetLoader<T>,
  options: PreloadManifestIntoCatalogOptions<T, R> & {
    readonly map: (loaded: T, key: string) => R;
  },
): Promise<Required<SceneResourceCatalog<R>>>;
export async function preloadManifestIntoCatalog<T, R extends object>(
  assets: AssetManager,
  manifest: AssetManifest,
  loader: AssetLoader<T>,
  options: PreloadManifestIntoCatalogOptions<T, R> = {},
): Promise<Required<SceneResourceCatalog<R>>> {
  const { keys, map, ...loadOptions } = options;
  const names = uniqueKeys(keys ?? Object.keys(manifest));
  const entries = await Promise.all(
    names.map(async (key): Promise<readonly [string, R]> => {
      const loaded = await loadFromManifest(
        assets,
        manifest,
        key,
        loader,
        loadOptions,
      );
      const resource = (map === undefined ? loaded : map(loaded, key)) as R;
      return [key, resource];
    }),
  );
  return resourceCatalog(entries);
}
