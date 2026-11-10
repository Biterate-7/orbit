import { useEffect, useRef } from 'react';
import { predictTrajectory } from '../game/orbital';
import type { Attractor } from '../game/physics';
import { drawText } from '../game/render/font';
import { dottedRing } from '../game/render/pixel';

const W = 192;
const H = 108;
const MU = 104000;
const R0 = 30;
const SAFE_MIN = 17;
const SAFE_MAX = 46;

/**
 * Small looping illustration of orbital control for the How To Play screen.
 * Uses the same gravity + trajectory prediction code as the game.
 */
export function OrbitDiagram() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const cx = W - 50;
    const cy = H / 2;
    const attractors: Attractor[] = [{ x: 0, y: 0, mu: MU, soft2: 4 }];
    const traj = new Float32Array(2 * 200);
    let x = 0;
    let y = -R0;
    let vx = Math.sqrt(MU / R0);
    let vy = 0;
    let t = 0;
    let raf = 0;
    let last = performance.now();
    const reset = () => {
      x = 0;
      y = -R0;
      vx = Math.sqrt(MU / R0);
      vy = 0;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const cycle = t % 8;
      if (cycle < dt) reset();
      let thrust = 0;
      let label = 'COAST: ORBIT HOLDS ITSELF';
      let col = '#8592bb';
      if (cycle > 1.4 && cycle < 1.95) {
        thrust = 1;
      }
      if (cycle > 1.4 && cycle < 4.2) {
        label = 'W: ACCELERATE - FAR SIDE RISES';
        col = '#ffc94d';
      }
      if (cycle > 4.6 && cycle < 5.7) thrust = -1;
      if (cycle > 4.6 && cycle < 7.6) {
        label = 'S: DECELERATE - FAR SIDE DROPS';
        col = '#3ef2ff';
      }
      // Integrate with a few substeps.
      const sub = 4;
      const h = dt / sub;
      for (let i = 0; i < sub; i++) {
        const r = Math.hypot(x, y);
        const g = MU / (r * r * r);
        const sp = Math.hypot(vx, vy) || 1;
        vx += (-x * g + (vx / sp) * thrust * 11) * h;
        vy += (-y * g + (vy / sp) * thrust * 11) * h;
        x += vx * h;
        y += vy * h;
      }
      const res = predictTrajectory(x, y, vx, vy, attractors, null, 0, 3.4, 1 / 30, traj, 6);

      ctx.fillStyle = '#03040a';
      ctx.fillRect(0, 0, W, H);
      // Rings
      ctx.fillStyle = '#ff4d5e';
      ctx.globalAlpha = 0.5;
      dottedRing(ctx, cx, cy, SAFE_MIN, 4, -t * 0.1, 1);
      ctx.fillStyle = '#3ef2ff';
      dottedRing(ctx, cx, cy, SAFE_MAX, 4, t * 0.1, 1);
      ctx.globalAlpha = 1;
      // Planet
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > 6.4) continue;
          const lit = (-dx - dy) / 9 + (1 - d / 6.4) * 0.6;
          ctx.fillStyle = d > 5.6 && lit > 0.1 ? '#3ef2ff' : lit > 0.75 ? '#8fb3e0' : lit > 0.35 ? '#5a7bb8' : lit > 0 ? '#3a4c8c' : '#252a5e';
          ctx.fillRect(cx + dx, cy + dy, 1, 1);
        }
      }
      // Predicted path
      for (let i = 1; i < res.count; i += 2) {
        const px = traj[i * 2];
        const py = traj[i * 2 + 1];
        const rr = Math.hypot(px, py);
        ctx.fillStyle = rr > SAFE_MAX || rr < SAFE_MIN ? '#ff4d5e' : '#3ef2ff';
        ctx.globalAlpha = i < res.count * 0.5 ? 0.9 : 0.45;
        ctx.fillRect(Math.round(cx + px), Math.round(cy + py), 1, 1);
      }
      ctx.globalAlpha = 1;
      // Ship
      const sx = Math.round(cx + x);
      const sy = Math.round(cy + y);
      const sp = Math.hypot(vx, vy) || 1;
      if (thrust !== 0) {
        ctx.fillStyle = thrust > 0 ? '#ff8a3d' : '#3ef2ff';
        const d = thrust > 0 ? -1 : 1;
        ctx.fillRect(Math.round(sx + (vx / sp) * 3 * d), Math.round(sy + (vy / sp) * 3 * d), 1, 1);
        ctx.fillRect(Math.round(sx + (vx / sp) * 4 * d), Math.round(sy + (vy / sp) * 4 * d), 1, 1);
      }
      ctx.fillStyle = '#e8f0ff';
      ctx.fillRect(sx - 1, sy - 1, 3, 3);
      ctx.fillStyle = '#3ef2ff';
      ctx.fillRect(Math.round(sx + (vx / sp) * 2), Math.round(sy + (vy / sp) * 2), 1, 1);

      drawText(ctx, label, 6, 6, col, 'left');
      drawText(ctx, 'SAFE BAND', 6, H - 20, '#3ef2ff', 'left');
      drawText(ctx, 'DANGER', 6, H - 11, '#ff4d5e', 'left');
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="diagram" width={W} height={H} aria-label="Animated diagram of orbital thrust" />;
}
