/**
 * Content hashing (§76's last-but-one capability, §79's manifest half).
 *
 * §76 lists "content hashing" among the asset manager's requirements and §79
 * spends it immediately: *"assets are referenced by logical key, resolved
 * through a manifest that maps each key to a URL and content hash (§76)"*. Two
 * jobs hide in that sentence, and they want different hashes:
 *
 * - **Cache busting.** A build writes the hash into the manifest so a changed
 *   file gets a new key/URL pair. Any hash does this — FNV-1a would do — because
 *   the adversary is a stale CDN, not a person.
 * - **Verification on reload.** The manifest *declares* what the bytes should
 *   be, and the loader checks the bytes it actually received. The adversary here
 *   is whoever can answer the request: a compromised CDN, a hostile mirror, a
 *   cache-poisoning proxy. §96's opening line — "asset loaders … shall treat
 *   external content as untrusted" — is about exactly that party.
 *
 * The second job decides the algorithm. A non-cryptographic hash (FNV, xxHash)
 * is trivially collidable *by construction*: an attacker who can choose the
 * bytes can hit any 64-bit value in seconds, so a manifest verified with one
 * would be a check that announces integrity and does not provide it — worse
 * than no check, because callers would trust it. So the default is
 * **SHA-256**, and the honest costs are paid in the open:
 *
 * - It is **async** (`crypto.subtle.digest` returns a promise). That costs
 *   nothing here: `load` is already async, and hashing happens on the IO path,
 *   never inside a fixed step. §33's determinism tiers are untouched for the
 *   same reason the module comment gives for `globalThis.fetch` — an asset
 *   manager is IO, not simulation.
 * - It is a **capability, not an assumption**. `crypto.subtle` is a global in
 *   every browser *secure context* and in Node ≥ 19 — but a page served over
 *   plain `http:` to a non-localhost origin has `crypto` with **no** `subtle`,
 *   and that is a real deployment, not a hypothetical. So it is resolved the
 *   way `fetch` and `setTimeout` are (presence is the capability,
 *   {@link AssetManager.canHashContent} reports it) and a caller that asks for a
 *   hash a runtime cannot compute is **refused loudly** rather than handed an
 *   unverified asset.
 *
 * An application that wants a different algorithm injects
 * {@link AssetManagerOptions.digest} — a build using BLAKE3 through WASM, or a
 * test using a counter. The returned string is opaque to the manager: it is
 * compared with `===` against what the manifest declared, so the *only*
 * requirement is that producer and verifier agree. The built-in format says
 * which algorithm produced it (`"sha256-<64 lowercase hex digits>"`) precisely
 * so that a mismatch caused by two different algorithms reads as one.
 */

/**
 * The hash seam: bytes in, an opaque hash string out.
 *
 * May be async (`crypto.subtle` is) or sync (a test's fake, a WASM hasher).
 * The manager never parses the result — see the module comment on why the
 * built-in format still names its algorithm.
 */
export type DigestLike = (data: ArrayBuffer) => Promise<string> | string;

/**
 * The UTF-8 decode seam a hashed **text** load needs.
 *
 * Hashing is defined over the response's *bytes* (see
 * {@link AssetManager.contentHash}), so a hashed load reads the body once as
 * bytes and every other accessor is derived from those bytes — which is where a
 * decoder is required. `globalThis.TextDecoder` is the default and exists in
 * every browser and every supported Node; injecting one is for the runtime that
 * has neither, and for tests.
 */
export type TextDecodeLike = (data: ArrayBuffer) => string;

/** The algorithm the built-in {@link DigestLike} uses, and its hash prefix. */
export const CONTENT_HASH_ALGORITHM = "sha256";

/** Lowercase hex, two digits per byte — the built-in hash's body. */
function toHex(digest: ArrayBuffer): string {
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * The shape this module needs from `crypto.subtle`, declared structurally so
 * the package still names no platform type (the rule the transport, the timer,
 * and the image decoder already follow).
 */
interface SubtleCryptoLike {
  digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer>;
}

/**
 * The platform SHA-256, or `undefined` where there is none (an insecure browser
 * context, a runtime older than Node 19).
 *
 * `undefined` rather than a throw, exactly as `resolveGlobalFetch` is lenient:
 * construction succeeds, {@link AssetManager.canHashContent} answers `false`,
 * and only a load that actually asked to be hashed complains.
 */
export function resolveGlobalDigest(): DigestLike | undefined {
  const scope = globalThis as { crypto?: { subtle?: SubtleCryptoLike } };
  const subtle = scope.crypto?.subtle;
  if (subtle === undefined || typeof subtle.digest !== "function") {
    return undefined;
  }
  return async (data: ArrayBuffer): Promise<string> =>
    `${CONTENT_HASH_ALGORITHM}-${toHex(await subtle.digest("SHA-256", data))}`;
}

/** As {@link resolveGlobalDigest}: the platform UTF-8 decoder, if there is one. */
export function resolveGlobalTextDecoder(): TextDecodeLike | undefined {
  const scope = globalThis as {
    TextDecoder?: new () => { decode(input: ArrayBuffer): string };
  };
  const Decoder = scope.TextDecoder;
  if (typeof Decoder !== "function") {
    return undefined;
  }
  const decoder = new Decoder();
  return (data: ArrayBuffer): string => decoder.decode(data);
}
