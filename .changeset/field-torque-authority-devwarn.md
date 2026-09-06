---
"@four/physics": minor
"@four/scene": patch
---

Add optional `ForceField.sampleTorque` (always N·m) and per-entry `wakesSleepingBodies` so a field can twist a body and opt into waking sleepers without defeating §32. Route §42's `warnAuthorityConflict` through `devWarnOnce`.
