import { isFourError } from "@four/core";
import { Matrix3, Quaternion, Vector2, Vector3 } from "@four/math";
import { Transform } from "@four/scene";
import { describe, expect, it } from "vitest";

import type {
  ColliderDescriptor,
  RigidBodyDescriptor,
} from "../src/descriptors.js";
import type { PhysicsBodyHandle } from "../src/types.js";
import {
  validateColliderDescriptor,
  validateInertiaTensor,
  validateJointDescriptor,
  validateMass,
  validatePhysicsWorldOptions,
  validateRigidBodyDescriptor,
} from "../src/validation.js";

function makeBodyHandle(id: string): PhysicsBodyHandle {
  return { id } as unknown as PhysicsBodyHandle;
}

function expectFourError(run: () => void): Error {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  const error = caught as Error & { code: string };
  expect(error.code).toBe("INVALID_APPLICATION_STATE");
  return error;
}

function collider(
  overrides: Partial<ColliderDescriptor> = {},
): ColliderDescriptor {
  return {
    body: makeBodyHandle("a"),
    shape: { type: "circle", radius: 1 },
    ...overrides,
  };
}

describe("validateMass (§23, §85)", () => {
  it("accepts an omitted mass at every body type — §23 derives it from density", () => {
    expect(() => {
      validateMass("dynamic");
      validateMass("static");
      validateMass("kinematic-position");
      validateMass("kinematic-velocity");
    }).not.toThrow();
  });

  it("accepts a positive mass on a dynamic body", () => {
    expect(() => {
      validateMass("dynamic", 2);
    }).not.toThrow();
  });

  it.each([0, -1])("rejects a mass of %s on a dynamic body", (mass) => {
    const error = expectFourError(() => {
      validateMass("dynamic", mass);
    });
    expect(error.message).toContain("must be positive");
    expect(error.message).toContain("never mass = 0");
  });

  it("rejects a non-finite mass", () => {
    expectFourError(() => {
      validateMass("dynamic", Number.NaN);
    });
  });

  it("allows mass 0 on a static body but never a negative mass", () => {
    expect(() => {
      validateMass("static", 0);
    }).not.toThrow();
    expect(
      expectFourError(() => {
        validateMass("static", -1);
      }).message,
    ).toContain("must not be negative");
  });
});

describe("validateInertiaTensor (§23, §85)", () => {
  it("accepts a plain identity tensor", () => {
    expect(() => {
      validateInertiaTensor(new Matrix3());
    }).not.toThrow();
  });

  it("accepts signed off-diagonal products of inertia", () => {
    const tensor = new Matrix3();
    tensor.elements[1] = -0.5;
    expect(() => {
      validateInertiaTensor(tensor);
    }).not.toThrow();
  });

  it("rejects a non-finite entry", () => {
    const tensor = new Matrix3();
    tensor.elements[5] = Number.NaN;
    expect(
      expectFourError(() => {
        validateInertiaTensor(tensor);
      }).message,
    ).toContain("inertiaTensor[5]");
  });

  it.each([0, 4, 8])(
    "rejects a negative principal moment at element %s",
    (index) => {
      const tensor = new Matrix3();
      tensor.elements[index] = -1;
      expect(
        expectFourError(() => {
          validateInertiaTensor(tensor);
        }).message,
      ).toContain("principal moment");
    },
  );
});

