/**
 * The §81 plugin system (RFC 0002, accepted 2026-08-21; gap `A-3`).
 *
 * §81 promises a `FourPlugin` with an `install(context: PluginContext)` and
 * eleven extension points. This module is the whole of what `@four/core` owns
 * of that promise: the plugin value, the capability token, the context, the
 * host, the API version, and the restricted range grammar. It knows nothing
 * about *what* a plugin extends — every registry §81 wants to hand over lives
 * downstream of `core` in the frozen §3.1 matrix, so naming even one of them
 * here would invert an edge.
 *
 * ## Three rules that shape everything below
 *
 * 1. **A plugin is a value the application installs.** {@link PluginHost.add}
 *    takes a {@link FourPlugin} object — never a URL, never a module specifier,
 *    never a name read out of a document. §96's *"safe plugin boundaries"* is
 *    not a sandbox here (see below); it is the rule that untrusted content can
 *    never *become* a plugin, and that rule is enforced by this signature.
 * 2. **Registration is explicit, never a side effect of importing.** All 24
 *    packages declare `"sideEffects": false`, so an `import "…/install"` module
 *    is *correctly* deletable by any bundler that believes the manifest
 *    (A-8, 2026-08-07). A plugin is added and installed by a call.
 * 3. **Install order is specified, not emergent (§33).** A plugin registers a
 *    `SimulationSystem`, and equal-priority systems run in registration order —
 *    so install-order nondeterminism *is* simulation-order nondeterminism.
 *    Order here is topological over declared dependencies with ties broken by
 *    {@link PluginHost.add} order, never by `Map` enumeration and never by a
 *    name sort.
 *
 * ## §96: what a "safe plugin boundary" is, and what it is not
 *
 * A plugin is JavaScript the application imported. It runs with the
 * application's authority. **This module does not sandbox anything, and no part
 * of it should be read as providing isolation** — that would mean Workers or
 * realms plus a serialisable message boundary for every registry a capability
 * hands over, which is a project in itself.
 *
 * What is enforced is the boundary that is mechanically enforceable: a plugin
 * arrives as a value, so no deserialization path can reach this host, and a
 * scene document naming a component type it has not registered gets §79's
 * existing error rather than a load. `tests/integration/plugin-boundary.test.ts`
 * is the gate.
 */

import { FourError } from "./errors.js";

/**
 * The §81 plugin API version, versioned **independently of package semver** —
 * the way §80 makes the scene-format version independent of it.
 *
 * `0.1.0` rather than `1.0.0` by owner decision (RFC 0002 Q5, register row 6:
 * *"start at `0.1.0` — honesty beats a range that parses"*). Five of §81's
 * eleven extension points have no capability at all today, and a `1.0.0` here
 * would be a stability promise over a surface that is mostly absent. The
 * consequence is deliberate and worth knowing before you write `engineRange`:
 * under semver a caret range on a `0.x` version is **minor-locked**, so
 * `"^0.1.0"` accepts `0.1.z` and refuses `0.2.0`. Every plugin written against
 * this version will need an explicit range bump when the plugin API does.
 */
export const PLUGIN_API_VERSION = "0.1.0";

/** The §89 code every refusal in this module carries. */
const PLUGIN_ERROR_CODE = "INVALID_APPLICATION_STATE";

/**
 * One entry of §81's *"plugins shall declare dependencies"* — the name of
 * another plugin that must be installed first, and the range of **its**
 * `version` this plugin accepts.
 */
export interface PluginDependency {
  /** The other plugin's {@link FourPlugin.name}. */
  readonly name: string;
  /** A range in the restricted grammar {@link satisfiesPluginRange} accepts. */
  readonly range: string;
}

/**
 * §81's plugin, plus the two fields §81's closing sentence requires
 * (*"plugins shall declare dependencies and compatibility ranges"*) and did not
 * put in its code block.
 *
 * ```ts
 * const gridPlugin: FourPlugin = {
 *   name: "@vendor/grid",
 *   version: "1.2.0",
 *   engineRange: "^0.1.0",
 *   install(context) {
 *     context.require(SIMULATION_SYSTEMS).register(new GridSystem());
 *   },
 * };
 * ```
 */
