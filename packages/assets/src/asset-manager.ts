/**
 * The asset manager (§76) — one cache, one refcount, one fetch per asset.
 *
 * ```ts
 * const assets = new AssetManager();                 // uses globalThis.fetch
 * const level = await assets.load("/levels/1.json", jsonLoader);
 * // …later, when the level is gone:
 * assets.release("/levels/1.json", jsonLoader);
 * ```
 *
 * §76 asks the asset manager for deduplication, caching, reference counting,
 * lazy loading, streaming, dependency graphs, progress reporting, cancellation,
 * retries, worker decoding, hot reload, and content hashing. This module ships
 * the first four plus retries, and stages the rest with dated notes (see
 * "Staged", below). The MVP reading is the plan's (P11-2): an asset manager
 * whose caching and lifetime rules are exactly specified and fully tested beats
 * a wider surface whose corners are guesses.
 *
 * ## Everything is injected, including IO
 *
 * The manager never names a browser or Node API. It takes a {@link FetchLike} —
 * a function from a URL to something with `ok`, `status`, `arrayBuffer()`,
 * `text()`, and `json()` — which the platform's `fetch` satisfies structurally,
 * and which a unit test satisfies with a plain object. Loaders are the same:
 * they are values the caller passes in, not a registry the manager owns.
 *
 * **On defaulting to `globalThis.fetch` (WP-11.2 decision, 2026-08-02).** §1
 * rule 5 bans wall clocks and `Math.random` from *simulation* code because they
 * destroy determinism. An asset manager is IO, not simulation: it runs before
 * and between frames, its results are content-addressed by URL, and no fixed
 * step depends on it. So the default is allowed here and only here — a
 * constructor with no options resolves `globalThis.fetch` once (bound to
 * `globalThis`, because an extracted `fetch` is an illegal invocation in some
 * browsers). If the runtime has no global `fetch`, construction still succeeds
 * and the first {@link AssetManager.load} throws
 * `INVALID_APPLICATION_STATE` naming the missing dependency, rather than
 * failing at import time in an environment that was only ever going to inject
 * its own.
 *
 * ## Cache identity: `url` **and** loader object identity
 *
 * A cache slot is the pair (`url`, `loader`), where the loader is compared by
 * **object identity** (`===`), not by `loader.name`:
 *
 * - `load("/a.json", jsonLoader)` twice → one fetch, one cached value, refcount
 *   2. `jsonLoader` is a module-level singleton, so this is the common case.
 * - `load("/a.bin", binaryLoader)` and `load("/a.bin", textLoader)` → two
 *   fetches and two independent entries. The same bytes decoded two ways are
 *   two assets with two lifetimes; collapsing them would make `release` ambiguous
 *   and `get` unsound (the two `T`s differ).
 * - `createImageLoader(decodeA)` and `createImageLoader(decodeB)` → two
 *   distinct loader objects, therefore two distinct entries, even though both
 *   are called `"image"`. Factory-built loaders should be hoisted to a constant
 *   by the application if it wants them to share a cache slot.
 *
 * Names are used only for diagnostics (error `context.loader`).
 *
 * ## Coalescing, and what a refcount counts
 *
 * A refcount counts **calls to `load` that were handed the asset**, not
 * consumers that happen to hold it. `load` increments synchronously, before it
 * awaits anything, so two concurrent `load`s of the same key produce one fetch
 * (the second joins the in-flight promise) and a refcount of 2. `get` and `has`
 * are peeks: they never change the count. Every `load` therefore pairs with
 * exactly one {@link AssetManager.release}.
 *
 * On the last release the entry is evicted and, if the asset implements
 * `Disposable` (§83), disposed. Releasing an asset whose load is still in flight
 * is legal: the entry stays until the fetch settles (there is nothing to cancel
 * yet — see "Staged"), and is evicted and disposed the moment it does, so a
 * released asset never lingers in the cache.
 *
 * ## Untrusted content (§96)
 *
 * §96 opens *"asset loaders and scene deserializers shall treat external
 * content as untrusted"* and names **input-size limits** and **cancellation and
 * timeouts for expensive decoders** among its requirements. Both are enforced
 * here, because this is the only place in the engine that touches a network:
 *
 * - **{@link AssetManagerOptions.maximumBytes}** (default
 *   {@link DEFAULT_MAXIMUM_BYTES}) is checked twice. First against the
 *   response's declared `content-length`, *before* the body is read at all — a
 *   4 GB download is refused while it is still a header. Then against what the
 *   body actually produced, because a `content-length` is a claim by the same
 *   party that sent the bytes: the loader is handed a bounded view of the
 *   response whose `arrayBuffer()`, `text()`, and `json()` refuse an
 *   over-budget body instead of returning it.
 * - **{@link AssetManagerOptions.timeoutSeconds}** (default
 *   {@link DEFAULT_TIMEOUT_SECONDS}) bounds the *whole* load — transport and
 *   decode together, since §96's phrase is "expensive decoders" and a decoder
 *   that never returns is exactly as fatal as a socket that never closes.
 *
 * Both defaults are **finite**. A limit that defaults to `Infinity` is
 * documentation rather than a limit; either may be set to
 * `Number.POSITIVE_INFINITY` explicitly, which is how an application records
 * the decision to trust its origin.
 *
 * A refused load rejects with `ASSET_LOAD_FAILED` carrying
 * `context.limitName` (`"maximumBytes"` or `"timeoutSeconds"`), `context.limit`,
 * and — where there is one — `context.observed`. Like every other failure it is
 * not cached, so retrying is calling {@link AssetManager.load} again.
 *
 * ## Failures are never cached
 *
 * A rejected load — transport failure, non-2xx status, or a loader that could
 * not decode the bytes — removes its entry before the rejection reaches the
 * caller. Retrying is therefore just calling `load` again (§76 "retries"), and
 * every waiter on the coalesced promise sees the same error. Failures are
 * reported as {@link FourError} with code `ASSET_LOAD_FAILED` (§89's existing
 * code — the only asset code in the union, and the exact fit), carrying
 * `context = { url, loader, status? }` and the underlying error as `cause`. An
 * error that is *already* a `FourError` is rethrown untouched: a loader that
 * diagnosed its own failure precisely should not have that diagnosis buried
 * under a generic wrapper.
 *
 * ## Staged (dated notes, 2026-08-02, WP-11.2)
 *
 * - **Cancellation / `AbortSignal`.** Half of this landed with
 *   {@link AssetManagerOptions.timeoutSeconds} (§96): a load now has a
 *   deadline, and passing it rejects the caller's promise and evicts the entry.
 *   What is still absent is *caller-driven* cancellation and transport-level
 *   abort. The policy question is unchanged and still unpinned (does releasing
 *   the last reference to a pending load abort it? does one aborting caller
 *   cancel a coalesced load for the others?), and both answers are load-bearing
 *   for the refcount rules above.
 *
 *   There is now also a *typing* obstacle worth recording, because it decides
 *   the shape of whatever closes the rest (measured 2026-08-07). A signal
 *   cannot simply be added to {@link FetchLike}: widening it to
 *   `(url: string, init?: { signal?: AbortSignalLike }) => …` makes the
 *   platform `fetch` **stop** satisfying it, because parameters are
 *   contravariant and the DOM's `RequestInit.signal` is `AbortSignal | null` —
 *   a structural `AbortSignalLike` "is missing the following properties from
 *   type 'AbortSignal': onabort, reason, throwIfAborted, dispatchEvent", and
 *   the missing ones cannot be declared without naming DOM types this package
 *   refuses to name. So `{ fetch }` would need an adapter, and the module's
 *   documented "no adapter needed" property would be gone. The compatible shape
 *   is a *generic* seam — `FetchLike<TSignal = never>` paired with an injected
 *   `() => { signal: TSignal; abort(): void }`, which infers `TSignal =
 *   AbortSignal` from a browser's own `AbortController` and keeps every
 *   existing call site valid. That is A-18's remaining half, deliberately not
 *   built here: the deadline above is enforced *above* the seam, so the
 *   caller's promise is always released even though the socket may drain.
 * - **Streaming, dependency graphs, progress reporting, worker decoding, hot
 *   reload, content hashing** (§76). Each needs a contract this packet does not
 *   have: progress needs a byte-length channel `FetchLike` does not expose,
 *   dependency graphs need a loader that can load (glTF's buffers and images),
 *   hot reload needs a dev-server protocol, worker decoding needs a transfer
 *   policy.
 * - **The §76 record form** `assets.load({ robot: "/models/robot.glb", … })`.
 *   It infers a loader per file extension, which presumes the glTF and texture
 *   loaders that §55/§77 gate (see `loaders.ts`). A version that could only
 *   infer JSON and text would be a worse API than passing the loader.
 */

