/**
 * §81 plugins through §45's composition root (RFC 0002; gap `A-3`).
 *
 * `@four/core`'s `plugin.test.ts` owns the machinery — order, ranges, refusals,
 * the seal. This file owns the two things only the umbrella can state: which
 * capabilities an `Application` provides, and that installation happens inside
 * `initialize()` rather than in the constructor.
 */

import {
  PLUGIN_API_VERSION,
  isFourError,
  type FourPlugin,
  type PluginCapability,
} from "@four/core";
import { PRIORITY_PHYSICS_SOLVE, type SimulationSystem } from "@four/motion";
import { RendererRegistry } from "@four/render";
import { describe, expect, it, vi } from "vitest";

import { Application } from "../src/application.js";
import {
  COMPONENT_SERIALIZERS,
  RENDERER_REGISTRY,
  RENDER_GRAPH,
  SCENE_MIGRATIONS,
  SIMULATION_SYSTEMS,
  SOLVER_REGISTRY,
} from "../src/plugins.js";

/** A §39 system that counts the fixed steps it sees. */
function countingSystem(counts: { steps: number }): SimulationSystem {
  return {
    priority: PRIORITY_PHYSICS_SOLVE,
    initialize() {
      // Nothing to set up.
    },
    fixedUpdate() {
      counts.steps += 1;
    },
    dispose() {
      // Nothing to tear down.
    },
  };
}

describe("ApplicationOptions.plugins", () => {
  it("is null-shaped when absent or empty: no context, ever", async () => {
    for (const options of [{}, { plugins: [] }]) {
      const app = new Application(options);
      expect(app.pluginContext).toBeNull();
      await app.initialize();
      expect(app.pluginContext).toBeNull();
      app.dispose();
    }
  });

  it("installs during initialize(), not in the constructor (§81, §45)", async () => {
    const install = vi.fn();
    const app = new Application({
      plugins: [{ name: "@vendor/a", version: "1.0.0", install }],
    });
    expect(install).not.toHaveBeenCalled();
    expect(app.pluginContext).toBeNull();
    await app.initialize();
    expect(install).toHaveBeenCalledTimes(1);
    expect(app.pluginContext?.plugins.map((plugin) => plugin.name)).toEqual([
      "@vendor/a",
    ]);
    app.dispose();
  });

  it("awaits an asynchronous install before the application is initialized", async () => {
    let resolved = false;
    const app = new Application({
      plugins: [
        {
          name: "@vendor/slow",
          version: "1.0.0",
          async install() {
            await Promise.resolve();
            resolved = true;
          },
        },
      ],
    });
    const initializing = app.initialize();
    expect(resolved).toBe(false);
    await initializing;
    expect(resolved).toBe(true);
    expect(app.initialized).toBe(true);
    app.dispose();
  });

  it("hands a plugin the application's own §39 registry", async () => {
    const counts = { steps: 0 };
    const app = new Application({
      plugins: [
        {
          name: "@vendor/wind",
          version: "1.0.0",
          engineRange: `^${PLUGIN_API_VERSION}`,
          install(context) {
            context
              .require(SIMULATION_SYSTEMS)
              .register(countingSystem(counts));
          },
        },
      ],
    });
    await app.initialize();
    expect(app.systems.size).toBe(1);
    app.start();
    app.step(1 / 60);
    expect(counts.steps).toBe(1);
    expect(app.pluginContext?.capabilities).toEqual([
      "four:simulation-systems",
    ]);
    app.dispose();
  });

  it("provides RENDERER_REGISTRY only when §45's rendererRegistry option supplied one", async () => {
    const registry = new RendererRegistry();
    const scoped = new Application({
      renderer: false,
      rendererRegistry: registry,
      plugins: [
        {
          name: "@vendor/backend",
          version: "1.0.0",
          install(context) {
            expect(context.require(RENDERER_REGISTRY)).toBe(registry);
          },
        },
      ],
    });
    await scoped.initialize();
    expect(scoped.pluginContext?.capabilities).toEqual([
      "four:simulation-systems",
      "four:renderer-registry",
    ]);
    scoped.dispose();

    const unscoped = new Application({
      plugins: [
        {
          name: "@vendor/backend",
          version: "1.0.0",
          install(context) {
            context.require(RENDERER_REGISTRY);
          },
        },
      ],
    });
    await expect(unscoped.initialize()).rejects.toThrow(
      /"four:renderer-registry" is not provided/,
    );
    expect(unscoped.initialized).toBe(false);
    unscoped.dispose();
  });

  it("refuses a capability an Application never holds, by name (§85)", async () => {
    const unheld: readonly PluginCapability<unknown>[] = [
      SOLVER_REGISTRY,
      COMPONENT_SERIALIZERS,
      SCENE_MIGRATIONS,
      RENDER_GRAPH,
    ];
    for (const capability of unheld) {
      const app = new Application({
        plugins: [
          {
            name: "@vendor/needs",
            version: "1.0.0",
            install(context) {
              context.require(capability);
            },
          },
        ],
      });
      let thrown: unknown;
      await app.initialize().catch((error: unknown) => {
        thrown = error;
      });
      expect(isFourError(thrown) && thrown.code).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect((thrown as Error).message).toContain(capability.name);
      app.dispose();
    }
  });

  it("leaves the application uninitialized when a plugin is refused", async () => {
    const app = new Application({
      plugins: [
        {
          name: "@vendor/future",
          version: "1.0.0",
          engineRange: ">=9.0.0",
          install() {},
        },
      ],
    });
    await expect(app.initialize()).rejects.toThrow(/plugin API/);
    expect(app.initialized).toBe(false);
    expect(app.pluginContext).toBeNull();
    expect(() => app.start()).toThrow(/requires a completed initialize/);
    app.dispose();
  });

  it("copies the list it was given, so later mutation cannot change what installs", async () => {
    const log: string[] = [];
    const first: FourPlugin = {
      name: "a",
      version: "1.0.0",
      install() {
        log.push("a");
      },
    };
    const plugins: FourPlugin[] = [first];
    const app = new Application({ plugins });
    plugins.push({
      name: "b",
      version: "1.0.0",
      install() {
        log.push("b");
      },
    });
    await app.initialize();
    expect(log).toEqual(["a"]);
    app.dispose();
  });

  it("installs in dependency order, ties broken by the order listed (§33)", async () => {
    const log: string[] = [];
    const make = (name: string, dependencies?: FourPlugin["dependencies"]) => ({
      name,
      version: "1.0.0",
      dependencies,
      install() {
        log.push(name);
      },
    });
    const app = new Application({
      plugins: [
        make("late", [{ name: "early", range: "^1.0.0" }]),
        make("early"),
      ],
    });
    await app.initialize();
    expect(log).toEqual(["early", "late"]);
    expect(app.pluginContext?.plugins.map((plugin) => plugin.name)).toEqual([
      "early",
      "late",
    ]);
    app.dispose();
  });

  it("seals the context it publishes", async () => {
    const app = new Application({
      plugins: [{ name: "a", version: "1.0.0", install() {} }],
    });
    await app.initialize();
    expect(() => app.pluginContext?.require(SIMULATION_SYSTEMS)).toThrow(
      /outside a plugin's install/,
    );
    app.dispose();
  });
});

