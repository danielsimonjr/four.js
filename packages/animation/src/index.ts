/**
 * `@four/animation` — the public surface of the animation pillar (Part III).
 *
 * Named exports only (plan §1 rule 7), listed explicitly rather than re-exported
 * with `export *` so the package's API is readable in one file and a new symbol
 * is a deliberate act. Later packets extend this barrel (P4-5): `Timeline`
 * (§16), clips and tracks (§17), and the mixer/`AnimationSystem` (P4-1).
 */

export const PACKAGE_NAME = "@four/animation";

export type { PropertyBinding } from "./binding.js";
export { createBinding } from "./binding.js";

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
  TimelineChild,
  TimelineEntry,
  TimelineMarkerCallback,
  TimelineMarkerOptions,
  TimelineState,
} from "./timeline.js";
export { Timeline } from "./timeline.js";

export type { TweenProperties, TweenState, TweenValue } from "./tween.js";
export { Tween, animate, tween } from "./tween.js";

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
