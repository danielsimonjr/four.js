/** RFC 0007: 65,536 waypoint nodes, open grid and serpentine corridor. */
import { WaypointGraphPlanner } from "@fourjs/motion";
import { Vector3 } from "@fourjs/math";
import { hostRecord, measure, summarize, writeResult } from "./harness.mjs";
const size = 256;
const records = [];
for (const maze of [false, true]) {
  const planner = new WaypointGraphPlanner();
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) planner.addNode(new Vector3(x, y, 0));
  let edges = 0;
  const pair = (a, b) => {
    planner.addEdge(a, b);
    planner.addEdge(b, a);
    edges += 2;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (x + 1 < size) pair(i, i + 1);
      if (y + 1 < size && (!maze || x === (y % 2 === 0 ? size - 1 : 0)))
        pair(i, i + size);
    }
  const query = {
    start: new Vector3(),
    goal: new Vector3(maze ? 0 : size - 1, size - 1, 0),
  };
  let route;
  const times = measure(
    () => {
      route = planner.plan(query);
    },
    { warmupIterations: 3, measuredIterations: 10 },
  );
  if (
    route === null ||
    route.cost !== (maze ? size * size - 1 : 2 * (size - 1))
  )
    throw new Error("Unexpected path cost");
  records.push({
    scenario: maze ? "serpentine" : "open",
    nodes: size * size,
    directedEdges: edges,
    cost: route.cost,
    waypoints: route.waypoints.length,
    milliseconds: summarize(times.measured),
  });
  planner.dispose();
}
const result = {
  benchmark: "path-planning",
  recordedAt: new Date().toISOString(),
  host: hostRecord(),
  note: "Planning only; construction excluded. CPU measurements, no GPU claim.",
  records,
};
writeResult("path-planning", result);
console.log(JSON.stringify(result, null, 2));
