/**
 * The §81 capability tokens (RFC 0002, accepted 2026-08-21; gap `A-3`) —
 * re-exported from the packages that own them.
 *
 * `@four/core` owns the plugin *machinery* — {@link @four/core!FourPlugin},
 * {@link @four/core!PluginHost}, {@link @four/core!defineCapability} — and
 * deliberately names none of the registries a plugin actually wants, because
 * every one of them lives downstream of `core` in the frozen §3.1 matrix.
 * RFC 0002 §2 spells out where they are named instead: **each token is
 * exported from the package that owns its registry**, and since 2026-08-29
 * that is exactly where they live —
 *
 * | Token | Owner | Hands over |
 * |---|---|---|
 * | `SIMULATION_SYSTEMS` | `@four/motion` | the §39 `SystemRegistry` |
 * | `RENDERER_REGISTRY` | `@four/render` | the §62 `RendererRegistry` |
 * | `RENDER_GRAPH` | `@four/render` | the application's §63 `RenderGraph` |
 * | `COMPUTE_WORKLOADS` | `@four/render` | a named `ComputePassDescriptor` factory table |
 * | `SOLVER_REGISTRY` | `@four/physics` | the §37 `SolverRegistry` |
 * | `COMPONENT_SERIALIZERS` | `@four/serialization` | the §79 registry |
 * | `SCENE_MIGRATIONS` | `@four/serialization` | the §80 upgrade chain |
 * | `ASSET_LOADERS` | `@four/assets` | a named `AssetLoader` table |
 * | `SHADER_OPERATORS` | `@four/materials` | a named shader-operator factory table |
 * | `UI_CONTROLS` | `@four/ui` | a named widget-constructor table |
 * | `EDITOR_TOOLS` | `four` (host-side) | a named editor-tool factory table |
 *
 * Each owner's `capabilities.ts` carries the token's full documentation:
 * what §81 point it answers, who provides it, and why it is (or, once out
 * of eleven, is not) revocable.
 *
 * ## Why this module still exists
 *
 * The tokens first shipped *here*, together, when the four owning packages
 * were mid-flight and the umbrella was the one place that could see all four
 * registry types at once. That spelling difference was recorded as reversible
 * — *"moving a token to its owning package later leaves a re-export behind,
 * and a token's identity is its `name` string, not its module"* — and this
 * module is that re-export: the **very same objects**, so
 * `import { SIMULATION_SYSTEMS } from "four"` and
 * `import { SIMULATION_SYSTEMS } from "@four/motion"` compare `===`, every
 * existing import keeps working, and `plugins.test.ts` pins the identity.
 * The move costs no §3.1 edge in either direction: each owner already
 * depends on `core` (for `defineCapability`) and owns its registry type, and
 * `four` already depends on all four owners.
 *
 * ## All eleven §81 points now have a token
 *
 * §81 lists eleven extension points. Six shipped with the 2026-08-29 move;
 * the remaining five — asset formats, materials and shader nodes, UI
 * controls, editor tools, and compute workloads — arrive here with a real
 * (minimal) registry each. A plugin that asks for one an `Application`
 * does not hold still fails at install, loudly, naming the capability:
 * `Application` continues to provide only the two registries it actually
 * owns (`SIMULATION_SYSTEMS`, and `RENDERER_REGISTRY` when scoped). A
 * standalone host provides the rest.
 */

export { ASSET_LOADERS } from "@four/assets";
export { SHADER_OPERATORS } from "@four/materials";
export { SIMULATION_SYSTEMS } from "@four/motion";
export { SOLVER_REGISTRY } from "@four/physics";
export {
  COMPUTE_WORKLOADS,
  RENDERER_REGISTRY,
  RENDER_GRAPH,
} from "@four/render";
export { COMPONENT_SERIALIZERS, SCENE_MIGRATIONS } from "@four/serialization";
export { UI_CONTROLS } from "@four/ui";
export { EDITOR_TOOLS } from "./capabilities.js";
export type { EditorToolFactory } from "./editor-tools.js";
export { EditorToolRegistry } from "./editor-tools.js";
