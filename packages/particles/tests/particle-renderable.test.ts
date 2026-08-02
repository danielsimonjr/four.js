/**
 * `ParticleRenderable` (§36, §49, plan P9-3) — the producing half of the
 * cross-package particle contract.
 *
 * Three things are pinned here, and they are worth naming because nothing in
 * the type system can pin them for us — the frozen §3.1 dependency matrix keeps
 * `@four/particles` and `@four/render` from ever seeing each other's
 * declarations (see `src/particle-renderable.ts`):
 *
 * 1. **The shape.** Brand, id, sort keys, count, instance array, repack method:
 *    the member names and types `@four/render`'s `ParticleDrawable` declares.
 *    `@four/render`'s `tests/particles.test.ts` asserts the same list from the
 *    consuming side, against a double that `implements ParticleDrawable` for
 *    real.
 * 2. **The layout.** Stride 8: centre (3), current size (1), straight-alpha
 *    RGBA (4). Asserted here as floats at offsets, and by
 *    `@four/render-webgl`'s attribute pointers at the far end.
 * 3. **The values.** The drawn size and colour must be the pool's own ramp
 *    evaluation, bit for bit — so they are asserted against
 *    `ParticlePool.getSize` and `ParticlePool.getColor` rather than against a
 *    formula re-derived in the test, which would agree with a wrong
 *    implementation as happily as with a right one.
 */

import {
  Vector3,
  Vector4,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import { Group, Scene } from "@four/scene";
import { describe, expect, it } from "vitest";

import { ParticleEmitter } from "../src/emitter.js";
import {
  PARTICLE_INSTANCE_FLOATS,
  ParticleRenderable,
} from "../src/particle-renderable.js";
import { ParticlePool } from "../src/pool.js";

/** Offsets within one instance, mirroring `@four/render`'s exported constants. */
const POSITION_OFFSET = 0;
const SIZE_OFFSET = 3;
const COLOR_OFFSET = 4;

/**
 * A seeded emitter that spawns into a cone with a size and colour ramp, so
 * every channel the repack touches is actually varying.
 */
function emitter(options: { maxParticles?: number } = {}): ParticleEmitter {
  return new ParticleEmitter({
    maxParticles: options.maxParticles ?? 32,
    seed: 1337,
    emissionRate: 60,
    lifetime: { min: 0.5, max: 1.5 },
    initialSpeed: { min: 1, max: 3 },
    spreadAngle: Math.PI / 4,
    size: { start: 2, end: 0.25 },
    color: {
      start: { r: 1, g: 0.5, b: 0, a: 1 },
      end: { r: 0, g: 0, b: 1, a: 0 },
    },
    gravity: new Vector3(0, -9.81, 0),
  });
}

/** Steps `renderable`'s emitter `steps` times at 60 Hz. */
function run(renderable: ParticleRenderable, steps: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < steps; i += 1) {
    renderable.emitter.step(dt, i * dt);
  }
}

/** The instance at `index`, as a plain array of its eight floats. */
function instanceAt(renderable: ParticleRenderable, index: number): number[] {
  const base = index * PARTICLE_INSTANCE_FLOATS;
  return Array.from(
    renderable.particleInstances.slice(base, base + PARTICLE_INSTANCE_FLOATS),
  );
}

