/**
 * Tests for the §113 debug-draw data providers (plan P10-3, WP-10.3).
 *
 * Two things are being checked, and they are different in kind:
 *
 * 1. **The shipped behaviour** — the buffer's exact float layout, its growth
 *    policy, its zero-allocation promise (via `constructionCount()` from
 *    `@four/math`, which counts every math-object construction), and each
 *    provider's exact segment output against scripted fakes.
 * 2. **The seam shapes** — `MirroredSolverBodyAccess` and
 *    `MirroredSolverJointAccess` below are transcribed from
 *    `packages/physics/src/body-access.ts`, and the assignability assertions
 *    fail to compile the day the local duck-typed declarations drift from them.
 *    Same protection, and the same honest limitation, as
 *    `recorder.test.ts`/`ParticleDrawable`: drift is caught at *this* package's
 *    typecheck, not at physics'.
 *
 * The staged items (`DEBUG_DRAW_STAGED`) are asserted as data, not grepped: the
 * point of exporting them is that a consumer can enumerate what the overlay
 * cannot show.
 */

import {
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import { describe, expect, it } from "vitest";

import {
  DEBUG_COLOR_FLOATS_PER_SEGMENT,
  DEBUG_DRAW_DEFAULT_COLORS,
  DEBUG_DRAW_STAGED,
  DEBUG_POSITION_FLOATS_PER_SEGMENT,
  DEBUG_SEGMENT_FLOATS,
  DEBUG_VERTEX_FLOATS,
  DEFAULT_DEBUG_BUFFER_CAPACITY,
  DebugDrawBuffer,
  type DebugBodyAccess,
  type DebugCenterOfMassAccess,
  type DebugColor,
  type DebugDrawStreams,
  type DebugGeometrySink,
  type DebugJointAccess,
  type DebugPhysicsEventLike,
  type SolverJointStatistics,
  type SolverStatistics,
  applyDebugDrawStreams,
  collectBodyOrigins,
  collectBodyVelocities,
  collectCentersOfMass,
  collectContactImpulses,
  collectContactPoints,
  debugDrawStreams,
  solverJointStatistics,
  solverStatistics,
} from "../src/debug-draw.js";

// --- transcribed physics shapes (compile-time mirrors) ----------------------

/** Stand-in for §37's unforgeable `PhysicsBodyHandle` brand. */
interface MirrorBodyHandle {
  readonly __mirror: "body";
}

/** Stand-in for §37's `PhysicsColliderHandle` brand. */
interface MirrorColliderHandle {
  readonly __mirror: "collider";
}

/** Stand-in for §37's `PhysicsJointHandle` brand. */
interface MirrorJointHandle {
  readonly __mirror: "joint";
}

/**
 * The members of `SolverBodyAccess` this package reads, transcribed verbatim
 * from `packages/physics/src/body-access.ts` (signatures, not bodies).
 */
interface MirroredSolverBodyAccess {
  getBodyTransform(
    handle: MirrorBodyHandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void;
  getBodyVelocities(
    handle: MirrorBodyHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void;
  isBodySleeping(handle: MirrorBodyHandle): boolean;
  getBodyCenterOfMass(handle: MirrorBodyHandle, out: Vector3): void;
  forEachBody(visit: (handle: MirrorBodyHandle, id: number) => void): void;
  forEachCollider(
    visit: (handle: MirrorColliderHandle, id: number) => void,
  ): void;
}

/** The members of `SolverJointAccess` this package reads, transcribed. */
interface MirroredSolverJointAccess {
  readonly reportsJointReactions: boolean;
  forEachJoint(visit: (handle: MirrorJointHandle, id: number) => void): void;
}

// --- fakes ------------------------------------------------------------------

interface ScriptedBody {
  readonly handle: MirrorBodyHandle;
  readonly id: number;
  readonly position: readonly [number, number, number];
  readonly linear: readonly [number, number, number];
  readonly angular: readonly [number, number, number];
  readonly sleeping: boolean;
  /** World-space centre of mass; defaults to `position` (a uniform body). */
  readonly com: readonly [number, number, number];
}

function scriptBody(
  id: number,
  position: readonly [number, number, number],
  linear: readonly [number, number, number],
  angular: readonly [number, number, number] = [0, 0, 0],
  sleeping = false,
  com: readonly [number, number, number] = position,
): ScriptedBody {
  return {
    handle: { __mirror: "body" },
    id,
    position,
    linear,
    angular,
    sleeping,
    com,
  };
}

/**
 * A scripted stand-in for a solver's body seam. Visits bodies in the order they
 * were scripted, which is the ascending-id creation order §33 requires, and
 * constructs no math objects (it writes into the `out` parameters it is given).
 */
class FakeBodyAccess implements MirroredSolverBodyAccess {
  readonly reads = { transform: 0, velocities: 0, sleeping: 0, com: 0 };

  constructor(
    private readonly bodies: readonly ScriptedBody[],
    private readonly colliderIds: readonly number[] = [],
  ) {}

  #find(handle: MirrorBodyHandle): ScriptedBody {
    const body = this.bodies.find((candidate) => candidate.handle === handle);
    if (body === undefined) {
      throw new Error("unknown handle");
    }
    return body;
  }

  getBodyTransform(
    handle: MirrorBodyHandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void {
    this.reads.transform += 1;
    const body = this.#find(handle);
    outPosition.x = body.position[0];
    outPosition.y = body.position[1];
    outPosition.z = body.position[2];
    outRotation.x = 0;
    outRotation.y = 0;
    outRotation.z = 0;
    outRotation.w = 1;
  }

  getBodyVelocities(
    handle: MirrorBodyHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void {
    this.reads.velocities += 1;
    const body = this.#find(handle);
    outLinear.x = body.linear[0];
    outLinear.y = body.linear[1];
    outLinear.z = body.linear[2];
    outAngular.x = body.angular[0];
    outAngular.y = body.angular[1];
    outAngular.z = body.angular[2];
  }

  isBodySleeping(handle: MirrorBodyHandle): boolean {
    this.reads.sleeping += 1;
    return this.#find(handle).sleeping;
  }

  getBodyCenterOfMass(handle: MirrorBodyHandle, out: Vector3): void {
    this.reads.com += 1;
    const body = this.#find(handle);
    out.x = body.com[0];
    out.y = body.com[1];
    out.z = body.com[2];
  }

  forEachBody(visit: (handle: MirrorBodyHandle, id: number) => void): void {
    for (const body of this.bodies) {
      visit(body.handle, body.id);
    }
  }

  forEachCollider(
    visit: (handle: MirrorColliderHandle, id: number) => void,
  ): void {
    for (const id of this.colliderIds) {
      visit({ __mirror: "collider" }, id);
    }
  }
}

class FakeJointAccess implements MirroredSolverJointAccess {
  constructor(
    readonly reportsJointReactions: boolean,
    private readonly jointIds: readonly number[],
  ) {}

  forEachJoint(visit: (handle: MirrorJointHandle, id: number) => void): void {
    for (const id of this.jointIds) {
      visit({ __mirror: "joint" }, id);
    }
  }
}

// --- helpers ----------------------------------------------------------------

interface DecodedSegment {
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly colorFrom: readonly [number, number, number, number];
  readonly colorTo: readonly [number, number, number, number];
}

/** Decodes the live floats of a buffer into segments, for exact comparison. */
function decode(buffer: DebugDrawBuffer): DecodedSegment[] {
  const data = buffer.data;
  const out: DecodedSegment[] = [];
  for (let line = 0; line < buffer.lineCount; line += 1) {
    const at = line * DEBUG_SEGMENT_FLOATS;
    out.push({
      from: [data[at], data[at + 1], data[at + 2]],
      colorFrom: [data[at + 3], data[at + 4], data[at + 5], data[at + 6]],
      to: [data[at + 7], data[at + 8], data[at + 9]],
      colorTo: [data[at + 10], data[at + 11], data[at + 12], data[at + 13]],
    });
  }
  return out;
}

const RED: DebugColor = [1, 0, 0, 1];
const BLUE: DebugColor = [0, 0, 1, 1];

function point(
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  return { x, y, z };
}

// --- layout -----------------------------------------------------------------

describe("layout constants", () => {
  it("is a line list of 7-float vertices", () => {
    expect(DEBUG_VERTEX_FLOATS).toBe(7);
    expect(DEBUG_SEGMENT_FLOATS).toBe(14);
    expect(DEBUG_POSITION_FLOATS_PER_SEGMENT).toBe(6);
    expect(DEBUG_COLOR_FLOATS_PER_SEGMENT).toBe(8);
    expect(DEBUG_SEGMENT_FLOATS).toBe(DEBUG_VERTEX_FLOATS * 2);
    // The de-interleave is lossless: the two output streams together hold
    // exactly what one interleaved segment holds.
    expect(
      DEBUG_POSITION_FLOATS_PER_SEGMENT + DEBUG_COLOR_FLOATS_PER_SEGMENT,
    ).toBe(DEBUG_SEGMENT_FLOATS);
  });
});

describe("DebugDrawBuffer.addLine", () => {
  it("writes position then colour for each endpoint", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 2, 3), point(4, 5, 6), RED);

    expect(buffer.lineCount).toBe(1);
    expect(buffer.floatLength).toBe(14);
    expect(Array.from(buffer.segments())).toEqual([
      1, 2, 3, 1, 0, 0, 1, 4, 5, 6, 1, 0, 0, 1,
    ]);
  });

  it("gives both endpoints the same colour", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(0, 0, 0), point(1, 1, 1), BLUE);
    const [segment] = decode(buffer);
    expect(segment.colorFrom).toEqual([0, 0, 1, 1]);
    expect(segment.colorTo).toEqual([0, 0, 1, 1]);
  });

  it("stores non-finite coordinates rather than throwing (the defect is the data)", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(
      point(Number.NaN, 0, 0),
      point(0, Number.POSITIVE_INFINITY, 0),
      RED,
    );
    const [segment] = decode(buffer);
    expect(Number.isNaN(segment.from[0])).toBe(true);
    expect(segment.to[1]).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("DebugDrawBuffer.addVector", () => {
  it("runs from the origin to origin + vector * scale", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addVector(point(1, 1, 0), point(2, -4, 0), 0.5, RED);
    expect(decode(buffer)).toEqual([
      {
        from: [1, 1, 0],
        to: [2, -1, 0],
        colorFrom: [1, 0, 0, 1],
        colorTo: [1, 0, 0, 1],
      },
    ]);
  });

  it("rejects a non-finite scale", () => {
    const buffer = new DebugDrawBuffer();
    expect(() => {
      buffer.addVector(point(0, 0, 0), point(1, 0, 0), Number.NaN, RED);
    }).toThrow(RangeError);
    expect(buffer.lineCount).toBe(0);
  });
});

describe("DebugDrawBuffer.addCross / addPoint", () => {
  it("emits three axis-aligned arms in X, Y, Z order", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addCross(point(1, 2, 3), 0.5, RED);

    expect(buffer.lineCount).toBe(3);
    expect(decode(buffer).map((segment) => [segment.from, segment.to])).toEqual(
      [
        [
          [0.5, 2, 3],
          [1.5, 2, 3],
        ],
        [
          [1, 1.5, 3],
          [1, 2.5, 3],
        ],
        [
          [1, 2, 2.5],
          [1, 2, 3.5],
        ],
      ],
    );
  });

  it("draws addPoint identically to addCross", () => {
    const a = new DebugDrawBuffer();
    const b = new DebugDrawBuffer();
    a.addCross(point(-1, 0, 2), 0.25, BLUE);
    b.addPoint(point(-1, 0, 2), 0.25, BLUE);
    expect(Array.from(b.segments())).toEqual(Array.from(a.segments()));
  });

  it("rejects a non-positive size", () => {
    const buffer = new DebugDrawBuffer();
    expect(() => {
      buffer.addCross(point(0, 0, 0), 0, RED);
    }).toThrow(RangeError);
    expect(() => {
      buffer.addCross(point(0, 0, 0), -1, RED);
    }).toThrow(RangeError);
  });
});

