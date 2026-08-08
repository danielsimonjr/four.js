/**
 * Colour value types, the sRGB transfer functions, and CSS colour-string
 * parsing — §60a's colour management at the value-type layer (R-15,
 * 2026-08-08).
 *
 * `@four/materials` authors colours, `@four/animation` tweens them, `@four/scene`
 * gives them to lights and `@four/render` uploads them, but the §3.1 dependency
 * matrix has no edge between most of those pairs. `@four/math` is the value-type
 * home below all of them: the tuples live here and each package re-exports them
 * unchanged, so values keep passing between packages without conversion.
 * {@link ColorRGBA} was hoisted here 2026-08-04; {@link ColorRGB} joined it
 * 2026-08-08, exactly as `@four/materials`'
 * `StandardMaterial.emissive` said it should.
 *
 * ## The working-space policy §60a defines, stated once
 *
 * §60a is five sentences, and this module implements the parts of it that are
 * arithmetic rather than GPU state:
 *
 * 1. **The GPU pipeline is linear-light.** Every colour that reaches a shader —
 *    a material's, a light's, a vertex colour — is treated as *linear*, and
 *    lighting and blending are done on those numbers as stored. Nothing in the
 *    engine tags a material colour, because the tag would have exactly one legal
 *    value; the numbers *are* the working space.
 * 2. **CSS-style colour strings denote sRGB values** (§60a, naming §50, §59 and
 *    §68). {@link parseColor} therefore returns **sRGB-encoded** components, and
 *    an application that hands one to a material or a light converts first:
 *
 *    ```ts
 *    const authored = parseColor("#a0a0a0");            // sRGB, 0…1
 *    const working: ColorRGBA = [0, 0, 0, 1];
 *    srgbToLinearRGBA(authored, working);               // linear-light
 *    new UnlitMaterial({ color: working });
 *    ```
 *
 *    The conversion is explicit rather than hidden inside the material because
 *    §101's shipped-name mapping is explicit in the other direction: "Colors are
 *    linear RGBA arrays in 0..1 (§60a), **not CSS strings**". Widening a material
 *    or light option to `ColorRGBA | string` is an API change §101 currently
 *    forbids for the MVP tier, so it is recorded as an owner question rather than
 *    taken here (R-15, 2026-08-08).
 * 3. **The output transform — tone mapping then sRGB encoding — is the final
 *    render-graph pass.** That half lives in `@four/render`'s `effect-pass.ts`
 *    (`OutputTransformEffect`) and the backends, not here; what lives here is
 *    {@link linearToSrgb}, the encode it performs, so a CPU-side read-back, a
 *    test, and the GPU can be checked against one definition.
 *
 * ## Extended range, and why nothing clamps
 *
 * §60a's pipeline carries values outside 0…1 (an HDR emissive is authored as
 * `[4, 2, 1]` today). The transfer functions here are therefore defined on the
 * whole real line by **odd extension** — `f(-x) = -f(x)`, the scRGB convention —
 * rather than by clamping to 0…1 first. Clamping would silently rewrite authored
 * data, which is the rule `UnlitMaterial` has recorded since WP-3.3 and the one
 * `@four/animation` keeps mid-tween.
 *
 * ## Allocation
 *
 * Every conversion takes a **required** `out` tuple and returns it (§7b, plan
 * D7's out-object convention): the conversions are hot-path — a per-frame
 * read-back, a per-particle tint — and a hidden allocation in one would be
 * invisible at the call site. Aliasing is explicit and supported: passing the
 * same array as `source` and `out` converts in place. {@link parseColor} is the
 * one exception and takes its `out` optionally, because parsing a string is
 * setup-time work by construction.
 */

/**
 * Straight (non-premultiplied) RGB, each component nominally in 0…1.
 *
 * §68's light colours (`DirectionalLight.color`, `Scene.ambientLight`) and §59's
 * `StandardMaterial.emissive` — the colours that carry no opacity of their own,
 * because a light has none and an emissive term is added rather than composited.
 *
 * A mutable 3-tuple rather than a `Vector3`, for {@link ColorRGBA}'s reason: a
 * colour is not a geometric vector, and a plain array uploads to `uniform3fv`
 * without an adapter. Untagged, unclamped — see the module header.
 */
