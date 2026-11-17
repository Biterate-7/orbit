/**
 * Draws the player's ship from a cosmetic loadout.
 *
 * One painter serves the game renderer, the hangar preview and the catalogue thumbnails, so what
 * is shown in the menus is exactly what flies. Everything is drawn in low-resolution pixels:
 *
 *   hull + wings + cockpit   a pixel map per wing style, coloured per pixel by the hull pattern
 *                            (static patterns have one frame; animated skins cycle several) and
 *                            rotated to 32 headings - each frame is built once, on first use
 *   engine                   a flame shape drawn live behind the nozzle
 *   trail                    the ship's recent path, drawn in the trail's own geometry
 *   core                     a light amidships
 *   effect                   whatever orbits, rings or surrounds the hull (half behind, half in front)
 */
import { shade } from '../../astronomy/database/visuals';
import { hexToRgb, TAU } from '../math';
import type { CoreLook, EffectLook, EngineLook, HullLook, ShipLook, TrailLook, WingStyle } from '../cosmetics/catalog';
import { ctx2d, makeCanvas, makeGlow } from './pixel';
import { SHIP_FRAMES, frameIndex, rotateMap } from './sprites';

type PixelMap = (string | null)[][];

/** Ship facing +X. W light plating, G mid, D dark, V accent trim, C canopy, O engine nozzle. */
const ART: Record<WingStyle, string[]> = {
  stock: ['.VV........', '.DGW.......', '..DGWW.....', 'ODGGWWCC...', 'ODGWWWWCWWW', 'ODGGWWCC...', '..DGWW.....', '.DGW.......', '.VV........'],
  swept: ['VV.........', 'DGW........', '.DGWW......', 'ODGGWWCC...', 'ODGWWWWCWWW', 'ODGGWWCC...', '.DGWW......', 'DGW........', 'VV.........'],
  delta: ['.V.........', '.DGV.......', '.DGGWV.....', 'ODGGWWCC...', 'ODGWWWWCWWW', 'ODGGWWCC...', '.DGGWV.....', '.DGV.......', '.V.........'],
  twinfin: ['VV.........', 'DG.........', '..DGWW.....', 'ODGGWWCC...', 'ODGWWWWCWWW', 'ODGGWWCC...', '..DGWW.....', 'DG.........', 'VV.........'],
  blades: ['.....VV....', '...DGW.....', '..DGW......', 'ODGGWWCC...', 'ODGWWWWCWWW', 'ODGGWWCC...', '..DGW......', '...DGW.....', '.....VV....'],
  talon: ['..VVV......', '.DG..V.....', '.DGW.......', 'ODGGWWCC...', 'ODGWWWWCWWW', 'ODGGWWCC...', '.DGW.......', '.DG..V.....', '..VVV......'],
  halo: ['...VVVV....', '..V.DG.V...', '.V.DGWW.V..', 'ODGGWWCC.V.', 'ODGWWWWCWWW', 'ODGGWWCC.V.', '.V.DGWW.V..', '..V.DG.V...', '...VVVV....'],
};

const SIZE = 15;

