import { CONFIG, PALETTE } from '../config';
import { timeToEnterRect } from '../collision';
import { bayer, clamp, damp, hexToRgb, TAU } from '../math';
import { gravityAt } from '../physics';
import type { Run } from '../run';
import { getCatalogue } from '../../astronomy/database/catalogue';
import { wrapAngle } from '../math';
import type { HazardKind, LevelDef } from '../types';
import { Backdrop, FogLayer, NebulaLayer, Starfield } from './background';
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
  ICE_RADII,
  ICE_RAMP,
  ROCK_FRAMES,
  SHIP_FRAMES,
} from './sprites';
import type { ShipSprites } from './sprites';

export interface RenderOptions {
  screenShake: boolean;
  reducedEffects: boolean;
}

const WARN_COLORS: Record<HazardKind, string> = { asteroid: '#ffc94d', debris: '#c9d3ea', comet: '#7ffcff', bomb: '#ff8a3d', ice: '#bff9ff', star: '#ffd890' };
const STAR_HAZARD_TINTS = ['#ffd890', '#b8c4ff', '#ffffff'];
/** Direction of the host star in planetary levels (matches the body shading). */
const SUN_DIR = { x: -0.74, y: -0.673 };

type ToScreen = (w: number) => number;

interface CompanionSprite {
  moon: MoonRenderer | null;
  star: BodyRenderer | null;
}

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
  private companions: CompanionSprite[] = [];
  private bodyKey = '';
  private rockKey = '';
  private ice: HTMLCanvasElement[][][] = [];
  private iceZoom = -1;
  /** Pre-rendered static zones around the primary (atmosphere haze, scorched sector). */
  private zones: { canvas: HTMLCanvasElement; half: number } | null = null;
  private glows = new Map<string, HTMLCanvasElement>();
  private stars = new Starfield(9001);
  private backdrop = new Backdrop();
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
      // Rock sprites depend on the zoom and on the level's palette; ensureLevel rebuilds them.
      this.rockZoom = this.zoom;
      this.rockKey = '';
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

  /** Build everything that is fixed for the duration of a level: bodies, sky, palettes, static zones. */
  private ensureLevel(level: LevelDef): void {
    const z = this.zoom;
    const R = level.body.radius * z;
    const key = `${level.index}:${level.seed}:${level.body.kind}:${Math.round(R)}:${this.vw}x${this.vh}`;
    if (key === this.bodyKey) return;
    this.bodyKey = key;
    this.body = new BodyRenderer(level.body.kind, level.body.look, R, level.seed, z, level.body.heatRadius * z);
    this.companions = level.companions.map((c, i) =>
      c.look
        ? { moon: null, star: new BodyRenderer(c.kind === 'star' ? 'star' : 'planet', c.look, c.radius * z, level.seed + 11 * (i + 1), z) }
        : { moon: new MoonRenderer(c.radius * z, level.seed + 7 * (i + 1)), star: null },
    );
    const t = level.theme;
    const bg = level.background;
    const strength = this.opts.reducedEffects ? t.nebulaStrength * 0.6 : t.nebulaStrength;
    const sprite = bg.spriteId ? getCatalogue().sprite(bg.spriteId) : null;
    this.nebula.build(this.vw, this.vh, level.seed, t.nebulaA, t.nebulaB, strength, sprite);
    this.stars = new Starfield(bg.starSeed, this.opts.reducedEffects ? Math.min(1, bg.starDensity) : bg.starDensity, bg.starColors);
    this.stars.resize(this.vw, this.vh);
    this.backdrop.build(this.vw, this.vh, bg);
    const rockKey = `${z.toFixed(2)}:${bg.rockRamp.join('')}`;
    if (rockKey !== this.rockKey) {
      this.rocks = buildRockSprites(z, bg.rockRamp);
      this.rockKey = rockKey;
    }
    if (Math.abs(z - this.iceZoom) > 0.02) {
      this.ice = buildRockSprites(z, ICE_RAMP, ICE_RADII, 9191);
      this.iceZoom = z;
    }
    this.zones = this.buildZones(level);
  }

  /** Dithered haze for dragging atmospheres and the scorched wedge of a tidally locked world. */
  private buildZones(level: LevelDef): { canvas: HTMLCanvasElement; half: number } | null {
    const M = level.mechanics;
    const z = this.zoom;
    const hazes = M.dragZones.filter((d) => d.style === 'haze');
    const sc = M.scorch;
    if (hazes.length === 0 && !sc) return null;
    const half = Math.ceil(Math.max(sc?.reach ?? 0, ...hazes.map((h) => h.rMax)) * z) + 1;
    const size = half * 2 + 1;
    const c = makeCanvas(size, size);
    const g = ctx2d(c);
    const img = g.createImageData(size, size);
    const hazeRgb = hazes.map((h) => hexToRgb(h.color));
    const hot = hexToRgb('#ff8a3d');
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - half;
        const dy = y - half;
        const r = Math.hypot(dx, dy) / z;
        let col: [number, number, number] | null = null;
        let alpha = 0;
        for (let i = 0; i < hazes.length; i++) {
          const h = hazes[i];
          if (r < h.rMin || r > h.rMax) continue;
          const k = 1 - (r - h.rMin) / (h.rMax - h.rMin);
          if (0.1 + 0.34 * k > bayer(x, y)) {
            col = hazeRgb[i];
            alpha = 110;
          }
        }
        if (sc && r > level.body.radius && r < sc.reach) {
          const off = Math.abs(wrapAngle(Math.atan2(dy, dx) - sc.angle)) / sc.halfWidth;
          if (off < 1) {
            const k = (0.2 + 0.4 * (1 - r / sc.reach)) * (off > 0.85 ? (1 - off) / 0.15 : 1);
            if (k > bayer(x, y)) {
              col = hot;
              alpha = 120;
            }
          }
        }
        if (!col) continue;
        const i = (y * size + x) * 4;
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = alpha;
      }
    }
    g.putImageData(img, 0, 0);
    return { canvas: c, half };
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
    // Barycentre (centre of the orbital band) and the primary body, which differ in binary systems.
    const bsx = toSx(0);
    const bsy = toSy(0);
    const pbx = toSx(run.bx);
    const pby = toSy(run.by);
    const bodyScale = run.bodyScale;
    const warp = run.warpAmount;

    // ---- background
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = L.theme.bg;
    ctx.fillRect(0, 0, this.vw, this.vh);
    this.nebula.draw(ctx, cx * z, cy * z, this.time, 1 - warp * 0.6);
    this.backdrop.draw(ctx, cx * z, cy * z, 1 - warp);
    const lens = L.body.kind === 'blackhole' && bodyScale > 0.5 ? { x: pbx, y: pby, r: L.body.radius * z * 1.7 * bodyScale } : null;
    this.stars.draw(ctx, this.vw, this.vh, cx * z, cy * z, this.time, warp, lens, 1);

    // ---- gravity field ripples + safe band
    if (bodyScale > 0.05) this.drawGravityField(run, bsx, bsy, bodyScale, menu);

    // ---- static zones (atmosphere haze, scorched sector) under the body
    if (this.zones && !menu && bodyScale > 0.9) {
      ctx.globalAlpha = 0.5 + 0.12 * Math.sin(this.time * 2.2);
      ctx.drawImage(this.zones.canvas, pbx - this.zones.half, pby - this.zones.half);
      ctx.globalAlpha = 1;
    }

    // ---- celestial bodies
    this.drawBody(run, pbx, pby, bodyScale, toSx, toSy);

    // ---- environment telegraphs (under hazards)
    if (!menu) this.drawEnvironment(run, pbx, pby, bsx, bsy);

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

    // ---- fog of the nebula / the total darkness of a starless world
    const dark = L.mechanics.dark;
    if (L.modifiers.includes('fog') || dark) {
      const holes = [{ x: pbx, y: pby, r: L.body.radius * z * (dark ? 1.5 : 2.4) * Math.max(0.01, bodyScale) }];
      if (s.visible) holes.push({ x: toSx(s.x), y: toSy(s.y), r: run.fogRadius * z });
      const dens = menu ? 0 : (run.phase === 'warping' ? 1 - warp : 1) * (dark ? 0.95 : 0.82);
      this.fog.draw(ctx, this.vw, this.vh, holes, L.background.fogColor, dens, this.time);
      if (dark && !menu) this.drawRadar(run, toSx, toSy);
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
      ctx.fillStyle = L.theme.accent;
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.globalAlpha = 1;
    }
    if (run.empT > 0 && !menu) {
      // Thrusters offline: a flickering cold wash.
      ctx.globalAlpha = Math.floor(this.time * 18) % 2 ? 0.1 : 0.04;
      ctx.fillStyle = PALETTE.cyan;
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

  private drawBody(run: Run, bsx: number, bsy: number, appear: number, toSx: ToScreen, toSy: ToScreen): void {
    const ctx = this.ctx;
    const L = run.level;
    const z = this.zoom;
    const B = L.body;
    if (!this.body || appear <= 0.01) return;
    // Pulsating stars physically swell and shrink.
    const bodyScale = appear * run.bodyPulse;
    const R = B.radius * z * bodyScale;
    const look = B.look;
    const heatPx = run.heatRadiusNow * z * appear;

    // Glows, coloured by the body's own palette.
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.85 + 0.15 * Math.sin(this.time * (B.kind === 'neutron' ? 9 : 1.3));
    const glows: [number, string, number][] = [];
    switch (B.kind) {
      case 'star':
        if (heatPx > 0) glows.push([heatPx * 1.35, look.ramp[Math.min(3, look.ramp.length - 1)], 0.8]);
        glows.push([R * Math.max(1.45, look.glowScale), look.glow, look.glowIntensity]);
        break;
      case 'neutron':
        glows.push([R * look.glowScale * pulse, look.glow, look.glowIntensity]);
        glows.push([R * 3.2, '#e8f0ff', 1.2]);
        break;
      case 'blackhole':
        glows.push([B.heatRadius * z * appear * 1.45, look.glow, look.glowIntensity]);
        break;
      default:
        glows.push([R * look.glowScale, look.glow, look.glowIntensity]);
        if (heatPx > 0) glows.push([heatPx * 1.2, '#ff4d5e', 0.45]);
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

    // Heat zone boundary (it moves on pulsating stars and near periapsis).
    if (heatPx > 0 && B.kind !== 'blackhole') {
      ctx.fillStyle = B.kind === 'neutron' ? look.glow : '#ff8a3d';
      ctx.globalAlpha = 0.35;
      dottedRing(ctx, bsx, bsy, heatPx, 3, this.time * 0.3);
      ctx.globalAlpha = 1;
    } else if (B.kind === 'blackhole') {
      ctx.fillStyle = '#ff8a3d';
      ctx.globalAlpha = 0.25;
      dottedRing(ctx, bsx, bsy, (B.heatRadius + 2) * z * appear, 4, -this.time * 0.2);
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

    // Companions: moons, and the other stars of a multiple system.
    const selfLit = B.kind === 'star' || B.kind === 'neutron' || B.kind === 'blackhole';
    for (let i = 0; i < L.companions.length; i++) {
      const spec = L.companions[i];
      const sprite = this.companions[i];
      const m = run.attractors[i + 1];
      if (!sprite || !m) continue;
      const mx = toSx(m.x);
      const my = toSy(m.y);
      const rPx = spec.radius * z;
      if (mx < -rPx * 4 || my < -rPx * 4 || mx > this.vw + rPx * 4 || my > this.vh + rPx * 4) continue;
      ctx.globalAlpha = Math.min(1, appear);
      if (sprite.star && spec.look) {
        ctx.globalCompositeOperation = 'lighter';
        if (spec.heatRadius > 0) {
          const hg = this.glow(spec.heatRadius * z * 1.3, spec.look.ramp[Math.min(3, spec.look.ramp.length - 1)], 0.7);
          ctx.drawImage(hg, mx - (hg.width >> 1), my - (hg.height >> 1));
        }
        const g = this.glow(rPx * 1.5, spec.look.glow, 1);
        ctx.drawImage(g, mx - (g.width >> 1), my - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
        if (spec.heatRadius > 0) {
          ctx.fillStyle = '#ff8a3d';
          ctx.globalAlpha = 0.35 * Math.min(1, appear);
          dottedRing(ctx, mx, my, spec.heatRadius * z, 3, -this.time * 0.3);
          ctx.globalAlpha = Math.min(1, appear);
        }
        sprite.star.update(run.simTime + i * 40, 0.04);
        ctx.drawImage(sprite.star.canvas, mx - sprite.star.half, my - sprite.star.half);
      } else if (sprite.moon) {
        // Moons of a star-like primary are lit by it; moons of a planet by the distant host star.
        let lx = SUN_DIR.x;
        let ly = SUN_DIR.y;
        if (selfLit) {
          const dx = run.bx - m.x;
          const dy = run.by - m.y;
          const d = Math.hypot(dx, dy) || 1;
          lx = dx / d;
          ly = dy / d;
        }
        sprite.moon.update(lx, ly);
        ctx.globalCompositeOperation = 'lighter';
        const g = this.glow(rPx * 2.4, '#3d6bff', 0.35);
        ctx.drawImage(g, mx - (g.width >> 1), my - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(sprite.moon.canvas, mx - sprite.moon.half, my - sprite.moon.half);
      }
      // Real, catalogued companions carry their name.
      if (spec.name && appear > 0.9) {
        ctx.globalAlpha = 0.7;
        drawText(ctx, spec.name, mx, my + Math.round(rPx) + 3, PALETTE.gray, 'center');
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Radar in the dark: the expanding ping ring and the contacts it has just swept over. */
  private drawRadar(run: Run, toSx: ToScreen, toSy: ToScreen): void {
    const ctx = this.ctx;
    const s = run.ship;
    if (!s.visible) return;
    if (run.pingR > 0) {
      ctx.fillStyle = PALETTE.cyan;
      ctx.globalAlpha = Math.max(0.08, 0.55 * (1 - run.pingR / 330));
      dottedRing(ctx, toSx(s.x), toSy(s.y), run.pingR * this.zoom, 4, 0);
    }
    for (const h of run.hazards) {
      if (h.ping <= 0 || h.offPlane) continue;
      const hx = toSx(h.x);
      const hy = toSy(h.y);
      const r = Math.max(3, Math.round(h.r * this.zoom) + 2);
      ctx.fillStyle = WARN_COLORS[h.kind];
      ctx.globalAlpha = Math.min(1, h.ping);
      // Corner brackets around the contact.
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          ctx.fillRect(hx + sx * r, hy + sy * r, 1, 1);
          ctx.fillRect(hx + sx * (r - 1), hy + sy * r, 1, 1);
          ctx.fillRect(hx + sx * r, hy + sy * (r - 1), 1, 1);
        }
      }
      ctx.fillRect(hx, hy, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  /** `bsx,bsy` = primary body on screen; `cx0,cy0` = barycentre (shock waves expand from there). */
  private drawEnvironment(run: Run, bsx: number, bsy: number, cx0: number, cy0: number): void {
    const ctx = this.ctx;
    const z = this.zoom;
    const L = run.level;
    const M = L.mechanics;

    // Cryo-plume: the two edges of the jet.
    if (M.plume) {
      ctx.fillStyle = '#bff9ff';
      ctx.globalAlpha = 0.3;
      const reach = M.plume.reach * z;
      for (const side of [-1, 1]) {
        const a = run.plumeAngle + side * M.plume.halfWidth;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        for (let r = L.body.radius * z + 2; r < reach; r += 4) ctx.fillRect(Math.round(bsx + ca * r), Math.round(bsy + sa * r), 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    // Eruption telegraphs: a blinking vent and the line the ejecta will take.
    for (const e of run.eruptions) {
      if (e.t >= e.telegraph || !M.eruptions) continue;
      const k = e.t / e.telegraph;
      if (Math.floor(e.t * (6 + 10 * k)) % 2 !== 0) continue;
      const ca = Math.cos(e.angle);
      const sa = Math.sin(e.angle);
      ctx.fillStyle = k > 0.7 ? PALETTE.red : PALETTE.orange;
      ctx.globalAlpha = 0.45 + 0.5 * k;
      for (let r = L.body.radius * z; r < M.eruptions.reach[1] * z; r += 4) ctx.fillRect(Math.round(bsx + ca * r), Math.round(bsy + sa * r), 1, 1);
      const vx = Math.round(bsx + ca * (L.body.radius * z + 2));
      const vy = Math.round(bsy + sa * (L.body.radius * z + 2));
      ctx.fillRect(vx - 1, vy - 1, 3, 3);
      ctx.globalAlpha = 1;
    }

    // Magnetic burst building up: a ring collapsing onto the star.
    if (run.empCharge > 0 && M.emp) {
      const k = run.empCharge / M.emp.telegraph;
      ctx.fillStyle = Math.floor(this.time * 12) % 2 ? PALETTE.white : PALETTE.cyan;
      ctx.globalAlpha = 0.85 - 0.5 * k;
      dottedRing(ctx, bsx, bsy, (L.body.radius + 110 * k) * z, 3, this.time * 2);
      ctx.globalAlpha = 1;
    }

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
      const jet = M.beam?.jet ?? L.body.kind === 'blackhole';
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
      pixelCircle(ctx, cx0, cy0, w.r * z);
      ctx.fillStyle = L.theme.ripple;
      ctx.globalAlpha = 0.45 * (1 - k);
      pixelCircle(ctx, cx0, cy0, w.r * z - 3, [2, 2]);
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
      ctx.fillStyle = WARN_COLORS[h.kind];
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
      // Bodies of an inclined belt that are above or below the ship's plane are drawn faint.
      const base = h.offPlane ? 0.28 : 1;
      ctx.globalAlpha = base;
      if (h.kind === 'asteroid' || h.kind === 'ice') {
        const sheet = h.kind === 'ice' ? this.ice : this.rocks;
        const set = sheet[h.size]?.[h.variant % sheet[h.size].length];
        if (!set) continue;
        const spr = set[frameIndex(h.rot, ROCK_FRAMES)];
        if (slow) {
          ctx.globalAlpha = 0.5 * base;
          ctx.drawImage(spr, sx - (spr.width >> 1) + 1, sy - (spr.height >> 1));
          ctx.globalAlpha = base;
        }
        ctx.drawImage(spr, sx - (spr.width >> 1), sy - (spr.height >> 1));
        ctx.globalAlpha = 1;
      } else if (h.kind === 'bomb') {
        // Molten ejecta / plasma: a hot core with a glow.
        ctx.globalCompositeOperation = 'lighter';
        const g = this.glow(6, '#ff8a3d', 1.1);
        ctx.drawImage(g, sx - (g.width >> 1), sy - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ff4d5e';
        ctx.fillRect(sx - 2, sy - 1, 5, 3);
        ctx.fillRect(sx - 1, sy - 2, 3, 5);
        ctx.fillStyle = '#ffc94d';
        ctx.fillRect(sx - 1, sy - 1, 3, 3);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx, sy, 1, 1);
      } else if (h.kind === 'star') {
        // A star on a plunging orbit: a point of light with diffraction spikes.
        const tint = STAR_HAZARD_TINTS[h.variant % STAR_HAZARD_TINTS.length];
        if (!h.offPlane) {
          ctx.globalCompositeOperation = 'lighter';
          const g = this.glow(8, tint, 1.2);
          ctx.drawImage(g, sx - (g.width >> 1), sy - (g.height >> 1));
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.fillStyle = tint;
        ctx.fillRect(sx - 3, sy, 7, 1);
        ctx.fillRect(sx, sy - 3, 1, 7);
        ctx.fillRect(sx - 1, sy - 1, 3, 3);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx - 1, sy, 3, 1);
        ctx.fillRect(sx, sy - 1, 1, 3);
        ctx.globalAlpha = 1;
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
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
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
      if (h.orbiting || h.offPlane) continue;
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
