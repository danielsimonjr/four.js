import {
  Vector3,
  Vector4,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import { describe, expect, it } from "vitest";

import { ParticlePool } from "../src/pool.js";

/** Spawns `count` particles, asserting each got a real slot. */
function spawnMany(pool: ParticlePool, count: number): number[] {
  const indices: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = pool.spawn();
    expect(index).toBeGreaterThanOrEqual(0);
    indices.push(index);
  }
  return indices;
}

/** Writes a recognisable state into `index`, derived from `tag`. */
function fill(pool: ParticlePool, index: number, tag: number): void {
  pool.setPosition(index, tag, tag + 0.5, tag + 0.25);
  pool.setVelocity(index, -tag, tag * 2, tag * 3);
  pool.setAge(index, tag * 0.125);
  pool.setLifetime(index, 10 + tag);
  pool.setSize(index, tag, tag + 1);
  pool.setColor(
    index,
    tag,
    tag + 1,
    tag + 2,
    tag + 3,
    tag + 4,
    tag + 5,
    tag + 6,
    tag + 7,
  );
}

/** Reads every channel of `index` into a comparable plain object. */
function snapshot(pool: ParticlePool, index: number): Record<string, number> {
  const position = new Vector3();
  const velocity = new Vector3();
  const start = new Vector4();
  const end = new Vector4();
  pool.getPosition(index, position);
  pool.getVelocity(index, velocity);
  pool.getStartColor(index, start);
  pool.getEndColor(index, end);
  return {
    px: position.x,
    py: position.y,
    pz: position.z,
    vx: velocity.x,
    vy: velocity.y,
    vz: velocity.z,
    age: pool.getAge(index),
    lifetime: pool.getLifetime(index),
    size0: pool.getStartSize(index),
    size1: pool.getEndSize(index),
    r0: start.x,
    g0: start.y,
    b0: start.z,
    a0: start.w,
    r1: end.x,
    g1: end.y,
    b1: end.z,
    a1: end.w,
  };
}

describe("ParticlePool — construction", () => {
  it("allocates every channel at the documented stride", () => {
    const pool = new ParticlePool(4);
    expect(pool.capacity).toBe(4);
    expect(pool.aliveCount).toBe(0);
    expect(pool.positions).toBeInstanceOf(Float32Array);
    expect(pool.positions.length).toBe(12);
    expect(pool.velocities.length).toBe(12);
    expect(pool.ages.length).toBe(4);
    expect(pool.lifetimes.length).toBe(4);
    expect(pool.sizes.length).toBe(8);
    expect(pool.colors.length).toBe(32);
  });

  it("accepts a zero capacity and then drops every spawn", () => {
    const pool = new ParticlePool(0);
    expect(pool.capacity).toBe(0);
    expect(pool.spawn()).toBe(-1);
    expect(pool.aliveCount).toBe(0);
  });

  it("rejects a capacity that is not a non-negative safe integer", () => {
    expect(() => new ParticlePool(-1)).toThrow(RangeError);
    expect(() => new ParticlePool(1.5)).toThrow(RangeError);
    expect(() => new ParticlePool(Number.NaN)).toThrow(RangeError);
    expect(() => new ParticlePool(Number.POSITIVE_INFINITY)).toThrow(
      /non-negative safe integer/,
    );
  });
});

describe("ParticlePool — spawn", () => {
  it("hands out ascending slots up to capacity, then -1", () => {
    const pool = new ParticlePool(3);
    expect(spawnMany(pool, 3)).toEqual([0, 1, 2]);
    expect(pool.aliveCount).toBe(3);
    expect(pool.spawn()).toBe(-1);
    expect(pool.aliveCount).toBe(3);
  });

  it("zeroes every channel of a recycled slot", () => {
    const pool = new ParticlePool(2);
    const [a] = spawnMany(pool, 1);
    fill(pool, a, 7);
    pool.kill(a);

    const recycled = pool.spawn();
    expect(recycled).toBe(0);
    expect(snapshot(pool, recycled)).toEqual({
      px: 0,
      py: 0,
      pz: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 0,
      lifetime: 0,
      size0: 0,
      size1: 0,
      r0: 0,
      g0: 0,
      b0: 0,
      a0: 0,
      r1: 0,
      g1: 0,
      b1: 0,
      a1: 0,
    });
  });
});