const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function hsl(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Colour of one hull pixel. `role` is the art character, (x, y) its place in the map, f the animation frame. */
function hullPixel(look: HullLook, role: string, x: number, y: number, f: number, edge: boolean): string {
  const alt = look.alt ?? [];
  const base = role === 'W' ? look.light : role === 'G' ? look.mid : role === 'D' ? look.dark : look.accent;
  const k = role === 'W' ? 0 : role === 'G' ? 1 : 2;
  switch (look.pattern) {
    case 'plain':
      return base;
    case 'stripe':
      if (role !== 'V' && y === 4) return k === 0 ? (alt[0] ?? base) : (alt[1] ?? base);
      return base;
    case 'split':
      if (role !== 'V' && y > 4) return alt[k] ?? base;
      return base;
    case 'checker':
      if (role !== 'V' && (x + y) % 2 === 0) return k === 0 ? (alt[0] ?? base) : (alt[1] ?? base);
      return base;
    case 'panel':
      // Riveted seams, and a maintenance light that walks the spine.
      if (role !== 'V' && y === 4 && x === f % 11) return alt[0] ?? '#ffffff';
      if (role === 'G' && x % 3 === 0) return look.dark;
      return base;
    case 'circuit': {
      if (role === 'V') return base;
      const trace = (x * 3 + y * 5) % 7 === 0 || y === 4;
      if (!trace) return base;
      return (((x + Math.abs(y - 4) - f) % 8) + 8) % 8 === 0 ? (alt[0] ?? '#ffffff') : (alt[1] ?? base);
    }
    case 'molten': {
      if (role === 'V') return base;
      // Cracks open and close: each pixel has its own phase in the cycle.
      const n = (Math.floor(hash(x, y) * look.frames) + f) % look.frames;
      if (n === 0) return alt[0] ?? '#ffffff';
      if (n <= 2) return alt[1] ?? base;
      if (n <= 3) return alt[2] ?? base;
      return base;
    }
    case 'gold': {
      // A highlight band travels the length of the hull.
      const at = Math.floor((f / look.frames) * 16) - 2;
      if (x === at) return alt[0] ?? '#ffffff';
      if (x === at - 1 || x === at + 1) return alt[1] ?? look.light;
      return base;
    }
    case 'holo': {
      const hue = (x * 24 + y * 16 + (f * 360) / look.frames) % 360;
      return hsl(hue, 0.85, role === 'W' ? 0.76 : role === 'G' ? 0.62 : role === 'D' ? 0.42 : 0.9);
    }
    case 'crystal': {
      if ((x * 7 + y * 13 + f) % look.frames === 0) return '#ffffff';
      const facet = alt[(x + 2 * y + (hash(x, y) > 0.7 ? Math.floor(f / 3) : 0)) % Math.max(1, alt.length)] ?? base;
      return role === 'D' ? shade(facet, 0.55) : role === 'G' ? shade(facet, 0.85) : facet;
    }
    case 'aurora': {
      const wave = Math.sin(x * 0.8 - (f * TAU) / look.frames) * 1.6 + Math.sin(x * 0.35 + (f * TAU) / look.frames) * 1.1;
      const band = ((Math.floor(y + wave) % alt.length) + alt.length) % Math.max(1, alt.length);
      const c = alt[band] ?? base;
      return role === 'D' ? shade(c, 0.4) : role === 'G' ? shade(c, 0.7) : role === 'V' ? look.accent : c;
    }
    case 'nebula': {
      // Stars drift aft across a deep field; wisps of gas ride over them.
      if (hash(x + f, y * 3) > 0.9) return alt[0] ?? '#ffffff';
      const wisp = Math.sin((x + f * 0.5) * 0.7 + y * 1.3);
      if (wisp > 0.72) return alt[1] ?? base;
      if (wisp < -0.8) return alt[2] ?? base;
      return y < 3 || y > 5 ? (alt[4] ?? look.dark) : (alt[3] ?? look.mid);
    }
    case 'void': {
      // No surface: black, with a burning edge whose colours run around the silhouette.
      if (!edge) return look.dark;
      return alt[(((x + y - f) % alt.length) + alt.length) % Math.max(1, alt.length)] ?? look.accent;
    }
  }
}

function buildMap(look: ShipLook, f: number): PixelMap {
  const art = ART[look.wings.style] ?? ART.stock;
  const filled = (x: number, y: number): boolean => y >= 0 && y < art.length && x >= 0 && x < art[0].length && art[y][x] !== '.';
  return art.map((row, y) =>
    row.split('').map((ch, x) => {
      if (ch === '.') return null;
      if (ch === 'C') return look.cockpit.blink && f % 4 >= 2 ? look.cockpit.colors[1] : look.cockpit.colors[0];
      if (ch === 'O') return look.engine.nozzle;
      const edge = !filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1);
      return hullPixel(look.hull, ch, x, y, f, edge);
    }),
  );
}