// --- growth and clear -------------------------------------------------------

describe("growth", () => {
  it("defaults to DEFAULT_DEBUG_BUFFER_CAPACITY segments", () => {
    const buffer = new DebugDrawBuffer();
    expect(buffer.capacity).toBe(DEFAULT_DEBUG_BUFFER_CAPACITY);
    expect(buffer.data.length).toBe(
      DEFAULT_DEBUG_BUFFER_CAPACITY * DEBUG_SEGMENT_FLOATS,
    );
  });

  it("doubles on overflow and preserves everything already written", () => {
    const buffer = new DebugDrawBuffer({ initialCapacity: 2 });
    buffer.addLine(point(0, 0, 0), point(1, 0, 0), RED);
    buffer.addLine(point(0, 1, 0), point(1, 1, 0), RED);
    expect(buffer.capacity).toBe(2);

    buffer.addLine(point(0, 2, 0), point(1, 2, 0), BLUE);
    expect(buffer.capacity).toBe(4);
    expect(buffer.lineCount).toBe(3);
    expect(decode(buffer).map((segment) => segment.from)).toEqual([
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0],
    ]);

    for (let i = 0; i < 5; i += 1) {
      buffer.addLine(point(i, 0, 0), point(i, 1, 0), RED);
    }
    expect(buffer.lineCount).toBe(8);
    expect(buffer.capacity).toBe(8);
  });

  it("keeps its capacity across clear()", () => {
    const buffer = new DebugDrawBuffer({ initialCapacity: 1 });
    buffer.addLine(point(0, 0, 0), point(1, 0, 0), RED);
    buffer.addLine(point(0, 0, 0), point(2, 0, 0), RED);
    expect(buffer.capacity).toBe(2);

    buffer.clear();
    expect(buffer.lineCount).toBe(0);
    expect(buffer.floatLength).toBe(0);
    expect(buffer.segments().length).toBe(0);
    expect(buffer.capacity).toBe(2);
  });

  it("rejects a non-positive-integer initial capacity", () => {
    expect(() => new DebugDrawBuffer({ initialCapacity: 0 })).toThrow(
      RangeError,
    );
    expect(() => new DebugDrawBuffer({ initialCapacity: 1.5 })).toThrow(
      RangeError,
    );
  });

  it("allocates nothing once the capacity is warm", () => {
    const buffer = new DebugDrawBuffer({ initialCapacity: 4 });
    for (let i = 0; i < 4; i += 1) {
      buffer.addLine(point(i, 0, 0), point(i, 1, 0), RED);
    }
    const warm = buffer.data;
    buffer.clear();

    for (let i = 0; i < 4; i += 1) {
      buffer.addVector(point(i, 0, 0), point(0, 1, 0), 2, RED);
    }
    // Same backing store object: no reallocation happened.
    expect(buffer.data).toBe(warm);
  });
});

