import { ASTEROID_RADII, ASTEROID_VARIANTS, DEBRIS_VARIANTS } from '../hazards';
import { bayer, hexToRgb, TAU } from '../math';
import { Rng } from '../rng';
import { ctx2d, makeCanvas } from './pixel';

type PixelMap = (string | null)[][];

const SHIP_COLORS: Record<string, string> = {
  W: '#e8f0ff',
  G: '#9aa8cc',
  D: '#4a5680',
  C: '#3ef2ff',
  V: '#9b5cff',
  O: '#ff8a3d',
};

/** Ship facing +X (heading 0). */
const SHIP_ART = [
  '.VV........',
  '.DGW.......',
  '..DGWW.....',
  'ODGGWWCC...',
  'ODGWWWWCWWW',
  'ODGGWWCC...',
  '..DGWW.....',
  '.DGW.......',
  '.VV........',
];

function parseArt(art: string[], colors: Record<string, string>): PixelMap {
  return art.map((row) => row.split('').map((ch) => (ch === '.' ? null : colors[ch] ?? null)));
}

/** Supersampled nearest-neighbour rotation; keeps pixel-art edges crisp at any angle. */
function rotateMap(src: PixelMap, angle: number, outSize: number): HTMLCanvasElement {
  const h = src.length;
  const w = src[0].length;
  const scx = (w - 1) / 2;
  const scy = (h - 1) / 2;
  const c = makeCanvas(outSize, outSize);
  const g = ctx2d(c);
  const img = g.createImageData(outSize, outSize);
  const oc = (outSize - 1) / 2;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const counts = new Map<string, number>();
  for (let y = 0; y < outSize; y++) {
    for (let x = 0; x < outSize; x++) {
      counts.clear();
      let filled = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const dx = x - oc + (sx - 1) / 3;
          const dy = y - oc + (sy - 1) / 3;
          const u = Math.round(dx * cos - dy * sin + scx);
          const v = Math.round(dx * sin + dy * cos + scy);
          if (u < 0 || v < 0 || u >= w || v >= h) continue;
          const col = src[v][u];
          if (!col) continue;
          filled++;
          counts.set(col, (counts.get(col) ?? 0) + 1);
        }
      }
      if (filled < 4) continue;
      let best = '';
      let bc = 0;
      counts.forEach((n, col) => {
        if (n > bc) {
          bc = n;
          best = col;
        }
      });
      const [r, gg, b] = hexToRgb(best);
      const i = (y * outSize + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function tint(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const g = ctx2d(c);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export const SHIP_FRAMES = 32;

export interface ShipSprites {
  frames: HTMLCanvasElement[];
  white: HTMLCanvasElement[];
  ghost: HTMLCanvasElement[];
  size: number;
}

export function buildShipSprites(): ShipSprites {
  const map = parseArt(SHIP_ART, SHIP_COLORS);
  const size = 15;
  const frames: HTMLCanvasElement[] = [];
  const white: HTMLCanvasElement[] = [];
  const ghost: HTMLCanvasElement[] = [];
  for (let i = 0; i < SHIP_FRAMES; i++) {
    const f = rotateMap(map, (i / SHIP_FRAMES) * TAU, size);
    frames.push(f);
    white.push(tint(f, '#ffffff'));
    ghost.push(tint(f, '#3ef2ff'));
  }
  return { frames, white, ghost, size };
}

export function frameIndex(angle: number, frames: number): number {
  const a = ((angle % TAU) + TAU) % TAU;
  return Math.round((a / TAU) * frames) % frames;
}

// ---------------------------------------------------------------- asteroids

const ROCK_RAMP = ['#1d1630', '#3a2f52', '#5f5478', '#8b81a3', '#c0b7d4'];
const L3 = (() => {
  const v = [-0.55, -0.6, 0.58];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / l);
})();

export const ROCK_FRAMES = 16;

interface RockShape {
  verts: [number, number][];
  craters: [number, number, number][];
}

function makeRockShape(rng: Rng, n: number): RockShape {
  const verts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.range(-0.15, 0.15);
    const r = rng.range(0.74, 1.0);
    verts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const craters: [number, number, number][] = [];
  const cn = rng.int(1, 3);
  for (let i = 0; i < cn; i++) {
    const a = rng.range(0, TAU);
    const d = rng.range(0.1, 0.5);
    craters.push([Math.cos(a) * d, Math.sin(a) * d, rng.range(0.16, 0.3)]);
  }
  return { verts, craters };
}

function inPoly(x: number, y: number, v: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const [xi, yi] = v[i];
    const [xj, yj] = v[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function renderRock(shape: RockShape, radiusPx: number, angle: number, rampRgb: [number, number, number][]): HTMLCanvasElement {
  const size = radiusPx * 2 + 3;
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  const oc = (size - 1) / 2;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const R = radiusPx + 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - oc) / R;
      const dy = (y - oc) / R;
      // Shape space (rotates with the rock).
      const u = dx * cos - dy * sin;
      const v = dx * sin + dy * cos;
      if (!inPoly(u, v, shape.verts)) continue;
      const d2 = dx * dx + dy * dy;
      const nz = Math.sqrt(Math.max(0.05, 1 - d2));
      let light = (dx * L3[0] + dy * L3[1] + nz * L3[2]) * 0.9 + 0.12;
      for (const [cx, cy, cr] of shape.craters) {
        const ex = u - cx;
        const ey = v - cy;
        const cd = Math.hypot(ex, ey);
        if (cd < cr) {
          // Crater bowl: dark on the lit side, bright rim on the far side.
          const rx = ex * cos + ey * sin;
          const ry = -ex * sin + ey * cos;
          const side = (rx * L3[0] + ry * L3[1]) / Math.max(1e-3, cd);
          light += cd > cr * 0.7 ? 0.12 : -0.28 - side * 0.12;
        }
      }
      const levels = rampRgb.length;
      let idx = Math.floor(light * (levels - 1) + bayer(x, y) * 0.9);
      idx = Math.max(0, Math.min(levels - 1, idx));
      const [r, gg, b] = rampRgb[idx];
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export const ICE_RAMP = ['#16304a', '#2f5f8c', '#6fb0d8', '#bfe8ff', '#ffffff'];
export const ICE_RADII = [2.8, 3.8, 5] as const;

/**
 * frames[size][variant][rotationFrame]
 *
 * `rampHex` is the level's rock palette: it comes from the asteroid's taxonomic class when the level
 * is about a real small body, so a carbonaceous C-type field is dark and an S-type field is tan.
 */
export function buildRockSprites(
  zoom: number,
  rampHex: readonly string[] = ROCK_RAMP,
  radii: readonly number[] = ASTEROID_RADII,
  seed = 4242,
): HTMLCanvasElement[][][] {
  const rng = new Rng(seed);
  const rampRgb = (rampHex.length >= 3 ? rampHex : ROCK_RAMP).map(hexToRgb);
  const out: HTMLCanvasElement[][][] = [];
  for (let s = 0; s < 3; s++) {
    const rp = Math.max(2, Math.round(radii[s] * zoom));
    const sizeSet: HTMLCanvasElement[][] = [];
    for (let v = 0; v < ASTEROID_VARIANTS; v++) {
      const shape = makeRockShape(rng, 7 + s * 2);
      const frames: HTMLCanvasElement[] = [];
      for (let f = 0; f < ROCK_FRAMES; f++) frames.push(renderRock(shape, rp, (f / ROCK_FRAMES) * TAU, rampRgb));
      sizeSet.push(frames);
    }
    out.push(sizeSet);
  }
  return out;
}

// ---------------------------------------------------------------- debris

export const DEBRIS_FRAMES = 8;

export function buildDebrisSprites(): HTMLCanvasElement[][] {
  const rng = new Rng(777);
  const steel = { a: '#e8f0ff', b: '#9aa8cc', c: '#5a6b9a', d: '#2a3350' };
  const out: HTMLCanvasElement[][] = [];
  for (let v = 0; v < DEBRIS_VARIANTS; v++) {
    const art: PixelMap = [];
    for (let y = 0; y < 5; y++) {
      const row: (string | null)[] = [];
      for (let x = 0; x < 5; x++) {
        const edge = x === 0 || y === 0 || x === 4 || y === 4;
        const on = rng.chance(edge ? 0.35 : 0.85);
        row.push(on ? (y < 2 ? steel.a : x > 2 ? steel.c : steel.b) : null);
      }
      art.push(row);
    }
    art[2][2] = steel.b;
    art[rng.int(1, 3)][rng.int(1, 3)] = rng.chance(0.5) ? '#ff8a3d' : '#3ef2ff';
    const frames: HTMLCanvasElement[] = [];
    for (let f = 0; f < DEBRIS_FRAMES; f++) frames.push(rotateMap(art, (f / DEBRIS_FRAMES) * TAU, 7));
    out.push(frames);
  }
  return out;
}

// ---------------------------------------------------------------- energy motes

export function buildMoteSprites(): { small: HTMLCanvasElement[]; big: HTMLCanvasElement[] } {
  const C = '#3ef2ff';
  const W = '#ffffff';
  const D = '#1a7f8f';
  const V = '#b77dff';
  const P = '#6a3fd0';
  const smallArt: PixelMap[] = [
    [
      [null, C, null],
      [C, W, C],
      [null, C, null],
    ],
    [
      [D, null, D],
      [null, W, null],
      [D, null, D],
    ],
  ];
  const bigArt: PixelMap[] = [
    [
      [null, null, V, null, null],
      [null, V, W, V, null],
      [V, W, W, W, V],
      [null, V, W, V, null],
      [null, null, V, null, null],
    ],
    [
      [null, null, P, null, null],
      [null, P, V, P, null],
      [P, V, W, V, P],
      [null, P, V, P, null],
      [null, null, P, null, null],
    ],
  ];
  const toCanvas = (m: PixelMap): HTMLCanvasElement => {
    const c = makeCanvas(m[0].length, m.length);
    const g = ctx2d(c);
    m.forEach((row, y) =>
      row.forEach((col, x) => {
        if (col) {
          g.fillStyle = col;
          g.fillRect(x, y, 1, 1);
        }
      }),
    );
    return c;
  };
  return { small: smallArt.map(toCanvas), big: bigArt.map(toCanvas) };
}

/** Builds a crisp pixel icon canvas from the shared 9x9 icon maps. */
export function iconCanvas(map: string[], color: string, highlight = '#ffffff', dim = '#4b5a80'): HTMLCanvasElement {
  const c = makeCanvas(map[0].length, map.length);
  const g = ctx2d(c);
  map.forEach((row, y) =>
    row.split('').forEach((ch, x) => {
      const col = ch === '#' ? color : ch === '+' ? highlight : ch === 'd' ? dim : null;
      if (col) {
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }),
  );
  return c;
}
