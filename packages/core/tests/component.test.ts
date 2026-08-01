import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComponentRegistry,
  type Component,
  type ComponentHost,
} from "../src/component.js";
import { FourError } from "../src/errors.js";

/** Records lifecycle calls across every component in one test. */
class Journal {
  readonly entries: string[] = [];

  record(entry: string): void {
    this.entries.push(entry);
  }
}

class TrackedComponent implements Component {
  static readonly typeName: string = "test.tracked";

  host: ComponentHost | null = null;

  attachCount = 0;

  detachCount = 0;

  disposeCount = 0;

  constructor(
    readonly label: string,
    private readonly journal?: Journal,
  ) {}

  onAttach(host: ComponentHost): void {
    this.attachCount += 1;
    this.journal?.record(`${this.label}:attach:${String(this.host === host)}`);
  }

  onDetach(host: ComponentHost): void {
    this.detachCount += 1;
    this.journal?.record(`${this.label}:detach:${String(this.host === host)}`);
  }

  dispose(): void {
    this.disposeCount += 1;
    this.journal?.record(`${this.label}:dispose`);
  }
}

class OtherComponent implements Component {
  static readonly typeName = "test.other";

  host: ComponentHost | null = null;

  constructor(readonly label: string = "other") {}
}

/** No lifecycle hooks at all — every hook in §6a is optional. */
class BareComponent implements Component {
  static readonly typeName = "test.bare";

  host: ComponentHost | null = null;
}

/** Deliberately missing `static typeName` (plan D2 violation). */
class NamelessComponent implements Component {
  host: ComponentHost | null = null;
}

