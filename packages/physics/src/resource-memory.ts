/** §83 resource accounting for solver registrations (A-5 follow-up). */

let liveSolverBodies = 0;

export function noteSolverBody(instances: number): void {
  liveSolverBodies += instances;
}

export function liveSolverBodyCount(): number {
  return liveSolverBodies;
}
