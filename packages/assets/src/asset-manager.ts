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
 * the first four plus retries, cancellation, and content hashing, and stages the
 * rest with dated notes (see "Staged", below). The MVP reading is the plan's (P11-2): an asset
 * manager whose caching and lifetime rules are exactly specified and fully
 * tested beats a wider surface whose corners are guesses.
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
 * is legal: the entry stays until the fetch settles, and is evicted and disposed
 * the moment it does, so a released asset never lingers in the cache.
 *
 * ## Cancellation (§76, 2026-08-09)
 *
 * A caller that may stop wanting an asset passes a signal:
 *
 * ```ts
 * const controller = new AbortController();
 * const level = assets.load("/levels/1.json", jsonLoader, {
 *   signal: controller.signal,
 * });
 * controller.abort();   // `level` rejects; the reference it took is given back
 * ```
 *
 * Three rules, and they are the whole contract:
 *
 * 1. **An aborted load never holds a reference.** A signal that is already
 *    aborted refuses before the cache is even consulted — no entry, no fetch, no
 *    increment. A signal that aborts later hands back the one reference its
 *    `load` took. Either way the caller must **not** call {@link
 *    AssetManager.release} for it, exactly as it would not for a load that
 *    failed.
 * 2. **One waiter's abort is not the others'.** Aborting decrements; the fetch
 *    is abandoned only when the count reaches zero, i.e. when the *last* waiter
 *    on a coalesced load has gone. A second caller awaiting the same key still
 *    gets its asset. This is the only answer consistent with the refcount above:
 *    a coalesced load is shared, so no single sharer may cancel it.
 * 3. **`release` is not `abort`.** Releasing the last reference to a pending load
 *    still lets it settle (rule unchanged since WP-11.2). `release` says "I no
 *    longer need the asset"; it is not permission to reject a promise the caller
 *    is still holding — doing so would turn an orderly teardown into an
 *    unhandled rejection in application code. Cancellation has its own channel
 *    because it is the caller *asking* for that rejection.
 *
 * When the last waiter aborts, the entry is evicted immediately (so the key is
 * retryable at once and no later `load` coalesces onto a load nobody wants), and
 * the transport is aborted **if the manager was given the capability** —
 * {@link AssetManagerOptions.abortController}, reported by
 * {@link AssetManager.canAbortTransport}. Without it the promise semantics are
 * identical and the socket merely drains, exactly as with the §96 deadline. The
 * deadline uses the same handle: a timed-out load now aborts its request instead
 * of leaving it running.
 *
 * The signal itself is structural ({@link AbortSignalLike}) — the DOM's
 * `AbortSignal` satisfies it, and so does `{ aborted: false, addEventListener,
 * removeEventListener }` in a test.
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
 * not cached, so retrying is calling {@link AssetManager.load} again. An aborted
 * load rejects with the same code and `context.reason = "aborted"`: §89's list
 * has no cancellation code, and inventing one in `@four/core` to say what a
 * discriminating `context` already says would widen the engine's error
 * vocabulary for one caller.
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
 * ## How the signal crosses the IO seam (measured, 2026-08-07 and 2026-08-09)
 *
 * A signal cannot simply be added to {@link FetchLike} as a concrete structural
 * type: widening it to `(url: string, init?: { signal?: AbortSignalLike }) => …`
 * makes the platform `fetch` **stop** satisfying it, because parameters are
 * contravariant and the DOM's `RequestInit.signal` is `AbortSignal | null` — a
 * structural `AbortSignalLike` "is missing the following properties from type
 * 'AbortSignal': onabort, reason, throwIfAborted, dispatchEvent", and the
 * missing ones cannot be declared without naming DOM types this package
 * refuses to name. `{ fetch }` would then need an adapter, and this module's
 * documented "no adapter needed" property would be gone.
 *
 * The shape that works — recorded here on 2026-08-07 as a design, built on
 * 2026-08-09 — is a *generic* seam: `FetchLike<TSignal = never>` paired with an
 * injected `() => { signal: TSignal; abort(): void }`. `TSignal` is inferred
 * from the browser's own `AbortController`, so `{ fetch, abortController: () =>
 * new AbortController() }` type-checks with no adapter and no DOM type named
 * here, while `{ fetch }` alone still infers `never` and every pre-existing call
 * site keeps compiling.
 *
 * One further measurement decided the *storage*, and it is not obvious: keeping
 * `TSignal` in a field (`#fetch: FetchLike<TSignal>`) makes `AssetManager` vary
 * with it, and `AssetManager<AbortSignal>` is then **not** assignable to
 * `AssetManager` — which would break `new Application({ assets })` for exactly
 * the managers that gained the capability. So the seam is erased at the
 * constructor: `TSignal` appears only in {@link AssetManagerOptions}, where it
 * does its one job of forcing `fetch` and `abortController` to agree, and the
 * fields hold a signal-agnostic closure. Every instantiation of the class is
 * therefore mutually assignable, as it was before.
 *
 * ## Content hashing and verification (§76, §79 — 2026-08-21)
 *
 * ```ts
 * // Record the hash of what was fetched…
 * await assets.load("/models/robot.bin", binaryLoader, { hashContent: true });
 * assets.contentHash("/models/robot.bin", binaryLoader); // "sha256-9f86d0…"
 *
 * // …or declare it up front, which is §79's manifest reloading its asset.
 * await assets.load("/models/robot.bin", binaryLoader, {
 *   expectedHash: manifest.robot.hash,
 * });   // rejects if the bytes are not the bytes the manifest named
 * ```
 *
 * Four rules:
 *
 * 1. **The hash covers the response's bytes**, whatever the loader reads. A
 *    hashed load therefore reads the body once as bytes and derives `text()` and
 *    `json()` from them (through {@link AssetManagerOptions.decodeText}), so the
 *    same URL hashes identically under `binaryLoader` and `jsonLoader`. A hash
 *    that depended on which loader observed it could not be written in a
 *    manifest at all.
 * 2. **Verification is per caller, not per load.** A coalesced load computes one
 *    hash; each waiter compares it against *its own* `expectedHash`. One
 *    caller's wrong expectation rejects that caller and hands back its
 *    reference (`context.reason === "hash-mismatch"`) — exactly as an abort
 *    does, and for the same reason: the other waiters asked for something else.
 * 3. **A hash that could not be computed is a refusal, never a pass.** Asking
 *    for a hash on a manager with no {@link AssetManagerOptions.digest} throws
 *    `INVALID_APPLICATION_STATE` at the call, naming the injection point;
 *    joining a load that was *not* hashing rejects with
 *    `context.reason === "hash-unavailable"`. Silently skipping the check is the
 *    one behaviour §96 rules out — the check exists to be trusted.
 * 4. **Hashing is opt-in.** It forces the whole body through memory and costs a
 *    digest, so a load that did not ask for it fetches exactly as before.
 *
 * See `content-hash.ts` for why the default algorithm is SHA-256 rather than
 * something synchronous and cheap.
 *
 * ## Staged (dated notes, 2026-08-02, WP-11.2)
 *
 * - **Streaming, dependency graphs, progress reporting, worker decoding, hot
 *   reload** (§76). Each needs a contract this packet does not have: progress
 *   needs a byte-length channel `FetchLike` does not expose, dependency graphs
 *   need a loader that can load (glTF's buffers and images), hot reload needs a
 *   dev-server protocol, worker decoding needs a transfer policy.
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

import {
  resolveGlobalDigest,
  resolveGlobalTextDecoder,
  type DigestLike,
  type TextDecodeLike,
} from "./content-hash.js";

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
 * `string`, `RequestInit.signal` accepts `TSignal = AbortSignal`, and `Response`
 * structurally satisfies `FetchResponse`), so `{ fetch }` needs no adapter in a
 * browser or in Node ≥ 20.
 *
 * `TSignal` defaults to `never`, which makes {@link FetchInit.signal}
 * unconstructible: a manager with no {@link AssetManagerOptions.abortController}
 * never passes an `init`, and a one-parameter `(url) => …` implementation — the
 * shape every call site used before cancellation landed — is still assignable.
 * The type parameter exists to tie the transport and the abort handle together;
 * see the module comment's measurement of why it cannot be a concrete
 * structural type.
 */
