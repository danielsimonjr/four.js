/** §83 resource accounting for materials (A-5 follow-up). */

let liveMaterials = 0;

export function noteMaterial(instances: number): void {
  liveMaterials += instances;
}

export function liveMaterialCount(): number {
  return liveMaterials;
}