describe("ComponentRegistry (§6a)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches a component and exposes it by type", () => {
    const registry = new ComponentRegistry();
    const component = new TrackedComponent("a");

    expect(registry.add(component)).toBe(component);
    expect(registry.get(TrackedComponent)).toBe(component);
    expect(registry.has(TrackedComponent)).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("returns undefined for a type that is not attached", () => {
    const registry = new ComponentRegistry();
    registry.add(new TrackedComponent("a"));

    expect(registry.get(OtherComponent)).toBeUndefined();
    expect(registry.has(OtherComponent)).toBe(false);
  });

  it("gives components the host they were registered with", () => {
    const host: ComponentHost = {
      addComponent: <T extends Component>(component: T): T => component,
      getComponent: () => undefined,
      removeComponent: () => false,
    };
    const registry = new ComponentRegistry(host);
    const component = new TrackedComponent("a");

    registry.add(component);

    expect(component.host).toBe(host);
  });

  it("acts as its own host when none is supplied", () => {
    const registry = new ComponentRegistry();
    const component = new TrackedComponent("a");

    registry.add(component);

    expect(component.host).toBe(registry);
  });

  it("supports typed retrieval of distinct component types", () => {
    const registry = new ComponentRegistry();
    const tracked = new TrackedComponent("a");
    const other = new OtherComponent("b");
    registry.add(tracked);
    registry.add(other);

    const found = registry.get(OtherComponent);

    expect(found).toBe(other);
    // Typed retrieval: `found` is `OtherComponent | undefined`, so `label` is
    // reachable without a cast.
    expect(found?.label).toBe("b");
    expect(registry.get(TrackedComponent)?.label).toBe("a");
    expect(registry.size).toBe(2);
  });

  it("tolerates components without lifecycle hooks", () => {
    const registry = new ComponentRegistry();
    const bare = new BareComponent();

    registry.add(bare);
    expect(bare.host).toBe(registry);
    expect(registry.remove(bare)).toBe(true);
    expect(bare.host).toBeNull();

    registry.add(bare);
    expect(() => {
      registry.disposeAll();
    }).not.toThrow();
  });

  it("rejects a component class without a static typeName (plan D2)", () => {
    const registry = new ComponentRegistry();

    expect(() => registry.add(new NamelessComponent())).toThrow(FourError);
    try {
      registry.add(new NamelessComponent());
    } catch (error) {
      expect(error).toBeInstanceOf(FourError);
      expect((error as FourError).code).toBe("INVALID_SCENE_GRAPH");
    }
  });

  describe("one component per type", () => {
    it("replaces an existing component of the same type", () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const registry = new ComponentRegistry();
      const first = new TrackedComponent("first");
      const second = new TrackedComponent("second");

      registry.add(first);
      registry.add(second);

      expect(registry.size).toBe(1);
      expect(registry.get(TrackedComponent)).toBe(second);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("test.tracked");
    });

    it("detaches — but does not dispose — the replaced component (§6a)", () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const registry = new ComponentRegistry();
      const first = new TrackedComponent("first");

      registry.add(first);
      registry.add(new TrackedComponent("second"));

      expect(first.detachCount).toBe(1);
      expect(first.disposeCount).toBe(0);
      expect(first.host).toBeNull();
    });

    it("warns once per replacement, not once per registry", () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const registry = new ComponentRegistry();

      registry.add(new TrackedComponent("first"));
      registry.add(new TrackedComponent("second"));
      registry.add(new TrackedComponent("third"));

      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("does not warn or re-attach when the same instance is added twice", () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const registry = new ComponentRegistry();
      const component = new TrackedComponent("a");

      registry.add(component);
      registry.add(component);

      expect(warn).not.toHaveBeenCalled();
      expect(component.attachCount).toBe(1);
      expect(component.detachCount).toBe(0);
    });

    it("keeps components of different types side by side", () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const registry = new ComponentRegistry();

      registry.add(new TrackedComponent("a"));
      registry.add(new OtherComponent("b"));

      expect(registry.size).toBe(2);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("lifecycle order", () => {
    it("runs onAttach after registration, with host already bound", () => {
      const journal = new Journal();
      const registry = new ComponentRegistry();
      const component = new TrackedComponent("a", journal);

      registry.add(component);

      // `true` = the component's `host` was already assigned when onAttach ran.
      expect(journal.entries).toEqual(["a:attach:true"]);
      expect(registry.get(TrackedComponent)).toBe(component);
    });

    it("sees itself through the host from onAttach", () => {
      const registry = new ComponentRegistry();
      let selfDuringAttach: Component | undefined;
      class SelfInspecting implements Component {
        static readonly typeName = "test.self-inspecting";

        host: ComponentHost | null = null;

        onAttach(host: ComponentHost): void {
          selfDuringAttach = host.getComponent(SelfInspecting);
        }
      }
      const component = new SelfInspecting();

      registry.add(component);

      expect(selfDuringAttach).toBe(component);
    });

    it("detaches the old component before attaching the replacement", () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const journal = new Journal();
      const registry = new ComponentRegistry();

      registry.add(new TrackedComponent("first", journal));
      registry.add(new TrackedComponent("second", journal));

      expect(journal.entries).toEqual([
        "first:attach:true",
        // Host still bound during onDetach, cleared afterwards.
        "first:detach:true",
        "second:attach:true",
      ]);
    });

    it("runs onDetach on removal and clears the host", () => {
      const journal = new Journal();
      const registry = new ComponentRegistry();
      const component = new TrackedComponent("a", journal);
      registry.add(component);

      expect(registry.remove(component)).toBe(true);

      expect(journal.entries).toEqual(["a:attach:true", "a:detach:true"]);
      expect(component.host).toBeNull();
      expect(registry.size).toBe(0);
      expect(registry.get(TrackedComponent)).toBeUndefined();
    });

    it("remove returns false for a component that is not attached", () => {
      const registry = new ComponentRegistry();
      const attached = new TrackedComponent("a");
      const stranger = new TrackedComponent("b");
      registry.add(attached);

      expect(registry.remove(stranger)).toBe(false);
      expect(registry.remove(new OtherComponent())).toBe(false);
      expect(registry.remove(new NamelessComponent())).toBe(false);
      expect(registry.get(TrackedComponent)).toBe(attached);
    });

    it("removing twice detaches only once", () => {
      const registry = new ComponentRegistry();
      const component = new TrackedComponent("a");
      registry.add(component);

      expect(registry.remove(component)).toBe(true);
      expect(registry.remove(component)).toBe(false);
      expect(component.detachCount).toBe(1);
    });
  });

  describe("detach is not dispose (§6a)", () => {
    it("does not dispose on removal", () => {
      const registry = new ComponentRegistry();
      const component = new TrackedComponent("a");
      registry.add(component);

      registry.remove(component);

      expect(component.detachCount).toBe(1);
      expect(component.disposeCount).toBe(0);
    });

    it("disposeAll detaches then disposes, in reverse insertion order", () => {
      const journal = new Journal();
      const registry = new ComponentRegistry();
      class SecondType extends TrackedComponent {
        static override readonly typeName = "test.second";
      }
      registry.add(new TrackedComponent("first", journal));
      registry.add(new SecondType("second", journal));

      registry.disposeAll();

      expect(journal.entries).toEqual([
        "first:attach:true",
        "second:attach:true",
        "second:detach:true",
        "second:dispose",
        "first:detach:true",
        "first:dispose",
      ]);
      expect(registry.size).toBe(0);
    });
  });

  it("iterates components in insertion order (ground rule 5)", () => {
    const registry = new ComponentRegistry();
    const tracked = new TrackedComponent("a");
    const other = new OtherComponent("b");
    registry.add(tracked);
    registry.add(other);

    expect([...registry.components]).toEqual([tracked, other]);
  });

  it("satisfies ComponentHost itself", () => {
    const registry = new ComponentRegistry();
    const host: ComponentHost = registry;
    const component = new TrackedComponent("a");

    expect(host.addComponent(component)).toBe(component);
    expect(host.getComponent(TrackedComponent)).toBe(component);
    expect(host.removeComponent(component)).toBe(true);
    expect(host.getComponent(TrackedComponent)).toBeUndefined();
  });
});
