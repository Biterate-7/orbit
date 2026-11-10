import { distToRay, wrapAngle } from './math';

export function circlesOverlap(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy < rr * rr;
}

/**
 * Predicts the closest approach between two linearly moving circles.
 * Returns time of closest approach (seconds, may be negative) and the miss distance.
 */
export function closestApproach(
  ax: number,
  ay: number,
  avx: number,
  avy: number,
  bx: number,
  by: number,
  bvx: number,
  bvy: number,
): { t: number; dist: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const dvx = bvx - avx;
  const dvy = bvy - avy;
  const dv2 = dvx * dvx + dvy * dvy;
  if (dv2 < 1e-6) return { t: Infinity, dist: Math.hypot(dx, dy) };
  const t = -(dx * dvx + dy * dvy) / dv2;
  return { t, dist: Math.hypot(dx + dvx * t, dy + dvy * t) };
}

/** Is a point inside an angular wedge centred on the origin? */
export function inWedge(x: number, y: number, angle: number, halfWidth: number, reach: number): boolean {
  const r = Math.hypot(x, y);
  if (r > reach) return false;
  return Math.abs(wrapAngle(Math.atan2(y, x) - angle)) < halfWidth;
}

/** Does a circle touch a beam (ray from the origin)? */
export function hitsBeam(x: number, y: number, radius: number, angle: number, length: number, halfWidth: number): boolean {
  return distToRay(x, y, 0, 0, Math.cos(angle), Math.sin(angle), length) < halfWidth + radius;
}

/** Ray vs axis-aligned rectangle (centred at origin) entry time for an off-screen object. */
export function timeToEnterRect(x: number, y: number, vx: number, vy: number, hw: number, hh: number): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(vx) < 1e-6) {
    if (x < -hw || x > hw) return Infinity;
  } else {
    const t1 = (-hw - x) / vx;
    const t2 = (hw - x) / vx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (Math.abs(vy) < 1e-6) {
    if (y < -hh || y > hh) return Infinity;
  } else {
    const t1 = (-hh - y) / vy;
    const t2 = (hh - y) / vy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (tmax < tmin || tmax < 0) return Infinity;
  return Math.max(0, tmin);
}
