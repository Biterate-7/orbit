import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/game/config';
import { orbitInfo } from '../src/game/orbital';
import { NO_CONTROLS } from '../src/game/player';
import { eccentricAnomaly, seasonIntensity } from '../src/game/rails';
import { Run } from '../src/game/run';
import type { RunSink } from '../src/game/run';
import type { LevelDef } from '../src/game/types';
import { ENVIRONMENTS } from '../src/generation/environments';
import { generateLevelFromSeed } from '../src/generation/levelGenerator';
import { candidateSeed } from '../src/generation/seed';
import { autopilot, simulateLevel } from './harness';

const quiet: RunSink = { sfx: () => undefined, message: () => undefined, levelIntro: () => undefined, upgradeReady: () => undefined, died: () => undefined };

/** First seeded level of an environment at a given sector. */
function findLevel(env: string, index: number, accept: (l: LevelDef) => boolean = () => true): LevelDef {
  for (let seed = 1; seed < 20000; seed++) {
    const l = generateLevelFromSeed(seed, index);
    if (l.identity.environment === env && accept(l)) return l;
  }
  throw new Error(`no ${env} level found`);
}

/** Semi-major axis of the ship's orbit about the barycentre. */
function sma(run: Run): number {
  const s = run.ship;
  const info = orbitInfo(s.x, s.y, s.vx, s.vy, run.level.orbitMu);
  return (info.peri + info.apo) / 2;
}

function coast(level: LevelDef, seconds: number): Run {
  const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
  for (let i = 0; i < seconds / CONFIG.STEP; i++) run.step(CONFIG.STEP, NO_CONTROLS);
  return run;
}