// --- writePositions ---------------------------------------------------------

describe("writePositions", () => {
  it("writes 6 floats per segment in segment order", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 2, 3), point(4, 5, 6), RED);
    buffer.addLine(point(7, 8, 9), point(10, 11, 12), BLUE);

    const out = new Float32Array(12);
    expect(buffer.writePositions(out)).toBe(12);
    expect(buffer.positionFloatLength).toBe(12);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("honours an offset and leaves the rest of the destination untouched", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 0, 0), point(2, 0, 0), RED);

    const out = new Float32Array(9).fill(-1);
    expect(buffer.writePositions(out, 3)).toBe(6);
    expect(Array.from(out)).toEqual([-1, -1, -1, 1, 0, 0, 2, 0, 0]);
  });

  it("throws when the destination is too small or the offset is invalid", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(0, 0, 0), point(1, 0, 0), RED);
    expect(() => buffer.writePositions(new Float32Array(5))).toThrow(
      RangeError,
    );
    expect(() => buffer.writePositions(new Float32Array(6), 1)).toThrow(
      RangeError,
    );
    expect(() => buffer.writePositions(new Float32Array(6), -1)).toThrow(
      RangeError,
    );
  });

  it("writes nothing for an empty buffer", () => {
    const buffer = new DebugDrawBuffer();
    const out = new Float32Array(0);
    expect(buffer.writePositions(out)).toBe(0);
  });
});

describe("writePositionsForColor", () => {
  it("selects only the segments carrying the colour, in order", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 0, 0), point(2, 0, 0), RED);
    buffer.addLine(point(3, 0, 0), point(4, 0, 0), BLUE);
    buffer.addLine(point(5, 0, 0), point(6, 0, 0), RED);

    const out = new Float32Array(12);
    expect(buffer.writePositionsForColor(out, RED)).toBe(12);
    expect(Array.from(out)).toEqual([1, 0, 0, 2, 0, 0, 5, 0, 0, 6, 0, 0]);

    const blue = new Float32Array(6);
    expect(buffer.writePositionsForColor(blue, BLUE)).toBe(6);
    expect(Array.from(blue)).toEqual([3, 0, 0, 4, 0, 0]);
  });

  it("writes nothing when no segment matches", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 0, 0), point(2, 0, 0), RED);
    const out = new Float32Array(6).fill(-1);
    expect(buffer.writePositionsForColor(out, BLUE)).toBe(0);
    expect(Array.from(out)).toEqual([-1, -1, -1, -1, -1, -1]);
  });

  it("throws when the matching segments do not fit", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 0, 0), point(2, 0, 0), RED);
    expect(() =>
      buffer.writePositionsForColor(new Float32Array(5), RED),
    ).toThrow(RangeError);
    expect(() =>
      buffer.writePositionsForColor(new Float32Array(6), RED, -1),
    ).toThrow(RangeError);
  });
});

// --- writeColors ------------------------------------------------------------

describe("writeColors", () => {
  it("writes 8 floats per segment — the colour of each endpoint, in order", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 2, 3), point(4, 5, 6), RED);
    buffer.addLine(point(7, 8, 9), point(10, 11, 12), BLUE);

    const out = new Float32Array(16);
    expect(buffer.writeColors(out)).toBe(16);
    expect(buffer.colorFloatLength).toBe(16);
    // Both endpoints of a segment carry that segment's colour: the "expansion"
    // §60a needs for a per-vertex attribute is already in the buffer's layout,
    // so this is a copy, not a broadcast.
    expect(Array.from(out)).toEqual([
      1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1,
    ]);
  });

  it("copies each endpoint's own colour, so a gradient segment survives", () => {
    // Nothing in the public API writes two different endpoint colours today,
    // but the layout allows it and this method must not collapse them — the
    // module header promises gradients need no layout change.
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(0, 0, 0), point(1, 0, 0), RED);
    buffer.data[10] = 0;
    buffer.data[11] = 1;
    buffer.data[12] = 0;
    buffer.data[13] = 0.5;

    const out = new Float32Array(8);
    buffer.writeColors(out);
    expect(Array.from(out)).toEqual([1, 0, 0, 1, 0, 1, 0, 0.5]);
  });

  it("honours an offset and leaves the rest of the destination untouched", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(0, 0, 0), point(1, 0, 0), RED);

    const out = new Float32Array(10).fill(-1);
    expect(buffer.writeColors(out, 2)).toBe(8);
    expect(Array.from(out)).toEqual([-1, -1, 1, 0, 0, 1, 1, 0, 0, 1]);
  });

  it("throws when the destination is too small or the offset is invalid", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(0, 0, 0), point(1, 0, 0), RED);
    expect(() => buffer.writeColors(new Float32Array(7))).toThrow(RangeError);
    expect(() => buffer.writeColors(new Float32Array(8), 1)).toThrow(
      RangeError,
    );
    expect(() => buffer.writeColors(new Float32Array(8), -1)).toThrow(
      RangeError,
    );
    expect(() => buffer.writeColors(new Float32Array(8), 1.5)).toThrow(
      RangeError,
    );
  });

  it("writes nothing for an empty buffer", () => {
    const buffer = new DebugDrawBuffer();
    expect(buffer.writeColors(new Float32Array(0))).toBe(0);
    expect(buffer.colorFloatLength).toBe(0);
  });

  it("ignores segments dropped by clear(), like writePositions", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(0, 0, 0), point(1, 0, 0), RED);
    buffer.clear();
    const out = new Float32Array(8).fill(-1);
    expect(buffer.writeColors(out)).toBe(0);
    expect(Array.from(out)).toEqual([-1, -1, -1, -1, -1, -1, -1, -1]);
  });
});

