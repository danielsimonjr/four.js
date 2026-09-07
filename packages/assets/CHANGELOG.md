# @four/assets

## 0.1.0

### Minor Changes

- b3ec9d6: §81 tokens for the five remaining extension points: `ASSET_LOADERS`, `SHADER_OPERATORS`, `UI_CONTROLS`, `EDITOR_TOOLS` (host-side, umbrella), and `COMPUTE_WORKLOADS`, each with a named registry. The umbrella re-exports the same objects.

## 0.0.1

### Patch Changes

- 13748d1: Warn once when `AssetManager.load` takes another reference on a settled cache slot (§83 duplicate asset loads). In-flight coalescing stays silent.
