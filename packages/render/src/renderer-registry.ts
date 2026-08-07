/**
 * The §62 backend registry — how a name becomes a renderer without this
 * package, or the `four` umbrella, ever importing a backend (R-2, A-8).
 *
 * §45 spells the application's renderer option
 * `"auto" | "webgpu" | "webgl2" | "canvas2d" | "svg"`, and §62 says what
 * `"auto"` means: *"Automatic selection should prefer WebGPU, then WebGL 2,
 * then an appropriate 2D backend. If WebGPU initialization fails at runtime
 * under `"auto"`, selection falls back to WebGL 2 and emits a diagnostics
 * event; an explicit `renderer: "webgpu"` fails fast with
 * `RENDERER_INITIALIZATION_FAILED` (§89) rather than silently downgrading."*
 *
 * The obvious implementation — a `switch` over the string that constructs the
 * matching class — is the one this repository may not have. It would make the
 * module holding the switch import **every** backend package, so every program
 * that ever named `Application` would carry a WebGL renderer, a WebGPU
 * renderer, a Canvas renderer and an SVG renderer whether or not it drew a
 * single pixel; §91's tree-shaking requirement and the 14.88 kB example that
 * WP-3.6 measured are both spent in one line. That is the whole reason
 * `ApplicationOptions.renderer` has been an *instance* since Phase 3 (MEMORY,
 * 2026-08-01).
 *
 * So the dependency is inverted: **backends register themselves into this
 * neutral host**, and the name is resolved against whatever the application
 * actually imported.
 *
 * ```ts
 * import { registerWebglRenderer } from "@four/render-webgl";
 *
 * registerWebglRenderer();                      // the app names its backends
 * const app = new Application({ renderer: "auto", canvas });
 * await app.initialize();                       // resolves against the registry
 * ```
 *
 * The §3.1 matrix is unchanged and no edge is added: `render-webgl` already
 * depends on `render`, and `four` already depends on `render`. Nothing here
 * imports a backend, at type level or at runtime.
 *
 * ## Explicit registration, never a side-effect import (decision, 2026-08-07)
 *
 * Registration is a **function the application calls**, not something an
 * `import "@four/render-webgl/register"` performs on evaluation. Every package
 * in this workspace declares `"sideEffects": false`, which is precisely the
 * promise that importing a module and using nothing from it may be deleted —
 * a side-effect registration module would be *correctly* dropped by any
 * bundler that believes the manifest, and would then fail at runtime with
 * "nothing is registered". The two ways out are both worse than an explicit
 * call: carving an exception into every backend's `sideEffects` field defeats
 * the field's purpose, and dropping the field entirely un-shakes the whole
 * package. An explicit `registerWebglRenderer()` is a value the bundler can
 * see being used, so it survives for exactly the programs that want it and
 * disappears from the ones that do not.
 *
 * ## What an application that never selects by name pays: nothing
 *
 * {@link resolveRenderer} deliberately does **not** mention
 * {@link RendererRegistry}. It reads a module-level slot that only
 * {@link registerRenderer} ever writes, so a bundle whose application hands
 * `Application` a concrete instance retains the eight-line resolver and its
 * error text, and drops the registry class, the `Map`, the §62 preference
 * order, and every backend along with them. Measured on the four size-limited
 * examples: unchanged to the byte after minification except for that resolver
 * (see the packet's size proof).
 *
 * ## The diagnostics event of §62, and why it is a callback
 *
 * §62 asks for "a diagnostics event" when `"auto"` falls back. The frozen §3.1
 * matrix gives `@four/render` no `@four/diagnostics` edge — `render` is wave 3
 * beside `diagnostics`, not above it — and this packet may not add one. The
 * report is therefore delivered through
 * {@link RendererResolveOptions.onFallback}, a callback the caller supplies;
 * an application that wants it on a diagnostics channel forwards it in one
 * line, which is the same shape `PointerInput` uses to stay DOM-free. The
 * information §62 asks to be reported — which backend was skipped and why — is
 * carried in full by {@link RendererFallbackReport}.
 */

import { FourError } from "@four/core";

import type { Renderer, RendererBackend, RendererOptions } from "./renderer.js";

/**
 * What an application may ask for (§45, §62): `"auto"` for §62's ordered
 * preference, or one {@link RendererBackend} by name.
 *
 * §45's literal union omits `"null"`; this one keeps it, because the headless
 * tier is a real §62 backend and naming it is how a determinism or CI run asks
 * for "a renderer that draws nothing" without importing one. It is never
 * chosen by `"auto"` — see {@link AUTO_RENDERER_ORDER}.
 */