export type FetchLike<TSignal = never> = (
  url: string,
  init?: FetchInit<TSignal>,
) => Promise<FetchResponse>;

/**
 * The one field this package puts in a request `init` — deliberately a subset
 * of the DOM's `RequestInit`, so the platform `fetch` accepts it unchanged.
 */
export interface FetchInit<TSignal> {
  /** The transport's cancellation signal, when the manager has one to give. */
  readonly signal?: TSignal;
}

/**
 * A cancellation source: a signal to hand the transport and the switch that
 * trips it. The DOM's `AbortController` satisfies it exactly, which is the
 * point — `abortController: () => new AbortController()` is the whole
 * integration.
 */
export interface AbortHandle<TSignal> {
  /** Handed to {@link FetchLike} as `init.signal`. */
  readonly signal: TSignal;
  /** Cancels the request the signal was given to. Called at most once. */
  abort(): void;
}

/**
 * The caller's side of cancellation: the subset of the DOM's `AbortSignal` this
 * package reads, structural for the same reason {@link FetchResponse} is.
 *
 * A real `AbortSignal` is assignable to it (measured), and so is a hand-rolled
 * `{ aborted, addEventListener, removeEventListener }` in a unit test. The
 * manager both **polls** `aborted` (a signal that fired before the call is
 * refused without touching the cache) and **subscribes** (a signal that fires
 * later hands the reference back), so both members are needed;
 * `removeEventListener` is not optional because a listener that outlived its
 * load would keep the entry, the loader, and the asset reachable from the
 * caller's signal.
 */
