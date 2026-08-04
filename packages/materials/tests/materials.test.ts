import { describe, expect, it } from "vitest";

import {
  LitMaterial,
  SpriteMaterial,
  UnlitMaterial,
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
    expect(() => material.setColor(0, 0, Number.NaN)).toThrow(RangeError);
    expect(() => material.setColor(0, 0, 0, Number.NaN)).toThrow(RangeError);
    expect(material.version).toBe(0);
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
