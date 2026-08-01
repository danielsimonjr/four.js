import { FourError, isFourError } from "@four/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TRANSFORM_AUTHORITY,
  Group,
  TRANSFORM_AUTHORITIES,
  warnAuthorityConflict,
  type TransformAuthority,
} from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Silences and records `console.warn` for one test. */
function spyOnWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("TransformAuthority (§42)", () => {
  it("lists exactly §42's authorities, in §42's order", () => {
    expect([...TRANSFORM_AUTHORITIES]).toEqual([
      "manual",
      "animation",
      "kinematic",
      "physics",
      "blended",
      "constraint",
      "network",
    ]);
  });

  it("types every listed value as a TransformAuthority", () => {
    // Compile-time surface check: the array's members are the union's members.
    const authorities: readonly TransformAuthority[] = TRANSFORM_AUTHORITIES;
    expect(new Set(authorities).size).toBe(TRANSFORM_AUTHORITIES.length);
  });

  it("defaults to `manual`", () => {
    expect(DEFAULT_TRANSFORM_AUTHORITY).toBe("manual");
    expect(new Group().transformAuthority).toBe("manual");
  });

  it("is per node, not shared", () => {
    const a = new Group();
    const b = new Group();
    a.transformAuthority = "physics";
    expect(a.transformAuthority).toBe("physics");
    expect(b.transformAuthority).toBe("manual");
  });

  it("accepts every authority except the reserved `blended`", () => {
    const node = new Group();
    for (const authority of TRANSFORM_AUTHORITIES) {
      if (authority === "blended") {
        continue;
      }
      node.transformAuthority = authority;
      expect(node.transformAuthority).toBe(authority);
    }
  });
});

describe("`blended` is reserved until Phase 7 (§42, §19)", () => {
  it("throws NOT_IMPLEMENTED when assigned", () => {
    const node = new Group();
    let thrown: unknown;
    try {
      node.transformAuthority = "blended";
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    expect((thrown as FourError).code).toBe("NOT_IMPLEMENTED");
    expect((thrown as FourError).message).toContain("§19");
    expect((thrown as FourError).context).toEqual({
      node: node.id,
      authority: "blended",
    });
  });

  it("leaves the previous authority in place", () => {
    const node = new Group();
    node.transformAuthority = "animation";
    expect(() => {
      node.transformAuthority = "blended";
    }).toThrow(FourError);
    expect(node.transformAuthority).toBe("animation");
  });
});

describe("warnAuthorityConflict (§42 development warning)", () => {
  it("warns once per node per writer", () => {
    const warn = spyOnWarn();
    const node = new Group();

    expect(warnAuthorityConflict(node, "kinematic")).toBe(true);
    expect(warnAuthorityConflict(node, "kinematic")).toBe(false);
    expect(warnAuthorityConflict(node, "kinematic")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns again for a different writer on the same node", () => {
    const warn = spyOnWarn();
    const node = new Group();

    expect(warnAuthorityConflict(node, "kinematic")).toBe(true);
    expect(warnAuthorityConflict(node, "physics")).toBe(true);
    expect(warnAuthorityConflict(node, "kinematic")).toBe(false);
    expect(warnAuthorityConflict(node, "physics")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("warns again for the same writer on a different node", () => {
    const warn = spyOnWarn();
    const a = new Group();
    const b = new Group();

    expect(warnAuthorityConflict(a, "animation")).toBe(true);
    expect(warnAuthorityConflict(b, "animation")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("names the node, the owner, and the offending writer", () => {
    const warn = spyOnWarn();
    const node = new Group();
    node.name = "crate";
    node.transformAuthority = "physics";

    warnAuthorityConflict(node, "kinematic");

    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain("[four]");
    expect(message).toContain(node.id);
    expect(message).toContain("crate");
    expect(message).toContain('"physics"');
    expect(message).toContain('"kinematic"');
    expect(message).toContain("§42");
  });

  it("omits the name when a node has none", () => {
    const warn = spyOnWarn();
    const node = new Group();

    warnAuthorityConflict(node, "network");

    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain(node.id);
    expect(message).not.toContain('("")');
  });

  it("never touches the node it reports on", () => {
    spyOnWarn();
    const node = new Group();
    node.transformAuthority = "physics";
    const version = node.transform.version;

    warnAuthorityConflict(node, "kinematic");

    expect(node.transformAuthority).toBe("physics");
    expect(node.transform.version).toBe(version);
    expect(node.transform.position.x).toBe(0);
  });
});
