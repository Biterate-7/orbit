import { bayer, hexToRgb, TAU } from '../math';
import { Noise2D } from '../rng';
import type { BodyKind } from '../types';
import { ctx2d, makeCanvas } from './pixel';

type RGB = [number, number, number];
const ramp = (hex: string[]): RGB[] => hex.map(hexToRgb);

const RAMPS: Record<string, RGB[]> = {
  planet: ramp(['#08071a', '#15143a', '#252a5e', '#3a4c8c', '#5a7bb8', '#8fb3e0', '#c9e2ff']),
  gasgiant: ramp(['#0b0820', '#1c1450', '#33278a', '#5046b8', '#7a78df', '#aab4ff', '#dfe6ff']),
  ring: ramp(['#1a1440', '#3a2f7a', '#6a5fb8', '#a49ae6']),
  redgiant: ramp(['#2a0508', '#5c0d14', '#9c1a1a', '#d8361e', '#ff6a2a', '#ffa04a', '#ffd890']),
  neutron: ramp(['#1a7f8f', '#3ef2ff', '#bff9ff', '#ffffff']),
  disk: ramp(['#0e0620', '#24103d', '#4b1f6b', '#86307a', '#cc4a4a', '#ff8a3d', '#ffd890', '#ffffff']),
  moon: ramp(['#0c0d18', '#22263c', '#41475f', '#6b7290', '#a3aac4', '#d6dbee']),
};

const LIGHT = (() => {
  const v = [-0.55, -0.5, 0.67];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / l) as [number, number, number];
})();

const TEX_W = 128;
const TEX_H = 64;

/**
 * Renders a pixel-art celestial body into an offscreen canvas every frame.
 * Sphere projection data is precomputed once per pixel radius; per frame we only rotate texture lookups.
 */
export class BodyRenderer {
  readonly kind: BodyKind;
  readonly radius: number;
  readonly canvas: HTMLCanvasElement;
  readonly half: number;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private size: number;
  private tex: Float32Array;
  private tex2: Float32Array;
  // per-pixel precomputation
  private idx: Int32Array; // pixel index in image
  private u: Float32Array; // texture longitude (0..1) without rotation
  private v: Float32Array; // texture latitude row (0..TEX_H-1)
  private shade: Float32Array;
  private rim: Uint8Array;
  private dither: Float32Array;
  private count = 0;
  // black hole / ring extras
  private diskR: number;
  private dIdx: Int32Array = new Int32Array(0);
  private dR: Float32Array = new Float32Array(0);
  private dA: Float32Array = new Float32Array(0);
  private dN: Float32Array = new Float32Array(0);
  private dD: Float32Array = new Float32Array(0);
  private dCount = 0;

