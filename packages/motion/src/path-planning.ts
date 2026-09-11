/** Path-planning contracts and opt-in trajectory conversion (RFC 0007). */
import { FourError, type Disposable } from "@fourjs/core";
import { Vector3 } from "@fourjs/math";
import {
  CatmullRomTrajectory,
  ParametricTrajectory,
  type Trajectory,
} from "./trajectories.js";

/** A copied, world-space polyline. Costs use the planner's own units. */
export interface PlannedPath {
  readonly waypoints: readonly Vector3[];
  readonly radii?: readonly number[];
  readonly planner: string;
  readonly cost: number;
}
/** World-space query. A radius is in world units; no implicit unit conversion. */
export interface PathQuery {
  readonly start: Vector3;
  readonly goal: Vector3;
  readonly radius?: number;
  readonly maxExpansions?: number;
}
/** §33 determinism tiers, kept local to avoid a motion → physics dependency. */
export type PathPlannerDeterminism =
  "none" | "same-runtime" | "same-platform" | "cross-platform";
/** Features explicitly supported by an adapter. */
export interface PathPlannerCapabilities {
  readonly families: readonly ("grid" | "navmesh" | "waypoint")[];
  readonly dimensions: readonly ("2d" | "3d")[];
  readonly determinism: PathPlannerDeterminism;
}
/** Synchronous planning; a missing route is null. No transform writes or clocks. */
export interface PathPlannerAdapter extends Disposable {
  readonly name: string;
  readonly version: string;
  readonly capabilities: PathPlannerCapabilities;
  plan(query: PathQuery): PlannedPath | null;
}
function finitePoint(point: Vector3): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}
/** Common authoring validation for planner adapters. */
export function validatePathQuery(query: PathQuery): void {
  if (!finitePoint(query.start) || !finitePoint(query.goal))
    throw new RangeError("Path endpoints must be finite (§85).");
  if (
    query.radius !== undefined &&
    (!Number.isFinite(query.radius) || query.radius < 0)
  )
    throw new RangeError("Path radius must be finite and non-negative (§85).");
  if (
    query.maxExpansions !== undefined &&
    (!Number.isSafeInteger(query.maxExpansions) || query.maxExpansions <= 0)
  )
    throw new RangeError(
      "maxExpansions must be a positive safe integer (§85).",
    );
}
/** Copies caller-owned vectors and arrays; no planner scratch is exposed. */
export function freezePlannedPath(
  planner: string,
  cost: number,
  waypoints: readonly Vector3[],
  radii?: readonly number[],
): PlannedPath {
  if (
    !Number.isFinite(cost) ||
    waypoints.length < 2 ||
    !waypoints.every(finitePoint)
  )
    throw new RangeError(
      "A path needs a finite cost and at least two finite waypoints (§85).",
    );
  if (
    radii !== undefined &&
    (radii.length !== waypoints.length - 1 ||
      radii.some((r) => !Number.isFinite(r) || r < 0))
  )
    throw new RangeError(
      "Path radii must be finite non-negative values, one per segment (§85).",
    );
  const copy = Object.freeze(waypoints.map((point) => point.clone()));
  return Object.freeze(
    radii === undefined
      ? { planner, cost, waypoints: copy }
      : { planner, cost, waypoints: copy, radii: Object.freeze([...radii]) },
  );
}
/** Conversion supplies the clock a planned path intentionally does not have. */
export interface PlannedPathToTrajectoryOptions {
  readonly duration: number;
  readonly form?: "catmull-rom" | "linear";
}
/** Convert a path to a trajectory. Linear form travels at constant arc-length speed. */
export function plannedPathToTrajectory(
  path: PlannedPath,
  options: PlannedPathToTrajectoryOptions,
): Trajectory {
  if (!Number.isFinite(options.duration) || options.duration <= 0)
    throw new RangeError("Path duration must be finite and positive (§85).");
  const points = freezePlannedPath(
    path.planner,
    path.cost,
    path.waypoints,
    path.radii,
  ).waypoints;
  if (options.form === undefined || options.form === "catmull-rom")
    return new CatmullRomTrajectory({ points, duration: options.duration });
  if (options.form !== "linear")
    throw new RangeError("Unknown path trajectory form (§85).");
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    lengths.push(lengths[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const total = lengths[lengths.length - 1];
  if (!Number.isFinite(total))
    throw new RangeError("Path length exceeds finite precision (§85).");
  return new ParametricTrajectory({
    duration: options.duration,
    position(time, out) {
      if (!Number.isFinite(time))
        throw new RangeError("Path sample time must be finite (§85).");
      if (total === 0 || time <= 0) return out.copy(points[0]);
      if (time >= options.duration) return out.copy(points[points.length - 1]);
      const distance = total * (time / options.duration);
      let low = 1,
        high = lengths.length - 1;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (lengths[mid] <= distance) low = mid + 1;
        else high = mid;
      }
      const a = points[low - 1],
        b = points[low];
      const t =
        (distance - lengths[low - 1]) / (lengths[low] - lengths[low - 1]);
      return out.set(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
      );
    },
  });
}
/** Explicit registry; list order is registration order. */
export class PathPlannerRegistry {
  readonly #adapters = new Map<string, PathPlannerAdapter>();
  register(adapter: PathPlannerAdapter): void {
    if (this.#adapters.has(adapter.name))
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `Planner already registered: ${adapter.name}`,
      );
    if (adapter.capabilities.determinism === "none")
      throw new RangeError(
        "Planners must support same-runtime determinism or stronger (§85).",
      );
    this.#adapters.set(adapter.name, adapter);
  }
  resolve(name: string): PathPlannerAdapter | null {
    return this.#adapters.get(name) ?? null;
  }
  list(): readonly PathPlannerAdapter[] {
    return [...this.#adapters.values()];
  }
}
