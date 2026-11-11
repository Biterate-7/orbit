import { CONFIG } from './config';
import { TAU } from './math';
import type { Rng } from './rng';
import type { Hazard, HazardKind, LevelDef } from './types';

let nextId = 1;

export const ASTEROID_RADII = [4, 7, 11] as const;
export const ASTEROID_DAMAGE = [15, 25, 35] as const;
export const ASTEROID_VARIANTS = 4;
export const DEBRIS_VARIANTS = 4;

export function makeHazard(kind: HazardKind, size: 0 | 1 | 2, x: number, y: number, vx: number, vy: number, rng: Rng): Hazard {
  let r: number;
  let damage: number;
  let spin: number;
  let variants: number;
  switch (kind) {
    case 'asteroid':
      r = ASTEROID_RADII[size];
      damage = ASTEROID_DAMAGE[size];
      spin = rng.range(0.4, 2.2) * rng.sign() * (size === 2 ? 0.5 : 1);
      variants = ASTEROID_VARIANTS;
      break;
    case 'debris':
      r = 2.6;
      damage = 10;
      spin = rng.range(3, 7) * rng.sign();
      variants = DEBRIS_VARIANTS;
      break;
    case 'comet':
      r = 4.6;
      damage = 30;
      spin = 0;
      variants = 1;
      break;
    case 'bomb':
      // Molten ejecta or a blob of accreting plasma.
      r = 3.6;
      damage = 20;
      spin = 0;
      variants = 1;
      break;
    case 'ice':
      r = [2.8, 3.8, 5][size];
      damage = [12, 18, 24][size];
      spin = rng.range(1, 3) * rng.sign();
      variants = 3;
      break;
    case 'star':
      // A star on a plunging orbit near a galactic nucleus.
      r = 4.2;
      damage = 34;
      spin = 0;
      variants = 3;
      break;
  }
  return {
    id: nextId++,
    kind,
    size,
    x,
    y,
    vx,
    vy,
    r,
    rot: rng.range(0, TAU),
    spin,
    variant: rng.int(0, variants - 1),
    damage,
    gravity: 0.3,
    orbiting: false,
    alive: true,
    entered: false,
    hitPlayer: false,
    nearArmed: false,
    nearAwarded: false,
    age: 0,
    warnTime: 0,
    waveId: 0,
    inc: 0,
    node: 0,
    offPlane: false,
    ping: 0,
  };
}

export interface SpawnVector {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Pick a spawn point just outside the visible rectangle (by `lead` seconds of travel)
 * and aim it at a random point in the orbital band so it crosses the playfield.
 */
export function edgeSpawn(
  rng: Rng,
  level: LevelDef,
  hw: number,
  hh: number,
  speed: number,
  sideAngle?: number,
): SpawnVector {
  const lead = CONFIG.SPAWN_LEAD * speed;
  let ex: number;
  let ey: number;
  if (sideAngle !== undefined) {
    // Project a direction onto the rectangle border.
    const cx = Math.cos(sideAngle);
    const cy = Math.sin(sideAngle);
    const s = Math.min(hw / Math.max(1e-3, Math.abs(cx)), hh / Math.max(1e-3, Math.abs(cy)));
    ex = cx * s;
    ey = cy * s;
  } else {
    const per = 2 * (hw + hh);
    let t = rng.range(0, per);
    if (t < 2 * hw) {
      ex = t - hw;
      ey = -hh;
    } else if ((t -= 2 * hw) < 2 * hh) {
      ex = hw;
      ey = t - hh;
    } else if ((t -= 2 * hh) < 2 * hw) {
      ex = hw - t;
      ey = hh;
    } else {
      t -= 2 * hw;
      ex = -hw;
      ey = hh - t;
    }
  }
  const el = Math.hypot(ex, ey) || 1;
  const sx = ex + (ex / el) * lead;
  const sy = ey + (ey / el) * lead;
  const ta = rng.range(0, TAU);
  const tr = rng.range(level.safeMin * 0.75, level.safeMax * 0.95);
  const tx = Math.cos(ta) * tr;
  const ty = Math.sin(ta) * tr;
  const dx = tx - sx;
  const dy = ty - sy;
  const d = Math.hypot(dx, dy) || 1;
  return { x: sx, y: sy, vx: (dx / d) * speed, vy: (dy / d) * speed };
}
