import { memo, useEffect, useRef } from 'react';
import { DEFAULT_LOADOUT, resolveLook } from '../game/cosmetics/catalog';
import type { CosmeticDef, ParticleLook, ShipLook } from '../game/cosmetics/catalog';
import { ShipPainter } from '../game/render/shipPainter';

interface PreviewProps {
  look: ShipLook;
  /** Size of the low-resolution canvas, in its own pixels. */
  width?: number;
  height?: number;
  /** CSS pixels per canvas pixel. */
  scale?: number;
  /** Skip decorative layers (the reduced-effects setting). */
  reduced?: boolean;
  label?: string;
}

const TAU = Math.PI * 2;
const TRAIL = 48;

/**
 * The ship, live: drawn by the same painter the game uses, flying a slow loop so the hull
 * animation, engine, trail and special effect can all be seen working together.
 */
export function ShipPreview({ look, width = 150, height = 96, scale = 3, reduced = false, label = 'Ship preview' }: PreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const painter = useRef<ShipPainter | null>(null);
  if (!painter.current) painter.current = new ShipPainter(look);
  painter.current.setLook(look);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    const pts = new Float32Array(TRAIL * 2);
    // Exhaust: in flight the simulation spawns these; here a small local set shows the particle cosmetic.
    const puffs: { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }[] = [];
    let raf = 0;
    let last = performance.now();
    let t = 0;
    const cx = width / 2;
    const cy = height / 2;
    const rx = width * 0.3;
    const ry = height * 0.27;
    const at = (a: number): [number, number] => [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;
      ctx.clearRect(0, 0, width, height);
      const a = t * 0.85;
      // The loop's own recent path stands in for the in-flight trail buffer.
      for (let i = 0; i < TRAIL; i++) {
        const [x, y] = at(a - i * 0.055);
        pts[i * 2] = x;
        pts[i * 2 + 1] = y;
      }
      const p = painter.current as ShipPainter;
      p.drawTrail(ctx, pts, TRAIL, t);
      const [x, y] = at(a);
      const heading = Math.atan2(Math.cos(a) * ry, -Math.sin(a) * rx);
      const pl = p.look.particles;
      const slow = { standard: 1, embers: 0.5, ions: 1.5, frost: 0.4, pixels: 0.9, plasma: 0.7, stardust: 0.6, singularity: -0.35 }[pl.style];
      const long = { standard: 1, embers: 1.8, ions: 0.6, frost: 2, pixels: 1.2, plasma: 1.4, stardust: 2.2, singularity: 1.5 }[pl.style];
      if (!reduced && Math.random() < 0.7 * pl.rate && puffs.length < 40) {
        const spread = (Math.random() - 0.5) * 0.7;
        const sp = (14 + Math.random() * 16) * slow;
        const life = (0.25 + Math.random() * 0.25) * long;
        puffs.push({ x: x - Math.cos(heading) * 6, y: y - Math.sin(heading) * 6, vx: -Math.cos(heading + spread) * sp, vy: -Math.sin(heading + spread) * sp, life, max: life, color: pl.colors[Math.random() < 0.5 ? 0 : 1], size: pl.style === 'plasma' ? 2 : 1 });
      }
      for (let i = puffs.length - 1; i >= 0; i--) {
        const q = puffs[i];
        q.life -= dt;
        if (q.life <= 0) {
          puffs.splice(i, 1);
          continue;
        }
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        ctx.globalAlpha = Math.min(1, q.life / q.max + 0.15);
        ctx.fillStyle = q.color;
        ctx.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size);
      }
      ctx.globalAlpha = 1;
      p.draw(ctx, { x, y, heading, time: t, thrust: 1, boosting: false, hurt: false, overdrive: false, reduced });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [width, height, reduced]);

  return <canvas ref={ref} className="ship-preview" width={width} height={height} style={{ width: width * scale, height: height * scale }} role="img" aria-label={label} />;
}

interface ThumbProps {
  item: CosmeticDef;
  /** Draw as a dark silhouette (an item the pilot has not found yet). */
  locked?: boolean;
  scale?: number;
}

const THUMB = 30;

/**
 * A still of one cosmetic, shown on the stock ship so the part itself is what stands out. Hulls,
 * wings, canopies and cores face the camera; engines, trails and particles get a short wake.
 */
export const CosmeticThumb = memo(function CosmeticThumb({ item, locked = false, scale = 2 }: ThumbProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, THUMB, THUMB);
    const painter = new ShipPainter(resolveLook({ ...DEFAULT_LOADOUT, [item.slot]: item.id }));
    const wake = item.slot === 'trail' || item.slot === 'engine' || item.slot === 'particles';
    const x = wake ? THUMB - 9 : THUMB / 2;
    const y = THUMB / 2;
    if (item.slot === 'trail') {
      const pts = new Float32Array(40 * 2);
      for (let i = 0; i < 40; i++) {
        pts[i * 2] = x - 4 - i * 0.55;
        pts[i * 2 + 1] = y + Math.sin(i * 0.22) * 2.2;
      }
      painter.drawTrail(ctx, pts, 40, 1.3);
    }
    painter.draw(ctx, { x, y, heading: wake ? 0 : -Math.PI / 2 + TAU, time: 1.3, thrust: wake ? 1 : 0, boosting: false, hurt: false, overdrive: false });
    if (item.slot === 'particles') {
      const pl = item.look as ParticleLook;
      const size = pl.style === 'plasma' ? 2 : 1;
      for (let i = 0; i < 10; i++) {
        ctx.globalAlpha = 1 - i * 0.08;
        ctx.fillStyle = pl.colors[i % 2];
        ctx.fillRect(Math.round(x - 8 - i * 1.6), Math.round(y + Math.sin(i * 1.9) * (1 + i * 0.35)), size, size);
      }
      ctx.globalAlpha = 1;
    }
    if (locked) {
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = '#1a2146';
      ctx.fillRect(0, 0, THUMB, THUMB);
      ctx.globalCompositeOperation = 'source-over';
    }
  }, [item, locked]);
  return <canvas ref={ref} className="cos-thumb" width={THUMB} height={THUMB} style={{ width: THUMB * scale, height: THUMB * scale }} aria-hidden="true" />;
});
