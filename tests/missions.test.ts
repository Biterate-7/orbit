import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import { orbitInfo, predictTrajectory } from '../src/game/orbital';
import { NO_CONTROLS } from '../src/game/player';
import { Run } from '../src/game/run';
import type { RunSink } from '../src/game/run';
import { CURRICULUM, MISSION_ORDER, MISSIONS, NORMAL_MISSIONS } from '../src/game/missions/catalog';
import { wormholeVelocity } from '../src/game/missions/runtime';
import type { MissionDebrief, MissionKind } from '../src/game/missions/types';
import { betterRank, defaultSave } from '../src/game/persistence';
import { scoreMultiplier } from '../src/game/modifiers';
import { generateLevelFromSeed, levelFromCode } from '../src/generation/levelGenerator';
import { missionForSector } from '../src/generation/missionSchedule';
import { flyMission, missionLevel, stagedRunPilot } from './missionHarness';
import type { PilotState } from './missionHarness';

const quiet: RunSink = { sfx: () => undefined, message: () => undefined, levelIntro: () => undefined, upgradeReady: () => undefined, died: () => undefined };
const SEEDS = [11, 22, 33, 44];

function runFor(run: Run, seconds: number, controls = NO_CONTROLS): void {
  for (let i = 0; i < seconds / CONFIG.STEP; i++) {
    run.step(CONFIG.STEP, controls);
    if (run.phase === 'dying' || run.phase === 'dead') break;
  }
}

describe('mission schedule', () => {
  const journey = (runSeed: number, n: number): MissionKind[] => {
    const out: MissionKind[] = [];
    for (let i = 1; i <= n; i++) out.push(missionForSector(runSeed, i, out).kind);
    return out;
  };

  it('opens with the curriculum: one new idea per sector, a major encounter every fifth', () => {
    expect(journey(1, 15)).toEqual(CURRICULUM);
    // Every mission type is met within the first 15 sectors.
    for (const k of MISSION_ORDER) expect(CURRICULUM, k).toContain(k);
  });

  it('keeps a boss every fifth sector, rotating, and never repeats a mission back to back', () => {
    for (const seed of [1, 2, 3, 99, 4242]) {
      const j = journey(seed, 120);
      for (let i = 0; i < j.length; i++) {
        const sector = i + 1;
        expect(MISSIONS[j[i]].boss, `sector ${sector}`).toBe(sector % 5 === 0);
        if (i > 0) expect(j[i], `sector ${sector}`).not.toBe(j[i - 1]);
      }
      // After the curriculum every normal mission type keeps coming back.
      const late = new Set(j.slice(15));
      for (const k of NORMAL_MISSIONS) expect(late.has(k), k).toBe(true);
    }
  });

  it('escalates tiers: later appearances combine more mechanics', () => {
    expect(missionForSector(1, 2).tier).toBe(1);
    expect(missionForSector(1, 12).tier).toBe(2);
    expect(missionForSector(1, 5).tier).toBe(1);
    expect(missionForSector(1, 20).tier).toBe(2);
    expect(missionForSector(1, 35).tier).toBeGreaterThanOrEqual(3);
    // Tier-2 layouts carry mechanics tier 1 does not.
    const t1 = missionLevel('precision', 1, 5).mission;
    const t2 = missionLevel('precision', 2, 5).mission;
    expect(t2.gates.length).toBeGreaterThan(t1.gates.length);
    expect(t2.fields.length).toBeGreaterThan(0);
    expect(missionLevel('asteroid_run', 2, 5).mission.wormholes.length).toBe(1);
  });

  it('sets every mission in an environment it suits', () => {
    for (const kind of MISSION_ORDER) {
      for (let seed = 1; seed <= 12; seed++) {
        const l = missionLevel(kind, 1, seed * 97);
        const envs = MISSIONS[kind].envs;
        if (envs.length > 0) expect(envs, `${kind} ${l.code}`).toContain(l.identity.environment);
      }
    }
  });

  it('rebuilds any mission sector exactly from its code', () => {
    for (const kind of MISSION_ORDER) {
      const l = missionLevel(kind, 2, 1234);
      if (kind !== 'survival') expect(l.code).toMatch(new RegExp(`-${MISSIONS[kind].code}2$`));
      expect(levelFromCode(l.code)).toEqual(l);
    }
    // Old (survival) codes keep working.
    const old = generateLevelFromSeed(77, 9);
    expect(levelFromCode(old.code)).toEqual(old);
  });

  it('gives each mission its own objective layout', () => {
    const m = (k: MissionKind) => missionLevel(k, 1, 3).mission;
    expect(m('precision').gates.length).toBeGreaterThanOrEqual(5);
    expect(m('asteroid_run').rockBelts.length).toBeGreaterThanOrEqual(2);
    expect(m('asteroid_run').rockBelts.every((b) => b.gaps.length > 0)).toBe(true);
    expect(m('nebula').clouds.length).toBeGreaterThan(60);
    expect(m('nebula').buoys.length).toBeGreaterThan(10);
    expect(m('slingshot').fuel).toBeGreaterThan(0);
    expect(missionLevel('slingshot', 1, 3).companions.length).toBeGreaterThan(0);
    expect(m('event_horizon').params.growth).toBeGreaterThan(0);
    expect(m('extraction').targets[0].kind).toBe('dock');
    expect(m('boss_neutron').targets.length).toBe(5);
    for (const k of MISSION_ORDER) expect(m(k).orbitRule === 'free').toBe(['asteroid_run', 'slingshot', 'event_horizon', 'nebula', 'pursuit', 'boss_devourer', 'boss_sentinel'].includes(k));
  });
});