describe("ParticlePool — channels", () => {
  it("round-trips every channel through the out-parameter accessors", () => {
    const pool = new ParticlePool(1);
    const [index] = spawnMany(pool, 1);
    pool.setPosition(index, 1, 2, 3);
    pool.setVelocity(index, -4, 5, -6);
    pool.setAge(index, 0.25);
    pool.setLifetime(index, 2);
    pool.setSize(index, 3, 11);
    pool.setColor(index, 0.5, 0.25, 0.125, 1, 0, 0.75, 0.5, 0.25);

    const out = new Vector3();
    expect(pool.getPosition(index, out)).toBe(out);
    expect([out.x, out.y, out.z]).toEqual([1, 2, 3]);
    expect(pool.getVelocity(index, out)).toBe(out);
    expect([out.x, out.y, out.z]).toEqual([-4, 5, -6]);
    expect(pool.getAge(index)).toBe(0.25);
    expect(pool.getLifetime(index)).toBe(2);
    expect(pool.getStartSize(index)).toBe(3);
    expect(pool.getEndSize(index)).toBe(11);

    const color = new Vector4();
    expect(pool.getStartColor(index, color)).toBe(color);
    expect([color.x, color.y, color.z, color.w]).toEqual([0.5, 0.25, 0.125, 1]);
    expect(pool.getEndColor(index, color)).toBe(color);
    expect([color.x, color.y, color.z, color.w]).toEqual([0, 0.75, 0.5, 0.25]);
  });

  it("stores channels as float32", () => {
    const pool = new ParticlePool(1);
    const [index] = spawnMany(pool, 1);
    pool.setPosition(index, 0.1, 0, 0);
    const out = new Vector3();
    pool.getPosition(index, out);
    expect(out.x).toBe(Math.fround(0.1));
    expect(out.x).not.toBe(0.1);
  });
});

describe("ParticlePool — normalized age and the over-lifetime ramps", () => {
  it("reports age / lifetime, clamped to [0, 1]", () => {
    const pool = new ParticlePool(1);
    const [index] = spawnMany(pool, 1);
    pool.setLifetime(index, 2);
    pool.setAge(index, 0);
    expect(pool.getNormalizedAge(index)).toBe(0);
    pool.setAge(index, 1);
    expect(pool.getNormalizedAge(index)).toBe(0.5);
    pool.setAge(index, 2);
    expect(pool.getNormalizedAge(index)).toBe(1);
    pool.setAge(index, 5);
    expect(pool.getNormalizedAge(index)).toBe(1);
    pool.setAge(index, -1);
    expect(pool.getNormalizedAge(index)).toBe(0);
  });

  it("reports 1 for a non-positive lifetime instead of Infinity or NaN", () => {
    const pool = new ParticlePool(1);
    const [index] = spawnMany(pool, 1);
    pool.setAge(index, 3);
    pool.setLifetime(index, 0);
    expect(pool.getNormalizedAge(index)).toBe(1);
    pool.setLifetime(index, -2);
    expect(pool.getNormalizedAge(index)).toBe(1);
    pool.setLifetime(index, Number.NaN);
    expect(pool.getNormalizedAge(index)).toBe(1);
  });

  it("interpolates size exactly at 0, mid, and 1", () => {
    const pool = new ParticlePool(1);
    const [index] = spawnMany(pool, 1);
    pool.setLifetime(index, 4);
    pool.setSize(index, 2, 6);
    pool.setAge(index, 0);
    expect(pool.getSize(index)).toBe(2);
    pool.setAge(index, 2);
    expect(pool.getSize(index)).toBe(4);
    pool.setAge(index, 4);
    expect(pool.getSize(index)).toBe(6);
    pool.setAge(index, 1);
    expect(pool.getSize(index)).toBe(3);
  });

  it("interpolates colour component-wise, exactly at 0, mid, and 1", () => {
    const pool = new ParticlePool(1);
    const [index] = spawnMany(pool, 1);
    pool.setLifetime(index, 1);
    pool.setColor(index, 1, 0, 0.5, 1, 0, 1, 0.5, 0);
    const out = new Vector4();

    pool.setAge(index, 0);
    expect(pool.getColor(index, out)).toBe(out);
    expect([out.x, out.y, out.z, out.w]).toEqual([1, 0, 0.5, 1]);

    pool.setAge(index, 0.5);
    pool.getColor(index, out);
    expect([out.x, out.y, out.z, out.w]).toEqual([0.5, 0.5, 0.5, 0.5]);

    pool.setAge(index, 1);
    pool.getColor(index, out);
    expect([out.x, out.y, out.z, out.w]).toEqual([0, 1, 0.5, 0]);
  });
});