export type RendererSelection = "auto" | RendererBackend;

/**
 * The order `"auto"` tries registered backends in — §62's "prefer WebGPU, then
 * WebGL 2, then an appropriate 2D backend", written out.
 *
 * `"null"` is absent on purpose. A headless renderer would "succeed" for every
 * application whose real backend was unavailable, turning a blank screen into
 * the automatic outcome; §62's fallback ladder ends at a 2D backend that
 * genuinely draws, and running headless is an explicit choice
 * (`renderer: "null"`, or no renderer at all).
 *
 * Registration order is deliberately **not** consulted: §62 fixes the
 * preference, so two applications that register the same backends in different
 * orders must still resolve `"auto"` the same way (§33).
 */
export const AUTO_RENDERER_ORDER = [
  "webgpu",
  "webgl2",
  "canvas2d",
  "svg",
] as const satisfies readonly RendererBackend[];

/**
 * One backend's entry in a {@link RendererRegistry} — everything the registry
 * needs to decide whether to try it, and how to build it.
 */
export interface RendererRegistration {
  /** Which §62 backend this builds. One registration per backend per registry. */
  readonly backend: RendererBackend;

  /**
   * A **cheap, side-effect-free** answer to "could this environment run this
   * backend at all?" (§62 capability tiers).
   *
   * This is a pre-filter, not the real gate: the real gate is
   * {@link Renderer.initialize}, which is the only code that can tell a blocked
   * GPU from a working one, and whose failure `"auto"` already recovers from by
   * moving to the next backend. So a probe must not acquire a context, must not
   * allocate a device, and above all must not touch the caller's canvas — a
   * canvas hands out one context per type, so a probe that called
   * `getContext("webgl2")` with its own attributes would silently fix the
   * attributes of the context the backend later acquires.
   *
   * Answering `true` optimistically is safe (initialization decides);
   * answering `false` is a promise that trying would be pointless.
   */
  isSupported(options?: RendererOptions): boolean;

  /**
   * Constructs the backend. Must not initialize it — the registry calls
   * {@link Renderer.initialize} itself, because §62's fallback is defined in
   * terms of *initialization* failing.
   */
  create(options?: RendererOptions): Renderer | Promise<Renderer>;
}

/** Why `"auto"` moved past a registered backend (§62's "diagnostics event"). */
export type RendererFallbackReason =
  /** {@link RendererRegistration.isSupported} answered `false`. */
  | "unsupported"
  /** The backend was built, and {@link Renderer.initialize} rejected. */
  | "initialization-failed";

/** One skipped backend, as {@link RendererResolveOptions.onFallback} sees it. */
export interface RendererFallbackReport {
  /** The backend that was not used. */
  readonly backend: RendererBackend;
  /** Why it was not used. */
  readonly reason: RendererFallbackReason;
  /** The rejection, for `"initialization-failed"`; absent otherwise. */
  readonly error?: unknown;
}

/**
 * {@link RendererOptions} plus the §62 fallback report — what
 * {@link resolveRenderer} takes, and what it forwards to both
 * {@link RendererRegistration.create} and {@link Renderer.initialize}.
 */
export interface RendererResolveOptions extends RendererOptions {
  /**
   * Called once per backend `"auto"` skips, in the order they were tried
   * (§62's diagnostics event; see the module header for why it is a callback).
   *
   * Never called for an explicit selection: naming a backend means it must
   * work, so its failure is thrown rather than reported. A throwing listener
   * propagates — this is the application's own code.
   */
  onFallback?: (report: RendererFallbackReport) => void;
}

/** §89's code for every failure in this module. */
const SELECTION_ERROR_CODE = "RENDERER_INITIALIZATION_FAILED";

/** Renders a backend list for the §85 failure messages. */
function describeBackends(backends: readonly RendererBackend[]): string {
  return backends.length === 0
    ? "none"
    : backends.map((backend) => JSON.stringify(backend)).join(", ");
}

/**
 * The backends an application has opted into, and the §62 selection rule over
 * them (R-2).
 *
 * Applications normally use the shared registry through
 * {@link registerRenderer} and {@link resolveRenderer} and never name this
 * class. Construct one directly to keep a selection scope to itself — a test
 * that must not see another test's registrations, or a host embedding two
 * independent engines:
 *
 * ```ts
 * const registry = new RendererRegistry();
 * registerWebglRenderer(registry);
 * const renderer = await resolveRenderer("auto", { canvas }, registry);
 * ```
 */
export class RendererRegistry {
  /** `Map` preserves insertion order; `backends` reports it (ground rule 5). */
  readonly #entries = new Map<RendererBackend, RendererRegistration>();

