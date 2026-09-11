import { describe, it, expect } from "vitest";
import { Vector3 } from "@fourjs/math";
import {
  freezePlannedPath,
  validatePathQuery,
  plannedPathToTrajectory,
  PathPlannerRegistry,
  WaypointGraphPlanner,
  followWaypoints,
  PATH_PLANNERS,
  SeededRandom,
} from "../src/index.js";
const v = (x: number, y = 0) => new Vector3(x, y, 0);
describe("RFC 0007 path planning", () => {
  it("validates and copies caller data", () => {
    const points = [v(0), v(2)],
      radii = [1];
    const path = freezePlannedPath("test", 2, points, radii);
    points[0].x = 7;
    radii[0] = 9;
    expect(path.waypoints[0].x).toBe(0);
    expect(path.radii).toEqual([1]);
    expect(() => freezePlannedPath("x", 0, [v(0)])).toThrow(RangeError);
    expect(() => freezePlannedPath("x", Infinity, [v(0), v(1)])).toThrow(
      RangeError,
    );
    for (const bad of [[], [-1], [NaN], [1, 2]])
      expect(() => freezePlannedPath("x", 1, [v(0), v(1)], bad)).toThrow(
        RangeError,
      );
    validatePathQuery({ start: v(0), goal: v(1), radius: 0, maxExpansions: 1 });
    for (const start of [v(NaN), v(Infinity), new Vector3(0, 0, NaN)])
      expect(() => validatePathQuery({ start, goal: v(1) })).toThrow(
        RangeError,
      );
    for (const radius of [-1, NaN])
      expect(() =>
        validatePathQuery({ start: v(0), goal: v(1), radius }),
      ).toThrow(RangeError);
    for (const maxExpansions of [0, -1, NaN, 1.5])
      expect(() =>
        validatePathQuery({ start: v(0), goal: v(1), maxExpansions }),
      ).toThrow(RangeError);
  });
  it("converts to copied trajectories with arc-length timing", () => {
    const path = freezePlannedPath("x", 4, [v(0), v(1), v(4)]);
    const curve = plannedPathToTrajectory(path, { duration: 2 });
    expect(curve.samplePosition(0).x).toBeCloseTo(0);
    expect(curve.samplePosition(2).x).toBeCloseTo(4);
    const linear = plannedPathToTrajectory(path, {
      duration: 2,
      form: "linear",
    });
    expect(linear.samplePosition(1).x).toBe(2);
    expect(linear.samplePosition(-1).x).toBe(0);
    expect(linear.samplePosition(3).x).toBe(4);
    expect(linear.sampleVelocity(1).x).toBeCloseTo(2);
    expect(linear.sampleAcceleration(1).x).toBeCloseTo(0);
    path.waypoints[0].x = 99;
    expect(linear.samplePosition(0).x).toBe(0);
    const zero = plannedPathToTrajectory(
      freezePlannedPath("x", 0, [v(1), v(1)]),
      { duration: 1, form: "linear" },
    );
    expect(zero.samplePosition(0.5).x).toBe(1);
    const repeated = plannedPathToTrajectory(
      freezePlannedPath("x", 1, [v(0), v(0), v(1)]),
      { duration: 1, form: "linear" },
    );
    expect(repeated.samplePosition(0.5).x).toBe(0.5);
    expect(() => linear.samplePosition(NaN)).toThrow(RangeError);
    expect(() => plannedPathToTrajectory(path, { duration: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      plannedPathToTrajectory(path, { duration: 1, form: "bad" as "linear" }),
    ).toThrow(RangeError);
  });
  it("rejects finite inputs whose distances overflow", () => {
    const planner = new WaypointGraphPlanner();
    planner.addNode(v(1e308));
    planner.addNode(v(1.1e308));
    expect(() => planner.plan({ start: v(-1e308), goal: v(1e308) })).toThrow(
      RangeError,
    );
    const path = freezePlannedPath("x", 1, [v(-1e308), v(1e308)]);
    expect(() =>
      plannedPathToTrajectory(path, { duration: 1, form: "linear" }),
    ).toThrow(RangeError);
  });
  it("registers in order without exposing storage", () => {
    const registry = new PathPlannerRegistry(),
      planner = new WaypointGraphPlanner();
    expect(PATH_PLANNERS).toEqual({
      name: "fourJS:path-planners",
      revocable: false,
    });
    expect(registry.resolve("missing")).toBeNull();
    registry.register(planner);
    expect(registry.resolve(planner.name)).toBe(planner);
    expect(registry.list()).toEqual([planner]);
    expect(registry.list()).not.toBe(registry.list());
    expect(() => registry.register(planner)).toThrow(/already registered/);
    expect(() =>
      registry.register({
        name: "bad",
        version: "1",
        capabilities: { families: [], dimensions: [], determinism: "none" },
        plan: () => null,
        dispose() {},
      }),
    ).toThrow(RangeError);
  });
  it("finds cheap directed routes and honors limits and lifecycle", () => {
    const p = new WaypointGraphPlanner();
    [v(0), v(1), v(100), v(2)].forEach((x) => p.addNode(x));
    p.addEdge(0, 1, 5);
    p.addEdge(1, 3, 5);
    p.addEdge(0, 2, 1);
    p.addEdge(2, 3, 1);
    const q = { start: v(0), goal: v(2) };
    expect(p.plan(q)?.cost).toBe(2);
    expect(p.plan(q)?.waypoints.map((x) => x.x)).toEqual([0, 100, 2]);
    expect(p.plan(q)).toEqual(p.plan(q));
    expect(p.plan({ ...q, maxExpansions: 1 })).toBeNull();
    expect(p.plan({ start: q.goal, goal: q.start })).toBeNull();
    expect(p.plan({ start: v(0), goal: v(0) })).toBeNull();
    for (const edge of [
      [-1, 0],
      [0, 5],
      [0.5, 0],
    ])
      expect(() => p.addEdge(edge[0], edge[1])).toThrow(RangeError);
    for (const cost of [-1, NaN, Infinity])
      expect(() => p.addEdge(0, 1, cost)).toThrow(RangeError);
    expect(() => p.addNode(v(NaN))).toThrow(RangeError);
    p.dispose();
    p.dispose();
    expect(() => p.plan(q)).toThrow(/disposed/);
    expect(() => p.addNode(v(0))).toThrow(/disposed/);
    expect(() => p.addEdge(0, 1)).toThrow(/disposed/);
    expect(new WaypointGraphPlanner().plan(q)).toBeNull();
    for (const heuristicWeight of [-1, NaN, 2])
      expect(() => new WaypointGraphPlanner({ heuristicWeight })).toThrow(
        RangeError,
      );
  });
  it("resolves equal keys by edge insertion, not node id", () => {
    for (const first of [1, 2]) {
      const p = new WaypointGraphPlanner({ heuristicWeight: 0 });
      [v(0), v(1, 1), v(1, -1), v(2)].forEach((x) => p.addNode(x));
      p.addEdge(0, first, 1);
      p.addEdge(0, 3 - first, 1);
      p.addEdge(1, 3, 1);
      p.addEdge(2, 3, 1);
      expect(p.plan({ start: v(0), goal: v(2) })?.waypoints[1]!.y).toBe(
        first === 1 ? 1 : -1,
      );
    }
  });
  it("matches independent Floyd-Warshall costs on seeded graphs", () => {
    const random = new SeededRandom(7),
      p = new WaypointGraphPlanner(),
      n = 30;
    const d = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)),
    );
    for (let i = 0; i < n; i++) p.addNode(v(i, i % 3));
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (i !== j && random.nextFloat01() < 0.18) {
          const cost = Math.floor(random.nextFloat01() * 10);
          p.addEdge(i, j, cost);
          d[i][j] = cost;
        }
    for (let k = 0; k < n; k++)
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          d[i][j] = Math.min(d[i][j], d[i][k] + d[k][j]);
    for (let i = 0; i < 20; i++) {
      const j = 29 - i;
      expect(
        p.plan({ start: v(i, i % 3), goal: v(j, j % 3) })?.cost ?? Infinity,
      ).toBe(d[i][j]);
    }
  });
  it("uses Euclidean default costs and nearest-node ties", () => {
    const p = new WaypointGraphPlanner();
    p.addNode(v(-1));
    p.addNode(v(1));
    p.addNode(v(5));
    p.addEdge(0, 2);
    p.addEdge(1, 2);
    expect(p.plan({ start: v(0), goal: v(5) })?.cost).toBe(6);
  });
  it("follows waypoints deterministically and stops", () => {
    const path = freezePlannedPath("test", 6, [v(0), v(2), v(2, 2), v(4, 2)]);
    function run() {
      const context = {
          position: v(0),
          velocity: v(0),
          maxSpeed: 2,
          maxAcceleration: 4,
        },
        cursor = { index: 0 },
        out = v(0),
        history: number[] = [];
      for (let i = 0; i < 2000; i++) {
        expect(
          followWaypoints(
            context,
            path,
            cursor,
            { agentRadius: 0.2, slowRadius: 1 },
            out,
          ),
        ).toBe(out);
        context.position.add(context.velocity.clone().scale(1 / 60));
        context.velocity.add(out.clone().scale(1 / 60));
        history.push(context.position.x, context.position.y);
      }
      expect(context.position.x).toBeCloseTo(4, 3);
      expect(context.position.y).toBeCloseTo(2, 3);
      expect(context.velocity.length()).toBeLessThan(0.001);
      return history;
    }
    expect(run()).toEqual(run());
    const ctx = {
        position: v(0),
        velocity: v(0),
        maxSpeed: 2,
        maxAcceleration: 4,
      },
      out = v(0),
      cursor = { index: 0 };
    followWaypoints(
      ctx,
      freezePlannedPath("x", 1, [v(0), v(0.1), v(1)], [0.2, 0.2]),
      cursor,
      { agentRadius: 0.2 },
      out,
    );
    expect(cursor.index).toBe(2);
    cursor.index = 100;
    followWaypoints(ctx, path, cursor, { agentRadius: 1 }, out);
    expect(cursor.index).toBe(3);
    for (const agentRadius of [-1, NaN, 0])
      expect(() =>
        followWaypoints(ctx, path, { index: 0 }, { agentRadius }, out),
      ).toThrow(RangeError);
    for (const index of [-1, NaN, 0.1])
      expect(() =>
        followWaypoints(ctx, path, { index }, { agentRadius: 1 }, out),
      ).toThrow(RangeError);
    expect(() =>
      followWaypoints(
        ctx,
        { ...path, waypoints: [v(0)] },
        { index: 0 },
        { agentRadius: 1 },
        out,
      ),
    ).toThrow(RangeError);
  });
});
