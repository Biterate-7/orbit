/**
 * Point-mass gravity simulation.
 * Gravity follows a simplified Newtonian model: a = G*M / r^2 toward each attractor,
 * with a small softening term to keep close encounters numerically stable.
 */

export interface Attractor {
  x: number;
  y: number;
  /** Gravitational parameter G*M. */
  mu: number;
  /** Softening length squared. */
  soft2: number;
}

export interface Vec {
  x: number;
  y: number;
}

/** Writes the summed gravitational acceleration at (x,y) into `out`. */
export function gravityAt(x: number, y: number, attractors: readonly Attractor[], scale: number, out: Vec): Vec {
  let ax = 0;
  let ay = 0;
  for (let i = 0; i < attractors.length; i++) {
    const a = attractors[i];
    const dx = a.x - x;
    const dy = a.y - y;
    const r2 = dx * dx + dy * dy + a.soft2;
    const inv = (a.mu * scale) / (r2 * Math.sqrt(r2));
    ax += dx * inv;
    ay += dy * inv;
  }
  out.x = ax;
  out.y = ay;
  return out;
}

/** A body integrated with kick-drift-kick leapfrog (symplectic, stable for orbits). */
export interface LeapfrogBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Cached gravity acceleration at current position. */
  gx: number;
  gy: number;
}

const tmp: Vec = { x: 0, y: 0 };

/**
 * Advance a body one step with velocity Verlet / leapfrog.
 * `ex, ey` is an external (non-gravitational) acceleration held constant during the step: thrust, wind, assists.
 */
export function leapfrogStep(
  b: LeapfrogBody,
  dt: number,
  attractors: readonly Attractor[],
  gScale: number,
  ex: number,
  ey: number,
): void {
  const h = dt * 0.5;
  b.vx += (b.gx + ex) * h;
  b.vy += (b.gy + ey) * h;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  gravityAt(b.x, b.y, attractors, gScale, tmp);
  b.gx = tmp.x;
  b.gy = tmp.y;
  b.vx += (b.gx + ex) * h;
  b.vy += (b.gy + ey) * h;
}

/** Semi-implicit Euler step for lightweight entities (hazards, energy motes). */
export function eulerStep(
  b: { x: number; y: number; vx: number; vy: number },
  dt: number,
  attractors: readonly Attractor[],
  gScale: number,
  ex: number,
  ey: number,
): void {
  gravityAt(b.x, b.y, attractors, gScale, tmp);
  b.vx += (tmp.x + ex) * dt;
  b.vy += (tmp.y + ey) * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}