describe("ParticleRenderable — construction", () => {
  it("is a scene node owning an emitter and the §66 sort keys", () => {
    const source = emitter();
    const node = new ParticleRenderable(source);

    expect(node.emitter).toBe(source);
    expect(node.renderLayer).toBe(0);
    expect(node.renderOrder).toBe(0);
    expect(node.visible).toBe(true);
    expect(node.enabled).toBe(true);
    expect(node.transform.position.x).toBe(0);
    expect(node.id.startsWith("node-")).toBe(true);
  });

  it("accepts initial sort keys", () => {
    const node = new ParticleRenderable(emitter(), {
      renderLayer: 2,
      renderOrder: -1,
    });

    expect(node.renderLayer).toBe(2);
    expect(node.renderOrder).toBe(-1);
  });

  it("allocates the instance array once, at the emitter's full budget", () => {
    const node = new ParticleRenderable(emitter({ maxParticles: 100 }));

    expect(node.particleInstances.length).toBe(100 * PARTICLE_INSTANCE_FLOATS);
    expect(node.particleCount).toBe(0);
  });

  it("parents and traverses like any other node (§6)", () => {
    const scene = new Scene();
    const group = new Group();
    const node = new ParticleRenderable(emitter());
    scene.add(group);
    group.add(node);

    const visited: string[] = [];
    scene.traverse((child) => visited.push(child.id));

    expect(node.parent).toBe(group);
    expect(visited).toContain(node.id);
  });

  it("copes with a zero-capacity emitter", () => {
    const node = new ParticleRenderable(
      new ParticleEmitter({ maxParticles: 0 }),
    );

    node.updateParticleInstances();

    expect(node.particleInstances.length).toBe(0);
    expect(node.particleCount).toBe(0);
  });
});

describe("ParticleRenderable — the ParticleDrawable contract (@four/render)", () => {
  it("carries the brand and the whole member list, with the right types", () => {
    const node = new ParticleRenderable(emitter());

    // The brand is a literal `true`, not a truthy value: the render list's
    // guard compares with `===`.
    expect(node.isParticleDrawable).toBe(true);
    expect(typeof node.id).toBe("string");
    expect(typeof node.renderLayer).toBe("number");
    expect(typeof node.renderOrder).toBe("number");
    expect(typeof node.particleCount).toBe("number");
    expect(node.particleInstances).toBeInstanceOf(Float32Array);
    expect(typeof node.updateParticleInstances).toBe("function");
    expect(node.updateParticleInstances()).toBeUndefined();
  });

  it("satisfies the guard `@four/render` recognises it with", () => {
    // The guard, transcribed: brand identity plus the repack method. Written
    // out rather than imported because the dependency matrix forbids the edge —
    // if this drifts from `isParticleDrawable`, one of the two suites fails.
    const node = new ParticleRenderable(emitter()) as unknown as Record<
      string,
      unknown
    >;

    expect(node.isParticleDrawable === true).toBe(true);
    expect(typeof node.updateParticleInstances).toBe("function");
  });

  it("hands out the same array object every frame, so a backend can key on it", () => {
    const node = new ParticleRenderable(emitter());
    const array = node.particleInstances;

    run(node, 10);
    node.updateParticleInstances();
    run(node, 10);
    node.updateParticleInstances();

    expect(node.particleInstances).toBe(array);
  });
});