  /**
   * Adds `registration`. Returns `this` so registrations chain.
   *
   * @throws FourError `RENDERER_INITIALIZATION_FAILED` if that backend is
   * already registered. A silent overwrite would make which renderer `"auto"`
   * builds depend on module evaluation order, which is the class of bug §33
   * exists to prevent. Use a second registry, or
   * {@link RendererRegistry.unregister}.
   */
  register(registration: RendererRegistration): this {
    const backend = registration.backend;
    if (this.#entries.has(backend)) {
      throw new FourError(
        SELECTION_ERROR_CODE,
        `A ${JSON.stringify(backend)} renderer is already registered (§62); registering a second one would make selection depend on import order. Unregister it first, or use a separate RendererRegistry.`,
        { context: { backend, registered: this.backends } },
      );
    }
    this.#entries.set(backend, registration);
    return this;
  }

  /** Removes `backend`'s registration; `true` if there was one. */
  unregister(backend: RendererBackend): boolean {
    return this.#entries.delete(backend);
  }

  /** Whether `backend` is registered. */
  has(backend: RendererBackend): boolean {
    return this.#entries.has(backend);
  }

  /** The registration for `backend`, or `undefined`. */
  get(backend: RendererBackend): RendererRegistration | undefined {
    return this.#entries.get(backend);
  }

  /** Number of registered backends. */
  get size(): number {
    return this.#entries.size;
  }

  /** The registered backends, in registration order. */
  get backends(): RendererBackend[] {
    return [...this.#entries.keys()];
  }

  /**
   * Builds and initializes the renderer `selection` names (§62).
   *
   * **An explicit backend fails fast.** §62 requires it: `renderer: "webgpu"`
   * on a machine without WebGPU must say so, not quietly hand back WebGL 2 and
   * leave an application wondering why its compute pass never ran. So an
   * unregistered name, an unsupported environment, and a rejected
   * `initialize` all reject here, unchanged and uncaught.
   *
   * **`"auto"` walks {@link AUTO_RENDERER_ORDER}** and takes the first backend
   * that is registered, answers {@link RendererRegistration.isSupported}, and
   * initializes. Every backend it passes over is reported through
   * {@link RendererResolveOptions.onFallback} — §62's diagnostics event — and a
   * backend whose `initialize` rejected is disposed before the walk continues,
   * so a half-acquired context is not left behind. When nothing works the
   * rejection names every backend that was tried and why each one was not used;
   * when *nothing is registered* it says that instead, which is the mistake
   * this API is most likely to produce.
   *
   * The renderer comes back **initialized**. That is forced by §62 — falling
   * back on initialization failure is only possible if the registry is the one
   * calling `initialize` — and callers must not call it again (backends treat a
   * second call as an error).
   */
  async resolve(
    selection: RendererSelection,
    options?: RendererResolveOptions,
  ): Promise<Renderer> {
    if (selection !== "auto") {
      return this.#resolveExplicit(selection, options);
    }

    const reports: RendererFallbackReport[] = [];
    for (const backend of AUTO_RENDERER_ORDER) {
      const registration = this.#entries.get(backend);
      if (registration === undefined) {
        continue;
      }
      if (!registration.isSupported(options)) {
        this.#report(reports, { backend, reason: "unsupported" }, options);
        continue;
      }
      const renderer = await registration.create(options);
      try {
        await renderer.initialize(options);
      } catch (error: unknown) {
        // The backend acquired nothing it can keep; releasing it is this
        // walk's job, and a disposal that itself fails must not mask the
        // initialization failure that caused it (§83).
        try {
          renderer.dispose();
        } catch {
          // Intentionally ignored: see above.
        }
        this.#report(
          reports,
          { backend, reason: "initialization-failed", error },
          options,
        );
        continue;
      }
      return renderer;
    }

    throw new FourError(
      SELECTION_ERROR_CODE,
      `renderer: "auto" found no usable backend (§62). Registered: ${describeBackends(this.backends)}.${
        reports.length === 0
          ? " Call a backend's register function — for example `registerWebglRenderer()` from @four/render-webgl — before selecting by name."
          : ` Tried, in §62 order: ${reports
              .map(
                (report) =>
                  `${JSON.stringify(report.backend)} (${report.reason})`,
              )
              .join(", ")}.`
      }`,
      {
        context: {
          selection,
          registered: this.backends,
          tried: reports.map((report) => ({
            backend: report.backend,
            reason: report.reason,
          })),
        },
        cause: reports.find((report) => report.error !== undefined)?.error,
      },
    );
  }

