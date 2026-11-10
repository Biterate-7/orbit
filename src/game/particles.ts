import type { Attractor } from './physics';

export const P_GRAVITY = 1;
export const P_SPARK = 2; // draws a 1px tail behind the particle
export const P_GLOW = 4; // additive blend

/**
 * Fixed-capacity struct-of-arrays particle pool. No allocations during gameplay.
 * Positions are in world units; particles render as crisp 1-2px squares.
 */
export class Particles {
  readonly cap: number;
  count = 0;
  limit: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly max: Float32Array;
  readonly drag: Float32Array;
  readonly color: Uint8Array;
  readonly color2: Uint8Array;
  readonly size: Uint8Array;
  readonly flags: Uint8Array;
  private palette: string[] = [];
  private paletteIndex = new Map<string, number>();

  constructor(cap: number) {
    this.cap = cap;
    this.limit = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.color = new Uint8Array(cap);
    this.color2 = new Uint8Array(cap);
    this.size = new Uint8Array(cap);
    this.flags = new Uint8Array(cap);
  }

  colorId(c: string): number {
    let id = this.paletteIndex.get(c);
    if (id === undefined) {
      id = this.palette.length;
      this.palette.push(c);
      this.paletteIndex.set(c, id);
    }
    return id;
  }

  colorOf(id: number): string {
    return this.palette[id];
  }

  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    color: string,
    size = 1,
    drag = 0,
    flags = 0,
    endColor?: string,
  ): void {
    if (this.count >= this.limit) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.drag[i] = drag;
    this.color[i] = this.colorId(color);
    this.color2[i] = this.colorId(endColor ?? color);
    this.size[i] = size;
    this.flags[i] = flags;
  }

  burst(
    x: number,
    y: number,
    n: number,
    speedMin: number,
    speedMax: number,
    life: number,
    colors: string[],
    opts: { baseVx?: number; baseVy?: number; drag?: number; size?: number; flags?: number; spread?: number; angle?: number } = {},
  ): void {
    const spread = opts.spread ?? Math.PI * 2;
    const angle = opts.angle ?? 0;
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speedMin + Math.random() * (speedMax - speedMin);
      const c = colors[(Math.random() * colors.length) | 0];
      const c2 = colors[colors.length - 1];
      this.spawn(
        x,
        y,
        (opts.baseVx ?? 0) + Math.cos(a) * s,
        (opts.baseVy ?? 0) + Math.sin(a) * s,
        life * (0.55 + Math.random() * 0.6),
        c,
        opts.size ?? (Math.random() < 0.25 ? 2 : 1),
        opts.drag ?? 1.6,
        opts.flags ?? 0,
        c2,
      );
    }
  }

  update(dt: number, attractors: readonly Attractor[] | null): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      if (attractors && this.flags[i] & P_GRAVITY) {
        for (const a of attractors) {
          const dx = a.x - this.x[i];
          const dy = a.y - this.y[i];
          const r2 = dx * dx + dy * dy + a.soft2;
          const inv = (a.mu * 0.5) / (r2 * Math.sqrt(r2));
          this.vx[i] += dx * inv * dt;
          this.vy[i] += dy * inv * dt;
        }
      }
      const dr = this.drag[i];
      if (dr > 0) {
        const k = Math.max(0, 1 - dr * dt);
        this.vx[i] *= k;
        this.vy[i] *= k;
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.life[i] = this.life[last];
    this.max[i] = this.max[last];
    this.drag[i] = this.drag[last];
    this.color[i] = this.color[last];
    this.color2[i] = this.color2[last];
    this.size[i] = this.size[last];
    this.flags[i] = this.flags[last];
  }

  clear(): void {
    this.count = 0;
  }

  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, zoom: number, ox: number, oy: number): void {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const t = this.life[i] / this.max[i];
      // Quantised fade keeps the pixel look.
      const a = t > 0.66 ? 1 : t > 0.4 ? 0.7 : t > 0.18 ? 0.45 : 0.22;
      const sx = Math.round((this.x[i] - camX) * zoom + ox);
      const sy = Math.round((this.y[i] - camY) * zoom + oy);
      const s = this.size[i];
      const f = this.flags[i];
      ctx.globalAlpha = a;
      ctx.globalCompositeOperation = f & P_GLOW ? 'lighter' : 'source-over';
      ctx.fillStyle = this.palette[t < 0.4 ? this.color2[i] : this.color[i]];
      ctx.fillRect(sx, sy, s, s);
      if (f & P_SPARK) {
        const tx = Math.round(sx - this.vx[i] * zoom * 0.03);
        const ty = Math.round(sy - this.vy[i] * zoom * 0.03);
        if (tx !== sx || ty !== sy) {
          ctx.globalAlpha = a * 0.5;
          ctx.fillRect(tx, ty, 1, 1);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
