# Website

Project website and documentation site per the documentation plan (§93): installation and
quick start, guides (scene graph, cameras, materials, transform authority, fixed-step
simulation, units, performance, custom shaders, custom solver adapters, engineering
dashboards, digital twins), and API documentation generated from TypeScript declarations.

## What exists (2026-08-07)

`index.html` here, plus `.github/workflows/docs.yml`, which on every push to `main` builds
and deploys to GitHub Pages:

- **the API reference** — TypeDoc output for all 24 packages (`bun run docs`), at `/api/`;
- **the eight runnable examples** (six until 2026-08-07, when `first-3d-scene` and then
  the §118 flagship were written) — `first-2d-scene`, `first-3d-scene`,
  `physics-playground`, `mechanism`, `blending`, `particles-demo`, `ui-demo`,
  `flagship/one-scene-everything-moves`, each built with
  `--base=/four.js/examples/<name>/` because Pages hosts them under a subpath, at
  `/examples/<name>/`;
- **`index.html`** — a hand-written page linking those two and pointing at the guides on
  GitHub.

Deployment starts the first time the workflow runs on `main` with Pages enabled for the
repository (Settings → Pages → source "GitHub Actions"), which is an owner step.

## What is staged

- **The real site.** The thirteen guides in `docs/guides/` are written and good, but they
  are Markdown and Pages does not render Markdown, so `index.html` links them on GitHub
  rather than hosting them. A site that hosts the guides properly needs a static-site
  generator and a decision about which one — neither exists yet.
- **The site's use of the flagship demo.** §93 wants the site's centrepiece to be a live
  interactive scene. Since 2026-08-07 there is one —
  `examples/flagship/one-scene-everything-moves`, §118's demonstration — and the workflow
  builds and deploys it with the others; this bullet said `examples/flagship/` "is still an
  empty placeholder" until that date. What is still staged is the _site's_ half: nothing
  here embeds it as a centrepiece, and `index.html` remains a plain list of links (which
  also does not yet name `first-3d-scene`). `examples/flagship/motor-digital-twin`, §119's
  engineering demonstration, was written on 2026-08-08 and is built and deployed with the
  others; this bullet said it "is still not written; the directory is a placeholder" until
  that date.
- **Installation and quick start.** Deferred to first publish (§94 0.1): the install line
  would name packages nobody can install yet.

This directory was "Scaffold only — no implementation yet." until 2026-08-07; §113a's exit
criterion covering "documentation and website per §93" was met on the documentation half
only, and the shortfall is now recorded rather than implied.