  /** {@link RendererRegistry.resolve} for a named backend; §62's fail-fast half. */
  async #resolveExplicit(
    backend: RendererBackend,
    options?: RendererResolveOptions,
  ): Promise<Renderer> {
    const registration = this.#entries.get(backend);
    if (registration === undefined) {
      throw new FourError(
        SELECTION_ERROR_CODE,
        `No ${JSON.stringify(backend)} renderer is registered (§62). Registered: ${describeBackends(this.backends)}. A backend registers itself only when the application calls its register function — for example \`registerWebglRenderer()\` from @four/render-webgl.`,
        { context: { selection: backend, registered: this.backends } },
      );
    }
    if (!registration.isSupported(options)) {
      throw new FourError(
        SELECTION_ERROR_CODE,
        `The ${JSON.stringify(backend)} renderer is registered but reports that this environment cannot run it (§62). An explicitly named backend fails fast rather than downgrading; use renderer: "auto" to fall back.`,
        { context: { selection: backend, registered: this.backends } },
      );
    }
    const renderer = await registration.create(options);
    await renderer.initialize(options);
    return renderer;
  }

  /** Records a skipped backend and forwards it to the §62 report callback. */
  #report(
    reports: RendererFallbackReport[],
    report: RendererFallbackReport,
    options?: RendererResolveOptions,
  ): void {
    reports.push(report);
    options?.onFallback?.(report);
  }
}

/**
 * The process-wide registry, created by the first {@link registerRenderer}
 * call and `undefined` until then.
 *
 * A `let` rather than an eagerly constructed instance so that a program which
 * never registers a backend never references {@link RendererRegistry} at all,
 * and the class — with the `Map`, the §62 walk, and the messages — leaves the
 * bundle. See the module header.
 */
let sharedRegistry: RendererRegistry | undefined;

/**
 * Opts `registration` into the shared registry (or into `registry`), and
 * returns the registry it went into (§62).
 *
 * Called by a backend package's own `register…` function, which is what an
 * application calls:
 *
 * ```ts
 * export function registerWebglRenderer(registry?: RendererRegistry): RendererRegistry {
 *   return registerRenderer({ backend: "webgl2", isSupported, create }, registry);
 * }
 * ```
 */
export function registerRenderer(
  registration: RendererRegistration,
  registry?: RendererRegistry,
): RendererRegistry {
  const target = registry ?? (sharedRegistry ??= new RendererRegistry());
  target.register(registration);
  return target;
}

/**
 * The backends registered in the shared registry (or in `registry`), in
 * registration order. Empty when nothing has registered.
 */
export function registeredRenderers(
  registry?: RendererRegistry,
): RendererBackend[] {
  return (registry ?? sharedRegistry)?.backends ?? [];
}

/**
 * Empties the shared registry — a **test** affordance (§92), and the reason
 * {@link RendererRegistry} exists as a constructible class for anything that
 * needs isolation in production code.
 *
 * Drops the registry itself rather than its entries, so the post-condition is
 * exactly the pre-condition of a fresh process: nothing registered, and no
 * registry.
 */
export function clearRegisteredRenderers(): void {
  sharedRegistry = undefined;
}

/**
 * Resolves `selection` against the shared registry (or `registry`) and returns
 * an **initialized** renderer (§45, §62).
 *
 * ```ts
 * registerWebglRenderer();
 * const renderer = await resolveRenderer("auto", { canvas });
 * ```
 *
 * See {@link RendererRegistry.resolve} for the selection rule; this function
 * adds only the "nothing has registered" case, which is the mistake worth its
 * own message.
 *
 * @throws FourError `RENDERER_INITIALIZATION_FAILED` (§89) when no backend is
 * registered, when a named backend is not registered or reports itself
 * unusable, or when `"auto"` exhausts §62's order.
 */
export async function resolveRenderer(
  selection: RendererSelection,
  options?: RendererResolveOptions,
  registry?: RendererRegistry,
): Promise<Renderer> {
  const target = registry ?? sharedRegistry;
  if (target === undefined) {
    // Deliberately the shortest message in this module. Every *other* failure
    // here is reported by `RendererRegistry`, which only exists in a bundle
    // that registered something; this one is the branch every application
    // carries, so it says the one thing that is actionable and stops (§85).
    throw new FourError(
      SELECTION_ERROR_CODE,
      `Cannot select renderer ${JSON.stringify(selection)}: no backend is registered (§62). Call e.g. registerWebglRenderer() from @four/render-webgl first, or pass a Renderer instance (§45).`,
      { context: { selection, registered: [] } },
    );
  }
  return target.resolve(selection, options);
}