export interface FourPlugin {
  /** Stable identity; the key for dependency resolution and for refusals. */
  readonly name: string;
  /** This plugin's own version, as `X.Y.Z`. Reported by every refusal. */
  readonly version: string;
  /** Other plugins that must be installed first (§81). */
  readonly dependencies?: readonly PluginDependency[];
  /**
   * The range of {@link PLUGIN_API_VERSION} this plugin accepts (§81, §90).
   * Absent means "any" — the plugin makes no compatibility claim.
   */
  readonly engineRange?: string;
  /**
   * Runs once, during {@link PluginHost.install}, with the capabilities the
   * host provides. May be asynchronous — which is exactly why installation
   * cannot happen in a constructor and lives in §45's `initialize` lifecycle
   * step instead.
   */
  install(context: PluginContext): void | Promise<void>;
  /**
   * Undoes {@link FourPlugin.install}. Optional in the type *and* in practice:
   * a plugin that acquired a capability nothing can revoke cannot be
   * uninstalled at all (see {@link PluginHost.uninstall}), so for most plugins
   * the honest lifecycle is install-once.
   */
  uninstall?(context: PluginContext): void;
}

/**
 * A typed key naming one thing a host can hand a plugin (RFC 0002 §2).
 *
 * The type parameter is carried by {@link PluginCapability.capabilityType},
 * which is **never present at runtime** — it exists so that
 * `context.require(RENDERER_REGISTRY)` is a `RendererRegistry` to the compiler
 * while this file names nothing but a string and a phantom type. That is what
 * lets each registry's *owning* package declare its own token without `core`
 * gaining an edge to it, and what makes a sixth capability additive.
 */
export interface PluginCapability<T> {
  /** The capability's identity, e.g. `"four:renderer-registry"`. */
  readonly name: string;
  /**
   * Whether a plugin that acquired this capability can still be uninstalled
   * (RFC 0002 §4). Default `false`, by owner decision (Q3, register row 6:
   * *"conservative default (non-revocable)"*).
   */
  readonly revocable: boolean;
  /**
   * Phantom carrier for `T`. Never assigned, never read; declaring it is the
   * only way an interface can be generic in a value it does not hold.
   */
  readonly capabilityType?: T;
}

/** Options for {@link defineCapability}. */
export interface DefineCapabilityOptions {
  /**
   * Whether a plugin that acquired this capability may be uninstalled.
   * Defaults to `false`.
   *
   * Set it only where the underlying registry really has removal *and* that
   * removal is safe to perform twice — `SystemRegistry.unregister` qualifies;
   * `ComponentSerializerRegistry`, which throws on a duplicate precisely so a
   * document's shape cannot depend on evaluation order, does not.
   */
  readonly revocable?: boolean;
}

/**
 * Declares a capability token. Call it once, at module scope, in the package
 * that owns the value being handed over.
 *
 * ```ts
 * export const SOLVER_REGISTRY = defineCapability<SolverRegistry>(
 *   "four:solver-registry",
 * );
 * ```
 */
export function defineCapability<T>(
  name: string,
  options?: DefineCapabilityOptions,
): PluginCapability<T> {
  return { name, revocable: options?.revocable ?? false };
}

/**
 * One capability and the value a host provides for it.
 *
 * RFC 0002 spells the constructor argument `PluginCapabilityMap`; it ships as
 * an **ordered list** rather than a `Map` for a reason §33 cares about: the
 * order capabilities were provided in is the order
 * {@link PluginContext.capabilities} reports, and a list makes that a property
 * of the value rather than of `Map` enumeration. Build entries with
 * {@link bindCapability}, which is the only type-safe way to pair a
 * `PluginCapability<T>` with a `T`.
 */
export interface PluginCapabilityBinding {
  readonly capability: PluginCapability<unknown>;
  readonly value: unknown;
}

