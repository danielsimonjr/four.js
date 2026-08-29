/**
 * A-3 / RFC 0002 — §81's capability grants, against the real registries
 * (2026-08-28).
 *
 * `@four/core`'s unit tests prove the plugin machinery against toy
 * capabilities; `packages/four` proves which capabilities an `Application`
 * provides. Neither can prove the thing §81 actually promises, because it is a
 * claim about four packages at once: **a plugin can register a renderer
 * backend, a physics solver, a component serializer, and a scene migration
 * through the capability tokens, and what lands is indistinguishable from the
 * five bootstrap calls an application would otherwise write by hand.**
 *
 * That is the whole of gap `A-3`'s value proposition — §79's shipped prose
 * (*"plugins register theirs (§81)"*) becomes true here, and a third-party
 * backend acquires a way to ship as one installable unit with a compatibility
 * declaration rather than as five call sites in a bootstrap.
 *
 * Every registry below is a **scoped instance**, never the process-wide one:
 * a suite that leaned on shared registration state would pass or fail by file
 * order (`backend-selection.test.ts`'s rule, and §33's).
 */

import {
  PLUGIN_API_VERSION,
  PluginHost,
  bindCapability,
  isFourError,
  type Component,
  type ComponentHost,
  type FourPlugin,
} from "@four/core";
import { PhysicsWorld, SolverRegistry } from "@four/physics";
import { registerRapierSolver } from "@four/physics-rapier";
import { RendererRegistry, resolveRenderer } from "@four/render";
import { registerWebglRenderer } from "@four/render-webgl";
import {
  ComponentSerializerRegistry,
  SceneMigrationRegistry,
} from "@four/serialization";
import {
  COMPONENT_SERIALIZERS,
  RENDERER_REGISTRY,
  SCENE_MIGRATIONS,
  SOLVER_REGISTRY,
} from "four";
import { afterEach, describe, expect, it } from "vitest";

import { RecordingCanvas, createRecordingGl } from "./helpers/recording-gl.js";

const GLOBAL = globalThis as Record<string, unknown>;
const WEBGL2_KEY = "WebGL2RenderingContext";

/**
 * The §62 environment probe reads this global and never touches the canvas
 * (`backend-selection.test.ts` explains why), so a test that wants the backend
 * to resolve has to arrange the environment.
 */
function withWebgl2(): void {
  GLOBAL[WEBGL2_KEY] = function WebGL2RenderingContext(): void {};
}

afterEach(() => {
  delete GLOBAL[WEBGL2_KEY];
});

/** A §6a component a plugin teaches §79 about — the point `serializer.ts:12` cites. */
class Telemetry implements Component {
  static readonly typeName = "vendor:telemetry";

  readonly host: ComponentHost | null = null;

  samples = 0;
}

/**
 * One plugin that uses four capabilities — the "ships as one installable unit"
 * claim in a single value, with the compatibility declaration §81 requires.
 */
function vendorSuite(): FourPlugin {
  return {
    name: "@vendor/suite",
    version: "2.1.0",
    engineRange: `^${PLUGIN_API_VERSION}`,
    install(context) {
      registerWebglRenderer(context.require(RENDERER_REGISTRY));
      registerRapierSolver(context.require(SOLVER_REGISTRY));
      context.require(COMPONENT_SERIALIZERS).register(Telemetry, {
        serialize: (component: Telemetry) => ({ samples: component.samples }),
        deserialize: (data) => {
          const component = new Telemetry();
          component.samples = (data as { samples: number }).samples;
          return component;
        },
      });
      context
        .require(SCENE_MIGRATIONS)
        .registerMigration(7, (document) => document);
    },
  };
}

describe("a plugin registering through §81's capability grants", () => {
  it("lands a renderer, a solver, a serializer, and a migration", async () => {
    const renderers = new RendererRegistry();
    const solvers = new SolverRegistry();
    const serializers = new ComponentSerializerRegistry();
    const migrations = new SceneMigrationRegistry();

    const host = new PluginHost([
      bindCapability(RENDERER_REGISTRY, renderers),
      bindCapability(SOLVER_REGISTRY, solvers),
      bindCapability(COMPONENT_SERIALIZERS, serializers),
      bindCapability(SCENE_MIGRATIONS, migrations),
    ]);
    host.add(vendorSuite());
    await host.install();

    expect(host.context.plugins.map((plugin) => plugin.name)).toEqual([
      "@vendor/suite",
    ]);

    // 1. §62 — the backend resolves and initializes against a real GL tape.
    expect(renderers.backends).toEqual(["webgl2"]);
    withWebgl2();
    const canvas = new RecordingCanvas(createRecordingGl().gl);
    const renderer = await resolveRenderer("auto", { canvas }, renderers);
    expect(renderer.capabilities.backend).toBe("webgl2");
    renderer.dispose();

    // 2. §37 — the solver resolves and a real world steps on it.
    expect(solvers.solvers).toEqual(["rapier"]);
    const world = new PhysicsWorld({
      dimension: "2d",
      solver: "auto",
      solverRegistry: solvers,
    });
    await world.initialize();
    world.step(1 / 60);
    expect(world.initialized).toBe(true);
    world.dispose();

    // 3. §79 — the component type is registered under the name a document uses.
    expect(serializers.has("vendor:telemetry")).toBe(true);
    expect([...serializers.typeNames]).toEqual(["vendor:telemetry"]);

    // 4. §80 — the upgrade step is in the chain.
    expect(migrations.has(7)).toBe(true);
    expect(migrations.versions).toEqual([7]);
  });

  it("cannot be uninstalled, and says which capability pins it (RFC 0002 §4)", async () => {
    const serializers = new ComponentSerializerRegistry();
    const host = new PluginHost([
      bindCapability(COMPONENT_SERIALIZERS, serializers),
    ]);
    host.add({
      name: "@vendor/types",
      version: "1.0.0",
      install(context) {
        context.require(COMPONENT_SERIALIZERS).register(Telemetry, {
          serialize: () => ({}),
          deserialize: () => new Telemetry(),
        });
      },
      uninstall() {
        throw new Error("this must never run");
      },
    });
    await host.install();

    let thrown: unknown;
    try {
      host.uninstall("@vendor/types");
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect((thrown as Error).message).toContain("four:component-serializers");
    // Still installed, and the serializer still registered: the refusal happens
    // *instead of* a half-removal. `ComponentSerializerRegistry` has no removal
    // at all — deliberately, so a document's shape cannot depend on evaluation
    // order — which is exactly why this capability is not revocable.
    expect(host.context.plugins).toHaveLength(1);
    expect(serializers.has("vendor:telemetry")).toBe(true);
  });

  it("refuses a plugin whose engine range this build does not satisfy", async () => {
    const host = new PluginHost();
    host.add({
      name: "@vendor/next",
      version: "1.0.0",
      engineRange: "^1.0.0",
      install() {
        throw new Error("this must never run");
      },
    });
    await expect(host.install()).rejects.toThrow(/plugin API "\^1\.0\.0"/);
  });

  it("refuses a duplicate plugin name before anything installs (§85)", async () => {
    const installed: string[] = [];
    const twice = (): FourPlugin => ({
      name: "@vendor/same",
      version: "1.0.0",
      install() {
        installed.push("ran");
      },
    });
    const host = new PluginHost();
    host.add(twice()).add(twice());
    await expect(host.install()).rejects.toThrow(/already installed/);
    expect(installed).toEqual([]);
  });
});
