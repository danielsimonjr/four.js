import { describe, expect, it } from "vitest";

import {
  LitMaterial,
  Material,
  SpriteMaterial,
  UnlitMaterial,
  type MaterialOptions,
  type SpriteTexture,
} from "../src/index.js";

describe("UnlitMaterial", () => {
  it("defaults to opaque white at version 0", () => {
    const material = new UnlitMaterial();

    expect(material.color).toEqual([1, 1, 1, 1]);
    expect(material.version).toBe(0);
    expect(material.disposed).toBe(false);
  });

  it('carries the "unlit" pipeline discriminant (§57, §64)', () => {
    expect(new UnlitMaterial().kind).toBe("unlit");
  });

  it("copies the supplied color instead of holding the caller's array", () => {
    const source: [number, number, number, number] = [0.25, 0.5, 0.75, 0.5];
    const material = new UnlitMaterial({ color: source });

    expect(material.color).toEqual(source);
    expect(material.color).not.toBe(source);

    source[0] = 1;
    expect(material.color[0]).toBe(0.25);
  });

  it("assigns monotonic, unique ids", () => {
    const first = new UnlitMaterial();
    const second = new UnlitMaterial();

    expect(first.id).toMatch(/^material-\d+$/);
    expect(second.id).not.toBe(first.id);

    const ordinal = (m: UnlitMaterial): number =>
      Number(m.id.slice("material-".length));
    expect(ordinal(second)).toBe(ordinal(first) + 1);
  });

  it("writes the color in place and bumps the version once", () => {
    const material = new UnlitMaterial();
    const color = material.color;

    expect(material.setColor(0.1, 0.2, 0.3, 0.4)).toBe(material);
    // The array instance is never replaced — a backend may hold a reference.
    expect(material.color).toBe(color);
    expect(material.color).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(material.version).toBe(1);
  });

  it("resets alpha to opaque when setColor is given three components", () => {
    const material = new UnlitMaterial({ color: [1, 1, 1, 0.2] });

    material.setColor(0, 0, 0);
    expect(material.color[3]).toBe(1);
  });

  it("announces in-place edits through markDirty", () => {
    const material = new UnlitMaterial();

    material.color[3] = 0.5;
    expect(material.version).toBe(0);

    material.markDirty();
    expect(material.version).toBe(1);
    expect(material.color[3]).toBe(0.5);
  });

  it("passes values outside 0…1 through unchanged", () => {
    const material = new UnlitMaterial({ color: [2, -1, 0.5, 1] });

    expect(material.color[0]).toBe(2);
    expect(material.color[1]).toBe(-1);

    material.setColor(4, 0, 0, 3);
    expect(material.color[0]).toBe(4);
    expect(material.color[3]).toBe(3);
  });

  it("rejects non-finite components (§85)", () => {
    expect(() => new UnlitMaterial({ color: [Number.NaN, 0, 0, 1] })).toThrow(
      RangeError,
    );
    expect(
      () => new UnlitMaterial({ color: [0, Number.POSITIVE_INFINITY, 0, 1] }),
    ).toThrow(/must be finite/);

    const material = new UnlitMaterial();
    expect(() => material.setColor(0.2, 0.3, Number.NaN)).toThrow(RangeError);
    expect(() => material.setColor(0, 0, 0, Number.NaN)).toThrow(RangeError);
    expect(material.version).toBe(0);
    // A rejected call is atomic (2026-08-04 review fix): nothing was written,
    // so the color is not torn — previously `[0.2, 0.3, 1, 1]` survived the
    // throw while the version stayed 0, splitting backend and CPU views.
    expect(material.color).toEqual([1, 1, 1, 1]);
  });

  it("disposes once, keeps the color, and bumps the version (§83)", () => {
    const material = new UnlitMaterial({ color: [0, 0.5, 1, 1] });

    material.dispose();
    expect(material.disposed).toBe(true);
    expect(material.version).toBe(1);
    expect(material.color).toEqual([0, 0.5, 1, 1]);

    material.dispose();
    expect(material.version).toBe(1);
  });
});

