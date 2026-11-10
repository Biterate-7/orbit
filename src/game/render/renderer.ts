import { CONFIG, PALETTE } from '../config';
import { timeToEnterRect } from '../collision';
import { bayer, clamp, damp, hexToRgb, TAU } from '../math';
import { gravityAt } from '../physics';
import type { Run } from '../run';
import type { LevelDef } from '../types';
import { FogLayer, NebulaLayer, Starfield } from './background';
import { BodyRenderer, MoonRenderer } from './celestial';
import { drawText } from './font';
import { ctx2d, dottedRing, makeCanvas, makeGlow, pixelCircle } from './pixel';
import {
  buildDebrisSprites,
  buildMoteSprites,
  buildRockSprites,
  buildShipSprites,
  DEBRIS_FRAMES,
  frameIndex,
  ROCK_FRAMES,
  SHIP_FRAMES,
} from './sprites';
import type { ShipSprites } from './sprites';

export interface RenderOptions {
  screenShake: boolean;
  reducedEffects: boolean;
}

const WARN_COLORS = { asteroid: '#ffc94d', debris: '#c9d3ea', comet: '#7ffcff' } as const;

/**
 * Pixel-art renderer. The world is drawn into a low-resolution canvas which the browser upscales
 * by an integer factor with nearest-neighbour filtering (CSS `image-rendering: pixelated`).
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  vw = 640;
  vh = 360;
  scale = 3;
  zoom = 1;
  camX = 0;
  camY = 0;
  private time = 0;
  private ship: ShipSprites;
  private rocks: HTMLCanvasElement[][][] = [];
  private rockZoom = -1;
  private debris: HTMLCanvasElement[][];
  private motes: { small: HTMLCanvasElement[]; big: HTMLCanvasElement[] };
  private body: BodyRenderer | null = null;
  private moon: MoonRenderer | null = null;
  private bodyKey = '';
  private glows = new Map<string, HTMLCanvasElement>();
  private stars = new Starfield(9001);
  private nebula = new NebulaLayer();
  private fog = new FogLayer();
  private vignette: HTMLCanvasElement | null = null;
  private hurtVignette: HTMLCanvasElement | null = null;
  private pathBuf = { x: 0, y: 0 };
  opts: RenderOptions = { screenShake: true, reducedEffects: false };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = ctx2d(canvas);
    this.ship = buildShipSprites();
    this.debris = buildDebrisSprites();
    this.motes = buildMoteSprites();
  }

  /** Fit the virtual resolution to the container. Returns world half-extents of the view. */
  resize(cssW: number, cssH: number, dpr: number): { hw: number; hh: number } {
    const devW = Math.max(1, Math.round(cssW * dpr));
    const devH = Math.max(1, Math.round(cssH * dpr));
    const short = Math.min(devW, devH);
    this.scale = Math.max(1, Math.round(short / 340));
    this.vw = Math.ceil(devW / this.scale);
    this.vh = Math.ceil(devH / this.scale);
    this.canvas.width = this.vw;
    this.canvas.height = this.vh;
    this.canvas.style.width = `${(this.vw * this.scale) / dpr}px`;
    this.canvas.style.height = `${(this.vh * this.scale) / dpr}px`;
    this.ctx = ctx2d(this.canvas);
    this.zoom = Math.min(this.vw, this.vh) / 2 / CONFIG.VIEW_RADIUS;
    if (Math.abs(this.zoom - this.rockZoom) > 0.02) {
      this.rocks = buildRockSprites(this.zoom);
      this.rockZoom = this.zoom;
    }
    this.stars.resize(this.vw, this.vh);
    this.vignette = this.buildVignette('#000000', 0.55, 0.62);
    this.hurtVignette = this.buildVignette('#ff2a3d', 0.75, 0.5);
    this.bodyKey = '';
    return { hw: this.vw / 2 / this.zoom, hh: this.vh / 2 / this.zoom };
  }

  private buildVignette(color: string, strength: number, start: number): HTMLCanvasElement {
    const c = makeCanvas(this.vw, this.vh);
    const g = ctx2d(c);
    const img = g.createImageData(this.vw, this.vh);
    const [r, gg, b] = hexToRgb(color);
    const cx = this.vw / 2;
    const cy = this.vh / 2;
    const maxD = Math.hypot(cx, cy);
    for (let y = 0; y < this.vh; y++) {
      for (let x = 0; x < this.vw; x++) {
        const d = Math.hypot(x - cx, (y - cy) * 1.2) / maxD;
        const v = clamp((d - start) / (1 - start), 0, 1) * strength;
        if (v <= bayer(x, y)) continue;
        const i = (y * this.vw + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = gg;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  private glow(radius: number, color: string, intensity: number): HTMLCanvasElement {
    const r = Math.max(2, Math.round(radius));
    const key = `${r}|${color}|${intensity}`;
    let g = this.glows.get(key);
    if (!g) {
      g = makeGlow(r, color, intensity);
      if (this.glows.size > 64) this.glows.clear();
      this.glows.set(key, g);
    }
    return g;
  }

  private ensureLevel(level: LevelDef): void {
    const R = level.body.radius * this.zoom;
    const outer =
      level.body.kind === 'blackhole' ? level.body.heatRadius * this.zoom : level.body.kind === 'gasgiant' ? level.body.radius * 1.8 * this.zoom : R;
    const key = `${level.index}:${level.seed}:${level.body.kind}:${Math.round(R)}:${this.vw}x${this.vh}`;
    if (key === this.bodyKey) return;
    this.bodyKey = key;
    this.body = new BodyRenderer(level.body.kind, R, level.seed, outer);
    this.moon = level.moon ? new MoonRenderer(level.moon.radius * this.zoom, level.seed + 7) : null;
    const t = level.theme;
    const strength = this.opts.reducedEffects ? t.nebulaStrength * 0.6 : t.nebulaStrength;
    this.nebula.build(this.vw, this.vh, level.seed, t.nebulaA, t.nebulaB, strength);
  }

  // ---------------------------------------------------------------- frame

  render(run: Run, dt: number, menu: boolean): void {
    this.time += dt;
    const ctx = this.ctx;
    const L = run.level;
    this.ensureLevel(L);
    const z = this.zoom;
    const s = run.ship;

    // Camera.
    let tx = 0;
    let ty = 0;
    if (menu) {
      if (this.vw > this.vh * 1.15) tx = -(this.vw * 0.2) / z;
      else ty = -(this.vh * 0.14) / z;
    } else if (s.visible) {
      tx = s.x * 0.08;
      ty = s.y * 0.08;
      const r = Math.hypot(s.x, s.y);
      const lim = CONFIG.VIEW_RADIUS * 0.92;
      if (r > lim) {
        tx += (s.x / r) * (r - lim) * 0.85;
        ty += (s.y / r) * (r - lim) * 0.85;
      }
    }
    this.camX = damp(this.camX, tx, menu ? 1.6 : 2.5, dt);
    this.camY = damp(this.camY, ty, menu ? 1.6 : 2.5, dt);

    let shx = 0;
    let shy = 0;
    if (this.opts.screenShake && run.shake > 0.05) {
      shx = Math.round((Math.random() * 2 - 1) * run.shake);
      shy = Math.round((Math.random() * 2 - 1) * run.shake);
    }
    const ox = Math.round(this.vw / 2 + shx);
    const oy = Math.round(this.vh / 2 + shy);
    const cx = this.camX;
    const cy = this.camY;
    const toSx = (wx: number): number => Math.round((wx - cx) * z + ox);
    const toSy = (wy: number): number => Math.round((wy - cy) * z + oy);
    const bsx = toSx(0);
    const bsy = toSy(0);
    const bodyScale = run.bodyScale;
    const warp = run.warpAmount;

    // ---- background
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = L.theme.bg;
    ctx.fillRect(0, 0, this.vw, this.vh);
    this.nebula.draw(ctx, cx * z, cy * z, this.time, 1 - warp * 0.6);
    const lens = L.body.kind === 'blackhole' && bodyScale > 0.5 ? { x: bsx, y: bsy, r: L.body.radius * z * 1.7 * bodyScale } : null;
    this.stars.draw(ctx, this.vw, this.vh, cx * z, cy * z, this.time, warp, lens, 1);

    // ---- gravity field ripples + safe band
    if (bodyScale > 0.05) this.drawGravityField(run, bsx, bsy, bodyScale, menu);

    // ---- celestial body
    this.drawBody(run, bsx, bsy, bodyScale);

    // ---- environment telegraphs (under hazards)
    if (!menu) this.drawEnvironment(run, bsx, bsy);

    // ---- energy motes
    for (const m of run.motes) {
      if (m.life < 3 && Math.floor(m.life * 8) % 2 === 0) continue;
      const mx = toSx(m.x);
      const my = toSy(m.y);
      const frame = Math.floor(m.phase / 3) % 2;
      const spr = m.big ? this.motes.big[frame] : this.motes.small[frame];
      ctx.globalCompositeOperation = 'lighter';
      const g = this.glow(m.big ? 6 : 4, m.big ? '#9b5cff' : '#3ef2ff', 0.9);
      ctx.drawImage(g, mx - (g.width >> 1), my - (g.height >> 1));
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(spr, mx - (spr.width >> 1), my - (spr.height >> 1));
    }

    // ---- trajectory preview
    if (!menu && s.visible && (run.phase === 'active' || run.phase === 'intro')) this.drawTrajectory(run, toSx, toSy);

    // ---- hazards
    if (!menu && run.mods.scanner > 0) this.drawHazardPaths(run, toSx, toSy);
    this.drawHazards(run, toSx, toSy);

    // ---- ship
    this.drawShip(run, toSx, toSy, menu);

    // ---- particles + shock rings
    run.particles.draw(ctx, cx, cy, z, ox, oy);
    for (const r of run.rings) {
      const t = r.t / r.dur;
      const rad = (r.r + (r.maxR - r.r) * (1 - Math.pow(1 - t, 2))) * z;
      ctx.globalAlpha = t < 0.5 ? 1 : t < 0.8 ? 0.6 : 0.3;
      ctx.fillStyle = r.color;
      pixelCircle(ctx, toSx(r.x), toSy(r.y), rad);
    }
    ctx.globalAlpha = 1;

    // ---- fog of the nebula
    if (L.modifiers.includes('fog')) {
      const holes = [{ x: bsx, y: bsy, r: L.body.radius * z * 2.4 * Math.max(0.01, bodyScale) }];
      if (s.visible) holes.push({ x: toSx(s.x), y: toSy(s.y), r: run.fogRadius * z });
      const dens = menu ? 0 : (run.phase === 'warping' ? 1 - warp : 1) * 0.82;
      this.fog.draw(ctx, this.vw, this.vh, holes, '#0d0820', dens, this.time);
    }

    // ---- floating texts
    for (const t of run.texts) {
      const k = t.t / t.dur;
      if (k > 0.75 && Math.floor(t.t * 20) % 2 === 0) continue;
      drawText(ctx, t.text, toSx(t.x), toSy(t.y), t.color, 'center', 1);
    }

    // ---- warnings / indicators
    if (!menu) {
      this.drawEdgeWarnings(run);
      if (s.visible) this.drawOffscreenShip(toSx(s.x), toSy(s.y));
    }

    // ---- screen effects
    if (this.vignette && !this.opts.reducedEffects) {
      ctx.globalAlpha = 0.6;
      ctx.drawImage(this.vignette, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (!menu && this.hurtVignette) {
      let a = run.hurtFlash;
      if (s.visible && s.stability < 30 && run.phase === 'active') a = Math.max(a, (0.35 + 0.25 * Math.sin(this.time * 8)) * (1 - s.stability / 30));
      if (a > 0.02) {
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.drawImage(this.hurtVignette, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
    if (run.temporalT > 0) {
      ctx.globalAlpha = 0.1 + 0.04 * Math.sin(this.time * 10);
      ctx.fillStyle = PALETTE.violet;
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.globalAlpha = 1;
    }
    if (run.storm.state === 'active' && !menu) {
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = '#b77dff';
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.globalAlpha = 1;
    }
    const flash = Math.max(run.flash, run.phase === 'warping' ? Math.max(0, (run.phaseTime - CONFIG.WARP_TIME * 0.7) / (CONFIG.WARP_TIME * 0.3)) : 0);
    if (flash > 0.01) {
      ctx.globalAlpha = clamp(flash, 0, 1) * 0.85;
      ctx.fillStyle = '#e8f0ff';
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- pieces

  private drawGravityField(run: Run, bsx: number, bsy: number, bodyScale: number, menu: boolean): void {
    const ctx = this.ctx;
    const L = run.level;
    const z = this.zoom;
    const inner = L.body.radius * 1.4;
    const outer = L.outerLimit + 40;
    const span = outer - inner;
    const rings = this.opts.reducedEffects ? 2 : 4;
    const speed = 10 + Math.sqrt(L.body.mu) / 120;
    ctx.fillStyle = L.theme.ripple;
    for (let i = 0; i < rings; i++) {
      const r = outer - ((this.time * speed + (i * span) / rings) % span);
      const k = (r - inner) / span;
      ctx.globalAlpha = 0.07 + 0.16 * (1 - k) * bodyScale;
      dottedRing(ctx, bsx, bsy, r * z * bodyScale, 6 + k * 6, this.time * 0.05 + i);
    }
    ctx.globalAlpha = 1;
    if (menu) return;

    // Safe orbital band.
    const s = run.ship;
    const r = Math.hypot(s.x, s.y);
    const tooClose = s.visible && r < L.safeMin;
    const tooFar = s.visible && r > L.safeMax;
    const blink = Math.floor(this.time * 6) % 2 === 0;
    ctx.fillStyle = tooClose && blink ? PALETTE.red : '#ff4d5e';
    ctx.globalAlpha = tooClose ? 0.9 : 0.32;
    dottedRing(ctx, bsx, bsy, L.safeMin * z * bodyScale, 4, -this.time * 0.08, 2);
    ctx.fillStyle = tooFar && blink ? PALETTE.amber : L.theme.accent;
    ctx.globalAlpha = tooFar ? 0.9 : 0.26;
    dottedRing(ctx, bsx, bsy, L.safeMax * z * bodyScale, 5, this.time * 0.06, 2);
    ctx.globalAlpha = 1;
  }

  private drawBody(run: Run, bsx: number, bsy: number, bodyScale: number): void {
    const ctx = this.ctx;
    const L = run.level;
    const z = this.zoom;
    const B = L.body;
    if (!this.body || bodyScale <= 0.01) return;
    const R = B.radius * z * bodyScale;

    // Glows.
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.85 + 0.15 * Math.sin(this.time * (B.kind === 'neutron' ? 9 : 1.3));
    const glows: [number, string, number][] = [];
    switch (B.kind) {
      case 'planet':
        glows.push([R * 2.1, '#3d6bff', 0.55]);
        break;
      case 'redgiant':
        glows.push([B.heatRadius * z * bodyScale * 1.35, '#ff4d5e', 0.8]);
        glows.push([R * 1.45, '#ff8a3d', 1.0]);
        break;
      case 'neutron':
        glows.push([R * 9 * pulse, '#3ef2ff', 0.9]);
        glows.push([R * 3.2, '#e8f0ff', 1.2]);
        break;
      case 'blackhole':
        glows.push([B.heatRadius * z * bodyScale * 1.45, '#9b5cff', 0.6]);
        break;
      case 'gasgiant':
        glows.push([R * 2.2, '#9b5cff', 0.45]);
        break;
    }
    if (run.phase === 'active' && run.level.modifiers.includes('waves')) {
      // Charging gravity wave: body brightens.
      const charging = run.waveCharge;
      if (charging > 0) glows.push([R * 2.8, '#e8f0ff', 1.2 * (1 - charging / 1.1)]);
    }
    for (const [gr, col, inten] of glows) {
      if (gr < 2) continue;
      const g = this.glow(gr, col, inten);
      ctx.drawImage(g, bsx - (g.width >> 1), bsy - (g.height >> 1));
    }
    ctx.globalCompositeOperation = 'source-over';

    // Heat zone dithered haze and boundary.
    if (B.heatRadius > 0 && B.kind !== 'blackhole') {
      ctx.fillStyle = B.kind === 'neutron' ? '#3ef2ff' : '#ff8a3d';
      ctx.globalAlpha = 0.35;
      dottedRing(ctx, bsx, bsy, B.heatRadius * z * bodyScale, 3, this.time * 0.3);
      ctx.globalAlpha = 1;
    } else if (B.kind === 'blackhole') {
      ctx.fillStyle = '#ff8a3d';
      ctx.globalAlpha = 0.25;
      dottedRing(ctx, bsx, bsy, (B.heatRadius + 2) * z * bodyScale, 4, -this.time * 0.2);
      ctx.globalAlpha = 1;
    }

    this.body.update(run.simTime, B.spin);
    const c = this.body.canvas;
    if (Math.abs(bodyScale - 1) < 0.01) {
      ctx.drawImage(c, bsx - this.body.half, bsy - this.body.half);
    } else {
      const w = Math.max(1, Math.round(c.width * bodyScale));
      ctx.drawImage(c, bsx - (w >> 1), bsy - (w >> 1), w, w);
    }

    // Moon.
    if (L.moon && this.moon && run.attractors.length > 1) {
      const m = run.attractors[1];
      const mx = Math.round((m.x - this.camX) * z + bsx);
      const my = Math.round((m.y - this.camY) * z + bsy);
      const d = Math.hypot(m.x, m.y) || 1;
      this.moon.update(-m.x / d, -m.y / d);
      ctx.globalAlpha = bodyScale;
      ctx.globalCompositeOperation = 'lighter';
      const g = this.glow(L.moon.radius * z * 2.4, '#3d6bff', 0.35);
      ctx.drawImage(g, mx - (g.width >> 1), my - (g.height >> 1));
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.moon.canvas, mx - this.moon.half, my - this.moon.half);
      ctx.globalAlpha = 1;
    }
  }

  private drawEnvironment(run: Run, bsx: number, bsy: number): void {
    const ctx = this.ctx;
    const z = this.zoom;
    const L = run.level;

    // Solar flares.
    for (const f of run.flares) {
      const telegraph = f.t < f.telegraph;
      const R0 = L.body.radius * z;
      if (telegraph) {
        const k = f.t / f.telegraph;
        const blink = Math.floor(f.t * (6 + 10 * k)) % 2 === 0;
        if (!blink) continue;
        ctx.fillStyle = k > 0.7 ? PALETTE.red : PALETTE.orange;
        ctx.globalAlpha = 0.4 + 0.5 * k;
        const reach = f.reach * z;
        for (const side of [-1, 1]) {
          const a = f.angle + side * f.halfWidth;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          for (let r = R0; r < reach; r += 3) ctx.fillRect(Math.round(bsx + ca * r), Math.round(bsy + sa * r), 1, 1);
        }
        const steps = Math.ceil(f.halfWidth * 2 * reach);
        for (let i = 0; i <= steps; i += 2) {
          const a = f.angle - f.halfWidth + (i / steps) * f.halfWidth * 2;
          ctx.fillRect(Math.round(bsx + Math.cos(a) * reach), Math.round(bsy + Math.sin(a) * reach), 1, 1);
        }
        ctx.globalAlpha = 1;
      } else {
        const at = f.t - f.telegraph;
        const grow = Math.min(1, at / 0.25);
        const fade = at > f.active - 0.3 ? (f.active - at) / 0.3 : 1;
        const reach = (L.body.radius + (f.reach - L.body.radius) * grow) * z;
        ctx.globalCompositeOperation = 'lighter';
        const rays = Math.ceil(f.halfWidth * 2 * reach * 0.9);
        for (let i = 0; i <= rays; i++) {
          const u = i / rays;
          const a = f.angle - f.halfWidth + u * f.halfWidth * 2;
          const edge = Math.abs(u - 0.5) * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const rr = reach * (1 - edge * edge * 0.25);
          for (let r = R0; r < rr; r += 2) {
            const px = Math.round(bsx + ca * r);
            const py = Math.round(bsy + sa * r);
            const heat = 1 - (r - R0) / Math.max(1, rr - R0);
            if (heat * fade < bayer(px, py) * 0.9) continue;
            ctx.fillStyle = heat > 0.7 ? '#ffd890' : heat > 0.35 ? '#ff8a3d' : '#ff4d5e';
            ctx.globalAlpha = 0.55;
            ctx.fillRect(px, py, 1, 2);
          }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // Pulsar / jet beams.
    const b = run.beam;
    if (b) {
      const state = run.beamState();
      const jet = L.body.kind === 'blackhole';
      const core = jet ? '#e8d0ff' : '#ffffff';
      const edge = jet ? '#9b5cff' : '#3ef2ff';
      for (let k = 0; k < b.count; k++) {
        const a = b.angle + (k * TAU) / b.count;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const len = b.length * z;
        const start = L.body.radius * z + 2;
        if (state === 'off') {
          ctx.fillStyle = edge;
          ctx.globalAlpha = 0.12;
          for (let r = start; r < len; r += 7) ctx.fillRect(Math.round(bsx + ca * r), Math.round(bsy + sa * r), 1, 1);
        } else if (state === 'charge') {
          const blink = Math.floor(run.simTime * 14) % 2 === 0;
          ctx.fillStyle = blink ? core : edge;
          ctx.globalAlpha = 0.75;
          for (let r = start; r < len; r += 3) ctx.fillRect(Math.round(bsx + ca * r), Math.round(bsy + sa * r), 1, 1);
        } else {
          const w = b.halfWidth * z;
          const nx = -sa;
          const ny = ca;
          ctx.globalCompositeOperation = 'lighter';
          for (let r = start; r < len; r += 1) {
            const px = bsx + ca * r;
            const py = bsy + sa * r;
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = core;
            ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
            ctx.fillStyle = edge;
            ctx.globalAlpha = 0.6;
            ctx.fillRect(Math.round(px + nx), Math.round(py + ny), 1, 1);
            ctx.fillRect(Math.round(px - nx), Math.round(py - ny), 1, 1);
            if ((r | 0) % 2 === 0) {
              ctx.globalAlpha = 0.25;
              ctx.fillRect(Math.round(px + nx * w), Math.round(py + ny * w), 1, 1);
              ctx.fillRect(Math.round(px - nx * w), Math.round(py - ny * w), 1, 1);
            }
          }
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      ctx.globalAlpha = 1;
    }

    // Gravity waves.
    for (const w of run.waves) {
      const k = w.r / w.maxR;
      ctx.fillStyle = '#e8f0ff';
      ctx.globalAlpha = 0.7 * (1 - k);
      pixelCircle(ctx, bsx, bsy, w.r * z);
      ctx.fillStyle = L.theme.ripple;
      ctx.globalAlpha = 0.45 * (1 - k);
      pixelCircle(ctx, bsx, bsy, w.r * z - 3, [2, 2]);
    }
    ctx.globalAlpha = 1;
  }

  private drawTrajectory(run: Run, toSx: (x: number) => number, toSy: (y: number) => number): void {
    const ctx = this.ctx;
    const L = run.level;
    const n = run.trajCount;
    const ion = run.mods.ionTrail > 0;
    for (let i = 1; i < n; i += 2) {
      const x = run.traj[i * 2];
      const y = run.traj[i * 2 + 1];
      const r = Math.hypot(x, y);
      const bad = r < L.safeMin || r > L.safeMax;
      const k = i / n;
      ctx.globalAlpha = k < 0.35 ? 0.85 : k < 0.7 ? 0.55 : 0.3;
      ctx.fillStyle = bad ? (r < L.safeMin ? PALETTE.red : PALETTE.amber) : ion ? '#7ffcff' : PALETTE.cyan;
      ctx.fillRect(toSx(x), toSy(y), 1, 1);
    }
    if (run.trajCrashed && n > 0) {
      const ex = toSx(run.traj[(n - 1) * 2]);
      const ey = toSy(run.traj[(n - 1) * 2 + 1]);
      ctx.globalAlpha = Math.floor(this.time * 8) % 2 ? 1 : 0.4;
      ctx.fillStyle = PALETTE.red;
      for (let d = -2; d <= 2; d++) {
        ctx.fillRect(ex + d, ey + d, 1, 1);
        ctx.fillRect(ex + d, ey - d, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawHazardPaths(run: Run, toSx: (x: number) => number, toSy: (y: number) => number): void {
    const ctx = this.ctx;
    const g = this.pathBuf;
    const dt = 1 / 15;
    const steps = 22 + run.mods.scanner * 8;
    for (const h of run.hazards) {
      if (h.orbiting) continue;
      let x = h.x;
      let y = h.y;
      let vx = h.vx;
      let vy = h.vy;
      ctx.fillStyle = h.kind === 'comet' ? '#7ffcff' : h.kind === 'debris' ? '#c9d3ea' : '#ffc94d';
      for (let i = 0; i < steps; i++) {
        gravityAt(x, y, run.attractors, h.gravity, g);
        vx += g.x * dt;
        vy += g.y * dt;
        x += vx * dt;
        y += vy * dt;
        if (i % 2 === 1) {
          ctx.globalAlpha = 0.32 * (1 - i / steps);
          ctx.fillRect(toSx(x), toSy(y), 1, 1);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawHazards(run: Run, toSx: (x: number) => number, toSy: (y: number) => number): void {
    const ctx = this.ctx;
    const z = this.zoom;
    const slow = run.temporalT > 0;
    for (const h of run.hazards) {
      const sx = toSx(h.x);
      const sy = toSy(h.y);
      if (sx < -40 || sy < -40 || sx > this.vw + 40 || sy > this.vh + 40) continue;
      if (h.kind === 'asteroid') {
        const set = this.rocks[h.size]?.[h.variant % this.rocks[h.size].length];
        if (!set) continue;
        const spr = set[frameIndex(h.rot, ROCK_FRAMES)];
        if (slow) {
          ctx.globalAlpha = 0.5;
          ctx.drawImage(spr, sx - (spr.width >> 1) + 1, sy - (spr.height >> 1));
          ctx.globalAlpha = 1;
        }
        ctx.drawImage(spr, sx - (spr.width >> 1), sy - (spr.height >> 1));
      } else if (h.kind === 'debris') {
        const spr = this.debris[h.variant % this.debris.length][frameIndex(h.rot, DEBRIS_FRAMES)];
        ctx.drawImage(spr, sx - (spr.width >> 1), sy - (spr.height >> 1));
      } else {
        // Comet: dithered tail + bright head.
        const sp = Math.hypot(h.vx, h.vy) || 1;
        const dx = -h.vx / sp;
        const dy = -h.vy / sp;
        const len = 34 * z;
        for (let i = 2; i < len; i++) {
          const k = i / len;
          const w = 1 + Math.floor(k * 3);
          for (let j = -w; j <= w; j++) {
            const px = Math.round(sx + dx * i - dy * j * 0.8);
            const py = Math.round(sy + dy * i + dx * j * 0.8);
            if ((1 - k) * (1 - Math.abs(j) / (w + 1)) < bayer(px, py)) continue;
            ctx.fillStyle = k < 0.3 ? '#e8f0ff' : k < 0.6 ? '#7ffcff' : '#3d6bff';
            ctx.globalAlpha = 0.8;
            ctx.fillRect(px, py, 1, 1);
          }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'lighter';
        const g = this.glow(7, '#7ffcff', 1.2);
        ctx.drawImage(g, sx - (g.width >> 1), sy - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx - 1, sy - 1, 3, 3);
        ctx.fillStyle = '#7ffcff';
        ctx.fillRect(sx - 2, sy, 1, 1);
        ctx.fillRect(sx + 2, sy, 1, 1);
        ctx.fillRect(sx, sy - 2, 1, 1);
        ctx.fillRect(sx, sy + 2, 1, 1);
      }
    }
  }

  private drawShip(run: Run, toSx: (x: number) => number, toSy: (y: number) => number, menu: boolean): void {
    const ctx = this.ctx;
    const s = run.ship;
    if (!s.visible) return;
    const p = this.pathBuf;

    // Trail.
    const n = Math.min(s.trailCount, run.mods.ionTrail > 0 ? 48 : menu ? 30 : 26);
    const ion = run.mods.ionTrail > 0;
    for (let i = 1; i < n; i++) {
      s.trailPoint(i, p);
      const k = i / n;
      ctx.globalAlpha = (k < 0.3 ? 0.7 : k < 0.6 ? 0.45 : 0.2) * (ion ? 1.2 : 1);
      ctx.fillStyle = k < 0.4 ? PALETTE.cyan : k < 0.75 ? PALETTE.blue : PALETTE.violet;
      ctx.fillRect(toSx(p.x), toSy(p.y), 1, 1);
    }
    ctx.globalAlpha = 1;

    // Boost afterimages.
    for (const g of run.ghosts) {
      const f = this.ship.ghost[frameIndex(g.heading, SHIP_FRAMES)];
      ctx.globalAlpha = 0.5 * (1 - g.t / 0.3);
      ctx.drawImage(f, toSx(g.x) - (f.width >> 1), toSy(g.y) - (f.height >> 1));
    }
    ctx.globalAlpha = 1;

    const sx = toSx(s.x);
    const sy = toSy(s.y);
    const fi = frameIndex(s.heading, SHIP_FRAMES);
    const hx = Math.cos(s.heading);
    const hy = Math.sin(s.heading);

    // Engine flame.
    if (s.thrust > 0) {
      const flick = Math.random();
      const len = 2 + Math.floor(flick * 3) + (run.overdrive > 0 ? 2 : 0);
      for (let i = 0; i < len; i++) {
        ctx.fillStyle = i === 0 ? '#ffffff' : i < 2 ? '#ffc94d' : run.overdrive > 0 ? '#ff4d5e' : '#ff8a3d';
        ctx.fillRect(Math.round(sx - hx * (6 + i)), Math.round(sy - hy * (6 + i)), 1, 1);
      }
      ctx.globalCompositeOperation = 'lighter';
      const g = this.glow(5, '#ff8a3d', 0.9);
      ctx.drawImage(g, Math.round(sx - hx * 7) - (g.width >> 1), Math.round(sy - hy * 7) - (g.height >> 1));
      ctx.globalCompositeOperation = 'source-over';
    } else if (s.thrust < 0) {
      ctx.fillStyle = Math.random() < 0.5 ? '#3ef2ff' : '#e8f0ff';
      ctx.fillRect(Math.round(sx + hx * 7), Math.round(sy + hy * 7), 1, 1);
    }

    // Hull sprite (blink during grace period).
    const blinking = s.invuln > 0 && run.phase !== 'clearing' && run.phase !== 'warping' && Math.floor(s.invuln * 14) % 2 === 0;
    if (!blinking) {
      const set = run.hurtFlash > 0.7 ? this.ship.white : s.boostT > 0 ? this.ship.ghost : this.ship.frames;
      const f = set[fi];
      if (s.boostT > 0) {
        ctx.globalCompositeOperation = 'lighter';
        const g = this.glow(9, '#3ef2ff', 1);
        ctx.drawImage(g, sx - (g.width >> 1), sy - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(f, sx - (f.width >> 1), sy - (f.height >> 1));
      if (s.boostT > 0) {
        const f2 = this.ship.frames[fi];
        ctx.globalAlpha = 0.6;
        ctx.drawImage(f2, sx - (f2.width >> 1), sy - (f2.height >> 1));
        ctx.globalAlpha = 1;
      }
    }

    // Shield rings.
    if (s.shield > 0 && !menu) {
      ctx.fillStyle = PALETTE.cyan;
      for (let i = 0; i < s.shield; i++) {
        ctx.globalAlpha = 0.55 - i * 0.12;
        dottedRing(ctx, sx, sy, 9 + i * 2, 3, this.time * (1.5 + i * 0.5) * (i % 2 ? -1 : 1));
      }
      ctx.globalAlpha = 1;
    }

    // Magnet field hint.
    if (run.mods.magnetRadius > 0 && !menu && !this.opts.reducedEffects) {
      ctx.fillStyle = PALETTE.violet;
      ctx.globalAlpha = 0.12;
      dottedRing(ctx, sx, sy, run.mods.magnetRadius * this.zoom, 8, -this.time * 0.6);
      ctx.globalAlpha = 1;
    }
  }

  private drawEdgeWarnings(run: Run): void {
    const ctx = this.ctx;
    const z = this.zoom;
    const hw = this.vw / 2 / z;
    const hh = this.vh / 2 / z;
    const base = CONFIG.WARN_WINDOW + run.mods.scanner * 1.0;
    const blink = Math.floor(this.time * 7) % 2 === 0;
    for (const h of run.hazards) {
      if (h.orbiting) continue;
      const rx = h.x - this.camX;
      const ry = h.y - this.camY;
      if (Math.abs(rx) < hw && Math.abs(ry) < hh) continue;
      const window = base + (h.kind === 'comet' ? 0.9 : 0);
      const t = timeToEnterRect(rx, ry, h.vx, h.vy, hw, hh);
      if (t > window) continue;
      const sp = Math.hypot(h.vx, h.vy) || 1;
      const ex = rx + h.vx * t;
      const ey = ry + h.vy * t;
      const px = clamp(Math.round(ex * z + this.vw / 2), 6, this.vw - 7);
      const py = clamp(Math.round(ey * z + this.vh / 2), 6, this.vh - 7);
      if (!blink && t > 0.4) continue;
      const col = WARN_COLORS[h.kind];
      // Chevron pointing along the hazard's travel direction.
      const dx = h.vx / sp;
      const dy = h.vy / sp;
      ctx.fillStyle = col;
      for (let i = 0; i < 4; i++) {
        const bx = px - dx * i;
        const by = py - dy * i;
        ctx.fillRect(Math.round(bx - dy * i), Math.round(by + dx * i), 1, 1);
        ctx.fillRect(Math.round(bx + dy * i), Math.round(by - dx * i), 1, 1);
      }
      if (h.kind === 'comet' || h.size === 2) {
        drawText(ctx, '!', px - dx * 9, py - dy * 9 - 2, col, 'center');
      }
    }
  }

  private drawOffscreenShip(sx: number, sy: number): void {
    if (sx >= 0 && sy >= 0 && sx < this.vw && sy < this.vh) return;
    const ctx = this.ctx;
    const cx = this.vw / 2;
    const cy = this.vh / 2;
    const dx = sx - cx;
    const dy = sy - cy;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const s = Math.min((cx - 8) / Math.max(1e-3, Math.abs(ux)), (cy - 8) / Math.max(1e-3, Math.abs(uy)));
    const px = Math.round(cx + ux * s);
    const py = Math.round(cy + uy * s);
    ctx.fillStyle = Math.floor(this.time * 6) % 2 ? PALETTE.red : PALETTE.white;
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(Math.round(px - ux * i - uy * i), Math.round(py - uy * i + ux * i), 1, 1);
      ctx.fillRect(Math.round(px - ux * i + uy * i), Math.round(py - uy * i - ux * i), 1, 1);
    }
  }
}
