/** Small, fast, seedable PRNG (mulberry32). Used for reproducible procedural levels. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Integer in [a, b] inclusive. */
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }

  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Seeded value noise + fbm used for procedural textures. */
export class Noise2D {
  private perm: Uint8Array;
  private vals: Float32Array;

  constructor(seed: number) {
    const rng = new Rng(seed);
    this.perm = new Uint8Array(512);
    this.vals = new Float32Array(256);
    const p: number[] = [];
    for (let i = 0; i < 256; i++) {
      p.push(i);
      this.vals[i] = rng.next();
    }
    rng.shuffle(p);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private v(ix: number, iy: number): number {
    return this.vals[this.perm[(this.perm[ix & 255] + iy) & 511]];
  }

  /** Value noise in [0,1]. Optionally wraps on x with period `wrapX`. */
  get(x: number, y: number, wrapX = 0): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    let ax = x0;
    let bx = x0 + 1;
    if (wrapX > 0) {
      ax = ((ax % wrapX) + wrapX) % wrapX;
      bx = ((bx % wrapX) + wrapX) % wrapX;
    }
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = this.v(ax, y0);
    const b = this.v(bx, y0);
    const c = this.v(ax, y0 + 1);
    const d = this.v(bx, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  fbm(x: number, y: number, octaves = 4, wrapX = 0): number {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.get(x * freq, y * freq, wrapX > 0 ? wrapX * freq : 0);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}