describe("LitMaterial", () => {
  it("defaults to opaque white at version 0", () => {
    const material = new LitMaterial();

    expect(material.color).toEqual([1, 1, 1, 1]);
    expect(material.version).toBe(0);
    expect(material.disposed).toBe(false);
  });

  it('carries the "lit" pipeline discriminant (§57, §64, §68)', () => {
    expect(new LitMaterial().kind).toBe("lit");
  });

  it("copies the supplied color instead of holding the caller's array", () => {
    const source: [number, number, number, number] = [0.25, 0.5, 0.75, 0.5];
    const material = new LitMaterial({ color: source });

    expect(material.color).toEqual(source);
    expect(material.color).not.toBe(source);

    source[0] = 1;
    expect(material.color[0]).toBe(0.25);
  });

  it("assigns monotonic ids in an id space of its own", () => {
    const first = new LitMaterial();
    const second = new LitMaterial();
    const unlit = new UnlitMaterial();

    expect(first.id).toMatch(/^lit-material-\d+$/);
    // Distinct prefixes, so the two counters cannot mint a colliding cache key.
    expect(unlit.id).not.toMatch(/^lit-material-/);

    const ordinal = (m: LitMaterial): number =>
      Number(m.id.slice("lit-material-".length));
    expect(ordinal(second)).toBe(ordinal(first) + 1);
  });

  it("writes the color in place and bumps the version once", () => {
    const material = new LitMaterial();
    const color = material.color;

    expect(material.setColor(0.1, 0.2, 0.3, 0.4)).toBe(material);
    // The array instance is never replaced — a backend may hold a reference.
    expect(material.color).toBe(color);
    expect(material.color).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(material.version).toBe(1);
  });

  it("resets alpha to opaque when setColor is given three components", () => {
    const material = new LitMaterial({ color: [1, 1, 1, 0.2] });

    material.setColor(0, 0, 0);
    expect(material.color[3]).toBe(1);
  });

  it("announces in-place edits through markDirty", () => {
    const material = new LitMaterial();

    material.color[3] = 0.5;
    expect(material.version).toBe(0);

    material.markDirty();
    expect(material.version).toBe(1);
    expect(material.color[3]).toBe(0.5);
  });

  it("passes values outside 0…1 through unchanged (§60a deferral)", () => {
    const material = new LitMaterial({ color: [2, -1, 0.5, 1] });

    expect(material.color[0]).toBe(2);
    expect(material.color[1]).toBe(-1);

    material.setColor(4, 0, 0, 3);
    expect(material.color[0]).toBe(4);
    expect(material.color[3]).toBe(3);
  });

  it("rejects non-finite components (§85)", () => {
    expect(() => new LitMaterial({ color: [Number.NaN, 0, 0, 1] })).toThrow(
      RangeError,
    );
    expect(
      () => new LitMaterial({ color: [0, Number.POSITIVE_INFINITY, 0, 1] }),
    ).toThrow(/must be finite/);

    const material = new LitMaterial();
    expect(() => material.setColor(0, 0, Number.NaN)).toThrow(RangeError);
    expect(() => material.setColor(0, 0, 0, Number.NaN)).toThrow(RangeError);
    expect(material.version).toBe(0);
  });

  it("disposes once, keeps the color, and bumps the version (§83)", () => {
    const material = new LitMaterial({ color: [0, 0.5, 1, 1] });

    material.dispose();
    expect(material.disposed).toBe(true);
    expect(material.version).toBe(1);
    expect(material.color).toEqual([0, 0.5, 1, 1]);

    material.dispose();
    expect(material.version).toBe(1);
  });
});

/**
 * A `SpriteTexture` built by hand.
 *
 * `@four/materials` sits *below* `@four/render` in the frozen dependency matrix
 * (plan §3.1), so the concrete `Texture` class is not importable here — which is
 * the whole point of the `SpriteTexture` structural contract this package
 * declares. Building one by hand is therefore not a shortcut but the exact thing
 * under test: anything that satisfies the interface must work as a texture, and
 * a plain object literal is the smallest proof of that.
 */
function fakeTexture(id = "texture-test-1"): SpriteTexture {
  return {
    id,
    version: 0,
    width: 2,
    height: 2,
    data: new Uint8Array(16),
    disposed: false,
  };
}