describe('every mission can be completed', () => {
  // Flown by autopilots that use only the ship's controls and what the HUD shows (tests/pilots.ts).
  for (const kind of MISSION_ORDER) {
    it(`${MISSIONS[kind].title} (tier 1)`, () => {
      const results = SEEDS.map((seed) => flyMission(missionLevel(kind, 1, seed)));
      const failed = results.filter((r) => !r.completed).map((r) => `${r.code} ${r.env}: ${r.died || r.failure || 'timeout'}`);
      // Bosses are built to demand skill the autopilots lack (they never use boost or the aegis
      // pickups, and skim coronas bare-hulled): one loss in four is allowed there, none elsewhere.
      expect(failed.length, failed.join('\n')).toBeLessThanOrEqual(MISSIONS[kind].boss ? 1 : 0);
      for (const r of results) if (r.completed) expect(['S', 'A', 'B', 'C']).toContain(r.debrief?.rank);
    }, 60000);
  }

  for (const kind of ['survival', 'extraction', 'nebula', 'pursuit', 'boss_neutron'] as MissionKind[]) {
    it(`${MISSIONS[kind].title} (tier 2)`, () => {
      const results = SEEDS.map((seed) => flyMission(missionLevel(kind, 2, seed)));
      expect(results.filter((r) => r.completed).length, results.map((r) => `${r.code}: ${r.died || r.failure}`).join(', ')).toBeGreaterThanOrEqual(3);
    }, 60000);
  }
});

describe('asteroid run with rock collisions on', () => {
  it('the belts can be crossed through their gaps, one lane at a time', () => {
    const results = [11, 22, 33, 44, 55].map((seed) => {
      const level = missionLevel('asteroid_run', 1, seed);
      let debrief: MissionDebrief | null = null;
      const run = new Run({ demo: false, sink: { ...quiet, missionComplete: (d) => (debrief = d) }, seed: level.seed, level });
      const st: PilotState = { released: false, burning: false, done: false, plan: null };
      let c = NO_CONTROLS;
      for (let i = 0; i < 100 / CONFIG.STEP; i++) {
        // Only the belts: the environment's stray rocks are switched off for this check.
        run.setSpawn(new Set(), 0);
        if (i % 12 === 0 && run.phase === 'active') c = stagedRunPilot(run, st);
        run.step(CONFIG.STEP, c);
        if (run.phase !== 'active' && run.phase !== 'intro') break;
      }
      return debrief as MissionDebrief | null;
    });
    const done = results.filter((d) => d?.success);
    expect(done.length).toBeGreaterThanOrEqual(4);
    // Threading the gaps, not ramming through: little hull is lost on average.
    expect(done.reduce((s, d) => s + (d?.damage ?? 0), 0) / done.length).toBeLessThan(40);
  }, 120000);
});