/** Pairs `capability` with `value`, checked by the compiler. */
export function bindCapability<T>(
  capability: PluginCapability<T>,
  value: T,
): PluginCapabilityBinding {
  return { capability, value };
}

/**
 * What a plugin's `install` receives (§81).
 *
 * The context is **live only while the plugin's `install` (or `uninstall`)
 * runs**. Holding on to it and reaching for a capability later is refused:
 * {@link PluginContext.get} and {@link PluginContext.require} throw once the
 * host has sealed the context, which is what makes RFC 0002's *"registration is
 * only legal during install"* a rule rather than a request. What a plugin does
 * with a registry it already fetched is, honestly, beyond this seam's reach.
 */
export interface PluginContext {
  /** The capability's value, or `undefined` when this host does not provide it. */
  get<T>(capability: PluginCapability<T>): T | undefined;
  /**
   * The capability's value, or a §85 refusal naming it and listing what this
   * host does provide.
   */
  require<T>(capability: PluginCapability<T>): T;
  /** Every capability name this host provides, in the order it was provided (§33). */
  readonly capabilities: readonly string[];
  /** The plugins installed so far, in install order. */
  readonly plugins: readonly FourPlugin[];
}

// ---------------------------------------------------------------------------
// The restricted range grammar (RFC 0002 §5)
// ---------------------------------------------------------------------------

/** `X.Y.Z`, and nothing else — no prerelease, no build metadata, no `v` prefix. */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** `*`, `X.Y.Z`, `^X.Y.Z`, `~X.Y.Z`, `>=X.Y.Z`. */
const RANGE_PATTERN = /^(\^|~|>=)?(\d+)\.(\d+)\.(\d+)$/;

type Triple = readonly [number, number, number];