describe("SpriteMaterial", () => {
  it("defaults to an opaque white tint at version 0", () => {
    const texture = fakeTexture();
    const material = new SpriteMaterial({ texture });

    expect(material.texture).toBe(texture);
    expect(material.tint).toEqual([1, 1, 1, 1]);
    expect(material.version).toBe(0);
    expect(material.disposed).toBe(false);
  });

  it("copies the supplied tint instead of holding the caller's array", () => {
    const source: [number, number, number, number] = [0.25, 0.5, 0.75, 0.5];
    const material = new SpriteMaterial({
      texture: fakeTexture(),
      tint: source,
    });

    expect(material.tint).toEqual(source);
    expect(material.tint).not.toBe(source);

    source[0] = 1;
    expect(material.tint[0]).toBe(0.25);
  });

  it("assigns monotonic ids in an id space of its own", () => {
    const first = new SpriteMaterial({ texture: fakeTexture() });
    const second = new SpriteMaterial({ texture: fakeTexture() });
    const unlit = new UnlitMaterial();

    expect(first.id).toMatch(/^sprite-material-\d+$/);
    // Distinct prefixes, so the two counters cannot mint a colliding cache key.
    expect(unlit.id).not.toMatch(/^sprite-material-/);

    const ordinal = (m: SpriteMaterial): number =>
      Number(m.id.slice("sprite-material-".length));
    expect(ordinal(second)).toBe(ordinal(first) + 1);
  });

  it("writes the tint in place and bumps the version once", () => {
    const material = new SpriteMaterial({ texture: fakeTexture() });
    const tint = material.tint;

    expect(material.setTint(0.1, 0.2, 0.3, 0.4)).toBe(material);
    // The array instance is never replaced — a backend may hold a reference.
    expect(material.tint).toBe(tint);
    expect(material.tint).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(material.version).toBe(1);
  });

  it("resets alpha to opaque when setTint is given three components", () => {
    const material = new SpriteMaterial({
      texture: fakeTexture(),
      tint: [1, 1, 1, 0.2],
    });

    material.setTint(0, 0, 0);
    expect(material.tint[3]).toBe(1);
  });

  it("announces in-place tint edits through markDirty", () => {
    const material = new SpriteMaterial({ texture: fakeTexture() });

    material.tint[3] = 0.5;
    expect(material.version).toBe(0);

    material.markDirty();
    expect(material.version).toBe(1);
  });

  it("rejects non-finite tint components (§85)", () => {
    expect(
      () =>
        new SpriteMaterial({
          texture: fakeTexture(),
          tint: [Number.NaN, 0, 0, 1],
        }),
    ).toThrow(/must be finite/);

    const material = new SpriteMaterial({ texture: fakeTexture() });
    expect(() => material.setTint(0, 0, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(material.version).toBe(0);
  });

  it("bumps the version when the texture is swapped, without disposing the old one", () => {
    const first = fakeTexture("texture-test-a");
    const second = fakeTexture("texture-test-b");
    const material = new SpriteMaterial({ texture: first });

    material.texture = second;

    expect(material.texture).toBe(second);
    expect(material.version).toBe(1);
    expect(first.disposed).toBe(false);
  });

  it("does not follow the texture's own version", () => {
    const texture = fakeTexture();
    const material = new SpriteMaterial({ texture });

    // A texel edit bumps the *texture*'s version; the material is unchanged,
    // and a backend validates its upload against the texture's counter.
    const edited: SpriteTexture = { ...texture, version: 7 };
    expect(material.version).toBe(0);
    expect(edited.version).toBe(7);
  });

  it("disposes once, keeps the tint, and never disposes the texture (§83)", () => {
    const texture = fakeTexture();
    const material = new SpriteMaterial({ texture, tint: [0, 0.5, 1, 1] });

    material.dispose();
    expect(material.disposed).toBe(true);
    expect(material.version).toBe(1);
    expect(material.tint).toEqual([0, 0.5, 1, 1]);
    // The texture is shared: whoever created it disposes it.
    expect(material.texture.disposed).toBe(false);

    material.dispose();
    expect(material.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §57's abstract base (`material.ts`, 2026-08-06) — the render state every
// family member shares, and the defaults that make it a no-op for scenes
// authored before it existed.
// ---------------------------------------------------------------------------

/**
 * The three shipped family members, each built with its own required
 * arguments, so every assertion below runs against all of them: §57 puts this
 * state on the *base*, and a subclass that forgot to pass its options through
 * would be a silent hole in that promise.
 */
const familyMembers: readonly {
  readonly name: string;
  readonly make: (options?: MaterialOptions) => Material;
}[] = [
  { name: "UnlitMaterial", make: (options) => new UnlitMaterial(options) },
  { name: "LitMaterial", make: (options) => new LitMaterial(options) },
  {
    name: "SpriteMaterial",
    make: (options) =>
      new SpriteMaterial({ texture: fakeTexture(), ...options }),
  },
];

describe("Material — §57's shared render state", () => {
  for (const { name, make } of familyMembers) {
    describe(name, () => {
      it("defaults to the state the backend drew with before the base existed", () => {
        const material = make();

        expect(material.opacity).toBe(1);
        expect(material.transparent).toBe(false);
        expect(material.blendMode).toBe("normal");
        expect(material.depthTest).toBe(true);
        expect(material.depthWrite).toBe(true);
        expect(material.colorWrite).toBe(true);
      });

      it("takes every §57 field from its options", () => {
        const material = make({
          opacity: 0.25,
          transparent: true,
          blendMode: "additive",
          depthTest: false,
          depthWrite: false,
          colorWrite: false,
        });

        expect(material.opacity).toBe(0.25);
        expect(material.transparent).toBe(true);
        expect(material.blendMode).toBe("additive");
        expect(material.depthTest).toBe(false);
        expect(material.depthWrite).toBe(false);
        expect(material.colorWrite).toBe(false);
      });

      it("rejects a non-finite opacity (§85)", () => {
        expect(() => make({ opacity: Number.NaN })).toThrow(RangeError);
        expect(() => make({ opacity: Number.POSITIVE_INFINITY })).toThrow(
          RangeError,
        );
      });

      it("does not bump the version for a render-state write", () => {
        const material = make();

        material.opacity = 0.5;
        material.transparent = true;
        material.blendMode = "multiply";
        material.depthWrite = false;

        // Render state is read per draw, never cached — there is nothing to
        // invalidate, so nothing is announced (see `material.ts`).
        expect(material.version).toBe(0);
      });

      it("is a Material, and disposes through the base (§83)", () => {
        const material = make();

        expect(material).toBeInstanceOf(Material);
        material.dispose();
        material.dispose();

        expect(material.disposed).toBe(true);
        expect(material.version).toBe(1);
      });
    });
  }

  it("mints ids from one counter, behind one prefix per family member", () => {
    const unlit = new UnlitMaterial();
    const lit = new LitMaterial();
    const sprite = new SpriteMaterial({ texture: fakeTexture() });

    expect(unlit.id).toMatch(/^material-\d+$/);
    expect(lit.id).toMatch(/^lit-material-\d+$/);
    expect(sprite.id).toMatch(/^sprite-material-\d+$/);

    // One counter: three consecutive constructions take three consecutive
    // ordinals, whatever family member each one is. Distinct prefixes are what
    // keep the ids themselves from colliding (§33, §83 cache keys).
    const ordinal = (material: Material): number =>
      Number(material.id.slice(material.id.lastIndexOf("-") + 1));
    expect(ordinal(lit)).toBe(ordinal(unlit) + 1);
    expect(ordinal(sprite)).toBe(ordinal(lit) + 1);
  });

  it("gives each family member the pipeline discriminant a render list reads", () => {
    expect(new UnlitMaterial().kind).toBe("unlit");
    expect(new LitMaterial().kind).toBe("lit");
    expect(new SpriteMaterial({ texture: fakeTexture() }).kind).toBe("sprite");
  });

  it("accepts a consumer's own family member, with no edit to this package", () => {
    // The extensibility R-12 was about: a fourth material, declared outside
    // `@four/materials`, carrying the shared state and its own discriminant.
    class GlowMaterial extends Material {
      readonly kind = "glow" as const;

      constructor(options: MaterialOptions = {}) {
        super("glow-material", {
          transparent: true,
          blendMode: "additive",
          ...options,
        });
      }
    }

    const material = new GlowMaterial();
    expect(material.id).toMatch(/^glow-material-\d+$/);
    expect(material.kind).toBe("glow");
    expect(material.transparent).toBe(true);
    expect(material.blendMode).toBe("additive");
    expect(new GlowMaterial({ blendMode: "screen" }).blendMode).toBe("screen");
  });
});