import {
  FourError,
  isFourError,
  disposeAll,
  type Disposable,
} from "@four/core";

/**
 * The subset of a `fetch` response this package reads.
 *
 * Structural on purpose, exactly as `@four/input` declares its pointer events:
 * the DOM/undici `Response` satisfies it, and so does `{ ok: true, status: 200,
 * … }` in a test. Naming `Response` would drag a DOM lib into a package that
 * must build under plain `lib.es2022`.
 */
export interface FetchResponse {
  /** Whether the status is in the 2xx range. */
  readonly ok: boolean;
  /** The HTTP status code; `0` is acceptable for non-HTTP transports. */
  readonly status: number;
  /**
   * The response headers, if the transport has any (§96).
   *
   * Optional because a non-HTTP transport — or a unit test's fake — has none,
   * and because it was added after the interface shipped; the DOM's `Headers`
   * satisfies it structurally, so a real `Response` still needs no adapter.
   * The manager reads exactly one header from it, `content-length`, to refuse
   * an over-budget body before downloading it.
   */
  readonly headers?: ResponseHeadersLike;
  /** The body as bytes. */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** The body decoded as UTF-8 text. */
  text(): Promise<string>;
  /** The body parsed as JSON. */
  json(): Promise<unknown>;
}

/**
 * The one thing this package needs from a header collection: a case-insensitive
 * lookup returning the value or `null`.
 *
 * Structural, exactly as {@link FetchResponse} is: the DOM's `Headers` has this
 * `get`, and a test satisfies it with `{ get: () => "1024" }`.
 */
