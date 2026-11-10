/** Tiny 3x5 bitmap font for crisp in-world pixel text (score popups, warnings). */

function rows(r: string[]): Uint8Array {
  return Uint8Array.from(
    r
      .join('')
      .split('')
      .map((c) => (c === '#' ? 1 : 0)),
  );
}

const FONT: Record<string, Uint8Array> = {
  A: rows(['.#.', '#.#', '###', '#.#', '#.#']),
  B: rows(['##.', '#.#', '##.', '#.#', '##.']),
  C: rows(['.##', '#..', '#..', '#..', '.##']),
  D: rows(['##.', '#.#', '#.#', '#.#', '##.']),
  E: rows(['###', '#..', '##.', '#..', '###']),
  F: rows(['###', '#..', '##.', '#..', '#..']),
  G: rows(['.##', '#..', '#.#', '#.#', '.##']),
  H: rows(['#.#', '#.#', '###', '#.#', '#.#']),
  I: rows(['###', '.#.', '.#.', '.#.', '###']),
  J: rows(['..#', '..#', '..#', '#.#', '.#.']),
  K: rows(['#.#', '#.#', '##.', '#.#', '#.#']),
  L: rows(['#..', '#..', '#..', '#..', '###']),
  M: rows(['#.#', '###', '###', '#.#', '#.#']),
  N: rows(['##.', '#.#', '#.#', '#.#', '#.#']),
  O: rows(['.#.', '#.#', '#.#', '#.#', '.#.']),
  P: rows(['##.', '#.#', '##.', '#..', '#..']),
  Q: rows(['.#.', '#.#', '#.#', '##.', '.##']),
  R: rows(['##.', '#.#', '##.', '#.#', '#.#']),
  S: rows(['.##', '#..', '.#.', '..#', '##.']),
  T: rows(['###', '.#.', '.#.', '.#.', '.#.']),
  U: rows(['#.#', '#.#', '#.#', '#.#', '###']),
  V: rows(['#.#', '#.#', '#.#', '#.#', '.#.']),
  W: rows(['#.#', '#.#', '###', '###', '#.#']),
  X: rows(['#.#', '#.#', '.#.', '#.#', '#.#']),
  Y: rows(['#.#', '#.#', '.#.', '.#.', '.#.']),
  Z: rows(['###', '..#', '.#.', '#..', '###']),
  '0': rows(['###', '#.#', '#.#', '#.#', '###']),
  '1': rows(['.#.', '##.', '.#.', '.#.', '###']),
  '2': rows(['##.', '..#', '.#.', '#..', '###']),
  '3': rows(['##.', '..#', '.#.', '..#', '##.']),
  '4': rows(['#.#', '#.#', '###', '..#', '..#']),
  '5': rows(['###', '#..', '##.', '..#', '##.']),
  '6': rows(['.##', '#..', '###', '#.#', '###']),
  '7': rows(['###', '..#', '.#.', '.#.', '.#.']),
  '8': rows(['###', '#.#', '###', '#.#', '###']),
  '9': rows(['###', '#.#', '###', '..#', '##.']),
  '+': rows(['...', '.#.', '###', '.#.', '...']),
  '-': rows(['...', '...', '###', '...', '...']),
  '!': rows(['.#.', '.#.', '.#.', '...', '.#.']),
  '.': rows(['...', '...', '...', '...', '.#.']),
  '/': rows(['..#', '..#', '.#.', '#..', '#..']),
  ':': rows(['...', '.#.', '...', '.#.', '...']),
  x: rows(['...', '#.#', '.#.', '#.#', '...']),
  ' ': rows(['...', '...', '...', '...', '...']),
};

export function textWidth(text: string, scale = 1): number {
  return text.length > 0 ? (text.length * 4 - 1) * scale : 0;
}

/** Draw pixel text with an optional 1px dark drop shadow. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: 'left' | 'center' | 'right' = 'center',
  scale = 1,
  shadow: string | null = '#04050b',
): void {
  const w = textWidth(text, scale);
  const ox = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  const oy = Math.round(y);
  const passes: [string, number][] = shadow ? [[shadow, 1], [color, 0]] : [[color, 0]];
  for (const [col, off] of passes) {
    ctx.fillStyle = col;
    let cx = ox;
    for (const ch of text) {
      const g = FONT[ch] ?? FONT[ch.toUpperCase()] ?? FONT[' '];
      for (let i = 0; i < 15; i++) {
        if (g[i]) ctx.fillRect(cx + (i % 3) * scale + off, oy + Math.floor(i / 3) * scale + off, scale, scale);
      }
      cx += 4 * scale;
    }
  }
}