function parseVersion(version: string, what: string): Triple {
  const match = VERSION_PATTERN.exec(version);
  if (match === null) {
    throw new FourError(
      PLUGIN_ERROR_CODE,
      `${what} must be exactly \`X.Y.Z\` (§81); got ${JSON.stringify(version)}.`,
      { context: { version } },
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareTriples(a: Triple, b: Triple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Whether `version` satisfies `range`, in the **restricted** grammar §81 uses:
 * `*`, `X.Y.Z`, `^X.Y.Z`, `~X.Y.Z`, `>=X.Y.Z`.
 *
 * Anything else is refused rather than approximated. Taking a semver dependency
 * into `@four/core` — the package every other package depends on — to serve a
 * feature nothing uses yet is not a trade worth making, and silently
 * mis-parsing a range a user believed was supported is worse than refusing it
 * (RFC 0002 §5; the same stance A-23 took on limits).
 *
 * `^` is standard semver caret, which means it is **minor-locked below 1.0.0**:
 * `^0.1.0` accepts `0.1.z` and refuses `0.2.0`. `~` is always minor-locked.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` if `version` or `range` is
 * outside the grammar.
 */
export function satisfiesPluginRange(version: string, range: string): boolean {
  const actual = parseVersion(version, "A plugin API version");
  if (range === "*") {
    return true;
  }
  const match = RANGE_PATTERN.exec(range);
  if (match === null) {
    throw new FourError(
      PLUGIN_ERROR_CODE,
      `Plugin range ${JSON.stringify(range)} is outside §81's grammar: * X.Y.Z ^X.Y.Z ~X.Y.Z >=X.Y.Z.`,
      { context: { range } },
    );
  }
  const operator = match[1];
  const bound: Triple = [Number(match[2]), Number(match[3]), Number(match[4])];
  if (operator === undefined) {
    return compareTriples(actual, bound) === 0;
  }
  if (compareTriples(actual, bound) < 0) {
    return false;
  }
  if (operator === ">=") {
    return true;
  }
  // `~` is always minor-locked. `^` is minor-locked below 1.0.0 and
  // major-locked at or above it — standard semver, and the reason
  // `PLUGIN_API_VERSION` starting at `0.1.0` is the honest choice it is.
  if (operator === "~" || bound[0] === 0) {
    return actual[0] === bound[0] && actual[1] === bound[1];
  }
  return actual[0] === bound[0];
}

// ---------------------------------------------------------------------------
// The runtime: context + install
// ---------------------------------------------------------------------------

/**
 * The live {@link PluginContext} and the install algorithm.
 *
 * Deliberately **not** exported, and deliberately not reachable from
 * {@link PluginHost}'s uninstall path: `Application` installs through the
 * {@link installPlugins} front door, so a bundle whose application never
 * uninstalls a plugin keeps this class and drops the host wrapper entirely
 * (the same discipline `resolveRenderer` uses to keep `RendererRegistry` out of
 * a bundle that registers no backend).
 */
class PluginRuntime implements PluginContext {
  /** Capability values by name. `Map` for insertion order, which `capabilities` reports. */
  readonly #values = new Map<string, unknown>();

  readonly #installed: FourPlugin[] = [];

  /**
   * The non-revocable capability each installed plugin acquired, if any —
   * the thing that pins it, keyed by plugin name.
   *
   * Acquisition is the enforceable proxy for RFC 0002's *"wrote into"*: this
   * seam cannot observe a write into a registry it does not own, but it can
   * observe that the plugin asked for the registry at all. Asking is therefore
   * what pins a plugin. Only the pinning acquisitions are recorded, because
   * they are the only ones any decision reads.
   */
  readonly #pins = new Map<string, string>();

  /**
   * The name of the plugin whose `install`/`uninstall` is running. Empty
   * between plugins — a state no `get` can observe, since the context is
   * sealed then.
   */
  #currentName = "";

  /** Set once installation has finished (or failed): no capability leaves after that. */
  #sealed = false;

  /** True while an `uninstall` runs — only revocable capabilities are reachable then. */
  #uninstalling = false;

  constructor(bindings: readonly PluginCapabilityBinding[] = []) {
    for (const { capability, value } of bindings) {
      // Last binding for a name wins, and the name keeps its first position —
      // `Map.set` semantics, stated so that a host provided twice is not a
      // silent surprise. Hosts are built once, by one caller.
      this.#values.set(capability.name, value);
    }
  }

  get capabilities(): readonly string[] {
    return [...this.#values.keys()];
  }

  get plugins(): readonly FourPlugin[] {
    return this.#installed;
  }

  get<T>(capability: PluginCapability<T>): T | undefined {
    this.#assertReachable(capability);
    if (!this.#values.has(capability.name)) {
      return undefined;
    }
    if (!capability.revocable) {
      // Recorded on the token, so no second map has to agree with it.
      this.#pins.set(this.#currentName, capability.name);
    }
    return this.#values.get(capability.name) as T;
  }

  require<T>(capability: PluginCapability<T>): T {
    const value = this.get(capability);
    if (value === undefined) {
      throw new FourError(
        PLUGIN_ERROR_CODE,
        `Plugin capability ${JSON.stringify(capability.name)} is not provided by this host (§81). Provided: ${this.capabilities.join(", ") || "none"}.`,
        {
          context: {
            capability: capability.name,
            provided: this.capabilities,
            plugin: this.#currentName,
          },
        },
      );
    }
    return value;
  }

  /** The installed plugin called `name`, or `undefined`. */
  find(name: string): FourPlugin | undefined {
    return this.#installed.find((plugin) => plugin.name === name);
  }

  /**
   * The non-revocable capability that pins the installed plugin `name`, or
   * `undefined` when nothing does — i.e. when it can be uninstalled.
   */
  pinnedBy(name: string): string | undefined {
    return this.#pins.get(name);
  }

  /**
   * Runs `plugin.uninstall` with the context temporarily reopened for it, then
   * forgets the plugin. The caller (the host) has already refused every case
   * where this is not allowed.
   */
  runUninstall(plugin: FourPlugin): void {
    this.#begin(plugin);
    this.#sealed = false;
    this.#uninstalling = true;
    try {
      plugin.uninstall?.(this);
    } finally {
      this.#currentName = "";
      this.#sealed = true;
      this.#uninstalling = false;
      this.#installed.splice(this.#installed.indexOf(plugin), 1);
      this.#pins.delete(plugin.name);
    }
  }

  /**
   * Checks everything, resolves the order, then awaits each `install`.
   *
   * Every static refusal happens **before the first `install` runs**, so a
   * refused set leaves nothing half-installed (§85).
   */
  async install(plugins: readonly FourPlugin[]): Promise<void> {
    const ordered = this.#plan(plugins);
    try {
      for (const plugin of ordered) {
        this.#begin(plugin);
        await plugin.install(this);
        this.#installed.push(plugin);
      }
    } finally {
      // Sealed even when an `install` threw: a plugin that failed halfway must
      // not be able to keep fetching capabilities from a context the
      // application has already given up on.
      this.#currentName = "";
      this.#sealed = true;
    }
  }

  /** Validates the set and returns it in install order (§33). */
  #plan(plugins: readonly FourPlugin[]): readonly FourPlugin[] {
    const byName = new Map<string, FourPlugin>();
    for (const plugin of plugins) {
      if (plugin.name === "") {
        throw new FourError(
          PLUGIN_ERROR_CODE,
          "A plugin must carry a non-empty `name` (§81).",
          { context: { version: plugin.version } },
        );
      }
      if (byName.has(plugin.name)) {
        throw new FourError(
          PLUGIN_ERROR_CODE,
          `Plugin ${JSON.stringify(plugin.name)} is already installed (§81).`,
          { context: { plugin: plugin.name, version: plugin.version } },
        );
      }
      // Parsed here so a malformed version is refused before anything runs,
      // even when no dependency range ever reads it.
      parseVersion(
        plugin.version,
        `Plugin ${JSON.stringify(plugin.name)} version`,
      );
      byName.set(plugin.name, plugin);
    }
    for (const plugin of plugins) {
      this.#checkEngineRange(plugin);
      this.#checkDependencies(plugin, byName);
    }
    return this.#order(plugins);
  }

  #checkEngineRange(plugin: FourPlugin): void {
    const range = plugin.engineRange;
    if (range === undefined) {
      return;
    }
    if (!satisfiesPluginRange(PLUGIN_API_VERSION, range)) {
      throw new FourError(
        PLUGIN_ERROR_CODE,
        `Plugin ${JSON.stringify(plugin.name)} accepts plugin API ${JSON.stringify(range)}; this engine provides ${JSON.stringify(PLUGIN_API_VERSION)} (§81, §90).`,
        {
          context: {
            plugin: plugin.name,
            engineRange: range,
            pluginApiVersion: PLUGIN_API_VERSION,
          },
        },
      );
    }
  }

  #checkDependencies(
    plugin: FourPlugin,
    byName: ReadonlyMap<string, FourPlugin>,
  ): void {
    for (const dependency of plugin.dependencies ?? []) {
      const other = byName.get(dependency.name);
      if (other === undefined) {
        throw new FourError(
          PLUGIN_ERROR_CODE,
          `Plugin ${JSON.stringify(plugin.name)} depends on ${JSON.stringify(dependency.name)} ${dependency.range}, which is not in this set (§81).`,
          {
            context: {
              plugin: plugin.name,
              dependency: dependency.name,
              range: dependency.range,
            },
          },
        );
      }
      if (!satisfiesPluginRange(other.version, dependency.range)) {
        throw new FourError(
          PLUGIN_ERROR_CODE,
          `Plugin ${JSON.stringify(plugin.name)} depends on ${JSON.stringify(dependency.name)} ${dependency.range}, and version ${other.version} is present (§81).`,
          {
            context: {
              plugin: plugin.name,
              dependency: dependency.name,
              range: dependency.range,
              version: other.version,
            },
          },
        );
      }
    }
  }

  /**
   * Topological over `dependencies`, ties broken by the order plugins were
   * added — never by `Map` enumeration and never by a name sort (§33).
   *
   * Kahn's algorithm driven by a scan of the *add-order* list: each round emits
   * the first plugin whose dependencies are all satisfied. A round that emits
   * nothing is a cycle, and the message names what is left in it.
   */
  #order(plugins: readonly FourPlugin[]): readonly FourPlugin[] {
    const emitted = new Set<string>();
    const ordered: FourPlugin[] = [];
    const pending = [...plugins];
    while (pending.length > 0) {
      const index = pending.findIndex((plugin) =>
        // Every dependency is known to be in this set: `#checkDependencies`
        // has already refused one that is not.
        (plugin.dependencies ?? []).every((dependency) =>
          emitted.has(dependency.name),
        ),
      );
      if (index === -1) {
        throw new FourError(
          PLUGIN_ERROR_CODE,
          `Plugin dependencies form a cycle (§81, §33): ${pending.map((plugin) => plugin.name).join(" -> ")}.`,
          { context: { cycle: pending.map((plugin) => plugin.name) } },
        );
      }
      const [plugin] = pending.splice(index, 1);
      emitted.add(plugin.name);
      ordered.push(plugin);
    }
    return ordered;
  }

  #assertReachable(capability: PluginCapability<unknown>): void {
    if (this.#sealed) {
      throw new FourError(
        PLUGIN_ERROR_CODE,
        `Plugin capability ${JSON.stringify(capability.name)} was requested outside a plugin's install (§81); a context is live only while \`install\` runs.`,
        { context: { capability: capability.name } },
      );
    }
    if (this.#uninstalling && !capability.revocable) {
      throw new FourError(
        PLUGIN_ERROR_CODE,
        `Plugin capability ${JSON.stringify(capability.name)} is not revocable and cannot be acquired during uninstall (§81).`,
        {
          context: { capability: capability.name, plugin: this.#currentName },
        },
      );
    }
  }

  /** Makes `plugin` the running one. */
  #begin(plugin: FourPlugin): void {
    this.#currentName = plugin.name;
  }
}

