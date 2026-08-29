/**
 * The four-line adapter RFC 0005 §2 promised (§71, §45; 2026-08-28): a
 * `@four/render` `PickingService` presented as `@four/input`'s structural
 * `PickProvider`.
 *
 * It lives here because the umbrella is the one layer that may name both
 * sides: `@four/input` may not import a render type (plan §3.1 — the whole
 * reason the seam exists), and `@four/render` has no business knowing what a
 * pointer handler looks like. `Application` never references it — an
 * application that never picks by pixel carries 0 B of this function (the
 * A-8 discipline; it tree-shakes like any unused export).
 */

import type { PickProvider } from "@four/input";
import type { PickingService } from "@four/render";
import type { Viewport } from "@four/scene";

/**
 * Adapts `service` — already updated against `viewport` by the caller's
 * frame — into the render-free {@link PickProvider} shape a pointer handler
 * consults (§71, §72; RFC 0005).
 *
 * ```ts
 * registerPickingPipeline();
 * const picking = renderer.createPickingService!();
 * const provider = createPickProvider(picking, view);
 * // per frame that wants pixel picking:
 * picking.update(scene, view);
 * // in a pointer handler:
 * const nodeId = await provider.pick(ndcX, ndcY);
 * ```
 *
 * The provider closes over one viewport because the service's id buffer
 * holds exactly one view's pass; an application with several pickable views
 * makes one provider per view. What is deliberately dropped is the
 * `PickResult.frame` ordinal — the seam's contract is identity only; a
 * caller that needs to reason about staleness holds the service and calls
 * `pick` on it directly.
 */
export function createPickProvider(
  service: PickingService,
  viewport: Viewport,
): PickProvider {
  return {
    async pick(ndcX: number, ndcY: number): Promise<string | undefined> {
      const result = await service.pick({ viewport, ndcX, ndcY });
      return result.nodeId;
    },
  };
}
