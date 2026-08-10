/**
 * §8 *Space Modes* — the vocabulary, and the one rule §8 states (PH-12,
 * 2026-08-09).
 *
 * §8 is a union and two sentences:
 *
 * ```ts
 * type SpaceMode =
 *   | "world" | "screen" | "viewport" | "camera" | "billboard" | "local-plane";
 * ```
 *
 * > Physics normally operates in world or local-plane space. Screen-space UI
 * > should not automatically participate in physical simulation unless
 * > explicitly mapped to a simulation plane.
 *
 * {@link SpaceMode} is that union transcribed member-for-member and
 * {@link isSimulationSpaceMode} is the first sentence as a predicate. Nothing
 * here has behaviour: it is vocabulary, and it lives in `@four/core` because
 * §8's two halves belong to two pillars that may not import each other.
 * `"world"` and `"local-plane"` are physics's business (§21 maps a local plane
 * onto a `"2d"` world's XY frame); `"screen"`, `"viewport"`, `"camera"` and
 * `"billboard"` are the render, camera and UI pillars'. A vocabulary more than
 * one pillar needs has to live below all of them or each grows its own copy —
 * the exact argument that hoisted `DEFAULT_GRAVITY_Y` here on 2026-08-04,
 * applied to a type instead of to a number.
 *
 * ## Who reads this today, and who does not — read before authoring a mode
 *
 * | Consumer | State |
 * | --- | --- |
 * | `@four/physics` | **ships** (PH-8/PH-12): `RigidBody.space` declares the frame a body is solved in, and `PhysicsWorld.addBody` refuses every value it cannot honour — which is §8's second sentence, enforced. |
 * | renderer / camera / UI | **not implemented.** No package places a node by a §8 mode; screen-space presentation is §47/§48/§74's business and the flagship's camera-parented panel is the standing workaround. |
 *
 * So this module makes §8 *sayable* everywhere and makes the physics half of it
 * *true*. It does not make anything render in screen space.
 *
 * ## The node-level declaration is staged, and here is its blocker
 *
 * §8 sits in Part I beside §7's transform, which reads like a property of a
 * *node* rather than of a body — a screen-space panel is in screen space
 * whether or not anyone ever gives it a `RigidBody`. The §6a spelling of that
 * is a one-field component, and it is deliberately **not shipped yet**: a
 * component class carries a `static typeName`, which is §79's serialization
 * key, and a component with no registered serializer makes `serializeScene`
 * *throw* by default. Shipping the class before its serializer is registered
 * (`registerSceneNodeTypes`, in the umbrella package) would turn "the mode is
 * not persisted" into "a scene containing one cannot be saved at all". The two
 * land together, in one packet, with the render-side consumer that gives the
 * four presentation modes a meaning.
 */

/**
 * §8's space modes, transcribed member-for-member.
 *
 * - `"world"` — the scene's own frame; the default, and the only frame the
 *   simulation runs in today.
 * - `"screen"` — pixels of the output surface.
 * - `"viewport"` — normalized coordinates of the active viewport.
 * - `"camera"` — the active camera's eye frame.
 * - `"billboard"` — positioned in world space, oriented to face the camera.
 * - `"local-plane"` — a 2D frame carried by a plane in a 3D world; §21 maps it
 *   onto the XY frame of a `"2d"` physics world.
 */
export type SpaceMode =
  "world" | "screen" | "viewport" | "camera" | "billboard" | "local-plane";

/**
 * The mode assumed when none is declared: `"world"`.
 *
 * Every other mode is a frame something opts into, which is what makes §8
 * additive — no scene written before PH-12 changes meaning.
 */
export const DEFAULT_SPACE_MODE: SpaceMode = "world";

/**
 * §8's modes in declaration order, for validators and editors that enumerate
 * them. Frozen: a caller that sorted or spliced it would change every later
 * reader's answer.
 */
export const SPACE_MODES: readonly SpaceMode[] = Object.freeze([
  "world",
  "screen",
  "viewport",
  "camera",
  "billboard",
  "local-plane",
] as const);

/**
 * Whether §8 lets a physical simulation operate in `mode` at all — "physics
 * normally operates in world or local-plane space", so exactly `"world"` and
 * `"local-plane"` answer `true`.
 *
 * This is the **specification's** line, not an implementation status: a `true`
 * here does not promise that any package can simulate the mode. `"local-plane"`
 * is legal under §8 and is still refused by `PhysicsWorld.addBody`, because
 * §21's plane→XY mapping does not exist yet. The two questions are deliberately
 * separate so that neither can quietly answer the other — a packet implementing
 * §21's mapping changes the refusal and leaves this predicate alone.
 */
export function isSimulationSpaceMode(mode: SpaceMode): boolean {
  return mode === "world" || mode === "local-plane";
}
