/**
 * The §81 capability tokens (RFC 0002, accepted 2026-08-21; gap `A-3`).
 *
 * `@four/core` owns the plugin *machinery* — {@link @four/core!FourPlugin},
 * {@link @four/core!PluginHost}, {@link @four/core!defineCapability} — and
 * deliberately names none of the registries a plugin actually wants, because
 * every one of them lives downstream of `core` in the frozen §3.1 matrix. This
 * module is where they are named: the umbrella package is the one place that
 * may see `motion`, `render`, `physics`, and `serialization` at once, which is
 * the same argument `scene-serializers.ts` makes for living here.
 *
 * **Every import below is type-only, and that is load-bearing.** A token is
 * `{ name, revocable }` — a string and a boolean. Declaring
 * `RENDERER_REGISTRY: PluginCapability<RendererRegistry>` costs the emitted
 * JavaScript nothing but that object, so a bundle can carry the token an
 * application passes around without carrying `RendererRegistry`, the §62
 * preference walk, or any backend. Each definition is `@__PURE__`-annotated so
 * a token nothing references leaves the bundle entirely.
 *
 * ## RFC 0002 spelling difference, recorded rather than hidden
 *
 * The RFC exports each token from the package that owns its registry (one line
 * each in `@four/render`, `@four/physics`, `@four/serialization`,
 * `@four/motion`). They ship here instead, together, because `four` already
 * depends on all four — so this adds **no new §3.1 edge either way** — and the
 * choice is reversible without breaking anyone: moving a token to its owning
 * package later leaves a re-export behind, and a token's identity is its
 * `name` string, not its module.
 *
 * ## What is absent, and why absence is the honest signal
 *
 * §81 lists eleven extension points. Six have a capability here; five —
 * asset formats, materials and shader nodes, UI controls, editor tools, and
 * compute workloads — have **no token at all**, because there is no registry to
 * hand over. A plugin that asks for one it needs therefore fails at install,
 * loudly, naming the capability, instead of registering into nothing. Adding a
 * token later is additive and needs no change to `@four/core`.
 */

import { defineCapability } from "@four/core";
import type { SystemRegistry } from "@four/motion";
import type { SolverRegistry } from "@four/physics";
import type { RenderGraph, RendererRegistry } from "@four/render";
import type {
  ComponentSerializerRegistry,
  SceneMigrationRegistry,
} from "@four/serialization";

/**
 * §81's *"animation systems"* and, with the §84 statistics record, its
 * *"diagnostics"* point: the §39 ordered set of simulation systems.
 *
 * **The one revocable capability in the MVP**, and the only one whose registry
 * really supports removal: `SystemRegistry.register` returns an idempotent
 * unregister and `unregister(system)` exists, so a plugin's own `uninstall` can
 * put the registry back exactly as it found it. Every other token below keeps
 * RFC 0002's conservative default (owner decision, Q3), which means a plugin
 * that touches one of them cannot be uninstalled at all.
 *
 * ```ts
 * const plugin: FourPlugin = {
 *   name: "@vendor/wind",
 *   version: "1.0.0",
 *   install(context) {
 *     context.require(SIMULATION_SYSTEMS).register(new WindSystem());
 *   },
 * };
 * const app = new Application({ plugins: [plugin] });
 * await app.initialize();
 * ```
 *
 * Provided by `Application` for every application that configures plugins: the
 * registry is `app.systems`, which the application owns outright.
 */
export const SIMULATION_SYSTEMS =
  /* @__PURE__ */ defineCapability<SystemRegistry>("four:simulation-systems", {
    revocable: true,
  });

/**
 * §81's *"renderer backends"*: the §62 registry a backend package registers
 * into (`registerWebglRenderer`, `registerWebgpuRenderer`).
 *
 * Not revocable — `RendererRegistry.register` returns the registry and the §62
 * front door offers no unregister on the shared instance, so a plugin that
 * registered a backend has no way to take it back.
 *
 * `Application` provides this **only when the application passed
 * `rendererRegistry`** (§45's scoped-registry option). With no registry to
 * scope, there is no `RendererRegistry` value the application holds — reaching
 * for the process-wide one would make `four` name the class in every bundle,
 * which is precisely the cost `resolveRenderer` exists to avoid. Applications
 * whose plugins register backends pass their own registry, or install through a
 * standalone {@link @four/core!PluginHost}.
 */
export const RENDERER_REGISTRY =
  /* @__PURE__ */ defineCapability<RendererRegistry>("four:renderer-registry");

/**
 * §81's *"physics solvers"*: the §37 registry a solver adapter registers into.
 *
 * Not revocable, for `RENDERER_REGISTRY`'s reason. Provided only by a
 * standalone {@link @four/core!PluginHost} — `Application` never constructs or
 * holds a `SolverRegistry` (§45 takes a constructed `PhysicsWorld`, and naming
 * the registry would put `@four/physics` in every bundle).
 */
export const SOLVER_REGISTRY = /* @__PURE__ */ defineCapability<SolverRegistry>(
  "four:solver-registry",
);

/**
 * §81's *"serialization types"*, first half: the §79 component-serializer
 * registry. This is the extension point `serializer.ts` was already written
 * against — *"components serialize under registered type names; plugins
 * register theirs (§81)"* — and the one that made §79 a promise the repository
 * could not keep until now.
 *
 * **Emphatically not revocable.** `ComponentSerializerRegistry.register` throws
 * on a duplicate deliberately, because a silent overwrite would make the shape
 * of a document depend on module evaluation order; adding removal would re-open
 * exactly that hazard, in the form of a document written by one registry state
 * and read by another.
 */
export const COMPONENT_SERIALIZERS =
  /* @__PURE__ */ defineCapability<ComponentSerializerRegistry>(
    "four:component-serializers",
  );

/**
 * §81's *"serialization types"*, second half: the §80 upgrade chain. Not
 * revocable, for {@link COMPONENT_SERIALIZERS}' reason — §80 calls the upgrade
 * path deterministic, and a removable step is not.
 */
export const SCENE_MIGRATIONS =
  /* @__PURE__ */ defineCapability<SceneMigrationRegistry>(
    "four:scene-migrations",
  );

/**
 * §81's *"render passes"* — **differently shaped from the other five, and the
 * shape is the point** (RFC 0002 Q4; owner decision, register row 6: *"include
 * `RENDER_GRAPH` as a differently-shaped capability with that stated"*).
 *
 * There is no registry of pass *kinds*. §63's `RenderGraph` is an object the
 * application builds per frame-configuration, so what this token hands over is
 * **the application's own graph**, not a place to register a new kind of pass.
 * A post-processing plugin can append its passes to it, which is the useful
 * thing available today; a plugin that wants to teach the engine a new pass
 * kind cannot, and that is RFC 0001's closed-union position rather than an
 * oversight here.
 *
 * Not revocable. `RenderGraph.removePass` refuses while a later pass names the
 * removed one's output, so removal is conditional on the state of a graph the
 * host does not control — which is not a promise a lifecycle can keep.
 *
 * Provided only by a standalone {@link @four/core!PluginHost}: §45 has no
 * render-graph option, and inventing one would be the API invention RFC 0002
 * Q1 was careful to avoid.
 */
export const RENDER_GRAPH =
  /* @__PURE__ */ defineCapability<RenderGraph>("four:render-graph");
