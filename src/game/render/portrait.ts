/**
 * Small pixel-art portraits of catalogue objects for the discovery UI.
 *
 * Preference order:
 *   1. the pixel translation of a NASA image that was verified to show this object;
 *   2. a procedural painting built from the object's catalogue data (the same body renderer the
 *      game uses, or a dedicated painter for galaxies, nebulae and quasars).
 * The UI labels which of the two is being shown.
 */
import { getCatalogue } from '../../astronomy/database/catalogue';
import type { AstroObject, PixelSprite } from '../../astronomy/database/schema';
import { environment, primaryEnvironment } from '../../generation/environments';
import { hashString } from '../../generation/seed';
import { bayer, hexToRgb } from '../math';
import { Noise2D, Rng } from '../rng';
import { BodyRenderer } from './celestial';
import { ctx2d, makeCanvas, makeGlow } from './pixel';

export const PORTRAIT_SIZE = 96;

export interface Portrait {
  /** 'image' = pixel render of a verified NASA image, 'procedural' = painted from catalogue data. */
  source: 'image' | 'procedural';
  /** Draw the portrait for time `t` (seconds) into a PORTRAIT_SIZE square context. */
  draw: (ctx: CanvasRenderingContext2D, t: number) => void;
  animated: boolean;
}

function spriteCanvas(sprite: PixelSprite): HTMLCanvasElement {
  const c = makeCanvas(sprite.w, sprite.h);
  const g = ctx2d(c);
  const img = g.createImageData(sprite.w, sprite.h);
  const pal = sprite.palette.map(hexToRgb);
  for (let i = 0; i < sprite.w * sprite.h; i++) {
    const p = pal[parseInt(sprite.data[i], 16)] ?? [0, 0, 0];
    img.data[i * 4] = p[0];
    img.data[i * 4 + 1] = p[1];
    img.data[i * 4 + 2] = p[2];
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Dithered painter shared by the deep-sky portraits. `density(x, y)` returns 0..1, `tone` picks the colour. */
function paint(colors: string[], density: (u: number, v: number) => number, tone: (u: number, v: number, d: number) => number): HTMLCanvasElement {
  const S = PORTRAIT_SIZE;
  const c = makeCanvas(S, S);
  const g = ctx2d(c);
  const img = g.createImageData(S, S);
  const pal = colors.map(hexToRgb);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x - S / 2) / (S / 2);
      const v = (y - S / 2) / (S / 2);
      const d = density(u, v);
      const lv = Math.floor(d * 4 + bayer(x, y) - 0.5);
      if (lv <= 0) continue;
      const p = pal[Math.max(0, Math.min(pal.length - 1, Math.floor(tone(u, v, d) * pal.length)))];
      const i = (y * S + x) * 4;
      img.data[i] = p[0];
      img.data[i + 1] = p[1];
      img.data[i + 2] = p[2];
      img.data[i + 3] = Math.min(255, 70 + lv * 60);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function deepSky(o: AstroObject): HTMLCanvasElement {
  const seed = hashString(o.id);
  const rng = new Rng(seed);
  const n = new Noise2D(seed);
  const colors = [...o.visualProperties.dominantColors].reverse(); // dark -> bright
  if (o.category === 'galaxy') {
    const tilt = rng.range(0.35, 1);
    const rot = rng.range(0, Math.PI);
    const arms = rng.int(2, 3);
    const twist = rng.range(2.4, 4);
    const ca = Math.cos(rot);
    const sa = Math.sin(rot);
    return paint(
      colors,
      (u, v) => {
        const x = u * ca + v * sa;
        const y = (-u * sa + v * ca) / tilt;
        const r = Math.hypot(x, y);
        if (r > 0.95) return 0;
        const arm = 0.5 + 0.5 * Math.cos(arms * (Math.atan2(y, x) - twist * Math.log(0.06 + r)));
        return Math.exp(-r * 9) * 1.6 + (1 - r) * arm * arm * 0.75 * (0.5 + n.fbm(u * 5 + 3, v * 5 + 7, 3));
      },
      (_u, _v, d) => Math.min(0.99, d * 1.3),
    );
  }
  if (o.category === 'quasar') {
    const axis = rng.range(0, Math.PI);
    const ca = Math.cos(axis);
    const sa = Math.sin(axis);
    return paint(
      colors,
      (u, v) => {
        const along = u * ca + v * sa;
        const across = Math.abs(-u * sa + v * ca);
        const r = Math.hypot(u, v);
        const jet = Math.abs(along) < 0.9 ? Math.max(0, 1 - across * 22) * (1 - Math.abs(along)) * (0.6 + 0.4 * n.get(along * 9 + 4, 2)) : 0;
        return Math.exp(-r * 11) * 2.2 + jet * 0.9;
      },
      (_u, _v, d) => Math.min(0.99, d),
    );
  }
  // Nebulae: a warped cloud; supernova remnants and planetary nebulae are hollow shells.
  const cls = o.classification.toLowerCase();
  const shell = cls.includes('supernova') || cls.includes('planetary');
  return paint(
    colors,
    (u, v) => {
      const w = n.fbm(u * 2 + 11, v * 2 + 3, 2) * 1.6;
      const cloud = n.fbm(u * 2.4 + w, v * 2.4 - w * 0.6, 4);
      const r = Math.hypot(u, v);
      const env = shell ? Math.exp(-Math.pow((r - 0.55) / 0.2, 2)) + 0.25 * Math.exp(-r * 6) : Math.max(0, 1 - r * 1.15);
      return Math.max(0, cloud - 0.3) * 2.2 * env;
    },
    (u, v) => n.get(u * 1.6 + 40, v * 1.6 + 9),
  );
}

const cache = new Map<string, Portrait>();

export function portraitFor(o: AstroObject): Portrait {
  const hit = cache.get(o.id);
  if (hit) return hit;
  const catalogue = getCatalogue();
  const S = PORTRAIT_SIZE;
  let portrait: Portrait;
  const sprite = catalogue.sprite(o.id);
  const envId = primaryEnvironment(o);
  if (sprite) {
    const c = spriteCanvas(sprite);
    portrait = { source: 'image', animated: false, draw: (ctx) => ctx.drawImage(c, 0, 0, S, S) };
  } else if (o.category === 'galaxy' || o.category === 'quasar' || o.category === 'nebula' || !envId) {
    const c = deepSky(o);
    portrait = { source: 'procedural', animated: false, draw: (ctx) => ctx.drawImage(c, 0, 0) };
  } else {
    // The same renderer and catalogue-derived look the game uses for this object.
    const bp = environment(envId).build({ rng: new Rng(hashString(o.id)), index: 20, object: o, catalogue });
    const b = bp.body;
    const ring = b.look.ring;
    const hole = b.kind === 'blackhole';
    const small = b.kind === 'neutron' || b.radius < 9;
    const radiusPx = hole ? (40 * b.radius) / b.heatRadius : ring ? Math.min(26, (44 * b.radius) / ring.outer) : small ? 12 : 30;
    const body = new BodyRenderer(b.kind, b.look, radiusPx, hashString(o.id), radiusPx / b.radius, hole ? 40 : 0);
    const glow = makeGlow(Math.min(46, radiusPx * (small ? 3.4 : 1.5)), b.look.glow, small ? 1 : 0.7);
    const spin = Math.max(0.05, b.spin);
    portrait = {
      source: 'procedural',
      animated: true,
      draw: (ctx, t) => {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(glow, S / 2 - (glow.width >> 1), S / 2 - (glow.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
        body.update(t, spin);
        ctx.drawImage(body.canvas, S / 2 - body.half, S / 2 - body.half);
      },
    };
  }
  if (cache.size > 48) cache.clear();
  cache.set(o.id, portrait);
  return portrait;
}
