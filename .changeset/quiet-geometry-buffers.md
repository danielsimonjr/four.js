---
"@four/render-webgl": patch
---

Reuse WebGL geometry buffers and vertex arrays across compatible geometry edits,
centralize attribute upload/cleanup, and prevent disposed cache resurrection.
Full data-store updates and rendering order are preserved; public APIs are unchanged.
