# Security and untrusted content

§96 opens with a single sentence that decides everything else in this guide:

> Asset loaders and scene deserializers shall treat external content as
> untrusted.

A scene file, a replay recording, and a downloaded asset all arrive from
somewhere the application does not control — a CDN, a user's disk, a bug
report, a URL someone pasted. This guide states what the engine does about
that, what it does **not** do, and the content-security-policy posture a
deployer can write their headers from.

## Honest state first

§96 lists seven requirements. Four are met, two are partial, and one is absent
because the feature it would guard does not exist yet.

| §96 requirement                                  | State       | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bounds checking                                  | **met**     | `validateSceneDocument` / `validateReplayRecording` rebuild a document field by field and drop every key they do not know; geometry validates index ranges; base64 is canonical-only                                                                                                                                                                                                                                                                                                                                                                  |
| no arbitrary code execution from scene files     | **met**     | the formats are JSON; `cloneJsonValue` refuses a `__proto__` key; nothing anywhere in the engine calls `eval` or builds a `Function` from a string (see "CSP posture", which is tested)                                                                                                                                                                                                                                                                                                                                                               |
| input-size limits                                | **met**     | `AssetManagerOptions.maximumBytes` for transport; `maximumTextLength` on `decodeSceneDocument` / `decodeReplayRecording` for documents — all three finite by default                                                                                                                                                                                                                                                                                                                                                                                  |
| cancellation and timeouts for expensive decoders | **met**     | `AssetManagerOptions.timeoutSeconds` bounds a whole load, transport and decode together; `load(url, loader, { signal })` cancels one caller's load, and `AssetManagerOptions.abortController` extends both to the request itself (`canAbortTransport` reports whether a manager has it)                                                                                                                                                                                                                                                               |
| documented content-security-policy behavior      | **met**     | this guide's "CSP posture" section, enforced by `tests/integration/security-csp.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| decompression limits                             | **absent**  | no compressed path exists (no gzip, no Draco, no Basis) — there is nothing yet to bound                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| safe shader/plugin boundaries                    | **partial** | the plugin half is answered (2026-08-28, `A-3`/RFC 0002): a plugin is a **value** the application installs — `PluginHost.add` and `ApplicationOptions.plugins` accept no URL, no module specifier, and no name from a document, and `tests/integration/plugin-boundary.test.ts` fails if any deserializing package reaches the host. It is a boundary, **not a sandbox** — see "Plugins run with your authority". The shader half is still absent: no application-authored shader source path exists; see `custom-shaders.md` for the staged §60 seam |

Depth limiting is the sixth item's neighbour rather than one of the seven, and
it is met: both decoders bound JSON nesting. It matters more than its absence
from the list suggests — see "Deep documents are a denial of service", below.

## Assets: bytes and deadlines

`AssetManager` is the only thing in the engine that touches a network, so both
transport-side §96 limits live on it. Both defaults are **finite**; a limit
that defaults to `Infinity` is documentation, not a limit.

```ts
import { AssetManager, jsonLoader } from "four/assets";

const assets = new AssetManager({
  maximumBytes: 8 * 1024 * 1024, // default: 64 MiB
  timeoutSeconds: 10, // default: 30 s — seconds, like every four.js duration
});

try {
  const level = await assets.load("/levels/1.json", jsonLoader);
} catch (error) {
  // FourError, code "ASSET_LOAD_FAILED", context:
  //   { url, loader, limitName: "maximumBytes" | "timeoutSeconds",
  //     limit, observed? }
}
```

Two details are worth knowing because they change what an attacker can do:

- **The size limit is checked twice.** First against the response's declared
  `content-length`, before a single byte of body is read — an oversize download
  is refused while it is still a header. Then against what the body actually
  produced, because `content-length` is a claim by the same party that sent the
  bytes. The loader is handed a bounded view of the response whose
  `arrayBuffer()`, `text()`, and `json()` refuse an over-budget body rather
  than returning it, so a decoder never sees bytes the application declined.
  `text()` is measured in UTF-16 code units, which is never more than the UTF-8
  byte count — conservative in the safe direction.
- **The deadline covers decode, not just transport.** §96's phrase is
  "expensive decoders", and a decoder that never returns is exactly as fatal as
  a socket that never closes.

Either limit can be set to `Number.POSITIVE_INFINITY`, which is how an
application records in its own source that it has decided to trust an origin.

## Documents: length and depth

```ts
import { decodeSceneDocument } from "four/serialization";
import { decodeReplayRecording } from "four/diagnostics";

const scene = decodeSceneDocument(text, {
  maximumTextLength: 1_000_000, // default: 33_554_432 UTF-16 code units
  maximumDepth: 64, // default: 1024 nesting levels
});

const recording = decodeReplayRecording(replayText);
```

A refused document raises `FourError` with code `UNTRUSTED_INPUT_REJECTED` and
a `context` naming the `limitName`, its `limit`, and the `observed`
measurement — so a host can log which policy fired without parsing a message.
That code is deliberately distinct from the `TypeError`s the validators throw
for a malformed field: those say "this is not a scene", this says "this is not
something we are willing to look at".

The two `validate*` entry points (`validateSceneDocument`,
`validateReplayRecording`) are **not** guarded, and that is deliberate: they
take a value the caller already built or vouched for — `ReplayRecorder.finish`
and `ReplayPlayer.load` both go through them — and bounding an in-memory object
the process just produced would refuse nothing an attacker controls. The guard
belongs at the text boundary, which is where the untrusted content is.