describe('rails', () => {
  it("solves Kepler's equation", () => {
    for (const e of [0, 0.1, 0.5, 0.9]) {
      for (const m of [0.1, 1, 2.5, 4, 6]) {
        const E = eccentricAnomaly(m, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(m, 6);
      }
    }
  });

  it('peaks activity at periapsis and rests at apoapsis', () => {
    expect(seasonIntensity(0, 0.5)).toBeCloseTo(1, 6);
    expect(seasonIntensity(Math.PI, 0.5)).toBeCloseTo(0, 6);
    expect(seasonIntensity(1, 0.5)).toBeGreaterThan(seasonIntensity(2, 0.5));
    expect(seasonIntensity(1, 0)).toBe(0);
  });
});

describe('survivability', () => {
  it('every generated configuration can hold its orbit for the whole sector', () => {
    const failures: string[] = [];
    const perEnv = new Map<string, number>();
    for (let k = 0; k < 420; k++) {
      const index = 1 + (k % 70);
      const level = generateLevelFromSeed(candidateSeed(0xa11ce, index, k), index);
      const res = simulateLevel(level);
      perEnv.set(level.identity.environment, (perEnv.get(level.identity.environment) ?? 0) + 1);
      if (!res.survived || !res.cleared) failures.push(`${level.code} ${level.identity.environment}/${level.identity.orbit} [${level.mechanicKeys.join(',')}] -> ${res.cause || 'not cleared'}`);
    }
    expect(failures).toEqual([]);
    // The sample is broad enough to have exercised every environment.
    for (const env of ENVIRONMENTS) expect(perEnv.get(env.id) ?? 0, env.id).toBeGreaterThan(0);
  }, 300000);

  it('every environment survives at shallow and deep sectors alike', () => {
    for (const env of ENVIRONMENTS) {
      for (const index of [Math.max(env.minLevel, 2), 45, 150]) {
        const res = simulateLevel(findLevel(env.id, index));
        expect(res.survived && res.cleared, `${env.id} @ sector ${index}: ${res.cause}`).toBe(true);
      }
    }
  }, 300000);

  it('stays numerically sane with every hazard switched on', () => {
    for (let k = 0; k < 40; k++) {
      const index = 3 + k * 2;
      const level = generateLevelFromSeed(candidateSeed(0xbeef, index, k), index);
      const run = new Run({ demo: false, sink: quiet, seed: level.seed, level });
      for (let i = 0; i < 25 / CONFIG.STEP; i++) {
        run.step(CONFIG.STEP, autopilot(run));
        if (run.phase === 'dead') break;
      }
      const s = run.ship;
      for (const v of [s.x, s.y, s.vx, s.vy, s.hull, s.stability, run.score]) expect(Number.isFinite(v), level.code).toBe(true);
      expect(run.hazards.length, level.code).toBeLessThan(150);
      for (const h of run.hazards) expect(Number.isFinite(h.x) && Number.isFinite(h.y), level.code).toBe(true);
    }
  }, 120000);
});

describe('environment mechanics change how the orbit behaves', () => {
  it('frame dragging decays an untended orbit around a black hole', () => {
    const level = findLevel('black_hole', 12);
    const before = level.startRadius;
    const run = coast(level, 12);
    expect(sma(run)).toBeLessThan(before - 6);
  });

  it('a calm rocky world leaves an untended orbit alone', () => {
    const level = findLevel('rocky', 1);
    const run = coast(level, 12);
    expect(Math.abs(sma(run) - level.startRadius)).toBeLessThan(2);
  });

  it('stellar wind pushes an untended orbit outward', () => {
    const level = findLevel('blue_giant', 9, (l) => l.identity.orbit === 'circular');
    const run = coast(level, 3);
    const s = run.ship;
    expect(run.windNow).toBeGreaterThan(0);
    // Under an outward push the same speed is too fast for the radius: the orbit swells.
    expect(orbitInfo(s.x, s.y, s.vx, s.vy, level.orbitMu).apo).toBeGreaterThan(level.startRadius + 3);
  });

  it('a ring plane bleeds orbital energy from a ship flying inside it', () => {
    const level = findLevel('ringed', 6);
    const zone = level.mechanics.dragZones[0];
    const inside: LevelDef = { ...level, startRadius: (Math.max(zone.rMin, level.safeMin) + zone.rMax) / 2 };
    const run = coast(inside, 6);
    expect(sma(run)).toBeLessThan(inside.startRadius - 3);
    expect(run.inDrag || sma(run) < zone.rMin).toBe(true);
  });

  it('a binary keeps tugging the orbit; a single star does not', () => {
    const wobble = (level: LevelDef): number => {
      const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 14 / CONFIG.STEP; i++) {
        run.step(CONFIG.STEP, NO_CONTROLS);
        const a = sma(run);
        lo = Math.min(lo, a);
        hi = Math.max(hi, a);
      }
      return hi - lo;
    };
    expect(wobble(findLevel('binary', 9))).toBeGreaterThan(wobble(findLevel('red_dwarf', 9, (l) => l.companions.length === 0)) + 0.5);
  });

  it('a pulsating star moves its heat zone in and out', () => {
    const level = findLevel('variable_star', 10);
    const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < 16 / CONFIG.STEP; i++) {
      run.step(CONFIG.STEP, autopilot(run));
      lo = Math.min(lo, run.heatRadiusNow);
      hi = Math.max(hi, run.heatRadiusNow);
    }
    expect(hi - lo).toBeGreaterThan(20);
    // At maximum it reaches into the band, at minimum it lets go of it.
    expect(hi).toBeGreaterThan(level.safeMin);
    expect(lo).toBeLessThan(level.safeMin);
  });

  it('magnetic bursts take the thrusters offline', () => {
    const level = findLevel('neutron_star', 12);
    const run = new Run({ demo: false, sink: quiet, seed: level.seed, level });
    let offline = false;
    for (let i = 0; i < 40 / CONFIG.STEP && !offline; i++) {
      run.step(CONFIG.STEP, autopilot(run));
      if (run.empT > 0.2) {
        offline = true;
        // Full throttle does nothing while the burst lasts.
        run.step(CONFIG.STEP, { accel: true, brake: false, lateral: 1, boost: false });
        expect(run.ship.thrust).toBe(0);
        expect(run.ship.lateral).toBe(0);
      }
      if (run.phase === 'dying' || run.phase === 'dead') break;
    }
    expect(offline).toBe(true);
  });

  it('inclined debris can only be struck near the nodes', () => {
    const level = findLevel('white_dwarf', 14, (l) => l.identity.orbit === 'inclined');
    const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
    for (let i = 0; i < 6 / CONFIG.STEP; i++) run.step(CONFIG.STEP, autopilot(run));
    const belt = run.hazards.filter((h) => h.inc > 0);
    expect(belt.length).toBeGreaterThan(6);
    expect(belt.some((h) => h.offPlane)).toBe(true);
  });
});

describe('offline play', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never touches the network while generating or playing', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access during gameplay');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', function () {
      throw new Error('network access during gameplay');
    });
    const run = new Run({ demo: false, sink: quiet, seed: 31337, noSpawns: true });
    let sectors = 0;
    let last = run.levelIndex;
    for (let i = 0; i < 200 / CONFIG.STEP && sectors < 4; i++) {
      run.step(CONFIG.STEP, autopilot(run));
      if (run.levelIndex !== last) {
        last = run.levelIndex;
        sectors++;
      }
      if (run.phase === 'dead') break;
    }
    expect(sectors).toBeGreaterThanOrEqual(3);
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 120000);
});