// --- debugDrawStreams (R-35) ------------------------------------------------

/**
 * A stand-in for `BufferGeometry` with the three members
 * {@link DebugGeometrySink} names, plus the one rule that makes the assignment
 * *order* in `applyDebugDrawStreams` load-bearing: assigning `positions` while
 * colours of a different vertex count are attached throws, exactly as §85's
 * index-alignment check does in `packages/geometry/src/buffer-geometry.ts`.
 *
 * This is the seam's honest cost, same as `DebugBodyAccess`: nothing
 * type-checks it against the real class, so this fake mirrors the *semantics*
 * and the tests fail if the rule changes.
 */
class FakeGeometry implements DebugGeometrySink {
  #positions: Float32Array;

  #colors: Float32Array | undefined;

  version = 0;

  constructor(positions = new Float32Array(0)) {
    this.#positions = positions;
  }

  get positions(): Float32Array {
    return this.#positions;
  }

  set positions(value: Float32Array) {
    if (
      this.#colors !== undefined &&
      this.#colors.length !== (value.length / 3) * 4
    ) {
      throw new RangeError("colors are not index-aligned with positions (§85)");
    }
    this.#positions = value;
    this.version += 1;
  }

  get colors(): Float32Array | undefined {
    return this.#colors;
  }

  set colors(value: Float32Array | undefined) {
    if (
      value !== undefined &&
      value.length !== (this.#positions.length / 3) * 4
    ) {
      throw new RangeError("colors are not index-aligned with positions (§85)");
    }
    this.#colors = value;
    this.version += 1;
  }

  markDirty(): void {
    this.version += 1;
  }
}

describe("debugDrawStreams", () => {
  it("de-interleaves into exactly-sized positions and colors", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 2, 3), point(4, 5, 6), RED);
    buffer.addLine(point(7, 8, 9), point(10, 11, 12), BLUE);

    const streams = debugDrawStreams(buffer);

    expect(streams.segmentCount).toBe(2);
    expect(streams.vertexCount).toBe(4);
    expect(streams.resized).toBe(true);
    // Exactly sized, not merely large enough: BufferGeometry rejects a slack
    // tail, because `colors.length` must be four floats per position vertex.
    expect(streams.positions.length).toBe(12);
    expect(streams.colors.length).toBe(16);
    expect(streams.colors.length).toBe((streams.positions.length / 3) * 4);
    expect(Array.from(streams.positions)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(Array.from(streams.colors)).toEqual([
      1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1,
    ]);
  });

  it("agrees with writePositions / writeColors — it is the same packing", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addCross(point(1, 1, 1), 0.5, RED);
    buffer.addVector(point(0, 0, 0), point(0, 2, 0), 0.5, BLUE);

    const streams = debugDrawStreams(buffer);
    const positions = new Float32Array(buffer.positionFloatLength);
    const colors = new Float32Array(buffer.colorFloatLength);
    buffer.writePositions(positions);
    buffer.writeColors(colors);

    expect(Array.from(streams.positions)).toEqual(Array.from(positions));
    expect(Array.from(streams.colors)).toEqual(Array.from(colors));
    expect(streams.segmentCount).toBe(4);
  });

  it("reuses the arrays in place while the segment count holds (§7b)", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 0, 0), point(2, 0, 0), RED);
    const streams = debugDrawStreams(buffer);
    const positions = streams.positions;
    const colors = streams.colors;

    // A second frame with the same number of segments but new values.
    buffer.clear();
    buffer.addLine(point(9, 0, 0), point(8, 0, 0), BLUE);
    const again = debugDrawStreams(buffer, streams);

    expect(again).toBe(streams);
    expect(again.positions).toBe(positions);
    expect(again.colors).toBe(colors);
    expect(again.resized).toBe(false);
    expect(Array.from(positions)).toEqual([9, 0, 0, 8, 0, 0]);
    expect(Array.from(colors)).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
  });

  it("replaces the arrays when the segment count moves, and says so", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 0, 0), point(2, 0, 0), RED);
    const streams = debugDrawStreams(buffer);
    const positions = streams.positions;

    buffer.addLine(point(3, 0, 0), point(4, 0, 0), BLUE);
    debugDrawStreams(buffer, streams);

    expect(streams.resized).toBe(true);
    expect(streams.positions).not.toBe(positions);
    expect(streams.positions.length).toBe(12);
    expect(streams.colors.length).toBe(16);
    expect(streams.segmentCount).toBe(2);

    // …and back down again.
    buffer.clear();
    buffer.addLine(point(5, 0, 0), point(6, 0, 0), RED);
    debugDrawStreams(buffer, streams);
    expect(streams.resized).toBe(true);
    expect(streams.positions.length).toBe(6);
    expect(streams.colors.length).toBe(8);
  });

  it("yields two empty arrays for an empty buffer", () => {
    const buffer = new DebugDrawBuffer();
    const streams = debugDrawStreams(buffer);

    expect(streams.segmentCount).toBe(0);
    expect(streams.vertexCount).toBe(0);
    expect(streams.positions.length).toBe(0);
    expect(streams.colors.length).toBe(0);
    // An overlay with nothing to draw needs no special case: a zero-vertex
    // "lines" geometry is legal and draws nothing.
    expect(streams.resized).toBe(true);

    // Clearing back to empty from a non-empty frame reuses the record.
    buffer.addLine(point(0, 0, 0), point(1, 0, 0), RED);
    debugDrawStreams(buffer, streams);
    buffer.clear();
    debugDrawStreams(buffer, streams);
    expect(streams.positions.length).toBe(0);
    expect(streams.colors.length).toBe(0);
    expect(streams.segmentCount).toBe(0);
  });

  it("re-packs a hand-built record with mismatched arrays", () => {
    // `out` is a plain record, so a caller can mint one; a wrong-sized array in
    // it must be replaced rather than written past.
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 0, 0), point(2, 0, 0), RED);
    const hand: DebugDrawStreams = {
      positions: new Float32Array(3),
      colors: new Float32Array(99),
      segmentCount: 42,
      vertexCount: 84,
      resized: false,
    };

    debugDrawStreams(buffer, hand);

    expect(hand.resized).toBe(true);
    expect(hand.positions.length).toBe(6);
    expect(hand.colors.length).toBe(8);
    expect(hand.segmentCount).toBe(1);
    expect(hand.vertexCount).toBe(2);
  });

  it("allocates no arrays per frame once the count is steady", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(0, 0, 0), point(1, 0, 0), RED);
    const streams = debugDrawStreams(buffer);
    const positions = streams.positions;
    const colors = streams.colors;

    for (let frame = 0; frame < 10; frame += 1) {
      buffer.clear();
      buffer.addLine(point(frame, 0, 0), point(frame + 1, 0, 0), RED);
      debugDrawStreams(buffer, streams);
      expect(streams.positions).toBe(positions);
      expect(streams.colors).toBe(colors);
    }
  });
});