export interface AbortSignalLike {
  /** Whether cancellation has already been requested. */
  readonly aborted: boolean;
  /** Subscribes to the one-shot `"abort"` notification. */
  addEventListener(type: "abort", listener: () => void): void;
  /** Unsubscribes a listener added with {@link AbortSignalLike.addEventListener}. */
  removeEventListener(type: "abort", listener: () => void): void;
}

/** Per-call options for {@link AssetManager.load}. */
export interface AssetLoadOptions {
  /**
   * Cancels *this* call (§76). See the module comment's three cancellation
   * rules: an aborted load never holds a reference, one waiter's abort is not
   * the others', and `release` is not `abort`.
   */
  readonly signal?: AbortSignalLike;
  /**
   * Compute and record this asset's content hash (§76), readable afterwards
   * through {@link AssetManager.contentHash}.
   *
   * Implied by {@link AssetLoadOptions.expectedHash}. See the module comment's
   * four hashing rules — in particular that the hash covers the response's
   * bytes, so it does not depend on which loader read them.
   */
  readonly hashContent?: boolean;
  /**
   * The content hash this asset is *declared* to have — §79's manifest half.
   *
   * The bytes are hashed and compared; a mismatch rejects **this** call with
   * `ASSET_LOAD_FAILED` and `context.reason === "hash-mismatch"` (plus
   * `context.expectedHash` and `context.observedHash`), and hands back the
   * reference the call took, so an asset that failed verification must not be
   * released. Refusing is the feature: §96 treats external content as
   * untrusted, and bytes that are not the bytes the build named are exactly the
   * case the manifest exists to catch.
   */
  readonly expectedHash?: string;
}

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

/**
 * Construction options for {@link AssetManager}.
 *
 * `TSignal` is inferred from whichever of {@link AssetManagerOptions.fetch} and
 * {@link AssetManagerOptions.abortController} is present, and its only job is to
 * make the two agree: a controller whose signal the transport would refuse is a
 * compile error here rather than a `TypeError` at the first load.
 */