export type ColorRGB = [red: number, green: number, blue: number];

/**
 * Straight (non-premultiplied) RGBA, each component nominally in 0…1.
 *
 * A mutable 4-tuple rather than a `Vector4`: a color is not a geometric vector
 * (adding two colors is not a transform, and none of `Vector4`'s dot/normalize
 * surface means anything here), and a plain array uploads to
 * `uniform4fv`/`Float32Array.set` without an adapter.
 *
 * No color space is attached, and components are **not clamped** anywhere:
 * §60a's pipeline is linear-light with extended range (the working space *is*
 * linear — see the module header), and clamping would silently rewrite authored
 * data (decision, WP-3.3; the same rule mid-tween, plan P4-2).
 */
export type ColorRGBA = [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

/**
 * The colour space a *resource* carries, as §60a's metadata (R-15, 2026-08-08).
 *
 * Attached to the things §60a says carry it — textures (§77) and render targets
 * (§63) — and to nothing else: a material colour, a light colour and a vertex
 * colour are working-space values by definition, so tagging them would give the
 * tag one legal value and invite the reader to think it had two.
 *
 * - `"linear"` — the values are already in the linear-light working space and
 *   are sampled or written as-is.
 * - `"srgb"` — the values are sRGB-encoded: a backend decodes them to linear on
 *   sample, and an output transform encodes into them on write.
 */
export type ColorSpace = "srgb" | "linear";

/** The sRGB piecewise transfer function's linear-segment slope (IEC 61966-2-1). */
const SRGB_SLOPE = 12.92;

/** The breakpoint of the encoded (sRGB) segment. */
const SRGB_ENCODED_BREAKPOINT = 0.04045;

/** The breakpoint of the linear segment. */
const SRGB_LINEAR_BREAKPOINT = 0.0031308;

/** Offset of the sRGB power segment. */
const SRGB_OFFSET = 0.055;

/** Scale of the sRGB power segment: `1 + SRGB_OFFSET`. */
const SRGB_SCALE = 1.055;

/** Exponent of the sRGB power segment, decode direction. */
const SRGB_EXPONENT = 2.4;

/**
 * Decodes one sRGB-encoded component to linear-light (§60a).
 *
 * The IEC 61966-2-1 piecewise function, extended to the whole real line by odd
 * symmetry (`f(-x) = -f(x)`) so an extended-range value survives a round trip
 * instead of being clamped — see the module header.
 *
 * ```ts
 * srgbToLinear(0);      // 0
 * srgbToLinear(1);      // 1
 * srgbToLinear(0.5);    // 0.21404114048223255 — mid sRGB is not mid linear
 * ```
 *
 * A non-finite argument is returned unchanged (`NaN` in, `NaN` out): §85's
 * finite check belongs to whatever *authored* the value, and a transfer function
 * that threw would put the check in the hot path.
 */
export function srgbToLinear(component: number): number {
  const magnitude = Math.abs(component);
  const decoded =
    magnitude <= SRGB_ENCODED_BREAKPOINT
      ? magnitude / SRGB_SLOPE
      : Math.pow((magnitude + SRGB_OFFSET) / SRGB_SCALE, SRGB_EXPONENT);
  return component < 0 ? -decoded : decoded;
}

/**
 * Encodes one linear-light component as sRGB (§60a) — the inverse of
 * {@link srgbToLinear}, and the arithmetic §60a's output transform performs.
 *
 * ```ts
 * linearToSrgb(0.21404114048223255);   // 0.5
 * ```
 *
 * Odd-extended and non-throwing on the same terms as {@link srgbToLinear}.
 */
export function linearToSrgb(component: number): number {
  const magnitude = Math.abs(component);
  const encoded =
    magnitude <= SRGB_LINEAR_BREAKPOINT
      ? magnitude * SRGB_SLOPE
      : SRGB_SCALE * Math.pow(magnitude, 1 / SRGB_EXPONENT) - SRGB_OFFSET;
  return component < 0 ? -encoded : encoded;
}

/**
 * Decodes an sRGB {@link ColorRGB} into `out` as linear-light, and returns
 * `out`.
 *
 * ```ts
 * const linear: ColorRGB = [0, 0, 0];
 * srgbToLinearRGB(parseColorRGB("#ffcc00"), linear);
 * ```
 *
 * `source` and `out` may be the same array (in-place conversion). Allocates
 * nothing.
 */
export function srgbToLinearRGB(
  source: readonly [number, number, number],
  out: ColorRGB,
): ColorRGB {
  out[0] = srgbToLinear(source[0]);
  out[1] = srgbToLinear(source[1]);
  out[2] = srgbToLinear(source[2]);
  return out;
}

/**
 * Encodes a linear-light {@link ColorRGB} into `out` as sRGB, and returns `out`
 * — the inverse of {@link srgbToLinearRGB}, aliasing-safe and allocation-free.
 */
export function linearToSrgbRGB(
  source: readonly [number, number, number],
  out: ColorRGB,
): ColorRGB {
  out[0] = linearToSrgb(source[0]);
  out[1] = linearToSrgb(source[1]);
  out[2] = linearToSrgb(source[2]);
  return out;
}

/**
 * Decodes an sRGB {@link ColorRGBA} into `out` as linear-light, and returns
 * `out`.
 *
 * **Alpha is copied, never transferred.** Opacity is a coverage fraction rather
 * than a light quantity, and every colour space in §60a's pipeline carries it
 * linearly; running it through the curve is the classic colour-management bug.
 *
 * `source` and `out` may be the same array. Allocates nothing.
 */
export function srgbToLinearRGBA(
  source: readonly [number, number, number, number],
  out: ColorRGBA,
): ColorRGBA {
  out[0] = srgbToLinear(source[0]);
  out[1] = srgbToLinear(source[1]);
  out[2] = srgbToLinear(source[2]);
  out[3] = source[3];
  return out;
}

/**
 * Encodes a linear-light {@link ColorRGBA} into `out` as sRGB, and returns `out`
 * — the inverse of {@link srgbToLinearRGBA}. Alpha is copied, not transferred;
 * aliasing-safe and allocation-free.
 */
export function linearToSrgbRGBA(
  source: readonly [number, number, number, number],
  out: ColorRGBA,
): ColorRGBA {
  out[0] = linearToSrgb(source[0]);
  out[1] = linearToSrgb(source[1]);
  out[2] = linearToSrgb(source[2]);
  out[3] = source[3];
  return out;
}

/**
 * The CSS colour keywords this tier resolves, sRGB-encoded in 0…1 (R-15).
 *
 * The **CSS Level 1 / HTML basic set** — sixteen keywords — plus
 * `transparent`. The remaining ~132 keywords of CSS Color 4 are a *table*, not a
 * design: adding them is a data change with a bundle-size cost (§86) and no new
 * behaviour, so this tier ships the set every one of the specification's own
 * examples draws from (§50's `"#ffffff"`, §59's `"#a0a0a0"`, §68's `"#ffffff"`
 * are all hex) and names the rest as staged (dated 2026-08-08).
 *
 * Values are eighths and quarters of 255 where CSS defines them so — `silver` is
 * `0xc0`, `gray` is `0x80` — divided by 255 exactly as a hex triplet is.
 */
const NAMED_COLORS = new Map<string, readonly [number, number, number]>([
  ["black", [0, 0, 0]],
  ["silver", [0xc0 / 255, 0xc0 / 255, 0xc0 / 255]],
  ["gray", [0x80 / 255, 0x80 / 255, 0x80 / 255]],
  ["white", [1, 1, 1]],
  ["maroon", [0x80 / 255, 0, 0]],
  ["red", [1, 0, 0]],
  ["purple", [0x80 / 255, 0, 0x80 / 255]],
  ["fuchsia", [1, 0, 1]],
  ["green", [0, 0x80 / 255, 0]],
  ["lime", [0, 1, 0]],
  ["olive", [0x80 / 255, 0x80 / 255, 0]],
  ["yellow", [1, 1, 0]],
  ["navy", [0, 0, 0x80 / 255]],
  ["blue", [0, 0, 1]],
  ["teal", [0, 0x80 / 255, 0x80 / 255]],
  ["aqua", [0, 1, 1]],
]);

/** Rejects a string this tier does not resolve, naming what it does (§85). */
function refuse(css: string): never {
  throw new TypeError(
    `Unrecognized color string ${JSON.stringify(css)}. This tier parses ` +
      `#rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() with numbers or ` +
      `percentages, "transparent", and the sixteen CSS Level 1 keywords ` +
      "(§60a, §85).",
  );
}

/**
 * Parses one `rgb()`/`rgba()` argument: a number, or a percentage of `full`.
 *
 * Returns `NaN` for anything that is not exactly one of those, which the caller
 * turns into a {@link refuse}; `Number` alone would accept `""` and `" 12 "`.
 */
function parseComponent(token: string, full: number): number {
  const percent = token.endsWith("%");
  const body = percent ? token.slice(0, -1) : token;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(body)) {
    return Number.NaN;
  }
  const value = Number(body);
  return percent ? value / 100 : value / full;
}