export interface ResponseHeadersLike {
  /** The header's value, or `null` when it is absent. */
  get(name: string): string | null;
}

/**
 * The timer seam behind {@link AssetManagerOptions.timeoutSeconds}.
 *
 * Injected rather than reached for, like every other IO in this module, so a
 * unit test can expire a deadline without a wall clock and without fake global
 * timers. `globalThis` satisfies it structurally and is the default.
 *
 * **Milliseconds appear here and nowhere else.** Every four.js API is in
 * seconds (§7a) — {@link AssetManagerOptions.timeoutSeconds} included — but
 * `setTimeout` is a platform primitive whose unit is fixed, so the conversion
 * happens at this boundary and the boundary says so in the parameter name.
 */
export interface TimerLike {
  /**
   * Schedules `callback` after `delayMilliseconds`, returning a handle for
   * {@link TimerLike.clearTimeout}.
   */
  setTimeout(callback: () => void, delayMilliseconds: number): unknown;
  /** Cancels a pending callback; a stale handle is a no-op. */
  clearTimeout(handle: unknown): void;
}

/**
 * The default {@link AssetManagerOptions.maximumBytes}: 64 MiB (§96).
 *
 * Larger than any asset the engine's own examples and tests load by three
 * orders of magnitude, and small enough that a runaway or hostile response
 * cannot exhaust a browser tab's heap before anything notices. §96 requires
 * *some* input-size limit; this is the number, written down, rather than an
 * `Infinity` that would satisfy the letter of a default and none of its point.
 */
export const DEFAULT_MAXIMUM_BYTES = 67_108_864;

/**
 * The default {@link AssetManagerOptions.timeoutSeconds}: 30 seconds (§96).
 *
 * Seconds, like every other duration in the engine (§7a). Generous enough for a
 * large asset over a slow link, finite enough that a stalled transport or a
 * decoder that never returns cannot pin a load — and its reference count —
 * forever.
 */
export const DEFAULT_TIMEOUT_SECONDS = 30;

/**
 * The IO seam: a URL in, a {@link FetchResponse} in, a promise out.
 *
 * The platform `fetch` is assignable to this (its first parameter accepts a
 * `string`, and `Response` structurally satisfies `FetchResponse`), so
 * `{ fetch }` needs no adapter in a browser or in Node ≥ 20.
 */
