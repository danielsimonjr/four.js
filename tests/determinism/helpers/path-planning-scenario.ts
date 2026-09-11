import { Vector3 } from "@fourjs/math";
import { WaypointGraphPlanner, followWaypoints } from "@fourjs/motion";
/** Fixed graph and explicit Euler steps: no renderer, timers, or random state. */
export function runPathPlanningScenario(): {
  cost: number;
  positions: number[];
} {
  const planner = new WaypointGraphPlanner();
  for (let i = 0; i < 12; i++) planner.addNode(new Vector3(i, i % 2, 0));
  for (let i = 0; i < 11; i++) planner.addEdge(i, i + 1, 1);
  const path = planner.plan({
    start: new Vector3(),
    goal: new Vector3(11, 1, 0),
  })!;
  const agent = {
    position: new Vector3(),
    velocity: new Vector3(),
    maxSpeed: 3,
    maxAcceleration: 8,
  };
  const cursor = { index: 0 },
    acceleration = new Vector3(),
    positions: number[] = [];
  for (let step = 0; step < 1200; step++) {
    followWaypoints(
      agent,
      path,
      cursor,
      { agentRadius: 0.4, slowRadius: 1 },
      acceleration,
    );
    agent.position.set(
      agent.position.x + agent.velocity.x / 60,
      agent.position.y + agent.velocity.y / 60,
      0,
    );
    agent.velocity.set(
      agent.velocity.x + acceleration.x / 60,
      agent.velocity.y + acceleration.y / 60,
      0,
    );
    positions.push(agent.position.x, agent.position.y);
  }
  planner.dispose();
  return { cost: path.cost, positions };
}