/** Splits an `rgb()` body into its component tokens, or `null` if malformed. */
function splitFunctionBody(body: string): readonly string[] | null {
  const slash = body.indexOf("/");
  if (slash >= 0) {
    // CSS Color 4 space-separated syntax: `rgb(255 128 0 / 50%)`.
    const head = body.slice(0, slash).trim().split(/\s+/);
    const tail = body.slice(slash + 1).trim();
    return tail === "" ? null : [...head, tail];
  }
  const tokens = body.includes(",")
    ? body.split(",").map((token) => token.trim())
    : body.trim().split(/\s+/);
  return tokens.some((token) => token === "") ? null : tokens;
}

/**
 * Parses a CSS colour string into **sRGB-encoded** components in 0…1 (§60a).
 *
 * ```ts
 * parseColor("#a0a0a0");                 // [0.627…, 0.627…, 0.627…, 1]
 * parseColor("rgb(255, 128, 0)");        // [1, 0.501…, 0, 1]
 * parseColor("rgba(255 128 0 / 50%)");   // [1, 0.501…, 0, 0.5]
 * parseColor("teal");                    // [0, 0.501…, 0.501…, 1]
 * ```
 *
 * ## What "sRGB-encoded" obliges the caller to do
 *
 * §60a: "CSS-style color strings used throughout the API (§50, §59, §68) denote
 * sRGB values", and the GPU pipeline is linear-light. The result of this
 * function is therefore **not** ready to hand to a material or a light — run it
 * through {@link srgbToLinearRGBA} first. The two steps are separate so that a
 * loader reading `#rrggbb` out of a document, a test asserting the byte value,
 * and a debug overlay printing what the author wrote all get the encoded value
 * they are actually talking about.
 *
 * ## The grammar this tier accepts
 *
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` (case-insensitive); `rgb(…)` and
 * `rgba(…)` with three components and an optional alpha, comma-separated or
 * space-separated with `/` before the alpha, each component a number `0…255` or
 * a percentage and the alpha a number `0…1` or a percentage; `transparent`; and
 * the sixteen CSS Level 1 keywords (`black`, `silver`, `gray`, `white`,
 * `maroon`, `red`, `purple`, `fuchsia`, `green`, `lime`, `olive`, `yellow`,
 * `navy`, `blue`, `teal`, `aqua`). Leading and trailing whitespace is ignored,
 * and keywords are case-insensitive.
 *
 * Everything else — `hsl()`, `lab()`, `color()`, `currentColor`, the other ~132
 * keywords — **throws a `TypeError`** naming what is accepted (§85). A full CSS
 * colour parser is not this tier: refusing loudly is what keeps an unsupported
 * notation from silently becoming black.
 *
 * Components are **not clamped**: `rgb(300 0 0)` parses to `[1.176…, 0, 0, 1]`,
 * because §60a's pipeline is extended-range and this function's job is to report
 * what the string said (module header).
 *
 * @param css - The colour string.
 * @param out - Optional destination, returned when given. Parsing is setup-time
 *   work, so this is optional where the transfer functions' out-parameters are
 *   required; it exists for a loader filling an array it already owns.
 */
