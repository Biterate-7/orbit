/**
 * Headless simulation harness: runs the real game simulation (no canvas, no audio) with a simple
 * orbit-keeping autopilot. It answers one question for the tests - "can this generated level be
 * survived at all?" - by flying the level's own mechanics without dodging anything.
 */
import { CONFIG } from '../src/game/config';
import { orbitInfo } from '../src/game/orbital';
import type { Controls } from '../src/game/player';
import { Run } from '../src/game/run';
import type { RunSink } from '../src/game/run';
import type { LevelDef } from '../src/game/types';

export interface SimResult {
  survived: boolean;
  cause: string;
  time: number;
  hull: number;
  minStability: number;
  cleared: boolean;
}

/** Hold the semi-major axis at the start radius and damp radial motion - nothing smarter than that. */
export function autopilot(run: Run): Controls {
  const s = run.ship;
  const L = run.level;
  const info = orbitInfo(s.x, s.y, s.vx, s.vy, L.orbitMu);
  const sma = info.escaping ? Infinity : (info.peri + info.apo) / 2;
  const target = L.startRadius;
  const spin = Math.sign(info.h) || 1;
  const lateral = Math.abs(info.vRadial) > 2.5 ? spin * Math.sign(info.vRadial) : 0;
  return { accel: sma < target - 1.5, brake: sma > target + 1.5, lateral, boost: false };
}

export function simulateLevel(level: LevelDef, opts: { noSpawns?: boolean; seconds?: number } = {}): SimResult {
  let cause = '';
  const sink: RunSink = {
    sfx: () => undefined,
    message: () => undefined,
    levelIntro: () => undefined,
    upgradeReady: () => undefined,
    died: (c) => {
      cause = c;
    },
  };
  const run = new Run({ demo: false, sink, seed: level.seed, level, noSpawns: opts.noSpawns ?? true });
  const limit = opts.seconds ?? level.duration + CONFIG.INTRO_TIME + 1;
  let minStability = 100;
  let cleared = false;
  const steps = Math.ceil(limit / CONFIG.STEP);
  for (let i = 0; i < steps; i++) {
    run.step(CONFIG.STEP, autopilot(run));
    if (run.ship.stability < minStability) minStability = run.ship.stability;
    if (run.phase === 'clearing' || run.phase === 'warping') {
      cleared = true;
      break;
    }
    if (run.phase === 'dying' || run.phase === 'dead') break;
  }
  const dead = run.phase === 'dying' || run.phase === 'dead';
  return { survived: !dead, cause: dead ? cause || run.deathCause : '', time: run.time, hull: run.ship.hull, minStability, cleared };
}
