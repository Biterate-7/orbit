import { clamp } from './math';
import type { Attractor } from './physics';
import { gravityAt } from './physics';
import type { StabilityReason } from './types';

/** Keplerian orbit elements of a ship relative to a single central body. */
export interface OrbitInfo {
  r: number;
  speed: number;
  vCirc: number;
  vRadial: number;
  vTangential: number;
  energy: number;
  h: number;
  ecc: number;
  peri: number;
  apo: number;
  escaping: boolean;
}

export function circularSpeed(mu: number, r: number): number {
  return Math.sqrt(mu / Math.max(1, r));
}

export function orbitInfo(x: number, y: number, vx: number, vy: number, mu: number): OrbitInfo {
  const r = Math.max(1e-3, Math.hypot(x, y));
  const v2 = vx * vx + vy * vy;
  const energy = v2 * 0.5 - mu / r;
  const h = x * vy - y * vx;
  const vRadial = (x * vx + y * vy) / r;
  const vTangential = h / r;
  const ecc = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
  let peri: number;
  let apo: number;
  let escaping = false;
  if (energy < 0) {
    const a = -mu / (2 * energy);
    peri = a * (1 - ecc);
    apo = a * (1 + ecc);
  } else {
    escaping = true;
    peri = (h * h) / (mu * (1 + ecc));
    apo = Infinity;
  }
  return {
    r,
    speed: Math.sqrt(v2),
    vCirc: circularSpeed(mu, r),
    vRadial,
    vTangential,
    energy,
    h,
    ecc,
    peri,
    apo,
    escaping,
  };
}

export interface StabilityParams {
  bodyRadius: number;
  safeMin: number;
  safeMax: number;
  outerLimit: number;
  /** Extra drain from environment zones (heat etc.), per second. */
  zoneDrain: number;
  zoneReason: StabilityReason;
  /** Gravity Stabilizer stacks. */
  stabilizer: number;
}

export interface StabilityResult {
  /** Positive = regenerating, negative = draining (units per second). */
  rate: number;
  reason: StabilityReason;
  /** 0..1 how threatening the current trajectory is (for UI tinting). */
  danger: number;
}

/**
 * Orbit stability model.
 *
 * Stability drains when:
 *  - the predicted periapsis dips below the safe band (falling inward),
 *  - the predicted apoapsis rises above it, or the orbit is unbound (escaping),
 *  - the ship is currently outside the safe band (much stronger),
 *  - the ship is inside a dangerous environmental zone.
 * Otherwise it regenerates.
 */
export function evaluateStability(info: OrbitInfo, p: StabilityParams): StabilityResult {
  const innerSpan = Math.max(10, p.safeMin - p.bodyRadius);
  const outerSpan = Math.max(10, p.outerLimit - p.safeMax);

  const inF = info.peri < p.safeMin ? clamp((p.safeMin - info.peri) / innerSpan, 0, 1.6) : 0;
  const outF = info.escaping ? 1.6 : info.apo > p.safeMax ? clamp((info.apo - p.safeMax) / outerSpan, 0, 1.6) : 0;
  const posIn = info.r < p.safeMin ? clamp((p.safeMin - info.r) / innerSpan, 0, 1.5) : 0;
  const posOut = info.r > p.safeMax ? clamp((info.r - p.safeMax) / outerSpan, 0, 2.5) : 0;

  const inDrain = 8 * inF + 24 * posIn;
  const outDrain = 7 * outF + 17 * posOut;
  let drain = inDrain + outDrain + p.zoneDrain;
  let reason: StabilityReason = null;

  if (info.r > p.outerLimit * 1.18) {
    drain += 30;
    reason = 'SIGNAL LOST';
  } else if (p.zoneDrain > 0 && p.zoneDrain >= inDrain && p.zoneDrain >= outDrain) {
    reason = p.zoneReason;
  } else if (inDrain > 0.01 || outDrain > 0.01) {
    if (inDrain >= outDrain) reason = posIn > 0 ? 'TOO CLOSE' : 'DECAYING';
    else reason = posOut > 0 ? 'TOO FAR' : 'ESCAPING';
  }

  const drainMul = Math.pow(0.74, p.stabilizer);
  const regen = 6 * (1 + 0.35 * p.stabilizer);
  const danger = clamp(drain / 25, 0, 1);
  if (drain > 0.01) return { rate: -drain * drainMul, reason, danger };
  return { rate: regen, reason: null, danger: 0 };
}

/**
 * Predict the ship's ballistic trajectory (no thrust) for `seconds`.
 * Writes (x,y) pairs into `out` and returns the number of points.
 * `attractors` is a scratch copy: `place` moves its entries along their rails as time advances.
 */
export function predictTrajectory(
  x: number,
  y: number,
  vx: number,
  vy: number,
  attractors: Attractor[],
  place: ((t: number, attractors: Attractor[]) => void) | null,
  t0: number,
  seconds: number,
  dt: number,
  out: Float32Array,
  collideR: number,
): { count: number; crashed: boolean } {
  const steps = Math.min(Math.floor(seconds / dt), out.length >> 1);
  const g = { x: 0, y: 0 };
  let crashed = false;
  let n = 0;
  for (let i = 0; i < steps; i++) {
    // Bodies on rails are advanced along their paths during the prediction.
    if (place) place(t0 + i * dt, attractors);
    gravityAt(x, y, attractors, 1, g);
    vx += g.x * dt;
    vy += g.y * dt;
    x += vx * dt;
    y += vy * dt;
    out[n * 2] = x;
    out[n * 2 + 1] = y;
    n++;
    const dx = x - attractors[0].x;
    const dy = y - attractors[0].y;
    if (dx * dx + dy * dy < collideR * collideR) {
      crashed = true;
      break;
    }
  }
  return { count: n, crashed };
}