/**
 * Installs `plugins` against `bindings` and returns the sealed context (§81).
 *
 * The front door the umbrella package's `Application` uses, and the whole of
 * what an application that never uninstalls a plugin needs. Order is resolved
 * first, then every range and dependency is checked, and only then is the first
 * `install` awaited — so a refused set leaves nothing half-installed.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` for a duplicate name, a
 * malformed version or range, an engine-version mismatch, a missing or
 * out-of-range dependency, or a dependency cycle (§85, §89).
 */
export async function installPlugins(
  plugins: readonly FourPlugin[],
  bindings?: readonly PluginCapabilityBinding[],
): Promise<PluginContext> {
  const runtime = new PluginRuntime(bindings);
  await runtime.install(plugins);
  return runtime;
}

/**
 * The standalone §81 host: capabilities in, plugins in, one `install` call.
 *
 * ```ts
 * const host = new PluginHost([bindCapability(SOLVER_REGISTRY, registry)]);
 * host.add(rapierPlugin).add(ragdollPlugin);
 * await host.install();
 * ```
 *
 * Use it when the capabilities a plugin needs are values the application owns and
 * `Application` cannot reach — a solver registry, a serializer registry, a
 * render graph. `ApplicationOptions.plugins` (§45, as amended by RFC 0002 Q1)
 * is the convenience for the capabilities the application *does* own.
 */