describe("capability tokens", () => {
  it("re-exports the owning packages' very objects — identity, not copies (RFC 0002 §2)", async () => {
    // The 2026-08-29 migration moved each token to the package that owns its
    // registry, leaving this module as a re-export of the same objects. A
    // token's identity is its `name` string, but object identity is what
    // makes the move invisible: a host provides against one token and a
    // plugin requires with the other, and both spellings must be the same
    // key. `toBe`, deliberately — `toEqual` would pass for a forgotten copy.
    const motion = await import("@four/motion");
    const physics = await import("@four/physics");
    const render = await import("@four/render");
    const serialization = await import("@four/serialization");
    expect(SIMULATION_SYSTEMS).toBe(motion.SIMULATION_SYSTEMS);
    expect(SOLVER_REGISTRY).toBe(physics.SOLVER_REGISTRY);
    expect(RENDERER_REGISTRY).toBe(render.RENDERER_REGISTRY);
    expect(RENDER_GRAPH).toBe(render.RENDER_GRAPH);
    expect(COMPONENT_SERIALIZERS).toBe(serialization.COMPONENT_SERIALIZERS);
    expect(SCENE_MIGRATIONS).toBe(serialization.SCENE_MIGRATIONS);
  });

  it("names every token once, with RFC 0002's revocability dispositions", () => {
    expect([
      SIMULATION_SYSTEMS,
      RENDERER_REGISTRY,
      SOLVER_REGISTRY,
      COMPONENT_SERIALIZERS,
      SCENE_MIGRATIONS,
      RENDER_GRAPH,
    ]).toEqual([
      { name: "four:simulation-systems", revocable: true },
      { name: "four:renderer-registry", revocable: false },
      { name: "four:solver-registry", revocable: false },
      { name: "four:component-serializers", revocable: false },
      { name: "four:scene-migrations", revocable: false },
      { name: "four:render-graph", revocable: false },
    ]);
  });
});
