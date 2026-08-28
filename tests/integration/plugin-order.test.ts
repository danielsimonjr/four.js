/**
 * §33 — plugin install order is a **specified** property, not an emergent one
 * (A-3 / RFC 0002's determinism section, 2026-08-28).
 *
 * The non-obvious implication of a plugin host, and the one worth pinning:
 * **install-order nondeterminism becomes simulation-order nondeterminism.** A
 * plugin registers a `SimulationSystem`, and `SystemRegistry` orders by
 * `(priority, registration order)` — so two plugins registering systems at
 * equal priority produce different fixed-step transcripts depending on which
 * installed first.
 *
 * The rule therefore has to be stated and tested rather than left to whatever
 * the implementation happens to do:
 *
 * 1. Order is **topological over declared dependencies**, ties broken by the
 *    order the plugins were listed in — never by `Map` enumeration, never by a
 *    name sort.
 * 2. Two orders of the same set therefore produce transcripts that differ
 *    **only where the declared dependencies permit it**: with no dependency the
 *    transcripts differ, with a dependency they are identical.
 *
 * The transcript is a real one: each plugin registers a system that appends its
 * name on every fixed step of a real `Application`.
 */

import type { FourPlugin } from "@four/core";
import { PRIORITY_PHYSICS_SOLVE, type SimulationSystem } from "@four/motion";
import { SIMULATION_SYSTEMS } from "four";
import { Application } from "four/application";
import { describe, expect, it } from "vitest";

/**
 * A plugin whose system appends `name` to `log` on every fixed step, at one
 * shared priority — so the *only* thing deciding the order within a step is
 * registration order, which is install order.
 */
function tickPlugin(
  name: string,
  log: string[],
  dependencies?: FourPlugin["dependencies"],
): FourPlugin {
  const system: SimulationSystem = {
    priority: PRIORITY_PHYSICS_SOLVE,
    initialize() {
      // Nothing to set up.
    },
    fixedUpdate() {
      log.push(name);
    },
    dispose() {
      // Nothing to release.
    },
  };
  return {
    name,
    version: "1.0.0",
    dependencies,
    install(context) {
      context.require(SIMULATION_SYSTEMS).register(system);
    },
  };
}

/** Runs one fixed step of an application built from `plugins`, returning the transcript. */
async function transcript(build: (log: string[]) => FourPlugin[]): Promise<{
  installed: string[];
  steps: string[];
}> {
  const steps: string[] = [];
  const app = new Application({ plugins: build(steps) });
  await app.initialize();
  const installed =
    app.pluginContext?.plugins.map((plugin) => plugin.name) ?? [];
  app.start();
  app.step(1 / 60);
  app.dispose();
  return { installed, steps };
}

describe("install order decides fixed-step order (§33)", () => {
  it("follows the listed order when nothing declares a dependency", async () => {
    const forward = await transcript((log) => [
      tickPlugin("a", log),
      tickPlugin("b", log),
    ]);
    const reverse = await transcript((log) => [
      tickPlugin("b", log),
      tickPlugin("a", log),
    ]);
    expect(forward.installed).toEqual(["a", "b"]);
    expect(reverse.installed).toEqual(["b", "a"]);
    // Different, and legitimately so: nothing in the set said these two have an
    // order. That is exactly why a plugin that *needs* one must declare it.
    expect(forward.steps).toEqual(["a", "b"]);
    expect(reverse.steps).toEqual(["b", "a"]);
  });

  it("is identical under both listings once a dependency is declared", async () => {
    const forward = await transcript((log) => [
      tickPlugin("a", log),
      tickPlugin("b", log, [{ name: "a", range: "^1.0.0" }]),
    ]);
    const reverse = await transcript((log) => [
      tickPlugin("b", log, [{ name: "a", range: "^1.0.0" }]),
      tickPlugin("a", log),
    ]);
    expect(forward.installed).toEqual(["a", "b"]);
    expect(reverse.installed).toEqual(["a", "b"]);
    expect(forward.steps).toEqual(reverse.steps);
    expect(forward.steps).toEqual(["a", "b"]);
  });

  it("never falls back on a name sort to break a tie", async () => {
    // Listed z, m, a: a name sort would produce a, m, z, and `Map` enumeration
    // of a keyed collection would produce insertion order by accident rather
    // than by rule. The transcript is the listing.
    const run = await transcript((log) => [
      tickPlugin("z", log),
      tickPlugin("m", log),
      tickPlugin("a", log),
    ]);
    expect(run.installed).toEqual(["z", "m", "a"]);
    expect(run.steps).toEqual(["z", "m", "a"]);
  });

  it("keeps a dependent behind its dependency without disturbing the rest", async () => {
    const run = await transcript((log) => [
      tickPlugin("late", log, [{ name: "early", range: "*" }]),
      tickPlugin("middle", log),
      tickPlugin("early", log),
    ]);
    // `late` waits for `early`; `middle` and `early` keep their listed order
    // relative to each other, so the tie-break is the listing and nothing else.
    expect(run.installed).toEqual(["middle", "early", "late"]);
    expect(run.steps).toEqual(["middle", "early", "late"]);
  });
});