export type FetchLike = (url: string) => Promise<FetchResponse>;

/**
 * A decoder: bytes in, an asset out.
 *
 * Loaders are values, so the set of formats an application supports is the set
 * of loaders it imports — no registry, no side-effectful registration, no
 * bundle weight for formats nobody loads. `name` is diagnostics only; **cache
 * identity is the loader object**, see the module comment.
 */
export interface AssetLoader<T> {
  /** A short identifier used in error `context` (e.g. `"json"`). */
  readonly name: string;
  /**
   * Decodes one response body.
   *
   * @param response - The response the manager fetched; already checked `ok`.
   * @param url - The URL it came from, for error messages and (once glTF
   *   lands) for resolving relative dependencies.
   */
  load(response: FetchResponse, url: string): Promise<T>;
}

/** Construction options for {@link AssetManager}. */
export interface AssetManagerOptions {
  /**
   * The IO implementation. Defaults to `globalThis.fetch` bound to
   * `globalThis`; see the module comment for why an IO manager is allowed a
   * platform default.
   */
  readonly fetch?: FetchLike;
  /**
   * §96 input-size limit, in bytes. Defaults to {@link DEFAULT_MAXIMUM_BYTES}.
   *
   * Checked against the declared `content-length` before the body is read, and
   * against the body itself as the loader reads it. `text()` is measured in
   * UTF-16 code units, which is never more than the UTF-8 byte count, so that
   * check is conservative in the safe direction.
   *
   * `Number.POSITIVE_INFINITY` disables it; anything else must be greater than
   * zero.
   */
  readonly maximumBytes?: number;
  /**
   * §96 deadline for a whole load — transport **and** decode — in seconds
   * (§7a). Defaults to {@link DEFAULT_TIMEOUT_SECONDS}.
   *
   * On expiry the load rejects with `ASSET_LOAD_FAILED` and the entry is
   * evicted, so the caller is released and the key is retryable. The underlying
   * request is not aborted; see the module comment's staging note on why a
   * signal cannot cross {@link FetchLike} today.
   *
   * `Number.POSITIVE_INFINITY` disables it — and with it the need for a
   * {@link TimerLike}; anything else must be greater than zero.
   */
  readonly timeoutSeconds?: number;
  /**
   * The timer behind {@link AssetManagerOptions.timeoutSeconds}. Defaults to
   * `globalThis`, which satisfies {@link TimerLike} in every browser and in
   * Node.
   */
  readonly timer?: TimerLike;
}

/** One cache slot: a pending or settled load, plus its reference count. */
interface CacheEntry {
  /** The URL, kept for eviction and diagnostics. */
  readonly url: string;
  /**
   * The coalesced promise every `load` of this key returns. Assigned once,
   * immediately after the entry object is built (the entry has to exist before
   * the promise chain can close over it).
   */
  promise: Promise<unknown>;
  /** Live references: `+1` per `load`, `-1` per `release`. */
  refCount: number;
  /** Whether {@link value} has been assigned (a load may resolve `undefined`). */
  settled: boolean;
  /** The decoded asset, once settled. */
  value: unknown;
  /** Set when the entry was dropped from the cache before it settled. */
  evicted: boolean;
}

/** Whether `value` opts into explicit disposal (§83). */
function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { dispose?: unknown }).dispose === "function"
  );
}

/**
 * Resolves the platform `fetch`, bound to the global object.
 *
 * Returns `undefined` — rather than throwing — when there is none, so a
 * manager constructed in a bare runtime is still usable via injection and only
 * complains if someone actually asks it to fetch.
 */
function resolveGlobalFetch(): FetchLike | undefined {
  const scope = globalThis as Partial<{ fetch: FetchLike }>;
  const globalFetch = scope.fetch;
  if (typeof globalFetch !== "function") {
    return undefined;
  }
  return (url: string) => globalFetch.call(scope, url);
}

/**
 * Resolves the platform timer, bound to the global object.
 *
 * `undefined` — rather than a throw — when the host has no `setTimeout`, for
 * the same reason {@link resolveGlobalFetch} is lenient: a manager built in a
 * bare runtime stays constructible, and only a load that actually needs a
 * deadline complains.
 */