export function parseColor(css: string, out?: ColorRGBA): ColorRGBA {
  const result: ColorRGBA = out ?? [0, 0, 0, 1];
  const text = css.trim();

  if (text.startsWith("#")) {
    const digits = text.slice(1);
    if (!/^(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(digits)) {
      refuse(css);
    }
    const short = digits.length <= 4;
    const size = short ? 1 : 2;
    const full = short ? 15 : 255;
    for (let channel = 0; channel < 4; channel += 1) {
      const start = channel * size;
      result[channel] =
        start < digits.length
          ? parseInt(digits.slice(start, start + size), 16) / full
          : 1;
    }
    return result;
  }

  const call = /^rgba?\(([^()]*)\)$/i.exec(text);
  if (call !== null) {
    const tokens = splitFunctionBody(call[1]);
    if (tokens === null || tokens.length < 3 || tokens.length > 4) {
      refuse(css);
    }
    const alpha = tokens.length === 4 ? parseComponent(tokens[3], 1) : 1;
    const red = parseComponent(tokens[0], 255);
    const green = parseComponent(tokens[1], 255);
    const blue = parseComponent(tokens[2], 255);
    if (
      Number.isNaN(red) ||
      Number.isNaN(green) ||
      Number.isNaN(blue) ||
      Number.isNaN(alpha)
    ) {
      refuse(css);
    }
    result[0] = red;
    result[1] = green;
    result[2] = blue;
    result[3] = alpha;
    return result;
  }

  const keyword = text.toLowerCase();
  if (keyword === "transparent") {
    result[0] = 0;
    result[1] = 0;
    result[2] = 0;
    result[3] = 0;
    return result;
  }
  const named = NAMED_COLORS.get(keyword);
  if (named === undefined) {
    refuse(css);
  }
  result[0] = named[0];
  result[1] = named[1];
  result[2] = named[2];
  result[3] = 1;
  return result;
}

/**
 * Scratch for {@link parseColorRGB}'s intermediate RGBA.
 *
 * Module-level and reused: parsing is single-threaded, setup-time, and never
 * re-entrant (nothing between the two writes can call back in), so one array
 * keeps `parseColorRGB(css, out)` allocation-free like every other
 * out-parameter function here.
 */
const parseScratch: ColorRGBA = [0, 0, 0, 1];

/**
 * {@link parseColor} without the alpha — the three-component form §68's light
 * colours and §59's emissive take.
 *
 * ```ts
 * const authored = parseColorRGB("#ffcc00");   // sRGB, 0…1
 * srgbToLinearRGB(authored, light.color);      // §60a: lights are linear-light
 * ```
 *
 * Accepts everything {@link parseColor} accepts, including strings that carry an
 * alpha, and **discards** it: a light has no opacity, and refusing
 * `rgba(255, 0, 0, 0.5)` here would make a shared palette unusable for lights.
 * The discard is the documented behaviour, not a rounding of it.
 */
export function parseColorRGB(css: string, out?: ColorRGB): ColorRGB {
  const parsed = parseColor(css, parseScratch);
  const result: ColorRGB = out ?? [0, 0, 0];
  result[0] = parsed[0];
  result[1] = parsed[1];
  result[2] = parsed[2];
  return result;
}
