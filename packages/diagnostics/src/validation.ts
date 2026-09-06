/**
 * §85's validation catalogue (A-4 remainder step 2, 2026-09-06).
 */

import { DEV, devAssert, devWarnOnce } from "@four/core";

export const COORDINATE_ENVELOPE = 1e5;
export const UNSTABLE_SCALE_RATIO = 1e4;
export const NEAR_ZERO_SCALE = 1e-6;

export interface ValidationCheckOptions {
  readonly enabled?: boolean;
}

export interface ValidationCatalogueOptions {
  readonly finite?: ValidationCheckOptions;
  readonly coordinateEnvelope?: ValidationCheckOptions;
  readonly singularTransform?: ValidationCheckOptions;
  readonly unstableScale?: ValidationCheckOptions;
  readonly sceneGraphCycle?: ValidationCheckOptions;
}

export interface ValidationNodeLike {
  readonly id: string;
  readonly parent: ValidationNodeLike | null;
  readonly children: readonly ValidationNodeLike[];
}

export interface ValidationTransformLike {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly scale: { readonly x: number; readonly y: number; readonly z: number };
}

function checkEnabled(
  options: ValidationCheckOptions | undefined,
  defaultEnabled: boolean,
): boolean {
  if (!DEV) return false;
  return options?.enabled ?? defaultEnabled;
}

export function warnCoordinateEnvelope(
  position: { readonly x: number; readonly y: number; readonly z: number },
  context: string,
  options?: ValidationCheckOptions,
): boolean {
  if (!checkEnabled(options, true)) return false;
  const farthest = Math.max(
    Math.abs(position.x),
    Math.abs(position.y),
    Math.abs(position.z),
  );
  if (farthest <= COORDINATE_ENVELOPE) return false;
  return devWarnOnce(
    `coordinate-envelope:${context}`,
    `§41/§85: ${context} is ${String(farthest)} units from the origin; ` +
      `32-bit float positions lose sub-millimetre fidelity beyond roughly ` +
      `${String(COORDINATE_ENVELOPE)} units. Keep the simulated region within ` +
      "that envelope, or re-centre the world.",
  );
}

export function warnSingularScale(
  scale: { readonly x: number; readonly y: number; readonly z: number },
  context: string,
  options?: ValidationCheckOptions,
): boolean {
  if (!checkEnabled(options, true)) return false;
  if (scale.x !== 0 && scale.y !== 0 && scale.z !== 0) return false;
  return devWarnOnce(
    `singular-scale:${context}`,
    `§85: ${context} has a zero scale component (${String(scale.x)}, ` +
      `${String(scale.y)}, ${String(scale.z)}), so its world matrix is ` +
      "singular and inversion will refuse.",
  );
}

export function warnUnstableScale(
  scale: { readonly x: number; readonly y: number; readonly z: number },
  context: string,
  options?: ValidationCheckOptions,
): boolean {
  if (!checkEnabled(options, true)) return false;
  const ax = Math.abs(scale.x);
  const ay = Math.abs(scale.y);
  const az = Math.abs(scale.z);
  const max = Math.max(ax, ay, az);
  const min = Math.min(ax, ay, az);
  if (min > 0 && max / min > UNSTABLE_SCALE_RATIO) {
    return devWarnOnce(
      `unstable-scale:${context}`,
      `§85: ${context} scale components differ by more than ` +
        `${String(UNSTABLE_SCALE_RATIO)}:1 (${String(scale.x)}, ${String(scale.y)}, ` +
        `${String(scale.z)}). Extreme ratios amplify floating-point error in ` +
        "world-matrix composition.",
    );
  }
  if (max > 0 && min < NEAR_ZERO_SCALE) {
    return devWarnOnce(
      `near-zero-scale:${context}`,
      `§85: ${context} has a near-zero scale component (${String(scale.x)}, ` +
        `${String(scale.y)}, ${String(scale.z)}). Treat world units consistently ` +
        "rather than mixing large and microscopic scales on one node.",
    );
  }
  return false;
}

export function assertFinite(
  value: number,
  field: string,
  options?: ValidationCheckOptions,
): void {
  if (!checkEnabled(options, true)) return;
  devAssert(
    Number.isFinite(value),
    "INVALID_APPLICATION_STATE",
    `${field} must be a finite number; got ${String(value)} (§85).`,
    { field, value },
  );
}

export function assertNoSceneGraphCycle(
  node: ValidationNodeLike,
  candidate: ValidationNodeLike,
  options?: ValidationCheckOptions,
): void {
  if (!checkEnabled(options, true)) return;
  devAssert(
    candidate !== node,
    "INVALID_SCENE_GRAPH",
    "A node cannot be added to itself (§85: scene graph cycles).",
    { node: node.id, candidate: candidate.id },
  );
  let walk: ValidationNodeLike | null = node;
  while (walk !== null) {
    devAssert(
      walk !== candidate,
      "INVALID_SCENE_GRAPH",
      "A node cannot be added to one of its own descendants " +
        "(§85: scene graph cycles).",
      { node: node.id, candidate: candidate.id, ancestor: walk.id },
    );
    walk = walk.parent;
  }
}

export function validateSceneNode(
  node: ValidationNodeLike & { readonly transform: ValidationTransformLike },
  options: ValidationCatalogueOptions = {},
): number {
  if (!DEV) return 0;
  let warnings = 0;
  const context = `node ${node.id}`;
  if (
    warnCoordinateEnvelope(node.transform.position, context, options.coordinateEnvelope)
  ) {
    warnings += 1;
  }
  if (warnSingularScale(node.transform.scale, context, options.singularTransform)) {
    warnings += 1;
  }
  if (warnUnstableScale(node.transform.scale, context, options.unstableScale)) {
    warnings += 1;
  }
  return warnings;
}

export function validateSceneSubtree(
  root: ValidationNodeLike & { readonly transform: ValidationTransformLike },
  options: ValidationCatalogueOptions = {},
): number {
  if (!DEV) return 0;
  let warnings = validateSceneNode(root, options);
  for (const child of root.children) {
    warnings += validateSceneSubtree(
      child as ValidationNodeLike & { readonly transform: ValidationTransformLike },
      options,
    );
  }
  return warnings;
}
