# Changesets

Release machinery for §94. Every user-visible change adds a changeset;
`.github/workflows/release.yml` turns the accumulated changesets into a "Version Packages" pull
request, and merging that PR is what cuts a release. Nothing here publishes on its own — see
"The publish is an owner step" below.

```sh
pnpm exec changeset          # describe a change: pick packages, pick a bump, write a summary
pnpm exec changeset status   # what would be released right now
pnpm exec changeset version  # apply the bumps locally (CI normally does this)
```

The general docs are at
[changesets/changesets](https://github.com/changesets/changesets/blob/main/docs/detailed-explanation.md).
What follows is only what is specific to this repository.

## Published names are not workspace names

The workspace calls its packages `four` and `@four/*`. npm publishes them as `@danielsimonjr/fourjs`
and `@danielsimonjr/fourjs-<name>` (owner decision 2026-07-29, spec §98 revision 1.6). Changesets
works entirely in **workspace** names: a changeset file names `@four/scene`, not
`@danielsimonjr/fourjs-scene`. The rename is applied last, mechanically, by
`tools/apply-publish-names.mjs`, which stages a renamed copy of the workspace and never edits the
checkout. Do not rename anything by hand in a changeset.

## `linked`, and why the two families are grouped

`@four/render` is the §62 renderer interface and `render-webgl` / `render-webgpu` / `render-canvas` /
`render-svg` are backends implementing it; `@four/physics` is the §37 stable solver API and
`physics-rapier` / `physics-box2d` / `physics-soft` are adapters behind it. Within each family the
interface and its implementations only make sense at matching versions — a consumer reading a
capability table needs to know which interface revision an adapter was built against — so each family
is `linked`: when several members are released together they take the same version number. They are
deliberately not `fixed`, which would force every member into every release whether it changed or not.

## `ignore` is empty, and that is not an oversight

The intent was to `ignore` the five reserved stubs (`@four/physics-box2d`, `@four/physics-soft`,
`@four/render-webgpu`, `@four/render-canvas`, `@four/render-svg`) so they never publish. Changesets
rejects that configuration, and it is right to:

```
The package "four" depends on the skipped package "@four/physics-box2d",
but "four" is not being skipped. Please add "four" to the `ignore` option.
```

The umbrella package lists all five in its `dependencies` and re-exports each as a subpath
(`four/render-canvas`, `four/physics-soft`, …). An ignored package is one npm never sees, so
`@danielsimonjr/fourjs` would install with five unresolvable dependencies. Ignoring them requires
first changing how the umbrella depends on them — dropping those subpaths, or making the five
optional peers — which is a packaging decision for the owner and a change to `packages/**`, not to
this file. Until then the stubs publish alongside everything else; each one's README says what it is.

## The publish is an owner step

`release.yml` runs the whole of `ci.yml` first, then keeps the version PR current. It publishes only
when an `NPM_TOKEN` secret exists; with no token configured the publish step is skipped and the
workflow still succeeds. Adding that secret is the owner's decision (§94 0.1) and is the single
action that turns this machinery on.
