/**
 * §81's plugin system (RFC 0002; gap `A-3`).
 *
 * Four things are worth testing here and they are tested in this order: the
 * restricted range grammar, the context's capability lookup and its seal, the
 * install plan (order, and every refusal that happens *before* anything runs),
 * and the asymmetric uninstall.
 */

import { describe, expect, it, vi } from "vitest";

import {
  PLUGIN_API_VERSION,
  PluginHost,
  bindCapability,
  defineCapability,
  installPlugins,
  isFourError,
  satisfiesPluginRange,
  type FourPlugin,
  type PluginContext,
} from "../src/index.js";

/** A revocable capability over a trivial "registry": a list of strings. */
const NOTES = defineCapability<string[]>("test:notes", { revocable: true });

/** A non-revocable one — the default, and the shape five of the six tokens use. */
const LEDGER = defineCapability<string[]>("test:ledger");

/** Never provided by any host below; the subject of the `require` refusal. */
const ABSENT = defineCapability<string[]>("test:absent");

/** A plugin that records its own installation into `log`. */
function recorder(
  name: string,
  log: string[],
  extra: Partial<FourPlugin> = {},
): FourPlugin {
  return {
    name,
    version: "1.0.0",
    install() {
      log.push(name);
    },
    ...extra,
  };
}

/** Reads the §89 code off a thrown value, or fails loudly. */
function codeOf(error: unknown): string {
  if (!isFourError(error)) {
    throw new Error(`expected a FourError, got ${String(error)}`);
  }
  return error.code;
}

describe("PLUGIN_API_VERSION", () => {
  it("starts at 0.1.0 (RFC 0002 Q5, owner decision)", () => {
    expect(PLUGIN_API_VERSION).toBe("0.1.0");
  });
});

