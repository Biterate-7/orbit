import { describe, expect, it } from 'vitest';
import { getCatalogue } from '../src/astronomy/database/catalogue';
import type { LevelDef } from '../src/game/types';
import { difficultyProfile, intensityFor } from '../src/generation/difficulty';
import { EMPTY_PROGRESS, recordEncounter, scoreEncounter, selectEncounter } from '../src/generation/encounterSelector';
import type { RunHistory } from '../src/generation/encounterSelector';
import { ENVIRONMENTS, EXTREME_GRAVITY, environment, hostPools, primaryEnvironment } from '../src/generation/environments';
import { buildLevel, generateLevelFromSeed, levelSignature, rollEncounter } from '../src/generation/levelGenerator';
import { candidateSeed, hash32, levelCode, parseLevelCode, rendezvousPick } from '../src/generation/seed';

const cat = getCatalogue();

/** 1,200 seeded levels spread over sectors 1-80. */
const LEVELS: LevelDef[] = [];
for (let k = 0; k < 1200; k++) {
  const index = 1 + (k % 80);
  LEVELS.push(generateLevelFromSeed(candidateSeed(0x5eed, index, k), index));
}

describe('seeding', () => {
  it('rebuilds a level exactly from its seed', () => {
    for (const [seed, index] of [
      [1, 1],
      [42, 7],
      [987654321, 23],
      [0xdeadbeef, 64],
    ]) {
      expect(generateLevelFromSeed(seed, index)).toEqual(generateLevelFromSeed(seed, index));
    }
  });

  it('round-trips level codes', () => {
    for (const l of LEVELS.slice(0, 50)) {
      const parsed = parseLevelCode(l.code)!;
      expect(parsed).toEqual({ catalogueVersion: cat.version, index: l.index, seed: l.seed });
      expect(generateLevelFromSeed(parsed.seed, parsed.index)).toEqual(l);
    }
    expect(levelCode(1, 7, 255)).toBe('C1-007-000000FF');
    expect(parseLevelCode('nonsense')).toBeNull();
  });

  it('gives different seeds different levels', () => {
    const a = generateLevelFromSeed(100, 20);
    const b = generateLevelFromSeed(101, 20);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('keeps old picks stable when the catalogue grows', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `obj-${i}` }));
    const grown = [...items, ...Array.from({ length: 20 }, (_, i) => ({ id: `new-${i}` }))];
    let moved = 0;
    for (let seed = 0; seed < 300; seed++) {
      if (rendezvousPick(seed, items, (o) => o.id)?.id !== rendezvousPick(seed, grown, (o) => o.id)?.id) moved++;
    }
    // Adding 10% more objects should disturb roughly 10% of picks, not reshuffle everything.
    expect(moved).toBeLessThan(60);
  });
});

