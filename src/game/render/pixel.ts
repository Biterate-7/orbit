import { bayer, hexToRgb } from '../math';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Crisp 1px circle outline (midpoint algorithm). `dash` = [on, off] in plotted pixels. */
export function pixelCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  dash?: [number, number],
  dashOffset = 0,
): void {
  cx = Math.round(cx);
  cy = Math.round(cy);
  r = Math.round(r);
  if (r <= 0) {
    ctx.fillRect(cx, cy, 1, 1);
    return;
  }
  let x = r;
  let y = 0;
  let err = 1 - r;
  let i = 0;
  const period = dash ? dash[0] + dash[1] : 0;
  const offs = Math.floor(dashOffset);
  while (x >= y) {
    if (!dash || (i + offs) % period < dash[0]) {
      ctx.fillRect(cx + x, cy + y, 1, 1);
      ctx.fillRect(cx + y, cy + x, 1, 1);
      ctx.fillRect(cx - y, cy + x, 1, 1);
      ctx.fillRect(cx - x, cy + y, 1, 1);
      ctx.fillRect(cx - x, cy - y, 1, 1);
      ctx.fillRect(cx - y, cy - x, 1, 1);
      ctx.fillRect(cx + y, cy - x, 1, 1);
      ctx.fillRect(cx + x, cy - y, 1, 1);
    }
    i++;
    y++;
    if (err < 0) {
      err += 2 * y + 1;
    } else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}

/** Dotted ring sampled by angle; good for large radii and rotating dashes. */
export function dottedRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  spacingPx: number,
  phase: number,
  dashLen = 1,
): void {
  if (r < 2) return;
  const n = Math.max(8, Math.floor((Math.PI * 2 * r) / spacingPx));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < dashLen; k++) {
      const a = ((i + k / Math.max(1, spacingPx)) / n) * Math.PI * 2 + phase;
      ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
    }
  }
}

/** Pre-rendered dithered radial glow (for additive blending). */
export function makeGlow(radius: number, color: string, intensity: number, falloff = 1.6): HTMLCanvasElement {
  const r = Math.max(2, Math.round(radius));
  const size = r * 2 + 1;
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  const [cr, cg, cb] = hexToRgb(color);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r;
      const dy = y - r;
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d >= 1) continue;
      const v = Math.pow(1 - d, falloff) * 4;
      const lv = Math.floor(v + bayer(x, y) - 0.25);
      if (lv <= 0) continue;
      const i = (y * size + x) * 4;
      img.data[i] = cr;
      img.data[i + 1] = cg;
      img.data[i + 2] = cb;
      img.data[i + 3] = Math.min(255, lv * 255 * 0.15 * intensity);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