describe("validateRigidBodyDescriptor (§22, §23, §31)", () => {
  it("accepts a fully specified 3D body", () => {
    const desc: RigidBodyDescriptor = {
      type: "dynamic",
      position: new Vector3(1, 2, 3),
      rotation: new Quaternion(0, 0, 0, 1),
      mass: 5,
      centerOfMass: new Vector3(0, 0.1, 0),
      inertiaTensor: new Matrix3(),
      linearVelocity: new Vector3(0, -1, 0),
      angularVelocity: new Vector3(0, 1, 0),
      linearDamping: 0.1,
      angularDamping: 0.2,
      gravityScale: 1,
      continuousCollisionDetection: true,
      ccdMode: "swept",
    };
    expect(() => {
      validateRigidBodyDescriptor(desc, "3d");
    }).not.toThrow();
  });

  it("accepts a fully specified 2D body using the convenience forms", () => {
    expect(() => {
      validateRigidBodyDescriptor(
        {
          type: "kinematic-velocity",
          position: new Vector2(1, 2),
          rotation: Math.PI / 3,
          centerOfMass: new Vector2(0, 0),
          linearVelocity: new Vector2(1, 0),
          angularVelocity: 2,
        },
        "2d",
      );
    }).not.toThrow();
  });

  it("rejects an unknown body type (§22)", () => {
    expect(
      expectFourError(() => {
        validateRigidBodyDescriptor(
          { type: "ghost" as RigidBodyDescriptor["type"] },
          "3d",
        );
      }).message,
    ).toContain("Unknown body type");
  });

  it("enforces the §23 mass rule", () => {
    expectFourError(() => {
      validateRigidBodyDescriptor({ type: "dynamic", mass: 0 }, "3d");
    });
  });

  it("checks the inertia tensor", () => {
    const tensor = new Matrix3();
    tensor.elements[0] = -1;
    expectFourError(() => {
      validateRigidBodyDescriptor(
        { type: "dynamic", inertiaTensor: tensor },
        "3d",
      );
    });
  });

  it.each(["position", "centerOfMass", "linearVelocity"] as const)(
    "rejects a non-finite %s",
    (field) => {
      expect(
        expectFourError(() => {
          validateRigidBodyDescriptor(
            { type: "dynamic", [field]: new Vector3(Number.NaN, 0, 0) },
            "3d",
          );
        }).message,
      ).toContain(`${field}.x`);
      expect(
        expectFourError(() => {
          validateRigidBodyDescriptor(
            { type: "dynamic", [field]: new Vector2(0, Number.NaN) },
            "3d",
          );
        }).message,
      ).toContain(`${field}.y`);
      expect(
        expectFourError(() => {
          validateRigidBodyDescriptor(
            {
              type: "dynamic",
              [field]: new Vector3(0, 0, Number.POSITIVE_INFINITY),
            },
            "3d",
          );
        }).message,
      ).toContain(`${field}.z`);
    },
  );

  it.each(["position", "centerOfMass", "linearVelocity"] as const)(
    "rejects an out-of-plane %s in a 2d world (§21)",
    (field) => {
      expect(
        expectFourError(() => {
          validateRigidBodyDescriptor(
            { type: "dynamic", [field]: new Vector3(0, 0, 1) },
            "2d",
          );
        }).message,
      ).toContain("XY plane");
    },
  );

  it("routes rotation through the §21 plane rule", () => {
    expectFourError(() => {
      validateRigidBodyDescriptor(
        { type: "dynamic", rotation: new Quaternion(1, 0, 0, 0) },
        "2d",
      );
    });
    expectFourError(() => {
      validateRigidBodyDescriptor(
        { type: "dynamic", rotation: Number.NaN },
        "2d",
      );
    });
  });

  it("checks angular velocity in both forms", () => {
    expectFourError(() => {
      validateRigidBodyDescriptor(
        { type: "dynamic", angularVelocity: Number.NaN },
        "3d",
      );
    });
    expect(
      expectFourError(() => {
        validateRigidBodyDescriptor(
          { type: "dynamic", angularVelocity: new Vector3(Number.NaN, 0, 0) },
          "3d",
        );
      }).message,
    ).toContain("angularVelocity.x");
    expect(
      expectFourError(() => {
        validateRigidBodyDescriptor(
          { type: "dynamic", angularVelocity: new Vector3(0, Number.NaN, 0) },
          "3d",
        );
      }).message,
    ).toContain("angularVelocity.y");
    expect(
      expectFourError(() => {
        validateRigidBodyDescriptor(
          { type: "dynamic", angularVelocity: new Vector3(0, 0, Number.NaN) },
          "3d",
        );
      }).message,
    ).toContain("angularVelocity.z");
    expect(
      expectFourError(() => {
        validateRigidBodyDescriptor(
          { type: "dynamic", angularVelocity: new Vector3(1, 0, 0) },
          "2d",
        );
      }).message,
    ).toContain("about +Z only");
    expect(
      expectFourError(() => {
        validateRigidBodyDescriptor(
          { type: "dynamic", angularVelocity: new Vector3(0, 1, 0) },
          "2d",
        );
      }).message,
    ).toContain("about +Z only");
  });

  it("rejects negative damping and non-finite gravity scale", () => {
    expect(
      expectFourError(() => {
        validateRigidBodyDescriptor(
          { type: "dynamic", linearDamping: -1 },
          "3d",
        );
      }).message,
    ).toContain("linearDamping");
    expect(
      expectFourError(() => {
        validateRigidBodyDescriptor(
          { type: "dynamic", angularDamping: -1 },
          "3d",
        );
      }).message,
    ).toContain("angularDamping");
    expect(
      expectFourError(() => {
        validateRigidBodyDescriptor(
          { type: "dynamic", gravityScale: Number.NaN },
          "3d",
        );
      }).message,
    ).toContain("gravityScale");
  });

  it("rejects an unknown CCD mode (§31)", () => {
    expect(
      expectFourError(() => {
        validateRigidBodyDescriptor(
          {
            type: "dynamic",
            ccdMode: "magic" as RigidBodyDescriptor["ccdMode"],
          },
          "3d",
        );
      }).message,
    ).toContain("Unknown CCD mode");
  });

  it("rejects a CCD switch that contradicts the CCD mode (§23, §31)", () => {
    expect(
      expectFourError(() => {
        validateRigidBodyDescriptor(
          {
            type: "dynamic",
            continuousCollisionDetection: false,
            ccdMode: "swept",
          },
          "3d",
        );
      }).message,
    ).toContain("continuousCollisionDetection is false");
  });

  it("accepts the consistent CCD combinations", () => {
    expect(() => {
      validateRigidBodyDescriptor(
        {
          type: "dynamic",
          continuousCollisionDetection: false,
          ccdMode: "disabled",
        },
        "3d",
      );
      validateRigidBodyDescriptor(
        { type: "dynamic", ccdMode: "speculative" },
        "3d",
      );
      validateRigidBodyDescriptor(
        { type: "dynamic", continuousCollisionDetection: true },
        "3d",
      );
    }).not.toThrow();
  });
});