describe('mission mechanics', () => {
  it('survival runs in waves with quiet lulls between them', () => {
    const level = missionLevel('survival', 2, 11);
    const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
    runFor(run, CONFIG.INTRO_TIME + 1);
    const first = new Set(run.spawnMods);
    expect(run.spawnRate).toBeGreaterThan(0);
    runFor(run, level.mission.waves[0].duration);
    expect(run.spawnRate).toBe(0);
    runFor(run, 4);
    expect(run.spawnRate).toBeGreaterThan(level.mission.waves[0].rate);
    expect(run.spawnMods.size).toBeGreaterThanOrEqual(first.size);
  });

  it('gates count only when threaded, in order', () => {
    const r = flyMission(missionLevel('precision', 1, 22));
    expect(r.completed).toBe(true);
    expect(r.messages.some((m) => m.includes('ALL GATES CLEARED'))).toBe(true);
  });

  it('fuel runs dry under thrust and trickles back while coasting', () => {
    const level = missionLevel('slingshot', 1, 11);
    const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
    const full = run.mission.fuel;
    expect(full).toBeGreaterThan(0);
    // Strafe the tank dry (sideways thrust barely reshapes the orbit, so the ship stays safe).
    runFor(run, full * 2 + 1, { accel: false, brake: false, lateral: 1, boost: false });
    expect(run.mission.fuel).toBe(0);
    run.step(CONFIG.STEP, { accel: true, brake: false, lateral: 0, boost: false });
    expect(run.ship.thrust).toBe(0);
    runFor(run, 6);
    expect(run.phase).toBe('active');
    expect(run.mission.fuel).toBeGreaterThan(0);
  });

  it('ion surges invert the controls', () => {
    const level = missionLevel('nebula', 1, 11);
    const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
    let seen = false;
    for (let i = 0; i < 30 / CONFIG.STEP && !seen; i++) {
      run.step(CONFIG.STEP, NO_CONTROLS);
      if (run.mission.invertT > 0.2) {
        run.step(CONFIG.STEP, { accel: true, brake: false, lateral: 0, boost: false });
        expect(run.ship.thrust).toBe(-1);
        seen = true;
      }
    }
    expect(seen).toBe(true);
  });

  it('wormholes preserve the shape of an orbit', () => {
    const mu = 1.2e6;
    const rA = 90;
    const rB = 230;
    const v = Math.sqrt(mu / rA);
    // Circular orbit at A (on the x axis), exiting at B at 2 rad.
    const out = wormholeVelocity(rA, 0, Math.cos(2) * rB, Math.sin(2) * rB, 0, v);
    const info = orbitInfo(Math.cos(2) * rB, Math.sin(2) * rB, out.x, out.y, mu);
    expect(info.ecc).toBeLessThan(0.01);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(Math.sqrt(mu / rB), 3);
  });

  it('magnetic fields turn the ship without changing its speed, and the preview shows it', () => {
    const level = missionLevel('precision', 2, 7);
    const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
    const f = run.mission.fields[0];
    expect(f).toBeDefined();
    const out = { x: 0, y: 0 };
    run.mission.fieldAccel(f.x, f.y, 30, 40, out);
    expect(Math.abs(out.x * 30 + out.y * 40)).toBeLessThan(1e-9);
    expect(Math.hypot(out.x, out.y)).toBeGreaterThan(0);
  });

  it('the trajectory preview stops at a moving planet', () => {
    const level = missionLevel('slingshot', 1, 11);
    const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
    const p = run.attractors[1];
    const buf = new Float32Array(800);
    // Aim straight at the planet from 60 units away.
    const res = predictTrajectory(p.x - 60, p.y, 120, 0, run.attractors.map((a) => ({ ...a })), null, 0, 3, 1 / 40, buf, 1, run.companionRadii);
    expect(res.crashed).toBe(true);
  });

  it('a close pass behind a moving planet is a real gravity assist', () => {
    const results = SEEDS.map((seed) => flyMission(missionLevel('slingshot', 1, seed)));
    expect(results.some((r) => r.messages.some((m) => m.startsWith('GRAVITY ASSIST')))).toBe(true);
  });

  it('the black hole of an escape mission keeps growing', () => {
    const level = missionLevel('event_horizon', 1, 11);
    const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
    runFor(run, CONFIG.INTRO_TIME + 0.1);
    const mu0 = run.attractors[0].mu;
    runFor(run, 10);
    expect(run.attractors[0].mu).toBeGreaterThan(mu0 * 1.05);
    expect(run.heatRadiusNow).toBeGreaterThan(level.body.heatRadius);
  });

  it('proximity mines arm, chase and detonate', () => {
    const level = missionLevel('asteroid_run', 2, 11);
    const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
    runFor(run, CONFIG.INTRO_TIME + 0.1);
    const mine = run.mission.mines[0];
    // Park the ship right next to a mine.
    run.ship.x = mine.x + 30;
    run.ship.y = mine.y;
    run.ship.vx = mine.vx;
    run.ship.vy = mine.vy;
    run.refreshGravity();
    const hull = run.ship.hull;
    runFor(run, 4);
    expect(mine.state).toBe('dead');
    expect(run.ship.hull).toBeLessThan(hull);
  });

  it('the hunter flies orbits rather than diving into the planet', () => {
    let checked = 0;
    for (let seed = 1; seed < 60 && checked < 3; seed++) {
      const level = missionLevel('pursuit', 1, seed);
      if (level.companions.length > 0) continue;
      checked++;
      const run = new Run({ demo: false, sink: quiet, seed: level.seed, level, noSpawns: true });
      let closest = Infinity;
      for (let i = 0; i < 25 / CONFIG.STEP; i++) {
        run.step(CONFIG.STEP, NO_CONTROLS);
        const e = run.mission.enemies[0];
        if (e) closest = Math.min(closest, Math.hypot(e.x - run.ship.x, e.y - run.ship.y));
        if (run.phase !== 'intro' && run.phase !== 'active') break;
      }
      // It closes in on a passive ship...
      expect(closest, level.code).toBeLessThan(60);
      // ...and is still flying unless the player lured it into something.
      expect(run.mission.enemies.length + (run.debriefs.length > 0 ? 1 : 0), level.code).toBeGreaterThan(0);
    }
    expect(checked).toBe(3);
  });

  it('a closed jump window forces a jump that costs hull and ranks nothing', () => {
    const level = missionLevel('asteroid_run', 1, 11);
    let debrief: MissionDebrief | null = null;
    const run = new Run({ demo: false, sink: { ...quiet, missionComplete: (d) => (debrief = d) }, seed: level.seed, level, noSpawns: true });
    const hull = run.ship.hull;
    runFor(run, level.mission.window + CONFIG.INTRO_TIME + 1, { accel: false, brake: false, lateral: 0, boost: false });
    const d = debrief as MissionDebrief | null;
    expect(d?.success).toBe(false);
    expect(d?.failure).toBe('JUMP WINDOW CLOSED');
    expect(d?.rank).toBe('-');
    expect(run.ship.hull).toBeLessThanOrEqual(hull * 0.76);
  });

  it('bosses take three phases to bring down', () => {
    for (const kind of ['boss_neutron', 'boss_devourer', 'boss_sentinel'] as MissionKind[]) {
      const r = flyMission(missionLevel(kind, 1, 22));
      expect(r.completed, kind).toBe(true);
      expect(r.debrief?.boss).toBe(true);
    }
  });
});