describe("ParticlePool — swap-remove compaction", () => {
  it("moves the last live particle into the dead slot", () => {
    const pool = new ParticlePool(4);
    spawnMany(pool, 4);
    for (let i = 0; i < 4; i += 1) {
      fill(pool, i, i + 1);
    }
    const last = snapshot(pool, 3);

    pool.kill(1);

    expect(pool.aliveCount).toBe(3);
    // Slot 1 now holds what slot 3 held: insertion order is gone, every channel
    // moved together.
    expect(snapshot(pool, 1)).toEqual(last);
    expect(snapshot(pool, 0).px).toBe(1);
    expect(snapshot(pool, 2).px).toBe(3);
  });

  it("breaks insertion order — the documented consequence", () => {
    const pool = new ParticlePool(4);
    spawnMany(pool, 4);
    for (let i = 0; i < 4; i += 1) {
      // Birth order is encoded in the age channel, 0, 1, 2, 3.
      fill(pool, i, i);
    }
    pool.kill(0);
    const birthOrder: number[] = [];
    for (let i = 0; i < pool.aliveCount; i += 1) {
      birthOrder.push(pool.getAge(i) / 0.125);
    }
    // Index order is now 3, 1, 2 — not ascending birth order.
    expect(birthOrder).toEqual([3, 1, 2]);
  });

  it("kills the last live particle without a self-copy", () => {
    const pool = new ParticlePool(3);
    spawnMany(pool, 3);
    fill(pool, 2, 9);
    const before = snapshot(pool, 2);
    pool.kill(2);
    expect(pool.aliveCount).toBe(2);
    // The slot is untouched — it is simply no longer live.
    expect(pool.positions[6]).toBe(before.px);
  });

  it("drains the pool one particle at a time", () => {
    const pool = new ParticlePool(16);
    spawnMany(pool, 16);
    for (let expected = 16; expected > 0; expected -= 1) {
      expect(pool.aliveCount).toBe(expected);
      pool.kill(0);
    }
    expect(pool.aliveCount).toBe(0);
  });

  it("clears in O(1) and hands the slots back zeroed", () => {
    const pool = new ParticlePool(2);
    spawnMany(pool, 2);
    fill(pool, 0, 5);
    pool.clear();
    expect(pool.aliveCount).toBe(0);
    const index = pool.spawn();
    expect(pool.getAge(index)).toBe(0);
    expect(snapshot(pool, index).px).toBe(0);
  });

  it("compaction is deterministic: the same kill sequence gives identical arrays", () => {
    const build = (): ParticlePool => {
      const pool = new ParticlePool(8);
      spawnMany(pool, 8);
      for (let i = 0; i < 8; i += 1) {
        fill(pool, i, i + 1);
      }
      for (const victim of [2, 0, 4, 1]) {
        pool.kill(victim);
      }
      return pool;
    };
    const a = build();
    const b = build();
    expect(a.aliveCount).toBe(b.aliveCount);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.velocities)).toEqual(Array.from(b.velocities));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
  });
});