export class PluginHost {
  readonly #bindings: PluginCapabilityBinding[];

  readonly #added: FourPlugin[] = [];

  #runtime: PluginRuntime | undefined;

  constructor(capabilities: readonly PluginCapabilityBinding[] = []) {
    this.#bindings = [...capabilities];
  }

  /**
   * Adds a capability this host provides. Returns `this` so calls chain.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` after {@link PluginHost.install}.
   */
  provide<T>(capability: PluginCapability<T>, value: T): this {
    this.#assertNotInstalled("provide");
    this.#bindings.push(bindCapability(capability, value));
    return this;
  }

  /**
   * Adds a plugin **value** — never a URL, never a module specifier, never a
   * name resolved out of a document (§96). Returns `this` so calls chain.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` after {@link PluginHost.install}.
   */
  add(plugin: FourPlugin): this {
    this.#assertNotInstalled("add");
    this.#added.push(plugin);
    return this;
  }

  /** The plugins added but not yet installed, in `add` order. */
  get added(): readonly FourPlugin[] {
    return this.#added;
  }

  /** Whether {@link PluginHost.install} has been called. */
  get installed(): boolean {
    return this.#runtime !== undefined;
  }

  /**
   * The live context, or the sealed one after installation.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` before {@link PluginHost.install}
   * — there is no context until there is an installation, and inventing an
   * empty one would let a caller read `plugins` as `[]` and believe it.
   */
  get context(): PluginContext {
    if (this.#runtime === undefined) {
      throw new FourError(
        PLUGIN_ERROR_CODE,
        "PluginHost has no context until install() has been called (§81).",
        { context: { method: "context" } },
      );
    }
    return this.#runtime;
  }

