/**
 * Translates a photograph into the game's visual language: a tiny, palette-indexed pixel sprite.
 * The result keeps the composition and colours of the source image but none of its resolution.
 */
import type { PixelSprite } from '../database/schema';
import { rgbToHex } from '../database/visuals';

export const SPRITE_SIZE = 32;
const MAX_COLORS = 12;

/** Centre-crop to a square and box-filter down to `size` x `size`. Returns RGB triples. */
function downsample(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, size: number): Float32Array {
  const side = Math.min(w, h);
  const ox = Math.floor((w - side) / 2);
  const oy = Math.floor((h - side) / 2);
  const out = new Float32Array(size * size * 3);
  const cell = side / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const y0 = Math.floor(oy + y * cell);
      const y1 = Math.max(y0 + 1, Math.floor(oy + (y + 1) * cell));
      const x0 = Math.floor(ox + x * cell);
      const x1 = Math.max(x0 + 1, Math.floor(ox + (x + 1) * cell));
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * w + sx) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          n++;
        }
      }
      const o = (y * size + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return out;
}

/** Median-cut colour quantisation. */
function medianCut(px: Float32Array, maxColors: number): [number, number, number][] {
  type Box = number[];
  const all: Box = [];
  for (let i = 0; i < px.length / 3; i++) all.push(i);
  let boxes: Box[] = [all];
  const range = (box: Box, ch: number): number => {
    let lo = 255;
    let hi = 0;
    for (const i of box) {
      const v = px[i * 3 + ch];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo;
  };
  while (boxes.length < maxColors) {
    let best = -1;
    let bestRange = 8;
    let bestCh = 0;
    boxes.forEach((box, bi) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        const r = range(box, ch) * Math.sqrt(box.length);
        if (r > bestRange) {
          bestRange = r;
          best = bi;
          bestCh = ch;
        }
      }
    });
    if (best < 0) break;
    const box = boxes[best].slice().sort((a, b) => px[a * 3 + bestCh] - px[b * 3 + bestCh]);
    const mid = box.length >> 1;
    boxes = [...boxes.slice(0, best), box.slice(0, mid), box.slice(mid), ...boxes.slice(best + 1)];
  }
  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const i of box) {
      r += px[i * 3];
      g += px[i * 3 + 1];
      b += px[i * 3 + 2];
    }
    return [r / box.length, g / box.length, b / box.length];
  });
}

export function quantizeToSprite(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): { sprite: PixelSprite; colors: string[] } | null {
  if (w < SPRITE_SIZE || h < SPRITE_SIZE) return null;
  const px = downsample(rgba, w, h, SPRITE_SIZE);
  const pal = medianCut(px, MAX_COLORS);
  const counts = new Array<number>(pal.length).fill(0);
  let data = '';
  for (let i = 0; i < px.length / 3; i++) {
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < pal.length; c++) {
      const d = (px[i * 3] - pal[c][0]) ** 2 + (px[i * 3 + 1] - pal[c][1]) ** 2 + (px[i * 3 + 2] - pal[c][2]) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    counts[best]++;
    data += best.toString(16);
  }
  const palette = pal.map(([r, g, b]) => rgbToHex(r, g, b));
  // Dominant colours: most common first, skipping the near-black of empty space, favouring saturated tones.
  const ranked = pal
    .map((c, i) => {
      const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      const sat = Math.max(...c) - Math.min(...c);
      return { hex: palette[i], lum, score: counts[i] * (0.35 + sat / 120) };
    })
    .filter((c) => c.lum > 26)
    .sort((a, b) => b.score - a.score);
  const colors = ranked.slice(0, 4).map((c) => c.hex);
  if (colors.length === 0) return null;
  return { sprite: { w: SPRITE_SIZE, h: SPRITE_SIZE, palette, data }, colors };
}