describe("ParticleRenderable.updateParticleInstances — the repack", () => {
  it("writes one instance per live particle, in pool order", () => {
    const node = new ParticleRenderable(emitter());
    run(node, 30);

    node.updateParticleInstances();

    const pool = node.emitter.pool;
    expect(node.particleCount).toBe(pool.aliveCount);
    expect(pool.aliveCount).toBeGreaterThan(0);

    const position = new Vector3();
    for (let i = 0; i < pool.aliveCount; i += 1) {
      pool.getPosition(i, position);
      const instance = instanceAt(node, i);
      expect(instance[POSITION_OFFSET]).toBe(position.x);
      expect(instance[POSITION_OFFSET + 1]).toBe(position.y);
      expect(instance[POSITION_OFFSET + 2]).toBe(position.z);
    }
  });

  it("evaluates the size ramp exactly as ParticlePool.getSize does", () => {
    const node = new ParticleRenderable(emitter());
    run(node, 45);

    node.updateParticleInstances();

    const pool = node.emitter.pool;
    for (let i = 0; i < pool.aliveCount; i += 1) {
      // `Math.fround`: the pool returns a binary64 lerp of binary32 endpoints,
      // and the instance array rounds that once on store. Both sides are the
      // same value; only the container differs.
      expect(instanceAt(node, i)[SIZE_OFFSET]).toBe(
        Math.fround(pool.getSize(i)),
      );
    }
  });

  it("evaluates the colour ramp exactly as ParticlePool.getColor does", () => {
    const node = new ParticleRenderable(emitter());
    run(node, 45);

    node.updateParticleInstances();

    const pool = node.emitter.pool;
    const color = new Vector4();
    for (let i = 0; i < pool.aliveCount; i += 1) {
      pool.getColor(i, color);
      const instance = instanceAt(node, i);
      expect(instance[COLOR_OFFSET]).toBe(Math.fround(color.x));
      expect(instance[COLOR_OFFSET + 1]).toBe(Math.fround(color.y));
      expect(instance[COLOR_OFFSET + 2]).toBe(Math.fround(color.z));
      expect(instance[COLOR_OFFSET + 3]).toBe(Math.fround(color.w));
    }
  });

  it("draws the ramp endpoints exactly at age 0 and at age = lifetime", () => {
    // A pool driven by hand, so both ends of the ramp are reachable exactly.
    const source = new ParticleEmitter({ maxParticles: 2 });
    const node = new ParticleRenderable(source);
    const pool = source.pool;
    pool.spawn();
    pool.setLifetime(0, 2);
    pool.setAge(0, 0);
    pool.setSize(0, 4, 0);
    pool.setColor(0, 1, 0, 0, 1, 0, 0, 1, 0);
    pool.spawn();
    pool.setLifetime(1, 2);
    pool.setAge(1, 2);
    pool.setSize(1, 4, 0);
    pool.setColor(1, 1, 0, 0, 1, 0, 0, 1, 0);

    node.updateParticleInstances();

    expect(instanceAt(node, 0).slice(SIZE_OFFSET)).toEqual([4, 1, 0, 0, 1]);
    expect(instanceAt(node, 1).slice(SIZE_OFFSET)).toEqual([0, 0, 0, 1, 0]);
  });

  it("clamps a negative age to the start of the ramp, like the pool does", () => {
    const source = new ParticleEmitter({ maxParticles: 1 });
    const node = new ParticleRenderable(source);
    const pool = source.pool;
    pool.spawn();
    pool.setLifetime(0, 2);
    pool.setAge(0, -1); // not reachable through `step`, but the pool allows it
    pool.setSize(0, 8, 0);

    node.updateParticleInstances();

    expect(pool.getNormalizedAge(0)).toBe(0);
    expect(instanceAt(node, 0)[SIZE_OFFSET]).toBe(8);

    // …and past the end of its lifetime it clamps to the ramp's other end
    // rather than extrapolating (the emitter kills such a particle in the same
    // step, but the pool permits the state and the drawn value must be sane).
    pool.setAge(0, 7);
    node.updateParticleInstances();

    expect(pool.getNormalizedAge(0)).toBe(1);
    expect(instanceAt(node, 0)[SIZE_OFFSET]).toBe(0);
  });

  it("treats a non-positive lifetime as fully aged, like the pool does", () => {
    const source = new ParticleEmitter({ maxParticles: 1 });
    const node = new ParticleRenderable(source);
    const pool = source.pool;
    pool.spawn();
    pool.setLifetime(0, 0);
    pool.setSize(0, 8, 1);

    node.updateParticleInstances();

    expect(pool.getNormalizedAge(0)).toBe(1);
    expect(instanceAt(node, 0)[SIZE_OFFSET]).toBe(1);
  });

  it("leaves stale slots past the live count untouched", () => {
    const source = new ParticleEmitter({ maxParticles: 4 });
    const node = new ParticleRenderable(source);
    const pool = source.pool;
    pool.spawn();
    pool.spawn();
    pool.setPosition(0, 1, 0, 0);
    pool.setPosition(1, 2, 0, 0);
    node.updateParticleInstances();

    pool.kill(1);
    node.updateParticleInstances();

    expect(node.particleCount).toBe(1);
    // Slot 1's old contents are still in the array — and are never uploaded,
    // because the backend uploads `count × stride` floats and no more.
    expect(instanceAt(node, 1)[POSITION_OFFSET]).toBe(2);
  });

  it("tracks a shrinking and re-growing system", () => {
    const node = new ParticleRenderable(emitter({ maxParticles: 8 }));

    run(node, 20);
    node.updateParticleInstances();
    const busy = node.particleCount;

    node.emitter.pool.clear();
    node.updateParticleInstances();

    expect(busy).toBeGreaterThan(0);
    expect(node.particleCount).toBe(0);

    node.emitter.emit(3);
    node.updateParticleInstances();
    expect(node.particleCount).toBe(3);
  });

  it("is idempotent between simulation steps", () => {
    const node = new ParticleRenderable(emitter());
    run(node, 25);

    node.updateParticleInstances();
    const first = instanceAt(node, 0);
    node.updateParticleInstances();

    expect(instanceAt(node, 0)).toEqual(first);
  });
});

