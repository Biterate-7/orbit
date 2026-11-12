/**
 * Mission autopilots for the headless tests. Each one flies a mission the way a player would read
 * it - from the trajectory preview and the objective - using only the ship's real controls
 * (accelerate, brake, strafe). They exist to prove that every mission can actually be completed,
 * not to play well.
 */
import { CONFIG } from '../src/game/config';
import { wrapAngle } from '../src/game/math';
import { orbitInfo, predictTrajectory } from '../src/game/orbital';
import type { Attractor } from '../src/game/physics';
import type { Controls } from '../src/game/player';
import { placeAttractors } from '../src/game/rails';
import type { Run } from '../src/game/run';
import type { Anchor } from '../src/game/missions/types';

const COAST: Controls = { accel: false, brake: false, lateral: 0, boost: false };

/**
 * Hold a circular orbit of radius R about the barycentre, the way a pilot does it: burn near
 * apoapsis to set the periapsis, near periapsis to set the apoapsis, strafe out radial drift.
 */
export function holdOrbit(run: Run, R: number): Controls {
  const s = run.ship;
  const info = orbitInfo(s.x, s.y, s.vx, s.vy, run.level.orbitMu * run.mission.muScale);
  const spin = Math.sign(info.h) || 1;
  const lateral = Math.abs(info.vRadial) > 4 ? spin * Math.sign(info.vRadial) : 0;
  if (info.escaping) return { accel: false, brake: true, lateral, boost: false };
  const nearApo = info.r > (info.peri + info.apo) / 2;
  const v = nearApo ? info.peri : info.apo;
  return { accel: v < R - 2, brake: v > R + 2, lateral, boost: false };
}

/**
 * Steer towards a point moving with velocity (tvx, tvy): a PD law projected onto the two axes the
 * ship can actually push along (prograde and sideways), applied bang-bang like key presses.
 */
export function rendezvous(run: Run, tx: number, ty: number, tvx: number, tvy: number): Controls {
  const s = run.ship;
  const ax = 0.7 * (tx - s.x) + 1.8 * (tvx - s.vx);
  const ay = 0.7 * (ty - s.y) + 1.8 * (tvy - s.vy);
  const sp = Math.hypot(s.vx, s.vy) || 1;
  const px = s.vx / sp;
  const py = s.vy / sp;
  const along = ax * px + ay * py;
  const side = -ax * py + ay * px;
  return { accel: along > 1, brake: along < -1, lateral: side > 1.5 ? 1 : side < -1.5 ? -1 : 0, boost: false };
}

/**
 * Orbital rendezvous with something on a circular orbit of radius r: phase onto it (a slightly
 * lower orbit is a faster one), then simply share its orbit.
 */
export function phaseAndHold(run: Run, x: number, y: number, r: number): Controls {
  const s = run.ship;
  const ahead = wrapAngle(Math.atan2(y, x) - Math.atan2(s.y, s.x));
  const R = r - Math.max(-16, Math.min(16, ahead * 45));
  return holdOrbit(run, R);
}

/** World position of a mission anchor at mission time t. */
export function anchorAt(run: Run, a: Anchor, t: number): { x: number; y: number } {
  const ang = run.frameAngle + a.angle + a.omega * t;
  return { x: Math.cos(ang) * a.r, y: Math.sin(ang) * a.r };
}

const buf = new Float32Array(2 * 800);

/**
 * Closest predicted approach (coasting) to a moving target, starting from the ship's position with
 * a hypothetical velocity. Uses the same predictor as the in-game trajectory preview.
 */
function closestApproach(run: Run, vx: number, vy: number, target: (t: number) => { x: number; y: number }, horizon: number): number {
  const s = run.ship;
  const att: Attractor[] = run.attractors.map((a) => ({ ...a }));
  const L = run.level;
  const place = L.companions.length > 0 || L.body.orbit ? (t: number, a: Attractor[]) => placeAttractors(L, t, a) : null;
  const dt = 1 / 40;
  const res = predictTrajectory(s.x, s.y, vx, vy, att, place, run.simTime, horizon, dt, buf, L.body.radius * run.bodyPulse + 2, L.companions.map((c) => c.radius + 4));
  let best = Infinity;
  for (let i = 0; i < res.count; i++) {
    const p = target(run.mission.t + (i + 1) * dt);
    best = Math.min(best, Math.hypot(buf[i * 2] - p.x, buf[i * 2 + 1] - p.y));
  }
  return res.crashed ? best + 1000 : best;
}

/**
 * Trajectory shooting, the way a player uses the preview: compare coasting with a short burn in each
 * direction and keep whichever brings the predicted path closest to the target.
 */
export function shootFor(run: Run, target: (t: number) => { x: number; y: number }, capture: number, horizon = 14): Controls {
  const s = run.ship;
  const base = closestApproach(run, s.vx, s.vy, target, horizon);
  if (base < capture * 0.55) return COAST;
  const sp = Math.hypot(s.vx, s.vy) || 1;
  const px = s.vx / sp;
  const py = s.vy / sp;
  const dv = CONFIG.THRUST * run.level.thrustScale * 0.3;
  const options: [Controls, number][] = [
    [{ accel: true, brake: false, lateral: 0, boost: false }, closestApproach(run, s.vx + px * dv, s.vy + py * dv, target, horizon)],
    [{ accel: false, brake: true, lateral: 0, boost: false }, closestApproach(run, s.vx - px * dv, s.vy - py * dv, target, horizon)],
    [{ accel: false, brake: false, lateral: 1, boost: false }, closestApproach(run, s.vx - py * dv * 0.6, s.vy + px * dv * 0.6, target, horizon)],
    [{ accel: false, brake: false, lateral: -1, boost: false }, closestApproach(run, s.vx + py * dv * 0.6, s.vy - px * dv * 0.6, target, horizon)],
  ];
  let best: [Controls, number] = [COAST, base * 0.985];
  for (const o of options) if (o[1] < best[1]) best = o;
  return best[0];
}

/** Thread the next gate using the preview's crossing radius (the HUD's RAISE / LOWER hint). */
export function gatePilot(run: Run): Controls {
  const m = run.mission;
  const g = m.gates[m.nextGate];
  if (!g) return holdOrbit(run, run.level.startRadius);
  const s = run.ship;
  const info = orbitInfo(s.x, s.y, s.vx, s.vy, run.level.orbitMu);
  const spin = Math.sign(info.h) || 1;
  const lateral = Math.abs(info.vRadial) > 6 ? spin * Math.sign(info.vRadial) : 0;
  if (Number.isNaN(g.predR)) return holdOrbit(run, g.r);
  const d = g.r - g.predR;
  return { accel: d > 1.5, brake: d < -1.5, lateral: Math.abs(d) < 3 ? 0 : lateral, boost: false };
}