export interface AssetManagerOptions<TSignal = never> {
  /**
   * The IO implementation. Defaults to `globalThis.fetch` bound to
   * `globalThis`; see the module comment for why an IO manager is allowed a
   * platform default.
   */
  readonly fetch?: FetchLike<TSignal>;
  /**
   * Mints one cancellation source per load — `() => new AbortController()` in
   * any modern runtime (§76).
   *
   * **Presence is the capability.** Without it, cancellation still works at the
   * promise level (an aborted load rejects, gives back its reference, and frees
   * its cache slot) and the request merely drains; with it, the request is
   * cancelled at the transport, and so is a request that outlives
   * {@link AssetManagerOptions.timeoutSeconds}. {@link
   * AssetManager.canAbortTransport} reports which manager this is, so a caller
   * never has to guess.
   *
   * It is a factory, not a controller: a controller is single-use, and every
   * load needs its own.
   */
  readonly abortController?: () => AbortHandle<TSignal>;
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
   * request is aborted too when the manager was given an
   * {@link AssetManagerOptions.abortController}, and left to drain when it was
   * not — the caller's promise settles identically either way.
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
  /**
   * The content hash implementation (§76). Defaults to SHA-256 over
   * `globalThis.crypto.subtle`, where the runtime has one.
   *
   * **Presence is the capability**, reported by
   * {@link AssetManager.canHashContent}: a manager without one loads exactly as
   * before, and refuses — loudly, at the call — any load that asked for a hash.
   * See `content-hash.ts` for the algorithm argument.
   */
  readonly digest?: DigestLike;
  /**
   * The UTF-8 decoder a hashed `text()`/`json()` load needs, because hashing is
   * defined over bytes. Defaults to `globalThis.TextDecoder`.
   *
   * Only ever consulted by a load that asked to be hashed *and* whose loader
   * reads the body as text; a byte-reading loader needs none.
   */
  readonly decodeText?: TextDecodeLike;
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
  /**
   * The content hash of the bytes this entry was built from, once computed
   * (§76). `undefined` when no caller asked for one — which is what makes a
   * later `expectedHash` on the same key a loud refusal rather than a silent
   * pass; see the module comment's rule 3.
   */
  hash: string | undefined;
  /**
   * Cancels this load's request, or `undefined` when the manager was given no
   * {@link AssetManagerOptions.abortController}. Called at most once — by the
   * last waiter to abort, or by the §96 deadline — and never after the load has
   * settled, where it would be a no-op anyway.
   */
  readonly abort: (() => void) | undefined;
}

/**
 * The transport, with its signal type erased.
 *
 * The manager stores this rather than a `FetchLike<TSignal>` so that `TSignal`
 * stays out of the class's instance type; see the module comment's variance
 * measurement. `signal` is `unknown` here and is only ever the very value the
 * caller's own {@link AbortHandle} produced.
 */
type ErasedFetch = (url: string, signal: unknown) => Promise<FetchResponse>;

/** As {@link ErasedFetch}: an abort source with its signal type erased. */
type ErasedAbortController = () => AbortHandle<unknown>;

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
function resolveGlobalFetch<TSignal>(): FetchLike<TSignal> | undefined {
  const scope = globalThis as Partial<{ fetch: FetchLike<TSignal> }>;
  const globalFetch = scope.fetch;
  if (typeof globalFetch !== "function") {
    return undefined;
  }
  return (url: string, init?: FetchInit<TSignal>) =>
    globalFetch.call(scope, url, init);
}

/**
 * Wraps a caller's transport so the manager can call it without naming
 * `TSignal` — the erasure the module comment's variance measurement forces.
 *
 * The `init` object is built only when there is a signal to put in it, so a
 * manager without an {@link AssetManagerOptions.abortController} calls
 * `fetch(url)` exactly as it did before cancellation existed.
 */