describe("ParticleRenderable — allocation (§7b, plan D7)", () => {
  it("allocates no math objects while repacking", () => {
    const node = new ParticleRenderable(emitter());
    run(node, 30);
    node.updateParticleInstances();

    resetConstructionCount();
    for (let frame = 0; frame < 60; frame += 1) {
      node.updateParticleInstances();
    }

    expect(constructionCount()).toBe(0);
    expect(node.particleCount).toBeGreaterThan(0);
  });

  it("constructs no typed arrays while repacking or bounding", () => {
    const node = new ParticleRenderable(emitter());
    run(node, 30);
    node.updateParticleInstances();
    const min = new Vector3();
    const max = new Vector3();

    const realFloat32Array = globalThis.Float32Array;
    let constructed = 0;
    const counting = new Proxy(realFloat32Array, {
      construct(target, args, newTarget): object {
        constructed += 1;
        return Reflect.construct(target, args, newTarget) as object;
      },
    });
    globalThis.Float32Array = counting;
    try {
      for (let frame = 0; frame < 60; frame += 1) {
        node.updateParticleInstances();
        node.computeBounds(min, max);
      }
    } finally {
      globalThis.Float32Array = realFloat32Array;
    }

    expect(constructed).toBe(0);
  });
});

describe("ParticleRenderable.computeBounds (§87)", () => {
  it("bounds the drawn quads: the centre box expanded by half the largest size", () => {
    const source = new ParticleEmitter({ maxParticles: 4 });
    const node = new ParticleRenderable(source);
    const pool = source.pool;
    pool.spawn();
    pool.setPosition(0, -1, 0, 2);
    pool.setLifetime(0, 1);
    pool.setSize(0, 1, 1);
    pool.spawn();
    pool.setPosition(1, 3, 4, -2);
    pool.setLifetime(1, 1);
    pool.setSize(1, 2, 2);

    const min = new Vector3();
    const max = new Vector3();
    const bounded = node.computeBounds(min, max);

    expect(bounded).toBe(true);
    expect([min.x, min.y, min.z]).toEqual([-2, -1, -3]);
    expect([max.x, max.y, max.z]).toEqual([4, 5, 3]);
  });

  it("uses the current, ramped size rather than the start size", () => {
    const source = new ParticleEmitter({ maxParticles: 1 });
    const node = new ParticleRenderable(source);
    const pool = source.pool;
    pool.spawn();
    pool.setLifetime(0, 2);
    pool.setAge(0, 1); // halfway: size ramps 4 → 0, so the current size is 2
    pool.setSize(0, 4, 0);

    const min = new Vector3();
    const max = new Vector3();
    node.computeBounds(min, max);

    expect(min.x).toBe(-1);
    expect(max.x).toBe(1);
  });

  it("returns false and touches nothing when no particle is alive", () => {
    const node = new ParticleRenderable(emitter());
    const min = new Vector3(9, 9, 9);
    const max = new Vector3(9, 9, 9);

    expect(node.computeBounds(min, max)).toBe(false);
    expect([min.x, max.x]).toEqual([9, 9]);
  });

  it("reads the live pool, not the last repack", () => {
    const source = new ParticleEmitter({ maxParticles: 2 });
    const node = new ParticleRenderable(source);
    const pool: ParticlePool = source.pool;
    pool.spawn();
    pool.setPosition(0, 0, 0, 0);
    pool.setLifetime(0, 1);
    node.updateParticleInstances();

    pool.setPosition(0, 10, 0, 0);
    const min = new Vector3();
    const max = new Vector3();
    node.computeBounds(min, max);

    expect(min.x).toBe(10);
    expect(max.x).toBe(10);
  });
});