describe("applyDebugDrawStreams", () => {
  it("points a geometry at the streams on the first call", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 0, 0), point(2, 0, 0), RED);
    const streams = debugDrawStreams(buffer);
    const geometry = new FakeGeometry();

    applyDebugDrawStreams(streams, geometry);

    expect(geometry.positions).toBe(streams.positions);
    expect(geometry.colors).toBe(streams.colors);
  });

  it("only bumps the version when the arrays were rewritten in place", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 0, 0), point(2, 0, 0), RED);
    const streams = debugDrawStreams(buffer);
    const geometry = new FakeGeometry();
    applyDebugDrawStreams(streams, geometry);
    const version = geometry.version;

    buffer.clear();
    buffer.addLine(point(3, 0, 0), point(4, 0, 0), BLUE);
    debugDrawStreams(buffer, streams);
    applyDebugDrawStreams(streams, geometry);

    // One version bump — the markDirty path, no revalidation, no re-pointing.
    expect(geometry.version).toBe(version + 1);
    expect(geometry.positions).toBe(streams.positions);
    expect(Array.from(geometry.positions)).toEqual([3, 0, 0, 4, 0, 0]);
  });

  it("survives a shrinking segment count — the order the §85 check forces", () => {
    // Assigning shorter positions while the longer colours are still attached
    // throws; dropping the colours first is the only order that works.
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 0, 0), point(2, 0, 0), RED);
    buffer.addLine(point(3, 0, 0), point(4, 0, 0), BLUE);
    const streams = debugDrawStreams(buffer);
    const geometry = new FakeGeometry();
    applyDebugDrawStreams(streams, geometry);
    expect(geometry.colors?.length).toBe(16);

    buffer.clear();
    buffer.addLine(point(5, 0, 0), point(6, 0, 0), RED);
    debugDrawStreams(buffer, streams);
    expect(() => {
      applyDebugDrawStreams(streams, geometry);
    }).not.toThrow();
    expect(geometry.positions.length).toBe(6);
    expect(geometry.colors?.length).toBe(8);

    // The naive order is what this is protecting against.
    const naive = new FakeGeometry(new Float32Array(12));
    naive.colors = new Float32Array(16);
    expect(() => {
      naive.positions = new Float32Array(6);
    }).toThrow(RangeError);
  });

  it("re-points a geometry that was pointed elsewhere, even without a resize", () => {
    const buffer = new DebugDrawBuffer();
    buffer.addLine(point(1, 0, 0), point(2, 0, 0), RED);
    const streams = debugDrawStreams(buffer);
    const geometry = new FakeGeometry();
    applyDebugDrawStreams(streams, geometry);

    // A second frame at the same count leaves `resized` false…
    buffer.clear();
    buffer.addLine(point(3, 0, 0), point(4, 0, 0), RED);
    debugDrawStreams(buffer, streams);
    expect(streams.resized).toBe(false);
    // …but a *different* geometry has never seen these arrays, and the
    // identity check is what catches that rather than silently marking a
    // stranger dirty.
    const other = new FakeGeometry();
    applyDebugDrawStreams(streams, other);
    expect(other.positions).toBe(streams.positions);
    expect(other.colors).toBe(streams.colors);
  });

  it("drives an empty overlay without throwing", () => {
    const buffer = new DebugDrawBuffer();
    const streams = debugDrawStreams(buffer);
    const geometry = new FakeGeometry();
    applyDebugDrawStreams(streams, geometry);
    expect(geometry.positions.length).toBe(0);
    expect(geometry.colors?.length).toBe(0);
  });
});

// --- seam mirrors -----------------------------------------------------------

describe("duck-typed seams", () => {
  it("accepts a SolverBodyAccess-shaped object", () => {
    const mirrored: MirroredSolverBodyAccess = new FakeBodyAccess([]);
    // The assignment is the assertion: it stops compiling if DebugBodyAccess
    // ever asks for a member SolverBodyAccess does not have.
    const access: DebugBodyAccess<MirrorBodyHandle> = mirrored;
    expect(typeof access.forEachBody).toBe("function");
    expect(typeof access.getBodyTransform).toBe("function");
    expect(typeof access.getBodyVelocities).toBe("function");
    expect(typeof access.isBodySleeping).toBe("function");
    expect(typeof access.forEachCollider).toBe("function");
    // Same assertion for the centre-of-mass extension (2026-08-04).
    const comAccess: DebugCenterOfMassAccess<MirrorBodyHandle> = mirrored;
    expect(typeof comAccess.getBodyCenterOfMass).toBe("function");
  });

  it("accepts a SolverJointAccess-shaped object", () => {
    const mirrored: MirroredSolverJointAccess = new FakeJointAccess(false, []);
    const access: DebugJointAccess<MirrorJointHandle> = mirrored;
    expect(access.reportsJointReactions).toBe(false);
    expect(typeof access.forEachJoint).toBe("function");
  });
});

// --- providers --------------------------------------------------------------

