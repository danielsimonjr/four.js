/**
 * `@four/animation` — the public surface of the animation pillar (Part III).
 *
 * Named exports only (plan §1 rule 7), listed explicitly rather than re-exported
 * with `export *` so the package's API is readable in one file and a new symbol
 * is a deliberate act (P4-5).
 *
 * A few symbols in `./tween.js` are deliberately **not** here: `claimProperty`
 * and `releaseProperty`, the §16 conflict registry that `./mixer.js` shares
 * with tweens, together with the `PropertyClaim` and `isTransformOwner` they
 * need, and the shared `requireNonNegativeSeconds` seconds validator (§7a).
 * They are cross-module plumbing inside this package, not API.
 */

export const PACKAGE_NAME = "@four/animation";

export type {
  Advanceable,
  AnimationPlaybackState,
  AnimationSystemOptions,
} from "./animation-system.js";
export { AnimationSystem } from "./animation-system.js";

export type { PropertyBinding } from "./binding.js";
export { createArrayElementBinding, createBinding } from "./binding.js";

export type {
  AnimationClipOptions,
  AnimationEvent,
  AnimationEventVisitor,
  TrackSampleSink,
} from "./clip.js";
export { AnimationClip } from "./clip.js";

export type {
  BlendTree,
  BlendTree1D,
  BlendTree1DPoint,
  BlendTree2D,
  BlendTree2DPoint,
} from "./blend-tree.js";
export { isBlendTree } from "./blend-tree.js";

export type {
  AnimationControllerOptions,
  AnimationControllerParameters,
  AnimationStateInput,
  AnimationStateOptions,
  AnimationTransition,
  BooleanCondition,
  ControllerAdvanceOptions,
  ControllerPlaybackState,
  NumericComparison,
  NumericCondition,
  StateChangeListener,
  TransitionCondition,
  TransitionWhen,
  TriggerCondition,
} from "./controller.js";
export { ANY_STATE, AnimationController } from "./controller.js";

export type {
  AnimationLayer,
  AnimationLayerStackOptions,
} from "./layer-stack.js";
export { AnimationLayerStack } from "./layer-stack.js";

export type { EasingFunction, EasingName } from "./easing.js";
export {
  BACK_OVERSHOOT,
  BACK_OVERSHOOT_IN_OUT,
  BOUNCE_AMPLITUDE,
  BOUNCE_SEGMENT_DIVISOR,
  EASINGS,
  EASING_NAMES,
  ELASTIC_AMPLITUDE,
  ELASTIC_PERIOD,
  ELASTIC_PERIOD_IN_OUT,
  SPRING_DAMPING_RATIO,
  SPRING_OSCILLATIONS,
  backIn,
  backInOut,
  backOut,
  bounceIn,
  bounceInOut,
  bounceOut,
  circularIn,
  circularInOut,
  circularOut,
  cubicIn,
  cubicInOut,
  cubicOut,
  elasticIn,
  elasticInOut,
  elasticOut,
  exponentialIn,
  exponentialInOut,
  exponentialOut,
  linear,
  quadraticIn,
  quadraticInOut,
  quadraticOut,
  quarticIn,
  quarticInOut,
  quarticOut,
  quinticIn,
  quinticInOut,
  quinticOut,
  resolveEasing,
  sineIn,
  sineInOut,
  sineOut,
  springIn,
  springInOut,
  springOut,
} from "./easing.js";

export type {
  AnimationEventListener,
  MixerPlayOptions,
  MixerRootMotionOptions,
  MixerState,
} from "./mixer.js";
export { AnimationMixer } from "./mixer.js";

export type {
  TimelineChild,
  TimelineEntry,
  TimelineMarkerCallback,
  TimelineMarkerOptions,
  TimelineState,
} from "./timeline.js";
export { Timeline } from "./timeline.js";

export type {
  AnimationTrackLike,
  AnimationTrackOptions,
  InterpolationMode,
} from "./track.js";
export { AnimationTrack } from "./track.js";

export type { TweenProperties, TweenState, TweenValue } from "./tween.js";
export { Tween, animate, tween } from "./tween.js";

export type { WhenParameterLookup } from "./when.js";
export { compileWhenExpression } from "./when.js";

export type { ColorRGBA, ValueAdapter, ValueKind } from "./values.js";
export {
  booleanAdapter,
  colorAdapter,
  detectAdapter,
  discreteAdapter,
  discreteAdapterFor,
  numberAdapter,
  quaternionAdapter,
  vector2Adapter,
  vector3Adapter,
  vector4Adapter,
} from "./values.js";
