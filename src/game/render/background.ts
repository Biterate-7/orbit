import type { PixelSprite } from '../../astronomy/database/schema';
import { bayer, hexToRgb } from '../math';
import { Noise2D, Rng } from '../rng';
import type { BackgroundSpec } from '../types';
import { ctx2d, makeCanvas } from './pixel';

const STAR_COLORS = ['#e8f0ff', '#e8f0ff', '#e8f0ff', '#bfd0ff', '#9fb4ff', '#7ffcff', '#c9a8ff', '#ffd8a8'];

/** Three-layer parallax pixel starfield with twinkle, warp streaks and black-hole lensing. */
export class Starfield {
  private n = 0;
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private depth = new Float32Array(0);
  private color = new Uint8Array(0);
  private tw = new Float32Array(0);
  private big = new Uint8Array(0);
  private W = 1;
  private H = 1;
  private seed: number;
  private density: number;
  private colors: string[];

  /** Each level has its own sky: a seed, a density and a tint set chosen by the generator. */
  constructor(seed: number, density = 1, colors: string[] = STAR_COLORS) {
    this.seed = seed;
    this.density = density;
    this.colors = colors.length > 0 ? colors : STAR_COLORS;
  }

  resize(vw: number, vh: number): void {
    const margin = 40;
    this.W = vw + margin * 2;
    this.H = vh + margin * 2;
    const rng = new Rng(this.seed);
    this.n = Math.floor(((this.W * this.H) / 520) * this.density);
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.depth = new Float32Array(this.n);
    this.color = new Uint8Array(this.n);
    this.tw = new Float32Array(this.n);
    this.big = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.x[i] = rng.range(0, this.W);
      this.y[i] = rng.range(0, this.H);
      const layer = rng.next();
      this.depth[i] = layer < 0.6 ? 0.04 : layer < 0.9 ? 0.1 : 0.2;
      this.color[i] = rng.int(0, this.colors.length - 1);
      this.tw[i] = rng.chance(0.3) ? rng.range(0.6, 3.2) : 0;
      this.big[i] = rng.chance(0.025) ? 1 : 0;
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    vw: number,
    vh: number,
    camPx: number,
    camPy: number,
    time: number,
    warp: number,
    lens: { x: number; y: number; r: number } | null,
    dim: number,
  ): void {
    const margin = (this.W - vw) / 2;
    const cx = vw / 2;
    const cy = vh / 2;
    for (let i = 0; i < this.n; i++) {
      const dpt = this.depth[i];
      let sx = this.x[i] - camPx * dpt;
      let sy = this.y[i] - camPy * dpt;
      sx = ((sx % this.W) + this.W) % this.W - margin;
      sy = ((sy % this.H) + this.H) % this.H - margin;
      if (sx < -2 || sy < -2 || sx > vw + 2 || sy > vh + 2) continue;
      let a = dpt > 0.15 ? 1 : dpt > 0.08 ? 0.75 : 0.5;
      if (this.tw[i] > 0) {
        const t = Math.sin(time * this.tw[i] + i * 1.7);
        a *= t > 0.6 ? 1 : t > -0.3 ? 0.6 : 0.25;
      }
      a *= dim;
      if (lens) {
        const dx = sx - lens.x;
        const dy = sy - lens.y;
        const d = Math.hypot(dx, dy);
        if (d < lens.r * 3 && d > 0.5) {
          const nd = d + (lens.r * lens.r) / d;
          sx = lens.x + (dx / d) * nd;
          sy = lens.y + (dy / d) * nd;
          if (nd < lens.r * 1.4) a = Math.min(1, a * 1.8);
        }
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = this.colors[this.color[i]];
      const px = Math.round(sx);
      const py = Math.round(sy);
      if (warp > 0.02) {
        const dx = sx - cx;
        const dy = sy - cy;
        const d = Math.hypot(dx, dy) || 1;
        const len = Math.floor(warp * (6 + 60 * dpt * 5) * (0.3 + d / Math.max(vw, vh)));
        for (let s = 0; s < len; s++) {
          ctx.fillRect(Math.round(px + (dx / d) * s), Math.round(py + (dy / d) * s), 1, 1);
        }
      } else if (this.big[i]) {
        ctx.fillRect(px, py, 1, 1);
        ctx.globalAlpha = a * 0.5;
        ctx.fillRect(px - 1, py, 1, 1);
        ctx.fillRect(px + 1, py, 1, 1);
        ctx.fillRect(px, py - 1, 1, 1);
        ctx.fillRect(px, py + 1, 1, 1);
      } else {
        ctx.fillRect(px, py, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** Dithered pixel nebula rendered at half resolution, regenerated per level / resize. */
export class NebulaLayer {
  canvas: HTMLCanvasElement | null = null;
  private key = '';

  /**
   * `sprite` (optional) is the pixel translation of a real image of the level's object. When
   * present, its brightness shapes where the nebula is dense and its colours tint the gas, so the
   * backdrop echoes the real object's structure without ever showing the photograph itself.
   */
  build(vw: number, vh: number, seed: number, colorA: string, colorB: string, strength: number, sprite: PixelSprite | null = null): void {
    const key = `${vw}x${vh}:${seed}:${colorA}:${colorB}:${strength}:${sprite ? sprite.data.length + sprite.palette.join('') : ''}`;
    if (key === this.key) return;
    this.key = key;
    const w = Math.ceil(vw / 2) + 24;
    const h = Math.ceil(vh / 2) + 24;
    const c = makeCanvas(w, h);
    const g = ctx2d(c);
    const img = g.createImageData(w, h);
    const n = new Noise2D(seed);
    const A = hexToRgb(colorA);
    const B = hexToRgb(colorB);
    const sc = 1 / 70;
    const pal = sprite ? sprite.palette.map(hexToRgb) : [];
    const side = Math.min(w, h) * 1.25;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const wx = n.fbm(x * sc * 0.7 + 11, y * sc * 0.7 + 3, 2) * 2.5;
        const v = n.fbm(x * sc + wx, y * sc - wx * 0.6, 4);
        const mix = n.get(x * sc * 0.5 + 40, y * sc * 0.5 + 9);
        let dens = Math.max(0, v - 0.42) * 2.6 * strength;
        let col = mix > 0.5 ? A : B;
        if (sprite) {
          // Sample the sprite, centred and warped a little so it reads as gas rather than a tile.
          const su = (x - w / 2) / side + 0.5 + (wx - 1.25) * 0.02;
          const sv = (y - h / 2) / side + 0.5 - (wx - 1.25) * 0.02;
          if (su >= 0 && su < 1 && sv >= 0 && sv < 1) {
            const p = pal[parseInt(sprite.data[Math.floor(sv * sprite.h) * sprite.w + Math.floor(su * sprite.w)], 16)];
            const lum = (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255;
            const edge = Math.min(1, Math.min(su, 1 - su, sv, 1 - sv) * 6);
            dens = dens * (1 - edge * 0.6) + edge * Math.max(0, lum - 0.12) * (0.5 + v) * 2.2 * strength;
            if (lum > 0.14 && mix > 0.3) col = [Math.round(p[0] * 0.62), Math.round(p[1] * 0.62), Math.round(p[2] * 0.62)];
          }
        }
        const lv = Math.floor(dens * 4 + bayer(x, y) - 0.5);
        if (lv <= 0) continue;
        const i = (y * w + x) * 4;
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = Math.min(255, lv * 34);
      }
    }
    g.putImageData(img, 0, 0);
    this.canvas = c;
  }

  draw(ctx: CanvasRenderingContext2D, camPx: number, camPy: number, time: number, alpha: number): void {
    if (!this.canvas || alpha <= 0) return;
    const ox = Math.round(-12 - camPx * 0.03 + Math.sin(time * 0.05) * 4);
    const oy = Math.round(-12 - camPy * 0.03 + Math.cos(time * 0.04) * 3);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.canvas, ox * 2, oy * 2, this.canvas.width * 2, this.canvas.height * 2);
    ctx.globalAlpha = 1;
  }
}

/**
 * Static far-background composition, rendered once per level: the host star(s) a planet orbits,
 * faint background galaxies for deep-field levels, and the band of unresolved stars seen from
 * inside a galaxy. Drawn with a slow parallax between the nebula and the star field.
 */
export class Backdrop {
  canvas: HTMLCanvasElement | null = null;
  private key = '';
  private margin = 16;

  build(vw: number, vh: number, spec: BackgroundSpec): void {
    const key = `${vw}x${vh}:${spec.starSeed}:${spec.hostStars.length}:${spec.galaxies}:${spec.band}`;
    if (key === this.key) return;
    this.key = key;
    if (spec.hostStars.length === 0 && spec.galaxies === 0 && !spec.band) {
      this.canvas = null;
      return;
    }
    const m = this.margin;
    const w = vw + m * 2;
    const h = vh + m * 2;
    const c = makeCanvas(w, h);
    const g = ctx2d(c);
    const img = g.createImageData(w, h);
    const d = img.data;
    const rng = new Rng(spec.starSeed ^ 0x5bd1e995);
    const noise = new Noise2D(spec.starSeed);
    const plot = (x: number, y: number, col: [number, number, number], a: number): void => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      if (d[i + 3] >= a) return;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = a;
    };

    if (spec.band) {
      // A diagonal river of unresolved starlight with darker dust lanes through it.
      const tilt = rng.range(-0.5, 0.5);
      const cy = h * rng.range(0.35, 0.65);
      const warm: [number, number, number] = [200, 190, 230];
      const cool: [number, number, number] = [120, 130, 200];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const off = Math.abs(y - cy - (x - w / 2) * tilt) / (h * 0.2);
          if (off > 1) continue;
          const dust = noise.fbm(x / 26 + 3, y / 26 + 7, 3);
          const v = (1 - off * off) * (0.25 + 0.75 * noise.fbm(x / 60, y / 60, 3)) * (dust < 0.42 ? 0.2 : 1);
          if (v * 0.9 < bayer(x, y) + 0.12) continue;
          plot(x, y, dust > 0.6 ? warm : cool, 70);
        }
      }
    }

    for (let k = 0; k < spec.galaxies; k++) {
      // Small tilted ellipses with a bright core: distant galaxies, a few pixels each.
      const gx = Math.floor(rng.range(0.06, 0.94) * w);
      const gy = Math.floor(rng.range(0.06, 0.94) * h);
      const major = rng.range(4, 10);
      const minor = major * rng.range(0.25, 0.8);
      const rot = rng.range(0, Math.PI);
      const col = hexToRgb(rng.pick(['#fff0d0', '#b8c4ff', '#ffd8a8', '#c9a8ff']));
      const ca = Math.cos(rot);
      const sa = Math.sin(rot);
      const R = Math.ceil(major);
      for (let y = -R; y <= R; y++) {
        for (let x = -R; x <= R; x++) {
          const u = (x * ca + y * sa) / major;
          const v = (-x * sa + y * ca) / minor;
          const r2 = u * u + v * v;
          if (r2 > 1) continue;
          const lum = Math.pow(1 - r2, 1.5);
          if (lum < bayer(gx + x, gy + y) * 0.9) continue;
          plot(gx + x, gy + y, col, r2 < 0.06 ? 230 : 120);
        }
      }
    }

    for (const s of spec.hostStars) {
      // A sun seen from its planet: hard bright core, dithered corona, four diffraction spikes.
      const sx = Math.floor(s.x * vw) + m;
      const sy = Math.floor(s.y * vh) + m;
      const col = hexToRgb(s.color);
      const white: [number, number, number] = [255, 255, 255];
      const R = Math.ceil(s.size * 2.6);
      for (let y = -R; y <= R; y++) {
        for (let x = -R; x <= R; x++) {
          const r = Math.sqrt(x * x + y * y);
          if (r <= s.size * 0.55) plot(sx + x, sy + y, white, 255);
          else if (r <= s.size) plot(sx + x, sy + y, col, 255);
          else if (r <= R && Math.pow(1 - (r - s.size) / (R - s.size), 2) > bayer(sx + x, sy + y)) plot(sx + x, sy + y, col, 150);
        }
      }
      const spike = Math.round(s.size * 3.4);
      for (let i = Math.ceil(s.size); i <= spike; i++) {
        const a = i < spike * 0.6 ? 220 : 110;
        plot(sx + i, sy, col, a);
        plot(sx - i, sy, col, a);
        plot(sx, sy + i, col, a);
        plot(sx, sy - i, col, a);
      }
    }

    g.putImageData(img, 0, 0);
    this.canvas = c;
  }

  draw(ctx: CanvasRenderingContext2D, camPx: number, camPy: number, alpha: number): void {
    if (!this.canvas || alpha <= 0) return;
    const m = this.margin;
    const ox = Math.round(Math.max(-m, Math.min(m, -camPx * 0.02)) - m);
    const oy = Math.round(Math.max(-m, Math.min(m, -camPy * 0.02)) - m);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.canvas, ox, oy);
    ctx.globalAlpha = 1;
  }
}