describe("collectBodyVelocities", () => {
  const bodies = [
    scriptBody(1, [0, 0, 0], [3, 0, 0]),
    scriptBody(2, [1, 2, 0], [0, -4, 0], [0, 0, 2]),
  ];

  it("emits one segment per body, in body order, scaled by seconds", () => {
    const buffer = new DebugDrawBuffer();
    const added = collectBodyVelocities(new FakeBodyAccess(bodies), buffer, {
      scale: 0.5,
      color: RED,
    });

    expect(added).toBe(2);
    expect(decode(buffer)).toEqual([
      {
        from: [0, 0, 0],
        to: [1.5, 0, 0],
        colorFrom: [1, 0, 0, 1],
        colorTo: [1, 0, 0, 1],
      },
      {
        from: [1, 2, 0],
        to: [1, 0, 0],
        colorFrom: [1, 0, 0, 1],
        colorTo: [1, 0, 0, 1],
      },
    ]);
  });

  it("defaults to scale 1 and the velocity colour", () => {
    const buffer = new DebugDrawBuffer();
    collectBodyVelocities(new FakeBodyAccess([bodies[0]]), buffer);
    const [segment] = decode(buffer);
    expect(segment.to).toEqual([3, 0, 0]);
    expect(segment.colorFrom).toEqual([...DEBUG_DRAW_DEFAULT_COLORS.velocity]);
  });

  it("adds the angular vector only when asked", () => {
    const buffer = new DebugDrawBuffer();
    const added = collectBodyVelocities(
      new FakeBodyAccess([bodies[1]]),
      buffer,
      {
        scale: 1,
        color: RED,
        includeAngular: true,
        angularColor: BLUE,
      },
    );

    expect(added).toBe(2);
    expect(decode(buffer)[1]).toEqual({
      from: [1, 2, 0],
      to: [1, 2, 2],
      colorFrom: [0, 0, 1, 1],
      colorTo: [0, 0, 1, 1],
    });
  });

  it("skips sleeping bodies on request, and reads sleep state only then", () => {
    const scripted = [
      scriptBody(1, [0, 0, 0], [1, 0, 0]),
      scriptBody(2, [5, 0, 0], [0, 0, 0], [0, 0, 0], true),
    ];

    const quiet = new FakeBodyAccess(scripted);
    const buffer = new DebugDrawBuffer();
    expect(collectBodyVelocities(quiet, buffer)).toBe(2);
    expect(quiet.reads.sleeping).toBe(0);

    const filtered = new FakeBodyAccess(scripted);
    const only = new DebugDrawBuffer();
    expect(collectBodyVelocities(filtered, only, { skipSleeping: true })).toBe(
      1,
    );
    expect(filtered.reads.sleeping).toBe(2);
    expect(decode(only)[0].from).toEqual([0, 0, 0]);
  });

  it("rejects a non-finite scale before touching the buffer", () => {
    const buffer = new DebugDrawBuffer();
    expect(() =>
      collectBodyVelocities(new FakeBodyAccess(bodies), buffer, {
        scale: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(RangeError);
    expect(buffer.lineCount).toBe(0);
  });
});

describe("collectBodyOrigins", () => {
  it("emits a three-segment cross per body at the transform origin", () => {
    const buffer = new DebugDrawBuffer();
    const added = collectBodyOrigins(
      new FakeBodyAccess([scriptBody(1, [2, 0, 0], [0, 0, 0])]),
      buffer,
      { size: 1, color: RED },
    );

    expect(added).toBe(3);
    expect(buffer.lineCount).toBe(3);
    expect(decode(buffer).map((segment) => [segment.from, segment.to])).toEqual(
      [
        [
          [1, 0, 0],
          [3, 0, 0],
        ],
        [
          [2, -1, 0],
          [2, 1, 0],
        ],
        [
          [2, 0, -1],
          [2, 0, 1],
        ],
      ],
    );
  });

  it("defaults to a 0.1 half-extent and the origin colour", () => {
    const buffer = new DebugDrawBuffer();
    collectBodyOrigins(
      new FakeBodyAccess([scriptBody(1, [0, 0, 0], [0, 0, 0])]),
      buffer,
    );
    const [xArm] = decode(buffer);
    expect(xArm.from[0]).toBeCloseTo(-0.1, 6);
    expect(xArm.colorFrom).toEqual([...DEBUG_DRAW_DEFAULT_COLORS.origin]);
  });

  it("colours sleeping bodies separately when a sleeping colour is given", () => {
    const buffer = new DebugDrawBuffer();
    const access = new FakeBodyAccess([
      scriptBody(1, [0, 0, 0], [0, 0, 0]),
      scriptBody(2, [1, 0, 0], [0, 0, 0], [0, 0, 0], true),
    ]);
    collectBodyOrigins(access, buffer, {
      size: 1,
      color: RED,
      sleepingColor: BLUE,
    });

    const segments = decode(buffer);
    expect(segments).toHaveLength(6);
    expect(segments[0].colorFrom).toEqual([1, 0, 0, 1]);
    expect(segments[3].colorFrom).toEqual([0, 0, 1, 1]);
  });

  it("skips sleeping bodies on request", () => {
    const buffer = new DebugDrawBuffer();
    const added = collectBodyOrigins(
      new FakeBodyAccess([
        scriptBody(1, [0, 0, 0], [0, 0, 0], [0, 0, 0], true),
        scriptBody(2, [1, 0, 0], [0, 0, 0]),
      ]),
      buffer,
      { size: 1, skipSleeping: true },
    );
    expect(added).toBe(3);
    expect(decode(buffer)[0].from).toEqual([0, 0, 0]);
    expect(decode(buffer)[1].from).toEqual([1, -1, 0]);
  });
});

describe("collectCentersOfMass", () => {
  it("crosses the centre of mass, not the origin, for an off-centre body", () => {
    const buffer = new DebugDrawBuffer();
    const added = collectCentersOfMass(
      new FakeBodyAccess([
        scriptBody(1, [2, 0, 0], [0, 0, 0], [0, 0, 0], false, [2.5, 0.25, 0]),
      ]),
      buffer,
      { size: 1, color: RED },
    );

    expect(added).toBe(3);
    expect(decode(buffer).map((segment) => [segment.from, segment.to])).toEqual(
      [
        [
          [1.5, 0.25, 0],
          [3.5, 0.25, 0],
        ],
        [
          [2.5, -0.75, 0],
          [2.5, 1.25, 0],
        ],
        [
          [2.5, 0.25, -1],
          [2.5, 0.25, 1],
        ],
      ],
    );
  });

  it("defaults to a 0.1 half-extent and the centre-of-mass colour", () => {
    const buffer = new DebugDrawBuffer();
    collectCentersOfMass(
      new FakeBodyAccess([scriptBody(1, [0, 0, 0], [0, 0, 0])]),
      buffer,
    );
    const [xArm] = decode(buffer);
    expect(xArm.from[0]).toBeCloseTo(-0.1, 6);
    expect(xArm.colorFrom).toEqual([...DEBUG_DRAW_DEFAULT_COLORS.centerOfMass]);
  });

  it("colours sleeping bodies separately when a sleeping colour is given", () => {
    const buffer = new DebugDrawBuffer();
    const access = new FakeBodyAccess([
      scriptBody(1, [0, 0, 0], [0, 0, 0]),
      scriptBody(2, [1, 0, 0], [0, 0, 0], [0, 0, 0], true),
    ]);
    collectCentersOfMass(access, buffer, {
      size: 1,
      color: RED,
      sleepingColor: BLUE,
    });

    const segments = decode(buffer);
    expect(segments).toHaveLength(6);
    expect(segments[0].colorFrom).toEqual([1, 0, 0, 1]);
    expect(segments[3].colorFrom).toEqual([0, 0, 1, 1]);
  });

  it("skips sleeping bodies on request, without reading their centre", () => {
    const buffer = new DebugDrawBuffer();
    const access = new FakeBodyAccess([
      scriptBody(1, [0, 0, 0], [0, 0, 0], [0, 0, 0], true),
      scriptBody(2, [1, 0, 0], [0, 0, 0], [0, 0, 0], false, [1.5, 0, 0]),
    ]);
    const added = collectCentersOfMass(access, buffer, {
      size: 1,
      skipSleeping: true,
    });
    expect(added).toBe(3);
    expect(access.reads.com).toBe(1);
    expect(decode(buffer)[0].from).toEqual([0.5, 0, 0]);
  });
});

// --- contact events ---------------------------------------------------------

function contact(
  pointOnA: readonly [number, number, number],
  normal: readonly [number, number, number],
  impulse = 0,
  pointOnB: readonly [number, number, number] = pointOnA,
): {
  pointOnA: { x: number; y: number; z: number };
  pointOnB: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  separation: number;
  impulse: number;
} {
  return {
    pointOnA: point(pointOnA[0], pointOnA[1], pointOnA[2]),
    pointOnB: point(pointOnB[0], pointOnB[1], pointOnB[2]),
    normal: point(normal[0], normal[1], normal[2]),
    separation: -0.01,
    impulse,
  };
}

describe("collectContactPoints", () => {
  it("emits a cross per contact plus the normal", () => {
    const events: DebugPhysicsEventLike[] = [
      {
        type: "collisionstart",
        contacts: [contact([0, 0, 0], [0, 1, 0])],
      },
    ];

    const buffer = new DebugDrawBuffer();
    const added = collectContactPoints(events, buffer, {
      size: 1,
      color: RED,
      normalScale: 2,
      normalColor: BLUE,
    });

    expect(added).toBe(4);
    const segments = decode(buffer);
    expect(segments.map((segment) => [segment.from, segment.to])).toEqual([
      [
        [-1, 0, 0],
        [1, 0, 0],
      ],
      [
        [0, -1, 0],
        [0, 1, 0],
      ],
      [
        [0, 0, -1],
        [0, 0, 1],
      ],
      [
        [0, 0, 0],
        [0, 2, 0],
      ],
    ]);
    expect(segments[3].colorFrom).toEqual([0, 0, 1, 1]);
  });

  it("draws no normal when normalScale is 0", () => {
    const buffer = new DebugDrawBuffer();
    const added = collectContactPoints(
      [{ type: "collisionstay", contacts: [contact([0, 0, 0], [1, 0, 0])] }],
      buffer,
      { size: 1, normalScale: 0 },
    );
    expect(added).toBe(3);
  });

  it("marks pointOnB only when asked", () => {
    const events: DebugPhysicsEventLike[] = [
      {
        type: "collisionstart",
        contacts: [contact([0, 0, 0], [0, 1, 0], 0, [0, 0.5, 0])],
      },
    ];

    const buffer = new DebugDrawBuffer();
    const added = collectContactPoints(events, buffer, {
      size: 1,
      normalScale: 0,
      includePointOnB: true,
    });
    expect(added).toBe(6);
    expect(decode(buffer)[3].from).toEqual([-1, 0.5, 0]);
  });

  it("skips events with no manifold and contributes nothing for collisionend", () => {
    const events: DebugPhysicsEventLike[] = [
      { type: "triggerenter" },
      { type: "sleep" },
      { type: "jointbreak" },
      { type: "collisionend", contacts: [] },
      { type: "collisionstart", contacts: [contact([1, 1, 1], [0, 1, 0])] },
    ];

    const buffer = new DebugDrawBuffer();
    const added = collectContactPoints(events, buffer, {
      size: 1,
      normalScale: 0,
    });
    expect(added).toBe(3);
    expect(decode(buffer)[0].from).toEqual([0, 1, 1]);
  });

  it("uses the contact and normal default colours", () => {
    const buffer = new DebugDrawBuffer();
    collectContactPoints(
      [{ type: "collisionstart", contacts: [contact([0, 0, 0], [0, 1, 0])] }],
      buffer,
    );
    const segments = decode(buffer);
    expect(segments[0].colorFrom).toEqual([
      ...DEBUG_DRAW_DEFAULT_COLORS.contact,
    ]);
    expect(segments[3].colorFrom).toEqual([
      ...DEBUG_DRAW_DEFAULT_COLORS.contactNormal,
    ]);
  });
});

describe("collectContactImpulses", () => {
  const events: DebugPhysicsEventLike[] = [
    {
      type: "collisionstart",
      contacts: [
        contact([0, 0, 0], [0, 1, 0], 4),
        contact([1, 0, 0], [0, 1, 0], 0),
      ],
    },
  ];

  it("scales the normal by the contact impulse", () => {
    const buffer = new DebugDrawBuffer();
    const added = collectContactImpulses(events, buffer, {
      scale: 0.25,
      color: RED,
    });

    expect(added).toBe(1);
    expect(decode(buffer)).toEqual([
      {
        from: [0, 0, 0],
        to: [0, 1, 0],
        colorFrom: [1, 0, 0, 1],
        colorTo: [1, 0, 0, 1],
      },
    ]);
  });

  it("keeps zero-impulse contacts when skipZero is false", () => {
    const buffer = new DebugDrawBuffer();
    const added = collectContactImpulses(events, buffer, { skipZero: false });
    expect(added).toBe(2);
    expect(decode(buffer)[1]).toEqual({
      from: [1, 0, 0],
      to: [1, 0, 0],
      colorFrom: [...DEBUG_DRAW_DEFAULT_COLORS.contactImpulse],
      colorTo: [...DEBUG_DRAW_DEFAULT_COLORS.contactImpulse],
    });
  });

  it("skips events without a manifold", () => {
    const buffer = new DebugDrawBuffer();
    expect(collectContactImpulses([{ type: "sleep" }], buffer)).toBe(0);
  });
});

// --- statistics -------------------------------------------------------------

describe("solverStatistics", () => {
  it("counts bodies, sleepers, colliders and the highest id", () => {
    const access = new FakeBodyAccess(
      [
        scriptBody(1, [0, 0, 0], [0, 0, 0]),
        scriptBody(4, [0, 0, 0], [0, 0, 0], [0, 0, 0], true),
        scriptBody(9, [0, 0, 0], [0, 0, 0], [0, 0, 0], true),
      ],
      [1, 2, 3, 4],
    );

    expect(solverStatistics(access)).toEqual({
      bodyCount: 3,
      sleepingCount: 2,
      awakeCount: 1,
      colliderCount: 4,
      maxBodyId: 9,
    });
  });

  it("reports -1 as the highest id of an empty world", () => {
    expect(solverStatistics(new FakeBodyAccess([]))).toEqual({
      bodyCount: 0,
      sleepingCount: 0,
      awakeCount: 0,
      colliderCount: 0,
      maxBodyId: -1,
    });
  });

  it("reuses an out record and resets every field", () => {
    const out: SolverStatistics = {
      bodyCount: 99,
      sleepingCount: 99,
      awakeCount: 99,
      colliderCount: 99,
      maxBodyId: 99,
    };
    const result = solverStatistics(
      new FakeBodyAccess([scriptBody(2, [0, 0, 0], [0, 0, 0])], [7]),
      out,
    );

    expect(result).toBe(out);
    expect(out).toEqual({
      bodyCount: 1,
      sleepingCount: 0,
      awakeCount: 1,
      colliderCount: 1,
      maxBodyId: 2,
    });
  });
});

describe("solverJointStatistics", () => {
  it("counts joints and forwards the reaction capability", () => {
    expect(
      solverJointStatistics(new FakeJointAccess(false, [1, 2, 3])),
    ).toEqual({
      jointCount: 3,
      reportsJointReactions: false,
    });
    expect(solverJointStatistics(new FakeJointAccess(true, []))).toEqual({
      jointCount: 0,
      reportsJointReactions: true,
    });
  });

  it("reuses an out record", () => {
    const out: SolverJointStatistics = {
      jointCount: 42,
      reportsJointReactions: true,
    };
    const result = solverJointStatistics(new FakeJointAccess(false, [5]), out);
    expect(result).toBe(out);
    expect(out).toEqual({ jointCount: 1, reportsJointReactions: false });
  });
});

// --- allocation -------------------------------------------------------------

describe("allocation (§7b, plan D7)", () => {
  it("constructs no math objects once the buffer is warm", () => {
    const access = new FakeBodyAccess(
      [
        scriptBody(1, [0, 0, 0], [1, 2, 0], [0, 0, 1]),
        scriptBody(2, [3, 0, 0], [0, 1, 0], [0, 0, 2]),
      ],
      [1, 2],
    );
    const events: DebugPhysicsEventLike[] = [
      {
        type: "collisionstart",
        contacts: [contact([0, 0, 0], [0, 1, 0], 2)],
      },
    ];
    const buffer = new DebugDrawBuffer({ initialCapacity: 256 });
    const stats: SolverStatistics = {
      bodyCount: 0,
      sleepingCount: 0,
      awakeCount: 0,
      colliderCount: 0,
      maxBodyId: -1,
    };

    // Warm-up frame: grows nothing (capacity 256) but exercises every path.
    const frame = (): void => {
      buffer.clear();
      collectBodyVelocities(access, buffer, { includeAngular: true });
      collectBodyOrigins(access, buffer);
      collectCentersOfMass(access, buffer);
      collectContactPoints(events, buffer);
      collectContactImpulses(events, buffer);
      solverStatistics(access, stats);
    };
    frame();
    const warm = buffer.data;

    resetConstructionCount();
    for (let i = 0; i < 10; i += 1) {
      frame();
    }

    expect(constructionCount()).toBe(0);
    expect(buffer.data).toBe(warm);
    expect(buffer.lineCount).toBeGreaterThan(0);
  });
});

// --- staged visualizations --------------------------------------------------

describe("DEBUG_DRAW_STAGED", () => {
  it("lists the two items still staged, dated (centre-of-mass unstaged 2026-08-04, per-segment colour 2026-08-07)", () => {
    // Both survivors are blocked on a *seam* that does not exist — a joint
    // anchor and a readable applied force. The two entries that have left the
    // list left because the thing they named arrived: `getBodyCenterOfMass`
    // (2026-08-04) and R-19's vertex-colour attribute plus `debugDrawStreams`
    // (2026-08-07, R-35).
    expect(DEBUG_DRAW_STAGED.map((entry) => entry.id)).toEqual([
      "joint-anchors",
      "applied-force-vectors",
    ]);
    expect(DEBUG_DRAW_STAGED.map((entry) => entry.id)).not.toContain(
      "per-segment-colored-draw",
    );
    for (const entry of DEBUG_DRAW_STAGED) {
      expect(entry.staged).toBe("2026-08-02");
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.unblockedBy.length).toBeGreaterThan(0);
      expect(entry.specItem.length).toBeGreaterThan(0);
    }
  });

  it("is frozen, so an overlay cannot rewrite the record", () => {
    expect(Object.isFrozen(DEBUG_DRAW_STAGED)).toBe(true);
    expect(Object.isFrozen(DEBUG_DRAW_STAGED[0])).toBe(true);
  });

  it("names the honest substitute for the two physics items", () => {
    const byId = new Map(DEBUG_DRAW_STAGED.map((entry) => [entry.id, entry]));
    expect(byId.get("joint-anchors")?.shippedInstead).toContain(
      "solverJointStatistics",
    );
    expect(byId.get("applied-force-vectors")?.shippedInstead).toContain(
      "collectContactImpulses",
    );
  });
});