  /**
   * Resolves order, checks ranges, then awaits each `install` in order (§81).
   *
   * Called **once**. Re-installation and hot reload are deferred by RFC 0002,
   * so a second call is refused rather than quietly installing nothing.
   */
  async install(): Promise<void> {
    this.#assertNotInstalled("install");
    const runtime = new PluginRuntime(this.#bindings);
    this.#runtime = runtime;
    await runtime.install(this.#added);
  }

  /**
   * Removes the installed plugin called `name`, running its `uninstall`.
   *
   * **Uninstall is not symmetric, and this refuses rather than pretending.**
   * The registries a capability hands over have different removal stories:
   * `SystemRegistry.register` returns an idempotent unregister, while
   * `registerRenderer`/`registerSolver` offer none and
   * `ComponentSerializerRegistry` deliberately has no removal at all — a silent
   * overwrite there would make the shape of a document depend on evaluation
   * order. So a capability declares its revocability
   * ({@link DefineCapabilityOptions.revocable}, default `false`), and a plugin
   * that acquired a non-revocable one **cannot be uninstalled**: this raises
   * naming the capability that pins it, rather than running `uninstall` and
   * leaving a half-removed registration behind. It is the same contrast rule as
   * `removeCollider` returning `false` while `addCollider` throws.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` when nothing is installed
   * under `name`, when another installed plugin depends on it, or when a
   * non-revocable capability pins it (§85).
   */
  uninstall(name: string): void {
    const runtime = this.#runtime;
    const plugin = runtime?.find(name);
    if (runtime === undefined || plugin === undefined) {
      throw new FourError(
        PLUGIN_ERROR_CODE,
        `No plugin named ${JSON.stringify(name)} is installed (§81).`,
        { context: { plugin: name } },
      );
    }
    const dependent = runtime.plugins.find((other) =>
      (other.dependencies ?? []).some((dependency) => dependency.name === name),
    );
    if (dependent !== undefined) {
      throw new FourError(
        PLUGIN_ERROR_CODE,
        `Plugin ${JSON.stringify(name)} cannot be uninstalled while ${JSON.stringify(dependent.name)} depends on it (§81). Uninstall the dependent first — uninstall order is the reverse of install order.`,
        { context: { plugin: name, dependent: dependent.name } },
      );
    }
    const pinning = runtime.pinnedBy(name);
    if (pinning !== undefined) {
      throw new FourError(
        PLUGIN_ERROR_CODE,
        `Plugin ${JSON.stringify(name)} acquired capability ${JSON.stringify(pinning)}, which is not revocable, so it cannot be uninstalled (§81, RFC 0002 §4). Running its uninstall would leave a registration behind that nothing can remove.`,
        {
          context: { plugin: name, capability: pinning },
        },
      );
    }
    runtime.runUninstall(plugin);
  }

  #assertNotInstalled(method: string): void {
    if (this.#runtime !== undefined) {
      throw new FourError(
        PLUGIN_ERROR_CODE,
        `PluginHost.${method}() is not available after install() (§81): registration is legal only during installation, and re-installation is deferred by RFC 0002.`,
        { context: { method } },
      );
    }
  }
}