describe("ParticlePool — index validation", () => {
  it("rejects indices that are not live slots", () => {
    const pool = new ParticlePool(4);
    spawnMany(pool, 2);
    const position = new Vector3();
    const color = new Vector4();

    // Past the live count (but inside capacity), negative, and fractional.
    expect(() => pool.getPosition(2, position)).toThrow(RangeError);
    expect(() => pool.getPosition(-1, position)).toThrow(/not a live particle/);
    expect(() => pool.getPosition(0.5, position)).toThrow(RangeError);

    expect(() => pool.setPosition(9, 0, 0, 0)).toThrow(RangeError);
    expect(() => pool.getVelocity(9, position)).toThrow(RangeError);
    expect(() => pool.setVelocity(9, 0, 0, 0)).toThrow(RangeError);
    expect(() => pool.getAge(9)).toThrow(RangeError);
    expect(() => pool.setAge(9, 0)).toThrow(RangeError);
    expect(() => pool.getLifetime(9)).toThrow(RangeError);
    expect(() => pool.setLifetime(9, 0)).toThrow(RangeError);
    expect(() => pool.getNormalizedAge(9)).toThrow(RangeError);
    expect(() => pool.setSize(9, 0, 0)).toThrow(RangeError);
    expect(() => pool.getStartSize(9)).toThrow(RangeError);
    expect(() => pool.getEndSize(9)).toThrow(RangeError);
    expect(() => pool.getSize(9)).toThrow(RangeError);
    expect(() => pool.setColor(9, 0, 0, 0, 0, 0, 0, 0, 0)).toThrow(RangeError);
    expect(() => pool.getStartColor(9, color)).toThrow(RangeError);
    expect(() => pool.getEndColor(9, color)).toThrow(RangeError);
    expect(() => pool.getColor(9, color)).toThrow(RangeError);
    expect(() => pool.kill(9)).toThrow(/ParticlePool\.kill/);
  });
});

describe("ParticlePool — allocation (§7b, plan D7)", () => {
  it("allocates no math objects across spawn, accessors, kill, and clear", () => {
    const pool = new ParticlePool(64);
    const position = new Vector3();
    const velocity = new Vector3();
    const color = new Vector4();

    resetConstructionCount();
    for (let round = 0; round < 20; round += 1) {
      for (let i = 0; i < 64; i += 1) {
        const index = pool.spawn();
        pool.setPosition(index, i, i, i);
        pool.setVelocity(index, i, i, i);
        pool.setLifetime(index, 1);
        pool.setAge(index, 0.5);
        pool.setSize(index, 1, 0);
        pool.setColor(index, 1, 1, 1, 1, 0, 0, 0, 0);
      }
      for (let i = 0; i < 64; i += 1) {
        pool.getPosition(0, position);
        pool.getVelocity(0, velocity);
        pool.getColor(0, color);
        pool.getSize(0);
        pool.getNormalizedAge(0);
        pool.kill(0);
      }
      pool.clear();
    }
    expect(constructionCount()).toBe(0);
  });

  it("never reallocates a channel array", () => {
    const pool = new ParticlePool(8);
    const buffers = [
      pool.positions,
      pool.velocities,
      pool.ages,
      pool.lifetimes,
      pool.sizes,
      pool.colors,
    ];
    for (let round = 0; round < 50; round += 1) {
      spawnMany(pool, 8);
      expect(pool.spawn()).toBe(-1);
      while (pool.aliveCount > 0) {
        pool.kill(pool.aliveCount - 1);
      }
    }
    // Identity, not deep equality: a reallocated array with the same contents
    // would pass `toEqual` and is exactly what this test exists to catch.
    expect(pool.positions).toBe(buffers[0]);
    expect(pool.velocities).toBe(buffers[1]);
    expect(pool.ages).toBe(buffers[2]);
    expect(pool.lifetimes).toBe(buffers[3]);
    expect(pool.sizes).toBe(buffers[4]);
    expect(pool.colors).toBe(buffers[5]);
    expect(pool.positions.buffer.byteLength).toBe(8 * 3 * 4);
  });
});