describe("validateColliderDescriptor (§24, §25)", () => {
  it("accepts a fully specified collider", () => {
    const offset = new Transform();
    offset.position.set(0, 1, 0);
    expect(() => {
      validateColliderDescriptor(
        collider({
          friction: 0.4,
          restitution: 0.2,
          density: 900,
          sensor: true,
          collisionGroups: 0b0011,
          collisionMask: 0xffffffff,
          offset,
        }),
        "2d",
      );
    }).not.toThrow();
  });

  it("rejects a shape from the wrong dimension (§21)", () => {
    expect(
      expectFourError(() => {
        validateColliderDescriptor(collider(), "3d");
      }).message,
    ).toContain('not valid in a "3d" world');
  });

  it.each(["friction", "restitution", "density"] as const)(
    "rejects a negative %s",
    (field) => {
      expect(
        expectFourError(() => {
          validateColliderDescriptor(collider({ [field]: -1 }), "2d");
        }).message,
      ).toContain(field);
    },
  );

  it.each(["collisionGroups", "collisionMask"] as const)(
    "rejects a %s that is not a 32-bit bit set",
    (field) => {
      expect(
        expectFourError(() => {
          validateColliderDescriptor(collider({ [field]: 1.5 }), "2d");
        }).message,
      ).toContain(field);
      expectFourError(() => {
        validateColliderDescriptor(collider({ [field]: -1 }), "2d");
      });
      expectFourError(() => {
        validateColliderDescriptor(collider({ [field]: 0x1_0000_0000 }), "2d");
      });
    },
  );

  it("applies the §21 plane rule to the offset transform", () => {
    const offset = new Transform();
    offset.position.set(0, 0, 1);
    expect(
      expectFourError(() => {
        validateColliderDescriptor(collider({ offset }), "2d");
      }).message,
    ).toContain("offset.position.z");

    const tilted = new Transform();
    tilted.rotation.set(1, 0, 0, 0);
    expect(
      expectFourError(() => {
        validateColliderDescriptor(collider({ offset: tilted }), "2d");
      }).message,
    ).toContain("about +Z only");
  });
});