function resolveGlobalTimer(): TimerLike | undefined {
  const scope = globalThis as Partial<TimerLike>;
  const set = scope.setTimeout;
  const clear = scope.clearTimeout;
  if (typeof set !== "function" || typeof clear !== "function") {
    return undefined;
  }
  return {
    setTimeout: (callback: () => void, delayMilliseconds: number): unknown =>
      set.call(scope, callback, delayMilliseconds),
    clearTimeout: (handle: unknown): void => {
      clear.call(scope, handle);
    },
  };
}

/**
 * Validates a §96 limit as a positive number, `Infinity` included.
 *
 * `!(value > 0)` rather than `value <= 0`, so `NaN` — which compares false
 * against everything — is refused by the same branch as zero and negatives. A
 * bad limit is a programming error, so it is reported at construction, where
 * the mistake is, rather than at the first load.
 */
function positiveLimit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!(value > 0)) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `AssetManagerOptions.${name} must be greater than zero (or Number.POSITIVE_INFINITY to disable the limit); got ${String(value)}.`,
      { context: { limitName: name, found: value } },
    );
  }
  return value;
}

/**
 * The declared body size from a response's `content-length`, or `undefined`
 * when there is no usable one (§96).
 *
 * A missing header, a non-HTTP transport with no headers at all, and a header
 * that is not a non-negative number all read the same way — "unknown" — and
 * fall through to the post-read bound. A `content-length` is a claim by the
 * party that sent the bytes, so it can only ever be a cheap *early* refusal,
 * never the whole check.
 */
function declaredContentLength(response: FetchResponse): number | undefined {
  const header = response.headers?.get("content-length");
  if (header === undefined || header === null) {
    return undefined;
  }
  const declared = Number(header);
  if (!Number.isFinite(declared) || declared < 0) {
    return undefined;
  }
  return declared;
}

/**
 * Wraps a response so its body accessors refuse an over-budget payload (§96).
 *
 * The wrapper is what the *loader* sees, so a decoder is never handed bytes the
 * application declined to accept. `text()` is bounded in UTF-16 code units — a
 * UTF-8 body is never smaller than its code-unit count, so the check never
 * refuses something under budget, and may accept something modestly over it.
 * `json()` is routed through the bounded `text()` rather than the underlying
 * `json()`, because a parsed value has no size to measure once it exists.
 *
 * @param response the response to bound
 * @param maximumBytes the caller's limit; assumed finite (callers skip the
 *   wrapper entirely for `Infinity`, so an unlimited manager pays nothing)
 * @param refuse builds the `ASSET_LOAD_FAILED` for an observed size
 * @returns a {@link FetchResponse} view over the same response
 */
function boundedResponse(
  response: FetchResponse,
  maximumBytes: number,
  refuse: (observed: number) => FourError,
): FetchResponse {
  const bounded: FetchResponse = {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    async arrayBuffer(): Promise<ArrayBuffer> {
      const data = await response.arrayBuffer();
      if (data.byteLength > maximumBytes) {
        throw refuse(data.byteLength);
      }
      return data;
    },
    async text(): Promise<string> {
      const text = await response.text();
      if (text.length > maximumBytes) {
        throw refuse(text.length);
      }
      return text;
    },
    async json(): Promise<unknown> {
      return JSON.parse(await bounded.text()) as unknown;
    },
  };
  return bounded;
}

/**
 * Deduplicating, reference-counted asset cache (§76).
 *
 * See the module comment for cache identity, coalescing, failure, and disposal
 * semantics — they are the contract, not implementation detail.
 */
export class AssetManager implements Disposable {
  /**
   * Loader → URL → entry.
   *
   * Two levels because a cache key is an object *and* a string, which no single
   * `Map` expresses. Both levels are insertion-ordered (§1 rule 5), so
   * {@link clear} and {@link dispose} tear down in a defined order: entries in
   * reverse insertion order within a loader, loader groups in reverse
   * first-use order.
   */
  readonly #entries = new Map<AssetLoader<unknown>, Map<string, CacheEntry>>();

  readonly #fetch: FetchLike | undefined;

  /** §96 input-size limit in bytes; `Infinity` when the caller disabled it. */
  readonly #maximumBytes: number;

  /** §96 whole-load deadline in seconds; `Infinity` when disabled. */
  readonly #timeoutSeconds: number;

