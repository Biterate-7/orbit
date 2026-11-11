import { TAU } from './math';
import type { Attractor } from './physics';
import type { CompanionSpec, LevelDef } from './types';

/**
 * Bodies "on rails": companions follow exact Keplerian ellipses around the barycentre instead of
 * being integrated. The ship still feels their gravity, but they never feel the ship's - a
 * deliberate simplification (restricted n-body problem) that keeps every level reproducible.
 */

/** Solve Kepler's equation M = E - e sin E for the eccentric anomaly. */
export function eccentricAnomaly(meanAnomaly: number, e: number): number {
  let m = meanAnomaly % TAU;
  if (m < 0) m += TAU;
  let E = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 6; i++) {
    const f = E - e * Math.sin(E) - m;
    E -= f / (1 - e * Math.cos(E));
  }
  return E;
}

export function companionPosition(c: CompanionSpec, t: number, out: { x: number; y: number }): void {
  const M = c.phase + (TAU * t) / c.period;
  let px: number;
  let py: number;
  if (c.ecc < 1e-4) {
    px = Math.cos(M) * c.orbitRadius;
    py = Math.sin(M) * c.orbitRadius;
  } else {
    const E = eccentricAnomaly(M, c.ecc);
    px = c.orbitRadius * (Math.cos(E) - c.ecc);
    py = c.orbitRadius * Math.sqrt(1 - c.ecc * c.ecc) * Math.sin(E);
  }
  const ca = Math.cos(c.argPeri);
  const sa = Math.sin(c.argPeri);
  out.x = px * ca - py * sa;
  out.y = px * sa + py * ca;
}

const tmp = { x: 0, y: 0 };

/** Position every attractor of a level at time `t`. attractors[0] is the primary, then the companions in order. */
export function placeAttractors(level: LevelDef, t: number, attractors: Attractor[]): void {
  const o = level.body.orbit;
  if (o) {
    const a = o.phase + (TAU * t) / o.period;
    attractors[0].x = Math.cos(a) * o.radius;
    attractors[0].y = Math.sin(a) * o.radius;
  } else {
    attractors[0].x = 0;
    attractors[0].y = 0;
  }
  const n = Math.min(level.companions.length, attractors.length - 1);
  for (let i = 0; i < n; i++) {
    companionPosition(level.companions[i], t, tmp);
    attractors[i + 1].x = tmp.x;
    attractors[i + 1].y = tmp.y;
  }
}

/**
 * Normalised stellar flux received along an eccentric orbit: 0 at apoapsis, 1 at periapsis.
 * `phase` is the mean anomaly. Flux scales with 1/r^2 and r = a(1 - e cos E).
 */
export function seasonIntensity(phase: number, e: number): number {
  if (e < 1e-3) return 0;
  const E = eccentricAnomaly(phase, e);
  const flux = 1 / (1 - e * Math.cos(E)) ** 2;
  const lo = 1 / (1 + e) ** 2;
  const hi = 1 / (1 - e) ** 2;
  return (flux - lo) / (hi - lo);
}
