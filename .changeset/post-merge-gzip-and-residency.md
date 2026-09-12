---
"@fourjs/assets": minor
"@fourjs/geometry": patch
"@fourjs/render-webgl": patch
"@fourjs/render-webgpu": patch
"@fourjs/text": patch
"fourJS": patch
---

Add bounded raw gzip asset loading through an injected streaming decoder. Isolate asynchronous texture residency by GPU allocation and preserve identity shaping for custom character atlases without glyph-ID maps.

Skip winding tests for points outside ring bounds, preserving exact containment while reducing disjoint-path fill work.
