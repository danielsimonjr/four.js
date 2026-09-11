import { Rectangle2 } from "@fourjs/math";

/** Bounded change history. Readers never consume another backend's updates. */
export class TextureUpdates {
  // Allocate the ring only when regional uploads are requested. Full-image updates
  // retain the original allocation-free markDirty() path.
  #versions: Float64Array | null = null;
  #regions: Float64Array | null = null;
  #head = 0;
  #count = 0;
  #fullVersion = 0;

  add(
    version: number,
    region: Rectangle2 | null,
    width: number,
    height: number,
  ): void {
    if (region === null) {
      this.#fullVersion = version;
      this.#head = 0;
      this.#count = 0;
      return;
    }
    const { x, y, width: w, height: h } = region;
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      !Number.isSafeInteger(w) ||
      !Number.isSafeInteger(h) ||
      x < 0 ||
      y < 0 ||
      w < 1 ||
      h < 1 ||
      x + w > width ||
      y + h > height
    ) {
      throw new RangeError(
        "Texture dirty region must be a nonempty integer rectangle inside the texture.",
      );
    }
    this.#versions ??= new Float64Array(32);
    this.#regions ??= new Float64Array(128);
    const slot = (this.#head + this.#count) % 32;
    this.#versions[slot] = version;
    this.#regions[slot * 4] = x;
    this.#regions[slot * 4 + 1] = y;
    this.#regions[slot * 4 + 2] = w;
    this.#regions[slot * 4 + 3] = h;
    if (this.#count === 32) this.#head = (this.#head + 1) % 32;
    else this.#count++;
  }

  since(version: number, current: number): Rectangle2 | null {
    const versions = this.#versions,
      regions = this.#regions;
    if (
      !Number.isSafeInteger(version) ||
      version < this.#fullVersion ||
      version >= current ||
      this.#count === 0 ||
      versions === null ||
      regions === null ||
      version < versions[this.#head] - 1
    )
      return null;
    let x = Infinity,
      y = Infinity,
      right = -Infinity,
      top = -Infinity;
    for (let i = 0; i < this.#count; i++) {
      const slot = (this.#head + i) % 32;
      if (versions[slot] <= version) continue;
      const start = slot * 4,
        rx = regions[start],
        ry = regions[start + 1];
      x = Math.min(x, rx);
      y = Math.min(y, ry);
      right = Math.max(right, rx + regions[start + 2]);
      top = Math.max(top, ry + regions[start + 3]);
    }
    return new Rectangle2(x, y, right - x, top - y);
  }
}