describe("validateJointDescriptor (§28)", () => {
  const bodyA = makeBodyHandle("a");
  const bodyB = makeBodyHandle("b");

  it("accepts a joint between two different bodies", () => {
    expect(() => {
      validateJointDescriptor(
        {
          type: "revolute",
          bodyA,
          bodyB,
          // A hinge in a "3d" world must name its axis (§28, WP-6.1); only a
          // "2d" world has a default. The rest of the §28 matrix lives in
          // `joints.test.ts`.
          axis: new Vector3(0, 0, 1),
          anchorA: new Vector2(0, 0),
          anchorB: new Vector3(0, 1, 0),
        },
        "3d",
      );
    }).not.toThrow();
  });

  it("rejects a joint from a body to itself", () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor({ type: "fixed", bodyA, bodyB: bodyA }, "3d");
      }).message,
    ).toContain("two different bodies");
  });

  it.each(["anchorA", "anchorB"] as const)(
    "applies the §21 plane rule to %s",
    (field) => {
      expect(
        expectFourError(() => {
          validateJointDescriptor(
            { type: "fixed", bodyA, bodyB, [field]: new Vector3(0, 0, 1) },
            "2d",
          );
        }).message,
      ).toContain(field);
    },
  );
});

describe("validatePhysicsWorldOptions (§21, §32, §33, §85)", () => {
  it("accepts a fully specified world", () => {
    expect(() => {
      validatePhysicsWorldOptions({
        dimension: "2d",
        gravity: new Vector2(0, -9.81),
        determinism: "same-runtime",
        sleeping: {
          enabled: true,
          linearThreshold: 0.01,
          angularThreshold: 0.01,
          timeThreshold: 0.5,
        },
      });
    }).not.toThrow();
  });

  it("accepts the bare minimum", () => {
    expect(() => {
      validatePhysicsWorldOptions({ dimension: "3d" });
    }).not.toThrow();
  });

  it("rejects an unknown dimension (§85)", () => {
    expect(
      expectFourError(() => {
        validatePhysicsWorldOptions({
          dimension: "2.5d" as "2d",
        });
      }).message,
    ).toContain("Unknown physics dimension");
  });

  it("rejects a non-finite gravity component", () => {
    expect(
      expectFourError(() => {
        validatePhysicsWorldOptions({
          dimension: "3d",
          gravity: new Vector3(Number.NaN, 0, 0),
        });
      }).message,
    ).toContain("gravity.x");
    expect(
      expectFourError(() => {
        validatePhysicsWorldOptions({
          dimension: "3d",
          gravity: new Vector2(0, Number.NaN),
        });
      }).message,
    ).toContain("gravity.y");
    expect(
      expectFourError(() => {
        validatePhysicsWorldOptions({
          dimension: "3d",
          gravity: new Vector3(0, 0, Number.NaN),
        });
      }).message,
    ).toContain("gravity.z");
  });

  it("rejects a z gravity in a 2d world (§21)", () => {
    expect(
      expectFourError(() => {
        validatePhysicsWorldOptions({
          dimension: "2d",
          gravity: new Vector3(0, 0, -9.81),
        });
      }).message,
    ).toContain("gravity.z must be 0");
  });

  it("rejects an unknown determinism level (§33)", () => {
    expect(
      expectFourError(() => {
        validatePhysicsWorldOptions({
          dimension: "3d",
          determinism: "perfect" as "none",
        });
      }).message,
    ).toContain("Unknown determinism level");
  });

  it.each(["linearThreshold", "angularThreshold", "timeThreshold"] as const)(
    "rejects a negative sleeping.%s (§32)",
    (field) => {
      expect(
        expectFourError(() => {
          validatePhysicsWorldOptions({
            dimension: "3d",
            sleeping: { [field]: -1 },
          });
        }).message,
      ).toContain(`sleeping.${field}`);
    },
  );

  it("accepts a sleeping record that only sets `enabled`", () => {
    expect(() => {
      validatePhysicsWorldOptions({
        dimension: "3d",
        sleeping: { enabled: false },
      });
    }).not.toThrow();
  });
});
