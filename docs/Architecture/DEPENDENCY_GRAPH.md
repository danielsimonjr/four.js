# four.js-monorepo - Dependency Graph

**Version**: 0.0.0 | **Last Updated**: 2026-08-29

This document provides a comprehensive dependency graph of all files, components, imports, functions, and variables in the codebase.

---

## Table of Contents

1. [Overview](#overview)
2. [Package Dependencies](#package-dependencies)
3. [Packages/animation Dependencies](#packages-animation-dependencies)
4. [Packages/assets Dependencies](#packages-assets-dependencies)
5. [Packages/core Dependencies](#packages-core-dependencies)
6. [Packages/diagnostics Dependencies](#packages-diagnostics-dependencies)
7. [Packages/four Dependencies](#packages-four-dependencies)
8. [Packages/geometry Dependencies](#packages-geometry-dependencies)
9. [Packages/input Dependencies](#packages-input-dependencies)
10. [Packages/materials Dependencies](#packages-materials-dependencies)
11. [Packages/math Dependencies](#packages-math-dependencies)
12. [Packages/motion Dependencies](#packages-motion-dependencies)
13. [Packages/particles Dependencies](#packages-particles-dependencies)
14. [Packages/physics Dependencies](#packages-physics-dependencies)
15. [Packages/physics box2d Dependencies](#packages-physics-box2d-dependencies)
16. [Packages/physics rapier Dependencies](#packages-physics-rapier-dependencies)
17. [Packages/physics soft Dependencies](#packages-physics-soft-dependencies)
18. [Packages/render Dependencies](#packages-render-dependencies)
19. [Packages/render canvas Dependencies](#packages-render-canvas-dependencies)
20. [Packages/render svg Dependencies](#packages-render-svg-dependencies)
21. [Packages/render webgl Dependencies](#packages-render-webgl-dependencies)
22. [Packages/render webgpu Dependencies](#packages-render-webgpu-dependencies)
23. [Packages/scene Dependencies](#packages-scene-dependencies)
24. [Packages/serialization Dependencies](#packages-serialization-dependencies)
25. [Packages/text Dependencies](#packages-text-dependencies)
26. [Packages/ui Dependencies](#packages-ui-dependencies)
27. [Dependency Matrix](#dependency-matrix)
28. [Circular Dependency Analysis](#circular-dependency-analysis)
29. [Visual Dependency Graph](#visual-dependency-graph)
30. [Summary Statistics](#summary-statistics)

---

<a id="overview"></a>
## Overview

The codebase is organized into the following modules:

- **packages/animation**: 11 files
- **packages/assets**: 6 files
- **packages/core**: 13 files
- **packages/diagnostics**: 9 files
- **packages/four**: 29 files
- **packages/geometry**: 10 files
- **packages/input**: 8 files
- **packages/materials**: 11 files
- **packages/math**: 10 files
- **packages/motion**: 19 files
- **packages/particles**: 8 files
- **packages/physics**: 20 files
- **packages/physics-box2d**: 1 file
- **packages/physics-rapier**: 8 files
- **packages/physics-soft**: 1 file
- **packages/render**: 22 files
- **packages/render-canvas**: 1 file
- **packages/render-svg**: 1 file
- **packages/render-webgl**: 18 files
- **packages/render-webgpu**: 23 files
- **packages/scene**: 16 files
- **packages/serialization**: 4 files
- **packages/text**: 4 files
- **packages/ui**: 13 files

---

<a id="package-dependencies"></a>
## Package Dependencies

| Package | Depends On | Files (Active) | Files (Dormant) |
|---------|------------|----------------|-----------------|
| `@four/animation` (`packages/animation/`) | `@four/motion`, `@four/core`, `@four/scene`, `@four/math` | 11 | 0 |
| `@four/assets` (`packages/assets/`) | `@four/core` | 6 | 0 |
| `@four/core` (`packages/core/`) | (none) | 13 | 0 |
| `@four/diagnostics` (`packages/diagnostics/`) | `@four/math`, `@four/core` | 9 | 0 |
| `four` (`packages/four/`) | `@four/animation`, `@four/core`, `@four/diagnostics`, `@four/geometry`, `@four/motion`, `@four/math`, `@four/assets`, `@four/physics`, `@four/scene`, `@four/render`, `@four/input`, `@four/materials`, `@four/particles`, `@four/physics-box2d`, `@four/physics-rapier`, `@four/physics-soft`, `@four/serialization`, `@four/render-canvas`, `@four/render-svg`, `@four/render-webgl`, `@four/render-webgpu`, `@four/text`, `@four/ui` | 29 | 0 |
| `@four/geometry` (`packages/geometry/`) | `@four/math`, `@four/core` | 10 | 0 |
| `@four/input` (`packages/input/`) | `@four/core`, `@four/math`, `@four/scene` | 8 | 0 |
| `@four/materials` (`packages/materials/`) | `@four/core`, `@four/math` | 11 | 0 |
| `@four/math` (`packages/math/`) | (none) | 10 | 0 |
| `@four/motion` (`packages/motion/`) | `@four/core`, `@four/math`, `@four/scene` | 19 | 0 |
| `@four/particles` (`packages/particles/`) | `@four/math`, `@four/core`, `@four/scene` | 8 | 0 |
| `@four/physics` (`packages/physics/`) | `@four/core`, `@four/math`, `@four/scene`, `@four/motion` | 20 | 0 |
| `@four/physics-box2d` (`packages/physics-box2d/`) | (none) | 1 | 0 |
| `@four/physics-rapier` (`packages/physics-rapier/`) | `@four/physics`, `@four/core`, `@four/math` | 8 | 0 |
| `@four/physics-soft` (`packages/physics-soft/`) | (none) | 1 | 0 |
| `@four/render` (`packages/render/`) | `@four/geometry`, `@four/materials`, `@four/math`, `@four/scene`, `@four/core` | 22 | 0 |
| `@four/render-canvas` (`packages/render-canvas/`) | (none) | 1 | 0 |
| `@four/render-svg` (`packages/render-svg/`) | (none) | 1 | 0 |
| `@four/render-webgl` (`packages/render-webgl/`) | `@four/math`, `@four/render`, `@four/core` | 18 | 0 |
| `@four/render-webgpu` (`packages/render-webgpu/`) | `@four/render`, `@four/core`, `@four/math`, `@four/scene` | 23 | 0 |
| `@four/scene` (`packages/scene/`) | `@four/math`, `@four/core` | 16 | 0 |
| `@four/serialization` (`packages/serialization/`) | `@four/core`, `@four/scene`, `@four/math` | 4 | 0 |
| `@four/text` (`packages/text/`) | (none) | 4 | 0 |
| `@four/ui` (`packages/ui/`) | `@four/input`, `@four/math`, `@four/core`, `@four/scene`, `@four/text` | 13 | 0 |

### Package Dependency Diagram

```mermaid
graph LR
    P0[packages/animation]
    P1[packages/assets]
    P2[packages/core]
    P3[packages/diagnostics]
    P4[packages/four]
    P5[packages/geometry]
    P6[packages/input]
    P7[packages/materials]
    P8[packages/math]
    P9[packages/motion]
    P10[packages/particles]
    P11[packages/physics]
    P12[packages/physics-box2d]
    P13[packages/physics-rapier]
    P14[packages/physics-soft]
    P15[packages/render]
    P16[packages/render-canvas]
    P17[packages/render-svg]
    P18[packages/render-webgl]
    P19[packages/render-webgpu]
    P20[packages/scene]
    P21[packages/serialization]
    P22[packages/text]
    P23[packages/ui]
    P0 --> P9
    P0 --> P2
    P0 --> P20
    P0 --> P8
    P1 --> P2
    P3 --> P8
    P3 --> P2
    P4 --> P0
    P4 --> P2
    P4 --> P3
    P4 --> P5
    P4 --> P9
    P4 --> P8
    P4 --> P1
    P4 --> P11
    P4 --> P20
    P4 --> P15
    P4 --> P6
    P4 --> P7
    P4 --> P10
    P4 --> P12
    P4 --> P13
    P4 --> P14
    P4 --> P21
    P4 --> P16
    P4 --> P17
    P4 --> P18
    P4 --> P19
    P4 --> P22
    P4 --> P23
    P5 --> P8
    P5 --> P2
    P6 --> P2
    P6 --> P8
    P6 --> P20
    P7 --> P2
    P7 --> P8
    P9 --> P2
    P9 --> P8
    P9 --> P20
    P10 --> P8
    P10 --> P2
    P10 --> P20
    P11 --> P2
    P11 --> P8
    P11 --> P20
    P11 --> P9
    P13 --> P11
    P13 --> P2
    P13 --> P8
    P15 --> P5
    P15 --> P7
    P15 --> P8
    P15 --> P20
    P15 --> P2
    P18 --> P8
    P18 --> P15
    P18 --> P2
    P19 --> P15
    P19 --> P2
    P19 --> P8
    P19 --> P20
    P20 --> P8
    P20 --> P2
    P21 --> P2
    P21 --> P20
    P21 --> P8
    P23 --> P6
    P23 --> P8
    P23 --> P2
    P23 --> P20
    P23 --> P22
```

---

<a id="packages-animation-dependencies"></a>

## Packages/animation Dependencies

### `packages/animation/src/animation-system.ts` - The fixed-step animation system (§39 step 3, plan decision P4-1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/motion` | `PRIORITY_ANIMATION_TARGETS, FixedUpdateContext, SimulationSystem` |

**Exports:**
- Classes: `AnimationSystem`
- Interfaces: `Advanceable`, `AnimationSystemOptions`
- Types: `AnimationPlaybackState`

---

### `packages/animation/src/binding.ts` - Property bindings (§16).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./values.js` | `detectAdapter, numberAdapter, ValueAdapter` | Import |

**Exports:**
- Interfaces: `PropertyBinding`
- Functions: `createBinding`, `createArrayElementBinding`

---

### `packages/animation/src/clip.ts` - Animation clips (§17).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./track.js` | `AnimationTrackLike` | Import (type-only) |

**Exports:**
- Classes: `AnimationClip`
- Interfaces: `AnimationEvent`, `TrackSampleSink`, `AnimationClipOptions`
- Types: `AnimationEventVisitor`

---

### `packages/animation/src/controller.ts` - §18 animation state machines — {@link AnimationController}.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/scene` | `Node, warnAuthorityConflict` |
| `@four/scene` | `TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./animation-system.js` | `Advanceable` | Import (type-only) |
| `./binding.js` | `createBinding, PropertyBinding` | Import |
| `./clip.js` | `AnimationClip` | Import (type-only) |
| `./track.js` | `AnimationTrackLike` | Import (type-only) |
| `./tween.js` | `claimProperty, isTransformOwner, releaseProperty, requireNonNegativeSeconds, PropertyClaim` | Import |
| `./values.js` | `detectAdapter, ValueAdapter` | Import |

**Exports:**
- Classes: `AnimationController`
- Interfaces: `AnimationStateOptions`, `NumericCondition`, `BooleanCondition`, `TriggerCondition`, `AnimationTransition`, `AnimationControllerParameters`, `AnimationControllerOptions`
- Types: `ControllerPlaybackState`, `AnimationStateInput`, `NumericComparison`, `TransitionCondition`, `StateChangeListener`

---

### `packages/animation/src/easing.ts` - Easing functions (§15).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Exports:**
- Types: `EasingFunction`, `EasingName`
- Functions: `resolveEasing`
- Constants: `BACK_OVERSHOOT`, `BACK_OVERSHOOT_IN_OUT`, `BOUNCE_AMPLITUDE`, `BOUNCE_SEGMENT_DIVISOR`, `ELASTIC_AMPLITUDE`, `ELASTIC_PERIOD`, `ELASTIC_PERIOD_IN_OUT`, `SPRING_DAMPING_RATIO`, `SPRING_OSCILLATIONS`, `linear`, `quadraticIn`, `quadraticOut`, `quadraticInOut`, `cubicIn`, `cubicOut`, `cubicInOut`, `quarticIn`, `quarticOut`, `quarticInOut`, `quinticIn`, `quinticOut`, `quinticInOut`, `sineIn`, `sineOut`, `sineInOut`, `exponentialIn`, `exponentialOut`, `exponentialInOut`, `circularIn`, `circularOut`, `circularInOut`, `backIn`, `backOut`, `backInOut`, `bounceOut`, `bounceIn`, `bounceInOut`, `elasticIn`, `elasticOut`, `elasticInOut`, `springOut`, `springIn`, `springInOut`, `EASINGS`, `EASING_NAMES`

---

### `packages/animation/src/index.ts` - `@four/animation` — the public surface of the animation pillar (Part III).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./animation-system.js` | `AnimationSystem` | Re-export |
| `./binding.js` | `createArrayElementBinding, createBinding` | Re-export |
| `./clip.js` | `AnimationClip` | Re-export |
| `./controller.js` | `AnimationController` | Re-export |
| `./easing.js` | `BACK_OVERSHOOT, BACK_OVERSHOOT_IN_OUT, BOUNCE_AMPLITUDE, BOUNCE_SEGMENT_DIVISOR, EASINGS, EASING_NAMES, ELASTIC_AMPLITUDE, ELASTIC_PERIOD, ELASTIC_PERIOD_IN_OUT, SPRING_DAMPING_RATIO, SPRING_OSCILLATIONS, backIn, backInOut, backOut, bounceIn, bounceInOut, bounceOut, circularIn, circularInOut, circularOut, cubicIn, cubicInOut, cubicOut, elasticIn, elasticInOut, elasticOut, exponentialIn, exponentialInOut, exponentialOut, linear, quadraticIn, quadraticInOut, quadraticOut, quarticIn, quarticInOut, quarticOut, quinticIn, quinticInOut, quinticOut, resolveEasing, sineIn, sineInOut, sineOut, springIn, springInOut, springOut` | Re-export |
| `./mixer.js` | `AnimationMixer` | Re-export |
| `./timeline.js` | `Timeline` | Re-export |
| `./track.js` | `AnimationTrack` | Re-export |
| `./tween.js` | `Tween, animate, tween` | Re-export |
| `./values.js` | `booleanAdapter, colorAdapter, detectAdapter, discreteAdapter, discreteAdapterFor, numberAdapter, quaternionAdapter, vector2Adapter, vector3Adapter, vector4Adapter` | Re-export |
| `./animation-system.js` | `Advanceable, AnimationPlaybackState, AnimationSystemOptions` | Re-export (type-only) |
| `./binding.js` | `PropertyBinding` | Re-export (type-only) |
| `./clip.js` | `AnimationClipOptions, AnimationEvent, AnimationEventVisitor, TrackSampleSink` | Re-export (type-only) |
| `./controller.js` | `AnimationControllerOptions, AnimationControllerParameters, AnimationStateInput, AnimationStateOptions, AnimationTransition, BooleanCondition, ControllerPlaybackState, NumericComparison, NumericCondition, StateChangeListener, TransitionCondition, TriggerCondition` | Re-export (type-only) |
| `./easing.js` | `EasingFunction, EasingName` | Re-export (type-only) |
| `./mixer.js` | `AnimationEventListener, MixerPlayOptions, MixerRootMotionOptions, MixerState` | Re-export (type-only) |
| `./timeline.js` | `TimelineChild, TimelineEntry, TimelineMarkerCallback, TimelineMarkerOptions, TimelineState` | Re-export (type-only) |
| `./track.js` | `AnimationTrackLike, AnimationTrackOptions, InterpolationMode` | Re-export (type-only) |
| `./tween.js` | `TweenProperties, TweenState, TweenValue` | Re-export (type-only) |
| `./values.js` | `ColorRGBA, ValueAdapter, ValueKind` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `AnimationSystem`, `createArrayElementBinding`, `createBinding`, `AnimationClip`, `AnimationController`, `BACK_OVERSHOOT`, `BACK_OVERSHOOT_IN_OUT`, `BOUNCE_AMPLITUDE`, `BOUNCE_SEGMENT_DIVISOR`, `EASINGS`, `EASING_NAMES`, `ELASTIC_AMPLITUDE`, `ELASTIC_PERIOD`, `ELASTIC_PERIOD_IN_OUT`, `SPRING_DAMPING_RATIO`, `SPRING_OSCILLATIONS`, `backIn`, `backInOut`, `backOut`, `bounceIn`, `bounceInOut`, `bounceOut`, `circularIn`, `circularInOut`, `circularOut`, `cubicIn`, `cubicInOut`, `cubicOut`, `elasticIn`, `elasticInOut`, `elasticOut`, `exponentialIn`, `exponentialInOut`, `exponentialOut`, `linear`, `quadraticIn`, `quadraticInOut`, `quadraticOut`, `quarticIn`, `quarticInOut`, `quarticOut`, `quinticIn`, `quinticInOut`, `quinticOut`, `resolveEasing`, `sineIn`, `sineInOut`, `sineOut`, `springIn`, `springInOut`, `springOut`, `AnimationMixer`, `Timeline`, `AnimationTrack`, `Tween`, `animate`, `tween`, `booleanAdapter`, `colorAdapter`, `detectAdapter`, `discreteAdapter`, `discreteAdapterFor`, `numberAdapter`, `quaternionAdapter`, `vector2Adapter`, `vector3Adapter`, `vector4Adapter`, `Advanceable`, `AnimationPlaybackState`, `AnimationSystemOptions`, `PropertyBinding`, `AnimationClipOptions`, `AnimationEvent`, `AnimationEventVisitor`, `TrackSampleSink`, `AnimationControllerOptions`, `AnimationControllerParameters`, `AnimationStateInput`, `AnimationStateOptions`, `AnimationTransition`, `BooleanCondition`, `ControllerPlaybackState`, `NumericComparison`, `NumericCondition`, `StateChangeListener`, `TransitionCondition`, `TriggerCondition`, `EasingFunction`, `EasingName`, `AnimationEventListener`, `MixerPlayOptions`, `MixerRootMotionOptions`, `MixerState`, `TimelineChild`, `TimelineEntry`, `TimelineMarkerCallback`, `TimelineMarkerOptions`, `TimelineState`, `AnimationTrackLike`, `AnimationTrackOptions`, `InterpolationMode`, `TweenProperties`, `TweenState`, `TweenValue`, `ColorRGBA`, `ValueAdapter`, `ValueKind`

---

### `packages/animation/src/mixer.ts` - The clip player (§17 clips, §16 playback semantics, §107 "playback controls").

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `Vector3` |
| `@four/scene` | `Node, warnAuthorityConflict` |
| `@four/scene` | `TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./binding.js` | `createBinding, PropertyBinding` | Import |
| `./clip.js` | `AnimationClip, AnimationEvent, TrackSampleSink` | Import (type-only) |
| `./track.js` | `AnimationTrackLike` | Import (type-only) |
| `./tween.js` | `claimProperty, isTransformOwner, releaseProperty, requireNonNegativeSeconds, PropertyClaim` | Import |
| `./values.js` | `detectAdapter, ValueAdapter` | Import |

**Exports:**
- Classes: `AnimationMixer`
- Interfaces: `MixerRootMotionOptions`, `MixerPlayOptions`
- Types: `MixerState`, `AnimationEventListener`

---

### `packages/animation/src/timeline.ts` - Timelines (§16).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./tween.js` | `requireNonNegativeSeconds` | Import |

**Exports:**
- Classes: `Timeline`
- Interfaces: `TimelineMarkerOptions`, `TimelineChild`
- Types: `TimelineState`, `TimelineMarkerCallback`, `TimelineEntry`

---

### `packages/animation/src/track.ts` - Animation tracks (§17).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `Vector2, Vector3, Vector4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./values.js` | `ColorRGBA, ValueAdapter, ValueKind` | Import (type-only) |

**Exports:**
- Classes: `AnimationTrack`
- Interfaces: `AnimationTrackOptions`, `AnimationTrackLike`
- Types: `InterpolationMode`

---

### `packages/animation/src/tween.ts` - Tweens (§15).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `Quaternion, Vector2, Vector3, Vector4` |
| `@four/scene` | `Node, warnAuthorityConflict` |
| `@four/scene` | `TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./binding.js` | `createBinding, PropertyBinding` | Import |
| `./easing.js` | `resolveEasing, EasingFunction, EasingName` | Import |
| `./values.js` | `detectAdapter, ColorRGBA, ValueAdapter` | Import |

**Exports:**
- Classes: `Tween`
- Interfaces: `TweenProperties`, `PropertyClaim`
- Types: `TweenValue`, `TweenState`
- Functions: `claimProperty`, `releaseProperty`, `requireNonNegativeSeconds`, `isTransformOwner`, `animate`, `tween`

---

### `packages/animation/src/values.ts` - Value adapters (§16 property bindings, §17 track value types).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Quaternion, Vector2, Vector3, Vector4, ColorRGBA` |
| `@four/math` | `ColorRGBA` |

**Exports:**
- Interfaces: `ValueAdapter`
- Types: `ValueKind`
- Functions: `discreteAdapterFor`, `detectAdapter`
- Constants: `numberAdapter`, `vector2Adapter`, `vector3Adapter`, `vector4Adapter`, `quaternionAdapter`, `colorAdapter`, `booleanAdapter`, `discreteAdapter`
- Re-exports: `ColorRGBA`

---

<a id="packages-assets-dependencies"></a>

## Packages/assets Dependencies

### `packages/assets/src/asset-manager.ts` - The asset manager (§76) — one cache, one refcount, one fetch per asset.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError, isFourError, disposeAll, Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./content-hash.js` | `resolveGlobalDigest, resolveGlobalTextDecoder, DigestLike, TextDecodeLike` | Import |

**Exports:**
- Classes: `AssetManager`
- Interfaces: `FetchResponse`, `ResponseHeadersLike`, `TimerLike`, `FetchInit`, `AbortHandle`, `AbortSignalLike`, `AssetLoadOptions`, `AssetLoader`, `AssetManagerOptions`
- Types: `FetchLike`
- Constants: `DEFAULT_MAXIMUM_BYTES`, `DEFAULT_TIMEOUT_SECONDS`

---

### `packages/assets/src/content-hash.ts` - Content hashing (§76's last-but-one capability, §79's manifest half).

**Exports:**
- Types: `DigestLike`, `TextDecodeLike`
- Functions: `resolveGlobalDigest`, `resolveGlobalTextDecoder`
- Constants: `CONTENT_HASH_ALGORITHM`

---

### `packages/assets/src/index.ts` - `@four/assets` — the asset system (§76–78).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetManager, DEFAULT_MAXIMUM_BYTES, DEFAULT_TIMEOUT_SECONDS` | Re-export |
| `./content-hash.js` | `CONTENT_HASH_ALGORITHM` | Re-export |
| `./manifest.js` | `loadFromManifest, manifestLoader, manifestUrl, parseAssetManifest` | Re-export |
| `./texture.js` | `DEFAULT_MAXIMUM_DECODED_BYTES, DEFAULT_MAXIMUM_EXPANSION_RATIO, TextureAsset, createTextureLoader` | Re-export |
| `./loaders.js` | `ImageAsset, binaryLoader, createImageLoader, jsonLoader, textLoader` | Re-export |
| `./asset-manager.js` | `AbortHandle, AbortSignalLike, AssetLoadOptions, AssetLoader, AssetManagerOptions, FetchInit, FetchLike, FetchResponse, ResponseHeadersLike, TimerLike` | Re-export (type-only) |
| `./content-hash.js` | `DigestLike, TextDecodeLike` | Re-export (type-only) |
| `./manifest.js` | `AssetManifest, AssetManifestEntry, ManifestLoadOptions` | Re-export (type-only) |
| `./texture.js` | `DecodedTexels, TexelDecodeLike, TexelProbeLike, TextureColorSpace, TextureFilterMode, TextureLoaderOptions, TextureWrapMode` | Re-export (type-only) |
| `./loaders.js` | `ImageBitmapLike, ImageDecodeLike` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `AssetManager`, `DEFAULT_MAXIMUM_BYTES`, `DEFAULT_TIMEOUT_SECONDS`, `CONTENT_HASH_ALGORITHM`, `loadFromManifest`, `manifestLoader`, `manifestUrl`, `parseAssetManifest`, `DEFAULT_MAXIMUM_DECODED_BYTES`, `DEFAULT_MAXIMUM_EXPANSION_RATIO`, `TextureAsset`, `createTextureLoader`, `ImageAsset`, `binaryLoader`, `createImageLoader`, `jsonLoader`, `textLoader`, `AbortHandle`, `AbortSignalLike`, `AssetLoadOptions`, `AssetLoader`, `AssetManagerOptions`, `FetchInit`, `FetchLike`, `FetchResponse`, `ResponseHeadersLike`, `TimerLike`, `DigestLike`, `TextDecodeLike`, `AssetManifest`, `AssetManifestEntry`, `ManifestLoadOptions`, `DecodedTexels`, `TexelDecodeLike`, `TexelProbeLike`, `TextureColorSpace`, `TextureFilterMode`, `TextureLoaderOptions`, `TextureWrapMode`, `ImageBitmapLike`, `ImageDecodeLike`

---

### `packages/assets/src/loaders.ts` - The built-in loaders (§76) — text, JSON, binary, image.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader, FetchResponse` | Import (type-only) |

**Exports:**
- Classes: `ImageAsset`
- Interfaces: `ImageBitmapLike`
- Types: `ImageDecodeLike`
- Functions: `createImageLoader`
- Constants: `textLoader`, `jsonLoader`, `binaryLoader`

---

### `packages/assets/src/manifest.ts` - The §79 asset manifest — logical key → URL + content hash.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader, AssetLoadOptions` | Import (type-only) |
| `./asset-manager.js` | `AssetManager` | Import |

**Exports:**
- Interfaces: `AssetManifestEntry`, `ManifestLoadOptions`
- Types: `AssetManifest`
- Functions: `parseAssetManifest`, `loadFromManifest`, `manifestUrl`
- Constants: `manifestLoader`

---

### `packages/assets/src/texture.ts` - The texture loader tier (§77's asset half, A-19 — 2026-08-21).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError, Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader, FetchResponse` | Import (type-only) |

**Exports:**
- Classes: `TextureAsset`
- Interfaces: `DecodedTexels`, `TextureLoaderOptions`
- Types: `TextureColorSpace`, `TextureFilterMode`, `TextureWrapMode`, `TexelDecodeLike`, `TexelProbeLike`
- Functions: `createTextureLoader`
- Constants: `DEFAULT_MAXIMUM_DECODED_BYTES`, `DEFAULT_MAXIMUM_EXPANSION_RATIO`

---

<a id="packages-core-dependencies"></a>

## Packages/core Dependencies

### `packages/core/src/component.ts` - Component model (§6a, plan D2).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./dev.js` | `DEV, devWarn` | Import |
| `./errors.js` | `FourError` | Import |

**Exports:**
- Classes: `ComponentRegistry`
- Interfaces: `ComponentHost`, `Component`, `ComponentHostBinding`
- Types: `ComponentType`

---

### `packages/core/src/conventions.ts` - Normative default constants shared across pillars (Appendix A, §7a).

**Exports:**
- Constants: `DEFAULT_GRAVITY_Y`

---

### `packages/core/src/dev.ts` - The build-mode flag (§85, A-4, 2026-08-07) — one place that answers "is this

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |
| `./errors.js` | `FourErrorCode` | Import (type-only) |

**Exports:**
- Functions: `devWarn`, `devWarnOnce`, `resetDevWarnings`, `devAssert`
- Constants: `DEV`

---

### `packages/core/src/disposable.ts` - Explicit disposal (§83).

**Exports:**
- Interfaces: `Disposable`
- Functions: `disposeAll`

---

### `packages/core/src/errors.ts` - Error model (§89).

**Exports:**
- Classes: `FourError`
- Interfaces: `FourErrorOptions`
- Types: `FourErrorCode`
- Functions: `isFourError`

---

### `packages/core/src/events.ts` - Typed event emitter (§6b).

**Exports:**
- Classes: `EventEmitter`
- Types: `EventListener`, `Unsubscribe`

---

### `packages/core/src/index.ts` - §85 build mode (A-4, 2026-08-07). `DEV` is the flag every other package

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./conventions.js` | `DEFAULT_GRAVITY_Y` | Re-export |
| `./json.js` | `cloneJsonValue` | Re-export |
| `./random.js` | `SeededRandom` | Re-export |
| `./component.js` | `ComponentRegistry` | Re-export |
| `./disposable.js` | `disposeAll` | Re-export |
| `./dev.js` | `DEV, devAssert, devWarn, devWarnOnce, resetDevWarnings` | Re-export |
| `./errors.js` | `FourError, isFourError` | Re-export |
| `./events.js` | `EventEmitter` | Re-export |
| `./plugin.js` | `PLUGIN_API_VERSION, PluginHost, bindCapability, defineCapability, installPlugins, satisfiesPluginRange` | Re-export |
| `./space.js` | `DEFAULT_SPACE_MODE, SPACE_MODES, isSimulationSpaceMode` | Re-export |
| `./units.js` | `SI_UNITS, angleFromDisplay, angleToDisplay, formatAngle, formatLength, formatMass, formatTime, kilogramsToWorldMass, lengthFromDisplay, lengthToDisplay, massFromDisplay, massToDisplay, metersToWorldLength, resolveUnitSystem, timeFromDisplay, timeToDisplay, unitSymbol, worldLengthToMeters, worldMassToKilograms` | Re-export |
| `./untrusted.js` | `DEFAULT_MAXIMUM_DEPTH, DEFAULT_MAXIMUM_TEXT_LENGTH, parseUntrustedJson` | Re-export |
| `./json.js` | `JsonValue` | Re-export (type-only) |
| `./component.js` | `Component, ComponentHost, ComponentHostBinding, ComponentType` | Re-export (type-only) |
| `./disposable.js` | `Disposable` | Re-export (type-only) |
| `./errors.js` | `FourErrorCode, FourErrorOptions` | Re-export (type-only) |
| `./events.js` | `EventListener, Unsubscribe` | Re-export (type-only) |
| `./plugin.js` | `DefineCapabilityOptions, FourPlugin, PluginCapability, PluginCapabilityBinding, PluginContext, PluginDependency` | Re-export (type-only) |
| `./space.js` | `SpaceMode` | Re-export (type-only) |
| `./units.js` | `AngleUnit, LengthUnit, MassUnit, TimeUnit, UnitQuantity, UnitScale, UnitSystem, UnitSystemInit` | Re-export (type-only) |
| `./untrusted.js` | `UntrustedJsonLimits` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_GRAVITY_Y`, `cloneJsonValue`, `SeededRandom`, `ComponentRegistry`, `disposeAll`, `DEV`, `devAssert`, `devWarn`, `devWarnOnce`, `resetDevWarnings`, `FourError`, `isFourError`, `EventEmitter`, `PLUGIN_API_VERSION`, `PluginHost`, `bindCapability`, `defineCapability`, `installPlugins`, `satisfiesPluginRange`, `DEFAULT_SPACE_MODE`, `SPACE_MODES`, `isSimulationSpaceMode`, `SI_UNITS`, `angleFromDisplay`, `angleToDisplay`, `formatAngle`, `formatLength`, `formatMass`, `formatTime`, `kilogramsToWorldMass`, `lengthFromDisplay`, `lengthToDisplay`, `massFromDisplay`, `massToDisplay`, `metersToWorldLength`, `resolveUnitSystem`, `timeFromDisplay`, `timeToDisplay`, `unitSymbol`, `worldLengthToMeters`, `worldMassToKilograms`, `DEFAULT_MAXIMUM_DEPTH`, `DEFAULT_MAXIMUM_TEXT_LENGTH`, `parseUntrustedJson`, `JsonValue`, `Component`, `ComponentHost`, `ComponentHostBinding`, `ComponentType`, `Disposable`, `FourErrorCode`, `FourErrorOptions`, `EventListener`, `Unsubscribe`, `DefineCapabilityOptions`, `FourPlugin`, `PluginCapability`, `PluginCapabilityBinding`, `PluginContext`, `PluginDependency`, `SpaceMode`, `AngleUnit`, `LengthUnit`, `MassUnit`, `TimeUnit`, `UnitQuantity`, `UnitScale`, `UnitSystem`, `UnitSystemInit`, `UntrustedJsonLimits`

---

### `packages/core/src/json.ts` - JSON value typing and validation shared by every document format (§34, §79).

**Exports:**
- Types: `JsonValue`
- Functions: `cloneJsonValue`

---

### `packages/core/src/plugin.ts` - The §81 plugin system (RFC 0002, accepted 2026-08-21; gap `A-3`).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |

**Exports:**
- Classes: `PluginHost`
- Interfaces: `PluginDependency`, `FourPlugin`, `PluginCapability`, `DefineCapabilityOptions`, `PluginCapabilityBinding`, `PluginContext`
- Functions: `defineCapability`, `bindCapability`, `satisfiesPluginRange`, `installPlugins`
- Constants: `PLUGIN_API_VERSION`

---

### `packages/core/src/random.ts` - Seeded pseudo-random numbers for deterministic engine code (§33, plan P8-3).

**Exports:**
- Classes: `SeededRandom`

---

### `packages/core/src/space.ts` - §8 *Space Modes* — the vocabulary, and the one rule §8 states (PH-12,

**Exports:**
- Types: `SpaceMode`
- Functions: `isSimulationSpaceMode`
- Constants: `DEFAULT_SPACE_MODE`, `SPACE_MODES`

---

### `packages/core/src/units.ts` - The §40 unit system — **display and authoring conversion only** (§40, §98).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |

**Exports:**
- Interfaces: `UnitScale`, `UnitSystem`, `UnitSystemInit`
- Types: `LengthUnit`, `MassUnit`, `TimeUnit`, `AngleUnit`, `UnitQuantity`
- Functions: `resolveUnitSystem`, `angleToDisplay`, `angleFromDisplay`, `timeToDisplay`, `timeFromDisplay`, `lengthToDisplay`, `lengthFromDisplay`, `massToDisplay`, `massFromDisplay`, `worldLengthToMeters`, `metersToWorldLength`, `worldMassToKilograms`, `kilogramsToWorldMass`, `unitSymbol`, `formatLength`, `formatMass`, `formatTime`, `formatAngle`
- Constants: `SI_UNITS`

---

### `packages/core/src/untrusted.ts` - Untrusted-input guards for the document formats (§96).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |

**Exports:**
- Interfaces: `UntrustedJsonLimits`
- Functions: `parseUntrustedJson`
- Constants: `DEFAULT_MAXIMUM_TEXT_LENGTH`, `DEFAULT_MAXIMUM_DEPTH`

---

<a id="packages-diagnostics-dependencies"></a>

## Packages/diagnostics Dependencies

### `packages/diagnostics/src/checksum.ts` - Deterministic checksums over float sequences (§33, plan D6).

**Exports:**
- Interfaces: `Checksum`
- Functions: `createChecksum`, `hashFloats`

---

### `packages/diagnostics/src/debug-draw.ts` - Debug-draw data providers (§113, plan P10-3) — the diagnostic visualization

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Quaternion, Vector3` |

**Exports:**
- Classes: `DebugDrawBuffer`
- Interfaces: `Vector3Like`, `DebugDrawBufferOptions`, `DebugDrawStreams`, `DebugGeometrySink`, `DebugBodyAccess`, `DebugJointAccess`, `DebugContactPoint`, `DebugCollisionEventLike`, `DebugPhysicsEventLike`, `CollectBodyVelocitiesOptions`, `CollectBodyOriginsOptions`, `DebugCenterOfMassAccess`, `CollectCentersOfMassOptions`, `CollectContactPointsOptions`, `CollectContactImpulsesOptions`, `SolverStatistics`, `SolverJointStatistics`, `StagedVisualization`
- Types: `DebugColor`
- Functions: `debugDrawStreams`, `applyDebugDrawStreams`, `collectBodyVelocities`, `collectBodyOrigins`, `collectCentersOfMass`, `collectContactPoints`, `collectContactImpulses`, `solverJointStatistics`
- Constants: `DEBUG_VERTEX_FLOATS`, `DEBUG_SEGMENT_FLOATS`, `DEBUG_POSITION_FLOATS_PER_SEGMENT`, `DEBUG_COLOR_FLOATS_PER_SEGMENT`, `DEFAULT_DEBUG_BUFFER_CAPACITY`, `DEBUG_DRAW_DEFAULT_COLORS`, `DEBUG_DRAW_STAGED`

---

### `packages/diagnostics/src/index.ts` - --- PH-20 (§33 rollback) ---------------------------------------------------

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./checksum.js` | `createChecksum, hashFloats` | Re-export |
| `./recorder.js` | `ReplayRecorder` | Re-export |
| `./rollback.js` | `RollbackBuffer` | Re-export |
| `./replay-format.js` | `LATEST_REPLAY_FORMAT_VERSION, MINIMUM_REPLAY_FORMAT_VERSION, REPLAY_FORMAT_VERSION, SUPPORTED_REPLAY_FORMAT_VERSIONS, assertReplayCompatible, cloneJsonValue, decodeBase64, decodeReplayRecording, encodeBase64, encodeReplayRecording, isReplayCompatible, validateReplayRecording` | Re-export |
| `./replay-player.js` | `DEFAULT_REPLAY_MAXIMUM_SUB_STEPS, ReplayPlayer` | Re-export |
| `./debug-draw.js` | `DEBUG_COLOR_FLOATS_PER_SEGMENT, DEBUG_DRAW_DEFAULT_COLORS, DEBUG_DRAW_STAGED, DEBUG_POSITION_FLOATS_PER_SEGMENT, DEBUG_SEGMENT_FLOATS, DEBUG_VERTEX_FLOATS, DEFAULT_DEBUG_BUFFER_CAPACITY, DebugDrawBuffer, applyDebugDrawStreams, collectBodyOrigins, collectBodyVelocities, collectCentersOfMass, collectContactImpulses, collectContactPoints, debugDrawStreams, solverJointStatistics` | Re-export |
| `./resource-audit.js` | `NO_RESOURCE_LEAKS, auditResourceLeaks` | Re-export |
| `./stats.js` | `copyFrameStats, createFrameStats, createMonotonicClock, monotonicNowSeconds, recordRenderStatistics, recordResourceMemory, recordSolverStatistics, resetFrameStats, solverStatistics` | Re-export |
| `./checksum.js` | `Checksum` | Re-export (type-only) |
| `./recorder.js` | `ReplayRecorderOptions, ReplaySnapshot, ReplayTarget` | Re-export (type-only) |
| `./rollback.js` | `RollbackBufferOptions, RollbackTarget` | Re-export (type-only) |
| `./replay-format.js` | `JsonValue, ReplayAdapterIdentity, ReplayFrameRecord, ReplayInputRecord, ReplayRecording, ReplaySnapshotRecord, UntrustedJsonLimits` | Re-export (type-only) |
| `./replay-player.js` | `ReplayPlayerOptions, ReplayStepEvent, ReplayStepListener` | Re-export (type-only) |
| `./debug-draw.js` | `CollectBodyOriginsOptions, CollectBodyVelocitiesOptions, CollectCentersOfMassOptions, CollectContactImpulsesOptions, CollectContactPointsOptions, DebugBodyAccess, DebugCenterOfMassAccess, DebugCollisionEventLike, DebugColor, DebugContactPoint, DebugDrawBufferOptions, DebugDrawStreams, DebugGeometrySink, DebugJointAccess, DebugPhysicsEventLike, SolverJointStatistics, SolverStatistics, StagedVisualization, Vector3Like` | Re-export (type-only) |
| `./resource-audit.js` | `AuditResourceLeaksOptions, LiveResourceCounts, ResourceLeakReport` | Re-export (type-only) |
| `./stats.js` | `ClockSource, FrameStats, RenderStatisticsLike` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `createChecksum`, `hashFloats`, `ReplayRecorder`, `RollbackBuffer`, `LATEST_REPLAY_FORMAT_VERSION`, `MINIMUM_REPLAY_FORMAT_VERSION`, `REPLAY_FORMAT_VERSION`, `SUPPORTED_REPLAY_FORMAT_VERSIONS`, `assertReplayCompatible`, `cloneJsonValue`, `decodeBase64`, `decodeReplayRecording`, `encodeBase64`, `encodeReplayRecording`, `isReplayCompatible`, `validateReplayRecording`, `DEFAULT_REPLAY_MAXIMUM_SUB_STEPS`, `ReplayPlayer`, `DEBUG_COLOR_FLOATS_PER_SEGMENT`, `DEBUG_DRAW_DEFAULT_COLORS`, `DEBUG_DRAW_STAGED`, `DEBUG_POSITION_FLOATS_PER_SEGMENT`, `DEBUG_SEGMENT_FLOATS`, `DEBUG_VERTEX_FLOATS`, `DEFAULT_DEBUG_BUFFER_CAPACITY`, `DebugDrawBuffer`, `applyDebugDrawStreams`, `collectBodyOrigins`, `collectBodyVelocities`, `collectCentersOfMass`, `collectContactImpulses`, `collectContactPoints`, `debugDrawStreams`, `solverJointStatistics`, `NO_RESOURCE_LEAKS`, `auditResourceLeaks`, `copyFrameStats`, `createFrameStats`, `createMonotonicClock`, `monotonicNowSeconds`, `recordRenderStatistics`, `recordResourceMemory`, `recordSolverStatistics`, `resetFrameStats`, `solverStatistics`, `Checksum`, `ReplayRecorderOptions`, `ReplaySnapshot`, `ReplayTarget`, `RollbackBufferOptions`, `RollbackTarget`, `JsonValue`, `ReplayAdapterIdentity`, `ReplayFrameRecord`, `ReplayInputRecord`, `ReplayRecording`, `ReplaySnapshotRecord`, `UntrustedJsonLimits`, `ReplayPlayerOptions`, `ReplayStepEvent`, `ReplayStepListener`, `CollectBodyOriginsOptions`, `CollectBodyVelocitiesOptions`, `CollectCentersOfMassOptions`, `CollectContactImpulsesOptions`, `CollectContactPointsOptions`, `DebugBodyAccess`, `DebugCenterOfMassAccess`, `DebugCollisionEventLike`, `DebugColor`, `DebugContactPoint`, `DebugDrawBufferOptions`, `DebugDrawStreams`, `DebugGeometrySink`, `DebugJointAccess`, `DebugPhysicsEventLike`, `SolverJointStatistics`, `SolverStatistics`, `StagedVisualization`, `Vector3Like`, `AuditResourceLeaksOptions`, `LiveResourceCounts`, `ResourceLeakReport`, `ClockSource`, `FrameStats`, `RenderStatisticsLike`

---

### `packages/diagnostics/src/recorder.ts` - Session recording (§33–34, plan P10-1) — the producing half of the replay

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./replay-format.js` | `LATEST_REPLAY_FORMAT_VERSION, JsonValue, ReplayFrameRecord, ReplayInputRecord, ReplayRecording, ReplaySnapshotRecord, cloneJsonValue, encodeBase64, validateReplayRecording` | Import |

**Exports:**
- Classes: `ReplayRecorder`
- Interfaces: `ReplaySnapshot`, `ReplayTarget`, `ReplayRecorderOptions`

---

### `packages/diagnostics/src/replay-format.ts` - The §34 replay document — its types, its JSON encoding, and its validation

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError, cloneJsonValue, parseUntrustedJson, JsonValue, UntrustedJsonLimits` |
| `@four/core` | `cloneJsonValue` |
| `@four/core` | `JsonValue` |
| `@four/core` | `UntrustedJsonLimits` |

**Exports:**
- Interfaces: `ReplayInputRecord`, `ReplayFrameRecord`, `ReplaySnapshotRecord`, `ReplayAdapterIdentity`, `ReplayRecording`
- Functions: `encodeBase64`, `decodeBase64`, `validateReplayRecording`, `encodeReplayRecording`, `decodeReplayRecording`, `assertReplayCompatible`, `isReplayCompatible`
- Constants: `LATEST_REPLAY_FORMAT_VERSION`, `MINIMUM_REPLAY_FORMAT_VERSION`, `REPLAY_FORMAT_VERSION`, `SUPPORTED_REPLAY_FORMAT_VERSIONS`
- Re-exports: `cloneJsonValue`, `JsonValue`, `UntrustedJsonLimits`

---

### `packages/diagnostics/src/replay-player.ts` - Replay playback and inspection (§33–34, §113; plan P10-3) — the consuming

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./recorder.js` | `ReplaySnapshot, ReplayTarget` | Import (type-only) |
| `./replay-format.js` | `ReplayRecording, assertReplayCompatible, decodeBase64, validateReplayRecording` | Import |

**Exports:**
- Classes: `ReplayPlayer`
- Interfaces: `ReplayStepEvent`, `ReplayPlayerOptions`
- Types: `ReplayStepListener`
- Constants: `DEFAULT_REPLAY_MAXIMUM_SUB_STEPS`

---

### `packages/diagnostics/src/resource-audit.ts` - §83's first development warning — **leaked textures and buffers** (A-4/A-5,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEV, devWarnOnce` |

**Exports:**
- Interfaces: `LiveResourceCounts`, `ResourceLeakReport`, `AuditResourceLeaksOptions`
- Functions: `auditResourceLeaks`
- Constants: `NO_RESOURCE_LEAKS`

---

### `packages/diagnostics/src/rollback.ts` - `RollbackBuffer` (§33 *"rollback"*, §34; PH-20, 2026-08-21) — a bounded ring

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./recorder.js` | `ReplaySnapshot` | Import (type-only) |

**Exports:**
- Classes: `RollbackBuffer`
- Interfaces: `RollbackTarget`, `RollbackBufferOptions`

---

### `packages/diagnostics/src/stats.ts` - §84 runtime statistics — the record behind `app.stats` (A-1, 2026-08-07).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./debug-draw.js` | `DebugBodyAccess, SolverStatistics` | Import (type-only) |

**Exports:**
- Interfaces: `FrameStats`, `RenderStatisticsLike`, `ClockSource`
- Functions: `createFrameStats`, `resetFrameStats`, `copyFrameStats`, `recordRenderStatistics`, `recordResourceMemory`, `solverStatistics`, `recordSolverStatistics`, `createMonotonicClock`
- Constants: `monotonicNowSeconds`

---

<a id="packages-four-dependencies"></a>

## Packages/four Dependencies

### `packages/four/src/animation.ts` - animation module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/animation` | `*` |

**Exports:**
- Re-exports: `* from @four/animation`

---

### `packages/four/src/application.ts` - The `Application` composition root (§45, plan D4).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEV, EventEmitter, FourError, bindCapability, installPlugins, FourPlugin, PluginCapabilityBinding, PluginContext` |
| `@four/diagnostics` | `createFrameStats, monotonicNowSeconds, recordRenderStatistics, recordResourceMemory, recordSolverStatistics, resetFrameStats, solverStatistics, FrameStats, SolverStatistics` |
| `@four/geometry` | `geometryMemoryBytes` |
| `@four/motion` | `DEFAULT_FIXED_DELTA_TIME, DEFAULT_MAXIMUM_SUB_STEPS, PRIORITY_PHYSICS_SOLVE, Scheduler, SystemRegistry, Detach, ReadonlyTimeState, SimulationSystem` |
| `@four/math` | `DepthRange` |
| `@four/assets` | `AssetManager` |
| `@four/physics` | `PhysicsWorld` |
| `@four/scene` | `PerspectiveCamera, PoseBuffer, Scene, createSnapshotSystem, resolveWorldTransforms, Camera, SurfaceSizedCamera, Viewport, WorldTransformStats` |
| `@four/render` | `RenderStatistics, Renderer, RendererCapabilityDeclaration, RendererCapabilityShortfall, RendererFallbackReport, RendererRegistry, RendererSelection` |
| `@four/render` | `resolveRenderer, textureMemoryBytes` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./plugins.js` | `RENDERER_REGISTRY, SIMULATION_SYSTEMS` | Import |

**Exports:**
- Classes: `Application`
- Interfaces: `ApplicationEventMap`, `PhysicsWorldContext`, `ApplicationOptions`
- Types: `PhysicsWorldFactory`, `SurfaceResize`, `SurfaceObserver`

---

### `packages/four/src/assets.ts` - assets module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/assets` | `*` |

**Exports:**
- Re-exports: `* from @four/assets`

---

### `packages/four/src/core.ts` - core module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `*` |

**Exports:**
- Re-exports: `* from @four/core`

---

### `packages/four/src/diagnostics.ts` - diagnostics module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/diagnostics` | `*` |

**Exports:**
- Re-exports: `* from @four/diagnostics`

---

### `packages/four/src/geometry.ts` - geometry module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/geometry` | `*` |

**Exports:**
- Re-exports: `* from @four/geometry`

---

### `packages/four/src/index.ts` - The umbrella package (§98): one namespace per workspace package, plus the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./application.js` | `Application` | Re-export |
| `./plugins.js` | `COMPONENT_SERIALIZERS, RENDERER_REGISTRY, RENDER_GRAPH, SCENE_MIGRATIONS, SIMULATION_SYSTEMS, SOLVER_REGISTRY` | Re-export |
| `./scene-serializers.js` | `BUTTON_NODE_TYPE, CHECKBOX_NODE_TYPE, CIRCLE_NODE_TYPE, DIRECTIONAL_LIGHT_NODE_TYPE, ELLIPSE_NODE_TYPE, IMAGE_NODE_TYPE, LABEL_NODE_TYPE, ORTHOGRAPHIC_CAMERA_NODE_TYPE, PANEL_NODE_TYPE, PATH_SHAPE_NODE_TYPE, PERSPECTIVE_CAMERA_NODE_TYPE, POINT_LIGHT_NODE_TYPE, POLYGON_NODE_TYPE, PROGRESS_NODE_TYPE, RADIO_BUTTON_NODE_TYPE, RECTANGLE_NODE_TYPE, REGULAR_POLYGON_NODE_TYPE, RENDERABLE_NODE_TYPE, RING_NODE_TYPE, SECTOR_NODE_TYPE, SLIDER_NODE_TYPE, SPOT_LIGHT_NODE_TYPE, SPRITE_NODE_TYPE, STAR_NODE_TYPE, TEXT_NODE_TYPE, TOGGLE_NODE_TYPE, composeSceneNodeTypes, registerPhysicsSerializers, registerRenderSerializers, registerSceneNodeTypes, registerShapeSerializers, registerTextSerializers, registerUISerializers, resourceCatalog, restoreNodeId` | Re-export |
| `./text-node.js` | `Text` | Re-export |
| `./pick-provider.js` | `createPickProvider` | Re-export |
| `./application.js` | `ApplicationEventMap, ApplicationOptions, PhysicsWorldContext, PhysicsWorldFactory, SurfaceObserver, SurfaceResize` | Re-export (type-only) |
| `./scene-serializers.js` | `SceneNodeTypeOptions, SceneNodeTypeSupport, SceneResourceCatalog, SceneSerializationSupport, UnknownResourcePolicy` | Re-export (type-only) |
| `./text-node.js` | `TextOptions` | Re-export (type-only) |

**Exports:**
- Re-exports: `Application`, `COMPONENT_SERIALIZERS`, `RENDERER_REGISTRY`, `RENDER_GRAPH`, `SCENE_MIGRATIONS`, `SIMULATION_SYSTEMS`, `SOLVER_REGISTRY`, `BUTTON_NODE_TYPE`, `CHECKBOX_NODE_TYPE`, `CIRCLE_NODE_TYPE`, `DIRECTIONAL_LIGHT_NODE_TYPE`, `ELLIPSE_NODE_TYPE`, `IMAGE_NODE_TYPE`, `LABEL_NODE_TYPE`, `ORTHOGRAPHIC_CAMERA_NODE_TYPE`, `PANEL_NODE_TYPE`, `PATH_SHAPE_NODE_TYPE`, `PERSPECTIVE_CAMERA_NODE_TYPE`, `POINT_LIGHT_NODE_TYPE`, `POLYGON_NODE_TYPE`, `PROGRESS_NODE_TYPE`, `RADIO_BUTTON_NODE_TYPE`, `RECTANGLE_NODE_TYPE`, `REGULAR_POLYGON_NODE_TYPE`, `RENDERABLE_NODE_TYPE`, `RING_NODE_TYPE`, `SECTOR_NODE_TYPE`, `SLIDER_NODE_TYPE`, `SPOT_LIGHT_NODE_TYPE`, `SPRITE_NODE_TYPE`, `STAR_NODE_TYPE`, `TEXT_NODE_TYPE`, `TOGGLE_NODE_TYPE`, `composeSceneNodeTypes`, `registerPhysicsSerializers`, `registerRenderSerializers`, `registerSceneNodeTypes`, `registerShapeSerializers`, `registerTextSerializers`, `registerUISerializers`, `resourceCatalog`, `restoreNodeId`, `Text`, `createPickProvider`, `ApplicationEventMap`, `ApplicationOptions`, `PhysicsWorldContext`, `PhysicsWorldFactory`, `SurfaceObserver`, `SurfaceResize`, `SceneNodeTypeOptions`, `SceneNodeTypeSupport`, `SceneResourceCatalog`, `SceneSerializationSupport`, `UnknownResourcePolicy`, `TextOptions`

---

### `packages/four/src/input.ts` - input module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/input` | `*` |

**Exports:**
- Re-exports: `* from @four/input`

---

### `packages/four/src/materials.ts` - materials module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/materials` | `*` |

**Exports:**
- Re-exports: `* from @four/materials`

---

### `packages/four/src/math.ts` - math module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `*` |

**Exports:**
- Re-exports: `* from @four/math`

---

### `packages/four/src/motion.ts` - motion module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/motion` | `*` |

**Exports:**
- Re-exports: `* from @four/motion`

---

### `packages/four/src/particles.ts` - particles module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/particles` | `*` |

**Exports:**
- Re-exports: `* from @four/particles`

---

### `packages/four/src/physics-box2d.ts` - physics-box2d module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/physics-box2d` | `*` |

**Exports:**
- Re-exports: `* from @four/physics-box2d`

---

### `packages/four/src/physics-rapier.ts` - physics-rapier module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/physics-rapier` | `*` |

**Exports:**
- Re-exports: `* from @four/physics-rapier`

---

### `packages/four/src/physics-soft.ts` - physics-soft module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/physics-soft` | `*` |

**Exports:**
- Re-exports: `* from @four/physics-soft`

---

### `packages/four/src/physics.ts` - physics module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/physics` | `*` |

**Exports:**
- Re-exports: `* from @four/physics`

---

### `packages/four/src/pick-provider.ts` - The four-line adapter RFC 0005 §2 promised (§71, §45; 2026-08-28): a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/input` | `PickProvider` |
| `@four/render` | `PickingService` |
| `@four/scene` | `Viewport` |

**Exports:**
- Functions: `createPickProvider`

---

### `packages/four/src/plugins.ts` - The §81 capability tokens (RFC 0002, accepted 2026-08-21; gap `A-3`).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `defineCapability` |
| `@four/motion` | `SystemRegistry` |
| `@four/physics` | `SolverRegistry` |
| `@four/render` | `RenderGraph, RendererRegistry` |
| `@four/serialization` | `ComponentSerializerRegistry, SceneMigrationRegistry` |

**Exports:**
- Constants: `SIMULATION_SYSTEMS`, `RENDERER_REGISTRY`, `SOLVER_REGISTRY`, `COMPONENT_SERIALIZERS`, `SCENE_MIGRATIONS`, `RENDER_GRAPH`

---

### `packages/four/src/render-canvas.ts` - render-canvas module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render-canvas` | `*` |

**Exports:**
- Re-exports: `* from @four/render-canvas`

---

### `packages/four/src/render-svg.ts` - render-svg module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render-svg` | `*` |

**Exports:**
- Re-exports: `* from @four/render-svg`

---

### `packages/four/src/render-webgl.ts` - render-webgl module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render-webgl` | `*` |

**Exports:**
- Re-exports: `* from @four/render-webgl`

---

### `packages/four/src/render-webgpu.ts` - render-webgpu module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render-webgpu` | `*` |

**Exports:**
- Re-exports: `* from @four/render-webgpu`

---

### `packages/four/src/render.ts` - render module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `*` |

**Exports:**
- Re-exports: `* from @four/render`

---

### `packages/four/src/scene-serializers.ts` - §79 node types and component serializers for the classes the engine itself

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError, JsonValue` |
| `@four/geometry` | `Path, BufferGeometry, Point2D` |
| `@four/materials` | `Material, SpriteMaterial, UnlitMaterial` |
| `@four/motion` | `CHARACTER_CONTROLLER_SERIALIZER, CharacterController, FIRST_PERSON_LOOK_SERIALIZER, FOLLOW_RIG_SERIALIZER, FirstPersonLook, FollowRig, KINEMATIC_CONTROLLER_SERIALIZER, KinematicController, LOOK_AT_CONSTRAINT_SERIALIZER, LookAtConstraint, MOTION_COMPONENT_SERIALIZER, MotionComponent, ORBIT_RIG_SERIALIZER, OrbitRig` |
| `@four/physics` | `COLLIDER_SERIALIZER, Collider, RIGID_BODY_SERIALIZER, RigidBody, SWEPT_CHARACTER_CONTROLLER_SERIALIZER, SweptCharacterController` |
| `@four/render` | `Arc, Circle, Ellipse, Line, Mesh, PathShape, Polygon, Polyline, Rectangle, RegularPolygon, Renderable, Ring, Sector, Shape2D, Sprite, Star, restoreMeshSkeleton` |
| `@four/render` | `ResolvedPaint, ResolvedShapeFill, ResolvedStrokeStyle` |
| `@four/scene` | `Bone, DirectionalLight, MORPH_WEIGHTS_SERIALIZER, MorphWeights, OrthographicCamera, PerspectiveCamera, PointLight, SCREEN_ORIGINS, SCREEN_UNITS, ScreenCamera, SpotLight, restoreNodeId, Node` |
| `@four/serialization` | `ComponentSerializerRegistry, createDefaultComponentSerializers, InstantiateSceneOptions, SceneNodeDocument, SerializeSceneOptions` |
| `@four/text` | `GlyphAtlas, TextAlign` |
| `@four/ui` | `Button, CanvasViewWidget, Checkbox, ImageWidget, Label, Panel, ProgressIndicator, RadioButton, Slider, Toggle, UIWidget, CheckableWidget, UIWidgetOptions, WidgetAccessibility` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./text-node.js` | `Text` | Import |

**Exports:**
- Interfaces: `SceneResourceCatalog`, `SceneNodeTypeOptions`, `SceneNodeTypeSupport`, `SceneSerializationSupport`
- Types: `UnknownResourcePolicy`
- Functions: `resourceCatalog`, `registerUISerializers`, `registerRenderSerializers`, `registerShapeSerializers`, `registerTextSerializers`, `composeSceneNodeTypes`, `registerPhysicsSerializers`, `registerSceneNodeTypes`
- Constants: `PANEL_NODE_TYPE`, `LABEL_NODE_TYPE`, `BUTTON_NODE_TYPE`, `TOGGLE_NODE_TYPE`, `CHECKBOX_NODE_TYPE`, `RADIO_BUTTON_NODE_TYPE`, `SLIDER_NODE_TYPE`, `PROGRESS_NODE_TYPE`, `IMAGE_NODE_TYPE`, `CANVAS_VIEW_NODE_TYPE`, `RENDERABLE_NODE_TYPE`, `SPRITE_NODE_TYPE`, `MESH_NODE_TYPE`, `BONE_NODE_TYPE`, `TEXT_NODE_TYPE`, `PERSPECTIVE_CAMERA_NODE_TYPE`, `ORTHOGRAPHIC_CAMERA_NODE_TYPE`, `SCREEN_CAMERA_NODE_TYPE`, `DIRECTIONAL_LIGHT_NODE_TYPE`, `POINT_LIGHT_NODE_TYPE`, `SPOT_LIGHT_NODE_TYPE`, `CIRCLE_NODE_TYPE`, `ELLIPSE_NODE_TYPE`, `RECTANGLE_NODE_TYPE`, `REGULAR_POLYGON_NODE_TYPE`, `POLYGON_NODE_TYPE`, `STAR_NODE_TYPE`, `SECTOR_NODE_TYPE`, `RING_NODE_TYPE`, `PATH_SHAPE_NODE_TYPE`, `LINE_NODE_TYPE`, `POLYLINE_NODE_TYPE`, `ARC_NODE_TYPE`

---

### `packages/four/src/scene.ts` - scene module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/scene` | `*` |

**Exports:**
- Re-exports: `* from @four/scene`

---

### `packages/four/src/serialization.ts` - serialization module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/serialization` | `*` |

**Exports:**
- Re-exports: `* from @four/serialization`

---

### `packages/four/src/text-node.ts` - `Text` (§49, §56) — a string, a font atlas and a material become **one** draw

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/geometry` | `BufferGeometry` |
| `@four/materials` | `UnlitMaterial` |
| `@four/render` | `Renderable, RenderableOptions` |
| `@four/text` | `layoutText, GlyphAtlas, TextAlign, TextLayout` |
| `@four/core` | `Disposable` |

**Exports:**
- Classes: `Text`
- Interfaces: `TextOptions`

---

### `packages/four/src/text.ts` - text module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/text` | `*` |

**Exports:**
- Re-exports: `* from @four/text`

---

### `packages/four/src/ui.ts` - ui module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/ui` | `*` |

**Exports:**
- Re-exports: `* from @four/ui`

---

<a id="packages-geometry-dependencies"></a>

## Packages/geometry Dependencies

### `packages/geometry/src/buffer-geometry.ts` - `BufferGeometry` (§53) — CPU-side vertex data, in the one shape the MVP

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./geometry.js` | `Geometry, BoundingVolume, MutableBoundingVolume` | Import |
| `./resource-memory.js` | `noteGeometry` | Import |

**Exports:**
- Classes: `BufferGeometry`
- Interfaces: `BufferGeometryOptions`
- Types: `GeometryDrawMode`, `GeometryIndexArray`, `GeometryBounds`

---

### `packages/geometry/src/geometry.ts` - §53's `Geometry` base and its `BoundingVolume` — the two declarations the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |
| `@four/math` | `Vector3` |

**Exports:**
- Interfaces: `BoundingVolume`, `MutableBoundingVolume`
- Functions: `nextGeometryIdentifier`

---

### `packages/geometry/src/index.ts` - --- R-21: §53 geometry base + bounding volume (begin) ---

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `BufferGeometry` | Re-export |
| `./geometry.js` | `Geometry` | Re-export |
| `./primitives-3d.js` | `capsuleGeometry, coneGeometry, cylinderGeometry, extrudeGeometry, heightFieldGeometry, latheGeometry, sphereGeometry, torusGeometry, tubeGeometry` | Re-export |
| `./path.js` | `DEFAULT_FLATTEN_TOLERANCE, MAX_SUBDIVISION_DEPTH, Path` | Re-export |
| `./svg-path.js` | `DEFAULT_MAXIMUM_PATH_DATA_LENGTH, formatSvgPathData, parseSvgPathData` | Re-export |
| `./primitives.js` | `boxGeometry, circleGeometry2D, planeGeometry, polygonGeometry2D` | Re-export |
| `./resource-memory.js` | `geometryMemoryBytes, liveGeometryCount` | Re-export |
| `./tessellation.js` | `DEFAULT_MITER_LIMIT, earClippingTessellator, expandStroke, triangulatePolygon` | Re-export |
| `./buffer-geometry.js` | `BufferGeometryOptions, GeometryBounds, GeometryDrawMode, GeometryIndexArray` | Re-export (type-only) |
| `./geometry.js` | `BoundingVolume` | Re-export (type-only) |
| `./primitives-3d.js` | `CapsuleGeometryOptions, ExtrudeGeometryOptions, HeightFieldGeometryOptions, LatheGeometryOptions, Point3D, SphereGeometryOptions, TaperedGeometryOptions, TorusGeometryOptions, TubeGeometryOptions` | Re-export (type-only) |
| `./path.js` | `FillRule, PathArcCommand, PathClosestPoint, PathCloseCommand, PathCommand, PathCubicCommand, PathFillRings, PathLineCommand, PathMoveCommand, PathOptions, PathQuadraticCommand, PathSegmentCommand` | Re-export (type-only) |
| `./svg-path.js` | `SvgPathParseOptions` | Re-export (type-only) |
| `./primitives.js` | `BoxGeometryOptions, CircleGeometry2DOptions, PlaneGeometryOptions, PolygonGeometry2DOptions` | Re-export (type-only) |
| `./tessellation.js` | `Point2D, PolygonTessellator, Polyline2D, StrokeAlignment, StrokeGeometryOptions, StrokeLineCap, StrokeLineJoin, StrokeMesh` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `BufferGeometry`, `Geometry`, `capsuleGeometry`, `coneGeometry`, `cylinderGeometry`, `extrudeGeometry`, `heightFieldGeometry`, `latheGeometry`, `sphereGeometry`, `torusGeometry`, `tubeGeometry`, `DEFAULT_FLATTEN_TOLERANCE`, `MAX_SUBDIVISION_DEPTH`, `Path`, `DEFAULT_MAXIMUM_PATH_DATA_LENGTH`, `formatSvgPathData`, `parseSvgPathData`, `boxGeometry`, `circleGeometry2D`, `planeGeometry`, `polygonGeometry2D`, `geometryMemoryBytes`, `liveGeometryCount`, `DEFAULT_MITER_LIMIT`, `earClippingTessellator`, `expandStroke`, `triangulatePolygon`, `BufferGeometryOptions`, `GeometryBounds`, `GeometryDrawMode`, `GeometryIndexArray`, `BoundingVolume`, `CapsuleGeometryOptions`, `ExtrudeGeometryOptions`, `HeightFieldGeometryOptions`, `LatheGeometryOptions`, `Point3D`, `SphereGeometryOptions`, `TaperedGeometryOptions`, `TorusGeometryOptions`, `TubeGeometryOptions`, `FillRule`, `PathArcCommand`, `PathClosestPoint`, `PathCloseCommand`, `PathCommand`, `PathCubicCommand`, `PathFillRings`, `PathLineCommand`, `PathMoveCommand`, `PathOptions`, `PathQuadraticCommand`, `PathSegmentCommand`, `SvgPathParseOptions`, `BoxGeometryOptions`, `CircleGeometry2DOptions`, `PlaneGeometryOptions`, `PolygonGeometry2DOptions`, `Point2D`, `PolygonTessellator`, `Polyline2D`, `StrokeAlignment`, `StrokeGeometryOptions`, `StrokeLineCap`, `StrokeLineJoin`, `StrokeMesh`

---

### `packages/geometry/src/path.ts` - The §51 path model — the vector-level source data every 2D shape, stroke,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./primitive-support.js` | `requirePositive` | Import |
| `./tessellation.js` | `Point2D, Polyline2D` | Import (type-only) |

**Exports:**
- Classes: `Path`
- Interfaces: `PathMoveCommand`, `PathLineCommand`, `PathQuadraticCommand`, `PathCubicCommand`, `PathArcCommand`, `PathCloseCommand`, `PathOptions`, `PathFillRings`, `PathClosestPoint`, `PathCursor`
- Types: `FillRule`, `PathSegmentCommand`, `PathCommand`
- Functions: `arcPoint`, `newCursor`, `advance`
- Constants: `DEFAULT_FLATTEN_TOLERANCE`, `MAX_SUBDIVISION_DEPTH`

---

### `packages/geometry/src/primitive-support.ts` - Shared building blocks of the §53 primitive builders — index allocation,

**Exports:**
- Types: `IndexArray`
- Functions: `createIndices`, `requirePositive`, `requireNonNegative`, `requireSegments`, `gridIndices`, `writeCap`

---

### `packages/geometry/src/primitives-3d.ts` - The nine 3D primitives §53 requires beyond the box and the plane — sphere,

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `BufferGeometry` | Import |
| `./primitive-support.js` | `createIndices, gridIndices, requireNonNegative, requirePositive, requireSegments, writeCap, IndexArray` | Import |
| `./tessellation.js` | `triangulatePolygon, Point2D` | Import |

**Exports:**
- Interfaces: `Point3D`, `SphereGeometryOptions`, `TaperedGeometryOptions`, `CapsuleGeometryOptions`, `TorusGeometryOptions`, `LatheGeometryOptions`, `ExtrudeGeometryOptions`, `TubeGeometryOptions`, `HeightFieldGeometryOptions`
- Functions: `sphereGeometry`, `cylinderGeometry`, `coneGeometry`, `capsuleGeometry`, `torusGeometry`, `latheGeometry`, `extrudeGeometry`, `tubeGeometry`, `heightFieldGeometry`

---

### `packages/geometry/src/primitives.ts` - Primitive geometry builders (§53) — the box, the plane, and the 2D circle.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `BufferGeometry` | Import |
| `./primitive-support.js` | `createIndices, requirePositive` | Import |
| `./tessellation.js` | `triangulatePolygon, Point2D` | Import |

**Exports:**
- Interfaces: `BoxGeometryOptions`, `PlaneGeometryOptions`, `CircleGeometry2DOptions`, `PolygonGeometry2DOptions`
- Functions: `boxGeometry`, `planeGeometry`, `circleGeometry2D`, `polygonGeometry2D`

---

### `packages/geometry/src/resource-memory.ts` - §83 resource accounting for geometries — how many are live, and how many

**Exports:**
- Functions: `noteGeometry`, `geometryMemoryBytes`, `liveGeometryCount`

---

### `packages/geometry/src/svg-path.ts` - §50's *"SVG import/export compatibility"*, at the **path-data tier**: the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./path.js` | `Path, advance, arcPoint, newCursor, PathArcCommand, PathCursor` | Import |

**Exports:**
- Interfaces: `SvgPathParseOptions`
- Functions: `parseSvgPathData`, `formatSvgPathData`
- Constants: `DEFAULT_MAXIMUM_PATH_DATA_LENGTH`

---

### `packages/geometry/src/tessellation.ts` - Polygon tessellation (§52) — the isolated module that turns a closed 2D

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `GeometryIndexArray` | Import (type-only) |
| `./primitive-support.js` | `createIndices, requirePositive` | Import |

**Exports:**
- Interfaces: `Point2D`, `PolygonTessellator`, `Polyline2D`, `StrokeGeometryOptions`, `StrokeMesh`
- Types: `StrokeAlignment`, `StrokeLineCap`, `StrokeLineJoin`
- Functions: `triangulatePolygon`, `expandStroke`
- Constants: `earClippingTessellator`, `DEFAULT_MITER_LIMIT`

---

<a id="packages-input-dependencies"></a>

## Packages/input Dependencies

### `packages/input/src/drag.ts` - Dragging (§72, §120): press a node, move the pointer, get world-space deltas.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Unsubscribe` |
| `@four/math` | `Vector3, DepthRange` |
| `@four/scene` | `resolveWorldTransform, Camera, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./pick.js` | `createPickRay` | Import |
| `./pointer-events.js` | `ScenePointerEvent` | Import (type-only) |
| `./pointer-input.js` | `PointerInput` | Import (type-only) |

**Exports:**
- Classes: `DragManager`
- Interfaces: `DragManagerOptions`
- Types: `DragListener`

---

### `packages/input/src/index.ts` - Package entry point for @four/input (re-exports 37 symbols)

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./drag.js` | `DragManager` | Re-export |
| `./key-events.js` | `SceneKeyEvent, dispatchKeyEvent` | Re-export |
| `./keyboard-input.js` | `KeyboardInput` | Re-export |
| `./pick.js` | `createPickRay, pick` | Re-export |
| `./pointer-events.js` | `CAPTURE_KEY_PREFIX, ScenePointerEvent, dispatchPointerEvent` | Re-export |
| `./pointer-input.js` | `DEFAULT_CLICK_MOVE_THRESHOLD, PointerInput` | Re-export |
| `./propagation.js` | `SceneInputEvent, buildPropagationPath, dispatchThreePhase` | Re-export |
| `./drag.js` | `DragListener, DragManagerOptions` | Re-export (type-only) |
| `./key-events.js` | `KeyDefaultSuppressor, KeyModifiers, SceneKeyEventInit, SceneKeyEventType` | Re-export (type-only) |
| `./keyboard-input.js` | `KeySurface, KeyboardInputOptions, SurfaceKeyEvent, SurfaceKeyListener` | Re-export (type-only) |
| `./pick.js` | `PickHit, Pickable, PickableAlphaMask, PickProvider` | Re-export (type-only) |
| `./pointer-events.js` | `PointerDeviceType, PropagatingPointerEventType, ScenePointerEventInit, ScenePointerEventType` | Re-export (type-only) |
| `./pointer-input.js` | `PointerInputOptions, PointerSurface, SurfacePointerEvent, SurfacePointerListener, SurfaceRect` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DragManager`, `SceneKeyEvent`, `dispatchKeyEvent`, `KeyboardInput`, `createPickRay`, `pick`, `CAPTURE_KEY_PREFIX`, `ScenePointerEvent`, `dispatchPointerEvent`, `DEFAULT_CLICK_MOVE_THRESHOLD`, `PointerInput`, `SceneInputEvent`, `buildPropagationPath`, `dispatchThreePhase`, `DragListener`, `DragManagerOptions`, `KeyDefaultSuppressor`, `KeyModifiers`, `SceneKeyEventInit`, `SceneKeyEventType`, `KeySurface`, `KeyboardInputOptions`, `SurfaceKeyEvent`, `SurfaceKeyListener`, `PickHit`, `Pickable`, `PickableAlphaMask`, `PickProvider`, `PointerDeviceType`, `PropagatingPointerEventType`, `ScenePointerEventInit`, `ScenePointerEventType`, `PointerInputOptions`, `PointerSurface`, `SurfacePointerEvent`, `SurfacePointerListener`, `SurfaceRect`

---

### `packages/input/src/key-events.ts` - Key events and their propagation through the scene graph (§72, §6b,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./propagation.js` | `SceneInputEvent, dispatchThreePhase` | Import |

**Exports:**
- Classes: `SceneKeyEvent`
- Interfaces: `KeyModifiers`, `KeyDefaultSuppressor`, `SceneKeyEventInit`
- Types: `SceneKeyEventType`
- Functions: `dispatchKeyEvent`

---

### `packages/input/src/keyboard-input.ts` - The keyboard source (§72, 2026-08-07, A-10): platform key events in, scene

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./key-events.js` | `SceneKeyEvent, dispatchKeyEvent, KeyDefaultSuppressor, SceneKeyEventType` | Import |
| `./propagation.js` | `buildPropagationPath` | Import |

**Exports:**
- Classes: `KeyboardInput`
- Interfaces: `SurfaceKeyEvent`, `KeySurface`, `KeyboardInputOptions`
- Types: `SurfaceKeyListener`

---

### `packages/input/src/pick.ts` - Picking and hit testing (§71) — the bounds tier.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `Matrix4, Vector3, DepthRange` |
| `@four/scene` | `resolveWorldTransform, Camera, Node` |

**Exports:**
- Interfaces: `PickProvider`, `PickableAlphaMask`, `Pickable`, `PickHit`
- Functions: `createPickRay`, `pick`

---

### `packages/input/src/pointer-events.ts` - Pointer events and their propagation through the scene graph (§72, §6b).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |
| `@four/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./propagation.js` | `SceneInputEvent, dispatchThreePhase` | Import |
| `./propagation.js` | `buildPropagationPath` | Re-export |

**Exports:**
- Classes: `ScenePointerEvent`
- Interfaces: `ScenePointerEventInit`
- Types: `PropagatingPointerEventType`, `ScenePointerEventType`, `PointerDeviceType`
- Functions: `dispatchPointerEvent`
- Constants: `CAPTURE_KEY_PREFIX`
- Re-exports: `buildPropagationPath`

---

### `packages/input/src/pointer-input.ts` - The pointer source (§72): platform pointer events in, scene pointer events

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3, DepthRange` |
| `@four/scene` | `Camera, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./pick.js` | `pick, PickHit, Pickable` | Import |
| `./pointer-events.js` | `ScenePointerEvent, buildPropagationPath, dispatchPointerEvent, PointerDeviceType, PropagatingPointerEventType, ScenePointerEventType` | Import |

**Exports:**
- Classes: `PointerInput`
- Interfaces: `SurfacePointerEvent`, `SurfaceRect`, `PointerSurface`, `PointerInputOptions`
- Types: `SurfacePointerListener`
- Constants: `DEFAULT_CLICK_MOVE_THRESHOLD`

---

### `packages/input/src/propagation.ts` - The propagation machinery every scene input event shares (§72, §6b) — the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/scene` | `Node, NodeEventMap` |

**Exports:**
- Functions: `buildPropagationPath`, `dispatchThreePhase`

---

<a id="packages-materials-dependencies"></a>

## Packages/materials Dependencies

### `packages/materials/src/index.ts` - Package entry point for @four/materials (re-exports 49 symbols)

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./lit-material.js` | `LitMaterial` | Re-export |
| `./material.js` | `Material` | Re-export |
| `./node-material.js` | `NodeMaterial` | Re-export |
| `./node-material-builder.js` | `NodeMaterialBuilder, ShaderExpression, ShaderGraphBuilder, ShaderGraphOutput` | Re-export |
| `./shader-graph.js` | `MAX_SHADER_GRAPH_NODES, MAX_SHADER_GRAPH_TEXTURES, SHADER_ATTRIBUTE_TYPES, SHADER_VALUE_COMPONENTS, analyzeShaderGraph, forEachShaderNodeReference, freezeShaderGraph` | Re-export |
| `./sprite-material.js` | `SpriteMaterial` | Re-export |
| `./stencil-state.js` | `MAX_STENCIL_VALUE, StencilState` | Re-export |
| `./standard-material.js` | `StandardMaterial` | Re-export |
| `./unlit-material.js` | `UnlitMaterial` | Re-export |
| `./lit-material.js` | `LitMaterialOptions` | Re-export (type-only) |
| `./material.js` | `BlendMode, MaterialOptions` | Re-export (type-only) |
| `./node-material.js` | `NodeMaterialOptions` | Re-export (type-only) |
| `./node-material-builder.js` | `ShaderOperand` | Re-export (type-only) |
| `./shader-graph.js` | `ShaderAttributeName, ShaderBinaryOp, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderNodeId, ShaderReflection, ShaderTextureReflection, ShaderUnaryOp, ShaderUniformReflection, ShaderValueType` | Re-export (type-only) |
| `./sprite-material.js` | `SpriteMaterialOptions, SpriteTexture` | Re-export (type-only) |
| `./stencil-state.js` | `StencilFunc, StencilOp, StencilStateOptions` | Re-export (type-only) |
| `./standard-material.js` | `ColorRGB, StandardMaterialOptions` | Re-export (type-only) |
| `./texture.js` | `MaterialTexture, MaterialTextureFilter, MaterialTextureMinFilter, MaterialTextureWrap` | Re-export (type-only) |
| `./unlit-material.js` | `ColorRGBA, UnlitMaterialOptions` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `LitMaterial`, `Material`, `NodeMaterial`, `NodeMaterialBuilder`, `ShaderExpression`, `ShaderGraphBuilder`, `ShaderGraphOutput`, `MAX_SHADER_GRAPH_NODES`, `MAX_SHADER_GRAPH_TEXTURES`, `SHADER_ATTRIBUTE_TYPES`, `SHADER_VALUE_COMPONENTS`, `analyzeShaderGraph`, `forEachShaderNodeReference`, `freezeShaderGraph`, `SpriteMaterial`, `MAX_STENCIL_VALUE`, `StencilState`, `StandardMaterial`, `UnlitMaterial`, `LitMaterialOptions`, `BlendMode`, `MaterialOptions`, `NodeMaterialOptions`, `ShaderOperand`, `ShaderAttributeName`, `ShaderBinaryOp`, `ShaderDomain`, `ShaderGraph`, `ShaderGraphAnalysis`, `ShaderNode`, `ShaderNodeId`, `ShaderReflection`, `ShaderTextureReflection`, `ShaderUnaryOp`, `ShaderUniformReflection`, `ShaderValueType`, `SpriteMaterialOptions`, `SpriteTexture`, `StencilFunc`, `StencilOp`, `StencilStateOptions`, `ColorRGB`, `StandardMaterialOptions`, `MaterialTexture`, `MaterialTextureFilter`, `MaterialTextureMinFilter`, `MaterialTextureWrap`, `ColorRGBA`, `UnlitMaterialOptions`

---

### `packages/materials/src/lit-material.ts` - `LitMaterial` (§57, §68, §120) — one RGBA color that responds to lights.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |
| `./unlit-material.js` | `ColorRGBA` | Import (type-only) |

**Exports:**
- Classes: `LitMaterial`
- Interfaces: `LitMaterialOptions`

---

### `packages/materials/src/material.ts` - `Material` (§57) — the abstract base every material family member extends,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./stencil-state.js` | `StencilState` | Import (type-only) |

**Exports:**
- Interfaces: `MaterialOptions`
- Types: `BlendMode`

---

### `packages/materials/src/node-material-builder.ts` - The fluent authoring surface over `shader-graph.ts`'s IR (§60; RFC 0001).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shader-graph.js` | `analyzeShaderGraph, ShaderAttributeName, ShaderBinaryOp, ShaderDomain, ShaderGraph, ShaderNode, ShaderNodeId, ShaderUnaryOp, ShaderValueType` | Import |
| `./node-material.js` | `NodeMaterial, NodeMaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `ShaderExpression`, `ShaderGraphOutput`, `ShaderGraphBuilder`, `NodeMaterialBuilder`
- Types: `ShaderOperand`

---

### `packages/materials/src/node-material.ts` - `NodeMaterial` (§57, §60) — the material family member that carries a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./shader-graph.js` | `SHADER_VALUE_COMPONENTS, analyzeShaderGraph, freezeShaderGraph, ShaderGraph, ShaderReflection, ShaderValueType` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `NodeMaterial`
- Interfaces: `NodeMaterialOptions`

---

### `packages/materials/src/shader-graph.ts` - The shader graph (§60) — a backend-independent, JSON-serializable shader IR

**Exports:**
- Interfaces: `ShaderGraph`, `ShaderUniformReflection`, `ShaderTextureReflection`, `ShaderReflection`, `ShaderGraphAnalysis`
- Types: `ShaderNodeId`, `ShaderValueType`, `ShaderDomain`, `ShaderAttributeName`, `ShaderUnaryOp`, `ShaderBinaryOp`, `ShaderNode`
- Functions: `forEachShaderNodeReference`, `analyzeShaderGraph`, `freezeShaderGraph`
- Constants: `MAX_SHADER_GRAPH_NODES`, `MAX_SHADER_GRAPH_TEXTURES`, `SHADER_VALUE_COMPONENTS`, `SHADER_ATTRIBUTE_TYPES`

---

### `packages/materials/src/sprite-material.ts` - `SpriteMaterial` (§55, §57) — one texture, one tint.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |
| `./unlit-material.js` | `ColorRGBA` | Import (type-only) |

**Exports:**
- Classes: `SpriteMaterial`
- Interfaces: `SpriteMaterialOptions`
- Types: `SpriteTexture`

---

### `packages/materials/src/standard-material.ts` - `StandardMaterial` (§59) — the metallic-roughness workflow, at the tier this

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `ColorRGB, ColorRGBA` |
| `@four/math` | `ColorRGB` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `StandardMaterial`
- Interfaces: `StandardMaterialOptions`
- Re-exports: `ColorRGB`

---

### `packages/materials/src/stencil-state.ts` - `StencilState` (§57, §67) — the per-material stencil test, write mask, and

**Exports:**
- Classes: `StencilState`
- Interfaces: `StencilStateOptions`
- Types: `StencilFunc`, `StencilOp`
- Constants: `MAX_STENCIL_VALUE`

---

### `packages/materials/src/texture.ts` - The read surface of a texture as a **material** and a rendering backend see

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `ColorSpace` |

**Exports:**
- Interfaces: `MaterialTexture`
- Types: `MaterialTextureFilter`, `MaterialTextureMinFilter`, `MaterialTextureWrap`

---

### `packages/materials/src/unlit-material.ts` - `UnlitMaterial` (§57) — a flat RGBA color, optionally multiplied by a texture

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `ColorRGBA` |
| `@four/math` | `ColorRGBA` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `UnlitMaterial`
- Interfaces: `UnlitMaterialOptions`
- Re-exports: `ColorRGBA`

---

<a id="packages-math-dependencies"></a>

## Packages/math Dependencies

### `packages/math/src/alloc-counter.ts` - Allocation instrumentation for the math types (§7b, §83).

**Exports:**
- Functions: `noteConstruction`, `constructionCount`, `resetConstructionCount`

---

### `packages/math/src/color.ts` - Colour value types, the sRGB transfer functions, and CSS colour-string

**Exports:**
- Types: `ColorRGB`, `ColorRGBA`, `ColorSpace`
- Functions: `srgbToLinear`, `linearToSrgb`, `srgbToLinearRGB`, `linearToSrgbRGB`, `srgbToLinearRGBA`, `linearToSrgbRGBA`, `parseColor`, `parseColorRGB`

---

### `packages/math/src/frustum.ts` - The six clip planes of a view-projection matrix (§87) — the primitive a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./matrix4.js` | `DepthRange, Matrix4` | Import (type-only) |
| `./vector3.js` | `Vector3` | Import (type-only) |

**Exports:**
- Classes: `Frustum`

---

### `packages/math/src/index.ts` - Package entry point for @four/math (re-exports 21 symbols)

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `constructionCount, resetConstructionCount` | Re-export |
| `./color.js` | `linearToSrgb, linearToSrgbRGB, linearToSrgbRGBA, parseColor, parseColorRGB, srgbToLinear, srgbToLinearRGB, srgbToLinearRGBA` | Re-export |
| `./frustum.js` | `Frustum` | Re-export |
| `./matrix3.js` | `Matrix3` | Re-export |
| `./matrix4.js` | `Matrix4` | Re-export |
| `./quaternion.js` | `Quaternion` | Re-export |
| `./vector2.js` | `Vector2` | Re-export |
| `./vector3.js` | `Vector3` | Re-export |
| `./vector4.js` | `Vector4` | Re-export |
| `./color.js` | `ColorRGB, ColorRGBA, ColorSpace` | Re-export (type-only) |
| `./matrix4.js` | `DepthRange` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `constructionCount`, `resetConstructionCount`, `linearToSrgb`, `linearToSrgbRGB`, `linearToSrgbRGBA`, `parseColor`, `parseColorRGB`, `srgbToLinear`, `srgbToLinearRGB`, `srgbToLinearRGBA`, `Frustum`, `Matrix3`, `Matrix4`, `Quaternion`, `Vector2`, `Vector3`, `Vector4`, `ColorRGB`, `ColorRGBA`, `ColorSpace`, `DepthRange`

---

### `packages/math/src/matrix3.ts` - Mutable 3×3 matrix stored **column-major** in a `Float64Array(9)` (§7b).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Matrix3`

---

### `packages/math/src/matrix4.ts` - Clip-space depth convention of a projection matrix (plan D8).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |
| `./quaternion.js` | `setQuaternionFromBasis, Quaternion` | Import |
| `./vector3.js` | `Vector3` | Import (type-only) |

**Exports:**
- Classes: `Matrix4`
- Types: `DepthRange`

---

### `packages/math/src/quaternion.ts` - Above this dot product the two ends of a {@link Quaternion.slerp} are treated

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |
| `./vector3.js` | `Vector3` | Import (type-only) |

**Exports:**
- Classes: `Quaternion`
- Functions: `setQuaternionFromBasis`

---

### `packages/math/src/vector2.ts` - Default tolerance for {@link Vector2.equalsApprox}. Chosen to sit a little

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Vector2`

---

### `packages/math/src/vector3.ts` - Default tolerance for {@link Vector3.equalsApprox}. See `vector2.ts` for the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Vector3`

---

### `packages/math/src/vector4.ts` - Default tolerance for {@link Vector4.equalsApprox}. See `vector2.ts` for the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Vector4`

---

<a id="packages-motion-dependencies"></a>

## Packages/motion Dependencies

### `packages/motion/src/camera-rigs.ts` - §44 camera rigs: {@link OrbitRig} (orbit) and {@link FollowRig} (follow target

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Component, ComponentHost` |
| `@four/math` | `Vector3` |
| `@four/scene` | `resolveWorldTransform, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./rig-target.js` | `placeAtWorldPosition, resolveTargetPosition, worldPositionOf, RigTarget` | Import |
| `./spring-damper.js` | `SpringDamper, SpringDamperVector3Result` | Import (type-only) |

**Exports:**
- Classes: `OrbitRig`, `FollowRig`
- Interfaces: `OrbitRigOptions`, `FollowRigOptions`
- Types: `FollowFrame`
- Constants: `DEFAULT_ORBIT_PITCH_LIMIT`, `DEFAULT_ORBIT_MIN_DISTANCE`

---

### `packages/motion/src/character-controller.ts` - §12's **character controllers** — {@link CharacterController}, the one yaw

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Component, ComponentHost` |
| `@four/scene` | `Transform` |

**Exports:**
- Classes: `CharacterController`, `FirstPersonLook`
- Interfaces: `CharacterControllerOptions`, `FirstPersonLookOptions`
- Constants: `DEFAULT_CHARACTER_GRAVITY`, `DEFAULT_FIRST_PERSON_PITCH_LIMIT`

---

### `packages/motion/src/clock.ts` - Clock and time domains (§9).

**Exports:**
- Interfaces: `TimeState`, `TimeStateOptions`
- Types: `ReadonlyTimeState`
- Functions: `createTimeState`, `copyTimeState`, `assertFixedDeltaTime`, `assertTimeScale`
- Constants: `DEFAULT_FIXED_DELTA_TIME`, `DEFAULT_MAXIMUM_SUB_STEPS`

---

### `packages/motion/src/constraints.ts` - §12's look-at constraint and the §39 step-7 system that runs it, together

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Component, ComponentHost` |
| `@four/math` | `Quaternion, Vector3` |
| `@four/scene` | `resolveWorldTransform, warnAuthorityConflict, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera-rigs.js` | `FollowRig, OrbitRig` | Import |
| `./rig-target.js` | `resolveTargetPosition, RigTarget` | Import |
| `./systems.js` | `PRIORITY_CONSTRAINTS, FixedUpdateContext, SimulationSystem` | Import |

**Exports:**
- Classes: `LookAtConstraint`, `ConstraintSystem`
- Interfaces: `LookAtConstraintOptions`, `ConstraintSystemOptions`

---

### `packages/motion/src/ik.ts` - Analytic two-bone inverse kinematics (§111 "inverse kinematics"; plan P8-1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |

**Exports:**
- Interfaces: `TwoBoneIKSolution`
- Functions: `createTwoBoneIKSolution`, `solveTwoBoneIK`

---

### `packages/motion/src/index.ts` - Package entry point for @four/motion (re-exports 134 symbols)

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera-rigs.js` | `DEFAULT_ORBIT_PITCH_LIMIT, FollowRig, OrbitRig` | Re-export |
| `./character-controller.js` | `CharacterController, DEFAULT_CHARACTER_GRAVITY, DEFAULT_FIRST_PERSON_PITCH_LIMIT, FirstPersonLook` | Re-export |
| `./clock.js` | `DEFAULT_FIXED_DELTA_TIME, DEFAULT_MAXIMUM_SUB_STEPS, assertFixedDeltaTime, assertTimeScale, copyTimeState, createTimeState` | Re-export |
| `./constraints.js` | `ConstraintSystem, LookAtConstraint` | Re-export |
| `./ik.js` | `createTwoBoneIKSolution, solveTwoBoneIK` | Re-export |
| `./integrators.js` | `DEFAULT_INTEGRATOR, INTEGRATORS, explicitEuler, rk2, rk4, semiImplicitEuler, velocityVerlet` | Re-export |
| `./kinematic-controller.js` | `KINEMATIC_COMPLETION_TOLERANCE, KinematicController, KinematicSystem` | Re-export |
| `./motion-component.js` | `MotionComponent, MotionSystem` | Re-export |
| `./serializers.js` | `CHARACTER_CONTROLLER_SERIALIZER, FIRST_PERSON_LOOK_SERIALIZER, FOLLOW_RIG_SERIALIZER, KINEMATIC_CONTROLLER_SERIALIZER, LOOK_AT_CONSTRAINT_SERIALIZER, MOTION_COMPONENT_SERIALIZER, ORBIT_RIG_SERIALIZER` | Re-export |
| `./pid.js` | `DEFAULT_PID_OUTPUT_LIMITS, PIDController` | Re-export |
| `./prediction.js` | `ballisticApexHeight, ballisticTimeOfFlightToPlane, ballisticTimeToApex, interceptPoint, interceptTime, predictBallistic, predictLinear` | Re-export |
| `./random.js` | `SeededRandom` | Re-export |
| `./scheduler.js` | `Scheduler` | Re-export |
| `./spring-damper.js` | `SpringDamper` | Re-export |
| `./steering.js` | `SteeringAgent, WanderState, alignment, arrive, cohesion, evade, flee, pursue, seek, separation, truncate, wander` | Re-export |
| `./systems.js` | `PRIORITY_ANIMATION_TARGETS, PRIORITY_COMMANDS, PRIORITY_CONSTRAINTS, PRIORITY_EVENT_DISPATCH, PRIORITY_FORCES, PRIORITY_INPUT, PRIORITY_KINEMATICS, PRIORITY_PHYSICS_SOLVE, PRIORITY_RENDER_INTERPOLATION, PRIORITY_SENSOR_UPDATE, PRIORITY_SNAPSHOT, SystemRegistry` | Re-export |
| `./trajectories.js` | `BallisticTrajectory, CENTRAL_DIFFERENCE_STEP, CatmullRomTrajectory, CircularTrajectory, CubicBezierTrajectory, DEFAULT_BALLISTIC_ACCELERATION_Y, DampedSpringTrajectory, EllipticalTrajectory, LinearTrajectory, ParabolicTrajectory, ParametricTrajectory` | Re-export |
| `./camera-rigs.js` | `FollowFrame, FollowRigOptions, OrbitRigOptions` | Re-export (type-only) |
| `./character-controller.js` | `CharacterControllerOptions, FirstPersonLookOptions` | Re-export (type-only) |
| `./clock.js` | `ReadonlyTimeState, TimeState, TimeStateOptions` | Re-export (type-only) |
| `./constraints.js` | `ConstraintSystemOptions, LookAtConstraintOptions` | Re-export (type-only) |
| `./ik.js` | `TwoBoneIKSolution` | Re-export (type-only) |
| `./integrators.js` | `AccelerationFn, Integrator, IntegratorFn, IntegratorState` | Re-export (type-only) |
| `./kinematic-controller.js` | `KinematicSystemOptions, MoveOptions, PathFollowOptions, RotateOptions` | Re-export (type-only) |
| `./motion-component.js` | `MotionComponentOptions, MotionSystemOptions` | Re-export (type-only) |
| `./rig-target.js` | `RigTarget` | Re-export (type-only) |
| `./serializers.js` | `ComponentSerializerShape` | Re-export (type-only) |
| `./pid.js` | `PIDControllerOptions, PIDDerivativeSource` | Re-export (type-only) |
| `./scheduler.js` | `SchedulerCallback, SchedulerOptions` | Re-export (type-only) |
| `./spring-damper.js` | `SpringDamperCoefficientOptions, SpringDamperFrequencyOptions, SpringDamperOptions, SpringDamperResult, SpringDamperVector3Result` | Re-export (type-only) |
| `./steering.js` | `SteeringAgentOptions, SteeringContext, SteeringNeighbor, WanderStateOptions` | Re-export (type-only) |
| `./systems.js` | `Detach, FixedUpdateContext, SimulationContext, SimulationSystem, Unregister` | Re-export (type-only) |
| `./trajectories.js` | `BallisticTrajectoryOptions, CatmullRomTrajectoryOptions, CircularTrajectoryOptions, CubicBezierTrajectoryOptions, DampedSpringTrajectoryOptions, EllipticalTrajectoryOptions, LinearTrajectoryOptions, ParabolicTrajectoryOptions, ParametricTrajectoryOptions, Trajectory` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_ORBIT_PITCH_LIMIT`, `FollowRig`, `OrbitRig`, `CharacterController`, `DEFAULT_CHARACTER_GRAVITY`, `DEFAULT_FIRST_PERSON_PITCH_LIMIT`, `FirstPersonLook`, `DEFAULT_FIXED_DELTA_TIME`, `DEFAULT_MAXIMUM_SUB_STEPS`, `assertFixedDeltaTime`, `assertTimeScale`, `copyTimeState`, `createTimeState`, `ConstraintSystem`, `LookAtConstraint`, `createTwoBoneIKSolution`, `solveTwoBoneIK`, `DEFAULT_INTEGRATOR`, `INTEGRATORS`, `explicitEuler`, `rk2`, `rk4`, `semiImplicitEuler`, `velocityVerlet`, `KINEMATIC_COMPLETION_TOLERANCE`, `KinematicController`, `KinematicSystem`, `MotionComponent`, `MotionSystem`, `CHARACTER_CONTROLLER_SERIALIZER`, `FIRST_PERSON_LOOK_SERIALIZER`, `FOLLOW_RIG_SERIALIZER`, `KINEMATIC_CONTROLLER_SERIALIZER`, `LOOK_AT_CONSTRAINT_SERIALIZER`, `MOTION_COMPONENT_SERIALIZER`, `ORBIT_RIG_SERIALIZER`, `DEFAULT_PID_OUTPUT_LIMITS`, `PIDController`, `ballisticApexHeight`, `ballisticTimeOfFlightToPlane`, `ballisticTimeToApex`, `interceptPoint`, `interceptTime`, `predictBallistic`, `predictLinear`, `SeededRandom`, `Scheduler`, `SpringDamper`, `SteeringAgent`, `WanderState`, `alignment`, `arrive`, `cohesion`, `evade`, `flee`, `pursue`, `seek`, `separation`, `truncate`, `wander`, `PRIORITY_ANIMATION_TARGETS`, `PRIORITY_COMMANDS`, `PRIORITY_CONSTRAINTS`, `PRIORITY_EVENT_DISPATCH`, `PRIORITY_FORCES`, `PRIORITY_INPUT`, `PRIORITY_KINEMATICS`, `PRIORITY_PHYSICS_SOLVE`, `PRIORITY_RENDER_INTERPOLATION`, `PRIORITY_SENSOR_UPDATE`, `PRIORITY_SNAPSHOT`, `SystemRegistry`, `BallisticTrajectory`, `CENTRAL_DIFFERENCE_STEP`, `CatmullRomTrajectory`, `CircularTrajectory`, `CubicBezierTrajectory`, `DEFAULT_BALLISTIC_ACCELERATION_Y`, `DampedSpringTrajectory`, `EllipticalTrajectory`, `LinearTrajectory`, `ParabolicTrajectory`, `ParametricTrajectory`, `FollowFrame`, `FollowRigOptions`, `OrbitRigOptions`, `CharacterControllerOptions`, `FirstPersonLookOptions`, `ReadonlyTimeState`, `TimeState`, `TimeStateOptions`, `ConstraintSystemOptions`, `LookAtConstraintOptions`, `TwoBoneIKSolution`, `AccelerationFn`, `Integrator`, `IntegratorFn`, `IntegratorState`, `KinematicSystemOptions`, `MoveOptions`, `PathFollowOptions`, `RotateOptions`, `MotionComponentOptions`, `MotionSystemOptions`, `RigTarget`, `ComponentSerializerShape`, `PIDControllerOptions`, `PIDDerivativeSource`, `SchedulerCallback`, `SchedulerOptions`, `SpringDamperCoefficientOptions`, `SpringDamperFrequencyOptions`, `SpringDamperOptions`, `SpringDamperResult`, `SpringDamperVector3Result`, `SteeringAgentOptions`, `SteeringContext`, `SteeringNeighbor`, `WanderStateOptions`, `Detach`, `FixedUpdateContext`, `SimulationContext`, `SimulationSystem`, `Unregister`, `BallisticTrajectoryOptions`, `CatmullRomTrajectoryOptions`, `CircularTrajectoryOptions`, `CubicBezierTrajectoryOptions`, `DampedSpringTrajectoryOptions`, `EllipticalTrajectoryOptions`, `LinearTrajectoryOptions`, `ParabolicTrajectoryOptions`, `ParametricTrajectoryOptions`, `Trajectory`

---

### `packages/motion/src/integrators.ts` - Numerical integrators (§38).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |

**Exports:**
- Types: `Integrator`, `IntegratorState`, `AccelerationFn`, `IntegratorFn`
- Constants: `explicitEuler`, `semiImplicitEuler`, `velocityVerlet`, `rk2`, `rk4`, `INTEGRATORS`, `DEFAULT_INTEGRATOR`

---

### `packages/motion/src/kinematic-controller.ts` - Kinematic motion (§12) — the {@link KinematicController} component and the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Component, ComponentHost` |
| `@four/math` | `Quaternion, Vector3` |
| `@four/scene` | `warnAuthorityConflict, Node, Transform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./character-controller.js` | `CharacterController, FirstPersonLook` | Import |
| `./systems.js` | `PRIORITY_KINEMATICS, FixedUpdateContext, SimulationSystem` | Import |
| `./trajectories.js` | `Trajectory` | Import (type-only) |

**Exports:**
- Classes: `KinematicController`, `KinematicSystem`
- Interfaces: `MoveOptions`, `RotateOptions`, `PathFollowOptions`, `KinematicSystemOptions`
- Constants: `KINEMATIC_COMPLETION_TOLERANCE`

---

### `packages/motion/src/motion-component.ts` - `MotionComponent` (§11) and the system that advances it (§39 step 4).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Component, ComponentHost` |
| `@four/math` | `Quaternion, Vector3` |
| `@four/scene` | `warnAuthorityConflict, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./systems.js` | `PRIORITY_KINEMATICS, FixedUpdateContext, SimulationSystem` | Import |

**Exports:**
- Classes: `MotionComponent`, `MotionSystem`
- Interfaces: `MotionComponentOptions`, `MotionSystemOptions`

---

### `packages/motion/src/pid.ts` - PID controller utility (§111).

**Exports:**
- Classes: `PIDController`
- Interfaces: `PIDControllerOptions`
- Types: `PIDDerivativeSource`
- Constants: `DEFAULT_PID_OUTPUT_LIMITS`

---

### `packages/motion/src/prediction.ts` - Trajectory prediction (§111 "trajectory prediction"; plan P8-1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |

**Exports:**
- Functions: `predictBallistic`, `predictLinear`, `ballisticTimeToApex`, `ballisticApexHeight`, `ballisticTimeOfFlightToPlane`, `interceptTime`, `interceptPoint`

---

### `packages/motion/src/random.ts` - `SeededRandom`'s original home (WP-8.2), now a re-export of `@four/core`.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `SeededRandom` |

**Exports:**
- Re-exports: `SeededRandom`

---

### `packages/motion/src/rig-target.ts` - What a rig aims at, and how a rig writes a world-space placement back onto a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix4, Vector3` |
| `@four/scene` | `resolveWorldTransform, Node` |

**Exports:**
- Types: `RigTarget`
- Functions: `resolveTargetPosition`, `worldPositionOf`, `placeAtWorldPosition`

---

### `packages/motion/src/scheduler.ts` - Fixed-step scheduler (§10).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clock.js` | `DEFAULT_FIXED_DELTA_TIME, DEFAULT_MAXIMUM_SUB_STEPS, assertFixedDeltaTime, assertTimeScale, createTimeState, ReadonlyTimeState, TimeState` | Import |

**Exports:**
- Classes: `Scheduler`
- Interfaces: `SchedulerOptions`
- Types: `SchedulerCallback`

---

### `packages/motion/src/serializers.ts` - The §79 serializers for this package's components (PH-17, 2026-08-06;

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `JsonValue` |
| `@four/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera-rigs.js` | `DEFAULT_ORBIT_MIN_DISTANCE, DEFAULT_ORBIT_PITCH_LIMIT, FollowRig, OrbitRig` | Import |
| `./character-controller.js` | `CharacterController, DEFAULT_CHARACTER_GRAVITY, DEFAULT_FIRST_PERSON_PITCH_LIMIT, FirstPersonLook` | Import |
| `./constraints.js` | `LookAtConstraint` | Import |
| `./kinematic-controller.js` | `KinematicController` | Import |
| `./motion-component.js` | `MotionComponent` | Import |
| `./rig-target.js` | `RigTarget` | Import (type-only) |
| `./spring-damper.js` | `SpringDamper` | Import |

**Exports:**
- Interfaces: `ComponentSerializerShape`
- Constants: `MOTION_COMPONENT_SERIALIZER`, `KINEMATIC_CONTROLLER_SERIALIZER`, `ORBIT_RIG_SERIALIZER`, `FOLLOW_RIG_SERIALIZER`, `LOOK_AT_CONSTRAINT_SERIALIZER`, `CHARACTER_CONTROLLER_SERIALIZER`, `FIRST_PERSON_LOOK_SERIALIZER`

---

### `packages/motion/src/spring-damper.ts` - Spring-damper controller (§111), the game-smoothing primitive.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |

**Exports:**
- Classes: `SpringDamper`
- Interfaces: `SpringDamperCoefficientOptions`, `SpringDamperFrequencyOptions`, `SpringDamperResult`, `SpringDamperVector3Result`
- Types: `SpringDamperOptions`

---

### `packages/motion/src/steering.ts` - Steering behaviours and flocking (§12 "steering behaviours", §111), plan

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./random.js` | `SeededRandom` | Import (type-only) |

**Exports:**
- Classes: `WanderState`, `SteeringAgent`
- Interfaces: `SteeringNeighbor`, `SteeringContext`, `WanderStateOptions`, `SteeringAgentOptions`
- Functions: `truncate`, `seek`, `flee`, `arrive`, `pursue`, `evade`, `wander`, `separation`, `cohesion`, `alignment`

---

### `packages/motion/src/systems.ts` - Simulation systems and the priority registry (§39).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clock.js` | `ReadonlyTimeState` | Import (type-only) |
| `./scheduler.js` | `Scheduler, SchedulerCallback` | Import (type-only) |

**Exports:**
- Classes: `SystemRegistry`
- Interfaces: `SimulationContext`, `FixedUpdateContext`, `SimulationSystem`
- Types: `Unregister`, `Detach`
- Constants: `PRIORITY_INPUT`, `PRIORITY_COMMANDS`, `PRIORITY_ANIMATION_TARGETS`, `PRIORITY_KINEMATICS`, `PRIORITY_FORCES`, `PRIORITY_PHYSICS_SOLVE`, `PRIORITY_CONSTRAINTS`, `PRIORITY_SENSOR_UPDATE`, `PRIORITY_EVENT_DISPATCH`, `PRIORITY_SNAPSHOT`, `PRIORITY_RENDER_INTERPOLATION`

---

### `packages/motion/src/trajectories.ts` - Trajectory system (§13).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |

**Exports:**
- Classes: `LinearTrajectory`, `ParabolicTrajectory`, `BallisticTrajectory`, `CircularTrajectory`, `EllipticalTrajectory`, `CubicBezierTrajectory`, `CatmullRomTrajectory`, `DampedSpringTrajectory`, `ParametricTrajectory`
- Interfaces: `Trajectory`, `LinearTrajectoryOptions`, `ParabolicTrajectoryOptions`, `BallisticTrajectoryOptions`, `CircularTrajectoryOptions`, `EllipticalTrajectoryOptions`, `CubicBezierTrajectoryOptions`, `CatmullRomTrajectoryOptions`, `DampedSpringTrajectoryOptions`, `ParametricTrajectoryOptions`
- Constants: `CENTRAL_DIFFERENCE_STEP`, `DEFAULT_BALLISTIC_ACCELERATION_Y`

---

<a id="packages-particles-dependencies"></a>

## Packages/particles Dependencies

### `packages/particles/src/emitter.ts` - `ParticleEmitter` — the CPU particle simulation (§36, plan P9-1, WP-9.1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./pool.js` | `ParticlePool` | Import |
| `./random.js` | `SeededRandom` | Import |
| `./types.js` | `ParticleBurst, ParticleColor, ParticleForceField, ParticleLifetimeRamp, ParticleRange` | Import (type-only) |

**Exports:**
- Classes: `ParticleEmitter`
- Interfaces: `ParticleEmitterOptions`
- Constants: `PARTICLE_DRAWS_PER_SPAWN`, `DEFAULT_PARTICLE_SEED`, `DEFAULT_PARTICLE_LIFETIME_SECONDS`, `DEFAULT_PARTICLE_SIZE`, `DEFAULT_PARTICLE_RESTITUTION`

---

### `packages/particles/src/fields.ts` - The §27 built-in force fields, MVP tier (plan P9-2, WP-9.2).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEFAULT_GRAVITY_Y` |
| `@four/math` | `Vector3` |
| `@four/core` | `DEFAULT_GRAVITY_Y` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./random.js` | `SeededRandom` | Import |
| `./types.js` | `ParticleForceField` | Import (type-only) |

**Exports:**
- Interfaces: `RadialFieldOptions`, `VortexFieldOptions`, `TurbulenceFieldOptions`, `SphereFieldVolume`, `BoxFieldVolume`
- Types: `FieldVolume`
- Functions: `uniformGravityField`, `dragField`, `windField`, `radialField`, `vortexField`, `turbulenceField`, `volumeField`
- Constants: `DEFAULT_RADIAL_MIN_DISTANCE`, `DEFAULT_VORTEX_MIN_DISTANCE`, `DEFAULT_TURBULENCE_FREQUENCY`, `DEFAULT_TURBULENCE_AMPLITUDE`, `TURBULENCE_DIFFERENCE_CELLS`
- Re-exports: `DEFAULT_GRAVITY_Y`

---

### `packages/particles/src/index.ts` - --- WP-9.2: §27 force fields (begin) ---

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./emitter.js` | `DEFAULT_PARTICLE_LIFETIME_SECONDS, DEFAULT_PARTICLE_RESTITUTION, DEFAULT_PARTICLE_SEED, DEFAULT_PARTICLE_SIZE, PARTICLE_DRAWS_PER_SPAWN, ParticleEmitter` | Re-export |
| `./pool.js` | `ParticlePool` | Re-export |
| `./fields.js` | `DEFAULT_GRAVITY_Y, DEFAULT_RADIAL_MIN_DISTANCE, DEFAULT_TURBULENCE_AMPLITUDE, DEFAULT_TURBULENCE_FREQUENCY, DEFAULT_VORTEX_MIN_DISTANCE, TURBULENCE_DIFFERENCE_CELLS, dragField, radialField, turbulenceField, uniformGravityField, volumeField, vortexField, windField` | Re-export |
| `./particle-renderable.js` | `PARTICLE_INSTANCE_FLOATS, ParticleRenderable` | Re-export |
| `./particle-system.js` | `PRIORITY_PARTICLES, ParticleSystem` | Re-export |
| `./random.js` | `SeededRandom` | Re-export |
| `./emitter.js` | `ParticleEmitterOptions` | Re-export (type-only) |
| `./fields.js` | `BoxFieldVolume, FieldVolume, RadialFieldOptions, SphereFieldVolume, TurbulenceFieldOptions, VortexFieldOptions` | Re-export (type-only) |
| `./particle-renderable.js` | `ParticleRenderableOptions` | Re-export (type-only) |
| `./particle-system.js` | `ParticleFixedUpdateContext, ParticleStepTime, ParticleSystemOptions, SteppableEmitter` | Re-export (type-only) |
| `./types.js` | `ParticleBurst, ParticleColor, ParticleForceField, ParticleLifetimeRamp, ParticleRange` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_PARTICLE_LIFETIME_SECONDS`, `DEFAULT_PARTICLE_RESTITUTION`, `DEFAULT_PARTICLE_SEED`, `DEFAULT_PARTICLE_SIZE`, `PARTICLE_DRAWS_PER_SPAWN`, `ParticleEmitter`, `ParticlePool`, `DEFAULT_GRAVITY_Y`, `DEFAULT_RADIAL_MIN_DISTANCE`, `DEFAULT_TURBULENCE_AMPLITUDE`, `DEFAULT_TURBULENCE_FREQUENCY`, `DEFAULT_VORTEX_MIN_DISTANCE`, `TURBULENCE_DIFFERENCE_CELLS`, `dragField`, `radialField`, `turbulenceField`, `uniformGravityField`, `volumeField`, `vortexField`, `windField`, `PARTICLE_INSTANCE_FLOATS`, `ParticleRenderable`, `PRIORITY_PARTICLES`, `ParticleSystem`, `SeededRandom`, `ParticleEmitterOptions`, `BoxFieldVolume`, `FieldVolume`, `RadialFieldOptions`, `SphereFieldVolume`, `TurbulenceFieldOptions`, `VortexFieldOptions`, `ParticleRenderableOptions`, `ParticleFixedUpdateContext`, `ParticleStepTime`, `ParticleSystemOptions`, `SteppableEmitter`, `ParticleBurst`, `ParticleColor`, `ParticleForceField`, `ParticleLifetimeRamp`, `ParticleRange`

---

### `packages/particles/src/particle-renderable.ts` - `ParticleRenderable` (§36, §49, plan P9-3) — the scene node that puts a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |
| `@four/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./emitter.js` | `ParticleEmitter` | Import (type-only) |

**Exports:**
- Classes: `ParticleRenderable`
- Interfaces: `ParticleRenderableOptions`
- Constants: `PARTICLE_INSTANCE_FLOATS`

---

### `packages/particles/src/particle-system.ts` - `ParticleSystem` (§39, §36, plan WP-9.4) — the fixed-step driver that steps

**Exports:**
- Classes: `ParticleSystem`
- Interfaces: `ParticleStepTime`, `ParticleFixedUpdateContext`, `SteppableEmitter`, `ParticleSystemOptions`
- Constants: `PRIORITY_PARTICLES`

---

### `packages/particles/src/pool.ts` - The particle pool (§36, plan P9-1) — a fixed-capacity, structure-of-arrays

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3, Vector4` |

**Exports:**
- Classes: `ParticlePool`

---

### `packages/particles/src/random.ts` - `SeededRandom` for particles — a re-export of `@four/core`.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `SeededRandom` |

**Exports:**
- Re-exports: `SeededRandom`

---

### `packages/particles/src/types.ts` - Shared particle types (§27, §36) — the vocabulary WP-9.1's pool and emitter

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |

**Exports:**
- Interfaces: `ParticleForceField`, `ParticleRange`, `ParticleLifetimeRamp`, `ParticleColor`, `ParticleBurst`

---

<a id="packages-physics-dependencies"></a>

## Packages/physics Dependencies

### `packages/physics/src/adapter.ts` - The solver adapter contract (§37) — the seam every physics backend

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./descriptors.js` | `ColliderDescriptor, JointDescriptor, PhysicsWorldOptions, RigidBodyDescriptor` | Import (type-only) |
| `./events.js` | `PhysicsEvent` | Import (type-only) |
| `./queries.js` | `OverlapHit, OverlapQuery, PointHit, PointQuery, RaycastHit, RaycastQuery, ShapeCastHit, ShapeCastQuery` | Import (type-only) |
| `./types.js` | `CCDMode, DeterminismLevel, PhysicsBodyHandle, PhysicsColliderHandle, PhysicsDimension, PhysicsJointHandle` | Import (type-only) |

**Exports:**
- Interfaces: `PhysicsQueryCapabilities`, `PhysicsTuningCapabilities`, `PhysicsCapabilities`, `PhysicsSolverAdapter`
- Functions: `resolveTuningCapabilities`
- Constants: `NO_TUNING_CAPABILITIES`

---

### `packages/physics/src/body-access.ts` - Per-handle access to a solver's bodies — the seam §37's two `sync*` methods

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix3, Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./types.js` | `AngularVelocityInput, BodyType, CCDMode, PhysicsBodyHandle, PhysicsColliderHandle, PhysicsJointHandle, RotationInput, Vector3Input` | Import (type-only) |

**Exports:**
- Interfaces: `SolverBodyAccess`, `SolverBodyTuningAccess`, `SolverJointMotor`, `SolverJointAccess`
- Functions: `supportsSolverJointAccess`, `missingSolverJointAccess`, `supportsSolverBodyTuning`, `missingSolverBodyTuning`

---

### `packages/physics/src/collider.ts` - The `Collider` component (§6a, §24) and its §25 effective-material

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `EventEmitter, FourError, Component, ComponentHost` |
| `@four/scene` | `Node, Transform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./descriptors.js` | `ColliderDescriptor` | Import (type-only) |
| `./events.js` | `CollisionEvent, TriggerEvent` | Import (type-only) |
| `./material.js` | `PhysicsMaterial` | Import (type-only) |
| `./material.js` | `DEFAULT_FRICTION, DEFAULT_RESTITUTION, resolveDensity` | Import |
| `./queries.js` | `ALL_COLLISION_GROUPS` | Import |
| `./rigid-body.js` | `RigidBody` | Import |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./shapes.js` | `shapeSupportsDimension, validateCollisionShape` | Import |
| `./types.js` | `PhysicsBodyHandle, PhysicsDimension` | Import (type-only) |
| `./validation.js` | `validateColliderDescriptor` | Import |

**Exports:**
- Classes: `Collider`
- Interfaces: `ColliderEventMap`
- Types: `ColliderOptions`, `ColliderTriggerEvent`, `RigidBodyCollisionEvent`

---

### `packages/physics/src/descriptors.ts` - The descriptors an adapter is built from (§37) and the §21 widening helpers

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEFAULT_GRAVITY_Y, FourError, SpaceMode` |
| `@four/math` | `Quaternion, Vector3` |
| `@four/math` | `Matrix3` |
| `@four/scene` | `Transform` |
| `@four/core` | `DEFAULT_GRAVITY_Y` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `PhysicsMaterial` | Import (type-only) |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./types.js` | `AngularVelocityInput, BodyType, CCDMode, DeterminismLevel, PhysicsBodyHandle, PhysicsDimension, RotationInput, SleepingConfig, Vector3Input` | Import (type-only) |
| `./types.js` | `DEFAULT_SLEEPING_CONFIG` | Import |

**Exports:**
- Interfaces: `RigidBodyDescriptor`, `ColliderDescriptor`, `JointLimits`, `AngularJointMotor`, `LinearJointMotor`, `SphericalJointLimits`, `JointDescriptorBase`, `FixedJointDescriptor`, `RevoluteJointDescriptor`, `PrismaticJointDescriptor`, `RopeJointDescriptor`, `SpringJointDescriptor`, `SphericalJointDescriptor`, `PhysicsWorldOptions`
- Types: `JointType`, `ShippedJointType`, `StagedJointType`, `JointDescriptor`
- Functions: `jointTypeSupportsDimension`, `widenToVector3`, `resolveGravity`, `resolveRotation`, `resolveAngularVelocity`, `resolveSleepingConfig`
- Constants: `JOINT_TYPES`, `SHIPPED_JOINT_TYPES`, `SHIPPED_JOINT_TYPES_2D`, `SHIPPED_JOINT_TYPES_3D`, `STAGED_JOINT_TYPES`
- Re-exports: `DEFAULT_GRAVITY_Y`

---

### `packages/physics/src/events.ts` - Collision, trigger, and sleep event payloads (§29, §32, §37).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./types.js` | `PhysicsBodyHandle, PhysicsColliderHandle, PhysicsJointHandle` | Import (type-only) |

**Exports:**
- Interfaces: `ContactPoint`, `CollisionEvent`, `TriggerEvent`, `SleepEvent`, `JointBreakEvent`
- Types: `CollisionPhase`, `TriggerPhase`, `SleepPhase`, `JointPhase`, `PhysicsEventType`, `PhysicsEvent`

---

### `packages/physics/src/force-field.ts` - §27 force fields for rigid bodies, through §26's force API (PH-8,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |
| `@four/motion` | `PRIORITY_FORCES, FixedUpdateContext, SimulationSystem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./rigid-body.js` | `RigidBody` | Import (type-only) |
| `./world.js` | `PhysicsWorld` | Import (type-only) |

**Exports:**
- Classes: `ForceFieldSystem`
- Interfaces: `ForceField`, `ForceFieldEntry`, `ForceFieldSystemOptions`
- Types: `ForceFieldUnits`

---

### `packages/physics/src/index.ts` - `@four/physics` — the stable, solver-independent physics API (§101, Part IV).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./adapter.js` | `NO_TUNING_CAPABILITIES, resolveTuningCapabilities` | Re-export |
| `./body-access.js` | `missingSolverBodyTuning, missingSolverJointAccess, supportsSolverBodyTuning, supportsSolverJointAccess` | Re-export |
| `./collider.js` | `Collider` | Re-export |
| `./descriptors.js` | `DEFAULT_GRAVITY_Y, JOINT_TYPES, SHIPPED_JOINT_TYPES, SHIPPED_JOINT_TYPES_2D, SHIPPED_JOINT_TYPES_3D, STAGED_JOINT_TYPES, jointTypeSupportsDimension, resolveAngularVelocity, resolveGravity, resolveRotation, resolveSleepingConfig, widenToVector3` | Re-export |
| `./force-field.js` | `ForceFieldSystem` | Re-export |
| `./joints.js` | `BallJoint, FixedJoint, HingeJoint, Joint, PrismaticJoint, RevoluteJoint, RopeJoint, SliderJoint, SphericalJoint, SpringJoint, worldAnchorToLocal, worldAxisToLocal` | Re-export |
| `./physics-event-system.js` | `PhysicsEventSystem` | Re-export |
| `./physics-system.js` | `PhysicsSystem` | Re-export |
| `./material.js` | `DEFAULT_DENSITY, DEFAULT_FRICTION, DEFAULT_FRICTION_COMBINE_MODE, DEFAULT_RESTITUTION, DEFAULT_RESTITUTION_COMBINE_MODE, PhysicsMaterial, combineFriction, combineRestitution, combineValues, resolveDensity` | Re-export |
| `./queries.js` | `ALL_COLLISION_GROUPS, passesQueryFilter, resolveQueryOptions, sortHitsByDistance` | Re-export |
| `./serializers.js` | `COLLIDER_SERIALIZER, RIGID_BODY_SERIALIZER, SWEPT_CHARACTER_CONTROLLER_SERIALIZER, deserializeCollisionShape, serializeCollisionShape` | Re-export |
| `./rigid-body.js` | `RigidBody` | Re-export |
| `./solver-registry.js` | `SolverRegistry, clearRegisteredSolvers, registerSolver, registeredSolvers, resolveSolver` | Re-export |
| `./shapes.js` | `COLLISION_SHAPE_TYPES_2D, COLLISION_SHAPE_TYPES_3D, COMPOSITE_COLLISION_SHAPE_TYPES, shapeIsConvex, shapeMaximumExtent, shapeSupportsDimension, validateCollisionShape, validateQueryShape` | Re-export |
| `./types.js` | `BODY_TYPES, CCD_MODES, COMBINE_MODES, DEFAULT_CCD_MODE, DEFAULT_DETERMINISM_LEVEL, DEFAULT_ENABLED_CCD_MODE, DEFAULT_SLEEPING_CONFIG, DETERMINISM_LEVELS, PHYSICS_DIMENSIONS` | Re-export |
| `./validation.js` | `validateAngularJointMotor, validateColliderDescriptor, validateInertiaTensor, validateJointBreakThreshold, validateJointDescriptor, validateJointLimits, validateLinearJointMotor, validateMass, validatePhysicsWorldOptions, validateRigidBodyDescriptor, validateSphericalJointLimits` | Re-export |
| `./swept-character-controller.js` | `DEFAULT_GROUND_SNAP_DISTANCE, DEFAULT_MAX_SLIDES, DEFAULT_SKIN_WIDTH, DEFAULT_SLOPE_LIMIT, DEFAULT_STEP_HEIGHT, SweptCharacterController, SweptCharacterSystem` | Re-export |
| `./world.js` | `POSE_TARGET_CAPTURE_PRIORITY, PhysicsWorld, createPoseTargetCaptureSystem` | Re-export |
| `./adapter.js` | `PhysicsCapabilities, PhysicsQueryCapabilities, PhysicsSolverAdapter, PhysicsTuningCapabilities` | Re-export (type-only) |
| `./body-access.js` | `SolverBodyAccess, SolverBodyTuningAccess, SolverJointAccess, SolverJointMotor` | Re-export (type-only) |
| `./collider.js` | `ColliderEventMap, ColliderOptions, ColliderTriggerEvent, RigidBodyCollisionEvent` | Re-export (type-only) |
| `./descriptors.js` | `AngularJointMotor, ColliderDescriptor, FixedJointDescriptor, JointDescriptor, JointDescriptorBase, JointLimits, JointType, LinearJointMotor, PhysicsWorldOptions, PrismaticJointDescriptor, RevoluteJointDescriptor, RigidBodyDescriptor, RopeJointDescriptor, ShippedJointType, SphericalJointDescriptor, SphericalJointLimits, SpringJointDescriptor, StagedJointType` | Re-export (type-only) |
| `./events.js` | `CollisionEvent, CollisionPhase, ContactPoint, JointBreakEvent, JointPhase, PhysicsEvent, PhysicsEventType, SleepEvent, SleepPhase, TriggerEvent, TriggerPhase` | Re-export (type-only) |
| `./force-field.js` | `ForceField, ForceFieldEntry, ForceFieldSystemOptions, ForceFieldUnits` | Re-export (type-only) |
| `./joints.js` | `HingeJointOptions, JointBinding, JointBreakPayload, JointCommands, JointEventMap, JointOptions, RopeJointOptions, SliderJointOptions, SphericalJointOptions, SpringJointOptions` | Re-export (type-only) |
| `./material.js` | `PhysicsMaterialOptions` | Re-export (type-only) |
| `./physics-event-system.js` | `PhysicsEventSystemOptions` | Re-export (type-only) |
| `./physics-system.js` | `PhysicsSystemOptions` | Re-export (type-only) |
| `./queries.js` | `OverlapHit, OverlapQuery, PointHit, PointQuery, QueryCandidate, QueryFilter, QueryHit, QueryHitMode, QueryOptions, RaycastHit, RaycastQuery, ResolvedQueryOptions, ShapeCastHit, ShapeCastQuery` | Re-export (type-only) |
| `./serializers.js` | `ColliderDocument, PhysicsMaterialDocument, RigidBodyDocument` | Re-export (type-only) |
| `./rigid-body.js` | `BlendWeights, PointLoad, RigidBodyCommands, RigidBodyEventMap, RigidBodySleepEvent, SleepCommand, TorqueInput` | Re-export (type-only) |
| `./solver-registry.js` | `SolverName, SolverRegistration, SolverRejectionReason, SolverRejectionReport, SolverResolveOptions, SolverSelection` | Re-export (type-only) |
| `./shapes.js` | `BoxShape, CapsuleShape, ChainShape, CircleShape, CollisionShape, CollisionShape2D, CollisionShape3D, CollisionShapeType, ConeShape, ConvexHullShape, CylinderShape, HeightFieldShape, PolygonShape, PolylineShape, RectangleShape, SphereShape, TriangleMeshShape` | Re-export (type-only) |
| `./types.js` | `AngularVelocityInput, BodyType, CCDMode, CombineMode, DeterminismLevel, PhysicsBodyHandle, PhysicsColliderHandle, PhysicsDimension, PhysicsHandle, PhysicsJointHandle, RotationInput, SleepingConfig, Vector3Input` | Re-export (type-only) |
| `./swept-character-controller.js` | `SweptCharacterControllerOptions, SweptCharacterSystemOptions` | Re-export (type-only) |
| `./world.js` | `ActiveBodyVisitor, BodyControlModeOptions, PhysicsSnapshot, PhysicsSnapshotConfiguration, PhysicsWorldAdapter, PhysicsWorldInit, PoseTargetCaptureSystemOptions, WorldOverlapHit, WorldPhysicsEvent, WorldPointHit, WorldQueryHit, WorldRaycastHit, WorldShapeCastHit` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `NO_TUNING_CAPABILITIES`, `resolveTuningCapabilities`, `missingSolverBodyTuning`, `missingSolverJointAccess`, `supportsSolverBodyTuning`, `supportsSolverJointAccess`, `Collider`, `DEFAULT_GRAVITY_Y`, `JOINT_TYPES`, `SHIPPED_JOINT_TYPES`, `SHIPPED_JOINT_TYPES_2D`, `SHIPPED_JOINT_TYPES_3D`, `STAGED_JOINT_TYPES`, `jointTypeSupportsDimension`, `resolveAngularVelocity`, `resolveGravity`, `resolveRotation`, `resolveSleepingConfig`, `widenToVector3`, `ForceFieldSystem`, `BallJoint`, `FixedJoint`, `HingeJoint`, `Joint`, `PrismaticJoint`, `RevoluteJoint`, `RopeJoint`, `SliderJoint`, `SphericalJoint`, `SpringJoint`, `worldAnchorToLocal`, `worldAxisToLocal`, `PhysicsEventSystem`, `PhysicsSystem`, `DEFAULT_DENSITY`, `DEFAULT_FRICTION`, `DEFAULT_FRICTION_COMBINE_MODE`, `DEFAULT_RESTITUTION`, `DEFAULT_RESTITUTION_COMBINE_MODE`, `PhysicsMaterial`, `combineFriction`, `combineRestitution`, `combineValues`, `resolveDensity`, `ALL_COLLISION_GROUPS`, `passesQueryFilter`, `resolveQueryOptions`, `sortHitsByDistance`, `COLLIDER_SERIALIZER`, `RIGID_BODY_SERIALIZER`, `SWEPT_CHARACTER_CONTROLLER_SERIALIZER`, `deserializeCollisionShape`, `serializeCollisionShape`, `RigidBody`, `SolverRegistry`, `clearRegisteredSolvers`, `registerSolver`, `registeredSolvers`, `resolveSolver`, `COLLISION_SHAPE_TYPES_2D`, `COLLISION_SHAPE_TYPES_3D`, `COMPOSITE_COLLISION_SHAPE_TYPES`, `shapeIsConvex`, `shapeMaximumExtent`, `shapeSupportsDimension`, `validateCollisionShape`, `validateQueryShape`, `BODY_TYPES`, `CCD_MODES`, `COMBINE_MODES`, `DEFAULT_CCD_MODE`, `DEFAULT_DETERMINISM_LEVEL`, `DEFAULT_ENABLED_CCD_MODE`, `DEFAULT_SLEEPING_CONFIG`, `DETERMINISM_LEVELS`, `PHYSICS_DIMENSIONS`, `validateAngularJointMotor`, `validateColliderDescriptor`, `validateInertiaTensor`, `validateJointBreakThreshold`, `validateJointDescriptor`, `validateJointLimits`, `validateLinearJointMotor`, `validateMass`, `validatePhysicsWorldOptions`, `validateRigidBodyDescriptor`, `validateSphericalJointLimits`, `DEFAULT_GROUND_SNAP_DISTANCE`, `DEFAULT_MAX_SLIDES`, `DEFAULT_SKIN_WIDTH`, `DEFAULT_SLOPE_LIMIT`, `DEFAULT_STEP_HEIGHT`, `SweptCharacterController`, `SweptCharacterSystem`, `POSE_TARGET_CAPTURE_PRIORITY`, `PhysicsWorld`, `createPoseTargetCaptureSystem`, `PhysicsCapabilities`, `PhysicsQueryCapabilities`, `PhysicsSolverAdapter`, `PhysicsTuningCapabilities`, `SolverBodyAccess`, `SolverBodyTuningAccess`, `SolverJointAccess`, `SolverJointMotor`, `ColliderEventMap`, `ColliderOptions`, `ColliderTriggerEvent`, `RigidBodyCollisionEvent`, `AngularJointMotor`, `ColliderDescriptor`, `FixedJointDescriptor`, `JointDescriptor`, `JointDescriptorBase`, `JointLimits`, `JointType`, `LinearJointMotor`, `PhysicsWorldOptions`, `PrismaticJointDescriptor`, `RevoluteJointDescriptor`, `RigidBodyDescriptor`, `RopeJointDescriptor`, `ShippedJointType`, `SphericalJointDescriptor`, `SphericalJointLimits`, `SpringJointDescriptor`, `StagedJointType`, `CollisionEvent`, `CollisionPhase`, `ContactPoint`, `JointBreakEvent`, `JointPhase`, `PhysicsEvent`, `PhysicsEventType`, `SleepEvent`, `SleepPhase`, `TriggerEvent`, `TriggerPhase`, `ForceField`, `ForceFieldEntry`, `ForceFieldSystemOptions`, `ForceFieldUnits`, `HingeJointOptions`, `JointBinding`, `JointBreakPayload`, `JointCommands`, `JointEventMap`, `JointOptions`, `RopeJointOptions`, `SliderJointOptions`, `SphericalJointOptions`, `SpringJointOptions`, `PhysicsMaterialOptions`, `PhysicsEventSystemOptions`, `PhysicsSystemOptions`, `OverlapHit`, `OverlapQuery`, `PointHit`, `PointQuery`, `QueryCandidate`, `QueryFilter`, `QueryHit`, `QueryHitMode`, `QueryOptions`, `RaycastHit`, `RaycastQuery`, `ResolvedQueryOptions`, `ShapeCastHit`, `ShapeCastQuery`, `ColliderDocument`, `PhysicsMaterialDocument`, `RigidBodyDocument`, `BlendWeights`, `PointLoad`, `RigidBodyCommands`, `RigidBodyEventMap`, `RigidBodySleepEvent`, `SleepCommand`, `TorqueInput`, `SolverName`, `SolverRegistration`, `SolverRejectionReason`, `SolverRejectionReport`, `SolverResolveOptions`, `SolverSelection`, `BoxShape`, `CapsuleShape`, `ChainShape`, `CircleShape`, `CollisionShape`, `CollisionShape2D`, `CollisionShape3D`, `CollisionShapeType`, `ConeShape`, `ConvexHullShape`, `CylinderShape`, `HeightFieldShape`, `PolygonShape`, `PolylineShape`, `RectangleShape`, `SphereShape`, `TriangleMeshShape`, `AngularVelocityInput`, `BodyType`, `CCDMode`, `CombineMode`, `DeterminismLevel`, `PhysicsBodyHandle`, `PhysicsColliderHandle`, `PhysicsDimension`, `PhysicsHandle`, `PhysicsJointHandle`, `RotationInput`, `SleepingConfig`, `Vector3Input`, `SweptCharacterControllerOptions`, `SweptCharacterSystemOptions`, `ActiveBodyVisitor`, `BodyControlModeOptions`, `PhysicsSnapshot`, `PhysicsSnapshotConfiguration`, `PhysicsWorldAdapter`, `PhysicsWorldInit`, `PoseTargetCaptureSystemOptions`, `WorldOverlapHit`, `WorldPhysicsEvent`, `WorldPointHit`, `WorldQueryHit`, `WorldRaycastHit`, `WorldShapeCastHit`

---

### `packages/physics/src/joints.ts` - The §28 joint classes — `FixedJoint`, `HingeJoint`, `SliderJoint`,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `EventEmitter, FourError` |
| `@four/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./body-access.js` | `SolverJointMotor` | Import (type-only) |
| `./descriptors.js` | `AngularJointMotor, FixedJointDescriptor, JointDescriptor, JointDescriptorBase, JointLimits, LinearJointMotor, PrismaticJointDescriptor, RevoluteJointDescriptor, RopeJointDescriptor, ShippedJointType, SphericalJointDescriptor, SphericalJointLimits, SpringJointDescriptor` | Import (type-only) |
| `./descriptors.js` | `widenToVector3` | Import |
| `./events.js` | `JointBreakEvent` | Import (type-only) |
| `./rigid-body.js` | `RigidBody` | Import (type-only) |
| `./types.js` | `PhysicsBodyHandle, PhysicsDimension, Vector3Input` | Import (type-only) |
| `./validation.js` | `validateAngularJointMotor, validateJointBreakThreshold, validateJointLimits, validateLinearJointMotor, validateSphericalJointLimits` | Import |

**Exports:**
- Classes: `FixedJoint`, `HingeJoint`, `SliderJoint`, `RopeJoint`, `SpringJoint`, `SphericalJoint`
- Interfaces: `JointEventMap`, `JointBinding`, `JointCommands`, `JointOptions`, `HingeJointOptions`, `SliderJointOptions`, `RopeJointOptions`, `SpringJointOptions`, `SphericalJointOptions`
- Types: `JointBreakPayload`, `RevoluteJoint`, `PrismaticJoint`, `BallJoint`
- Functions: `worldAnchorToLocal`, `worldAxisToLocal`, `bindJoint`, `unbindJoint`, `setJointBroken`, `clearJointCommands`, `readJointLimits`, `readJointMotor`
- Constants: `RevoluteJoint`, `PrismaticJoint`, `BallJoint`

---

### `packages/physics/src/material.ts` - Physics materials and the §25 combination rules.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./types.js` | `CombineMode` | Import (type-only) |

**Exports:**
- Classes: `PhysicsMaterial`
- Interfaces: `PhysicsMaterialOptions`
- Functions: `combineValues`, `combineFriction`, `combineRestitution`, `resolveDensity`
- Constants: `DEFAULT_FRICTION`, `DEFAULT_RESTITUTION`, `DEFAULT_DENSITY`, `DEFAULT_FRICTION_COMBINE_MODE`, `DEFAULT_RESTITUTION_COMBINE_MODE`

---

### `packages/physics/src/physics-event-system.ts` - `PhysicsEventSystem` (§39 step 9, PH-21) — the optional occupant of

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/motion` | `PRIORITY_EVENT_DISPATCH, SimulationSystem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./physics-system.js` | `PhysicsSystem` | Import (type-only) |
| `./world.js` | `PhysicsWorld` | Import (type-only) |

**Exports:**
- Classes: `PhysicsEventSystem`
- Interfaces: `PhysicsEventSystemOptions`

---

### `packages/physics/src/physics-system.ts` - `PhysicsSystem` (§39 step 6, plan P5-2) — the `SimulationSystem` that steps

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/motion` | `PRIORITY_PHYSICS_SOLVE, FixedUpdateContext, SimulationSystem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./world.js` | `PhysicsWorld` | Import (type-only) |

**Exports:**
- Classes: `PhysicsSystem`
- Interfaces: `PhysicsSystemOptions`

---

### `packages/physics/src/queries.ts` - Spatial queries (§30) — options, filter semantics, and result shapes.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./types.js` | `PhysicsBodyHandle, PhysicsColliderHandle, RotationInput, Vector3Input` | Import (type-only) |

**Exports:**
- Interfaces: `QueryFilter`, `QueryOptions`, `ResolvedQueryOptions`, `QueryCandidate`, `RaycastQuery`, `ShapeCastQuery`, `OverlapQuery`, `PointQuery`, `QueryHit`, `RaycastHit`, `ShapeCastHit`, `PointHit`
- Types: `QueryHitMode`, `OverlapHit`
- Functions: `resolveQueryOptions`, `passesQueryFilter`, `sortHitsByDistance`
- Constants: `ALL_COLLISION_GROUPS`

---

### `packages/physics/src/rigid-body.ts` - The `RigidBody` component (§6a, §23) and its §26 force/impulse command

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEFAULT_SPACE_MODE, EventEmitter, FourError, Component, ComponentHost, SpaceMode` |
| `@four/math` | `Matrix3, Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./descriptors.js` | `RigidBodyDescriptor` | Import (type-only) |
| `./descriptors.js` | `resolveAngularVelocity, resolveRotation, widenToVector3` | Import |
| `./events.js` | `SleepEvent` | Import (type-only) |
| `./types.js` | `BodyType, CCDMode, PhysicsDimension, Vector3Input` | Import (type-only) |
| `./types.js` | `DEFAULT_CCD_MODE, DEFAULT_ENABLED_CCD_MODE` | Import |
| `./validation.js` | `validateMass, validateRigidBodyDescriptor` | Import |

**Exports:**
- Classes: `RigidBody`
- Interfaces: `BlendWeights`, `PointLoad`, `RigidBodyCommands`, `RigidBodyEventMap`
- Types: `TorqueInput`, `SleepCommand`, `RigidBodySleepEvent`
- Functions: `clearRigidBodyCommands`, `setRigidBodyRegistered`, `drainRigidBodySolverWrites`, `setRigidBodyType`, `setRigidBodyDerivedMass`, `setRigidBodySleeping`
- Constants: `RIGID_BODY_MASS_PROPERTIES_DIRTY`, `RIGID_BODY_DAMPING_DIRTY`, `RIGID_BODY_GRAVITY_SCALE_DIRTY`, `RIGID_BODY_CCD_DIRTY`

---

### `packages/physics/src/serializers.ts` - The §79 serializers for this package's two components — `RigidBody` (§23) and

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `SPACE_MODES, FourError, JsonValue, SpaceMode` |
| `@four/math` | `Matrix3, Quaternion, Vector2, Vector3` |
| `@four/motion` | `DEFAULT_CHARACTER_GRAVITY, ComponentSerializerShape` |
| `@four/scene` | `Transform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./collider.js` | `Collider, ColliderOptions` | Import |
| `./descriptors.js` | `RigidBodyDescriptor` | Import (type-only) |
| `./material.js` | `DEFAULT_DENSITY, DEFAULT_FRICTION, DEFAULT_RESTITUTION, PhysicsMaterial, PhysicsMaterialOptions` | Import |
| `./queries.js` | `ALL_COLLISION_GROUPS` | Import |
| `./rigid-body.js` | `RigidBody` | Import |
| `./swept-character-controller.js` | `DEFAULT_GROUND_SNAP_DISTANCE, DEFAULT_MAX_SLIDES, DEFAULT_SKIN_WIDTH, DEFAULT_SLOPE_LIMIT, DEFAULT_STEP_HEIGHT, SweptCharacterController` | Import |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./types.js` | `BODY_TYPES, CCD_MODES, DEFAULT_CCD_MODE` | Import |
| `./types.js` | `BodyType, CCDMode` | Import (type-only) |

**Exports:**
- Interfaces: `RigidBodyDocument`, `PhysicsMaterialDocument`, `ColliderDocument`
- Functions: `serializeCollisionShape`, `deserializeCollisionShape`
- Constants: `RIGID_BODY_SERIALIZER`, `COLLIDER_SERIALIZER`, `SWEPT_CHARACTER_CONTROLLER_SERIALIZER`

---

### `packages/physics/src/shapes.ts` - Collision shapes (§24) and their §85 parameter validation.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `Vector2, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./types.js` | `PhysicsDimension` | Import (type-only) |

**Exports:**
- Interfaces: `CircleShape`, `RectangleShape`, `CapsuleShape`, `PolygonShape`, `PolylineShape`, `ChainShape`, `SphereShape`, `BoxShape`, `CylinderShape`, `ConeShape`, `ConvexHullShape`, `TriangleMeshShape`, `HeightFieldShape`
- Types: `CollisionShape2D`, `CollisionShape3D`, `CollisionShape`, `CollisionShapeType`
- Functions: `shapeIsConvex`, `shapeSupportsDimension`, `shapeMaximumExtent`, `validateQueryShape`, `validateCollisionShape`
- Constants: `COLLISION_SHAPE_TYPES_2D`, `COLLISION_SHAPE_TYPES_3D`, `COMPOSITE_COLLISION_SHAPE_TYPES`

---

### `packages/physics/src/solver-registry.ts` - The §37 solver registry — how `solver: "auto"` becomes an adapter without

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./adapter.js` | `PhysicsSolverAdapter` | Import (type-only) |
| `./descriptors.js` | `PhysicsWorldOptions` | Import (type-only) |
| `./types.js` | `DeterminismLevel` | Import (type-only) |
| `./types.js` | `DEFAULT_DETERMINISM_LEVEL, DETERMINISM_LEVELS` | Import |
| `./world.js` | `PhysicsWorldAdapter` | Import (type-only) |

**Exports:**
- Classes: `SolverRegistry`
- Interfaces: `SolverRegistration`, `SolverRejectionReport`, `SolverResolveOptions`
- Types: `SolverName`, `SolverSelection`, `SolverRejectionReason`
- Functions: `registerSolver`, `registeredSolvers`, `clearRegisteredSolvers`, `resolveSolver`

---

### `packages/physics/src/swept-character-controller.ts` - §12's **solver-backed** character controller — {@link SweptCharacterController}

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Component, ComponentHost` |
| `@four/math` | `Vector3` |
| `@four/motion` | `CharacterController, PRIORITY_KINEMATICS, FixedUpdateContext, SimulationSystem` |
| `@four/scene` | `warnAuthorityConflict, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./queries.js` | `ALL_COLLISION_GROUPS` | Import |
| `./rigid-body.js` | `RigidBody` | Import (type-only) |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./types.js` | `PhysicsBodyHandle` | Import (type-only) |
| `./world.js` | `PhysicsWorld, WorldShapeCastHit` | Import (type-only) |

**Exports:**
- Classes: `SweptCharacterController`, `SweptCharacterSystem`
- Interfaces: `SweptCharacterControllerOptions`, `SweptCharacterSystemOptions`
- Constants: `DEFAULT_SLOPE_LIMIT`, `DEFAULT_STEP_HEIGHT`, `DEFAULT_SKIN_WIDTH`, `DEFAULT_GROUND_SNAP_DISTANCE`, `DEFAULT_MAX_SLIDES`

---

### `packages/physics/src/types.ts` - The physics vocabulary (§21, §22, §25, §31, §32, §33) and the opaque solver

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Quaternion, Vector2, Vector3` |

**Exports:**
- Interfaces: `SleepingConfig`, `PhysicsBodyHandle`, `PhysicsColliderHandle`, `PhysicsJointHandle`
- Types: `PhysicsDimension`, `BodyType`, `CCDMode`, `DeterminismLevel`, `CombineMode`, `Vector3Input`, `RotationInput`, `AngularVelocityInput`, `PhysicsHandle`
- Constants: `PHYSICS_DIMENSIONS`, `BODY_TYPES`, `CCD_MODES`, `DEFAULT_CCD_MODE`, `DEFAULT_ENABLED_CCD_MODE`, `DETERMINISM_LEVELS`, `DEFAULT_DETERMINISM_LEVEL`, `COMBINE_MODES`, `DEFAULT_SLEEPING_CONFIG`

---

### `packages/physics/src/validation.ts` - Descriptor validation (§85), for the physics half of the checklist.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `Matrix3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./descriptors.js` | `AngularJointMotor, ColliderDescriptor, JointDescriptor, JointLimits, LinearJointMotor, PhysicsWorldOptions, RigidBodyDescriptor, ShippedJointType, SphericalJointLimits` | Import (type-only) |
| `./descriptors.js` | `JOINT_TYPES, SHIPPED_JOINT_TYPES, STAGED_JOINT_TYPES, jointTypeSupportsDimension, resolveGravity, resolveRotation` | Import |
| `./shapes.js` | `validateCollisionShape` | Import |
| `./types.js` | `BodyType, PhysicsDimension, Vector3Input` | Import (type-only) |
| `./types.js` | `BODY_TYPES, CCD_MODES, DEFAULT_ENABLED_CCD_MODE, DETERMINISM_LEVELS, PHYSICS_DIMENSIONS` | Import |

**Exports:**
- Functions: `validateMass`, `validateInertiaTensor`, `validateRigidBodyDescriptor`, `validateColliderDescriptor`, `validateJointLimits`, `validateSphericalJointLimits`, `validateAngularJointMotor`, `validateLinearJointMotor`, `validateJointBreakThreshold`, `validateJointDescriptor`, `validatePhysicsWorldOptions`

---

### `packages/physics/src/world.ts` - `PhysicsWorld` (§20, §30, §32, §33, §34, §37, §39, §42, §43) — the object an

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEFAULT_SPACE_MODE, FourError, isSimulationSpaceMode` |
| `@four/math` | `Quaternion, Vector2, Vector3` |
| `@four/motion` | `PRIORITY_ANIMATION_TARGETS, SimulationSystem` |
| `@four/scene` | `PoseTarget, warnAuthorityConflict, Node, PoseBuffer, TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./adapter.js` | `PhysicsSolverAdapter, PhysicsTuningCapabilities` | Import (type-only) |
| `./adapter.js` | `resolveTuningCapabilities` | Import |
| `./body-access.js` | `SolverBodyAccess, SolverBodyTuningAccess, SolverJointAccess` | Import (type-only) |
| `./body-access.js` | `missingSolverJointAccess, supportsSolverBodyTuning, supportsSolverJointAccess` | Import |
| `./collider.js` | `Collider` | Import |
| `./collider.js` | `ColliderTriggerEvent, RigidBodyCollisionEvent` | Import (type-only) |
| `./descriptors.js` | `PhysicsWorldOptions` | Import (type-only) |
| `./descriptors.js` | `resolveGravity, resolveSleepingConfig` | Import |
| `./events.js` | `JointBreakEvent, PhysicsEvent` | Import (type-only) |
| `./joints.js` | `Joint, JointBinding, JointBreakPayload` | Import (type-only) |
| `./joints.js` | `bindJoint, clearJointCommands, readJointLimits, readJointMotor, setJointBroken, unbindJoint, worldAnchorToLocal, worldAxisToLocal` | Import |
| `./queries.js` | `OverlapQuery, PointQuery, QueryOptions, RaycastQuery, ShapeCastQuery` | Import (type-only) |
| `./rigid-body.js` | `BlendWeights, RigidBodySleepEvent` | Import (type-only) |
| `./rigid-body.js` | `RIGID_BODY_CCD_DIRTY, RIGID_BODY_DAMPING_DIRTY, RIGID_BODY_GRAVITY_SCALE_DIRTY, RIGID_BODY_MASS_PROPERTIES_DIRTY, RigidBody, clearRigidBodyCommands, drainRigidBodySolverWrites, setRigidBodyDerivedMass, setRigidBodyRegistered, setRigidBodySleeping, setRigidBodyType` | Import |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./shapes.js` | `shapeMaximumExtent` | Import |
| `./solver-registry.js` | `SolverRegistry, SolverRejectionReport, SolverSelection` | Import (type-only) |
| `./solver-registry.js` | `resolveSolver` | Import |
| `./types.js` | `BodyType, DeterminismLevel, PhysicsBodyHandle, PhysicsColliderHandle, PhysicsDimension, PhysicsJointHandle, RotationInput, SleepingConfig, Vector3Input` | Import (type-only) |
| `./types.js` | `DEFAULT_DETERMINISM_LEVEL, DEFAULT_SLEEPING_CONFIG, DETERMINISM_LEVELS` | Import |
| `./validation.js` | `validateJointDescriptor, validateMass, validatePhysicsWorldOptions` | Import |

**Exports:**
- Classes: `PhysicsWorld`
- Interfaces: `PhysicsWorldInit`, `WorldQueryHit`, `WorldRaycastHit`, `WorldShapeCastHit`, `WorldPointHit`, `PhysicsSnapshot`, `PhysicsSnapshotConfiguration`, `BodyControlModeOptions`, `PoseTargetCaptureSystemOptions`
- Types: `PhysicsWorldAdapter`, `ActiveBodyVisitor`, `WorldOverlapHit`, `WorldPhysicsEvent`
- Functions: `createPoseTargetCaptureSystem`
- Constants: `POSE_TARGET_CAPTURE_PRIORITY`

---

<a id="packages-physics-box2d-dependencies"></a>

## Packages/physics box2d Dependencies

### `packages/physics-box2d/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-physics-rapier-dependencies"></a>

## Packages/physics rapier Dependencies

### `packages/physics-rapier/src/ccd.ts` - The §31 CCD-mode resolution both Rapier adapters share.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/physics` | `DEFAULT_ENABLED_CCD_MODE` |
| `@four/physics` | `CCDMode, RigidBodyDescriptor` |

**Exports:**
- Functions: `resolveCcdMode`

---

### `packages/physics-rapier/src/conversions2d.ts` - The §21/P5-3 mapping between the engine's 3D-typed physics API and Rapier's

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `Quaternion, Vector3` |
| `@four/physics` | `ALL_COLLISION_GROUPS, resolveAngularVelocity, resolveRotation` |
| `@four/physics` | `AngularVelocityInput, BodyType, CollisionShape, RotationInput, Vector3Input` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./init.js` | `RAPIER_2D` | Import |
| `./init.js` | `RapierColliderDesc, RapierShape, RapierVector` | Import (type-only) |

**Exports:**
- Types: `RapierVector2`
- Functions: `createRapierVector2`, `toRapierVector2`, `fromRapierVector2`, `toRapierAngle`, `quaternionToAngleZ`, `fromRapierAngle`, `toRapierAngularScalar`, `toRapierBodyType`, `revoluteAxisSignZ`, `toRapierJointAxis2d`, `packInteractionGroups`, `createRapierShape`, `createRapierColliderDesc`, `requireHullDesc`

---

### `packages/physics-rapier/src/conversions3d.ts` - The §21/P5-3 mapping between the engine's 3D-typed physics API and Rapier's

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `Matrix3, Quaternion, Vector3` |
| `@four/physics` | `ALL_COLLISION_GROUPS, resolveAngularVelocity, resolveRotation` |
| `@four/physics` | `AngularVelocityInput, BodyType, CollisionShape, RotationInput, Vector3Input` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./init.js` | `RAPIER_3D` | Import |
| `./init.js` | `RapierColliderDesc3d, RapierRotation3, RapierShape3d, RapierVector3` | Import (type-only) |
| `./init.js` | `RapierRotation3, RapierVector3` | Re-export (type-only) |

**Exports:**
- Functions: `createRapierVector3`, `createRapierRotation3`, `toRapierVector3`, `fromRapierVector3`, `toRapierRotation3`, `fromRapierRotation3`, `toRapierAngularVector3`, `toRapierBodyType3d`, `toPrincipalInertia3d`, `packInteractionGroups3d`, `createRapierShape3d`, `createRapierColliderDesc3d`, `requireHullDesc3d`, `rotateVectorByRotation3`
- Re-exports: `RapierRotation3`, `RapierVector3`

---

### `packages/physics-rapier/src/index.ts` - `@four/physics-rapier` — the Rapier solver adapters (§37, §102, §108).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./conversions2d.js` | `createRapierColliderDesc, createRapierShape, createRapierVector2, fromRapierAngle, fromRapierVector2, packInteractionGroups, quaternionToAngleZ, revoluteAxisSignZ, toRapierAngle, toRapierAngularScalar, toRapierBodyType, toRapierJointAxis2d, toRapierVector2` | Re-export |
| `./conversions3d.js` | `createRapierColliderDesc3d, createRapierRotation3, createRapierShape3d, createRapierVector3, fromRapierRotation3, fromRapierVector3, packInteractionGroups3d, rotateVectorByRotation3, toPrincipalInertia3d, toRapierAngularVector3, toRapierBodyType3d, toRapierRotation3, toRapierVector3` | Re-export |
| `./init.js` | `initializeRapier2d, rapier2dModule, rapier2dVersion` | Re-export |
| `./init.js` | `initializeRapier3d, rapier3dModule, rapier3dVersion` | Re-export |
| `./register.js` | `createRapierAdapter, isRapierSupported, registerRapierSolver` | Re-export |
| `./rapier2d-adapter.js` | `Rapier2dAdapter` | Re-export |
| `./rapier3d-adapter.js` | `Rapier3dAdapter` | Re-export |
| `./conversions2d.js` | `RapierVector2` | Re-export (type-only) |
| `./conversions3d.js` | `RapierRotation3, RapierVector3` | Re-export (type-only) |
| `./init.js` | `Rapier2dModule, Rapier3dModule` | Re-export (type-only) |
| `./rapier2d-adapter.js` | `RapierBodyAccess` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `createRapierColliderDesc`, `createRapierShape`, `createRapierVector2`, `fromRapierAngle`, `fromRapierVector2`, `packInteractionGroups`, `quaternionToAngleZ`, `revoluteAxisSignZ`, `toRapierAngle`, `toRapierAngularScalar`, `toRapierBodyType`, `toRapierJointAxis2d`, `toRapierVector2`, `createRapierColliderDesc3d`, `createRapierRotation3`, `createRapierShape3d`, `createRapierVector3`, `fromRapierRotation3`, `fromRapierVector3`, `packInteractionGroups3d`, `rotateVectorByRotation3`, `toPrincipalInertia3d`, `toRapierAngularVector3`, `toRapierBodyType3d`, `toRapierRotation3`, `toRapierVector3`, `initializeRapier2d`, `rapier2dModule`, `rapier2dVersion`, `initializeRapier3d`, `rapier3dModule`, `rapier3dVersion`, `createRapierAdapter`, `isRapierSupported`, `registerRapierSolver`, `Rapier2dAdapter`, `Rapier3dAdapter`, `RapierVector2`, `RapierRotation3`, `RapierVector3`, `Rapier2dModule`, `Rapier3dModule`, `RapierBodyAccess`

---

### `packages/physics-rapier/src/init.ts` - Shared loading of the Rapier WebAssembly modules, and the typed view of them

**External Dependencies:**
| Package | Import |
|---------|--------|
| `@dimforge/rapier2d-compat` | `* as RAPIER2D_UNTYPED` |
| `@dimforge/rapier3d-compat` | `* as RAPIER3D_UNTYPED` |

**Exports:**
- Interfaces: `RapierVector`, `RapierRigidBody`, `RapierRigidBodyDesc`, `RapierCollider`, `RapierColliderDesc`, `RapierImpulseJoint`, `RapierUnitImpulseJoint`, `RapierEventQueue`, `RapierWorld`, `Rapier2dModule`, `RapierVector3`, `RapierRotation3`, `RapierRigidBody3d`, `RapierRigidBodyDesc3d`, `RapierCollider3d`, `RapierColliderDesc3d`, `RapierEventQueue3d`, `RapierWorld3d`, `Rapier3dModule`
- Types: `RapierShape`, `RapierJointData`, `RapierShape3d`
- Functions: `initializeRapier2d`, `rapier2dModule`, `rapier2dVersion`, `initializeRapier3d`, `rapier3dModule`, `rapier3dVersion`
- Constants: `RAPIER_2D`, `RAPIER_3D`

---

### `packages/physics-rapier/src/rapier2d-adapter.ts` - The Rapier 2D solver adapter (§37, §102, plan WP-5.4).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `Quaternion, Vector3` |
| `@four/math` | `Matrix3` |
| `@four/physics` | `ALL_COLLISION_GROUPS, DEFAULT_FRICTION, DEFAULT_RESTITUTION, DETERMINISM_LEVELS, passesQueryFilter, resolveDensity, resolveGravity, resolveQueryOptions, resolveSleepingConfig, sortHitsByDistance, validateColliderDescriptor, validateJointDescriptor, validatePhysicsWorldOptions, validateQueryShape, validateRigidBodyDescriptor` |
| `@four/physics` | `AngularVelocityInput, BodyType, CCDMode, ColliderDescriptor, ContactPoint, JointDescriptor, ShippedJointType, SolverBodyTuningAccess, SolverJointAccess, SolverJointMotor, OverlapHit, OverlapQuery, PhysicsBodyHandle, PhysicsCapabilities, PhysicsColliderHandle, PhysicsDimension, PhysicsEvent, PhysicsJointHandle, PhysicsSolverAdapter, PhysicsWorldOptions, PointHit, PointQuery, QueryCandidate, RaycastHit, RaycastQuery, ResolvedQueryOptions, RigidBodyDescriptor, RotationInput, ShapeCastHit, ShapeCastQuery, SleepingConfig, Vector3Input` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./ccd.js` | `resolveCcdMode` | Import |
| `./conversions2d.js` | `createRapierColliderDesc, createRapierShape, createRapierVector2, fromRapierAngle, fromRapierVector2, packInteractionGroups, revoluteAxisSignZ, toRapierAngle, toRapierAngularScalar, toRapierBodyType, toRapierJointAxis2d, toRapierVector2` | Import |
| `./conversions2d.js` | `RapierVector2` | Import (type-only) |
| `./init.js` | `initializeRapier2d` | Import |
| `./init.js` | `Rapier2dModule, RapierCollider, RapierColliderDesc, RapierEventQueue, RapierImpulseJoint, RapierJointData, RapierRigidBody, RapierRigidBodyDesc, RapierUnitImpulseJoint, RapierWorld` | Import (type-only) |

**Exports:**
- Classes: `Rapier2dAdapter`
- Interfaces: `RapierBodyAccess`

---

### `packages/physics-rapier/src/rapier3d-adapter.ts` - The Rapier 3D solver adapter (§37, §102, plan WP-5.5).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `Quaternion, Vector3` |
| `@four/math` | `Matrix3` |
| `@four/physics` | `ALL_COLLISION_GROUPS, DEFAULT_FRICTION, DEFAULT_RESTITUTION, DETERMINISM_LEVELS, passesQueryFilter, resolveDensity, resolveGravity, resolveQueryOptions, resolveSleepingConfig, sortHitsByDistance, validateColliderDescriptor, validateJointDescriptor, validatePhysicsWorldOptions, validateQueryShape, validateRigidBodyDescriptor` |
| `@four/physics` | `AngularVelocityInput, BodyType, CCDMode, ColliderDescriptor, ContactPoint, JointDescriptor, OverlapHit, OverlapQuery, PhysicsBodyHandle, PhysicsCapabilities, PhysicsColliderHandle, PhysicsDimension, PhysicsEvent, PhysicsJointHandle, PhysicsSolverAdapter, PhysicsWorldOptions, PointHit, PointQuery, QueryCandidate, RaycastHit, RaycastQuery, ResolvedQueryOptions, RigidBodyDescriptor, RotationInput, ShapeCastHit, ShapeCastQuery, ShippedJointType, SleepingConfig, SolverBodyTuningAccess, SolverJointAccess, SolverJointMotor, Vector3Input` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./ccd.js` | `resolveCcdMode` | Import |
| `./conversions3d.js` | `createRapierColliderDesc3d, createRapierRotation3, createRapierShape3d, createRapierVector3, fromRapierRotation3, fromRapierVector3, packInteractionGroups3d, rotateVectorByRotation3, toPrincipalInertia3d, toRapierAngularVector3, toRapierBodyType3d, toRapierRotation3, toRapierVector3` | Import |
| `./init.js` | `initializeRapier3d` | Import |
| `./init.js` | `Rapier3dModule, RapierCollider3d, RapierColliderDesc3d, RapierEventQueue3d, RapierRigidBody3d, RapierRigidBodyDesc3d, RapierRotation3, RapierVector3, RapierWorld3d` | Import (type-only) |
| `./rapier2d-adapter.js` | `RapierBodyAccess` | Import (type-only) |

**Exports:**
- Classes: `Rapier3dAdapter`

---

### `packages/physics-rapier/src/register.ts` - This package's opt-in to §37's solver registry (PH-19).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/physics` | `registerSolver, PhysicsWorldAdapter, PhysicsWorldOptions, SolverRegistry` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./rapier2d-adapter.js` | `Rapier2dAdapter` | Import |
| `./rapier3d-adapter.js` | `Rapier3dAdapter` | Import |

**Exports:**
- Functions: `isRapierSupported`, `createRapierAdapter`, `registerRapierSolver`

---

<a id="packages-physics-soft-dependencies"></a>

## Packages/physics soft Dependencies

### `packages/physics-soft/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-render-dependencies"></a>

## Packages/render Dependencies

### `packages/render/src/batch.ts` - §65 batching — merging consecutive compatible draws into one (R-9,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/geometry` | `BufferGeometry` |
| `@four/materials` | `MaterialTexture, SpriteMaterial, UnlitMaterial` |
| `@four/math` | `ColorRGBA` |
| `@four/scene` | `ALL_LAYERS, LayerMask` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clip.js` | `RenderItemClip` | Import (type-only) |
| `./render-list.js` | `RenderItem, SpriteRenderItem, UnlitRenderItem` | Import (type-only) |
| `./sprite.js` | `SpriteFrame` | Import (type-only) |

**Exports:**
- Classes: `RenderBatcher`
- Interfaces: `RenderBatchOptions`, `RenderBatch`
- Types: `BatchableMaterial`, `BatchableItem`
- Constants: `DEFAULT_MAX_BATCH_VERTICES`

---

### `packages/render/src/bounds.ts` - World-space bounds of a drawable (§87) — the substrate a frustum test needs.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/geometry` | `BufferGeometry` |
| `@four/math` | `Matrix4, Vector3` |

**Exports:**
- Interfaces: `BoundingSphere`
- Functions: `computeWorldBoundingSphere`

---

### `packages/render/src/clip.ts` - §67 clipping — a node's drawn shape masks its subtree, expressed entirely in

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEV, devWarn` |
| `@four/materials` | `StencilFunc, StencilOp` |

**Exports:**
- Classes: `ClipPlaneAllocator`
- Interfaces: `RenderItemStencil`, `RenderItemClip`, `ClipScope`
- Constants: `MAX_CLIP_PLANES`

---

### `packages/render/src/effect-pass.ts` - §70's post-processing at the **full-screen effect tier** (R-6, 2026-08-07):

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/materials` | `SHADER_VALUE_COMPONENTS, analyzeShaderGraph, ShaderGraph` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target.js` | `RenderTarget, RenderTargetTexture` | Import (type-only) |
| `./render-target.js` | `isRenderTargetTexture` | Import |

**Exports:**
- Interfaces: `CopyEffect`, `ColorGradeEffect`, `OutputTransformEffect`, `GraphEffect`, `EffectRenderPass`, `ScreenEffectRenderer`
- Types: `ScreenEffect`, `ScreenEffectKind`
- Functions: `supportsScreenEffects`, `validateEffectRenderPass`
- Constants: `OUTPUT_TRANSFORM_EFFECT`, `COLOR_GRADE_DEFAULTS`, `COPY_EFFECT`

---

### `packages/render/src/index.ts` - §60's shader-graph IR (RFC 0001), re-exported from `@four/materials` so a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/materials` | `MAX_SHADER_GRAPH_NODES, MAX_SHADER_GRAPH_TEXTURES, SHADER_ATTRIBUTE_TYPES, SHADER_VALUE_COMPONENTS, analyzeShaderGraph, forEachShaderNodeReference` |
| `@four/materials` | `ShaderAttributeName, ShaderBinaryOp, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderNodeId, ShaderReflection, ShaderTextureReflection, ShaderUnaryOp, ShaderUniformReflection, ShaderValueType` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./batch.js` | `DEFAULT_MAX_BATCH_VERTICES, RenderBatcher` | Re-export |
| `./bounds.js` | `computeWorldBoundingSphere` | Re-export |
| `./clip.js` | `ClipPlaneAllocator, MAX_CLIP_PLANES` | Re-export |
| `./effect-pass.js` | `COLOR_GRADE_DEFAULTS, COPY_EFFECT, OUTPUT_TRANSFORM_EFFECT, supportsScreenEffects, validateEffectRenderPass` | Re-export |
| `./lights.js` | `MAX_PUNCTUAL_LIGHTS, collectSceneLights, createSceneLights, isDirectionalLightSource, isPunctualLightSource` | Re-export |
| `./particles.js` | `PARTICLE_COLOR_OFFSET, PARTICLE_INSTANCE_FLOATS, PARTICLE_POSITION_OFFSET, PARTICLE_SIZE_OFFSET, isParticleDrawable, particleQuadGeometry` | Re-export |
| `./render-list.js` | `buildInterpolatedRenderList, buildRenderList, groupRenderListByPipeline, isLitItem, isNodeItem, isParticlesItem, isSkinnedLitItem, isSkinnedUnlitItem, isSpriteItem, isStandardItem, isUnlitItem, viewLayerMask` | Re-export |
| `./render-graph.js` | `RenderGraph` | Re-export |
| `./raster.js` | `CanvasTexture` | Re-export |
| `./picking.js` | `MAX_PICK_CANDIDATES, assertEncodableCandidateCount, collectPickCandidates, decodePickId, encodePickId, supportsPicking` | Re-export |
| `./render-target.js` | `RenderTarget, isRenderTargetTexture` | Re-export |
| `./renderable.js` | `Renderable` | Re-export |
| `./mesh.js` | `MAX_SKINNING_JOINTS, Mesh, restoreMeshSkeleton` | Re-export |
| `./renderer-registry.js` | `AUTO_RENDERER_ORDER, RENDERER_CAPABILITY_NAMES, RendererRegistry, clearRegisteredRenderers, missingCapabilities, registerRenderer, registeredRenderers, resolveRenderer, validateCapabilityDeclaration` | Re-export |
| `./renderer.js` | `NullRenderer` | Re-export |
| `./resource-memory.js` | `liveRenderTargetCount, liveTextureCount, textureMemoryBytes` | Re-export |
| `./statistics.js` | `createRenderStatistics, resetRenderStatistics, supportsRenderStatistics` | Re-export |
| `./shape.js` | `Arc, Circle, Ellipse, Line, PathShape, Polygon, Polyline, Rectangle, RegularPolygon, Ring, Sector, Shape2D, Star` | Re-export |
| `./sprite.js` | `Sprite` | Re-export |
| `./texture.js` | `Texture` | Re-export |
| `./view-list.js` | `buildViewRenderList, sortRenderListByDepth` | Re-export |
| `./batch.js` | `BatchableItem, BatchableMaterial, RenderBatch, RenderBatchOptions` | Re-export (type-only) |
| `./bounds.js` | `BoundingSphere` | Re-export (type-only) |
| `./clip.js` | `ClipScope, RenderItemClip, RenderItemStencil` | Re-export (type-only) |
| `./effect-pass.js` | `ColorGradeEffect, CopyEffect, EffectRenderPass, GraphEffect, OutputTransformEffect, ScreenEffect, ScreenEffectKind, ScreenEffectRenderer` | Re-export (type-only) |
| `./lights.js` | `AmbientLightSource, DirectionalLightSource, DirectionalShadowSource, PointLightSource, PunctualLightSource, PunctualLightSourceBase, SceneLights, SpotLightSource` | Re-export (type-only) |
| `./particles.js` | `ParticleDrawable` | Re-export (type-only) |
| `./render-list.js` | `LitRenderItem, NodeRenderItem, ParticleRenderItem, RenderItem, RenderItemKind, SkinnedLitRenderItem, SkinnedUnlitRenderItem, SpriteRenderItem, StandardRenderItem, UnlitRenderItem` | Re-export (type-only) |
| `./render-graph.js` | `AddPassOptions, CustomRenderPass, RenderGraphIssue, RenderGraphIssueCode, RenderGraphIssueSeverity, RenderGraphPass, RenderPass, RenderPassContext, SceneRenderPass` | Re-export (type-only) |
| `./raster.js` | `CanvasTextureOptions, RasterOrigin, RasterSource` | Re-export (type-only) |
| `./picking.js` | `PickRequest, PickResult, PickingService` | Re-export (type-only) |
| `./render-target.js` | `RenderTargetFormat, RenderTargetOptions, RenderTargetTexture` | Re-export (type-only) |
| `./renderable.js` | `RenderableOptions, SurfaceMaterial` | Re-export (type-only) |
| `./renderer-registry.js` | `RendererCapabilityDeclaration, RendererCapabilityName, RendererCapabilityShortfall, RendererFallbackReason, RendererFallbackReport, RendererRegistration, RendererResolveOptions, RendererSelection` | Re-export (type-only) |
| `./renderer.js` | `RenderInterpolation, Renderer, RendererBackend, RendererCapabilities, RendererEventMap, RendererOptions, ResizeRecord` | Re-export (type-only) |
| `./statistics.js` | `RenderStatistics, RenderStatisticsReporter` | Re-export (type-only) |
| `./shape.js` | `ArcOptions, CircleOptions, EllipseOptions, LineOptions, Paint, PathShapeOptions, PolygonOptions, PolylineOptions, RectangleOptions, RegularPolygonOptions, RingOptions, SectorOptions, ResolvedPaint, ResolvedShapeFill, ResolvedStrokeStyle, Shape2DOptions, ShapeFill, SolidPaint, StarOptions, StrokeStyle` | Re-export (type-only) |
| `./sprite.js` | `SpriteFrame, SpriteOptions` | Re-export (type-only) |
| `./texture.js` | `TextureFilter, TextureMinFilter, TextureSource, TextureWrap` | Re-export (type-only) |
| `./view-list.js` | `ViewRenderListOptions` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_MAX_BATCH_VERTICES`, `RenderBatcher`, `computeWorldBoundingSphere`, `ClipPlaneAllocator`, `MAX_CLIP_PLANES`, `COLOR_GRADE_DEFAULTS`, `COPY_EFFECT`, `OUTPUT_TRANSFORM_EFFECT`, `supportsScreenEffects`, `validateEffectRenderPass`, `MAX_PUNCTUAL_LIGHTS`, `collectSceneLights`, `createSceneLights`, `isDirectionalLightSource`, `isPunctualLightSource`, `PARTICLE_COLOR_OFFSET`, `PARTICLE_INSTANCE_FLOATS`, `PARTICLE_POSITION_OFFSET`, `PARTICLE_SIZE_OFFSET`, `isParticleDrawable`, `particleQuadGeometry`, `buildInterpolatedRenderList`, `buildRenderList`, `groupRenderListByPipeline`, `isLitItem`, `isNodeItem`, `isParticlesItem`, `isSkinnedLitItem`, `isSkinnedUnlitItem`, `isSpriteItem`, `isStandardItem`, `isUnlitItem`, `viewLayerMask`, `MAX_SHADER_GRAPH_NODES`, `MAX_SHADER_GRAPH_TEXTURES`, `SHADER_ATTRIBUTE_TYPES`, `SHADER_VALUE_COMPONENTS`, `analyzeShaderGraph`, `forEachShaderNodeReference`, `RenderGraph`, `CanvasTexture`, `MAX_PICK_CANDIDATES`, `assertEncodableCandidateCount`, `collectPickCandidates`, `decodePickId`, `encodePickId`, `supportsPicking`, `RenderTarget`, `isRenderTargetTexture`, `Renderable`, `MAX_SKINNING_JOINTS`, `Mesh`, `restoreMeshSkeleton`, `AUTO_RENDERER_ORDER`, `RENDERER_CAPABILITY_NAMES`, `RendererRegistry`, `clearRegisteredRenderers`, `missingCapabilities`, `registerRenderer`, `registeredRenderers`, `resolveRenderer`, `validateCapabilityDeclaration`, `NullRenderer`, `liveRenderTargetCount`, `liveTextureCount`, `textureMemoryBytes`, `createRenderStatistics`, `resetRenderStatistics`, `supportsRenderStatistics`, `Arc`, `Circle`, `Ellipse`, `Line`, `PathShape`, `Polygon`, `Polyline`, `Rectangle`, `RegularPolygon`, `Ring`, `Sector`, `Shape2D`, `Star`, `Sprite`, `Texture`, `buildViewRenderList`, `sortRenderListByDepth`, `BatchableItem`, `BatchableMaterial`, `RenderBatch`, `RenderBatchOptions`, `BoundingSphere`, `ClipScope`, `RenderItemClip`, `RenderItemStencil`, `ColorGradeEffect`, `CopyEffect`, `EffectRenderPass`, `GraphEffect`, `OutputTransformEffect`, `ScreenEffect`, `ScreenEffectKind`, `ScreenEffectRenderer`, `AmbientLightSource`, `DirectionalLightSource`, `DirectionalShadowSource`, `PointLightSource`, `PunctualLightSource`, `PunctualLightSourceBase`, `SceneLights`, `SpotLightSource`, `ParticleDrawable`, `LitRenderItem`, `NodeRenderItem`, `ParticleRenderItem`, `RenderItem`, `RenderItemKind`, `SkinnedLitRenderItem`, `SkinnedUnlitRenderItem`, `SpriteRenderItem`, `StandardRenderItem`, `UnlitRenderItem`, `ShaderAttributeName`, `ShaderBinaryOp`, `ShaderDomain`, `ShaderGraph`, `ShaderGraphAnalysis`, `ShaderNode`, `ShaderNodeId`, `ShaderReflection`, `ShaderTextureReflection`, `ShaderUnaryOp`, `ShaderUniformReflection`, `ShaderValueType`, `AddPassOptions`, `CustomRenderPass`, `RenderGraphIssue`, `RenderGraphIssueCode`, `RenderGraphIssueSeverity`, `RenderGraphPass`, `RenderPass`, `RenderPassContext`, `SceneRenderPass`, `CanvasTextureOptions`, `RasterOrigin`, `RasterSource`, `PickRequest`, `PickResult`, `PickingService`, `RenderTargetFormat`, `RenderTargetOptions`, `RenderTargetTexture`, `RenderableOptions`, `SurfaceMaterial`, `RendererCapabilityDeclaration`, `RendererCapabilityName`, `RendererCapabilityShortfall`, `RendererFallbackReason`, `RendererFallbackReport`, `RendererRegistration`, `RendererResolveOptions`, `RendererSelection`, `RenderInterpolation`, `Renderer`, `RendererBackend`, `RendererCapabilities`, `RendererEventMap`, `RendererOptions`, `ResizeRecord`, `RenderStatistics`, `RenderStatisticsReporter`, `ArcOptions`, `CircleOptions`, `EllipseOptions`, `LineOptions`, `Paint`, `PathShapeOptions`, `PolygonOptions`, `PolylineOptions`, `RectangleOptions`, `RegularPolygonOptions`, `RingOptions`, `SectorOptions`, `ResolvedPaint`, `ResolvedShapeFill`, `ResolvedStrokeStyle`, `Shape2DOptions`, `ShapeFill`, `SolidPaint`, `StarOptions`, `StrokeStyle`, `SpriteFrame`, `SpriteOptions`, `TextureFilter`, `TextureMinFilter`, `TextureSource`, `TextureWrap`, `ViewRenderListOptions`

---

### `packages/render/src/lights.ts` - Light collection (§68, §64) — scene graph in, one flat light state out.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix4, Vector3` |
| `@four/scene` | `Node` |

**Exports:**
- Interfaces: `DirectionalLightSource`, `DirectionalShadowSource`, `PunctualLightSourceBase`, `PointLightSource`, `SpotLightSource`, `AmbientLightSource`, `SceneLights`
- Types: `PunctualLightSource`
- Functions: `isDirectionalLightSource`, `isPunctualLightSource`, `createSceneLights`, `collectSceneLights`
- Constants: `MAX_PUNCTUAL_LIGHTS`

---

### `packages/render/src/mesh.ts` - `Mesh` (§54) — the renderable that can be skinned (RFC 0003 — gaps PH-10 +

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/materials` | `Material` |
| `@four/scene` | `Bone, MorphWeights, Skeleton, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderable.js` | `Renderable, RenderableOptions, SurfaceMaterial` | Import |

**Exports:**
- Classes: `Mesh`
- Functions: `restoreMeshSkeleton`
- Constants: `MAX_SKINNING_JOINTS`

---

### `packages/render/src/particles.ts` - The particle drawing contract (§36, §49, plan P9-3) — one batched render item

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/geometry` | `BufferGeometry` |

**Exports:**
- Interfaces: `ParticleDrawable`
- Functions: `isParticleDrawable`, `particleQuadGeometry`
- Constants: `PARTICLE_INSTANCE_FLOATS`, `PARTICLE_POSITION_OFFSET`, `PARTICLE_SIZE_OFFSET`, `PARTICLE_COLOR_OFFSET`

---

### `packages/render/src/picking.ts` - Pixel/GPU-id picking — the backend-neutral half (§71; RFC 0005, accepted

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `Matrix4` |
| `@four/scene` | `Node, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderable.js` | `Renderable` | Import |
| `./renderer.js` | `Renderer` | Import (type-only) |

**Exports:**
- Interfaces: `PickRequest`, `PickResult`, `PickingService`
- Functions: `supportsPicking`, `assertEncodableCandidateCount`, `collectPickCandidates`, `encodePickId`, `decodePickId`
- Constants: `MAX_PICK_CANDIDATES`

---

### `packages/render/src/raster.ts` - Raster painting (§77a; RFC 0004, accepted 2026-08-21) — a surface an

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError, Disposable` |
| `@four/materials` | `MaterialTexture` |
| `@four/math` | `ColorSpace` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target.js` | `validateColorSpace` | Import |
| `./resource-memory.js` | `noteTexture` | Import |

**Exports:**
- Classes: `CanvasTexture`
- Interfaces: `RasterSource`, `CanvasTextureOptions`
- Types: `RasterOrigin`

---

### `packages/render/src/render-graph.ts` - `RenderGraph` (§63) — an ordered list of passes, executed by one call, with

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/scene` | `Node, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./effect-pass.js` | `supportsScreenEffects, validateEffectRenderPass, EffectRenderPass` | Import |
| `./render-list.js` | `buildRenderList, RenderItem` | Import |
| `./render-target.js` | `isRenderTargetTexture, RenderTarget` | Import |
| `./renderer.js` | `RenderInterpolation, Renderer` | Import (type-only) |

**Exports:**
- Classes: `RenderGraph`
- Interfaces: `RenderPassContext`, `SceneRenderPass`, `CustomRenderPass`, `AddPassOptions`, `RenderGraphPass`, `RenderGraphIssue`
- Types: `RenderPass`, `RenderGraphIssueCode`, `RenderGraphIssueSeverity`

---

### `packages/render/src/render-list.ts` - Render-list construction (§64) — scene graph in, flat sorted draw list out.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEV, devWarnOnce` |
| `@four/geometry` | `BufferGeometry` |
| `@four/math` | `Matrix4, Quaternion, Vector3` |
| `@four/materials` | `LitMaterial, Material, NodeMaterial, SpriteMaterial, StandardMaterial, UnlitMaterial` |
| `@four/scene` | `ALL_LAYERS, DEFAULT_LAYER_MASK, assertLayerMask, isLayerMask, layersMatch, LayerMask, Node, PoseBuffer, Skeleton, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clip.js` | `ClipPlaneAllocator, RenderItemClip` | Import |
| `./particles.js` | `isParticleDrawable, particleQuadGeometry` | Import |
| `./renderable.js` | `Renderable` | Import |
| `./sprite.js` | `SpriteFrame` | Import (type-only) |

**Exports:**
- Interfaces: `UnlitRenderItem`, `SkinnedUnlitRenderItem`, `SkinnedLitRenderItem`, `LitRenderItem`, `StandardRenderItem`, `NodeRenderItem`, `SpriteRenderItem`, `ParticleRenderItem`
- Types: `RenderItemKind`, `RenderItem`
- Functions: `isSpriteItem`, `isUnlitItem`, `isLitItem`, `isStandardItem`, `isParticlesItem`, `isNodeItem`, `isSkinnedUnlitItem`, `isSkinnedLitItem`, `viewLayerMask`, `groupRenderListByPipeline`, `buildRenderList`, `buildInterpolatedRenderList`

---

### `packages/render/src/render-target.ts` - `RenderTarget` (§61, §48, §63, §77) — an off-screen surface a frame can be

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |
| `@four/materials` | `MaterialTexture` |
| `@four/math` | `ColorSpace` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./resource-memory.js` | `noteRenderTarget` | Import |

**Exports:**
- Classes: `RenderTarget`
- Interfaces: `RenderTargetOptions`, `RenderTargetTexture`
- Types: `RenderTargetFormat`
- Functions: `isRenderTargetTexture`, `validateColorSpace`

---

### `packages/render/src/renderable.ts` - `Renderable` (§49) — the node that draws something.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/geometry` | `BufferGeometry` |
| `@four/materials` | `LitMaterial, Material, UnlitMaterial` |
| `@four/scene` | `Node` |

**Exports:**
- Classes: `Renderable`
- Interfaces: `RenderableOptions`
- Types: `SurfaceMaterial`

---

### `packages/render/src/renderer-registry.ts` - The §62 backend registry — how a name becomes a renderer without this

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderer.js` | `Renderer, RendererBackend, RendererCapabilities, RendererOptions` | Import (type-only) |

**Exports:**
- Classes: `RendererRegistry`
- Interfaces: `RendererRegistration`, `RendererCapabilityDeclaration`, `RendererCapabilityShortfall`, `RendererFallbackReport`, `RendererResolveOptions`
- Types: `RendererSelection`, `RendererCapabilityName`, `RendererFallbackReason`
- Functions: `validateCapabilityDeclaration`, `missingCapabilities`, `registerRenderer`, `registeredRenderers`, `clearRegisteredRenderers`, `resolveRenderer`
- Constants: `AUTO_RENDERER_ORDER`, `RENDERER_CAPABILITY_NAMES`

---

### `packages/render/src/renderer.ts` - The renderer interface (§61) — the seam every backend implements.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |
| `@four/core` | `EventEmitter, FourError` |
| `@four/scene` | `Node, PoseBuffer, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./effect-pass.js` | `EffectRenderPass` | Import (type-only) |
| `./picking.js` | `PickingService` | Import (type-only) |
| `./render-target.js` | `RenderTarget` | Import (type-only) |
| `./statistics.js` | `RenderStatistics` | Import (type-only) |

**Exports:**
- Classes: `NullRenderer`
- Interfaces: `RendererCapabilities`, `RendererOptions`, `RendererEventMap`, `RenderInterpolation`, `Renderer`, `ResizeRecord`
- Types: `RendererBackend`

---

### `packages/render/src/resource-memory.ts` - §83 resource accounting for textures and render targets — how many are live,

**Exports:**
- Functions: `noteTexture`, `noteRenderTarget`, `textureMemoryBytes`, `liveTextureCount`, `liveRenderTargetCount`

---

### `packages/render/src/shape.ts` - §50's native 2D shape system — the node tier (R-23, 2026-08-09).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |
| `@four/geometry` | `BufferGeometry, DEFAULT_FLATTEN_TOLERANCE, expandStroke, Path, triangulatePolygon, GeometryIndexArray, PathFillRings, Point2D, StrokeAlignment, StrokeLineCap, StrokeLineJoin, StrokeMesh` |
| `@four/materials` | `Material` |
| `@four/math` | `ColorRGBA` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderable.js` | `Renderable, RenderableOptions, SurfaceMaterial` | Import |

**Exports:**
- Classes: `Circle`, `Ellipse`, `Rectangle`, `RegularPolygon`, `Star`, `Sector`, `Ring`, `Polygon`, `PathShape`, `Line`, `Polyline`, `Arc`
- Interfaces: `SolidPaint`, `ResolvedPaint`, `StrokeStyle`, `ResolvedStrokeStyle`, `Shape2DOptions`, `CircleOptions`, `EllipseOptions`, `RectangleOptions`, `RegularPolygonOptions`, `StarOptions`, `SectorOptions`, `RingOptions`, `PolygonOptions`, `PathShapeOptions`, `LineOptions`, `PolylineOptions`, `ArcOptions`
- Types: `Paint`, `ShapeFill`, `ResolvedShapeFill`

---

### `packages/render/src/sprite.ts` - `Sprite` (§55) — a textured, tinted quad in the scene graph.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |
| `@four/geometry` | `BufferGeometry` |
| `@four/math` | `Vector2` |
| `@four/materials` | `SpriteMaterial` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderable.js` | `Renderable` | Import |

**Exports:**
- Classes: `Sprite`
- Interfaces: `SpriteFrame`, `SpriteOptions`

---

### `packages/render/src/statistics.ts` - Per-frame render counters (§84's `drawCalls`/`triangles`/`instances`) — the

**Exports:**
- Interfaces: `RenderStatistics`, `RenderStatisticsReporter`
- Functions: `createRenderStatistics`, `resetRenderStatistics`, `supportsRenderStatistics`

---

### `packages/render/src/texture.ts` - `Texture` (§77, §55, §61) — CPU-side texel data with a stable identity and a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |
| `@four/materials` | `MaterialTextureFilter, MaterialTextureMinFilter, MaterialTextureWrap, SpriteTexture` |
| `@four/math` | `ColorSpace` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target.js` | `validateColorSpace` | Import |
| `./resource-memory.js` | `noteTexture` | Import |

**Exports:**
- Classes: `Texture`
- Interfaces: `TextureSource`
- Types: `TextureFilter`, `TextureMinFilter`, `TextureWrap`

---

### `packages/render/src/view-list.ts` - Per-view render lists (§64 stages 2–3, §66 sort key 4; R-8) — the frame's one

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Frustum, Matrix4, Vector3` |
| `@four/scene` | `layersMatch, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./bounds.js` | `computeWorldBoundingSphere, BoundingSphere` | Import |
| `./render-list.js` | `viewLayerMask, RenderItem` | Import |

**Exports:**
- Interfaces: `ViewRenderListOptions`
- Functions: `buildViewRenderList`, `sortRenderListByDepth`

---

<a id="packages-render-canvas-dependencies"></a>

## Packages/render canvas Dependencies

### `packages/render-canvas/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-render-svg-dependencies"></a>

## Packages/render svg Dependencies

### `packages/render-svg/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-render-webgl-dependencies"></a>

## Packages/render webgl Dependencies

### `packages/render-webgl/src/gl-batch.ts` - §65 batching for the WebGL 2 backend — the GPU half of `@four/render`'s

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix4` |
| `@four/render` | `RenderBatcher, RenderBatch, RenderBatchOptions, RenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `COLOR_ATTRIBUTE_LOCATION, GL, POSITION_ATTRIBUTE_LOCATION, UV_ATTRIBUTE_LOCATION, GlBuffer, GlVertexArray, UnlitProgram, WebglContext` | Import |

**Exports:**
- Classes: `GlBatching`
- Interfaces: `BatchGlContext`, `RenderBatching`
- Functions: `createGlBatching`

---

### `packages/render-webgl/src/gl-effect.ts` - The full-screen effect pipeline for the WebGL 2 backend — §70's blit, colour

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `createLinkedProgram, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |

**Exports:**
- Classes: `EffectProgram`
- Constants: `EFFECT_TEXTURE_UNIT`, `EFFECT_VERTEX_COUNT`

---

### `packages/render-webgl/src/gl-geometry.ts` - GPU-side geometry for the WebGL 2 backend: one vertex array per

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `RenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `COLOR_ATTRIBUTE_LOCATION, GL, JOINTS_ATTRIBUTE_LOCATION, NORMAL_ATTRIBUTE_LOCATION, POSITION_ATTRIBUTE_LOCATION, UV_ATTRIBUTE_LOCATION, WEIGHTS_ATTRIBUTE_LOCATION, WebglContext` | Import |
| `./gl-program.js` | `GlBuffer, GlVertexArray` | Import (type-only) |

**Exports:**
- Classes: `GeometryCache`
- Interfaces: `GeometryRecord`
- Types: `CacheableGeometry`

---

### `packages/render-webgl/src/gl-node-program.ts` - The node-material pipeline (§60, §62; RFC 0001 — gap R-14): a GLSL ES 3.00

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEV, devWarnOnce, Disposable` |
| `@four/math` | `Matrix4` |
| `@four/render` | `analyzeShaderGraph, ShaderAttributeName, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderUniformReflection, ShaderValueType` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./node-pipeline-registry.js` | `NODE_SURFACE_TEXTURE_UNIT_BASE, setNodeMaterialPipelineFactory, NodeItemMaterial, NodeMaterialProgram, NodeMaterialPrograms` | Import |

**Exports:**
- Classes: `GlNodeProgram`, `GlNodeProgramCache`
- Interfaces: `EmittedNodeShader`
- Functions: `emitShaderGraphGlsl`, `registerNodeMaterialPipeline`

---

### `packages/render-webgl/src/gl-particles.ts` - The batched particle pipeline for the WebGL 2 backend (§36, §64 stage 6,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |
| `@four/math` | `Matrix4` |
| `@four/render` | `PARTICLE_COLOR_OFFSET, PARTICLE_INSTANCE_FLOATS, PARTICLE_POSITION_OFFSET, PARTICLE_SIZE_OFFSET, ParticleRenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GL, POSITION_ATTRIBUTE_LOCATION, createLinkedProgram, matrixScratch, requireUniform, GlBuffer, GlProgramHandle, GlUniformLocation, GlVertexArray, WebglContext` | Import |

**Exports:**
- Classes: `ParticleProgram`, `ParticleBatchCache`
- Interfaces: `ParticleGlContext`, `ParticleBatchRecord`
- Constants: `PARTICLE_GL`, `PARTICLE_ATTRIBUTE_LOCATIONS`

---

### `packages/render-webgl/src/gl-picking-registry.ts` - The picking pipeline's registration slot (§71, §62; RFC 0005, 2026-08-28) —

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `PickingService` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-geometry.js` | `GeometryCache` | Import (type-only) |
| `./gl-program.js` | `WebglContext` | Import (type-only) |
| `./gl-render-target.js` | `RenderTargetCache` | Import (type-only) |

**Exports:**
- Interfaces: `PickingRendererHost`, `PickingServiceFactory`
- Functions: `setPickingServiceFactory`, `resolvePickingServiceFactory`, `clearRegisteredPickingPipeline`

---

### `packages/render-webgl/src/gl-picking.ts` - The WebGL 2 picking service (§71, §62; RFC 0005, 2026-08-28) — the id-buffer

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEV, FourError, devWarnOnce` |
| `@four/math` | `Frustum, Matrix4` |
| `@four/render` | `RenderTarget, assertEncodableCandidateCount, buildRenderList, buildViewRenderList, collectPickCandidates, decodePickId, encodePickId, PickRequest, PickResult, PickingService, RenderItem, RenderItemClip, RenderItemStencil` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-geometry.js` | `GeometryCache` | Import (type-only) |
| `./gl-picking-registry.js` | `setPickingServiceFactory, PickingRendererHost` | Import |
| `./gl-program.js` | `GL, createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./gl-render-target.js` | `RenderTargetRecord` | Import (type-only) |

**Exports:**
- Classes: `IdPassProgram`, `WebglPickingService`
- Functions: `registerPickingPipeline`
- Constants: `PICKING_GL`

---

### `packages/render-webgl/src/gl-program.ts` - The WebGL 2 surface this backend uses, and the pipelines it draws with

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError, Disposable` |
| `@four/math` | `Matrix4, Vector3` |
| `@four/render` | `MAX_PUNCTUAL_LIGHTS, SceneLights` |

**Exports:**
- Classes: `PunctualLightUniforms`, `ShadowUniforms`, `UnlitProgram`, `SpriteProgram`, `LitProgram`
- Interfaces: `WebglContext`
- Types: `GlShader`, `GlProgramHandle`, `GlBuffer`, `GlVertexArray`, `GlUniformLocation`, `GlTexture`, `GlFramebuffer`, `GlRenderbuffer`, `GlSync`
- Functions: `createLinkedProgram`, `requireUniform`
- Constants: `GL`, `POSITION_ATTRIBUTE_LOCATION`, `NORMAL_ATTRIBUTE_LOCATION`, `UV_ATTRIBUTE_LOCATION`, `COLOR_ATTRIBUTE_LOCATION`, `JOINTS_ATTRIBUTE_LOCATION`, `WEIGHTS_ATTRIBUTE_LOCATION`, `MAP_TEXTURE_UNIT`, `SHADOW_TEXTURE_UNIT`, `FRAGMENT_SHADER_SOURCE`, `PUNCTUAL_LIGHT_GLSL`, `SHADOW_GLSL`, `LIT_FRAGMENT_SHADER_SOURCE`, `matrixScratch`

---

### `packages/render-webgl/src/gl-render-target.ts` - GPU-side render targets for the WebGL 2 backend: one framebuffer object per

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `RenderTarget` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GL, GlFramebuffer, GlRenderbuffer, GlTexture, WebglContext` | Import |

**Exports:**
- Classes: `RenderTargetCache`
- Interfaces: `RenderTargetRecord`
- Types: `CacheableRenderTarget`

---

### `packages/render-webgl/src/gl-shadow.ts` - The depth-only caster pipeline (§69) — this backend's seventh program (R-18,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |
| `@four/math` | `Matrix4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |

**Exports:**
- Classes: `ShadowProgram`

---

### `packages/render-webgl/src/gl-skinning-registry.ts` - The skinning pipeline's registration slot (§54, §62; RFC 0003, 2026-08-28)

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix4` |
| `@four/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `WebglContext` | Import (type-only) |

**Exports:**
- Interfaces: `SkinnedUnlitPipeline`, `SkinnedLitPipeline`, `SkinnedPrograms`, `SkinningPipelineFactory`
- Functions: `setSkinningPipelineFactory`, `resolveSkinningPipelineFactory`, `clearRegisteredSkinningPipeline`

---

### `packages/render-webgl/src/gl-skinning.ts` - The skinned pipelines (§54, §62; RFC 0003 — gaps PH-10 + R-22, 2026-08-28):

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |
| `@four/math` | `Matrix4` |
| `@four/render` | `MAX_SKINNING_JOINTS, SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `FRAGMENT_SHADER_SOURCE, LIT_FRAGMENT_SHADER_SOURCE, MAP_TEXTURE_UNIT, PunctualLightUniforms, ShadowUniforms, createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./gl-skinning-registry.js` | `setSkinningPipelineFactory, SkinnedLitPipeline, SkinnedPrograms, SkinnedUnlitPipeline` | Import |

**Exports:**
- Classes: `SkinnedUnlitProgram`, `SkinnedLitProgram`
- Functions: `registerSkinningPipeline`

---

### `packages/render-webgl/src/gl-standard.ts` - The metallic-roughness pipeline (§59, §68) — this backend's sixth program,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable` |
| `@four/math` | `Matrix4, Vector3` |
| `@four/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `MAP_TEXTURE_UNIT, PUNCTUAL_LIGHT_GLSL, PunctualLightUniforms, SHADOW_GLSL, ShadowUniforms, createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |

**Exports:**
- Classes: `StandardProgram`

---

### `packages/render-webgl/src/gl-texture.ts` - GPU-side textures for the WebGL 2 backend: one `WebGLTexture` per

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `SpriteRenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GL, GlTexture, WebglContext` | Import |

**Exports:**
- Classes: `TextureCache`
- Interfaces: `TextureRecord`
- Types: `CacheableTexture`

---

### `packages/render-webgl/src/index.ts` - `@four/render-webgl` — the WebGL 2 backend (§62 backend 2, §120's MVP tier).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-batch.js` | `GlBatching, createGlBatching` | Re-export |
| `./gl-effect.js` | `EFFECT_TEXTURE_UNIT, EFFECT_VERTEX_COUNT, EffectProgram` | Re-export |
| `./gl-geometry.js` | `GeometryCache` | Re-export |
| `./gl-particles.js` | `PARTICLE_ATTRIBUTE_LOCATIONS, PARTICLE_GL, ParticleBatchCache, ParticleProgram` | Re-export |
| `./gl-program.js` | `COLOR_ATTRIBUTE_LOCATION, GL, LitProgram, MAP_TEXTURE_UNIT, NORMAL_ATTRIBUTE_LOCATION, POSITION_ATTRIBUTE_LOCATION, PUNCTUAL_LIGHT_GLSL, PunctualLightUniforms, SHADOW_GLSL, SHADOW_TEXTURE_UNIT, ShadowUniforms, SpriteProgram, UV_ATTRIBUTE_LOCATION, UnlitProgram` | Re-export |
| `./gl-picking-registry.js` | `clearRegisteredPickingPipeline, resolvePickingServiceFactory` | Re-export |
| `./gl-picking.js` | `IdPassProgram, PICKING_GL, WebglPickingService, registerPickingPipeline` | Re-export |
| `./gl-render-target.js` | `RenderTargetCache` | Re-export |
| `./gl-program.js` | `JOINTS_ATTRIBUTE_LOCATION, WEIGHTS_ATTRIBUTE_LOCATION` | Re-export |
| `./gl-skinning-registry.js` | `clearRegisteredSkinningPipeline, resolveSkinningPipelineFactory` | Re-export |
| `./gl-skinning.js` | `SkinnedLitProgram, SkinnedUnlitProgram, registerSkinningPipeline` | Re-export |
| `./node-pipeline-registry.js` | `NODE_SURFACE_TEXTURE_UNIT_BASE, clearRegisteredNodeMaterialPipeline, resolveNodeMaterialPipelineFactory` | Re-export |
| `./gl-node-program.js` | `GlNodeProgram, GlNodeProgramCache, emitShaderGraphGlsl, registerNodeMaterialPipeline` | Re-export |
| `./gl-shadow.js` | `ShadowProgram` | Re-export |
| `./gl-standard.js` | `StandardProgram` | Re-export |
| `./gl-texture.js` | `TextureCache` | Re-export |
| `./register.js` | `isWebgl2Supported, registerWebglRenderer` | Re-export |
| `./webgl-renderer.js` | `WebglRenderer` | Re-export |
| `./gl-batch.js` | `BatchGlContext, RenderBatching` | Re-export (type-only) |
| `./gl-geometry.js` | `CacheableGeometry, GeometryRecord` | Re-export (type-only) |
| `./gl-particles.js` | `ParticleBatchRecord, ParticleGlContext` | Re-export (type-only) |
| `./gl-program.js` | `GlBuffer, GlProgramHandle, GlShader, GlSync, GlTexture, GlUniformLocation, GlVertexArray, WebglContext` | Re-export (type-only) |
| `./gl-program.js` | `GlFramebuffer, GlRenderbuffer` | Re-export (type-only) |
| `./gl-picking-registry.js` | `PickingRendererHost, PickingServiceFactory` | Re-export (type-only) |
| `./gl-render-target.js` | `CacheableRenderTarget, RenderTargetRecord` | Re-export (type-only) |
| `./gl-skinning-registry.js` | `SkinnedLitPipeline, SkinnedPrograms, SkinnedUnlitPipeline, SkinningPipelineFactory` | Re-export (type-only) |
| `./node-pipeline-registry.js` | `NodeItemMaterial, NodeMaterialPipelineFactory, NodeMaterialProgram, NodeMaterialPrograms` | Re-export (type-only) |
| `./gl-node-program.js` | `EmittedNodeShader` | Re-export (type-only) |
| `./gl-texture.js` | `CacheableTexture, TextureRecord` | Re-export (type-only) |
| `./webgl-renderer.js` | `WebglCanvas, WebglContextAttributes, WebglContextEventLike` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `GlBatching`, `createGlBatching`, `EFFECT_TEXTURE_UNIT`, `EFFECT_VERTEX_COUNT`, `EffectProgram`, `GeometryCache`, `PARTICLE_ATTRIBUTE_LOCATIONS`, `PARTICLE_GL`, `ParticleBatchCache`, `ParticleProgram`, `COLOR_ATTRIBUTE_LOCATION`, `GL`, `LitProgram`, `MAP_TEXTURE_UNIT`, `NORMAL_ATTRIBUTE_LOCATION`, `POSITION_ATTRIBUTE_LOCATION`, `PUNCTUAL_LIGHT_GLSL`, `PunctualLightUniforms`, `SHADOW_GLSL`, `SHADOW_TEXTURE_UNIT`, `ShadowUniforms`, `SpriteProgram`, `UV_ATTRIBUTE_LOCATION`, `UnlitProgram`, `clearRegisteredPickingPipeline`, `resolvePickingServiceFactory`, `IdPassProgram`, `PICKING_GL`, `WebglPickingService`, `registerPickingPipeline`, `RenderTargetCache`, `JOINTS_ATTRIBUTE_LOCATION`, `WEIGHTS_ATTRIBUTE_LOCATION`, `clearRegisteredSkinningPipeline`, `resolveSkinningPipelineFactory`, `SkinnedLitProgram`, `SkinnedUnlitProgram`, `registerSkinningPipeline`, `NODE_SURFACE_TEXTURE_UNIT_BASE`, `clearRegisteredNodeMaterialPipeline`, `resolveNodeMaterialPipelineFactory`, `GlNodeProgram`, `GlNodeProgramCache`, `emitShaderGraphGlsl`, `registerNodeMaterialPipeline`, `ShadowProgram`, `StandardProgram`, `TextureCache`, `isWebgl2Supported`, `registerWebglRenderer`, `WebglRenderer`, `BatchGlContext`, `RenderBatching`, `CacheableGeometry`, `GeometryRecord`, `ParticleBatchRecord`, `ParticleGlContext`, `GlBuffer`, `GlProgramHandle`, `GlShader`, `GlSync`, `GlTexture`, `GlUniformLocation`, `GlVertexArray`, `WebglContext`, `GlFramebuffer`, `GlRenderbuffer`, `PickingRendererHost`, `PickingServiceFactory`, `CacheableRenderTarget`, `RenderTargetRecord`, `SkinnedLitPipeline`, `SkinnedPrograms`, `SkinnedUnlitPipeline`, `SkinningPipelineFactory`, `NodeItemMaterial`, `NodeMaterialPipelineFactory`, `NodeMaterialProgram`, `NodeMaterialPrograms`, `EmittedNodeShader`, `CacheableTexture`, `TextureRecord`, `WebglCanvas`, `WebglContextAttributes`, `WebglContextEventLike`

---

### `packages/render-webgl/src/node-pipeline-registry.ts` - The node-material pipeline's registration slot (§60, §62; RFC 0001, gap

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix4` |
| `@four/render` | `NodeRenderItem, ShaderGraph` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `WebglContext` | Import (type-only) |

**Exports:**
- Interfaces: `NodeMaterialProgram`, `NodeMaterialPrograms`, `NodeMaterialPipelineFactory`
- Types: `NodeItemMaterial`
- Functions: `setNodeMaterialPipelineFactory`, `resolveNodeMaterialPipelineFactory`, `clearRegisteredNodeMaterialPipeline`
- Constants: `NODE_SURFACE_TEXTURE_UNIT_BASE`

---

### `packages/render-webgl/src/register.ts` - This backend's opt-in to §62's renderer registry (R-2, A-8).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `registerRenderer, RendererOptions, RendererRegistry` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgl-renderer.js` | `WebglRenderer` | Import |

**Exports:**
- Functions: `isWebgl2Supported`, `registerWebglRenderer`

---

### `packages/render-webgl/src/webgl-renderer.ts` - The WebGL 2 backend (§61, §62, §120) — the MVP's only renderer.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEV, devWarnOnce, EventEmitter, FourError` |
| `@four/math` | `Frustum, Matrix4` |
| `@four/render` | `MAX_SKINNING_JOINTS, RenderTarget, buildInterpolatedRenderList, buildRenderList, buildViewRenderList, collectSceneLights, createSceneLights, isLitItem, isNodeItem, isParticlesItem, isRenderTargetTexture, isSkinnedLitItem, isSkinnedUnlitItem, isSpriteItem, isStandardItem, COLOR_GRADE_DEFAULTS, EffectRenderPass, GraphEffect, PickingService, RenderItem, RenderItemKind, RenderStatistics, Renderer, RendererCapabilities, RendererEventMap, RendererOptions, ScreenEffectRenderer` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-batch.js` | `RenderBatching` | Import (type-only) |
| `./gl-effect.js` | `EFFECT_TEXTURE_UNIT, EFFECT_VERTEX_COUNT, EffectProgram` | Import |
| `./gl-geometry.js` | `GeometryCache` | Import |
| `./gl-particles.js` | `ParticleBatchCache, ParticleProgram, ParticleGlContext` | Import |
| `./gl-program.js` | `GL, LitProgram, MAP_TEXTURE_UNIT, SHADOW_TEXTURE_UNIT, SpriteProgram, UnlitProgram, GlTexture` | Import |
| `./gl-picking-registry.js` | `resolvePickingServiceFactory, PickingRendererHost` | Import |
| `./gl-render-target.js` | `RenderTargetCache, RenderTargetRecord` | Import |
| `./gl-skinning-registry.js` | `resolveSkinningPipelineFactory, SkinnedPrograms` | Import |
| `./node-pipeline-registry.js` | `NODE_SURFACE_TEXTURE_UNIT_BASE, resolveNodeMaterialPipelineFactory, NodeMaterialProgram, NodeMaterialPrograms` | Import |
| `./gl-shadow.js` | `ShadowProgram` | Import |
| `./gl-standard.js` | `StandardProgram` | Import |
| `./gl-texture.js` | `TextureCache, CacheableTexture` | Import |

**Exports:**
- Classes: `WebglRenderer`
- Interfaces: `WebglContextEventLike`, `WebglCanvas`, `WebglContextAttributes`

---

<a id="packages-render-webgpu-dependencies"></a>

## Packages/render webgpu Dependencies

### `packages/render-webgpu/src/index.ts` - `@four/render-webgpu` — the WebGPU backend (§62 backend 1).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_MAP_MODE, GPU_SHADER_STAGE, GPU_TEXTURE_USAGE, UNIFORM_STRIDE_BYTES` | Re-export |
| `./webgpu-renderer.js` | `hostGpu, WebgpuRenderer` | Re-export |
| `./register.js` | `isWebgpuSupported, registerWebgpuRenderer` | Re-export |
| `./wgpu-bindings.js` | `DRAW_COLOR_OFFSET, DRAW_MODEL_OFFSET, DRAW_UNIFORM_BYTES, DRAW_UNIFORM_FLOATS, DRAW_UNIFORM_WGSL, DRAW_VIEW_PROJECTION_OFFSET, MAP_BINDING_WGSL, MAP_BIND_GROUP_INDEX, MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING, createDrawBindGroupLayout, createTextureBindGroupLayout` | Re-export |
| `./wgpu-geometry.js` | `WgpuGeometryCache` | Re-export |
| `./wgpu-pipeline-cache.js` | `blendStateFor, pipelineKey, stencilStateFor, WgpuPipelineCache` | Re-export |
| `./wgpu-batch.js` | `WgpuBatching, batchVertexBufferLayout, createWgpuBatching` | Re-export |
| `./wgpu-sprite.js` | `SPRITE_MODEL_OFFSET, SPRITE_QUAD_OFFSET, SPRITE_SHADER_SOURCE, SPRITE_TINT_OFFSET, SPRITE_UNIFORM_BYTES, SPRITE_UNIFORM_WGSL, SPRITE_VIEW_PROJECTION_OFFSET, createSpriteBindGroupLayout` | Re-export |
| `./wgpu-texture.js` | `MIPMAP_SHADER_SOURCE, WgpuTextureCache, mipLevelCount, samplerKey, textureByteLength` | Re-export |
| `./wgpu-unlit.js` | `CLEAR_SHADER_SOURCE, CLEAR_VERTEX_COUNT, COLOR_BUFFER_LAYOUT, COLOR_SHADER_LOCATION, FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, POSITION_SHADER_LOCATION, UV_BUFFER_LAYOUT, UV_SHADER_LOCATION, VERTEX_ENTRY_POINT, unlitShaderSource, unlitVertexBufferLayouts` | Re-export |
| `./wgpu-lights.js` | `LIGHTS_BIND_GROUP_INDEX, LIGHT_AMBIENT_OFFSET, LIGHT_CAMERA_OFFSET, LIGHT_COLOR_OFFSET, LIGHT_COUNTS_OFFSET, LIGHT_DIRECTION_OFFSET, LIGHT_PUNCTUAL_COLOR_OFFSET, LIGHT_PUNCTUAL_DIRECTION_OFFSET, LIGHT_PUNCTUAL_PARAMS_OFFSET, LIGHT_PUNCTUAL_POSITION_OFFSET, LIGHT_UNIFORM_BYTES, LIGHT_UNIFORM_FLOATS, LIGHT_UNIFORM_MEMBERS_WGSL, LIGHT_UNIFORM_STRIDE_BYTES, LIGHT_UNIFORM_STRIDE_FLOATS, LIGHT_UNIFORM_WGSL, PUNCTUAL_LIGHT_WGSL, SHADED_MAP_BINDING_WGSL, SHADED_MAP_BIND_GROUP_INDEX, createLightsBindGroupLayout, writeLightUniforms` | Re-export |
| `./wgpu-lit.js` | `NORMAL_BUFFER_LAYOUT, NORMAL_MATRIX_WGSL, NORMAL_SHADER_LOCATION, litShaderSource, shadedVertexBufferLayouts, shadedVertexStageWgsl` | Re-export |
| `./wgpu-render-target.js` | `RENDER_TARGET_COLOR_FORMAT, RENDER_TARGET_DEPTH_FORMAT, RENDER_TARGET_DEPTH_STENCIL_FORMAT, RENDER_TARGET_DEPTH_TEXTURE_FORMAT, WgpuRenderTargetCache, renderTargetDepthFormat` | Re-export |
| `./wgpu-effect.js` | `EFFECT_BIND_GROUP_INDEX, EFFECT_GRADE_OFFSET, EFFECT_PASS_VERTEX_COUNT, EFFECT_UNIFORM_BYTES, EFFECT_UNIFORM_WGSL, createEffectBindGroupLayout, effectShaderSource` | Re-export |
| `./wgpu-readback.js` | `READBACK_ROW_ALIGNMENT, readTexturePixels, readbackBytesPerRow` | Re-export |
| `./wgpu-compute.js` | `COMPUTE_ENTRY_POINT, PARTICLE_INTEGRATOR_SHADER_SOURCE, PARTICLE_INTEGRATOR_WORKGROUP_SIZE, PARTICLE_SIMULATION_PARAMS_FLOATS, WgpuComputeBuffer, WgpuComputeCache, createComputeBuffer, particleIntegratorWorkgroups, readComputeBufferBytes, writeComputeBuffer, writeParticleSimulationParams` | Re-export |
| `./wgpu-particles.js` | `PARTICLE_INSTANCE_BUFFER_LAYOUT, PARTICLE_INSTANCE_STRIDE_BYTES, PARTICLE_MODEL_OFFSET, PARTICLE_PROJECTION_OFFSET, PARTICLE_SHADER_SOURCE, PARTICLE_UNIFORM_BYTES, PARTICLE_UNIFORM_WGSL, PARTICLE_VERTEX_BUFFER_LAYOUTS, PARTICLE_VIEW_OFFSET, WgpuParticleCache, createParticleBindGroupLayout` | Re-export |
| `./wgpu-shadow.js` | `SHADOW_FACTOR_WGSL, SHADOW_LIGHT_UNIFORM_BYTES, SHADOW_LIGHT_UNIFORM_WGSL, SHADOW_MAP_BINDING, SHADOW_MATRIX_OFFSET, SHADOW_PARAMS_OFFSET, SHADOW_SAMPLER_BINDING, SHADOW_SHADER_SOURCE, SHADOW_UNIFORM_SPARE_BYTES, createShadowLightsBindGroupLayout, createShadowSampler, writeShadowUniforms` | Re-export |
| `./wgpu-stencil.js` | `CLEAR_STENCIL, STENCIL_ALL_BITS, applyStencilReference, frameWantsStencil, stencilDescriptor` | Re-export |
| `./wgpu-standard.js` | `STANDARD_BASE_COLOR_OFFSET, STANDARD_EMISSIVE_OFFSET, STANDARD_MODEL_OFFSET, STANDARD_SURFACE_OFFSET, STANDARD_UNIFORM_BYTES, STANDARD_UNIFORM_WGSL, STANDARD_VIEW_PROJECTION_OFFSET, createStandardBindGroupLayout, standardShaderSource` | Re-export |
| `./wgpu-node-registry.js` | `clearRegisteredWebgpuNodeMaterialPipeline, resolveWebgpuNodeMaterialPipelineFactory, setWebgpuNodeMaterialPipelineFactory` | Re-export |
| `./wgpu-node-program.js` | `NODE_SCREEN_BLOCK_BASE_BYTES, NODE_SCREEN_TEXTURE_GROUP, NODE_SURFACE_BLOCK_BASE_BYTES, NODE_SURFACE_BLOCK_GROUP, NODE_SURFACE_TEXTURE_GROUP, WgpuNodePipelineStore, emitShaderGraphWgsl, registerWebgpuNodeMaterialPipeline` | Re-export |
| `./webgpu-device.js` | `Gpu, GpuAdapter, GpuStencilFaceState, GpuBindGroup, GpuBindGroupEntry, GpuBindGroupLayout, GpuBindGroupLayoutEntry, GpuBlendComponent, GpuBlendState, GpuBuffer, GpuBufferDescriptor, GpuCanvasContext, GpuCommandBuffer, GpuCommandEncoder, GpuComputePassEncoder, GpuComputePipeline, GpuComputePipelineDescriptor, GpuDevice, GpuDeviceLostInfo, GpuPipelineLayout, GpuQueue, GpuRenderPassDescriptor, GpuRenderPassEncoder, GpuRenderPipeline, GpuBufferBinding, GpuRenderPipelineDescriptor, GpuSampler, GpuSamplerDescriptor, GpuShaderModule, GpuTexture, GpuTextureDescriptor, GpuTextureView, GpuTextureViewDescriptor, GpuVertexBufferLayout, WebgpuCanvas` | Re-export (type-only) |
| `./wgpu-geometry.js` | `CacheableGeometry, WgpuGeometryRecord` | Re-export (type-only) |
| `./wgpu-pipeline-cache.js` | `WgpuBatchStream, WgpuPipelineDescriptor, WgpuPipelineKind, WgpuStencilDescriptor` | Re-export (type-only) |
| `./wgpu-batch.js` | `WgpuRenderBatching` | Re-export (type-only) |
| `./wgpu-texture.js` | `ResolvedSamplerState, WgpuCacheableTexture, WgpuTextureRecord` | Re-export (type-only) |
| `./wgpu-render-target.js` | `WgpuCacheableRenderTarget, WgpuRenderTargetRecord` | Re-export (type-only) |
| `./wgpu-effect.js` | `WgpuEffectKind` | Re-export (type-only) |
| `./wgpu-compute.js` | `ComputeBinding, ComputeBindingAccess, ComputeBufferOptions, ComputePassDescriptor` | Re-export (type-only) |
| `./wgpu-particles.js` | `WgpuParticleRecord` | Re-export (type-only) |
| `./wgpu-stencil.js` | `WgpuStencilSource` | Re-export (type-only) |
| `./wgpu-node-registry.js` | `WgpuNodeFrameState, WgpuNodeItemMaterial, WgpuNodeMaterialPipelineFactory, WgpuNodeMaterialPipelines, WgpuNodePipelineHost` | Re-export (type-only) |
| `./wgpu-node-program.js` | `EmittedWgslNodeShader` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `GPU_BUFFER_USAGE`, `GPU_MAP_MODE`, `GPU_SHADER_STAGE`, `GPU_TEXTURE_USAGE`, `UNIFORM_STRIDE_BYTES`, `hostGpu`, `WebgpuRenderer`, `isWebgpuSupported`, `registerWebgpuRenderer`, `DRAW_COLOR_OFFSET`, `DRAW_MODEL_OFFSET`, `DRAW_UNIFORM_BYTES`, `DRAW_UNIFORM_FLOATS`, `DRAW_UNIFORM_WGSL`, `DRAW_VIEW_PROJECTION_OFFSET`, `MAP_BINDING_WGSL`, `MAP_BIND_GROUP_INDEX`, `MAP_SAMPLER_BINDING`, `MAP_TEXTURE_BINDING`, `createDrawBindGroupLayout`, `createTextureBindGroupLayout`, `WgpuGeometryCache`, `blendStateFor`, `pipelineKey`, `stencilStateFor`, `WgpuPipelineCache`, `WgpuBatching`, `batchVertexBufferLayout`, `createWgpuBatching`, `SPRITE_MODEL_OFFSET`, `SPRITE_QUAD_OFFSET`, `SPRITE_SHADER_SOURCE`, `SPRITE_TINT_OFFSET`, `SPRITE_UNIFORM_BYTES`, `SPRITE_UNIFORM_WGSL`, `SPRITE_VIEW_PROJECTION_OFFSET`, `createSpriteBindGroupLayout`, `MIPMAP_SHADER_SOURCE`, `WgpuTextureCache`, `mipLevelCount`, `samplerKey`, `textureByteLength`, `CLEAR_SHADER_SOURCE`, `CLEAR_VERTEX_COUNT`, `COLOR_BUFFER_LAYOUT`, `COLOR_SHADER_LOCATION`, `FRAGMENT_ENTRY_POINT`, `POSITION_BUFFER_LAYOUT`, `POSITION_SHADER_LOCATION`, `UV_BUFFER_LAYOUT`, `UV_SHADER_LOCATION`, `VERTEX_ENTRY_POINT`, `unlitShaderSource`, `unlitVertexBufferLayouts`, `LIGHTS_BIND_GROUP_INDEX`, `LIGHT_AMBIENT_OFFSET`, `LIGHT_CAMERA_OFFSET`, `LIGHT_COLOR_OFFSET`, `LIGHT_COUNTS_OFFSET`, `LIGHT_DIRECTION_OFFSET`, `LIGHT_PUNCTUAL_COLOR_OFFSET`, `LIGHT_PUNCTUAL_DIRECTION_OFFSET`, `LIGHT_PUNCTUAL_PARAMS_OFFSET`, `LIGHT_PUNCTUAL_POSITION_OFFSET`, `LIGHT_UNIFORM_BYTES`, `LIGHT_UNIFORM_FLOATS`, `LIGHT_UNIFORM_MEMBERS_WGSL`, `LIGHT_UNIFORM_STRIDE_BYTES`, `LIGHT_UNIFORM_STRIDE_FLOATS`, `LIGHT_UNIFORM_WGSL`, `PUNCTUAL_LIGHT_WGSL`, `SHADED_MAP_BINDING_WGSL`, `SHADED_MAP_BIND_GROUP_INDEX`, `createLightsBindGroupLayout`, `writeLightUniforms`, `NORMAL_BUFFER_LAYOUT`, `NORMAL_MATRIX_WGSL`, `NORMAL_SHADER_LOCATION`, `litShaderSource`, `shadedVertexBufferLayouts`, `shadedVertexStageWgsl`, `RENDER_TARGET_COLOR_FORMAT`, `RENDER_TARGET_DEPTH_FORMAT`, `RENDER_TARGET_DEPTH_STENCIL_FORMAT`, `RENDER_TARGET_DEPTH_TEXTURE_FORMAT`, `WgpuRenderTargetCache`, `renderTargetDepthFormat`, `EFFECT_BIND_GROUP_INDEX`, `EFFECT_GRADE_OFFSET`, `EFFECT_PASS_VERTEX_COUNT`, `EFFECT_UNIFORM_BYTES`, `EFFECT_UNIFORM_WGSL`, `createEffectBindGroupLayout`, `effectShaderSource`, `READBACK_ROW_ALIGNMENT`, `readTexturePixels`, `readbackBytesPerRow`, `COMPUTE_ENTRY_POINT`, `PARTICLE_INTEGRATOR_SHADER_SOURCE`, `PARTICLE_INTEGRATOR_WORKGROUP_SIZE`, `PARTICLE_SIMULATION_PARAMS_FLOATS`, `WgpuComputeBuffer`, `WgpuComputeCache`, `createComputeBuffer`, `particleIntegratorWorkgroups`, `readComputeBufferBytes`, `writeComputeBuffer`, `writeParticleSimulationParams`, `PARTICLE_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_INSTANCE_STRIDE_BYTES`, `PARTICLE_MODEL_OFFSET`, `PARTICLE_PROJECTION_OFFSET`, `PARTICLE_SHADER_SOURCE`, `PARTICLE_UNIFORM_BYTES`, `PARTICLE_UNIFORM_WGSL`, `PARTICLE_VERTEX_BUFFER_LAYOUTS`, `PARTICLE_VIEW_OFFSET`, `WgpuParticleCache`, `createParticleBindGroupLayout`, `SHADOW_FACTOR_WGSL`, `SHADOW_LIGHT_UNIFORM_BYTES`, `SHADOW_LIGHT_UNIFORM_WGSL`, `SHADOW_MAP_BINDING`, `SHADOW_MATRIX_OFFSET`, `SHADOW_PARAMS_OFFSET`, `SHADOW_SAMPLER_BINDING`, `SHADOW_SHADER_SOURCE`, `SHADOW_UNIFORM_SPARE_BYTES`, `createShadowLightsBindGroupLayout`, `createShadowSampler`, `writeShadowUniforms`, `CLEAR_STENCIL`, `STENCIL_ALL_BITS`, `applyStencilReference`, `frameWantsStencil`, `stencilDescriptor`, `STANDARD_BASE_COLOR_OFFSET`, `STANDARD_EMISSIVE_OFFSET`, `STANDARD_MODEL_OFFSET`, `STANDARD_SURFACE_OFFSET`, `STANDARD_UNIFORM_BYTES`, `STANDARD_UNIFORM_WGSL`, `STANDARD_VIEW_PROJECTION_OFFSET`, `createStandardBindGroupLayout`, `standardShaderSource`, `clearRegisteredWebgpuNodeMaterialPipeline`, `resolveWebgpuNodeMaterialPipelineFactory`, `setWebgpuNodeMaterialPipelineFactory`, `NODE_SCREEN_BLOCK_BASE_BYTES`, `NODE_SCREEN_TEXTURE_GROUP`, `NODE_SURFACE_BLOCK_BASE_BYTES`, `NODE_SURFACE_BLOCK_GROUP`, `NODE_SURFACE_TEXTURE_GROUP`, `WgpuNodePipelineStore`, `emitShaderGraphWgsl`, `registerWebgpuNodeMaterialPipeline`, `Gpu`, `GpuAdapter`, `GpuStencilFaceState`, `GpuBindGroup`, `GpuBindGroupEntry`, `GpuBindGroupLayout`, `GpuBindGroupLayoutEntry`, `GpuBlendComponent`, `GpuBlendState`, `GpuBuffer`, `GpuBufferDescriptor`, `GpuCanvasContext`, `GpuCommandBuffer`, `GpuCommandEncoder`, `GpuComputePassEncoder`, `GpuComputePipeline`, `GpuComputePipelineDescriptor`, `GpuDevice`, `GpuDeviceLostInfo`, `GpuPipelineLayout`, `GpuQueue`, `GpuRenderPassDescriptor`, `GpuRenderPassEncoder`, `GpuRenderPipeline`, `GpuBufferBinding`, `GpuRenderPipelineDescriptor`, `GpuSampler`, `GpuSamplerDescriptor`, `GpuShaderModule`, `GpuTexture`, `GpuTextureDescriptor`, `GpuTextureView`, `GpuTextureViewDescriptor`, `GpuVertexBufferLayout`, `WebgpuCanvas`, `CacheableGeometry`, `WgpuGeometryRecord`, `WgpuBatchStream`, `WgpuPipelineDescriptor`, `WgpuPipelineKind`, `WgpuStencilDescriptor`, `WgpuRenderBatching`, `ResolvedSamplerState`, `WgpuCacheableTexture`, `WgpuTextureRecord`, `WgpuCacheableRenderTarget`, `WgpuRenderTargetRecord`, `WgpuEffectKind`, `ComputeBinding`, `ComputeBindingAccess`, `ComputeBufferOptions`, `ComputePassDescriptor`, `WgpuParticleRecord`, `WgpuStencilSource`, `WgpuNodeFrameState`, `WgpuNodeItemMaterial`, `WgpuNodeMaterialPipelineFactory`, `WgpuNodeMaterialPipelines`, `WgpuNodePipelineHost`, `EmittedWgslNodeShader`

---

### `packages/render-webgpu/src/register.ts` - This backend's opt-in to §62's renderer registry (R-2, A-8, WP-R1.1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `registerRenderer, RendererOptions, RendererRegistry` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-renderer.js` | `hostGpu` | Import |
| `./webgpu-renderer.js` | `WebgpuRenderer` | Import |

**Exports:**
- Functions: `isWebgpuSupported`, `registerWebgpuRenderer`

---

### `packages/render-webgpu/src/webgpu-device.ts` - The WebGPU surface this backend touches, described structurally (§61, §62).

**Exports:**
- Interfaces: `GpuDeviceLostInfo`, `GpuBuffer`, `GpuTextureViewDescriptor`, `GpuTexture`, `GpuComputePipelineDescriptor`, `GpuComputePassEncoder`, `GpuVertexBufferLayout`, `GpuBlendState`, `GpuBlendComponent`, `GpuRenderPipelineDescriptor`, `GpuStencilFaceState`, `GpuRenderPassDescriptor`, `GpuRenderPassEncoder`, `GpuCommandEncoder`, `GpuQueue`, `GpuSamplerDescriptor`, `GpuBufferDescriptor`, `GpuTextureDescriptor`, `GpuBindGroupLayoutEntry`, `GpuBufferBinding`, `GpuBindGroupEntry`, `GpuDevice`, `GpuAdapter`, `Gpu`, `GpuCanvasContext`, `WebgpuCanvas`
- Types: `GpuTextureView`, `GpuSampler`, `GpuShaderModule`, `GpuBindGroupLayout`, `GpuPipelineLayout`, `GpuBindGroup`, `GpuRenderPipeline`, `GpuComputePipeline`, `GpuCommandBuffer`
- Constants: `GPU_BUFFER_USAGE`, `GPU_MAP_MODE`, `GPU_TEXTURE_USAGE`, `GPU_SHADER_STAGE`, `UNIFORM_STRIDE_BYTES`

---

### `packages/render-webgpu/src/webgpu-renderer.ts` - Draws four.js scenes with WebGPU (§61, §62 backend 1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEV, EventEmitter, FourError, devWarnOnce` |
| `@four/math` | `Frustum, Matrix4` |
| `@four/render` | `COLOR_GRADE_DEFAULTS, RenderTarget, buildInterpolatedRenderList, buildRenderList, buildViewRenderList, collectSceneLights, createSceneLights, isRenderTargetTexture, EffectRenderPass, RenderBatch, RenderInterpolation, RenderItem, RenderStatistics, Renderer, RendererCapabilities, RendererEventMap, RendererOptions` |
| `@four/scene` | `Node, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_TEXTURE_USAGE, UNIFORM_STRIDE_BYTES, Gpu, GpuBindGroup, GpuBindGroupLayout, GpuBuffer, GpuCanvasContext, GpuCommandEncoder, GpuDevice, GpuRenderPassEncoder, GpuSampler, GpuTexture, GpuTextureView, WebgpuCanvas` | Import |
| `./wgpu-bindings.js` | `DRAW_COLOR_OFFSET, DRAW_MODEL_OFFSET, DRAW_UNIFORM_BYTES, DRAW_VIEW_PROJECTION_OFFSET, MAP_BIND_GROUP_INDEX, createDrawBindGroupLayout` | Import |
| `./wgpu-batch.js` | `WgpuRenderBatching` | Import (type-only) |
| `./wgpu-effect.js` | `EFFECT_BIND_GROUP_INDEX, EFFECT_PASS_VERTEX_COUNT, EFFECT_UNIFORM_BYTES, createEffectBindGroupLayout, WgpuEffectKind` | Import |
| `./wgpu-geometry.js` | `WgpuGeometryCache, WgpuGeometryRecord` | Import |
| `./wgpu-lights.js` | `LIGHTS_BIND_GROUP_INDEX, LIGHT_UNIFORM_BYTES, LIGHT_UNIFORM_STRIDE_BYTES, LIGHT_UNIFORM_STRIDE_FLOATS, SHADED_MAP_BIND_GROUP_INDEX, createLightsBindGroupLayout, writeLightUniforms` | Import |
| `./wgpu-compute.js` | `WgpuComputeCache, createComputeBuffer, readComputeBufferBytes, writeComputeBuffer, ComputeBufferOptions, ComputePassDescriptor, WgpuComputeBuffer` | Import |
| `./wgpu-particles.js` | `PARTICLE_MODEL_OFFSET, PARTICLE_PROJECTION_OFFSET, PARTICLE_UNIFORM_BYTES, PARTICLE_VIEW_OFFSET, WgpuParticleCache, createParticleBindGroupLayout, WgpuParticleRecord` | Import |
| `./wgpu-pipeline-cache.js` | `WgpuPipelineCache, WgpuPipelineDescriptor, WgpuStencilDescriptor` | Import |
| `./wgpu-readback.js` | `readTexturePixels` | Import |
| `./wgpu-render-target.js` | `RENDER_TARGET_COLOR_FORMAT, WgpuRenderTargetCache, WgpuRenderTargetRecord` | Import |
| `./wgpu-standard.js` | `STANDARD_EMISSIVE_OFFSET, STANDARD_SURFACE_OFFSET, STANDARD_UNIFORM_BYTES, createStandardBindGroupLayout` | Import |
| `./wgpu-sprite.js` | `SPRITE_QUAD_OFFSET, SPRITE_UNIFORM_BYTES, createSpriteBindGroupLayout` | Import |
| `./wgpu-shadow.js` | `SHADOW_LIGHT_UNIFORM_BYTES, SHADOW_MAP_BINDING, SHADOW_SAMPLER_BINDING, createShadowLightsBindGroupLayout, createShadowSampler, writeShadowUniforms` | Import |
| `./wgpu-stencil.js` | `CLEAR_STENCIL, applyStencilReference, frameWantsStencil, stencilDescriptor` | Import |
| `./wgpu-texture.js` | `WgpuTextureCache, WgpuCacheableTexture` | Import |
| `./wgpu-node-registry.js` | `resolveWebgpuNodeMaterialPipelineFactory, WgpuNodeFrameState, WgpuNodeMaterialPipelines` | Import |
| `./wgpu-unlit.js` | `CLEAR_VERTEX_COUNT` | Import |

**Exports:**
- Classes: `WebgpuRenderer`
- Functions: `hostGpu`

---

### `packages/render-webgpu/src/wgpu-batch.ts` - §65 batching for the WebGPU backend — the GPU half of `@four/render`'s

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `RenderBatcher, RenderBatch, RenderBatchOptions, RenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GpuBuffer, GpuDevice, GpuRenderPassEncoder, GpuVertexBufferLayout` | Import |
| `./wgpu-unlit.js` | `COLOR_SHADER_LOCATION, POSITION_SHADER_LOCATION, UV_SHADER_LOCATION` | Import |

**Exports:**
- Classes: `WgpuBatching`
- Interfaces: `WgpuRenderBatching`
- Functions: `batchVertexBufferLayout`, `createWgpuBatching`

---

### `packages/render-webgpu/src/wgpu-bindings.ts` - This backend's binding layout, **declared as data** (§7 of the R-1 plan).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |

**Exports:**
- Functions: `createDrawBindGroupLayout`, `createTextureBindGroupLayout`
- Constants: `DRAW_VIEW_PROJECTION_OFFSET`, `DRAW_MODEL_OFFSET`, `DRAW_COLOR_OFFSET`, `DRAW_UNIFORM_BYTES`, `DRAW_UNIFORM_FLOATS`, `DRAW_UNIFORM_WGSL`, `MAP_BIND_GROUP_INDEX`, `MAP_TEXTURE_BINDING`, `MAP_SAMPLER_BINDING`, `MAP_BINDING_WGSL`

---

### `packages/render-webgpu/src/wgpu-compute.ts` - §82's GPU compute on the WebGPU backend (WP-R1.8) — compute pipelines, bind

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_MAP_MODE, GPU_SHADER_STAGE, GpuBindGroupLayout, GpuComputePipeline, GpuDevice, GpuPipelineLayout, GpuShaderModule, GpuBuffer` | Import |

**Exports:**
- Classes: `WgpuComputeBuffer`, `WgpuComputeCache`
- Interfaces: `ComputeBinding`, `ComputePassDescriptor`, `ComputeBufferOptions`
- Types: `ComputeBindingAccess`
- Functions: `createComputeBuffer`, `writeComputeBuffer`, `readComputeBufferBytes`, `writeParticleSimulationParams`, `particleIntegratorWorkgroups`
- Constants: `COMPUTE_ENTRY_POINT`, `PARTICLE_INTEGRATOR_WORKGROUP_SIZE`, `PARTICLE_SIMULATION_PARAMS_FLOATS`, `PARTICLE_INTEGRATOR_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-effect.ts` - §70's full-screen effects in hand-written WGSL — the blit, the colour grade,

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Types: `WgpuEffectKind`
- Functions: `createEffectBindGroupLayout`, `effectShaderSource`
- Constants: `EFFECT_PASS_VERTEX_COUNT`, `EFFECT_GRADE_OFFSET`, `EFFECT_UNIFORM_BYTES`, `EFFECT_BIND_GROUP_INDEX`, `EFFECT_UNIFORM_WGSL`

---

### `packages/render-webgpu/src/wgpu-geometry.ts` - Per-device store of uploaded geometry (§61, §64 stage 7) — the WebGPU twin of

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `RenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GpuBuffer, GpuDevice` | Import |

**Exports:**
- Classes: `WgpuGeometryCache`
- Interfaces: `WgpuGeometryRecord`
- Types: `CacheableGeometry`

---

### `packages/render-webgpu/src/wgpu-lights.ts` - The frame's lighting as **one uniform buffer** (§68, WP-R1.5), plus the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `MAX_PUNCTUAL_LIGHTS, SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING` | Import |

**Exports:**
- Functions: `createLightsBindGroupLayout`, `writeLightUniforms`
- Constants: `LIGHTS_BIND_GROUP_INDEX`, `SHADED_MAP_BIND_GROUP_INDEX`, `LIGHT_AMBIENT_OFFSET`, `LIGHT_DIRECTION_OFFSET`, `LIGHT_COLOR_OFFSET`, `LIGHT_CAMERA_OFFSET`, `LIGHT_COUNTS_OFFSET`, `LIGHT_PUNCTUAL_POSITION_OFFSET`, `LIGHT_PUNCTUAL_COLOR_OFFSET`, `LIGHT_PUNCTUAL_DIRECTION_OFFSET`, `LIGHT_PUNCTUAL_PARAMS_OFFSET`, `LIGHT_UNIFORM_BYTES`, `LIGHT_UNIFORM_FLOATS`, `LIGHT_UNIFORM_STRIDE_BYTES`, `LIGHT_UNIFORM_STRIDE_FLOATS`, `LIGHT_UNIFORM_MEMBERS_WGSL`, `LIGHT_UNIFORM_WGSL`, `PUNCTUAL_LIGHT_WGSL`, `SHADED_MAP_BINDING_WGSL`

---

### `packages/render-webgpu/src/wgpu-lit.ts` - The Lambert-lit pipeline in hand-written WGSL (§57 `LitMaterial`, §68,

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./wgpu-bindings.js` | `DRAW_UNIFORM_WGSL` | Import |
| `./webgpu-device.js` | `GpuVertexBufferLayout` | Import (type-only) |
| `./wgpu-lights.js` | `LIGHT_UNIFORM_WGSL, PUNCTUAL_LIGHT_WGSL, SHADED_MAP_BINDING_WGSL` | Import |
| `./wgpu-shadow.js` | `SHADOW_FACTOR_WGSL, SHADOW_LIGHT_UNIFORM_WGSL` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, POSITION_SHADER_LOCATION, UV_BUFFER_LAYOUT, UV_SHADER_LOCATION, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Functions: `shadedVertexBufferLayouts`, `shadedVertexStageWgsl`, `litShaderSource`
- Constants: `NORMAL_SHADER_LOCATION`, `NORMAL_BUFFER_LAYOUT`, `NORMAL_MATRIX_WGSL`

---

### `packages/render-webgpu/src/wgpu-node-program.ts` - The node-material pipeline for WebGPU (§60, §62; RFC 0001 — WP-R1.9): a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `DEV, devWarnOnce, Disposable` |
| `@four/render` | `SHADER_VALUE_COMPONENTS, analyzeShaderGraph, isRenderTargetTexture, GraphEffect, NodeRenderItem, RenderItem, RenderStatistics, ShaderAttributeName, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderUniformReflection, ShaderValueType` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GpuBindGroup, GpuBindGroupEntry, GpuBindGroupLayout, GpuBuffer, GpuPipelineLayout, GpuRenderPassEncoder, GpuRenderPipeline, GpuShaderModule, GpuTextureView, GpuVertexBufferLayout` | Import |
| `./wgpu-effect.js` | `EFFECT_PASS_VERTEX_COUNT` | Import |
| `./wgpu-lit.js` | `NORMAL_BUFFER_LAYOUT` | Import |
| `./wgpu-pipeline-cache.js` | `blendStateFor, stencilStateFor, WgpuStencilDescriptor` | Import |
| `./wgpu-node-registry.js` | `setWebgpuNodeMaterialPipelineFactory, WgpuNodeFrameState, WgpuNodeItemMaterial, WgpuNodeMaterialPipelines, WgpuNodePipelineHost` | Import |
| `./wgpu-render-target.js` | `WgpuCacheableRenderTarget, WgpuRenderTargetCache` | Import (type-only) |
| `./wgpu-stencil.js` | `applyStencilReference, stencilDescriptor` | Import |
| `./wgpu-unlit.js` | `COLOR_BUFFER_LAYOUT, FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, UV_BUFFER_LAYOUT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Classes: `WgpuNodePipelineStore`
- Interfaces: `EmittedWgslNodeShader`
- Functions: `emitShaderGraphWgsl`, `registerWebgpuNodeMaterialPipeline`
- Constants: `NODE_SURFACE_BLOCK_BASE_BYTES`, `NODE_SCREEN_BLOCK_BASE_BYTES`, `NODE_SURFACE_BLOCK_GROUP`, `NODE_SURFACE_TEXTURE_GROUP`, `NODE_SCREEN_TEXTURE_GROUP`

---

### `packages/render-webgpu/src/wgpu-node-registry.ts` - The WebGPU node-material pipeline's registration slot (§60, §62; RFC 0001;

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix4` |
| `@four/render` | `GraphEffect, NodeRenderItem, RenderItem, RenderStatistics` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuDevice, GpuRenderPassEncoder, GpuTextureView` | Import (type-only) |
| `./wgpu-geometry.js` | `WgpuGeometryCache` | Import (type-only) |
| `./wgpu-render-target.js` | `WgpuCacheableRenderTarget, WgpuRenderTargetCache` | Import (type-only) |
| `./wgpu-texture.js` | `WgpuTextureCache` | Import (type-only) |

**Exports:**
- Interfaces: `WgpuNodePipelineHost`, `WgpuNodeFrameState`, `WgpuNodeMaterialPipelines`, `WgpuNodeMaterialPipelineFactory`
- Types: `WgpuNodeItemMaterial`
- Functions: `setWebgpuNodeMaterialPipelineFactory`, `resolveWebgpuNodeMaterialPipelineFactory`, `clearRegisteredWebgpuNodeMaterialPipeline`

---

### `packages/render-webgpu/src/wgpu-particles.ts` - The batched particle pipeline for the WebGPU backend (§36, §64 stage 6,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `PARTICLE_COLOR_OFFSET, PARTICLE_INSTANCE_FLOATS, PARTICLE_POSITION_OFFSET, PARTICLE_SIZE_OFFSET, ParticleRenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GpuBindGroupLayout, GpuBuffer, GpuDevice, GpuVertexBufferLayout` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Classes: `WgpuParticleCache`
- Interfaces: `WgpuParticleRecord`
- Functions: `createParticleBindGroupLayout`
- Constants: `PARTICLE_PROJECTION_OFFSET`, `PARTICLE_VIEW_OFFSET`, `PARTICLE_MODEL_OFFSET`, `PARTICLE_UNIFORM_BYTES`, `PARTICLE_INSTANCE_STRIDE_BYTES`, `PARTICLE_UNIFORM_WGSL`, `PARTICLE_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_VERTEX_BUFFER_LAYOUTS`, `PARTICLE_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-pipeline-cache.ts` - The lazy, descriptor-keyed render-pipeline cache (§4.2 of the R-1 plan).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `RenderItemStencil` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuBindGroupLayout, GpuBlendState, GpuDevice, GpuPipelineLayout, GpuRenderPipeline, GpuShaderModule, GpuStencilFaceState, GpuVertexBufferLayout` | Import |
| `./wgpu-batch.js` | `batchVertexBufferLayout` | Import |
| `./wgpu-effect.js` | `effectShaderSource, WgpuEffectKind` | Import |
| `./wgpu-lit.js` | `litShaderSource, shadedVertexBufferLayouts` | Import |
| `./wgpu-particles.js` | `PARTICLE_SHADER_SOURCE, PARTICLE_VERTEX_BUFFER_LAYOUTS` | Import |
| `./wgpu-shadow.js` | `SHADOW_SHADER_SOURCE` | Import |
| `./wgpu-sprite.js` | `SPRITE_SHADER_SOURCE` | Import |
| `./wgpu-standard.js` | `standardShaderSource` | Import |
| `./wgpu-unlit.js` | `CLEAR_SHADER_SOURCE, FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, VERTEX_ENTRY_POINT, unlitShaderSource, unlitVertexBufferLayouts` | Import |

**Exports:**
- Classes: `WgpuPipelineCache`
- Interfaces: `WgpuStencilDescriptor`, `WgpuBatchStream`, `WgpuPipelineDescriptor`
- Types: `WgpuPipelineKind`
- Functions: `blendStateFor`, `pipelineKey`, `stencilStateFor`

---

### `packages/render-webgpu/src/wgpu-readback.ts` - `readPixels`' mechanism: `copyTextureToBuffer` + `mapAsync` (WP-R1.6; §61,

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_MAP_MODE, GpuDevice, GpuTexture` | Import |

**Exports:**
- Functions: `readbackBytesPerRow`, `readTexturePixels`
- Constants: `READBACK_ROW_ALIGNMENT`

---

### `packages/render-webgpu/src/wgpu-render-target.ts` - GPU-side render targets for the WebGPU backend: one colour (and optional

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `RenderTarget` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_TEXTURE_USAGE, GpuBindGroup, GpuBindGroupLayout, GpuDevice, GpuSampler, GpuTexture, GpuTextureView` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING` | Import |

**Exports:**
- Classes: `WgpuRenderTargetCache`
- Interfaces: `WgpuRenderTargetRecord`
- Types: `WgpuCacheableRenderTarget`
- Functions: `renderTargetDepthFormat`
- Constants: `RENDER_TARGET_COLOR_FORMAT`, `RENDER_TARGET_DEPTH_FORMAT`, `RENDER_TARGET_DEPTH_TEXTURE_FORMAT`, `RENDER_TARGET_DEPTH_STENCIL_FORMAT`

---

### `packages/render-webgpu/src/wgpu-shadow.ts` - §69's shadow tier on WebGPU (WP-R1.7): the depth-only caster module, the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice, GpuSampler` | Import |
| `./wgpu-bindings.js` | `DRAW_UNIFORM_WGSL` | Import |
| `./wgpu-lights.js` | `LIGHTS_BIND_GROUP_INDEX, LIGHT_UNIFORM_BYTES, LIGHT_UNIFORM_MEMBERS_WGSL, LIGHT_UNIFORM_STRIDE_BYTES` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_SHADER_LOCATION, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Functions: `createShadowLightsBindGroupLayout`, `createShadowSampler`, `writeShadowUniforms`
- Constants: `SHADOW_MATRIX_OFFSET`, `SHADOW_PARAMS_OFFSET`, `SHADOW_LIGHT_UNIFORM_BYTES`, `SHADOW_MAP_BINDING`, `SHADOW_SAMPLER_BINDING`, `SHADOW_LIGHT_UNIFORM_WGSL`, `SHADOW_FACTOR_WGSL`, `SHADOW_SHADER_SOURCE`, `SHADOW_UNIFORM_SPARE_BYTES`

---

### `packages/render-webgpu/src/wgpu-sprite.ts` - The sprite pipeline in hand-written WGSL (§55, WP-R1.3), plus the widened

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-bindings.js` | `MAP_BINDING_WGSL` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Functions: `createSpriteBindGroupLayout`
- Constants: `SPRITE_VIEW_PROJECTION_OFFSET`, `SPRITE_MODEL_OFFSET`, `SPRITE_TINT_OFFSET`, `SPRITE_QUAD_OFFSET`, `SPRITE_UNIFORM_BYTES`, `SPRITE_UNIFORM_WGSL`, `SPRITE_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-standard.ts` - The metallic-roughness pipeline in hand-written WGSL (§57

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-lights.js` | `LIGHT_UNIFORM_WGSL, PUNCTUAL_LIGHT_WGSL, SHADED_MAP_BINDING_WGSL` | Import |
| `./wgpu-lit.js` | `shadedVertexStageWgsl` | Import |
| `./wgpu-shadow.js` | `SHADOW_FACTOR_WGSL, SHADOW_LIGHT_UNIFORM_WGSL` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT` | Import |

**Exports:**
- Functions: `createStandardBindGroupLayout`, `standardShaderSource`
- Constants: `STANDARD_VIEW_PROJECTION_OFFSET`, `STANDARD_MODEL_OFFSET`, `STANDARD_BASE_COLOR_OFFSET`, `STANDARD_EMISSIVE_OFFSET`, `STANDARD_SURFACE_OFFSET`, `STANDARD_UNIFORM_BYTES`, `STANDARD_UNIFORM_WGSL`

---

### `packages/render-webgpu/src/wgpu-stencil.ts` - §57/§67 stencil parity for the WebGPU backend (WP-R1.7) — the per-frame

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `RenderItem, RenderItemStencil` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuRenderPassEncoder` | Import (type-only) |
| `./wgpu-pipeline-cache.js` | `WgpuStencilDescriptor` | Import (type-only) |

**Exports:**
- Types: `WgpuStencilSource`
- Functions: `stencilDescriptor`, `applyStencilReference`, `frameWantsStencil`
- Constants: `STENCIL_ALL_BITS`, `CLEAR_STENCIL`

---

### `packages/render-webgpu/src/wgpu-texture.ts` - GPU-side textures and samplers for the WebGPU backend: one `GPUTexture` per

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/render` | `RenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_TEXTURE_USAGE, GpuBindGroup, GpuBindGroupLayout, GpuDevice, GpuPipelineLayout, GpuRenderPipeline, GpuSampler, GpuShaderModule, GpuTexture, GpuTextureView` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING, createTextureBindGroupLayout` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Classes: `WgpuTextureCache`
- Interfaces: `ResolvedSamplerState`, `WgpuTextureRecord`
- Types: `WgpuCacheableTexture`
- Functions: `mipLevelCount`, `textureByteLength`, `samplerKey`
- Constants: `MIPMAP_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-unlit.ts` - The unlit pipeline in hand-written WGSL (§64, §120's MVP tier), plus the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./wgpu-bindings.js` | `DRAW_UNIFORM_WGSL, MAP_BINDING_WGSL` | Import |
| `./webgpu-device.js` | `GpuVertexBufferLayout` | Import (type-only) |

**Exports:**
- Functions: `unlitVertexBufferLayouts`, `unlitShaderSource`
- Constants: `POSITION_SHADER_LOCATION`, `COLOR_SHADER_LOCATION`, `POSITION_BUFFER_LAYOUT`, `COLOR_BUFFER_LAYOUT`, `UV_SHADER_LOCATION`, `UV_BUFFER_LAYOUT`, `VERTEX_ENTRY_POINT`, `FRAGMENT_ENTRY_POINT`, `CLEAR_VERTEX_COUNT`, `CLEAR_SHADER_SOURCE`

---

<a id="packages-scene-dependencies"></a>

## Packages/scene Dependencies

### `packages/scene/src/authority.ts` - Transform authority (§42).

**Exports:**
- Interfaces: `AuthorityNode`
- Types: `TransformAuthority`
- Functions: `warnAuthorityConflict`
- Constants: `TRANSFORM_AUTHORITIES`, `DEFAULT_TRANSFORM_AUTHORITY`

---

### `packages/scene/src/camera.ts` - Cameras (§47).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix4, DepthRange` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./layers.js` | `ALL_LAYERS, LayerMask` | Import |
| `./node.js` | `Node` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Classes: `PerspectiveCamera`, `OrthographicCamera`
- Interfaces: `PerspectiveCameraOptions`, `OrthographicCameraOptions`

---

### `packages/scene/src/group.ts` - `Group` (§6, §104) — a concrete {@link Node} with no behavior of its own.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import |

**Exports:**
- Classes: `Group`

---

### `packages/scene/src/index.ts` - Package entry point for @four/scene (re-exports 78 symbols)

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./authority.js` | `DEFAULT_TRANSFORM_AUTHORITY, TRANSFORM_AUTHORITIES, warnAuthorityConflict` | Re-export |
| `./camera.js` | `Camera, OrthographicCamera, PerspectiveCamera` | Re-export |
| `./screen-camera.js` | `DEFAULT_SCREEN_FAR, DEFAULT_SCREEN_NEAR, DEFAULT_SCREEN_ORIGIN, DEFAULT_SCREEN_UNITS, SCREEN_ORIGINS, SCREEN_UNITS, ScreenCamera` | Re-export |
| `./trackball.js` | `DEFAULT_TRACKBALL_RADIUS, TrackballRig` | Re-export |
| `./group.js` | `Group` | Re-export |
| `./layers.js` | `ALL_LAYERS, DEFAULT_LAYER, DEFAULT_LAYER_MASK, DEFAULT_LAYER_NAME, LAYER_COUNT, NO_LAYERS, applyLayers, assertLayerMask, defineLayer, isLayerMask, layerIndex, layerMask, layerMaskNames, layerName, layerNames, layersMatch, resetLayers` | Re-export |
| `./light.js` | `DirectionalLight, DirectionalLightShadow, PointLight, PunctualLight, SpotLight` | Re-export |
| `./interpolation.js` | `POSE_SNAPSHOT_PRIORITY, PoseBuffer, createSnapshotSystem` | Re-export |
| `./node.js` | `Node, restoreNodeId` | Re-export |
| `./pose-target.js` | `PoseTarget` | Re-export |
| `./skeleton.js` | `Bone, MORPH_WEIGHTS_SERIALIZER, MorphWeights, Skeleton` | Re-export |
| `./scene.js` | `Scene` | Re-export |
| `./transform.js` | `Transform` | Re-export |
| `./viewport.js` | `createFullscreenViewport` | Re-export |
| `./world-transforms.js` | `resolveWorldTransform, resolveWorldTransforms` | Re-export |
| `./authority.js` | `AuthorityNode, TransformAuthority` | Re-export (type-only) |
| `./camera.js` | `OrthographicCameraOptions, PerspectiveCameraOptions` | Re-export (type-only) |
| `./screen-camera.js` | `ScreenCameraOptions, ScreenOrigin, ScreenUnits, SurfaceSizedCamera` | Re-export (type-only) |
| `./trackball.js` | `TrackballRigOptions` | Re-export (type-only) |
| `./layers.js` | `LayerMask, LayeredNode` | Re-export (type-only) |
| `./light.js` | `ColorRGB, DirectionalLightOptions, DirectionalLightShadowOptions, PunctualLightOptions, SpotLightOptions` | Re-export (type-only) |
| `./interpolation.js` | `PoseSnapshotSystem, SnapshotSystemOptions` | Re-export (type-only) |
| `./node.js` | `NodeEventMap, NodeHierarchyEvent, NodeOptions, NodeType` | Re-export (type-only) |
| `./skeleton.js` | `MorphWeightsSerializerShape` | Re-export (type-only) |
| `./viewport.js` | `Viewport` | Re-export (type-only) |
| `./world-transforms.js` | `WorldTransformStats` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_TRANSFORM_AUTHORITY`, `TRANSFORM_AUTHORITIES`, `warnAuthorityConflict`, `Camera`, `OrthographicCamera`, `PerspectiveCamera`, `DEFAULT_SCREEN_FAR`, `DEFAULT_SCREEN_NEAR`, `DEFAULT_SCREEN_ORIGIN`, `DEFAULT_SCREEN_UNITS`, `SCREEN_ORIGINS`, `SCREEN_UNITS`, `ScreenCamera`, `DEFAULT_TRACKBALL_RADIUS`, `TrackballRig`, `Group`, `ALL_LAYERS`, `DEFAULT_LAYER`, `DEFAULT_LAYER_MASK`, `DEFAULT_LAYER_NAME`, `LAYER_COUNT`, `NO_LAYERS`, `applyLayers`, `assertLayerMask`, `defineLayer`, `isLayerMask`, `layerIndex`, `layerMask`, `layerMaskNames`, `layerName`, `layerNames`, `layersMatch`, `resetLayers`, `DirectionalLight`, `DirectionalLightShadow`, `PointLight`, `PunctualLight`, `SpotLight`, `POSE_SNAPSHOT_PRIORITY`, `PoseBuffer`, `createSnapshotSystem`, `Node`, `restoreNodeId`, `PoseTarget`, `Bone`, `MORPH_WEIGHTS_SERIALIZER`, `MorphWeights`, `Skeleton`, `Scene`, `Transform`, `createFullscreenViewport`, `resolveWorldTransform`, `resolveWorldTransforms`, `AuthorityNode`, `TransformAuthority`, `OrthographicCameraOptions`, `PerspectiveCameraOptions`, `ScreenCameraOptions`, `ScreenOrigin`, `ScreenUnits`, `SurfaceSizedCamera`, `TrackballRigOptions`, `LayerMask`, `LayeredNode`, `ColorRGB`, `DirectionalLightOptions`, `DirectionalLightShadowOptions`, `PunctualLightOptions`, `SpotLightOptions`, `PoseSnapshotSystem`, `SnapshotSystemOptions`, `NodeEventMap`, `NodeHierarchyEvent`, `NodeOptions`, `NodeType`, `MorphWeightsSerializerShape`, `Viewport`, `WorldTransformStats`

---

### `packages/scene/src/interpolation.ts` - Previous/current pose storage and render interpolation (§43).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import (type-only) |

**Exports:**
- Classes: `PoseBuffer`
- Interfaces: `SnapshotSystemOptions`, `PoseSnapshotSystem`
- Functions: `createSnapshotSystem`
- Constants: `POSE_SNAPSHOT_PRIORITY`

---

### `packages/scene/src/layers.ts` - Symbolic layers and their compiled masks (§46).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Exports:**
- Interfaces: `LayeredNode`
- Types: `LayerMask`
- Functions: `defineLayer`, `layerIndex`, `layerName`, `layerNames`, `layerMask`, `layerMaskNames`, `layersMatch`, `isLayerMask`, `assertLayerMask`, `applyLayers`, `resetLayers`
- Constants: `LAYER_COUNT`, `DEFAULT_LAYER_NAME`, `DEFAULT_LAYER`, `DEFAULT_LAYER_MASK`, `ALL_LAYERS`, `NO_LAYERS`

---

### `packages/scene/src/light.ts` - Lights (§68) — the multi-light tier: directional, point, and spot nodes.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix4` |
| `@four/math` | `ColorRGB, Vector3` |
| `@four/math` | `ColorRGB` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Classes: `DirectionalLightShadow`, `DirectionalLight`, `PointLight`, `SpotLight`
- Interfaces: `DirectionalLightShadowOptions`, `DirectionalLightOptions`, `PunctualLightOptions`, `SpotLightOptions`
- Re-exports: `ColorRGB`

---

### `packages/scene/src/node.ts` - The unified node model (§6), its component delegation (§6a), and its event

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `ComponentRegistry, EventEmitter, FourError, Component, ComponentHost, ComponentType` |
| `@four/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./authority.js` | `DEFAULT_TRANSFORM_AUTHORITY, TransformAuthority` | Import |
| `./layers.js` | `DEFAULT_LAYER_MASK, LayerMask` | Import |
| `./transform.js` | `Transform` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Interfaces: `NodeHierarchyEvent`, `NodeEventMap`, `NodeOptions`
- Types: `NodeType`
- Functions: `restoreNodeId`

---

### `packages/scene/src/pose-target.ts` - The `PoseTarget` component (§6a, §19, §42) — the pose animation *asks* for,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Component, ComponentHost` |
| `@four/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./transform.js` | `Transform` | Import (type-only) |

**Exports:**
- Classes: `PoseTarget`

---

### `packages/scene/src/scene.ts` - `Scene` (§6, §46, §104) — the root node, plus the indexed lookups of §46.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Component, ComponentType` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./light.js` | `ColorRGB` | Import (type-only) |
| `./node.js` | `Node, NodeType` | Import |

**Exports:**
- Classes: `Scene`

---

### `packages/scene/src/screen-camera.ts` - §47's `ScreenCamera` — the pixel-rectangle camera (R-37, 2026-08-21).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |
| `@four/math` | `DepthRange` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera.js` | `Camera` | Import |

**Exports:**
- Classes: `ScreenCamera`
- Interfaces: `SurfaceSizedCamera`, `ScreenCameraOptions`
- Types: `ScreenOrigin`, `ScreenUnits`
- Constants: `SCREEN_ORIGINS`, `SCREEN_UNITS`, `DEFAULT_SCREEN_ORIGIN`, `DEFAULT_SCREEN_UNITS`, `DEFAULT_SCREEN_NEAR`, `DEFAULT_SCREEN_FAR`

---

### `packages/scene/src/skeleton.ts` - Bones, skeletons, and morph weights (§54, §14, §17; RFC 0003 — gaps PH-10 +

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError, Component, ComponentHost, JsonValue` |
| `@four/math` | `Matrix4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Classes: `Bone`, `Skeleton`, `MorphWeights`
- Interfaces: `MorphWeightsSerializerShape`
- Constants: `MORPH_WEIGHTS_SERIALIZER`

---

### `packages/scene/src/trackball.ts` - §44/§47's **trackball** rig (R-37, 2026-08-21) — the last of the seven camera

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./authority.js` | `warnAuthorityConflict` | Import |
| `./node.js` | `Node` | Import (type-only) |
| `./screen-camera.js` | `DEFAULT_SCREEN_ORIGIN, ScreenOrigin` | Import |

**Exports:**
- Classes: `TrackballRig`
- Interfaces: `TrackballRigOptions`
- Constants: `DEFAULT_TRACKBALL_RADIUS`

---

### `packages/scene/src/transform.ts` - Local/world transform of a scene node (§7).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix4, Quaternion, Vector3` |

**Exports:**
- Classes: `Transform`

---

### `packages/scene/src/viewport.ts` - Viewports (§48).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera.js` | `Camera` | Import (type-only) |
| `./layers.js` | `LayerMask` | Import (type-only) |

**Exports:**
- Interfaces: `Viewport`
- Functions: `createFullscreenViewport`

---

### `packages/scene/src/world-transforms.ts` - World-transform resolution (§7) — the single writer of every

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Matrix4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import (type-only) |
| `./transform.js` | `Transform` | Import (type-only) |

**Exports:**
- Interfaces: `WorldTransformStats`
- Functions: `resolveWorldTransforms`, `resolveWorldTransform`

---

<a id="packages-serialization-dependencies"></a>

## Packages/serialization Dependencies

### `packages/serialization/src/format.ts` - The §79 scene document — its types, its JSON encoding, and its canonical

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError, cloneJsonValue, parseUntrustedJson, JsonValue, UntrustedJsonLimits` |
| `@four/scene` | `DEFAULT_TRANSFORM_AUTHORITY, TRANSFORM_AUTHORITIES, TransformAuthority` |
| `@four/core` | `cloneJsonValue` |
| `@four/core` | `JsonValue` |
| `@four/core` | `UntrustedJsonLimits` |

**Exports:**
- Interfaces: `Vector3Document`, `QuaternionDocument`, `TransformDocument`, `ComponentDocument`, `SceneNodeDocument`, `SceneDocument`
- Types: `JsonObject`
- Functions: `validateVector3Document`, `validateQuaternionDocument`, `isJsonArray`, `isJsonObject`, `asJsonObject`, `validateSceneDocument`, `encodeSceneDocument`, `decodeSceneDocument`
- Constants: `SCENE_FORMAT_VERSION`
- Re-exports: `cloneJsonValue`, `JsonValue`, `UntrustedJsonLimits`

---

### `packages/serialization/src/index.ts` - `@four/serialization` — the §79 scene document and its §80 migrations.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./format.js` | `SCENE_FORMAT_VERSION, asJsonObject, cloneJsonValue, decodeSceneDocument, encodeSceneDocument, isJsonArray, isJsonObject, validateQuaternionDocument, validateSceneDocument, validateVector3Document` | Re-export |
| `./migration.js` | `SceneMigrationRegistry, migrateSceneDocument, runSceneMigrations` | Re-export |
| `./serializer.js` | `ComponentSerializerRegistry, GROUP_NODE_TYPE, POSE_TARGET_SERIALIZER, SCENE_NODE_TYPE, applyTransformDocument, createDefaultComponentSerializers, instantiateScene, instantiateSceneNodes, serializeScene` | Re-export |
| `./format.js` | `ComponentDocument, JsonObject, JsonValue, QuaternionDocument, SceneDocument, SceneNodeDocument, TransformDocument, UntrustedJsonLimits, Vector3Document` | Re-export (type-only) |
| `./migration.js` | `MigrateSceneDocumentOptions, SceneMigration, SceneMigrationContext, SceneMigrationWarning` | Re-export (type-only) |
| `./serializer.js` | `ComponentSerializer, InstantiateSceneOptions, SerializeSceneOptions, UnknownComponentPolicy` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `SCENE_FORMAT_VERSION`, `asJsonObject`, `cloneJsonValue`, `decodeSceneDocument`, `encodeSceneDocument`, `isJsonArray`, `isJsonObject`, `validateQuaternionDocument`, `validateSceneDocument`, `validateVector3Document`, `SceneMigrationRegistry`, `migrateSceneDocument`, `runSceneMigrations`, `ComponentSerializerRegistry`, `GROUP_NODE_TYPE`, `POSE_TARGET_SERIALIZER`, `SCENE_NODE_TYPE`, `applyTransformDocument`, `createDefaultComponentSerializers`, `instantiateScene`, `instantiateSceneNodes`, `serializeScene`, `ComponentDocument`, `JsonObject`, `JsonValue`, `QuaternionDocument`, `SceneDocument`, `SceneNodeDocument`, `TransformDocument`, `UntrustedJsonLimits`, `Vector3Document`, `MigrateSceneDocumentOptions`, `SceneMigration`, `SceneMigrationContext`, `SceneMigrationWarning`, `ComponentSerializer`, `InstantiateSceneOptions`, `SerializeSceneOptions`, `UnknownComponentPolicy`

---

### `packages/serialization/src/migration.ts` - Scene migration (§80) — the registry of upgrade steps and the chain runner

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./format.js` | `SCENE_FORMAT_VERSION, asJsonObject, validateSceneDocument, JsonObject, SceneDocument` | Import |

**Exports:**
- Classes: `SceneMigrationRegistry`
- Interfaces: `SceneMigrationContext`, `SceneMigrationWarning`, `MigrateSceneDocumentOptions`
- Types: `SceneMigration`
- Functions: `runSceneMigrations`, `migrateSceneDocument`

---

### `packages/serialization/src/serializer.ts` - Scene ⇄ document (§79) — the component-serializer registry, the writer, and

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `FourError, Component, ComponentType` |
| `@four/math` | `Quaternion, Vector3` |
| `@four/scene` | `Group, Node, PoseTarget, Scene, restoreNodeId, Transform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./format.js` | `SCENE_FORMAT_VERSION, asJsonObject, isJsonArray, isJsonObject, validateQuaternionDocument, validateSceneDocument, validateVector3Document, ComponentDocument, JsonObject, JsonValue, SceneDocument, SceneNodeDocument, TransformDocument` | Import |

**Exports:**
- Classes: `ComponentSerializerRegistry`
- Interfaces: `ComponentSerializer`, `SerializeSceneOptions`, `InstantiateSceneOptions`
- Types: `UnknownComponentPolicy`
- Functions: `createDefaultComponentSerializers`, `applyTransformDocument`, `serializeScene`, `instantiateSceneNodes`, `instantiateScene`
- Constants: `SCENE_NODE_TYPE`, `GROUP_NODE_TYPE`, `POSE_TARGET_SERIALIZER`

---

<a id="packages-text-dependencies"></a>

## Packages/text Dependencies

### `packages/text/src/bitmap-font.ts` - A built-in, dependency-free monospace bitmap font (§56 MVP tier).

**Exports:**
- Interfaces: `BitmapGlyph`, `BitmapFont`, `BitmapFontOptions`
- Functions: `createBitmapFont`, `glyphFor`, `glyphPixel`, `glyphToAscii`
- Constants: `BUILTIN_FONT`

---

### `packages/text/src/glyph-atlas.ts` - `buildGlyphAtlas` (§56 MVP tier) — every glyph of a {@link BitmapFont} packed

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./bitmap-font.js` | `BitmapFont, BitmapGlyph` | Import (type-only) |
| `./bitmap-font.js` | `BUILTIN_FONT, glyphPixel` | Import |

**Exports:**
- Interfaces: `GlyphAtlasEntry`, `GlyphAtlas`, `GlyphAtlasOptions`
- Functions: `buildGlyphAtlas`

---

### `packages/text/src/index.ts` - `@four/text` — bitmap text at §56's MVP tier.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./bitmap-font.js` | `BUILTIN_FONT, createBitmapFont, glyphFor, glyphPixel, glyphToAscii` | Re-export |
| `./glyph-atlas.js` | `buildGlyphAtlas` | Re-export |
| `./text-layout.js` | `layoutText` | Re-export |
| `./bitmap-font.js` | `BitmapFont, BitmapFontOptions, BitmapGlyph` | Re-export (type-only) |
| `./glyph-atlas.js` | `GlyphAtlas, GlyphAtlasEntry, GlyphAtlasOptions` | Re-export (type-only) |
| `./text-layout.js` | `TextAlign, TextLayout, TextLayoutOptions, TextQuad` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `BUILTIN_FONT`, `createBitmapFont`, `glyphFor`, `glyphPixel`, `glyphToAscii`, `buildGlyphAtlas`, `layoutText`, `BitmapFont`, `BitmapFontOptions`, `BitmapGlyph`, `GlyphAtlas`, `GlyphAtlasEntry`, `GlyphAtlasOptions`, `TextAlign`, `TextLayout`, `TextLayoutOptions`, `TextQuad`

---

### `packages/text/src/text-layout.ts` - `layoutText` (§56 MVP tier) — a string plus a {@link GlyphAtlas} becomes a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./glyph-atlas.js` | `GlyphAtlas, GlyphAtlasEntry` | Import (type-only) |

**Exports:**
- Interfaces: `TextQuad`, `TextLayoutOptions`, `TextLayout`
- Types: `TextAlign`
- Functions: `layoutText`

---

<a id="packages-ui-dependencies"></a>

## Packages/ui Dependencies

### `packages/ui/src/button.ts` - `Button` (§73) — the one control in this MVP that *does* something: a §72

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/input` | `ScenePointerEvent, SceneKeyEvent` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./panel.js` | `Panel, PanelOptions` | Import |
| `./widget.js` | `WidgetActivationSource` | Import (type-only) |

**Exports:**
- Classes: `Button`
- Types: `ButtonOptions`

---

### `packages/ui/src/canvas-view.ts` - `CanvasViewWidget` (§73's "canvas view"; RFC 0004, accepted 2026-08-21) — a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `requireFinite` | Import |
| `./widget.js` | `UIWidget, UIWidgetOptions` | Import |

**Exports:**
- Classes: `CanvasViewWidget`
- Interfaces: `CanvasViewWidgetOptions`

---

### `packages/ui/src/checkable.ts` - `Toggle` and `Checkbox` (§73), over the checkable base they share

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./button.js` | `Button, ButtonOptions` | Import |

**Exports:**
- Classes: `Toggle`, `Checkbox`
- Interfaces: `CheckableWidgetOptions`
- Types: `ToggleOptions`, `CheckboxOptions`

---

### `packages/ui/src/image.ts` - `ImageWidget` (§73's "image") — a box, a source key, and an intrinsic size

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `requireNonNegative` | Import |
| `./widget.js` | `UIWidget, UIWidgetOptions` | Import |

**Exports:**
- Classes: `ImageWidget`
- Interfaces: `ImageWidgetOptions`

---

### `packages/ui/src/index.ts` - `@four/ui` — retained-mode UI at §113a's MVP tier (§73–§75).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./button.js` | `Button` | Re-export |
| `./canvas-view.js` | `CanvasViewWidget` | Re-export |
| `./checkable.js` | `CheckableWidget, Checkbox, Toggle` | Re-export |
| `./image.js` | `ImageWidget` | Re-export |
| `./keyboard.js` | `collectFocusOrder, installKeyboardTraversal, keyboardFocusTarget` | Re-export |
| `./label.js` | `Label` | Re-export |
| `./panel.js` | `Panel` | Re-export |
| `./progress.js` | `ProgressIndicator` | Re-export |
| `./radio.js` | `RadioButton, checkedRadio, collectRadioGroup` | Re-export |
| `./slider.js` | `Slider` | Re-export |
| `./widget.js` | `Insets, UIWidget, UI_LAYOUT_AUTHORITY, UI_STAGED, applyInsets, collectPickables, focusedWidget, isUIWidget` | Re-export |
| `./button.js` | `ButtonOptions` | Re-export (type-only) |
| `./canvas-view.js` | `CanvasViewWidgetOptions` | Re-export (type-only) |
| `./checkable.js` | `CheckableWidgetOptions, CheckboxOptions, ToggleOptions` | Re-export (type-only) |
| `./image.js` | `ImageWidgetOptions` | Re-export (type-only) |
| `./keyboard.js` | `KeyboardTraversalOptions` | Re-export (type-only) |
| `./label.js` | `LabelOptions` | Re-export (type-only) |
| `./panel.js` | `LayoutAlign, LayoutDirection, LayoutJustify, LayoutType, PanelLayout, PanelOptions` | Re-export (type-only) |
| `./progress.js` | `ProgressIndicatorOptions` | Re-export (type-only) |
| `./radio.js` | `RadioButtonOptions` | Re-export (type-only) |
| `./slider.js` | `SliderOptions, SliderOrientation` | Re-export (type-only) |
| `./widget.js` | `InsetsInit, UIFocusEvent, UIWidgetOptions, WidgetAccessibility, WidgetActivateEvent, WidgetActivationSource, WidgetSkin, WidgetStateChangeEvent, WidgetStateSnapshot, WidgetValueChangeEvent` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `Button`, `CanvasViewWidget`, `CheckableWidget`, `Checkbox`, `Toggle`, `ImageWidget`, `collectFocusOrder`, `installKeyboardTraversal`, `keyboardFocusTarget`, `Label`, `Panel`, `ProgressIndicator`, `RadioButton`, `checkedRadio`, `collectRadioGroup`, `Slider`, `Insets`, `UIWidget`, `UI_LAYOUT_AUTHORITY`, `UI_STAGED`, `applyInsets`, `collectPickables`, `focusedWidget`, `isUIWidget`, `ButtonOptions`, `CanvasViewWidgetOptions`, `CheckableWidgetOptions`, `CheckboxOptions`, `ToggleOptions`, `ImageWidgetOptions`, `KeyboardTraversalOptions`, `LabelOptions`, `LayoutAlign`, `LayoutDirection`, `LayoutJustify`, `LayoutType`, `PanelLayout`, `PanelOptions`, `ProgressIndicatorOptions`, `RadioButtonOptions`, `SliderOptions`, `SliderOrientation`, `InsetsInit`, `UIFocusEvent`, `UIWidgetOptions`, `WidgetAccessibility`, `WidgetActivateEvent`, `WidgetActivationSource`, `WidgetSkin`, `WidgetStateChangeEvent`, `WidgetStateSnapshot`, `WidgetValueChangeEvent`

---

### `packages/ui/src/keyboard.ts` - §75's keyboard navigation: Tab traversal over a widget tree (2026-08-07,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Unsubscribe` |
| `@four/input` | `SceneKeyEvent` |
| `@four/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./widget.js` | `UIWidget, focusedWidget` | Import |

**Exports:**
- Interfaces: `KeyboardTraversalOptions`
- Functions: `collectFocusOrder`, `keyboardFocusTarget`, `installKeyboardTraversal`

---

### `packages/ui/src/label.ts` - `Label` (§73) — a widget whose intrinsic size is its text (§74, §56).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector2` |
| `@four/text` | `layoutText, GlyphAtlas, TextLayout` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./widget.js` | `UIWidget, UIWidgetOptions` | Import |

**Exports:**
- Classes: `Label`
- Interfaces: `LabelOptions`

---

### `packages/ui/src/numbers.ts` - Numeric guards and range arithmetic shared by the §73 controls that carry a

**Exports:**
- Functions: `requireFinite`, `requireNonNegative`, `resolveValue`, `fractionOf`

---

### `packages/ui/src/panel.ts` - `Panel` (§73) and the layout engine (§74) — the container widget, and the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/math` | `Vector2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./widget.js` | `UIWidget, applyInsets, InsetsInit, UIWidgetOptions` | Import |

**Exports:**
- Classes: `Panel`
- Interfaces: `PanelLayout`, `PanelOptions`
- Types: `LayoutType`, `LayoutDirection`, `LayoutJustify`, `LayoutAlign`

---

### `packages/ui/src/progress.ts` - `ProgressIndicator` (§73) — a value shown, never edited (2026-08-07, A-12).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `fractionOf, requireFinite` | Import |
| `./panel.js` | `Panel, PanelOptions` | Import |

**Exports:**
- Classes: `ProgressIndicator`
- Interfaces: `ProgressIndicatorOptions`

---

### `packages/ui/src/radio.ts` - `RadioButton` (§73's "radio control") and its group mechanism (2026-08-07,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/input` | `SceneKeyEvent` |
| `@four/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./checkable.js` | `CheckableWidget, CheckableWidgetOptions` | Import |

**Exports:**
- Classes: `RadioButton`
- Interfaces: `RadioButtonOptions`
- Functions: `collectRadioGroup`, `checkedRadio`

---

### `packages/ui/src/slider.ts` - `Slider` (§73) — a value dragged along a track (§72) or stepped with the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/input` | `ScenePointerEvent, SceneKeyEvent` |
| `@four/math` | `Matrix4, Vector3` |
| `@four/scene` | `resolveWorldTransform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `fractionOf, requireFinite, resolveValue` | Import |
| `./panel.js` | `Panel, PanelOptions` | Import |

**Exports:**
- Classes: `Slider`
- Interfaces: `SliderOptions`
- Types: `SliderOrientation`

---

### `packages/ui/src/widget.ts` - `UIWidget` (§73–§75) — the retained-mode UI layer's base class: a scene node

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@four/core` | `Disposable, Unsubscribe` |
| `@four/input` | `Pickable, ScenePointerEvent` |
| `@four/math` | `Vector2, Vector3` |
| `@four/scene` | `Node, warnAuthorityConflict, NodeOptions` |

**Exports:**
- Classes: `Insets`
- Interfaces: `WidgetStateSnapshot`, `WidgetStateChangeEvent`, `WidgetActivateEvent`, `WidgetValueChangeEvent`, `UIFocusEvent`, `WidgetAccessibility`, `WidgetSkin`, `UIWidgetOptions`
- Types: `InsetsInit`, `WidgetActivationSource`
- Functions: `applyInsets`, `focusedWidget`, `isUIWidget`, `collectPickables`
- Constants: `UI_LAYOUT_AUTHORITY`, `UI_STAGED`

---

<a id="dependency-matrix"></a>
## Dependency Matrix

### File Import/Export Matrix

| File | Imports From | Exports To |
|------|--------------|------------|
| `packages/render-webgpu/src/index` | 22 files | 0 files |
| `packages/render/src/index` | 21 files | 0 files |
| `packages/render-webgpu/src/webgpu-device` | 0 files | 21 files |
| `packages/render-webgpu/src/webgpu-renderer` | 18 files | 2 files |
| `packages/physics/src/index` | 19 files | 0 files |
| `packages/motion/src/index` | 18 files | 0 files |
| `packages/physics/src/world` | 12 files | 6 files |
| `packages/render-webgl/src/index` | 17 files | 0 files |
| `packages/physics/src/types` | 0 files | 16 files |
| `packages/render-webgl/src/gl-program` | 0 files | 16 files |
| `packages/scene/src/index` | 15 files | 0 files |
| `packages/render-webgl/src/webgl-renderer` | 12 files | 2 files |
| `packages/render-webgpu/src/wgpu-unlit` | 2 files | 12 files |
| `packages/render-webgpu/src/wgpu-pipeline-cache` | 9 files | 4 files |
| `packages/scene/src/node` | 4 files | 9 files |
| `packages/core/src/index` | 12 files | 0 files |
| `packages/physics/src/descriptors` | 3 files | 9 files |
| `packages/physics/src/collider` | 8 files | 3 files |
| `packages/physics/src/rigid-body` | 4 files | 7 files |
| `packages/render-webgpu/src/wgpu-bindings` | 1 file | 10 files |
| `packages/ui/src/index` | 11 files | 0 files |
| `packages/animation/src/index` | 10 files | 0 files |
| `packages/materials/src/index` | 10 files | 0 files |
| `packages/math/src/index` | 9 files | 0 files |
| `packages/physics/src/serializers` | 8 files | 1 file |
| `packages/physics/src/shapes` | 1 file | 8 files |
| `packages/render-webgpu/src/wgpu-lit` | 5 files | 4 files |
| `packages/render-webgpu/src/wgpu-node-program` | 8 files | 1 file |
| `packages/render-webgpu/src/wgpu-shadow` | 4 files | 5 files |
| `packages/diagnostics/src/index` | 8 files | 0 files |
| `packages/geometry/src/index` | 8 files | 0 files |
| `packages/motion/src/serializers` | 7 files | 1 file |
| `packages/physics/src/joints` | 6 files | 2 files |
| `packages/physics/src/queries` | 2 files | 6 files |
| `packages/physics/src/validation` | 3 files | 5 files |
| `packages/render/src/render-list` | 4 files | 4 files |
| `packages/render/src/renderer` | 4 files | 4 files |
| `packages/render-webgpu/src/wgpu-standard` | 5 files | 3 files |
| `packages/animation/src/controller` | 6 files | 1 file |
| `packages/animation/src/tween` | 3 files | 4 files |

---

<a id="circular-dependency-analysis"></a>
## Circular Dependency Analysis

**3 circular dependencies detected:**

- **Runtime cycles**: 0 (require attention)
- **Type-only cycles**: 3 (safe, no runtime impact)

### Type-Only Circular Dependencies

These cycles only involve type imports and are safe (erased at runtime):

- packages/physics/src/world.ts -> packages/physics/src/solver-registry.ts -> packages/physics/src/world.ts
- packages/render/src/renderer.ts -> packages/render/src/picking.ts -> packages/render/src/renderer.ts
- packages/scene/src/node.ts -> packages/scene/src/world-transforms.ts -> packages/scene/src/node.ts

---

<a id="visual-dependency-graph"></a>
## Visual Dependency Graph

```mermaid
graph TD
    subgraph Packages/animation
        N0[animation-system]
        N1[binding]
        N2[clip]
        N3[controller]
        N4[easing]
        N5[index]
        N6[mixer]
        N7[timeline]
        N8[track]
        N9[tween]
        N10[...1 more]
    end

    subgraph Packages/assets
        N11[asset-manager]
        N12[content-hash]
        N13[index]
        N14[loaders]
        N15[manifest]
        N16[texture]
    end

    subgraph Packages/core
        N17[component]
        N18[conventions]
        N19[dev]
        N20[disposable]
        N21[errors]
        N22[events]
        N23[index]
        N24[json]
        N25[plugin]
        N26[random]
        N27[...3 more]
    end

    subgraph Packages/diagnostics
        N28[checksum]
        N29[debug-draw]
        N30[index]
        N31[recorder]
        N32[replay-format]
        N33[replay-player]
        N34[resource-audit]
        N35[rollback]
        N36[stats]
    end

    subgraph Packages/four
        N37[animation]
        N38[application]
        N39[assets]
        N40[core]
        N41[diagnostics]
        N42[geometry]
        N43[index]
        N44[input]
        N45[materials]
        N46[math]
        N47[...19 more]
    end

    subgraph Packages/geometry
        N48[buffer-geometry]
        N49[geometry]
        N50[index]
        N51[path]
        N52[primitive-support]
        N53[primitives-3d]
        N54[primitives]
        N55[resource-memory]
        N56[svg-path]
        N57[tessellation]
    end

    subgraph Packages/input
        N58[drag]
        N59[index]
        N60[key-events]
        N61[keyboard-input]
        N62[pick]
        N63[pointer-events]
        N64[pointer-input]
        N65[propagation]
    end

    subgraph Packages/materials
        N66[index]
        N67[lit-material]
        N68[material]
        N69[node-material-builder]
        N70[node-material]
        N71[shader-graph]
        N72[sprite-material]
        N73[standard-material]
        N74[stencil-state]
        N75[texture]
        N76[...1 more]
    end

    subgraph Packages/math
        N77[alloc-counter]
        N78[color]
        N79[frustum]
        N80[index]
        N81[matrix3]
        N82[matrix4]
        N83[quaternion]
        N84[vector2]
        N85[vector3]
        N86[vector4]
    end

    subgraph Packages/motion
        N87[camera-rigs]
        N88[character-controller]
        N89[clock]
        N90[constraints]
        N91[ik]
        N92[index]
        N93[integrators]
        N94[kinematic-controller]
        N95[motion-component]
        N96[pid]
        N97[...9 more]
    end

    subgraph Packages/particles
        N98[emitter]
        N99[fields]
        N100[index]
        N101[particle-renderable]
        N102[particle-system]
        N103[pool]
        N104[random]
        N105[types]
    end

    subgraph Packages/physics
        N106[adapter]
        N107[body-access]
        N108[collider]
        N109[descriptors]
        N110[events]
        N111[force-field]
        N112[index]
        N113[joints]
        N114[material]
        N115[physics-event-system]
        N116[...10 more]
    end

    subgraph Packages/physics-box2d
        N117[index]
    end

    subgraph Packages/physics-rapier
        N118[ccd]
        N119[conversions2d]
        N120[conversions3d]
        N121[index]
        N122[init]
        N123[rapier2d-adapter]
        N124[rapier3d-adapter]
        N125[register]
    end

    subgraph Packages/physics-soft
        N126[index]
    end

    subgraph Packages/render
        N127[batch]
        N128[bounds]
        N129[clip]
        N130[effect-pass]
        N131[index]
        N132[lights]
        N133[mesh]
        N134[particles]
        N135[picking]
        N136[raster]
        N137[...12 more]
    end

    subgraph Packages/render-canvas
        N138[index]
    end

    subgraph Packages/render-svg
        N139[index]
    end

    subgraph Packages/render-webgl
        N140[gl-batch]
        N141[gl-effect]
        N142[gl-geometry]
        N143[gl-node-program]
        N144[gl-particles]
        N145[gl-picking-registry]
        N146[gl-picking]
        N147[gl-program]
        N148[gl-render-target]
        N149[gl-shadow]
        N150[...8 more]
    end

    subgraph Packages/render-webgpu
        N151[index]
        N152[register]
        N153[webgpu-device]
        N154[webgpu-renderer]
        N155[wgpu-batch]
        N156[wgpu-bindings]
        N157[wgpu-compute]
        N158[wgpu-effect]
        N159[wgpu-geometry]
        N160[wgpu-lights]
        N161[...13 more]
    end

    subgraph Packages/scene
        N162[authority]
        N163[camera]
        N164[group]
        N165[index]
        N166[interpolation]
        N167[layers]
        N168[light]
        N169[node]
        N170[pose-target]
        N171[scene]
        N172[...6 more]
    end

    subgraph Packages/serialization
        N173[format]
        N174[index]
        N175[migration]
        N176[serializer]
    end

    subgraph Packages/text
        N177[bitmap-font]
        N178[glyph-atlas]
        N179[index]
        N180[text-layout]
    end

    subgraph Packages/ui
        N181[button]
        N182[canvas-view]
        N183[checkable]
        N184[image]
        N185[index]
        N186[keyboard]
        N187[label]
        N188[numbers]
        N189[panel]
        N190[progress]
        N191[...3 more]
    end

    N2 --> N8
    N3 --> N0
    N3 --> N1
    N3 --> N2
    N3 --> N8
    N3 --> N9
    N5 --> N0
    N5 --> N1
    N5 --> N2
    N5 --> N3
    N5 --> N4
    N5 --> N6
    N5 --> N7
    N5 --> N8
    N5 --> N9
    N6 --> N1
    N6 --> N2
    N6 --> N8
    N6 --> N9
    N7 --> N9
    N9 --> N1
    N9 --> N4
    N11 --> N12
    N13 --> N11
    N13 --> N12
    N13 --> N15
    N13 --> N16
    N13 --> N14
    N14 --> N11
    N15 --> N11
    N16 --> N11
    N17 --> N19
    N17 --> N21
    N19 --> N21
    N23 --> N18
    N23 --> N24
    N23 --> N26
    N23 --> N17
    N23 --> N20
    N23 --> N19
    N23 --> N21
    N23 --> N22
    N23 --> N25
    N25 --> N21
    N30 --> N28
    N30 --> N31
    N30 --> N35
    N30 --> N32
    N30 --> N33
    N30 --> N29
    N30 --> N34
    N30 --> N36
    N31 --> N32
    N33 --> N31
    N33 --> N32
    N35 --> N31
    N36 --> N29
    N43 --> N38
    N48 --> N49
    N48 --> N55
    N50 --> N48
    N50 --> N49
    N50 --> N53
    N50 --> N51
    N50 --> N56
    N50 --> N54
    N50 --> N55
    N50 --> N57
    N51 --> N52
    N51 --> N57
    N53 --> N48
    N53 --> N52
    N53 --> N57
    N54 --> N48
    N54 --> N52
```

---

<a id="summary-statistics"></a>
## Summary Statistics

| Category | Count |
|----------|-------|
| Total TypeScript Files | 266 |
| Total Modules | 24 |
| Total Lines of Code | 129888 |
| Total Exports | 2685 |
| Total Re-exports | 1706 |
| Total Classes | 175 |
| Total Interfaces | 523 |
| Total Functions | 420 |
| Total Type Guards | 23 |
| Total Enums | 0 |
| Type-only Imports | 318 |
| Runtime Circular Deps | 0 |
| Type-only Circular Deps | 3 |

---

*Last Updated*: 2026-08-29
*Version*: 0.0.0