describe('1,200 seeded levels', () => {
  it('are almost all distinct', () => {
    const signatures = new Set(LEVELS.map(levelSignature));
    expect(signatures.size / LEVELS.length).toBeGreaterThan(0.93);
    expect(new Set(LEVELS.map((l) => l.name)).size).toBeGreaterThan(500);
    // No two levels are literally identical.
    expect(new Set(LEVELS.map((l) => JSON.stringify({ ...l, code: '', seed: 0 }))).size).toBe(LEVELS.length);
  });

  it('cover every environment', () => {
    const seen = new Set(LEVELS.map((l) => l.identity.environment));
    for (const env of ENVIRONMENTS) expect(seen.has(env.id), env.id).toBe(true);
  });

  it('are structurally sound and winnable on paper', () => {
    for (const l of LEVELS) {
      const tag = `${l.code} ${l.identity.environment}`;
      const flat = JSON.stringify(l);
      expect(flat.includes('null,null,null,null'), tag).toBe(false);
      expect(l.name.length, tag).toBeGreaterThan(2);
      expect(l.name.length, tag).toBeLessThanOrEqual(40);
      // The start lane sits inside the band with room on both sides.
      expect(l.startRadius, tag).toBeGreaterThanOrEqual(l.safeMin + 12);
      expect(l.startRadius, tag).toBeLessThanOrEqual(l.safeMax - 12);
      expect(l.safeMax - l.safeMin, tag).toBeGreaterThanOrEqual(70);
      // Heat never reaches the start lane, even at the peak of a pulsation or at periapsis.
      const pulse = l.mechanics.pulsation?.amp ?? 0;
      const season = l.mechanics.season ? 1.18 : 1;
      expect(l.body.heatRadius * (1 + pulse) * season, tag).toBeLessThan(l.startRadius - 8);
      if (l.mechanics.scorch) expect(l.mechanics.scorch.reach, tag).toBeLessThan(l.startRadius - 8);
      for (const z of l.mechanics.dragZones) expect(l.startRadius < z.rMin - 4 || l.startRadius > z.rMax + 4, tag).toBe(true);
      // No circular, in-plane belt runs through the start lane.
      for (const b of l.mechanics.belts) {
        if (b.inclination === 0 && b.ecc < 0.05) expect(Math.abs(b.radius - l.startRadius), tag).toBeGreaterThanOrEqual(b.spread + 11);
      }
      // No companion's path comes close to the start lane.
      for (const c of l.companions) {
        const peri = c.orbitRadius * (1 - c.ecc);
        const apo = c.orbitRadius * (1 + c.ecc);
        const gap = l.startRadius < peri ? peri - l.startRadius : l.startRadius > apo ? l.startRadius - apo : 0;
        expect(gap, tag).toBeGreaterThanOrEqual(c.radius + Math.max(14, c.heatRadius - c.radius));
      }
      // Hazard pacing stays readable at any depth.
      expect(l.asteroidInterval[1], tag).toBeGreaterThanOrEqual(0.45);
      expect(l.asteroidSpeed[1], tag).toBeLessThan(140);
      expect(l.thrustScale, tag).toBeGreaterThan(0.5);
      expect(l.thrustScale, tag).toBeLessThan(1.6);
      for (const v of [l.body.mu, l.orbitMu, l.duration, l.difficulty, l.stabilityDrain, l.energyRichness]) expect(Number.isFinite(v) && v > 0, tag).toBe(true);
    }
  });

  it('label real, procedural and fictional settings honestly', () => {
    for (const l of LEVELS) {
      const id = l.identity;
      const env = environment(id.environment as Parameters<typeof environment>[0]);
      if (id.kind === 'REAL OBJECT') {
        const o = cat.get(id.objectId);
        expect(o, l.code).toBeDefined();
        expect(id.source, l.code).toBeTruthy();
        // A real object only ever hosts the environment its data maps to.
        expect(primaryEnvironment(o!), l.code).toBe(id.environment);
      } else {
        expect(cat.get(id.objectId), l.code).toBeUndefined();
        expect(id.source, l.code).toBeNull();
        // Generated designations carry the survey prefix and never borrow a real catalogue's format.
        expect(id.objectName.startsWith('OLS '), l.code).toBe(true);
      }
      expect(id.kind === 'FICTIONAL OBJECT', l.code).toBe(env.fictional === true);
    }
    const kinds = new Set(LEVELS.map((l) => l.identity.kind));
    expect(kinds.has('REAL OBJECT') && kinds.has('PROCEDURAL VARIANT') && kinds.has('FICTIONAL OBJECT')).toBe(true);
    expect(LEVELS.filter((l) => l.identity.kind === 'REAL OBJECT').length / LEVELS.length).toBeGreaterThan(0.6);
  });

  it('name levels after their own data', () => {
    for (const l of LEVELS) {
      if (l.name.startsWith('REDSHIFT ')) expect(cat.get(l.identity.objectId)?.context.redshift, l.code).not.toBeNull();
      if (l.name === 'THE LAST PERIHELION') expect(cat.get(l.identity.objectId)?.orbitalProperties.eccentricity ?? 0, l.code).toBeGreaterThanOrEqual(0.85);
      if (l.name.startsWith('PULSAR ')) expect(l.identity.environment, l.code).toBe('pulsar');
    }
  });
});