  constructor(kind: BodyKind, radiusPx: number, seed: number, outerPx: number) {
    this.kind = kind;
    this.radius = Math.max(2, Math.round(radiusPx));
    this.diskR = Math.max(this.radius, Math.round(outerPx));
    const extent = kind === 'blackhole' || kind === 'gasgiant' ? this.diskR : this.radius;
    this.half = extent + 1;
    this.size = this.half * 2 + 1;
    this.canvas = makeCanvas(this.size, this.size);
    this.ctx = ctx2d(this.canvas);
    this.img = this.ctx.createImageData(this.size, this.size);

    const noise = new Noise2D(seed);
    this.tex = new Float32Array(TEX_W * TEX_H);
    this.tex2 = new Float32Array(TEX_W * TEX_H);
    for (let y = 0; y < TEX_H; y++) {
      for (let x = 0; x < TEX_W; x++) {
        const i = y * TEX_W + x;
        const fx = (x / TEX_W) * 8;
        const fy = (y / TEX_H) * 4;
        if (kind === 'gasgiant') {
          const turb = noise.fbm(fx * 1.5, fy * 3, 3, 12) * 1.6;
          this.tex[i] = 0.5 + 0.5 * Math.sin(fy * 5.2 + turb * 2.2);
          this.tex2[i] = noise.fbm(fx * 3, fy * 6, 2, 24);
        } else if (kind === 'planet') {
          let h = noise.fbm(fx, fy, 5, 8);
          // Sprinkle craters.
          this.tex[i] = h;
          h = noise.fbm(fx * 2 + 31, fy * 2 + 17, 3, 16);
          this.tex2[i] = h;
        } else {
          this.tex[i] = noise.fbm(fx * 2, fy * 2, 4, 16);
          this.tex2[i] = noise.fbm(fx * 2 + 50, fy * 2 + 50, 4, 16);
        }
      }
    }

    const R = this.radius;
    const n = (2 * R + 1) * (2 * R + 1);
    this.idx = new Int32Array(n);
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.shade = new Float32Array(n);
    this.rim = new Uint8Array(n);
    this.dither = new Float32Array(n);
    const rr = (R + 0.45) * (R + 0.45);
    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        const d2 = x * x + y * y;
        if (d2 > rr) continue;
        const nx = x / (R + 0.45);
        const ny = y / (R + 0.45);
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const k = this.count++;
        const px = x + this.half;
        const py = y + this.half;
        this.idx[k] = py * this.size + px;
        const lon = Math.atan2(nx, nz);
        const lat = Math.asin(Math.max(-1, Math.min(1, ny)));
        this.u[k] = lon / TAU;
        this.v[k] = Math.min(TEX_H - 1, Math.max(0, Math.floor((lat / Math.PI + 0.5) * TEX_H)));
        this.shade[k] = kind === 'redgiant' || kind === 'neutron' ? nz : Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        this.rim[k] = Math.sqrt(d2) > R - 0.6 ? 1 : 0;
        this.dither[k] = bayer(px, py);
      }
    }

    if (kind === 'blackhole' || kind === 'gasgiant') {
      const D = this.diskR;
      const inner = kind === 'blackhole' ? R + 1 : Math.round(R * 1.28);
      const m = (2 * D + 1) * (2 * D + 1);
      this.dIdx = new Int32Array(m);
      this.dR = new Float32Array(m);
      this.dA = new Float32Array(m);
      this.dN = new Float32Array(m);
      this.dD = new Float32Array(m);
      for (let y = -D; y <= D; y++) {
        for (let x = -D; x <= D; x++) {
          const r = Math.sqrt(x * x + y * y);
          if (r > D + 0.4 || r < inner) continue;
          const k = this.dCount++;
          const px = x + this.half;
          const py = y + this.half;
          this.dIdx[k] = py * this.size + px;
          this.dR[k] = (r - inner) / Math.max(1, D - inner);
          this.dA[k] = Math.atan2(y, x);
          this.dN[k] = noise.get(this.dA[k] * 3 + 10, r * 0.35);
          this.dD[k] = bayer(px, py);
        }
      }
    }
  }

  private put(i: number, c: RGB | undefined, a = 255): void {
    if (!c) return;
    const d = this.img.data;
    const o = i * 4;
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
    d[o + 3] = a;
  }

  update(time: number, spin: number): void {
    this.img.data.fill(0);
    switch (this.kind) {
      case 'planet':
        this.drawPlanet(time * spin, RAMPS.planet, true);
        break;
      case 'gasgiant':
        this.drawRing();
        this.drawPlanet(time * spin, RAMPS.gasgiant, false);
        break;
      case 'redgiant':
        this.drawStar(time, RAMPS.redgiant);
        break;
      case 'neutron':
        this.drawStar(time * 3, RAMPS.neutron);
        break;
      case 'blackhole':
        this.drawBlackHole(time * spin);
        break;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  private drawPlanet(rot: number, pal: RGB[], rocky: boolean): void {
    const levels = pal.length;
    const off = rot / TAU;
    for (let k = 0; k < this.count; k++) {
      let uu = this.u[k] + off;
      uu -= Math.floor(uu);
      const tx = Math.floor(uu * TEX_W) % TEX_W;
      const ti = this.v[k] * TEX_W + tx;
      const h = this.tex[ti];
      const detail = this.tex2[ti];
      let lum: number;
      if (rocky) {
        const crater = detail > 0.68 ? -0.22 : detail < 0.3 ? 0.08 : 0;
        lum = this.shade[k] * (0.55 + 0.75 * h + crater) + 0.06;
      } else {
        lum = this.shade[k] * (0.45 + 0.6 * h + 0.25 * (detail - 0.5)) + 0.08;
      }
      let li = Math.floor(lum * (levels - 1) + this.dither[k] * 0.85);
      li = li < 0 ? 0 : li >= levels ? levels - 1 : li;
      // Atmospheric rim on the lit edge.
      if (this.rim[k] && this.shade[k] > 0.15) {
        this.put(this.idx[k], rocky ? [62, 242, 255] : [183, 125, 255]);
        continue;
      }
      this.put(this.idx[k], pal[li]);
    }
  }

  private drawStar(time: number, pal: RGB[]): void {
    const levels = pal.length;
    const o1 = time * 0.013;
    const o2 = -time * 0.009;
    for (let k = 0; k < this.count; k++) {
      let u1 = this.u[k] + o1;
      u1 -= Math.floor(u1);
      let u2 = this.u[k] + o2;
      u2 -= Math.floor(u2);
      const row = this.v[k] * TEX_W;
      const g = this.tex[row + (Math.floor(u1 * TEX_W) % TEX_W)] * 0.6 + this.tex2[row + (Math.floor(u2 * TEX_W) % TEX_W)] * 0.6;
      const limb = Math.pow(this.shade[k], 0.45);
      const lum = 0.15 + limb * (0.55 + 0.45 * g);
      let li = Math.floor(lum * (levels - 1) + this.dither[k] * 0.9 - 0.2);
      li = li < 0 ? 0 : li >= levels ? levels - 1 : li;
      this.put(this.idx[k], pal[li]);
    }
  }

  private drawRing(): void {
    const pal = RAMPS.ring;
    const lx = LIGHT[0];
    const ly = LIGHT[1];
    const ll = Math.hypot(lx, ly);
    for (let k = 0; k < this.dCount; k++) {
      const r = this.dR[k];
      // Banded ring with a Cassini-style gap.
      if (r > 0.52 && r < 0.6) continue;
      const band = 0.5 + 0.5 * Math.sin(r * 26 + this.dN[k] * 2);
      let lum = 0.42 + 0.5 * band * (1 - r * 0.35);
      // Planet shadow on the far side of the ring.
      const ax = Math.cos(this.dA[k]);
      const ay = Math.sin(this.dA[k]);
      const along = -(ax * lx + ay * ly) / ll;
      const perp = Math.abs(ax * ly - ay * lx) / ll;
      const dist = this.radius * 1.28 + r * (this.diskR - this.radius * 1.28);
      if (along > 0 && perp * dist < this.radius) lum *= 0.3;
      // Thin out only the outer rim.
      if (r > 0.9 && this.dD[k] < (r - 0.9) * 10) continue;
      let li = Math.floor(lum * (pal.length - 1) + this.dD[k] * 0.8);
      if (li < 0) li = 0;
      if (li >= pal.length) li = pal.length - 1;
      this.put(this.dIdx[k], pal[li]);
    }
  }

  private drawBlackHole(rot: number): void {
    const pal = RAMPS.disk;
    const levels = pal.length;
    for (let k = 0; k < this.dCount; k++) {
      const r = this.dR[k];
      const a = this.dA[k];
      const spiral = Math.sin(a * 2 - Math.log(0.08 + r) * 5.5 + rot * (1.6 - r));
      const doppler = 1 + 0.35 * Math.sin(a + 0.6);
      const heat = Math.pow(Math.max(0, 1 - r), 1.6);
      const lum = heat * (0.55 + 0.35 * spiral + 0.25 * (this.dN[k] - 0.5)) * doppler;
      let li = Math.floor(lum * (levels - 1) + this.dD[k] - 0.35);
      if (li <= 0) continue;
      if (li >= levels) li = levels - 1;
      this.put(this.dIdx[k], pal[li], r > 0.85 ? 160 : 255);
    }
    // Event horizon + photon ring.
    const flicker = 0.5 + 0.5 * Math.sin(rot * 3);
    for (let k = 0; k < this.count; k++) {
      if (this.rim[k]) {
        this.put(this.idx[k], flicker > 0.5 && this.dither[k] > 0.5 ? [255, 255, 255] : [255, 216, 144]);
      } else {
        this.put(this.idx[k], [0, 0, 0]);
      }
    }
  }
}

/** Small cratered moon lit from the direction of the central body. */
export class MoonRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly half: number;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private R: number;
  private size: number;
  private noise: Float32Array;

  constructor(radiusPx: number, seed: number) {
    this.R = Math.max(3, Math.round(radiusPx));
    this.half = this.R + 1;
    this.size = this.half * 2 + 1;
    this.canvas = makeCanvas(this.size, this.size);
    this.ctx = ctx2d(this.canvas);
    this.img = this.ctx.createImageData(this.size, this.size);
    const n = new Noise2D(seed);
    this.noise = new Float32Array(this.size * this.size);
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) this.noise[y * this.size + x] = n.fbm(x * 0.35, y * 0.35, 3);
  }

  /** lx, ly: direction from the moon toward the light source (unit vector). */
  update(lx: number, ly: number): void {
    const pal = RAMPS.moon;
    const d = this.img.data;
    d.fill(0);
    const R = this.R + 0.45;
    for (let y = -this.R; y <= this.R; y++) {
      for (let x = -this.R; x <= this.R; x++) {
        if (x * x + y * y > R * R) continue;
        const nx = x / R;
        const ny = y / R;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const px = x + this.half;
        const py = y + this.half;
        const lam = Math.max(0, nx * lx * 0.8 + ny * ly * 0.8 + nz * 0.45);
        const lum = lam * (0.6 + 0.6 * this.noise[py * this.size + px]) + 0.05;
        let li = Math.floor(lum * (pal.length - 1) + bayer(px, py) * 0.9);
        li = Math.max(0, Math.min(pal.length - 1, li));
        const o = (py * this.size + px) * 4;
        d[o] = pal[li][0];
        d[o + 1] = pal[li][1];
        d[o + 2] = pal[li][2];
        d[o + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}