  /** Resolved once, so a host without `setTimeout` is diagnosed at load time. */
  readonly #timer: TimerLike | undefined;

  #disposed = false;

  constructor(options?: AssetManagerOptions) {
    this.#fetch = options?.fetch ?? resolveGlobalFetch();
    this.#maximumBytes = positiveLimit(
      options?.maximumBytes,
      DEFAULT_MAXIMUM_BYTES,
      "maximumBytes",
    );
    this.#timeoutSeconds = positiveLimit(
      options?.timeoutSeconds,
      DEFAULT_TIMEOUT_SECONDS,
      "timeoutSeconds",
    );
    this.#timer = options?.timer ?? resolveGlobalTimer();
  }

  /** The effective §96 input-size limit in bytes (diagnostics and tests). */
  get maximumBytes(): number {
    return this.#maximumBytes;
  }

  /** The effective §96 load deadline in seconds (diagnostics and tests). */
  get timeoutSeconds(): number {
    return this.#timeoutSeconds;
  }

  /** Number of cache slots, pending loads included. */
  get size(): number {
    let total = 0;
    for (const byUrl of this.#entries.values()) {
      total += byUrl.size;
    }
    return total;
  }

  /** Whether {@link dispose} has been called. */
  get isDisposed(): boolean {
    return this.#disposed;
  }

  /**
   * Loads `url` through `loader`, or joins the load already in flight for that
   * pair, or returns the cached asset.
   *
   * Increments the reference count by one in all three cases; pair every call
   * with one {@link release}. A rejection leaves nothing cached, so the same
   * call retries.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` if the manager is disposed,
   *   or if it has no `fetch` (none injected and no global one) and would have
   *   had to perform IO.
   * @throws FourError `ASSET_LOAD_FAILED` (asynchronously) on transport
   *   failure, a non-`ok` response, or a loader that could not decode.
   */
  load<T>(url: string, loader: AssetLoader<T>): Promise<T> {
    if (this.#disposed) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `Cannot load "${url}": this AssetManager has been disposed.`,
        { context: { url, loader: loader.name } },
      );
    }

    const byUrl = this.#groupFor(loader);
    const existing = byUrl.get(url);
    if (existing !== undefined) {
      existing.refCount += 1;
      return existing.promise as Promise<T>;
    }

    const fetchImpl = this.#fetch;
    if (fetchImpl === undefined) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `Cannot load "${url}": no fetch implementation. Pass { fetch } to the ` +
          `AssetManager constructor — this runtime has no global fetch.`,
        { context: { url, loader: loader.name } },
      );
    }

    // §96's deadline needs a timer. Missing one is diagnosed exactly like a
    // missing fetch — loudly, at the first load that would have needed it,
    // naming both ways out — rather than by silently dropping the limit.
    const timer = this.#timer;
    if (timer === undefined && Number.isFinite(this.#timeoutSeconds)) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `Cannot load "${url}": timeoutSeconds is ${String(this.#timeoutSeconds)} ` +
          `but this runtime has no setTimeout. Pass { timer } to the AssetManager ` +
          `constructor, or { timeoutSeconds: Number.POSITIVE_INFINITY } to drop the §96 deadline.`,
        { context: { url, loader: loader.name, limitName: "timeoutSeconds" } },
      );
    }

    // The entry must exist before the first `await` inside `#run`, so that a
    // second synchronous `load` of the same key coalesces onto this promise.
    // `promise` is patched in below: the handlers close over `entry`, so the
    // object has to be built first. It is never observable unset — nothing can
    // read the cache between these two statements, because `byUrl.set` is last.
    const entry: CacheEntry = {
      url,
      promise: Promise.resolve(),
      refCount: 1,
      settled: false,
      value: undefined,
      evicted: false,
    };
    const promise = this.#withDeadline(
      this.#run(fetchImpl, url, loader),
      timer,
      url,
      loader.name,
    ).then(
      (value): T => {
        entry.settled = true;
        entry.value = value;
        // Released (or cleared) while the fetch was in flight: honour the
        // release now that there is something to dispose.
        if (entry.refCount <= 0 || entry.evicted) {
          this.#evict(loader, url, entry);
          disposeValue(value);
        }
        return value;
      },
      (error: unknown): never => {
        // Failures are never cached (§76 "retries").
        this.#evict(loader, url, entry);
        throw error;
      },
    );
    entry.promise = promise;
    byUrl.set(url, entry);
    return promise;
  }

  /**
   * The cached asset for (`url`, `loader`), or `undefined` if it is absent or
   * still loading. Does **not** change the reference count.
   */
  get<T>(url: string, loader: AssetLoader<T>): T | undefined {
    const entry = this.#entries.get(loader)?.get(url);
    return entry?.settled === true ? (entry.value as T) : undefined;
  }

  /**
   * Whether a *settled* asset is cached for (`url`, `loader`). A load still in
   * flight is `false` here — it coalesces, but there is nothing to hand out.
   */
  has(url: string, loader: AssetLoader<unknown>): boolean {
    const entry = this.#entries.get(loader)?.get(url);
    return entry?.settled === true;
  }

  /**
   * The live reference count for (`url`, `loader`), or `0` when there is no
   * entry. Diagnostics and tests; the manager never needs it.
   */
  refCount(url: string, loader: AssetLoader<unknown>): number {
    return this.#entries.get(loader)?.get(url)?.refCount ?? 0;
  }

  /**
   * Drops one reference. On the last one the entry is evicted and a
   * `Disposable` asset is disposed (§83).
   *
   * @returns `true` if this call released the last reference (for a load still
   *   in flight, disposal then happens when it settles), `false` if references
   *   remain or there was no entry.
   */
  release(url: string, loader: AssetLoader<unknown>): boolean {
    const entry = this.#entries.get(loader)?.get(url);
    if (entry === undefined) {
      return false;
    }
    entry.refCount -= 1;
    if (entry.refCount > 0) {
      return false;
    }
    if (entry.settled) {
      this.#evict(loader, url, entry);
      disposeValue(entry.value);
    }
    // Otherwise the load is still running: `load`'s success handler evicts and
    // disposes it, because there is nothing to dispose yet and nothing to
    // abort (cancellation is staged — see the module comment).
    return true;
  }

  /**
   * Evicts every entry regardless of reference count, disposing the disposable
   * ones in reverse insertion order (`disposeAll`, §83). Pending loads are
   * marked so they dispose on settle instead of re-entering the cache.
   *
   * If any `dispose()` throws, every remaining asset is still disposed and the
   * first failure is rethrown — `disposeAll`'s contract.
   */
  clear(): void {
    const disposables: Disposable[] = [];
    for (const byUrl of this.#entries.values()) {
      for (const entry of byUrl.values()) {
        if (entry.settled) {
          if (isDisposable(entry.value)) {
            disposables.push(entry.value);
          }
        } else {
          entry.evicted = true;
        }
      }
    }
    this.#entries.clear();
    disposeAll(disposables);
  }

  /**
   * Clears the cache and refuses further loads. Idempotent; queries
   * ({@link get}, {@link has}, {@link refCount}, {@link release}) stay callable
   * and answer as they would for an empty cache, so teardown order between an
   * owner and its assets cannot turn into a crash.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.clear();
  }

  #groupFor(loader: AssetLoader<unknown>): Map<string, CacheEntry> {
    const existing = this.#entries.get(loader);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, CacheEntry>();
    this.#entries.set(loader, created);
    return created;
  }

  /**
   * Removes (`url`, `loader`) **only if** the cached entry is still `entry`.
   *
   * The identity check is not paranoia: a `clear()` during an in-flight load,
   * followed by a fresh `load` of the same key, puts a *different* entry in
   * that slot before the first one's handlers run. Without the check the old
   * load's completion would evict the new load.
   */
  #evict(loader: AssetLoader<unknown>, url: string, entry: CacheEntry): void {
    const byUrl = this.#entries.get(loader);
    if (byUrl === undefined || byUrl.get(url) !== entry) {
      return;
    }
    byUrl.delete(url);
    if (byUrl.size === 0) {
      this.#entries.delete(loader);
    }
  }

  /**
   * Bounds `work` by {@link AssetManagerOptions.timeoutSeconds} (§96).
   *
   * The deadline covers transport *and* decode, because §96's requirement names
   * "expensive decoders" and both failure modes look identical to a caller. On
   * expiry the returned promise rejects; `load`'s own rejection handler then
   * evicts the entry, so the key is immediately retryable. `work` itself keeps
   * running — see the module comment's cancellation note — but its result is
   * discarded, and its settlement clears the timer either way.
   *
   * An infinite timeout returns `work` untouched, so a manager that opted out
   * pays nothing: no timer, no extra promise, no behavioural difference from
   * the build before §96 landed.
   */
  #withDeadline<T>(
    work: Promise<T>,
    timer: TimerLike | undefined,
    url: string,
    loaderName: string,
  ): Promise<T> {
    const seconds = this.#timeoutSeconds;
    // A missing timer is only reachable with an infinite deadline — `load`
    // refuses a finite one without a timer before it ever gets here — so the
    // two conditions describe the same opt-out from either side.
    if (timer === undefined || !Number.isFinite(seconds)) {
      return work;
    }
    let handle: unknown = undefined;
    // A race rather than a hand-rolled resolve/reject pair, so this promise can
    // only ever be rejected with the one `FourError` below — `work`'s own
    // failures reach the caller through `work`, unwrapped and unreclassified.
    const deadline = new Promise<never>((_resolve, reject) => {
      handle = timer.setTimeout(() => {
        reject(
          new FourError(
            "ASSET_LOAD_FAILED",
            `Loading "${url}" exceeded the ${String(seconds)} s limit (§96).`,
            {
              context: {
                url,
                loader: loaderName,
                limitName: "timeoutSeconds",
                limit: seconds,
              },
            },
          ),
        );
      }, seconds * 1000);
    });
    return Promise.race([
      work.finally(() => {
        // Settled either way: release the timer so a completed load never
        // holds one open (and, in Node, never keeps the process alive).
        timer.clearTimeout(handle);
      }),
      deadline,
    ]);
  }

  /** Fetch, status-check, decode — every failure normalized to `FourError`. */
  async #run<T>(
    fetchImpl: FetchLike,
    url: string,
    loader: AssetLoader<T>,
  ): Promise<T> {
    let response: FetchResponse;
    try {
      response = await fetchImpl(url);
    } catch (error) {
      throw assetLoadFailure(
        `Fetch failed for "${url}".`,
        { url, loader: loader.name },
        error,
      );
    }

    if (!response.ok) {
      throw new FourError(
        "ASSET_LOAD_FAILED",
        `Fetch failed for "${url}": HTTP ${String(response.status)}.`,
        { context: { url, loader: loader.name, status: response.status } },
      );
    }

    // §96 input-size limit, in two halves: refuse the declared length before
    // reading anything, then bound what the body actually yields, because the
    // declaration comes from the same party as the bytes.
    const maximumBytes = this.#maximumBytes;
    if (Number.isFinite(maximumBytes)) {
      const refuse = (observed: number): FourError =>
        new FourError(
          "ASSET_LOAD_FAILED",
          `"${url}" is ${String(observed)} bytes, over the ${String(maximumBytes)}-byte limit (§96).`,
          {
            context: {
              url,
              loader: loader.name,
              status: response.status,
              limitName: "maximumBytes",
              limit: maximumBytes,
              observed,
            },
          },
        );
      const declared = declaredContentLength(response);
      if (declared !== undefined && declared > maximumBytes) {
        throw refuse(declared);
      }
      response = boundedResponse(response, maximumBytes, refuse);
    }

    try {
      return await loader.load(response, url);
    } catch (error) {
      throw assetLoadFailure(
        `Loader "${loader.name}" failed to decode "${url}".`,
        { url, loader: loader.name, status: response.status },
        error,
      );
    }
  }
}

/** Disposes `value` if it is `Disposable`; a plain asset is simply dropped. */
function disposeValue(value: unknown): void {
  if (isDisposable(value)) {
    value.dispose();
  }
}

/**
 * Wraps `cause` as `ASSET_LOAD_FAILED`, unless it already is a `FourError` — a
 * loader that diagnosed its own failure keeps its code and message.
 */
function assetLoadFailure(
  message: string,
  context: Record<string, unknown>,
  cause: unknown,
): unknown {
  if (isFourError(cause)) {
    return cause;
  }
  return new FourError("ASSET_LOAD_FAILED", message, { context, cause });
}