function eraseFetch<TSignal>(fetchImpl: FetchLike<TSignal>): ErasedFetch {
  return (url: string, signal: unknown): Promise<FetchResponse> =>
    signal === undefined
      ? fetchImpl(url)
      : fetchImpl(url, { signal: signal as TSignal });
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

/** Where a hashed load's digest is deposited on its way to the cache entry. */
interface HashSink {
  /** Assigned once, by the first (and only) read of the body. */
  hash: string | undefined;
}

/**
 * Wraps a response so the bytes a loader reads are hashed on the way through
 * (§76, §79).
 *
 * The body is read **once**, as bytes, and every accessor is derived from that
 * one read: that is what makes the hash a property of the URL rather than of
 * the loader that happened to observe it, which is the only form a manifest can
 * record. `json()` goes through the decoded text for the same reason the
 * bounded view does — a parsed value has no bytes left to hash.
 *
 * @param response the response to hash (already bounded by §96's limit)
 * @param digest the caller's hash implementation
 * @param decodeText the UTF-8 decoder, absent on a runtime that has none
 * @param sink receives the hash; the manager reads it after the loader returns
 * @param refuseText builds the failure for a text read with no decoder
 * @returns a {@link FetchResponse} view over the same response
 */
function hashingResponse(
  response: FetchResponse,
  digest: DigestLike,
  decodeText: TextDecodeLike | undefined,
  sink: HashSink,
  refuseText: () => FourError,
): FetchResponse {
  let bytes: Promise<ArrayBuffer> | undefined;
  const read = async (): Promise<ArrayBuffer> => {
    const data = await response.arrayBuffer();
    sink.hash = await digest(data);
    return data;
  };
  const once = (): Promise<ArrayBuffer> => (bytes ??= read());
  const hashed: FetchResponse = {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    arrayBuffer: once,
    async text(): Promise<string> {
      if (decodeText === undefined) {
        throw refuseText();
      }
      return decodeText(await once());
    },
    async json(): Promise<unknown> {
      return JSON.parse(await hashed.text()) as unknown;
    },
  };
  return hashed;
}

/**
 * Deduplicating, reference-counted asset cache (§76).
 *
 * See the module comment for cache identity, coalescing, failure, and disposal
 * semantics — they are the contract, not implementation detail.
 */
export class AssetManager<TSignal = never> implements Disposable {
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

  readonly #fetch: ErasedFetch | undefined;

  /** Mints one cancellation source per load; `undefined` disables the capability. */
  readonly #abortController: ErasedAbortController | undefined;

  /** §96 input-size limit in bytes; `Infinity` when the caller disabled it. */
  readonly #maximumBytes: number;

  /** §96 whole-load deadline in seconds; `Infinity` when disabled. */
  readonly #timeoutSeconds: number;

  /** Resolved once, so a host without `setTimeout` is diagnosed at load time. */
  readonly #timer: TimerLike | undefined;

  /** §76 content hashing; `undefined` on a runtime with no `crypto.subtle`. */
  readonly #digest: DigestLike | undefined;

  /** UTF-8 decoding for hashed text loads; resolved for the same reason. */
  readonly #decodeText: TextDecodeLike | undefined;

  #disposed = false;

  constructor(options?: AssetManagerOptions<TSignal>) {
    const transport = options?.fetch ?? resolveGlobalFetch<TSignal>();
    this.#fetch = transport === undefined ? undefined : eraseFetch(transport);
    // Assignable without a cast: `signal` is a covariant position, so an
    // `AbortHandle<TSignal>` is an `AbortHandle<unknown>`.
    this.#abortController = options?.abortController;
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
    this.#digest = options?.digest ?? resolveGlobalDigest();
    this.#decodeText = options?.decodeText ?? resolveGlobalTextDecoder();
  }

  /** The effective §96 input-size limit in bytes (diagnostics and tests). */
  get maximumBytes(): number {
    return this.#maximumBytes;
  }

  /** The effective §96 load deadline in seconds (diagnostics and tests). */
  get timeoutSeconds(): number {
    return this.#timeoutSeconds;
  }

  /**
   * Whether cancelling a load also cancels its request — that is, whether an
   * {@link AssetManagerOptions.abortController} was injected (§76).
   *
   * Presence is the capability: {@link AssetManager.load}'s `signal` behaves the
   * same either way, so this is the honest answer to "did the socket actually
   * close?", not a switch that changes the API.
   */
  get canAbortTransport(): boolean {
    return this.#abortController !== undefined;
  }

  /**
   * Whether this manager can compute content hashes (§76) — that is, whether an
   * {@link AssetManagerOptions.digest} was injected or the runtime supplied one
   * (`crypto.subtle`, absent in an insecure browser context).
   *
   * Presence is the capability, exactly as {@link canAbortTransport} is. The
   * difference is what a missing one does: cancellation degrades quietly to
   * promise-level semantics, while a hash that cannot be computed **refuses**,
   * because a verification that silently passes is worse than none.
   */
  get canHashContent(): boolean {
    return this.#digest !== undefined;
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
   * `options.signal` cancels **this** call (§76): the promise rejects, the
   * reference it took is handed back — so an aborted load must not be released —
   * and the request is abandoned once no waiter is left. See the module
   * comment's three cancellation rules.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` if the manager is disposed,
   *   or if it has no `fetch` (none injected and no global one) and would have
   *   had to perform IO.
   * @throws FourError `ASSET_LOAD_FAILED` (asynchronously) on transport
   *   failure, a non-`ok` response, a loader that could not decode, or
   *   cancellation (`context.reason === "aborted"`).
   */
  load<T>(
    url: string,
    loader: AssetLoader<T>,
    options?: AssetLoadOptions,
  ): Promise<T> {
    if (this.#disposed) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `Cannot load "${url}": this AssetManager has been disposed.`,
        { context: { url, loader: loader.name } },
      );
    }

    // A signal that has already fired is answered before the cache is even
    // consulted: no entry, no fetch, no reference to give back. Asynchronously,
    // because "the caller changed its mind" is an outcome of the load, not a
    // programming error like a disposed manager.
    const signal = options?.signal;
    if (signal?.aborted === true) {
      return Promise.reject(abortFailure(url, loader.name));
    }

    // Hashing is a capability, and asking for one this manager cannot compute is
    // a programming error about *wiring*, so it is diagnosed exactly as a
    // missing `fetch` is: synchronously, at the call, naming the way out.
    const expectedHash = options?.expectedHash;
    const wantHash =
      options?.hashContent === true || expectedHash !== undefined;
    const digest = this.#digest;
    if (wantHash && digest === undefined) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `Cannot hash "${url}": this AssetManager has no digest. Pass ` +
          `{ digest } to the constructor — this runtime has no crypto.subtle ` +
          `(an insecure browser context, or Node older than 19).`,
        { context: { url, loader: loader.name } },
      );
    }

    const byUrl = this.#groupFor(loader);
    const existing = byUrl.get(url);
    if (existing !== undefined) {
      existing.refCount += 1;
      const joined = existing.promise as Promise<T>;
      const guarded =
        signal === undefined
          ? joined
          : this.#withAbort(joined, existing, url, loader, signal);
      // Verification wraps *outside* the abort guard on purpose: an aborted
      // waiter has already handed its reference back, and a verification that
      // ran afterwards would hand back a second one.
      return wantHash
        ? this.#verified(guarded, existing, url, loader, expectedHash)
        : guarded;
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
    const handle = this.#abortController?.();
    const sink: HashSink = { hash: undefined };
    const entry: CacheEntry = {
      url,
      promise: Promise.resolve(),
      refCount: 1,
      settled: false,
      value: undefined,
      evicted: false,
      hash: undefined,
      abort:
        handle === undefined
          ? undefined
          : (): void => {
              handle.abort();
            },
    };
    const promise = this.#withDeadline(
      this.#run(
        fetchImpl,
        url,
        loader,
        handle?.signal,
        wantHash ? digest : undefined,
        sink,
      ),
      timer,
      url,
      loader.name,
      entry.abort,
    ).then(
      (value): T => {
        entry.settled = true;
        entry.value = value;
        entry.hash = sink.hash;
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
    const guarded =
      signal === undefined
        ? promise
        : this.#withAbort(promise, entry, url, loader, signal);
    return wantHash
      ? this.#verified(guarded, entry, url, loader, expectedHash)
      : guarded;
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
   * The content hash recorded for (`url`, `loader`) (§76), or `undefined` when
   * the entry is absent, still loading, or was loaded without
   * {@link AssetLoadOptions.hashContent}.
   *
   * This is the value §79's manifest records beside the URL. Like {@link get} it
   * is a peek: it never changes the reference count and never triggers a load.
   */
  contentHash(url: string, loader: AssetLoader<unknown>): string | undefined {
    const entry = this.#entries.get(loader)?.get(url);
    return entry?.settled === true ? entry.hash : undefined;
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
    // disposes it, because there is nothing to dispose yet. The request is
    // deliberately *not* aborted here — see the module comment's rule 3,
    // "`release` is not `abort`".
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
   * One waiter's view of `shared`, cancellable by its own signal (§76).
   *
   * A separate promise per waiter is what makes rule 2 possible: rejecting the
   * caller that aborted must not disturb the callers that did not, and they all
   * hold the one coalesced `shared`. The `done` latch makes the two outcomes
   * exclusive in both orders — including the genuine race where a signal fires
   * synchronously after the load resolved but before this waiter's microtask
   * runs, which resolves as an abort because that is the order the caller
   * observed.
   *
   * `shared`'s own rejection is consumed by the handler installed here, so a
   * waiter that aborts first never leaves an unhandled rejection behind.
   */
  #withAbort<T>(
    shared: Promise<T>,
    entry: CacheEntry,
    url: string,
    loader: AssetLoader<unknown>,
    signal: AbortSignalLike,
  ): Promise<T> {
    let done = false;
    // Definite assignment: the executor below runs synchronously, before
    // anything can call `onAbort`.
    let rejectAborted!: (reason: FourError) => void;
    const finish = (): boolean => {
      if (done) {
        return false;
      }
      done = true;
      signal.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = (): void => {
      if (!finish()) {
        return;
      }
      this.#detach(entry, url, loader);
      rejectAborted(abortFailure(url, loader.name));
    };
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject;
    });
    signal.addEventListener("abort", onAbort);
    // A race, exactly as the deadline is: this promise can only ever reject
    // with the abort above, and `shared`'s own outcome passes through
    // untouched — including its error, which is rethrown rather than
    // reclassified.
    return Promise.race([
      shared.then(
        (value): T => {
          finish();
          return value;
        },
        (error: unknown): never => {
          finish();
          throw error;
        },
      ),
      aborted,
    ]);
  }

  /**
   * One waiter's content-hash check over a shared load (§76, §79).
   *
   * Per waiter, not per load — see the module comment's rule 2: the load
   * computes one hash, and each caller compares it with the expectation it
   * brought. A failed check rejects only this caller and hands its reference
   * back through {@link #detach}, exactly as an abort does, because a caller
   * that refused the bytes is not holding the asset.
   *
   * Two failures, and both are refusals rather than passes (rule 3): the hash
   * differs from `expectedHash`, or there is no hash at all — which happens when
   * this call joined a load that nobody asked to hash, and is reported as such
   * rather than being silently accepted.
   */
  #verified<T>(
    shared: Promise<T>,
    entry: CacheEntry,
    url: string,
    loader: AssetLoader<unknown>,
    expectedHash: string | undefined,
  ): Promise<T> {
    return shared.then((value: T): T => {
      const observedHash = entry.hash;
      if (observedHash === undefined) {
        this.#detach(entry, url, loader);
        throw new FourError(
          "ASSET_LOAD_FAILED",
          `Cannot verify "${url}": no content hash was computed — the load this ` +
            `call joined was not hashing, or loader "${loader.name}" never read ` +
            `the body. Load a key with { hashContent: true } consistently, or ` +
            `release it before verifying it.`,
          {
            context: {
              url,
              loader: loader.name,
              reason: "hash-unavailable",
              expectedHash,
            },
          },
        );
      }
      if (expectedHash !== undefined && observedHash !== expectedHash) {
        this.#detach(entry, url, loader);
        throw new FourError(
          "ASSET_LOAD_FAILED",
          `"${url}" hashes to ${observedHash}, not the declared ${expectedHash} (§79, §96).`,
          {
            context: {
              url,
              loader: loader.name,
              reason: "hash-mismatch",
              expectedHash,
              observedHash,
            },
          },
        );
      }
      return value;
    });
  }

  /**
   * Hands back the one reference an aborted `load` took (§76 rule 1).
   *
   * Deliberately not {@link AssetManager.release}: that resolves the key through
   * the cache, and this waiter's reference belongs to `entry` — which a `clear()`
   * plus a fresh `load` may already have replaced in that slot. The refcount it
   * decrements is therefore always the one it incremented.
   *
   * Reaching zero on a **pending** entry is the only case that differs from
   * `release`, and it is rule 3's other half: nobody is waiting for these bytes
   * any more, so the slot is freed at once — leaving it would let the next
   * `load` coalesce onto a load that is about to be abandoned — and the request
   * is aborted when the manager can. `evicted` is still set, so a response that
   * beats the abort is disposed rather than cached.
   */
  #detach(entry: CacheEntry, url: string, loader: AssetLoader<unknown>): void {
    entry.refCount -= 1;
    if (entry.refCount > 0) {
      return;
    }
    if (entry.settled) {
      this.#evict(loader, url, entry);
      disposeValue(entry.value);
      return;
    }
    entry.evicted = true;
    this.#evict(loader, url, entry);
    entry.abort?.();
  }

  /**
   * Bounds `work` by {@link AssetManagerOptions.timeoutSeconds} (§96).
   *
   * The deadline covers transport *and* decode, because §96's requirement names
   * "expensive decoders" and both failure modes look identical to a caller. On
   * expiry the returned promise rejects, `abort` (when the manager has one)
   * cancels the request, and `load`'s own rejection handler evicts the entry, so
   * the key is immediately retryable. A decode that has already begun still runs
   * to its end — no signal can reach inside a loader — but its result is
   * discarded, and `work` settling clears the timer either way.
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
    abort: (() => void) | undefined,
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
        // Cancel first, reject second: the caller's promise and the socket
        // should not be able to observe each other in the wrong order.
        abort?.();
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
    fetchImpl: ErasedFetch,
    url: string,
    loader: AssetLoader<T>,
    signal: unknown,
    digest: DigestLike | undefined,
    sink: HashSink,
  ): Promise<T> {
    let response: FetchResponse;
    try {
      response = await fetchImpl(url, signal);
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

    // Hashing wraps *inside* the §96 bound: the bytes hashed are the bytes the
    // loader is allowed to see, so an over-budget body is refused before a
    // digest is ever computed over it.
    if (digest !== undefined) {
      response = hashingResponse(
        response,
        digest,
        this.#decodeText,
        sink,
        () =>
          new FourError(
            "ASSET_LOAD_FAILED",
            `Cannot hash "${url}": loader "${loader.name}" reads the body as ` +
              `text and this runtime has no TextDecoder. Pass { decodeText } to ` +
              `the AssetManager constructor.`,
            {
              context: { url, loader: loader.name, reason: "hash-unavailable" },
            },
          ),
      );
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

/**
 * The rejection a cancelled load produces (§76).
 *
 * `context.reason` discriminates it from every other `ASSET_LOAD_FAILED` — a
 * caller that retries on failure but not on cancellation needs that distinction,
 * and §89's code list has no cancellation member to give it one.
 */
function abortFailure(url: string, loaderName: string): FourError {
  return new FourError(
    "ASSET_LOAD_FAILED",
    `Loading "${url}" was aborted by the caller.`,
    { context: { url, loader: loaderName, reason: "aborted" } },
  );
}
