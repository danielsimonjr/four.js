import { Quaternion, Vector3 } from "@four/math";
import { describe, expect, it, vi } from "vitest";

import {
  Group,
  Node,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  type NodeType,
} from "../src/index.js";

const HALF_PI = Math.PI / 2;
const AXIS_Z = new Vector3(0, 0, 1);

describe("Node transform aliases (§15/§97 idiom)", () => {
  it("returns the live transform members, never copies", () => {
    const node = new Group();

    expect(node.position).toBe(node.transform.position);
    expect(node.rotation).toBe(node.transform.rotation);
    expect(node.scale).toBe(node.transform.scale);
  });

  it("keeps returning the same instances for the node's lifetime", () => {
    const node = new Group();
    const position = node.position;
    const rotation = node.rotation;
    const scale = node.scale;

    node.position.set(1, 2, 3);
    node.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    node.scale.set(2, 2, 2);

    expect(node.position).toBe(position);
    expect(node.rotation).toBe(rotation);
    expect(node.scale).toBe(scale);
  });

  it("makes both spellings one and the same write", () => {
    const node = new Group();

    // Alias write, transform read …
    node.position.set(1, 2, 3);
    expect(node.transform.position.x).toBe(1);
    expect(node.transform.position.y).toBe(2);
    expect(node.transform.position.z).toBe(3);

    // … and transform write, alias read.
    node.transform.scale.set(4, 5, 6);
    expect([node.scale.x, node.scale.y, node.scale.z]).toEqual([4, 5, 6]);
  });

  it("bumps the transform version through alias writes exactly like transform writes", () => {
    // Mirrors the "bumps once per method-based mutation" test of
    // transform.test.ts, driven through the aliases instead: same channel,
    // same counts (plan D3).
    const node = new Group();
    expect(node.transform.version).toBe(0);

    node.position.set(1, 2, 3);
    expect(node.transform.version).toBe(1);

    node.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    expect(node.transform.version).toBe(2);

    node.scale.set(2, 2, 2);
    expect(node.transform.version).toBe(3);

    // A node authored through `transform.*` lands on the same version.
    const control = new Group();
    control.transform.position.set(1, 2, 3);
    control.transform.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    control.transform.scale.set(2, 2, 2);
    expect(control.transform.version).toBe(node.transform.version);
  });

  it("composes the same local matrix whichever spelling authored it", () => {
    const viaAlias = new Group();
    viaAlias.position.set(5, -2, 3);
    viaAlias.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    viaAlias.scale.set(2, 3, 4);
    viaAlias.transform.updateLocalMatrix();

    const viaTransform = new Group();
    viaTransform.transform.position.set(5, -2, 3);
    viaTransform.transform.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    viaTransform.transform.scale.set(2, 3, 4);
    viaTransform.transform.updateLocalMatrix();

    expect(Array.from(viaAlias.transform.localMatrix.elements)).toEqual(
      Array.from(viaTransform.transform.localMatrix.elements),
    );
  });

  it("leaves direct field writes through an alias invisible until markDirty", () => {
    // Same rule as writing `transform.position.x` directly (plan D3): the hook
    // sees method calls only, and the alias changes nothing about that.
    const node = new Group();

    node.position.x = 5;
    expect(node.transform.version).toBe(0);

    node.transform.markDirty();
    expect(node.transform.version).toBe(1);
  });

  it("is getter-only — assignment is not the API, exactly as on Transform", () => {
    // Decision: `Transform.position/rotation/scale` are `readonly` properties
    // holding mutable math objects (replacing one would drop the change hook),
    // and the aliases mirror that contract — a getter with no setter. Mutate
    // via `.set(...)` / `.copy(...)`. `Reflect.set` reports the missing setter
    // as a failed write instead of throwing.
    const node = new Group();
    const position = node.position;
    const replacement = new Vector3(9, 9, 9);

    for (const name of ["position", "rotation", "scale"] as const) {
      expect(
        Object.getOwnPropertyDescriptor(Node.prototype, name),
        name,
      ).toBeDefined();
      expect(Reflect.set(node, name, replacement), name).toBe(false);
    }

    // Nothing was replaced: the alias still returns the live hooked instance.
    expect(node.position).toBe(position);
    expect(node.position).toBe(node.transform.position);
  });

  it("returns correctly typed math objects", () => {
    const node = new Group();

    expect(node.position).toBeInstanceOf(Vector3);
    expect(node.rotation).toBeInstanceOf(Quaternion);
    expect(node.scale).toBeInstanceOf(Vector3);
  });
});

describe("Node transform aliases on subclasses", () => {
  it("supports the §97 spelling: camera.position.set(0, 2, 8)", () => {
    const camera = new PerspectiveCamera();
    const before = camera.transform.version;

    camera.position.set(0, 2, 8);

    expect(camera.transform.position.x).toBe(0);
    expect(camera.transform.position.y).toBe(2);
    expect(camera.transform.position.z).toBe(8);
    expect(camera.transform.version).toBe(before + 1);
  });

  it("is inherited identically by every Node subclass", () => {
    const nodes: readonly Node[] = [
      new Group(),
      new Scene(),
      new PerspectiveCamera(),
      new OrthographicCamera(),
    ];

    for (const node of nodes) {
      expect(node.position, node.id).toBe(node.transform.position);
      expect(node.rotation, node.id).toBe(node.transform.rotation);
      expect(node.scale, node.id).toBe(node.transform.scale);
    }
  });

  it("defines the aliases once, on Node.prototype, not per subclass", () => {
    const subclasses: readonly NodeType<Node>[] = [
      Group,
      Scene,
      PerspectiveCamera,
      OrthographicCamera,
    ];

    for (const subclass of subclasses) {
      for (const name of ["position", "rotation", "scale"] as const) {
        expect(
          Object.getOwnPropertyDescriptor(subclass.prototype, name),
          `${subclass.name}.${name}`,
        ).toBeUndefined();
      }
    }
  });
});

describe("constructing the abstract base", () => {
  it("warns in DEV when Node is constructed directly, and names the concrete class", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // TypeScript rejects `new Node()`. A JavaScript consumer is not stopped by
      // anything -- `abstract` is erased -- and gets a working-looking object.
      new (Node as unknown as new () => Node)();

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0]?.join(" ") ?? "";
      expect(message).toMatch(/Group/);
      expect(message).toMatch(/abstract/i);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not warn for the concrete subclasses", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      new Group();
      new Group();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

