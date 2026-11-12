/**
 * Draws everything a mission adds to a sector, in the same low-resolution pixel style as the rest
 * of the renderer: gates, beacons, docks, nebula gas, wormholes, magnetic regions, pickups, mines,
 * enemy craft, guide buoys, apsis markers and the objective pointer.
 */
import { PALETTE } from '../config';
import { bayer, clamp, hexToRgb, TAU } from '../math';
import { orbitInfo } from '../orbital';
import type { Mission } from '../missions/runtime';
import type { Run } from '../run';
import { drawText } from './font';
import { ctx2d, dottedRing, makeCanvas, pixelCircle } from './pixel';
import { buildEnemySprites, frameIndex, SHIP_FRAMES } from './sprites';
import type { EnemySprites } from './sprites';

type ToScreen = (w: number) => number;
type Glow = (radius: number, color: string, intensity: number) => HTMLCanvasElement;

export class MissionLayer {
  private hunter: EnemySprites;
  private sentinel: EnemySprites;
  private clouds: { canvas: HTMLCanvasElement; x0: number; y0: number } | null = null;
  private cloudOwner: Mission | null = null;
  private cloudZoom = 0;
  private glow: Glow;

  constructor(glow: Glow) {
    this.glow = glow;
    this.hunter = buildEnemySprites('hunter');
    this.sentinel = buildEnemySprites('sentinel');
  }

  // ------------------------------------------------------------------ under the hazards

  drawUnder(ctx: CanvasRenderingContext2D, run: Run, toSx: ToScreen, toSy: ToScreen, time: number, z: number): void {
    const m = run.mission;
    if (!m || run.demo) return;
    if (m.clouds.length > 0) this.drawClouds(ctx, run, m, toSx, toSy, z);

    // Mission radii (escape ring, photon ring).
    for (const [r, color, label] of m.rings()) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(time * 4);
      dottedRing(ctx, toSx(run.bx), toSy(run.by), r * z, 4, time * 0.15, 2);
      ctx.globalAlpha = 0.8;
      drawText(ctx, label, toSx(run.bx), toSy(run.by - r) - 7, color, 'center');
      ctx.globalAlpha = 1;
    }