/** Screen-door dithered fog with a clear bubble around the ship (nebula visibility). */
export class FogLayer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private img: ImageData | null = null;
  private w = 0;
  private h = 0;

  private ensure(vw: number, vh: number): void {
    const w = Math.ceil(vw / 2);
    const h = Math.ceil(vh / 2);
    if (this.canvas && w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas = makeCanvas(w, h);
    this.ctx = ctx2d(this.canvas);
    this.img = this.ctx.createImageData(w, h);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    vw: number,
    vh: number,
    holes: { x: number; y: number; r: number }[],
    color: string,
    density: number,
    time: number,
  ): void {
    if (density <= 0) return;
    this.ensure(vw, vh);
    const img = this.img!;
    const d = img.data;
    const [cr, cg, cb] = hexToRgb(color);
    const w = this.w;
    const h = this.h;
    // Uniform translucent haze; dithering only where the clear bubbles fade out, which keeps it crisp.
    const alpha = Math.round(255 * Math.min(1, density));
    const swirl = time * 0.6;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let cover = 1;
        for (const hole of holes) {
          const dx = x * 2 - hole.x;
          const dy = y * 2 - hole.y;
          const wob = 1 + 0.06 * Math.sin(Math.atan2(dy, dx) * 5 + swirl);
          const dd = Math.sqrt(dx * dx + dy * dy) / (hole.r * wob);
          if (dd < 1) {
            const k = dd < 0.6 ? 0 : (dd - 0.6) / 0.4;
            if (k < cover) cover = k;
          }
        }
        const i = (y * w + x) * 4;
        if (cover >= 1 || cover > bayer(x, y)) {
          d[i] = cr;
          d[i + 1] = cg;
          d[i + 2] = cb;
          d[i + 3] = alpha;
        } else {
          d[i + 3] = 0;
        }
      }
    }
    this.ctx!.putImageData(img, 0, 0);
    ctx.drawImage(this.canvas!, 0, 0, w * 2, h * 2);
  }
}