describe('environment identity', () => {
  it('gives each environment its own mechanical signature', () => {
    // Native mechanics only: sector 3 has no layered extras.
    const signatures = new Map<string, string>();
    for (const env of ENVIRONMENTS) {
      let level: LevelDef | null = null;
      for (let seed = 1; seed < 400 && !level; seed++) {
        const enc = { ...rollEncounter(seed, 3), env: env.id, object: null, identity: 'PROCEDURAL VARIANT' as const, rarity: env.rarity };
        level = buildLevel(enc);
      }
      const keys = level!.mechanicKeys.filter((k) => k !== 'season' && k !== 'inclined');
      const shape = [level!.body.kind, level!.body.look.surface, keys.sort().join('+'), level!.companions.length, level!.mechanics.belts.length].join('|');
      expect(keys.length + level!.companions.length, env.id).toBeGreaterThan(0);
      signatures.set(env.id, shape);
    }
    const distinct = new Set(signatures.values());
    // Every environment plays differently from every other one.
    expect(distinct.size, [...signatures].map(([k, v]) => `${k}: ${v}`).join('\n')).toBe(ENVIRONMENTS.length);
  });

  it('has real hosts for every environment the data can vouch for', () => {
    const pools = hostPools(cat);
    // The catalogue records binarity but not how many stars a system has, so no object can be
    // verified as a triple: that environment is always a procedural variant, and says so.
    const unverifiable = new Set(['multiple_star']);
    for (const env of ENVIRONMENTS) {
      if (env.fictional || unverifiable.has(env.id)) expect(pools.get(env.id), env.id).toHaveLength(0);
      else expect(pools.get(env.id)!.length, env.id).toBeGreaterThan(0);
    }
  });

  it('classifies well-known objects sensibly', () => {
    const envOf = (name: string, category: string): string | null => {
      const o = cat.objects.find((x) => x.name === name && x.category === category);
      return o ? primaryEnvironment(o) : 'missing';
    };
    expect(envOf('Io', 'moon')).toBe('lava');
    expect(envOf('Europa', 'moon')).toBe('ice');
    expect(envOf('Saturn', 'planet')).toBe('ringed');
    expect(envOf('Jupiter', 'planet')).toBe('gas_giant');
    expect(envOf('Earth', 'planet')).toBe('ocean');
    expect(envOf('Sun', 'star')).toBe('sunlike');
    expect(envOf('Betelgeuse', 'star')).toBe('red_giant');
    expect(envOf('Halley', 'comet')).toBe('comet_region');
    expect(envOf('Vesta', 'asteroid')).toBe('asteroid_field');
  });
});

describe('difficulty', () => {
  it('rises, then saturates, and never becomes unbounded', () => {
    expect(intensityFor(1)).toBe(1);
    const avg = (a: number, b: number): number => {
      let s = 0;
      for (let i = a; i <= b; i++) s += intensityFor(i);
      return s / (b - a + 1);
    };
    expect(avg(6, 12)).toBeGreaterThan(avg(1, 5));
    expect(avg(20, 30)).toBeGreaterThan(avg(6, 12));
    expect(avg(100, 120)).toBeGreaterThan(avg(20, 30));
    for (let i = 1; i <= 2000; i += 7) expect(intensityFor(i)).toBeLessThan(2.7);
  });

  it('adds complexity in steps', () => {
    expect(difficultyProfile(1).extras).toBe(0);
    expect(difficultyProfile(6).extras).toBe(1);
    expect(difficultyProfile(12).extras).toBe(2);
    expect(difficultyProfile(30).extras).toBe(3);
    expect(difficultyProfile(500).drainScale).toBeLessThanOrEqual(1.35);
  });

  it('layers more systems onto later sectors', () => {
    const mean = (ls: LevelDef[]): number => ls.reduce((s, l) => s + l.mechanicKeys.length, 0) / ls.length;
    const early = LEVELS.filter((l) => l.index <= 3);
    const late = LEVELS.filter((l) => l.index >= 40);
    expect(mean(late)).toBeGreaterThan(mean(early) + 1.5);
  });
});