    // Magnetic regions: a boundary and arrows turning with the field.
    for (const f of m.fields) {
      const cx = toSx(f.x);
      const cy = toSy(f.y);
      const col = f.turn > 0 ? PALETTE.cyan : PALETTE.violet;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.35;
      dottedRing(ctx, cx, cy, f.r * z, 4, time * f.turn);
      ctx.globalAlpha = 0.6;
      for (let k = 0; k < 3; k++) {
        const a0 = time * f.turn * 1.5 + (k * TAU) / 3;
        for (let i = 0; i < 8; i++) {
          const a = a0 + Math.sign(f.turn) * i * 0.09;
          const rr = f.r * z * 0.6;
          ctx.fillRect(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), 1, 1);
        }
        const tip = a0 + Math.sign(f.turn) * 0.8;
        ctx.fillRect(Math.round(cx + Math.cos(tip) * f.r * z * 0.6) - 1, Math.round(cy + Math.sin(tip) * f.r * z * 0.6) - 1, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    // Wormholes: two spiral mouths.
    for (const w of m.wormholes) {
      for (const [x, y, col] of [
        [w.ax, w.ay, PALETTE.violet],
        [w.bx, w.by, PALETTE.cyan],
      ] as [number, number, string][]) {
        const cx = toSx(x);
        const cy = toSy(y);
        ctx.globalCompositeOperation = 'lighter';
        const g = this.glow(w.r * z * 1.6, col, 0.8);
        ctx.drawImage(g, cx - (g.width >> 1), cy - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = col;
        for (let arm = 0; arm < 3; arm++) {
          for (let i = 0; i < 14; i++) {
            const k = i / 14;
            const a = w.spin * 2 + arm * (TAU / 3) + k * 3;
            const rr = (1 - k) * w.r * z;
            ctx.globalAlpha = 0.4 + 0.6 * (1 - k);
            ctx.fillRect(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), 1, 1);
          }
        }
        ctx.globalAlpha = 0.5;
        pixelCircle(ctx, cx, cy, w.r * z, [2, 2], Math.floor(time * 6));
        ctx.globalAlpha = 1;
      }
    }

    // Gates: the next one bright, the one after dimmer, the rest faint.
    for (const g of m.gates) {
      if (g.passed && g.flash <= 0) continue;
      const next = g.index === m.nextGate;
      const soon = g.index === m.nextGate + 1;
      const alpha = g.passed ? g.flash / 0.6 : next ? 1 : soon ? 0.55 : 0.2;
      const missed = !g.passed && g.flash > 0;
      const blink = Math.floor(time * 10) % 2 === 0;
      let col: string = PALETTE.gray;
      if (g.passed) col = PALETTE.green;
      else if (missed) col = blink ? PALETTE.red : PALETTE.amber;
      else if (next) col = g.aligned ? PALETTE.green : PALETTE.white;
      const x1 = toSx(g.x1);
      const y1 = toSy(g.y1);
      const x2 = toSx(g.x2);
      const y2 = toSy(g.y2);
      ctx.globalAlpha = alpha * (next ? 0.9 : 0.6);
      ctx.fillStyle = next && g.aligned ? PALETTE.green : PALETTE.cyanDim;
      const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 3));
      for (let i = 1; i < n; i++) ctx.fillRect(Math.round(x1 + ((x2 - x1) * i) / n), Math.round(y1 + ((y2 - y1) * i) / n), 1, 1);
      if (next) {
        ctx.globalCompositeOperation = 'lighter';
        for (const [px, py] of [
          [x1, y1],
          [x2, y2],
        ]) {
          const gl = this.glow(5, g.aligned ? PALETTE.green : PALETTE.cyan, 0.9);
          ctx.drawImage(gl, px - (gl.width >> 1), py - (gl.height >> 1));
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      ctx.fillRect(x1 - 1, y1 - 1, 3, 3);
      ctx.fillRect(x2 - 1, y2 - 1, 3, 3);
      ctx.fillStyle = PALETTE.white;
      ctx.fillRect(x1, y1, 1, 1);
      ctx.fillRect(x2, y2, 1, 1);
      if (next || soon) {
        const ox = (x2 - x1) * 0.18;
        const oy = (y2 - y1) * 0.18;
        drawText(ctx, String(g.index + 1), x2 + ox, y2 + oy - 2, next ? col : PALETTE.gray, 'center');
      }
      ctx.globalAlpha = 1;
    }

    // Targets: jump gates, beacons, docks and stabiliser nodes.
    for (const t of m.targets) {
      if (t.hidden || t.done) continue;
      const cx = toSx(t.x);
      const cy = toSy(t.y);
      const rp = t.r * z;
      const node = run.level.mission.kind === 'boss_neutron';
      const base = t.kind === 'dock' ? (node ? PALETTE.cyan : PALETTE.violet) : t.kind === 'gate' ? PALETTE.amber : PALETTE.orange;
      const col = t.aligned ? PALETTE.green : base;
      ctx.globalCompositeOperation = 'lighter';
      const g = this.glow(Math.max(4, rp * 0.6), col, 0.7);
      ctx.drawImage(g, cx - (g.width >> 1), cy - (g.height >> 1));
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = col;
      if (t.kind === 'gate') {
        ctx.globalAlpha = 0.9;
        dottedRing(ctx, cx, cy, rp, 3, time * 1.2, 2);
        ctx.globalAlpha = 0.5;
        dottedRing(ctx, cx, cy, rp * 0.65, 4, -time * 2);
        ctx.globalAlpha = 1;
        ctx.fillRect(cx - 1, cy - 3, 3, 7);
        ctx.fillRect(cx - 3, cy - 1, 7, 3);
        ctx.fillStyle = PALETTE.white;
        ctx.fillRect(cx, cy, 1, 1);
        drawText(ctx, 'JUMP', cx, cy - rp - 7, col, 'center');
      } else if (t.kind === 'beacon') {
        const pulse = (time * 1.5) % 1;
        ctx.globalAlpha = 1 - pulse;
        pixelCircle(ctx, cx, cy, rp * (0.3 + pulse * 0.9));
        ctx.globalAlpha = 0.7;
        dottedRing(ctx, cx, cy, rp, 4, time * 0.5);
        ctx.globalAlpha = 1;
        ctx.fillRect(cx - 2, cy, 5, 1);
        ctx.fillRect(cx, cy - 2, 1, 5);
        ctx.fillRect(cx - 1, cy - 1, 3, 3);
        ctx.fillStyle = PALETTE.white;
        ctx.fillRect(cx, cy, 1, 1);
        drawText(ctx, 'BEACON', cx, cy - rp - 7, col, 'center');
      } else {
        // Dock / node: a capture ring and a progress arc.
        ctx.globalAlpha = 0.45;
        dottedRing(ctx, cx, cy, rp, 4, time * 0.6);
        ctx.globalAlpha = 1;
        if (t.sync > 0) {
          const steps = Math.ceil(t.sync * 40);
          ctx.fillStyle = PALETTE.green;
          for (let i = 0; i < steps; i++) {
            const a = -Math.PI / 2 + (i / 40) * TAU;
            ctx.fillRect(Math.round(cx + Math.cos(a) * (rp + 2)), Math.round(cy + Math.sin(a) * (rp + 2)), 1, 1);
          }
          ctx.fillStyle = col;
        }
        const spin = time * (node ? 3 : 1);
        for (let k = 0; k < 4; k++) {
          const a = spin + (k * TAU) / 4;
          ctx.fillRect(Math.round(cx + Math.cos(a) * 4) - 1, Math.round(cy + Math.sin(a) * 4) - 1, 2, 2);
        }
        ctx.fillStyle = PALETTE.white;
        ctx.fillRect(cx - 1, cy - 1, 3, 3);
        drawText(ctx, node ? 'NODE' : 'DOCK', cx, cy - rp - 7, col, 'center');
      }
      ctx.globalAlpha = 1;
    }

    // Pickups.
    for (const p of m.pickups) {
      if (p.taken) continue;
      const cx = toSx(p.x);
      const cy = toSy(p.y + Math.sin(p.bob) * 0.8);
      const blink = Math.floor(time * 4 + p.bob) % 2 === 0;
      ctx.globalCompositeOperation = 'lighter';
      const col = p.kind === 'shard' ? PALETTE.amber : p.kind === 'fuel' ? PALETTE.orange : p.kind === 'aegis' ? PALETTE.cyan : p.kind === 'repair' ? PALETTE.green : p.kind === 'cell' ? PALETTE.violet : PALETTE.red;
      const g = this.glow(p.kind === 'charge' ? 9 : 6, col, 1);
      ctx.drawImage(g, cx - (g.width >> 1), cy - (g.height >> 1));
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = col;
      switch (p.kind) {
        case 'shard':
          ctx.fillRect(cx, cy - 2, 1, 5);
          ctx.fillRect(cx - 1, cy - 1, 3, 3);
          ctx.fillStyle = blink ? PALETTE.white : PALETTE.amber;
          ctx.fillRect(cx, cy - 1, 1, 1);
          break;
        case 'fuel':
          ctx.fillRect(cx - 1, cy - 2, 3, 5);
          ctx.fillStyle = PALETTE.white;
          ctx.fillRect(cx, cy - 3, 1, 1);
          ctx.fillRect(cx, cy, 1, 1);
          break;
        case 'aegis':
          for (let k = 0; k < 6; k++) {
            const a = (k * TAU) / 6 + time;
            ctx.fillRect(Math.round(cx + Math.cos(a) * 3), Math.round(cy + Math.sin(a) * 3), 1, 1);
          }
          ctx.fillStyle = PALETTE.white;
          ctx.fillRect(cx, cy, 1, 1);
          break;
        case 'repair':
          ctx.fillRect(cx - 2, cy, 5, 1);
          ctx.fillRect(cx, cy - 2, 1, 5);
          break;
        case 'cell':
          ctx.fillRect(cx - 1, cy - 2, 3, 5);
          ctx.fillRect(cx - 2, cy - 1, 5, 3);
          ctx.fillStyle = PALETTE.white;
          ctx.fillRect(cx, cy - 1, 1, 2);
          break;
        case 'charge': {
          const r = 3 + (blink ? 1 : 0);
          pixelCircle(ctx, cx, cy, r + 2, [1, 1], Math.floor(time * 8));
          ctx.fillRect(cx - 1, cy - 1, 3, 3);
          ctx.fillStyle = PALETTE.white;
          ctx.fillRect(cx, cy, 1, 1);
          drawText(ctx, 'CHARGE', cx, cy - 11, PALETTE.red, 'center');
          break;
        }
      }
    }

    // Mines.
    for (const mine of m.mines) {
      if (mine.state === 'dead') continue;
      const cx = toSx(mine.x);
      const cy = toSy(mine.y);
      const hot = mine.state !== 'dormant';
      const blink = Math.floor(time * (mine.state === 'dormant' ? 2 : 12)) % 2 === 0;
      if (hot) {
        ctx.globalCompositeOperation = 'lighter';
        const g = this.glow(7, PALETTE.red, 1);
        ctx.drawImage(g, cx - (g.width >> 1), cy - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.fillStyle = '#5a1a2a';
      ctx.fillRect(cx - 2, cy - 1, 5, 3);
      ctx.fillRect(cx - 1, cy - 2, 3, 5);
      ctx.fillStyle = PALETTE.gray;
      ctx.fillRect(cx - 3, cy, 1, 1);
      ctx.fillRect(cx + 3, cy, 1, 1);
      ctx.fillRect(cx, cy - 3, 1, 1);
      ctx.fillRect(cx, cy + 3, 1, 1);
      ctx.fillStyle = blink ? PALETTE.red : '#7a2030';
      ctx.fillRect(cx, cy, 1, 1);
      if (mine.state === 'armed') {
        ctx.fillStyle = PALETTE.red;
        ctx.globalAlpha = 0.6;
        dottedRing(ctx, cx, cy, 22 * z, 3, time * 4);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawClouds(ctx: CanvasRenderingContext2D, run: Run, m: Mission, toSx: ToScreen, toSy: ToScreen, z: number): void {
    if (this.cloudOwner !== m || Math.abs(this.cloudZoom - z) > 0.01 || !this.clouds) {
      this.cloudOwner = m;
      this.cloudZoom = z;
      this.clouds = this.buildClouds(m, z, run.level.theme.accent, run.level.theme.nebulaB);
    }
    const c = this.clouds;
    ctx.globalAlpha = m.inCloud ? 1 : 0.92;
    ctx.drawImage(c.canvas, toSx(c.x0), toSy(c.y0));
    ctx.globalAlpha = 1;
  }

  /** Bake every gas knot into one dithered sprite: dense dark cores, bright ionised rims. */
  private buildClouds(m: Mission, z: number, rimColor: string, coreColor: string): { canvas: HTMLCanvasElement; x0: number; y0: number } {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of m.clouds) {
      x0 = Math.min(x0, c.x - c.r);
      y0 = Math.min(y0, c.y - c.r);
      x1 = Math.max(x1, c.x + c.r);
      y1 = Math.max(y1, c.y + c.r);
    }
    const w = Math.ceil((x1 - x0) * z) + 2;
    const h = Math.ceil((y1 - y0) * z) + 2;
    const dens = new Float32Array(w * h);
    for (const c of m.clouds) {
      const cx = (c.x - x0) * z;
      const cy = (c.y - y0) * z;
      const rp = c.r * z;
      for (let y = Math.max(0, Math.floor(cy - rp)); y < Math.min(h, Math.ceil(cy + rp)); y++) {
        for (let x = Math.max(0, Math.floor(cx - rp)); x < Math.min(w, Math.ceil(cx + rp)); x++) {
          const d = Math.hypot(x - cx, y - cy) / rp;
          if (d >= 1) continue;
          const i = y * w + x;
          dens[i] = Math.max(dens[i], 1 - d);
        }
      }
    }
    const canvas = makeCanvas(w, h);
    const g = ctx2d(canvas);
    const img = g.createImageData(w, h);
    const rim = hexToRgb(rimColor);
    const core = hexToRgb(coreColor);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = dens[y * w + x];
        if (v <= 0) continue;
        const i = (y * w + x) * 4;
        if (v < 0.16) {
          if (v * 5 < bayer(x, y)) continue;
          img.data[i] = rim[0];
          img.data[i + 1] = rim[1];
          img.data[i + 2] = rim[2];
          img.data[i + 3] = 210;
        } else {
          // Dense interior: a dithered mix of the ionised rim colour and the nebula's own tint, so
          // the gas reads as solid however dark the sector's palette is.
          const d = bayer(x, y);
          if (clamp(v * 2.4, 0, 1) < d * 0.9) continue;
          const lit = d < 0.3 + 0.25 * v;
          const c = lit ? rim : core;
          img.data[i] = c[0];
          img.data[i + 1] = c[1];
          img.data[i + 2] = c[2];
          img.data[i + 3] = lit ? 120 : 200;
        }
      }
    }
    g.putImageData(img, 0, 0);
    return { canvas, x0, y0 };
  }

  // ------------------------------------------------------------------ craft, over the ship

  drawOver(ctx: CanvasRenderingContext2D, run: Run, toSx: ToScreen, toSy: ToScreen, time: number, z: number): void {
    const m = run.mission;
    if (!m || run.demo) return;
    const s = run.ship;
    for (const e of m.enemies) {
      const cx = toSx(e.x);
      const cy = toSy(e.y);
      const set = e.kind === 'sentinel' ? this.sentinel : this.hunter;
      const fi = frameIndex(e.heading, SHIP_FRAMES);
      // Dash wind-up: the line it is about to charge down.
      if (e.dashCharge > 0) {
        const dx = s.x - e.x;
        const dy = s.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        ctx.fillStyle = Math.floor(time * 12) % 2 ? PALETTE.red : PALETTE.amber;
        ctx.globalAlpha = 0.8;
        for (let r = 8; r < Math.min(220, d + 30); r += 4) ctx.fillRect(Math.round(cx + (dx / d) * r * z), Math.round(cy + (dy / d) * r * z), 1, 1);
        ctx.globalAlpha = 1;
      }
      if (e.heat > 0.05 || e.stun > 0) {
        ctx.globalCompositeOperation = 'lighter';
        const g = this.glow(e.radius * z * 2.2, PALETTE.amber, 0.4 + e.heat * 0.9 + (e.stun > 0 ? 0.6 : 0));
        ctx.drawImage(g, cx - (g.width >> 1), cy - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
      }
      let sprite = set.frames[fi];
      if (e.flash > 0 && Math.floor(time * 20) % 2 === 0) sprite = set.white[fi];
      else if ((e.heat > 0.7 || e.stun > 0) && Math.floor(time * 8) % 2 === 0) sprite = set.hot[fi];
      ctx.drawImage(sprite, cx - (sprite.width >> 1), cy - (sprite.height >> 1));
      // Weapon wind-up: the nose lights before a shot.
      if (e.telegraph > 0) {
        const hx = Math.cos(e.heading);
        const hy = Math.sin(e.heading);
        ctx.globalCompositeOperation = 'lighter';
        const g = this.glow(4 + (1 - e.telegraph / 0.45) * 4, PALETTE.red, 1.2);
        ctx.drawImage(g, Math.round(cx + hx * e.radius * z) - (g.width >> 1), Math.round(cy + hy * e.radius * z) - (g.height >> 1));
        ctx.globalCompositeOperation = 'source-over';
      }
      // Hit points as pips under the craft.
      for (let i = 0; i < e.hpMax; i++) {
        ctx.fillStyle = i < e.hp ? PALETTE.red : PALETTE.dark;
        ctx.fillRect(cx - e.hpMax * 2 + i * 4, cy + Math.round(e.radius * z) + 4, 3, 1);
      }
      if (e.kind === 'sentinel') {
        // Heat gauge: its weakness, in plain sight.
        const w = 18;
        ctx.fillStyle = PALETTE.dark;
        ctx.fillRect(cx - w / 2, cy + Math.round(e.radius * z) + 7, w, 1);
        ctx.fillStyle = e.heat > 0.7 ? PALETTE.red : PALETTE.amber;
        ctx.fillRect(cx - w / 2, cy + Math.round(e.radius * z) + 7, Math.round(w * clamp(e.heat, 0, 1)), 1);
      }
    }

    // The aegis bubble around the ship.
    if (m.aegisT > 0 && s.visible) {
      const sx = toSx(s.x);
      const sy = toSy(s.y);
      const fading = m.aegisT < 2 && Math.floor(time * 10) % 2 === 0;
      if (!fading) {
        ctx.fillStyle = PALETTE.cyan;
        ctx.globalAlpha = 0.85;
        for (let k = 0; k < 6; k++) {
          const a0 = (k * TAU) / 6 + time * 1.5;
          const a1 = a0 + TAU / 6;
          for (let i = 0; i <= 4; i++) {
            const t = i / 4;
            const x = Math.cos(a0) * (1 - t) + Math.cos(a1) * t;
            const y = Math.sin(a0) * (1 - t) + Math.sin(a1) * t;
            ctx.fillRect(Math.round(sx + x * 11), Math.round(sy + y * 11), 1, 1);
          }
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // ------------------------------------------------------------------ above the fog

  drawAboveFog(ctx: CanvasRenderingContext2D, run: Run, toSx: ToScreen, toSy: ToScreen, time: number, vw: number, vh: number): void {
    const m = run.mission;
    if (!m || run.demo || !run.ship.visible) return;

    // Guide buoys glow through the gas.
    for (let i = 0; i < m.buoys.length; i++) {
      const b = m.buoys[i];
      const on = Math.floor(time * 3 - i * 0.35) % 3 !== 0;
      if (!on) continue;
      ctx.fillStyle = b.alt ? PALETTE.amber : PALETTE.cyan;
      ctx.globalAlpha = 0.7;
      const x = toSx(b.x);
      const y = toSy(b.y);
      ctx.fillRect(x, y, 1, 1);
      ctx.globalAlpha = 0.3;
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y - 1, 1, 3);
    }
    ctx.globalAlpha = 1;

    if (run.phase === 'active' || run.phase === 'intro') {
      this.drawApsides(ctx, run, toSx, toSy);
      this.drawPointer(ctx, m, toSx, toSy, time, vw, vh, run);
    }
  }

  /** Periapsis and apoapsis markers: where a burn will have its effect. */
  private drawApsides(ctx: CanvasRenderingContext2D, run: Run, toSx: ToScreen, toSy: ToScreen): void {
    const L = run.level;
    if (run.modifierOn('blind')) return;
    if (L.mission.orbitRule !== 'free' && L.mission.kind !== 'precision') return;
    const s = run.ship;
    const mu = run.attractors[0].mu;
    const rx = s.x - run.bx;
    const ry = s.y - run.by;
    const info = orbitInfo(rx, ry, s.vx, s.vy, mu);
    if (info.ecc < 0.04) return;
    const v2 = s.vx * s.vx + s.vy * s.vy;
    const rv = rx * s.vx + ry * s.vy;
    const ex = ((v2 - mu / info.r) * rx - rv * s.vx) / mu;
    const ey = ((v2 - mu / info.r) * ry - rv * s.vy) / mu;
    const el = Math.hypot(ex, ey) || 1;
    const ux = ex / el;
    const uy = ey / el;
    const mark = (d: number, label: string, color: string): void => {
      const x = toSx(run.bx + ux * d);
      const y = toSy(run.by + uy * d);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y - 1, 1, 3);
      drawText(ctx, label, x, y - 7, color, 'center');
      ctx.globalAlpha = 1;
    };
    mark(info.peri, 'PE', PALETTE.cyan);
    if (!info.escaping && Number.isFinite(info.apo) && info.apo < 600) mark(-info.apo, 'AP', PALETTE.amber);
  }

  /** Corner brackets on an on-screen objective, an edge arrow with its distance otherwise. */
  private drawPointer(ctx: CanvasRenderingContext2D, m: Mission, toSx: ToScreen, toSy: ToScreen, time: number, vw: number, vh: number, run: Run): void {
    const p = m.pointer();
    if (!p) return;
    const px = toSx(p.x);
    const py = toSy(p.y);
    ctx.fillStyle = p.color;
    if (px > 6 && py > 6 && px < vw - 6 && py < vh - 6) {
      const r = 9 + Math.round(Math.sin(time * 6));
      ctx.globalAlpha = 0.85;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          ctx.fillRect(px + sx * r, py + sy * r, 1, 1);
          ctx.fillRect(px + sx * (r - 1), py + sy * r, 1, 1);
          ctx.fillRect(px + sx * r, py + sy * (r - 1), 1, 1);
        }
      }
      ctx.globalAlpha = 1;
      return;
    }
    const cx = vw / 2;
    const cy = vh / 2;
    const dx = px - cx;
    const dy = py - cy;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const k = Math.min((cx - 14) / Math.max(1e-3, Math.abs(ux)), (cy - 14) / Math.max(1e-3, Math.abs(uy)));
    const ax = Math.round(cx + ux * k);
    const ay = Math.round(cy + uy * k);
    ctx.globalAlpha = Math.floor(time * 4) % 2 ? 1 : 0.6;
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(Math.round(ax - ux * i - uy * i), Math.round(ay - uy * i + ux * i), 1, 1);
      ctx.fillRect(Math.round(ax - ux * i + uy * i), Math.round(ay - uy * i - ux * i), 1, 1);
    }
    const dist = Math.round(Math.hypot(p.x - run.ship.x, p.y - run.ship.y));
    drawText(ctx, String(dist), ax - ux * 12, ay - uy * 12 - 2, p.color, 'center');
    ctx.globalAlpha = 1;
  }
}
