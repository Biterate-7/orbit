// Generates the Windows application icon from the game's pixel-art favicon.
//
//   node scripts/build-icon.mjs      (or: npm run icon)
//
// public/favicon.svg is a 16x16 grid of solid <rect>s, so it is rasterised here directly and
// scaled up with nearest-neighbour sampling to keep the pixels crisp. Outputs:
//   build/icon.ico  - multi-size Windows icon (16-256 px) used for the .exe, shortcuts and installer
//   build/icon.png  - 256x256 preview of the same artwork
// No dependencies: PNG and ICO are encoded by hand with node:zlib.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8');

const GRID = 16;
const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
if (!viewBox || Number(viewBox[1]) !== GRID || Number(viewBox[2]) !== GRID) {
  throw new Error(`favicon.svg must use viewBox="0 0 ${GRID} ${GRID}"`);
}

// Paint the source grid (RGBA, transparent by default) in document order.
const grid = new Uint8Array(GRID * GRID * 4);
const attr = (tag, name, fallback) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : fallback;
};
for (const [tag] of svg.matchAll(/<rect\b[^>]*>/g)) {
  const x = Number(attr(tag, 'x', '0'));
  const y = Number(attr(tag, 'y', '0'));
  const w = Number(attr(tag, 'width', '0'));
  const h = Number(attr(tag, 'height', '0'));
  const fill = /^#([0-9a-f]{6})$/i.exec(attr(tag, 'fill', ''));
  if (!fill || ![x, y, w, h].every(Number.isInteger)) throw new Error(`Unsupported rect: ${tag}`);
  const rgb = [0, 2, 4].map((i) => parseInt(fill[1].slice(i, i + 2), 16));
  for (let py = y; py < Math.min(GRID, y + h); py++) {
    for (let px = x; px < Math.min(GRID, x + w); px++) {
      grid.set([...rgb, 255], (py * GRID + px) * 4);
    }
  }
}

/** Nearest-neighbour upscale of the grid to size x size, RGBA top-down. */
function render(size) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.floor((y * GRID) / size);
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x * GRID) / size);
      out.set(grid.subarray((sy * GRID + sx) * 4, (sy * GRID + sx) * 4 + 4), (y * size + x) * 4);
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Classic 32-bit DIB icon image (BGRA bottom-up + AND mask): the most widely compatible ICO entry. */
function encodeDib(size, rgba) {
  const maskStride = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR bitmap + AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4 + maskStride * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  const mask = Buffer.alloc(maskStride * size); // alpha channel carries transparency
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = (row * size + x) * 4;
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
      if (rgba[s + 3] === 0) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, pixels, mask]);
}

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const images = SIZES.map((size) => {
  const rgba = render(size);
  // Vista+ convention: PNG for 256 px, uncompressed DIB for the small sizes.
  return { size, data: size >= 256 ? encodePng(size, rgba) : encodeDib(size, rgba) };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(({ size, data }) => {
  const e = Buffer.alloc(16);
  e[0] = size >= 256 ? 0 : size;
  e[1] = size >= 256 ? 0 : size;
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});

const outDir = join(root, 'build');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));
writeFileSync(join(outDir, 'icon.png'), encodePng(256, render(256)));
console.log(`Wrote build/icon.ico (${SIZES.join(', ')} px) and build/icon.png (256 px)`);
