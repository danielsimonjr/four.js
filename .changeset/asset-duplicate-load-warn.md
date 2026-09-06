---
"@four/assets": patch
---

Warn once when `AssetManager.load` takes another reference on a settled cache slot (§83 duplicate asset loads). In-flight coalescing stays silent.
