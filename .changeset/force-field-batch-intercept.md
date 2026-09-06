---
"@four/physics": minor
"@four/motion": minor
---

Add optional `ForceField.sampleAll` (stride-3 SoA, binary64 out-params) so `ForceFieldSystem` can apply a §27 field to many bodies in one call, and fold steering's private intercept-time quadratic into `interceptTime`'s export via `{ onMiss, validateSpeed }`.
