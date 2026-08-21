/**
 * PH-20 (2026-08-21): §33's sixth item, rollback, gets an API.
 *
 * The target here is a counting double rather than a `PhysicsWorld` — this
 * package may not import `@four/physics` (§3.1), and the buffer's contract is
 * over `createSnapshot`/`restoreSnapshot` and nothing else. The real-solver
 * claim (rewind + re-simulate reproduces the original checksums exactly) is
 * `tests/determinism/rollback.test.ts`, which is the only place allowed to see
 * both packages.
 */

import { isFourError } from "@four/core";
import { describe, expect, it } from "vitest";

import type { ReplaySnapshot, RollbackTarget } from "../src/index.js";
import { RollbackBuffer } from "../src/index.js";

/** A target whose whole state is one integer, so a restore is checkable. */
class CountingTarget implements RollbackTarget {
  value = 0;
  captures = 0;
  restores = 0;

  createSnapshot(): ReplaySnapshot {
    this.captures += 1;
    return {
      adapterName: "counting",
      adapterVersion: "1.0.0",
      data: new Uint8Array([this.value]).buffer,
    };
  }

  restoreSnapshot(snapshot: ReplaySnapshot): void {
    this.restores += 1;
    this.value = new Uint8Array(snapshot.data)[0];
  }
}

describe("RollbackBuffer construction (§33, §85)", () => {
  it("refuses a capacity that is not a positive integer", () => {
    const target = new CountingTarget();
    for (const capacity of [0, -1, 1.5, Number.NaN]) {
      let caught: unknown;
      try {
        new RollbackBuffer({ target, capacity });
      } catch (error) {
        caught = error;
      }
      expect(isFourError(caught)).toBe(true);
      expect((caught as Error).message).toContain("positive integer");
    }
  });

  it("starts empty and reports its window", () => {
    const buffer = new RollbackBuffer({
      target: new CountingTarget(),
      capacity: 3,
    });
    expect(buffer.size).toBe(0);
    expect(buffer.capacity).toBe(3);
    expect(buffer.oldestStep).toBeUndefined();
    expect(buffer.newestStep).toBeUndefined();
    expect(buffer.steps).toEqual([]);
    expect(buffer.has(0)).toBe(false);
  });
});

describe("RollbackBuffer.capture (§34)", () => {
  it("keeps the last `capacity` captures, oldest evicted first", () => {
    const target = new CountingTarget();
    const buffer = new RollbackBuffer({ target, capacity: 3 });

    for (let step = 0; step < 5; step += 1) {
      target.value = step;
      buffer.capture(step);
    }

    expect(buffer.size).toBe(3);
    expect(buffer.steps).toEqual([2, 3, 4]);
    expect(buffer.oldestStep).toBe(2);
    expect(buffer.newestStep).toBe(4);
    expect(target.captures).toBe(5);
  });

  it("refuses a step that does not strictly ascend", () => {
    const buffer = new RollbackBuffer({
      target: new CountingTarget(),
      capacity: 4,
    });
    buffer.capture(7);

    for (const step of [7, 6]) {
      let caught: unknown;
      try {
        buffer.capture(step);
      } catch (error) {
        caught = error;
      }
      expect(isFourError(caught)).toBe(true);
      expect((caught as Error).message).toContain("strictly ascend");
    }
  });

  it("refuses a step that is not a non-negative integer", () => {
    const buffer = new RollbackBuffer({
      target: new CountingTarget(),
      capacity: 2,
    });
    for (const step of [-1, 0.5]) {
      let caught: unknown;
      try {
        buffer.capture(step);
      } catch (error) {
        caught = error;
      }
      expect(isFourError(caught)).toBe(true);
      expect((caught as Error).message).toContain("non-negative integer");
    }
  });
});

describe("RollbackBuffer.rollbackTo (§33 rollback)", () => {
  it("restores the state captured at a step and returns the steps owed", () => {
    const target = new CountingTarget();
    const buffer = new RollbackBuffer({ target, capacity: 8 });
    for (let step = 0; step < 6; step += 1) {
      target.value = step * 10;
      buffer.capture(step);
    }
    target.value = 999;

    expect(buffer.rollbackTo(2)).toBe(3);
    expect(target.value).toBe(20);
    expect(target.restores).toBe(1);
    // Everything after the rewind target is forgotten; the target itself stays.
    expect(buffer.steps).toEqual([0, 1, 2]);
    expect(buffer.has(2)).toBe(true);
    expect(buffer.has(3)).toBe(false);
  });

  it("accepts the newest step, returning zero", () => {
    const target = new CountingTarget();
    const buffer = new RollbackBuffer({ target, capacity: 4 });
    target.value = 5;
    buffer.capture(0);
    target.value = 6;

    expect(buffer.rollbackTo(0)).toBe(0);
    expect(target.value).toBe(5);
  });

  it("can roll back to the same step twice (two late inputs, one step)", () => {
    const target = new CountingTarget();
    const buffer = new RollbackBuffer({ target, capacity: 4 });
    target.value = 3;
    buffer.capture(1);

    expect(buffer.rollbackTo(1)).toBe(0);
    target.value = 42;
    expect(buffer.rollbackTo(1)).toBe(0);
    expect(target.value).toBe(3);
  });

  it("refuses an evicted step and names the window it holds", () => {
    const target = new CountingTarget();
    const buffer = new RollbackBuffer({ target, capacity: 2 });
    buffer.capture(4);
    buffer.capture(5);

    let caught: unknown;
    try {
      buffer.rollbackTo(3);
    } catch (error) {
      caught = error;
    }
    expect(isFourError(caught)).toBe(true);
    expect((caught as Error).message).toContain("held steps are 4…5");
    expect(target.restores).toBe(0);
  });

  it("says so when the buffer is empty", () => {
    const buffer = new RollbackBuffer({
      target: new CountingTarget(),
      capacity: 2,
    });
    let caught: unknown;
    try {
      buffer.rollbackTo(0);
    } catch (error) {
      caught = error;
    }
    expect(isFourError(caught)).toBe(true);
    expect((caught as Error).message).toContain("the buffer is empty");
  });

  it("clears without touching the target", () => {
    const target = new CountingTarget();
    const buffer = new RollbackBuffer({ target, capacity: 2 });
    buffer.capture(0);
    buffer.clear();

    expect(buffer.size).toBe(0);
    expect(target.restores).toBe(0);
    // A cleared buffer accepts a step number that restarts from zero.
    expect(() => buffer.capture(0)).not.toThrow();
  });
});