function tinted(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const g = ctx2d(c);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export interface ShipPose {
  /** Screen position (pixels of the low-resolution canvas). */
  x: number;
  y: number;
  heading: number;
  time: number;
  /** -1 braking, 0 coasting, +1 accelerating. */
  thrust: number;
  boosting: boolean;
  hurt: boolean;
  overdrive: boolean;
  /** Reduced-effects setting: skip the purely decorative layers. */
  reduced?: boolean;
}

/** Frames per second of animated hull skins. */
const HULL_FPS = 9;

export class ShipPainter {
  private current: ShipLook;
  private frames = new Map<string, HTMLCanvasElement>();
  private whites = new Map<number, HTMLCanvasElement>();
  private ghosts = new Map<number, HTMLCanvasElement>();
  private glows = new Map<string, HTMLCanvasElement>();
  private maps: PixelMap[] = [];

  constructor(look: ShipLook) {
    this.current = look;
  }

  get look(): ShipLook {
    return this.current;
  }

  setLook(look: ShipLook): void {
    if (look.key === this.current.key) return;
    this.current = look;
    this.frames.clear();
    this.whites.clear();
    this.ghosts.clear();
    this.maps = [];
  }

  private glow(radius: number, color: string, intensity: number): HTMLCanvasElement {
    const key = `${Math.round(radius)}|${color}|${intensity}`;
    let g = this.glows.get(key);
    if (!g) {
      g = makeGlow(Math.max(2, Math.round(radius)), color, intensity);
      this.glows.set(key, g);
    }
    return g;
  }

  /** One hull frame: animation frame `f`, rotation index `rot`. Built on first use and kept. */
  private frame(f: number, rot: number): HTMLCanvasElement {
    const key = `${f}|${rot}`;
    let c = this.frames.get(key);
    if (!c) {
      if (!this.maps[f]) this.maps[f] = buildMap(this.current, f);
      c = rotateMap(this.maps[f], (rot / SHIP_FRAMES) * TAU, SIZE);
      this.frames.set(key, c);
    }
    return c;
  }

  private animFrame(time: number): number {
    const n = Math.max(1, this.current.hull.frames, this.current.cockpit.blink ? 4 : 1);
    return n <= 1 ? 0 : Math.floor(time * HULL_FPS) % n;
  }

  /** Silhouette of the hull in one colour (hit flash, boost afterimage). */
  silhouette(heading: number, kind: 'white' | 'ghost'): HTMLCanvasElement {
    const rot = frameIndex(heading, SHIP_FRAMES);
    const cache = kind === 'white' ? this.whites : this.ghosts;
    let c = cache.get(rot);
    if (!c) {
      c = tinted(this.frame(0, rot), kind === 'white' ? '#ffffff' : '#3ef2ff');
      cache.set(rot, c);
    }
    return c;
  }

  // ------------------------------------------------------------------ trail

  /**
   * Draw the trail through `n` screen points (x0, y0, x1, y1 ... newest first). `boost` brightens it
   * (the in-run Ion Trail upgrade).
   */
  drawTrail(ctx: CanvasRenderingContext2D, pts: ArrayLike<number>, n: number, time: number, boost = 1): void {
    const t: TrailLook = this.current.trail;
    const cols = t.colors;
    const count = Math.min(n, t.length);
    if (count < 2) return;
    const colAt = (k: number): string => cols[Math.min(cols.length - 1, Math.floor(k * cols.length))];
    const px = (i: number): number => pts[i * 2];
    const py = (i: number): number => pts[i * 2 + 1];
    const perp = (i: number): [number, number] => {
      const j = Math.min(count - 1, i + 1);
      const dx = px(i) - px(j);
      const dy = py(i) - py(j);
      const d = Math.hypot(dx, dy) || 1;
      return [-dy / d, dx / d];
    };
    const dot = (x: number, y: number, s = 1): void => ctx.fillRect(Math.round(x), Math.round(y), s, s);
    for (let i = 1; i < count; i++) {
      const k = i / count;
      const fade = (k < 0.3 ? 0.75 : k < 0.6 ? 0.5 : 0.22) * boost;
      ctx.globalAlpha = Math.min(1, fade);
      ctx.fillStyle = colAt(k);
      const x = px(i);
      const y = py(i);
      switch (t.style) {
        case 'line':
          dot(x, y);
          break;
        case 'dashed':
          if (i % 4 < 2) dot(x, y);
          break;
        case 'double': {
          const [nx, ny] = perp(i);
          dot(x + nx * 2, y + ny * 2);
          dot(x - nx * 2, y - ny * 2);
          break;
        }
        case 'ribbon': {
          const [nx, ny] = perp(i);
          const w = Math.round(3 * (1 - k));
          for (let s = -w; s <= w; s++) dot(x + nx * s, y + ny * s);
          break;
        }
        case 'comet':
          ctx.globalAlpha = Math.min(1, (1 - k) * 0.9 * boost);
          dot(x, y, k < 0.15 ? 2 : 1);
          break;
        case 'stars':
          ctx.globalAlpha = Math.min(1, fade * 0.5);
          dot(x, y);
          if (i % 5 === 0) {
            const tw = Math.sin(time * 9 + i) > -0.2;
            ctx.globalAlpha = Math.min(1, (1 - k) * (tw ? 1 : 0.35));
            ctx.fillStyle = cols[0];
            dot(x, y);
            if (tw && k < 0.7) {
              dot(x - 1, y);
              dot(x + 1, y);
              dot(x, y - 1);
              dot(x, y + 1);
            }
          }
          break;
        case 'constellation':
          if (i % 6 === 0) {
            ctx.globalAlpha = Math.min(1, 1 - k * 0.7);
            ctx.fillStyle = cols[0];
            ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
            // A straight, dotted join to the previous star.
            const j = i - 6;
            if (j >= 0) {
              ctx.globalAlpha = Math.min(1, (1 - k) * 0.55);
              ctx.fillStyle = cols[1] ?? cols[0];
              for (let s = 1; s < 6; s += 1) if (s % 2 === 0) dot(px(j) + ((x - px(j)) * s) / 6, py(j) + ((y - py(j)) * s) / 6);
            }
          }
          break;
        case 'geometric':
          if (i % 5 === 0) {
            const r = Math.max(1, Math.round(3 * (1 - k)));
            ctx.globalAlpha = Math.min(1, 1 - k * 0.8);
            const X = Math.round(x);
            const Y = Math.round(y);
            if ((i / 5) % 2 === 0) {
              // square outline
              ctx.fillRect(X - r, Y - r, 2 * r + 1, 1);
              ctx.fillRect(X - r, Y + r, 2 * r + 1, 1);
              ctx.fillRect(X - r, Y - r, 1, 2 * r + 1);
              ctx.fillRect(X + r, Y - r, 1, 2 * r + 1);
            } else {
              // diamond outline
              for (let s = 0; s <= r; s++) {
                dot(X - r + s, Y - s);
                dot(X + r - s, Y - s);
                dot(X - r + s, Y + s);
                dot(X + r - s, Y + s);
              }
            }
          }
          break;
        case 'helix': {
          const [nx, ny] = perp(i);
          const off = Math.sin(i * 0.55 - time * 7) * 2.6 * (1 - k * 0.5);
          ctx.fillStyle = cols[0];
          dot(x + nx * off, y + ny * off);
          ctx.fillStyle = cols[1] ?? cols[0];
          dot(x - nx * off, y - ny * off);
          if (Math.abs(off) < 0.5) {
            ctx.fillStyle = cols[2] ?? '#ffffff';
            dot(x, y);
          }
          break;
        }
        case 'prism':
          ctx.fillStyle = cols[(i + Math.floor(time * 12)) % cols.length];
          ctx.globalAlpha = Math.min(1, (1 - k * 0.8) * boost);
          dot(x, y, k < 0.25 ? 2 : 1);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ engine

  private drawFlame(ctx: CanvasRenderingContext2D, p: ShipPose): void {
    const e: EngineLook = this.current.engine;
    const hx = Math.cos(p.heading);
    const hy = Math.sin(p.heading);
    const nx = -hy;
    const ny = hx;
    const dot = (d: number, side: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(p.x - hx * (6 + d) + nx * side), Math.round(p.y - hy * (6 + d) + ny * side), 1, 1);
    };
    if (p.thrust < 0) {
      ctx.fillStyle = Math.random() < 0.5 ? '#3ef2ff' : '#e8f0ff';
      ctx.fillRect(Math.round(p.x + hx * 7), Math.round(p.y + hy * 7), 1, 1);
      return;
    }
    if (p.thrust <= 0) return;
    const outer = p.overdrive ? '#ff4d5e' : e.flame[2];
    const col = (i: number, len: number): string => (i === 0 ? e.flame[0] : i < Math.max(2, len / 2) ? e.flame[1] : outer);
    const flick = Math.random();
    const base = 2 + Math.floor(flick * 3) + e.length + (p.overdrive ? 2 : 0);
    switch (e.style) {
      case 'standard':
        for (let i = 0; i < base; i++) dot(i, 0, col(i, base));
        break;
      case 'needle':
        for (let i = 0; i < base + 3; i++) dot(i, 0, i < base ? e.flame[0] : e.flame[1]);
        break;
      case 'wide':
        for (let i = 0; i < base; i++) dot(i, 0, col(i, base));
        for (let i = 0; i < base - 1; i++) {
          dot(i, 1, col(i + 1, base));
          dot(i, -1, col(i + 1, base));
        }
        break;
      case 'twin':
        for (let i = 0; i < base; i++) {
          dot(i, 2, col(i, base));
          dot(i, -2, col(i, base));
        }
        break;
      case 'pulse': {
        // Fires in beats: a short plume, then a detached slug of flame travelling aft.
        const beat = (p.time * 7) % 1;
        const len = Math.round(base * (1 - beat * 0.6));
        for (let i = 0; i < len; i++) dot(i, 0, col(i, len));
        const slug = Math.round(base + beat * 6);
        dot(slug, 0, e.flame[1]);
        dot(slug + 1, 0, outer);
        break;
      }
      case 'ring': {
        for (let i = 0; i < base; i++) dot(i, 0, col(i, base));
        for (let r = 0; r < 2; r++) {
          const d = ((p.time * 12 + r * 5) % 10) + 2;
          const w = 1 + Math.floor(d / 4);
          ctx.globalAlpha = Math.max(0, 1 - d / 12);
          dot(d, w, e.flame[1]);
          dot(d, -w, e.flame[1]);
          dot(d + 1, w - 1, outer);
          dot(d + 1, -w + 1, outer);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'spiral':
        for (let i = 0; i < base + 2; i++) {
          const s = Math.sin(i * 1.3 - p.time * 22) * Math.min(2, 0.6 + i * 0.35);
          dot(i, s, i < 2 ? e.flame[0] : e.flame[1]);
          dot(i, -s, i < 2 ? e.flame[0] : outer);
        }
        break;
    }
    ctx.globalCompositeOperation = 'lighter';
    const g = this.glow(5, e.glow, 0.9);
    ctx.drawImage(g, Math.round(p.x - hx * 7) - (g.width >> 1), Math.round(p.y - hy * 7) - (g.height >> 1));
    ctx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ core

  private drawCore(ctx: CanvasRenderingContext2D, p: ShipPose): void {
    const c: CoreLook = this.current.core;
    if (c.style === 'none') return;
    const hx = Math.cos(p.heading);
    const hy = Math.sin(p.heading);
    const x = Math.round(p.x - hx * 1.5);
    const y = Math.round(p.y - hy * 1.5);
    let level = 1;
    let color = c.colors[0];
    if (c.style === 'pulse') level = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(p.time * 3));
    else if (c.style === 'beat') {
      const b = (p.time * 1.1) % 1;
      level = b < 0.1 || (b > 0.2 && b < 0.3) ? 1 : 0.3;
    } else if (c.style === 'prism') color = c.colors[Math.floor(p.time * 4) % c.colors.length];
    else if (c.style === 'star') level = 0.7 + 0.3 * Math.sin(p.time * 11) * Math.sin(p.time * 3.7);
    if (c.glow > 0 && !p.reduced) {
      ctx.globalCompositeOperation = 'lighter';
      const g = this.glow(c.glow, color, 0.9);
      ctx.globalAlpha = level;
      ctx.drawImage(g, x - (g.width >> 1), y - (g.height >> 1));
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = Math.min(1, level + 0.2);
    ctx.fillStyle = level > 0.75 ? (c.colors[1] ?? '#ffffff') : color;
    ctx.fillRect(x, y, 1, 1);
    if (c.style === 'star' && level > 0.8) {
      // The captive star flares: four short arms.
      ctx.fillStyle = c.colors[2] ?? color;
      ctx.fillRect(x - 2, y, 1, 1);
      ctx.fillRect(x + 2, y, 1, 1);
      ctx.fillRect(x, y - 2, 1, 1);
      ctx.fillRect(x, y + 2, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ special effect

  /** `front` = the half drawn over the hull; the other half is drawn before it. */
  private drawEffect(ctx: CanvasRenderingContext2D, p: ShipPose, front: boolean): void {
    const e: EffectLook = this.current.effect;
    if (e.style === 'none' || p.reduced) return;
    const t = p.time;
    const c = e.colors;
    const dot = (x: number, y: number, color: string, s = 1): void => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(p.x + x), Math.round(p.y + y), s, s);
    };
    switch (e.style) {
      case 'sparks': {
        if (!front) break;
        const tick = Math.floor(t * 10);
        for (let i = 0; i < 2; i++) {
          if (hash(tick, i) > 0.35) continue;
          const a = hash(tick, i + 7) * TAU;
          const r = 4 + hash(tick, i + 3) * 5;
          dot(Math.cos(a) * r, Math.sin(a) * r, c[i % c.length]);
          dot(Math.cos(a) * (r + 1), Math.sin(a) * (r + 1) + 1, c[(i + 1) % c.length]);
        }
        break;
      }
      case 'orbiters':
        for (let i = 0; i < 3; i++) {
          const a = t * 2.2 + (i * TAU) / 3;
          // Seen at a tilt: the far side passes behind the hull.
          if (Math.sin(a) > 0 !== front) continue;
          dot(Math.cos(a) * 10, Math.sin(a) * 4.5, c[i % c.length], front ? 2 : 1);
        }
        break;
      case 'halo': {
        if (front) break;
        const r = 9 + Math.sin(t * 2.4) * 1.2;
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 2.4);
        for (let i = 0; i < 20; i++) {
          const a = (i * TAU) / 20 + t * 0.4;
          dot(Math.cos(a) * r, Math.sin(a) * r, c[i % 2]);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'rings': {
        // A tilted ring system, turning. Near side over the hull, far side under it.
        const tilt = 0.5;
        const ct = Math.cos(tilt);
        const st = Math.sin(tilt);
        for (let ring = 0; ring < 2; ring++) {
          const a0 = 10 + ring * 2.2;
          for (let i = 0; i < 26; i++) {
            const a = (i * TAU) / 26 + t * (0.9 - ring * 0.3);
            if (Math.sin(a) > 0 !== front) continue;
            const ex = Math.cos(a) * a0;
            const ey = Math.sin(a) * a0 * 0.36;
            ctx.globalAlpha = front ? 0.95 : 0.45;
            dot(ex * ct - ey * st, ex * st + ey * ct, c[(i + ring) % c.length]);
          }
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'field': {
        if (!front) break;
        // A hexagonal field whose facets flicker one after another.
        const lit = Math.floor(t * 9) % 6;
        for (let s = 0; s < 6; s++) {
          const a1 = (s * TAU) / 6 + t * 0.3;
          const a2 = ((s + 1) * TAU) / 6 + t * 0.3;
          ctx.globalAlpha = s === lit ? 0.95 : s === (lit + 3) % 6 ? 0.6 : 0.22;
          for (let k = 0; k <= 5; k++) dot(Math.cos(a1) * 9 + ((Math.cos(a2) - Math.cos(a1)) * 9 * k) / 5, Math.sin(a1) * 9 + ((Math.sin(a2) - Math.sin(a1)) * 9 * k) / 5, c[s === lit ? 0 : 1] ?? c[0]);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'constellation': {
        if (front) break;
        const stars: [number, number][] = [
          [10, 0.2],
          [12, 1.5],
          [9, 2.6],
          [11, 3.9],
          [12, 5.1],
        ];
        let prev: [number, number] | null = null;
        for (const [r, a0] of stars) {
          const a = a0 + t * 0.5;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (prev) {
            ctx.globalAlpha = 0.3;
            for (let k = 1; k < 5; k++) dot(prev[0] + ((x - prev[0]) * k) / 5, prev[1] + ((y - prev[1]) * k) / 5, c[1] ?? c[0]);
          }
          ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5 + a0 * 7);
          dot(x, y, c[0], Math.sin(t * 3 + a0) > 0.6 ? 2 : 1);
          prev = [x, y];
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'binary': {
        // Two small suns circle the ship, and each other.
        for (let i = 0; i < 2; i++) {
          const a = t * 1.5 + i * Math.PI;
          if (Math.sin(a) > 0 !== front) continue;
          const wob = Math.sin(t * 4 + i * Math.PI) * 1.2;
          const x = Math.round(p.x + Math.cos(a) * (10 + wob));
          const y = Math.round(p.y + Math.sin(a) * (5 + wob * 0.5));
          ctx.globalCompositeOperation = 'lighter';
          const g = this.glow(4, c[i % c.length], 1);
          ctx.drawImage(g, x - (g.width >> 1), y - (g.height >> 1));
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, y, 1, 1);
        }
        break;
      }
      case 'horizon': {
        if (!front) break;
        // A thin photon ring with one bright arc running round it.
        const hot = t * 3;
        for (let i = 0; i < 28; i++) {
          const a = (i * TAU) / 28;
          const d = Math.abs(((a - hot) % TAU) + TAU) % TAU;
          const near = Math.min(d, TAU - d);
          ctx.globalAlpha = near < 0.9 ? 1 : 0.35;
          dot(Math.cos(a) * 8.5, Math.sin(a) * 8.5, near < 0.4 ? c[0] : near < 0.9 ? (c[1] ?? c[0]) : (c[2] ?? c[0]));
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'comet': {
        if (front) break;
        const hx = Math.cos(p.heading);
        const hy = Math.sin(p.heading);
        ctx.globalCompositeOperation = 'lighter';
        const g = this.glow(8, c[0], 0.5);
        ctx.drawImage(g, Math.round(p.x + hx * 3) - (g.width >> 1), Math.round(p.y + hy * 3) - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 7; i++) {
          const k = (t * 1.6 + i / 7) % 1;
          const side = (hash(i, 3) - 0.5) * 9;
          ctx.globalAlpha = 0.7 * (1 - k);
          dot(-hx * (4 + k * 14) - hy * side * (0.4 + k), -hy * (4 + k * 14) + hx * side * (0.4 + k), c[i % c.length]);
        }
        ctx.globalAlpha = 1;
        break;
      }
    }
  }

  // ------------------------------------------------------------------ whole ship

  /** Draw the ship (everything except its trail). `visible` false skips the hull (grace-period blink). */
  draw(ctx: CanvasRenderingContext2D, p: ShipPose, visible = true): void {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const pose = { ...p, x, y };
    this.drawEffect(ctx, pose, false);
    this.drawFlame(ctx, pose);
    if (visible) {
      const h = this.current.hull;
      if (h.glow && !p.reduced && !p.boosting) {
        ctx.globalCompositeOperation = 'lighter';
        const g = this.glow(8, h.glow, 0.45);
        ctx.drawImage(g, x - (g.width >> 1), y - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
      }
      const rot = frameIndex(p.heading, SHIP_FRAMES);
      const f = p.hurt ? this.silhouette(p.heading, 'white') : p.boosting ? this.silhouette(p.heading, 'ghost') : this.frame(this.animFrame(p.time), rot);
      if (p.boosting) {
        ctx.globalCompositeOperation = 'lighter';
        const g = this.glow(9, '#3ef2ff', 1);
        ctx.drawImage(g, x - (g.width >> 1), y - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(f, x - (f.width >> 1), y - (f.height >> 1));
      if (p.boosting) {
        const f2 = this.frame(this.animFrame(p.time), rot);
        ctx.globalAlpha = 0.6;
        ctx.drawImage(f2, x - (f2.width >> 1), y - (f2.height >> 1));
        ctx.globalAlpha = 1;
      }
      if (!p.hurt) this.drawCore(ctx, pose);
    }
    this.drawEffect(ctx, pose, true);
  }
}

/** Parse a hex colour into "r, g, b" for CSS (used by rarity-tinted UI). */
export function rgbTriplet(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}