describe('journeys', () => {
  const journey = (runSeed: number, sectors: number) => {
    let history: RunHistory = { environments: [], objects: [], sinceRare: 0 };
    const levels: LevelDef[] = [];
    for (let i = 1; i <= sectors; i++) {
      const { encounter } = selectEncounter(runSeed, i, history, EMPTY_PROGRESS, cat);
      const level = buildLevel(encounter);
      history = recordEncounter(history, encounter, level.identity.objectId);
      levels.push(level);
    }
    return levels;
  };
  const runs = Array.from({ length: 12 }, (_, r) => journey(hash32(r, 4242), 60));

  it('are reproducible from the run seed', () => {
    expect(journey(77, 15).map((l) => l.code)).toEqual(journey(77, 15).map((l) => l.code));
    expect(journey(77, 15).map((l) => l.code)).not.toEqual(journey(78, 15).map((l) => l.code));
  });

  it('never repeat an environment back to back or an object within a run', () => {
    for (const levels of runs) {
      for (let i = 1; i < levels.length; i++) expect(levels[i].identity.environment).not.toBe(levels[i - 1].identity.environment);
      const real = levels.filter((l) => l.identity.kind === 'REAL OBJECT').map((l) => l.identity.objectId);
      expect(new Set(real).size).toBe(real.length);
    }
  });

  it('travel outward: Solar System first, then stars, then the extreme', () => {
    for (const levels of runs) {
      expect(levels[0].identity.environment).toBe('rocky');
      const firstStar = levels.findIndex((l) => l.identity.family === 'stellar') + 1;
      const firstExtreme = levels.findIndex((l) => EXTREME_GRAVITY.has(l.identity.environment as never)) + 1;
      expect(firstStar).toBeGreaterThanOrEqual(3);
      expect(firstStar).toBeLessThanOrEqual(6);
      expect(firstExtreme).toBeGreaterThanOrEqual(9);
      expect(firstExtreme).toBeLessThanOrEqual(14);
      // Nothing from beyond the galaxy in the opening stretch.
      for (const l of levels.slice(0, 8)) expect(environment(l.identity.environment as never).depth).toBeLessThan(2.5);
    }
  });

  it('pace rare encounters instead of leaving them to chance', () => {
    for (const levels of runs) {
      const rare = levels.map((l, i) => (l.identity.rarity === 'rare' || l.identity.rarity === 'legendary' ? i + 1 : 0)).filter(Boolean);
      expect(rare.length).toBeGreaterThanOrEqual(4);
      expect(rare[0]).toBeLessThanOrEqual(22);
      for (let i = 1; i < rare.length; i++) {
        // Never two in quick succession - unless the second lands on a milestone sector, or is the
        // scripted "first extreme gravity" beat that every run gets by sector 14.
        if (rare[i] % 10 !== 0 && rare[i] > 14) expect(rare[i] - rare[i - 1]).toBeGreaterThanOrEqual(4);
        // And never an endless drought.
        expect(rare[i] - rare[i - 1]).toBeLessThanOrEqual(22);
      }
    }
  });

  it('keep finding new places for a long time', () => {
    const long = journey(2026, 200);
    expect(new Set(long.map((l) => l.identity.environment)).size).toBeGreaterThanOrEqual(26);
    expect(new Set(long.map(levelSignature)).size).toBe(200);
    // The second hundred sectors are not a replay of the first.
    const firstHalf = new Set(long.slice(0, 100).map((l) => l.identity.objectId));
    expect(long.slice(100).filter((l) => firstHalf.has(l.identity.objectId))).toHaveLength(0);
  });

  it('steer toward what the player has not seen', () => {
    const enc = rollEncounter(candidateSeed(9, 20, 0), 20);
    const fresh = scoreEncounter(enc, { environments: ['rocky'], objects: [], sinceRare: 3 }, EMPTY_PROGRESS);
    const known = scoreEncounter(
      enc,
      { environments: ['rocky'], objects: [], sinceRare: 3 },
      { discovered: new Set(enc.object ? [enc.object.id] : []), environmentsSeen: new Set([enc.env]) },
    );
    expect(fresh).toBeGreaterThan(known);
    // Immediate repeats are ruled out.
    expect(scoreEncounter(enc, { environments: [enc.env], objects: [], sinceRare: 3 }, EMPTY_PROGRESS)).toBeLessThan(-50);
  });
});