describe('scoring and replayability', () => {
  it('ranks flawless flying above sloppy flying', () => {
    expect(betterRank('A', 'S')).toBe('S');
    expect(betterRank('B', '-')).toBe('B');
    const clean = flyMission(missionLevel('extraction', 1, 22));
    expect(['S', 'A']).toContain(clean.debrief?.rank);
  });

  it('pays for harder modifiers and charges for the assist', () => {
    expect(scoreMultiplier([])).toBe(1);
    expect(scoreMultiplier(['glass', 'blind'])).toBeGreaterThan(2);
    expect(scoreMultiplier(['calm'])).toBeLessThan(1);
  });

  it('applies run modifiers to the ship', () => {
    const save = defaultSave();
    const glass = new Run({ demo: false, sink: quiet, seed: 5, save, modifiers: ['glass'], noSpawns: true });
    const plain = new Run({ demo: false, sink: quiet, seed: 5, save, noSpawns: true });
    expect(glass.ship.hullMax).toBe(plain.ship.hullMax / 2);
    const dry = new Run({ demo: false, sink: quiet, seed: 5, save, modifiers: ['dry'], noSpawns: true });
    expect(dry.mission.fuelMax).toBeGreaterThan(0);
    const blind = new Run({ demo: false, sink: quiet, seed: 5, save, modifiers: ['blind'], noSpawns: true });
    blind.updatePrediction();
    expect(blind.trajCount).toBe(0);
  });

  it('collects shards into the run report', () => {
    const r = flyMission(missionLevel('nebula', 1, 22));
    expect(r.debrief?.shardsTotal).toBe(3);
  });
});