### Deep documents are a denial of service

`JSON.parse` is not the vulnerable step. V8 parses a hundred thousand levels of
`[[[[…]]]]` without complaint. The vulnerable step is the engine's own:
`validateSceneDocument` recurses once per `children` generation,
`cloneJsonValue` once per level of a metadata payload. A few kilobytes of
nested brackets therefore buys a `RangeError: Maximum call stack size exceeded`
thrown from deep inside a validator, on a stack too short to say what happened,
in a host that shares that stack with everything else on the page.

So the depth check runs before any recursive consumer sees the value, and the
check is itself **iterative** — breadth-first, one level at a time. A recursive
depth checker would be the same defect wearing the guard's name: it would
overflow on precisely the input it exists to refuse.

The default of 1024 levels admits a node subtree roughly 500 generations deep
(a §79 node costs two JSON levels per generation), which is far past any
authored scene and far short of the recursion depth at which a validator dies.

## CSP posture

four.js is designed to run under a strict Content-Security-Policy with **no
`'unsafe-eval'` and no `'unsafe-inline'`**. Concretely, no package in this
repository:

- calls `eval`, or builds a function from a string (`new Function`, or a
  string argument to `setTimeout` / `setInterval`) — so `script-src` needs no
  `'unsafe-eval'`;
- writes markup into the document (`innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`) or assigns a raw `style.cssText` — so
  neither `script-src` nor `style-src` needs `'unsafe-inline'`;
- injects a `<script>` or `<style>` element of its own. The renderer draws into
  a canvas the application supplies; `@four/ui` is a scene-graph widget tier
  that renders through that same canvas, not a DOM component library.

A workable starting policy for an application built on four.js:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data: blob:;
  connect-src 'self' https://your-asset-origin.example;
  worker-src 'self' blob:;
```

Widen `connect-src` to the origins `AssetManager` fetches from, and `img-src`
to wherever textures come from. `worker-src 'self' blob:` is there for §88's
staged worker modes; drop it until you use one.

**This section is tested, not merely asserted.**
`tests/integration/security-csp.test.ts` greps every `packages/*/src` file and
every example for those constructs and fails if one appears. A package that
genuinely needs one does not silence the test — it changes this guide first,
because this guide is the document a deployer's policy is written from.

Two related deployment headers are covered elsewhere: WebGPU and shared-memory
worker modes need COOP/COEP, which
[Workers and cross-origin isolation](workers-and-cross-origin-isolation.md)
explains.

## Plugins run with your authority

§81's plugin system landed on 2026-08-28 (`A-3`, RFC 0002), and §96's _"safe
plugin boundaries"_ is the requirement it had to answer. The honest answer has
two halves, and only one of them is good news.

**There is no sandbox, and none is claimed.** A plugin is JavaScript your
application imported. It runs with your authority: your network, your DOM, your
globals. Isolation would mean Workers or realms plus a serialisable message
boundary for every registry a plugin registers into, which is a project in
itself rather than a flag. Install a plugin exactly as carefully as you would
add any other dependency.

**What is enforced is how a plugin can arrive.** A plugin is a _value_:

```ts
import { gridPlugin } from "@vendor/grid"; // your import, your module graph

const app = new Application({ plugins: [gridPlugin] });
await app.initialize();
```

`PluginHost.add` and `ApplicationOptions.plugins` take a `FourPlugin` object.
They take no URL, no module specifier, and no name — so there is no expression
in this API that turns a _string_ into running code, which means no
deserialization path can reach it. A scene document names a **registered type
name** (§79); a name it has not registered gets the existing error, not a load.
Plugins named in a scene file (`"plugins": ["@vendor/thing"]`) were considered
and rejected outright rather than staged, because that is arbitrary code
execution from a scene file in the plainest possible form.

Both halves are checked, not asserted: `tests/integration/plugin-boundary.test.ts`
fails if any source file under `@four/serialization` or `@four/assets` so much
as mentions the plugin host, and pins the fact that `add`'s parameter type
admits no string.

## What is not covered

Being explicit about the holes is the point of the honest-state table; these
are the two that most affect how you deploy:

1. **Decompression limits.** Nothing in the engine decompresses anything yet.
   When a compressed texture or a gzipped scene lands, it needs a ratio bound
   as well as an output bound — an input-size limit alone does not stop a zip
   bomb.
2. **Shader boundaries.** There is still no path by which a scene file can name
   shader source; RFC 0001's position is that there never will be one, because
   shading is a graph of closed operators rather than text. That would be a new
   trust boundary and needs its own §96 pass if it ever arrives.

   (The **plugin** half of this item left the list on 2026-08-28 with `A-3`.
   See "Plugins run with your authority" for what was actually settled — a
   boundary on how a plugin can arrive, not isolation once it has.)

(Transport-level cancellation left this list on 2026-08-09: `load(url, loader,
{ signal })` cancels a caller's load, and `AssetManagerOptions.abortController`
aborts the underlying request — for the `timeoutSeconds` deadline too. A decode
that has already begun still runs to its end — no signal reaches inside a
loader — but its result is discarded and its cache slot freed.)

Beyond §96's list, two ordinary web-application responsibilities remain the
application's, not the engine's: four.js never validates that a URL points
somewhere you meant (do that before calling `load`), and it never sets response
headers — `Content-Type`, `X-Content-Type-Options: nosniff`, and CORS policy
are your server's.