describe("satisfiesPluginRange", () => {
  it("accepts anything for *", () => {
    expect(satisfiesPluginRange("0.1.0", "*")).toBe(true);
    expect(satisfiesPluginRange("9.9.9", "*")).toBe(true);
  });

  it("compares an exact range exactly", () => {
    expect(satisfiesPluginRange("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesPluginRange("1.2.4", "1.2.3")).toBe(false);
  });

  it("treats >= as a lower bound with no ceiling", () => {
    expect(satisfiesPluginRange("1.2.3", ">=1.2.3")).toBe(true);
    expect(satisfiesPluginRange("9.0.0", ">=1.2.3")).toBe(true);
    expect(satisfiesPluginRange("1.2.2", ">=1.2.3")).toBe(false);
  });

  it("minor-locks ~ at every major", () => {
    expect(satisfiesPluginRange("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfiesPluginRange("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfiesPluginRange("1.2.2", "~1.2.3")).toBe(false);
  });

  it("major-locks ^ at 1.0.0 and above", () => {
    expect(satisfiesPluginRange("1.9.9", "^1.2.3")).toBe(true);
    expect(satisfiesPluginRange("2.0.0", "^1.2.3")).toBe(false);
  });

  it("minor-locks ^ below 1.0.0 — the honesty `0.1.0` was chosen for", () => {
    expect(satisfiesPluginRange("0.1.5", "^0.1.0")).toBe(true);
    expect(satisfiesPluginRange("0.2.0", "^0.1.0")).toBe(false);
    expect(satisfiesPluginRange("0.0.9", "^0.1.0")).toBe(false);
  });

  it("refuses a range outside the grammar rather than approximating it", () => {
    for (const range of [
      "1.x",
      ">1.0.0",
      "1.2.3-beta.1",
      "^1.2",
      "",
      "v1.2.3",
    ]) {
      expect(() => satisfiesPluginRange("1.2.3", range)).toThrow(/grammar/);
    }
  });

  it("refuses a version outside the grammar", () => {
    expect(() => satisfiesPluginRange("1.2", "*")).toThrow(/exactly/);
    expect(() => satisfiesPluginRange("1.2.3-rc.1", "*")).toThrow(/exactly/);
  });
});

describe("defineCapability", () => {
  it("defaults to non-revocable (RFC 0002 Q3, owner decision)", () => {
    expect(defineCapability<number>("test:x").revocable).toBe(false);
    expect(defineCapability<number>("test:x", {}).revocable).toBe(false);
    expect(
      defineCapability<number>("test:x", { revocable: true }).revocable,
    ).toBe(true);
  });

  it("carries its type parameter only phantomly", () => {
    const capability = defineCapability<string[]>("test:x");
    expect(Object.keys(capability).sort()).toEqual(["name", "revocable"]);
  });
});

describe("PluginContext", () => {
  it("reports the capabilities it was given, in provision order (§33)", async () => {
    let seen: readonly string[] = [];
    const plugin: FourPlugin = {
      name: "a",
      version: "1.0.0",
      install(context) {
        seen = [...context.capabilities];
      },
    };
    await installPlugins(
      [plugin],
      [bindCapability(NOTES, []), bindCapability(LEDGER, [])],
    );
    expect(seen).toEqual(["test:notes", "test:ledger"]);
  });

  it("hands `get` the value, and `undefined` for a capability it lacks", async () => {
    const notes: string[] = [];
    let got: string[] | undefined;
    let missing: string[] | undefined = notes;
    await installPlugins(
      [
        {
          name: "a",
          version: "1.0.0",
          install(context) {
            got = context.get(NOTES);
            missing = context.get(ABSENT);
          },
        },
      ],
      [bindCapability(NOTES, notes)],
    );
    expect(got).toBe(notes);
    expect(missing).toBeUndefined();
  });

  it("refuses `require` for an absent capability, naming what is provided (§85)", async () => {
    const failing: FourPlugin = {
      name: "@vendor/needs-more",
      version: "1.0.0",
      install(context) {
        context.require(ABSENT);
      },
    };
    await expect(
      installPlugins([failing], [bindCapability(NOTES, [])]),
    ).rejects.toThrow(/"test:absent" is not provided.*test:notes/s);
  });

  it("names `none` when the host provides nothing at all", async () => {
    await expect(
      installPlugins([
        {
          name: "a",
          version: "1.0.0",
          install(context) {
            context.require(ABSENT);
          },
        },
      ]),
    ).rejects.toThrow(/Provided: none/);
  });

  it("lists installed plugins in install order, growing as they install", async () => {
    const observed: number[] = [];
    const context = await installPlugins([
      {
        name: "a",
        version: "1.0.0",
        install(inner) {
          observed.push(inner.plugins.length);
        },
      },
      {
        name: "b",
        version: "1.0.0",
        install(inner) {
          observed.push(inner.plugins.length);
        },
      },
    ]);
    expect(observed).toEqual([0, 1]);
    expect(context.plugins.map((plugin) => plugin.name)).toEqual(["a", "b"]);
  });

  it("seals after installation, so a stashed context cannot register later", async () => {
    let stashed: PluginContext | undefined;
    const context = await installPlugins(
      [
        {
          name: "a",
          version: "1.0.0",
          install(inner) {
            stashed = inner;
          },
        },
      ],
      [bindCapability(NOTES, [])],
    );
    expect(stashed).toBe(context);
    expect(() => stashed?.get(NOTES)).toThrow(/outside a plugin's install/);
    expect(() => stashed?.require(NOTES)).toThrow(/outside a plugin's install/);
    // Diagnostics still read back — the seal is on acquisition, not on the record.
    expect(context.capabilities).toEqual(["test:notes"]);
    expect(context.plugins).toHaveLength(1);
  });

  it("seals even when an install throws, and the failure propagates", async () => {
    let stashed: PluginContext | undefined;
    const boom: FourPlugin = {
      name: "a",
      version: "1.0.0",
      install(inner) {
        stashed = inner;
        throw new Error("plugin exploded");
      },
    };
    await expect(
      installPlugins([boom], [bindCapability(NOTES, [])]),
    ).rejects.toThrow("plugin exploded");
    expect(() => stashed?.get(NOTES)).toThrow(/outside a plugin's install/);
  });
});

describe("install order (§33)", () => {
  it("is the add order when nothing declares a dependency", async () => {
    const log: string[] = [];
    await installPlugins([
      recorder("a", log),
      recorder("b", log),
      recorder("c", log),
    ]);
    expect(log).toEqual(["a", "b", "c"]);
  });

  it("is topological over dependencies, ties broken by add order", async () => {
    const log: string[] = [];
    await installPlugins([
      recorder("c", log, {
        dependencies: [{ name: "a", range: "^1.0.0" }],
      }),
      recorder("b", log),
      recorder("a", log),
    ]);
    // `c` waits for `a`; `b` depends on nothing, so it keeps its add-order
    // place ahead of `a`? No — the scan emits the FIRST ready plugin each
    // round, so `b` (ready, listed second) precedes `a` (ready, listed third),
    // and `c` follows once `a` has installed.
    expect(log).toEqual(["b", "a", "c"]);
  });

  it("awaits an asynchronous install before starting the next (§81)", async () => {
    const log: string[] = [];
    await installPlugins([
      {
        name: "slow",
        version: "1.0.0",
        async install() {
          await Promise.resolve();
          log.push("slow");
        },
      },
      recorder("fast", log),
    ]);
    expect(log).toEqual(["slow", "fast"]);
  });

  it("does not derive order from a name sort", async () => {
    const log: string[] = [];
    await installPlugins([recorder("z", log), recorder("a", log)]);
    expect(log).toEqual(["z", "a"]);
  });
});

describe("refusals (§85, §89)", () => {
  it("refuses two plugins with one name", async () => {
    const log: string[] = [];
    await expect(
      installPlugins([recorder("dup", log), recorder("dup", log)]),
    ).rejects.toThrow(/"dup" is already installed/);
    expect(log).toEqual([]);
  });

  it("refuses an empty name", async () => {
    await expect(installPlugins([recorder("", [])])).rejects.toThrow(
      /non-empty `name`/,
    );
  });

  it("refuses a version outside the grammar", async () => {
    await expect(
      installPlugins([{ ...recorder("a", []), version: "1.0" }]),
    ).rejects.toThrow(/Plugin "a" version must be exactly/);
  });

  it("refuses an engine range this build does not satisfy, naming both numbers", async () => {
    const log: string[] = [];
    let thrown: unknown;
    try {
      await installPlugins([
        recorder("future", log, { engineRange: ">=9.0.0" }),
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe("INVALID_APPLICATION_STATE");
    expect((thrown as Error).message).toContain('">=9.0.0"');
    expect((thrown as Error).message).toContain('"0.1.0"');
    expect(log).toEqual([]);
  });

  it("accepts an engine range this build does satisfy, and no range at all", async () => {
    const log: string[] = [];
    await installPlugins([
      recorder("caret", log, { engineRange: "^0.1.0" }),
      recorder("any", log, { engineRange: "*" }),
      recorder("silent", log),
    ]);
    expect(log).toEqual(["caret", "any", "silent"]);
  });

  it("refuses a dependency that is not in the set", async () => {
    await expect(
      installPlugins([
        recorder("a", [], {
          dependencies: [{ name: "missing", range: "*" }],
        }),
      ]),
    ).rejects.toThrow(/depends on "missing" \*, which is not in this set/);
  });

  it("refuses a dependency whose version is out of range", async () => {
    await expect(
      installPlugins([
        recorder("a", [], {
          dependencies: [{ name: "b", range: "^2.0.0" }],
        }),
        recorder("b", []),
      ]),
    ).rejects.toThrow(
      /depends on "b" \^2\.0\.0, and version 1\.0\.0 is present/,
    );
  });

  it("refuses a dependency cycle, naming what is in it", async () => {
    const log: string[] = [];
    await expect(
      installPlugins([
        recorder("a", log, { dependencies: [{ name: "b", range: "*" }] }),
        recorder("b", log, { dependencies: [{ name: "a", range: "*" }] }),
      ]),
    ).rejects.toThrow(/cycle.*a -> b/s);
    expect(log).toEqual([]);
  });

  it("refuses the whole set before running any install (§85)", async () => {
    const log: string[] = [];
    await expect(
      installPlugins([
        recorder("good", log),
        recorder("bad", log, { engineRange: ">=9.0.0" }),
      ]),
    ).rejects.toThrow(/plugin API/);
    expect(log).toEqual([]);
  });
});

describe("PluginHost", () => {
  it("chains provide and add, then installs in order", async () => {
    const log: string[] = [];
    const notes: string[] = [];
    const host = new PluginHost([bindCapability(LEDGER, [])]);
    const returned = host
      .provide(NOTES, notes)
      .add(recorder("a", log))
      .add(recorder("b", log));
    expect(returned).toBe(host);
    expect(host.added.map((plugin) => plugin.name)).toEqual(["a", "b"]);
    expect(host.installed).toBe(false);
    await host.install();
    expect(host.installed).toBe(true);
    expect(log).toEqual(["a", "b"]);
    expect(host.context.capabilities).toEqual(["test:ledger", "test:notes"]);
  });

  it("has no context until it has installed", () => {
    const host = new PluginHost();
    expect(() => host.context).toThrow(/no context until install/);
  });

  it("refuses provide, add, and a second install after installation", async () => {
    const host = new PluginHost();
    await host.install();
    expect(() => host.provide(NOTES, [])).toThrow(
      /not available after install/,
    );
    expect(() => host.add(recorder("a", []))).toThrow(
      /not available after install/,
    );
    await expect(host.install()).rejects.toThrow(/not available after install/);
  });

  it("copies the bindings it was constructed with", async () => {
    const bindings = [bindCapability(NOTES, [])];
    const host = new PluginHost(bindings);
    bindings.push(bindCapability(LEDGER, []));
    await host.install();
    expect(host.context.capabilities).toEqual(["test:notes"]);
  });
});

describe("PluginHost.uninstall", () => {
  /** A plugin that registers into `NOTES` and removes its entry on uninstall. */
  function noteWriter(name: string): FourPlugin {
    return {
      name,
      version: "1.0.0",
      install(context) {
        context.require(NOTES).push(name);
      },
      uninstall(context) {
        const notes = context.require(NOTES);
        notes.splice(notes.indexOf(name), 1);
      },
    };
  }

  it("runs a plugin's uninstall when every capability it took is revocable", async () => {
    const notes: string[] = [];
    const host = new PluginHost([bindCapability(NOTES, notes)]);
    host.add(noteWriter("@vendor/notes"));
    await host.install();
    expect(notes).toEqual(["@vendor/notes"]);
    host.uninstall("@vendor/notes");
    expect(notes).toEqual([]);
    expect(host.context.plugins).toEqual([]);
  });

  it("uninstalls a plugin that took nothing and declares no uninstall", async () => {
    const host = new PluginHost();
    host.add(recorder("a", []));
    await host.install();
    host.uninstall("a");
    expect(host.context.plugins).toEqual([]);
  });

  it("refuses a name nothing is installed under", async () => {
    const host = new PluginHost();
    await host.install();
    expect(() => host.uninstall("ghost")).toThrow(/No plugin named "ghost"/);
  });

  it("refuses before anything has installed at all", () => {
    expect(() => new PluginHost().uninstall("ghost")).toThrow(
      /No plugin named "ghost"/,
    );
  });

  it("refuses a plugin pinned by a non-revocable capability, naming it", async () => {
    const uninstall = vi.fn();
    const host = new PluginHost([bindCapability(LEDGER, [])]);
    host.add({
      name: "@vendor/ledger",
      version: "1.0.0",
      install(context) {
        context.require(LEDGER).push("entry");
      },
      uninstall,
    });
    await host.install();
    let thrown: unknown;
    try {
      host.uninstall("@vendor/ledger");
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe("INVALID_APPLICATION_STATE");
    expect((thrown as Error).message).toContain('"test:ledger"');
    // The refusal happens *instead of* a half-removal, which is the whole point.
    expect(uninstall).not.toHaveBeenCalled();
    expect(host.context.plugins).toHaveLength(1);
  });

  it("refuses while another installed plugin depends on it", async () => {
    const host = new PluginHost();
    host
      .add(recorder("base", []))
      .add(
        recorder("leaf", [], { dependencies: [{ name: "base", range: "*" }] }),
      );
    await host.install();
    expect(() => host.uninstall("base")).toThrow(
      /cannot be uninstalled while "leaf" depends on it/,
    );
    // The dependent goes first; then the base is free.
    host.uninstall("leaf");
    host.uninstall("base");
    expect(host.context.plugins).toEqual([]);
  });

  it("refuses a non-revocable capability acquired during uninstall", async () => {
    const host = new PluginHost([
      bindCapability(NOTES, []),
      bindCapability(LEDGER, []),
    ]);
    host.add({
      name: "@vendor/sneaky",
      version: "1.0.0",
      install(context) {
        context.require(NOTES);
      },
      uninstall(context) {
        context.require(LEDGER);
      },
    });
    await host.install();
    expect(() => host.uninstall("@vendor/sneaky")).toThrow(
      /not revocable and cannot be acquired during uninstall/,
    );
    // The plugin is gone even so: `runUninstall` forgets it in a `finally`, so
    // a throwing uninstall cannot leave a half-removed plugin on the host.
    expect(host.context.plugins).toEqual([]);
  });

  it("lets a plugin re-acquire a revocable capability while uninstalling", async () => {
    const notes: string[] = [];
    const host = new PluginHost([bindCapability(NOTES, notes)]);
    host.add(noteWriter("a")).add(noteWriter("b"));
    await host.install();
    host.uninstall("a");
    expect(notes).toEqual(["b"]);
    expect(host.context.plugins.map((plugin) => plugin.name)).toEqual(["b"]);
  });
});
