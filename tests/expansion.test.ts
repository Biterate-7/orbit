/**
 * Lost Orbit 2.0: saves and migration, the progression economy, cases, cosmetics, modules and the
 * star-system data pipeline.
 */
import { describe, expect, it } from 'vitest';
import proxy, { fetchUpstream } from '../api/astro.js';
import { getCatalogue } from '../src/astronomy/database/catalogue';
import { packSystems, unpackSystems } from '../src/astronomy/systems/codec';
import { AstroService, LIVE_CACHE_KEY, MAX_LIVE_SYSTEMS, readCache } from '../src/astronomy/systems/live';
import type { KeyValueStore } from '../src/astronomy/systems/live';
import { mergeSystems, normalizeExoplanetRows, normalizeSbdb, parseHorizonsPhysical, validateSystem } from '../src/astronomy/systems/normalize';
import type { PscompparsRow } from '../src/astronomy/systems/normalize';
import { sanitizeTerm } from '../src/astronomy/systems/sources';
import type { FetchText } from '../src/astronomy/systems/sources';
import { SOLAR_SYSTEM_ID, SystemCatalogue, getSystems, isSimbadBinary, solarSystemFrom } from '../src/astronomy/systems/store';
import type { StarSystem } from '../src/astronomy/systems/types';
import { CONFIG } from '../src/game/config';
import { CASES, DUPLICATE_VALUE, casePool, effectiveOdds, rollCase } from '../src/game/cosmetics/cases';
import { COSMETICS, DEFAULT_LOADOUT, RARITY_RANK, SLOTS, STARTER_IDS, resolveLook } from '../src/game/cosmetics/catalog';
import { MISSIONS } from '../src/game/missions/catalog';
import type { MissionDebrief } from '../src/game/missions/types';
import { MODULES, MODULE_COSTS, MODULE_IDS, SYNERGIES, computeModuleMods } from '../src/game/modules';
import { CORRUPT_KEY, LEGACY_KEY, SAVE_KEY, SaveStore, defaultSave, sanitizeSave } from '../src/game/persistence';
import type { SaveData } from '../src/game/persistence';
import { Rng } from '../src/game/rng';
import { Run } from '../src/game/run';
import type { RunSink } from '../src/game/run';
import type { LevelIdentity } from '../src/game/types';
import { generateLevelFromSeed, levelForSystem } from '../src/generation/levelGenerator';
import { sampleWorlds } from '../src/generation/environments/systems';
import { ACHIEVEMENTS, ACHIEVEMENT_IDS, pendingAchievements } from '../src/progression/achievements';
import { applyEvent, spend } from '../src/progression/events';
import type { GameEvent } from '../src/progression/events';
import { levelFor, xpForLevel } from '../src/progression/level';
import { MILESTONES } from '../src/progression/milestones';
import { deriveStats, sanitizeStats } from '../src/progression/stats';

const NOW = '2026-11-17T12:00:00.000Z';
const quiet: RunSink = { sfx: () => undefined, message: () => undefined, levelIntro: () => undefined, upgradeReady: () => undefined, died: () => undefined };

class MemStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

/** Apply an event to a copy of the save, like SaveStore.update does. */
function apply(save: SaveData, e: GameEvent): { save: SaveData; out: ReturnType<typeof applyEvent> } {
  const d: SaveData = JSON.parse(JSON.stringify(save));
  const out = applyEvent(d, e, NOW);
  return { save: d, out };
}

function debrief(over: Partial<MissionDebrief> = {}): MissionDebrief {
  return {
    index: 3,
    kind: 'precision',
    title: 'PLANETARY NAVIGATION',
    boss: false,
    success: true,
    failure: '',
    rank: 'A',
    time: 40,
    par: 50,
    damage: 10,
    bonuses: [{ label: 'X', done: true }],
    shards: 1,
    shardsTotal: 3,
    score: 500,
    key: 1,
    tier: 1,
    reward: 1,
    credits: 20,
    variant: 'standard',
    mutators: [],
    tally: { mined: 0, surveyed: [], signals: 0, caches: 0, transits: 0, assists: 0 },
    ...over,
  };
}

const identity = (over: Partial<LevelIdentity> = {}): LevelIdentity => ({
  kind: 'REAL OBJECT',
  objectId: 'horizons:599',
  objectName: 'Jupiter',
  objectClass: 'Gas giant',
  source: 'NASA/JPL Horizons',
  environment: 'gas_giant',
  environmentLabel: 'GAS GIANT',
  family: 'planetary',
  orbit: 'circular',
  orbitLabel: 'CIRCULAR ORBIT',
  rarity: 'common',
  description: '',
  ...over,
});

/** A save in the original (version 1) format, as a 1.x player would have it. */
const V1_SAVE = {
  version: 1,
  records: { highestLevel: 17, bestTime: 812.5, bestScore: 48210, totalRuns: 23, lifetimeEnergy: 640, lifetimeTime: 6300, asteroidsAvoided: 400, asteroidsDestroyed: 120, shards: 19, missionsCompleted: 31 },
  credits: 437,
  permanent: { thrusters: 3, hull: 2, collector: 1, shields: 0, reactor: 0, tanks: 1, tractor: 0, heatshield: 0, gyro: 1, phase: 0 },
  unlocked: ['stabilizer', 'hull', 'magnet', 'thrusters', 'shield', 'repair', 'overdrive', 'scanner', 'temporal'],
  settings: { masterVolume: 0.4, muted: true, sfx: true, ambience: false, screenShake: false, reducedEffects: true, sensitivity: 1.2, autoPause: false, touchControls: 'on' },
  journey: {
    objects: { 'horizons:599': { sector: 2, at: '2026-11-01T00:00:00Z', visits: 3, env: 'gas_giant', orbit: 'CIRCULAR ORBIT' }, 'horizons:10': { sector: 5, at: '2026-11-02T00:00:00Z', visits: 1, env: 'sunlike', orbit: 'CIRCULAR ORBIT' } },
    environments: ['rocky', 'gas_giant', 'sunlike', 'neutron_star'],
    proceduralVisits: 4,
    fictionalVisits: 0,
    rareEncounters: 1,
    sectorsCleared: 64,
  },
  milestones: ['sector-10', 'sectors-50', 'first-star', 'first-extreme', 'first-rare'],
  missions: { survival: { completed: 9, best: 'S' }, precision: { completed: 7, best: 'A' }, boss_neutron: { completed: 2, best: 'B' } },
  bosses: ['boss_neutron'],
  runModifiers: ['glass'],
};

// ------------------------------------------------------------------ saves

describe('save migration and integrity', () => {
  it('migrates a version-1 save without losing anything it recorded', () => {
    const s = sanitizeSave(JSON.parse(JSON.stringify(V1_SAVE)), NOW);
    expect(s.version).toBe(2);
    expect(s.credits).toBe(437);
    expect(s.records).toEqual(V1_SAVE.records);
    expect(s.permanent).toEqual(V1_SAVE.permanent);
    expect(s.unlocked).toEqual(V1_SAVE.unlocked);
    expect(s.settings).toEqual(V1_SAVE.settings);
    expect(s.missions).toEqual(V1_SAVE.missions);
    expect(s.bosses).toEqual(['boss_neutron']);
    expect(s.runModifiers).toEqual(['glass']);
    expect(Object.keys(s.journey.objects).sort()).toEqual(['horizons:10', 'horizons:599']);
    expect(s.journey.sectorsCleared).toBe(64);
    // Milestones become achievements under their original ids.
    for (const id of V1_SAVE.milestones) expect(s.achievements[id]).toBeDefined();
    // Statistics are seeded from what the old save knew.
    expect(s.stats.missionsCompleted).toBe(31);
    expect(s.stats.bossesDefeated).toBe(1);
    expect(s.stats.bossRecords.boss_neutron?.defeats).toBe(1);
    expect(s.stats.creditsSpent).toBe(25 + 55 + 95 + 25 + 55 + 25 + 25 + 25);
    expect(s.stats.creditsEarned).toBe(s.credits + s.stats.creditsSpent);
    expect(s.profile.xp).toBeGreaterThan(0);
    // Starter cosmetics are issued.
    for (const id of STARTER_IDS) expect(s.inventory.owned[id]).toBeDefined();
    expect(s.inventory.equipped).toEqual(DEFAULT_LOADOUT);
  });

  it('never pays a migrated milestone twice, and pays what the old save earned but never claimed once', () => {
    const migrated = sanitizeSave(JSON.parse(JSON.stringify(V1_SAVE)), NOW);
    const { save: after, out } = apply(migrated, { type: 'settle' });
    const repaid = out.achievements.filter((a) => V1_SAVE.milestones.includes(a.id));
    expect(repaid).toEqual([]);
    // Something the old data already satisfies (e.g. BOSS HUNTER is not met, but CORE BREAKER is).
    expect(out.achievements.map((a) => a.id)).toContain('boss-neutron');
    const { out: again } = apply(after, { type: 'settle' });
    expect(again.achievements).toEqual([]);
    expect(again.credits).toBe(0);
  });

  it('loads the old key, writes the new one, and keeps the old save untouched', () => {
    const mem = new MemStore();
    mem.setItem(LEGACY_KEY, JSON.stringify(V1_SAVE));
    const store = new SaveStore(mem);
    expect(store.migrated).toBe(true);
    expect(store.get().credits).toBe(437);
    expect(mem.getItem(LEGACY_KEY)).toBe(JSON.stringify(V1_SAVE));
    const written = JSON.parse(mem.getItem(SAVE_KEY) as string);
    expect(written.version).toBe(2);
    // The next session reads the new save and does not migrate again.
    const store2 = new SaveStore(mem);
    expect(store2.migrated).toBe(false);
    expect(store2.get()).toEqual(store.get());
  });

  it('keeps a damaged save aside instead of wiping it, and falls back to the older save', () => {
    const mem = new MemStore();
    mem.setItem(SAVE_KEY, '{"version":2, "credits": 9');
    mem.setItem(LEGACY_KEY, JSON.stringify(V1_SAVE));
    const store = new SaveStore(mem);
    expect(mem.getItem(CORRUPT_KEY)).toBe('{"version":2, "credits": 9');
    expect(store.get().credits).toBe(437);
  });

  it('validates every field: bad values fall back, unknown ids are dropped, credits never go negative', () => {
    const raw = {
      ...defaultSave(),
      credits: -50,
      profile: { name: 'X'.repeat(40), createdAt: 'not a date', xp: 'lots' },
      inventory: { owned: { 'hull.holo': { at: NOW, source: 'case:singularity', fresh: true }, 'hull.made-up': { at: NOW, source: 'x', fresh: true } }, equipped: { ...DEFAULT_LOADOUT, hull: 'hull.holo', engine: 'engine.nova', trail: 'hull.holo' } },
      modules: { levels: { anchor: 9, phase: 2, bogus: 3 }, equipped: ['anchor', 'phase', 'dualcore', 'anchor'], synergies: ['harmonics', 'nope'] },
      achievements: { 'first-contact': NOW, 'not-an-achievement': NOW },
      stats: { missionsCompleted: NaN, creditsEarned: 120, missionPlays: { survival: 3, nothing: 4 } },
    };
    const s = sanitizeSave(raw, NOW);
    expect(s.credits).toBe(0);
    expect(s.profile.name.length).toBeLessThanOrEqual(16);
    expect(s.profile.xp).toBe(0);
    expect(s.inventory.owned['hull.made-up']).toBeUndefined();
    expect(s.inventory.owned['hull.holo']).toBeDefined();
    expect(s.inventory.equipped.hull).toBe('hull.holo');
    // Not owned, or the wrong slot: the stock part stays fitted.
    expect(s.inventory.equipped.engine).toBe(DEFAULT_LOADOUT.engine);
    expect(s.inventory.equipped.trail).toBe(DEFAULT_LOADOUT.trail);
    expect(s.modules.levels.anchor).toBe(3);
    // Only owned modules can be fitted, each once.
    expect(s.modules.equipped).toEqual(['anchor', 'phase']);
    expect(s.modules.synergies).toEqual(['harmonics']);
    expect(Object.keys(s.achievements)).toEqual(['first-contact']);
    expect(s.stats.missionsCompleted).toBe(0);
    expect(s.stats.missionPlays).toEqual({ survival: 3 });
    expect(sanitizeSave(null, NOW)).toEqual(defaultSave(NOW));
    expect(sanitizeStats('garbage')).toEqual(sanitizeStats({}));
  });

  it('round-trips a current save exactly', () => {
    let s = sanitizeSave(V1_SAVE, NOW);
    s = apply(s, { type: 'sector_enter', index: 1, identity: identity(), kind: 'survival', practice: false, modules: [], hull: 'hull.standard' }).save;
    s = apply(s, { type: 'sector_end', debrief: debrief(), practice: false, distance: 1234, binary: false }).save;
    expect(sanitizeSave(JSON.parse(JSON.stringify(s)), NOW)).toEqual(s);
  });
});

// ------------------------------------------------------------------ progression and economy

describe('progression economy', () => {
  it('counts statistics from events, once each', () => {
    let s = defaultSave(NOW);
    s = apply(s, { type: 'sector_enter', index: 1, identity: identity(), kind: 'mining', practice: false, modules: ['anchor'], hull: 'hull.standard' }).save;
    const end = apply(s, {
      type: 'sector_end',
      debrief: debrief({ kind: 'mining', rank: 'S', damage: 0, tally: { mined: 4, surveyed: ['Io', 'Io'], signals: 1, caches: 2, transits: 3, assists: 1 }, bonuses: [{ label: 'CUT A RICH VEIN', done: true, feat: true }] }),
      practice: false,
      distance: 900,
      binary: true,
    });
    s = end.save;
    expect(s.stats).toMatchObject({ missionsAttempted: 1, missionsCompleted: 1, sRanks: 1, flawless: 1, asteroidsCollected: 4, signalsFound: 1, cachesFound: 2, wormholeTransits: 3, gravityAssists: 1, binaryMissions: 1, distance: 900 });
    expect(s.stats.missionPlays.mining).toBe(1);
    expect(s.stats.moduleUse.anchor).toBe(1);
    expect(s.stats.feats.mining).toBe(1);
    expect(s.journey.planets).toEqual(['Jupiter', 'Io'].filter((p) => p === 'Io'));
    expect(s.missions.mining).toEqual({ completed: 1, best: 'S' });
    expect(end.out.credits).toBeGreaterThanOrEqual(20);
    expect(s.stats.creditsEarned).toBe(s.credits);
  });

  it('pays a discovery once, however often the place is revisited', () => {
    const sys = getSystems().find('TRAPPIST-1') as StarSystem;
    const id = identity({ objectId: sys.id, objectName: sys.name, systemId: sys.id, planets: sys.planets.map((p) => p.name), environment: 'star_system' });
    const first = apply(defaultSave(NOW), { type: 'sector_enter', index: 3, identity: id, kind: 'survey', practice: false, modules: [], hull: 'hull.standard' });
    expect(first.out.discovery.system).toBe(true);
    expect(first.save.journey.planets.length).toBe(7);
    expect(first.out.achievements.map((a) => a.id)).toContain('first-contact');
    const again = apply(first.save, { type: 'sector_enter', index: 9, identity: id, kind: 'survey', practice: false, modules: [], hull: 'hull.standard' });
    expect(again.out.discovery.system).toBe(false);
    expect(again.out.achievements).toEqual([]);
    expect(again.out.credits).toBe(0);
    expect(again.save.journey.systems[sys.id].visits).toBe(2);
  });

  it('unlocks each achievement exactly once and pays its reward exactly once', () => {
    let s = defaultSave(NOW);
    s.stats.missionsCompleted = 99;
    s = apply(s, { type: 'settle' }).save;
    const before = s.credits;
    const done = apply(s, { type: 'sector_end', debrief: debrief(), practice: false, distance: 0, binary: false });
    const veteran = done.out.achievements.find((a) => a.id === 'cosmic-veteran');
    expect(veteran).toBeDefined();
    expect(done.save.achievements['cosmic-veteran']).toBe(NOW);
    // Its reward and its cosmetic arrived.
    expect(done.save.credits - before).toBeGreaterThanOrEqual(veteran!.reward);
    expect(done.save.inventory.owned['hull.void']).toBeDefined();
    // Nothing more, however many more events follow.
    const next = apply(done.save, { type: 'sector_end', debrief: debrief(), practice: false, distance: 0, binary: false });
    expect(next.out.achievements.find((a) => a.id === 'cosmic-veteran')).toBeUndefined();
    expect(pendingAchievements(next.save)).toEqual([]);
  });

  it('levels the pilot from experience, paying each level once', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(xpForLevel(5))).toBe(5);
    expect(levelFor(xpForLevel(5) - 1)).toBe(4);
    let s = defaultSave(NOW);
    s.profile.xp = xpForLevel(3) - 5;
    const r = apply(s, { type: 'sector_end', debrief: debrief(), practice: false, distance: 0, binary: false });
    expect(r.out.levels).toEqual([3]);
    // The level-3 trail is granted with it.
    expect(r.save.inventory.owned['trail.comet']).toBeDefined();
    s = r.save;
    expect(apply(s, { type: 'settle' }).out.levels).toEqual([]);
  });

  it('never lets credits go below zero, and refuses what cannot be afforded', () => {
    const s = defaultSave(NOW);
    s.credits = 100;
    const out = applyEvent(JSON.parse(JSON.stringify(s)), { type: 'settle' }, NOW);
    expect(spend(s, out, 101)).toBe(false);
    expect(s.credits).toBe(100);
    expect(spend(s, out, 100)).toBe(true);
    expect(s.credits).toBe(0);
    const poor = apply(defaultSave(NOW), { type: 'open_case', caseId: 'survey', random: Math.random });
    expect(poor.out.ok).toBe(false);
    expect(poor.save.credits).toBe(0);
    expect(poor.save.stats.casesOpened).toBe(0);
    const store = new SaveStore(new MemStore());
    store.update((d) => {
      d.credits = -40;
    });
    expect(store.get().credits).toBe(0);
  });

  it('buys, fits and levels ship modules, and discovers synergies by fitting both halves', () => {
    let s = defaultSave(NOW);
    s.credits = 5000;
    // Locked until earned.
    expect(apply(s, { type: 'buy_module', id: 'anchor' }).out.ok).toBe(false);
    s.journey.sectorsCleared = 6;
    s.stats.binaryMissions = 1;
    let r = apply(s, { type: 'buy_module', id: 'anchor' });
    expect(r.out.ok).toBe(true);
    expect(r.out.spent).toBe(MODULE_COSTS[0]);
    expect(r.save.modules.equipped).toEqual(['anchor']);
    r = apply(r.save, { type: 'buy_module', id: 'resonator' });
    expect(r.save.modules.equipped).toEqual(['anchor', 'resonator']);
    expect(r.out.synergies).toEqual(['harmonics']);
    expect(r.save.modules.synergies).toEqual(['harmonics']);
    // Two bays below pilot level 6: a third module cannot be fitted.
    s = r.save;
    s.stats.missionsCompleted = 10;
    r = apply(s, { type: 'buy_module', id: 'dualcore' });
    expect(r.save.modules.equipped).toEqual(['anchor', 'resonator']);
    expect(apply(r.save, { type: 'equip_module', id: 'dualcore', on: true }).out.ok).toBe(false);
    r = apply(r.save, { type: 'equip_module', id: 'anchor', on: false });
    r = apply(r.save, { type: 'equip_module', id: 'dualcore', on: true });
    expect(r.save.modules.equipped).toEqual(['resonator', 'dualcore']);
    // Re-fitting a discovered pair announces nothing new.
    r = apply(r.save, { type: 'equip_module', id: 'resonator', on: false });
    r = apply(r.save, { type: 'equip_module', id: 'anchor', on: true });
    r = apply(r.save, { type: 'equip_module', id: 'resonator', on: false });
    expect(apply(r.save, { type: 'equip_module', id: 'resonator', on: true }).out.synergies).toEqual([]);
  });

  it('only fits owned cosmetics, each in its own slot', () => {
    const s = defaultSave(NOW);
    expect(apply(s, { type: 'equip_cosmetic', slot: 'hull', id: 'hull.holo' }).out.ok).toBe(false);
    s.inventory.owned['hull.holo'] = { at: NOW, source: 'case:singularity', fresh: true };
    expect(apply(s, { type: 'equip_cosmetic', slot: 'trail', id: 'hull.holo' }).out.ok).toBe(false);
    const r = apply(s, { type: 'equip_cosmetic', slot: 'hull', id: 'hull.holo' });
    expect(r.save.inventory.equipped.hull).toBe('hull.holo');
    expect(r.save.inventory.owned['hull.holo'].fresh).toBe(false);
    const shop = COSMETICS.find((c) => c.obtain.kind === 'shop')!;
    const buyer = defaultSave(NOW);
    buyer.credits = 1000;
    const b = apply(buyer, { type: 'buy_cosmetic', id: shop.id });
    expect(b.out.ok).toBe(true);
    expect(apply(b.save, { type: 'buy_cosmetic', id: shop.id }).out.ok).toBe(false);
  });

  it('pays practice at half rate and keeps it out of the records', () => {
    const full = apply(defaultSave(NOW), { type: 'sector_end', debrief: debrief({ credits: 40 }), practice: false, distance: 0, binary: false });
    const half = apply(defaultSave(NOW), { type: 'sector_end', debrief: debrief({ credits: 40 }), practice: true, distance: 0, binary: false });
    expect(half.out.credits).toBeLessThan(full.out.credits);
    const run = apply(defaultSave(NOW), { type: 'run_end', level: 12, time: 300, score: 9000, energy: 40, avoided: 3, destroyed: 2, nearMisses: 7, sectorsCleared: 1, practice: true, creditMul: 1, earnedInRun: 0 });
    expect(run.save.records.highestLevel).toBe(0);
    expect(run.save.records.bestScore).toBe(0);
  });

  it('every achievement is reachable and well-formed; old milestones are part of the list', () => {
    const ids = new Set<string>();
    for (const a of ACHIEVEMENTS) {
      expect(ids.has(a.id), a.id).toBe(false);
      ids.add(a.id);
      expect(a.reward).toBeGreaterThan(0);
      const [, target] = a.progress({ save: defaultSave(NOW), d: deriveStats(defaultSave(NOW)) });
      expect(target, a.id).toBeGreaterThan(0);
    }
    for (const m of MILESTONES) expect(ACHIEVEMENT_IDS.has(m.id), m.id).toBe(true);
    for (const named of ['first-contact', 'binary-explorer', 'cartographer-25', 'boss-hunter', 'collector-20', 'cosmic-veteran', 'beyond-horizon', 'master-explorer']) expect(ACHIEVEMENT_IDS.has(named), named).toBe(true);
    // A brand-new pilot has earned nothing.
    expect(pendingAchievements(defaultSave(NOW))).toEqual([]);
  });
});

// ------------------------------------------------------------------ cases and cosmetics

describe('cases', () => {
  it('states odds that sum to 100 and match what is actually rolled', () => {
    for (const c of CASES) {
      const odds = effectiveOdds(c);
      expect(odds.reduce((s, o) => s + o.chance, 0), c.id).toBeCloseTo(100, 6);
      const rng = new Rng(0xc0ffee + c.price);
      const counts = new Map<string, number>();
      const N = 20000;
      // Everything owned: duplicate protection cannot steer the rarity, and pity is never reached.
      const all = new Set(COSMETICS.map((x) => x.id));
      for (let i = 0; i < N; i++) {
        const r = rollCase(c, all, 0, () => rng.next());
        counts.set(r.rarity, (counts.get(r.rarity) ?? 0) + 1);
      }
      for (const o of odds) expect(((counts.get(o.rarity) ?? 0) / N) * 100, `${c.id} ${o.rarity}`).toBeCloseTo(o.chance, 0);
    }
  });

  it('gives new items before duplicates, and converts a duplicate into credits', () => {
    const c = CASES[0];
    const commons = casePool(c).filter((i) => i.rarity === 'common');
    const owned = new Set(commons.slice(1).map((i) => i.id));
    // A roll that lands on common must pick the one common still missing.
    const r = rollCase(c, owned, 0, () => 0.01);
    expect(r.rarity).toBe('common');
    expect(r.item.id).toBe(commons[0].id);
    expect(r.duplicate).toBe(false);
    const dup = rollCase(c, new Set(commons.map((i) => i.id)), 0, () => 0.01);
    expect(dup.duplicate).toBe(true);
    expect(dup.refund).toBe(DUPLICATE_VALUE.common);
  });

  it('guarantees the stated rarity after the stated number of opens', () => {
    for (const c of CASES) {
      const r = rollCase(c, new Set(), c.pity.after - 1, () => 0);
      expect(RARITY_RANK[r.rarity], c.id).toBeGreaterThanOrEqual(RARITY_RANK[c.pity.rarity]);
      expect(r.guaranteed).toBe(true);
    }
  });

  it('opening a case charges its price once, adds the item and counts it', () => {
    const s = defaultSave(NOW);
    s.credits = 1000;
    const c = CASES.find((x) => x.id === 'deepfield')!;
    const r = apply(s, { type: 'open_case', caseId: 'deepfield', random: () => 0.5 });
    expect(r.out.ok).toBe(true);
    expect(r.out.spent).toBe(c.price);
    expect(r.save.inventory.owned[r.out.roll!.item.id]).toMatchObject({ source: 'case:deepfield', fresh: true });
    expect(r.save.stats.casesOpened).toBe(1);
    expect(r.save.stats.creditsSpent).toBe(c.price);
    expect(r.save.credits).toBe(1000 - c.price + r.out.credits);
  });
});

describe('cosmetics', () => {
  it('every item can be obtained, and every slot has a stock part', () => {
    const inCase = new Set(CASES.flatMap((c) => casePool(c).map((i) => i.id)));
    for (const c of COSMETICS) {
      if (c.obtain.kind === 'case') expect(inCase.has(c.id), c.id).toBe(true);
      if (c.obtain.kind === 'achievement') expect(ACHIEVEMENT_IDS.has(c.obtain.id), `${c.id} -> ${c.obtain.id}`).toBe(true);
    }
    for (const slot of SLOTS) expect(STARTER_IDS.some((id) => id.startsWith(`${slot}.`)), slot).toBe(true);
    // Every rarity tier is represented, mythic included, and mythics only come from the top case.
    const mythics = COSMETICS.filter((c) => c.rarity === 'mythic' && c.obtain.kind === 'case');
    expect(mythics.length).toBeGreaterThan(0);
    for (const m of mythics) for (const c of CASES) expect(casePool(c).includes(m), `${m.id} in ${c.id}`).toBe(c.id === 'singularity');
  });

  it('resolves a loadout into paint parameters, falling back to stock parts', () => {
    const look = resolveLook({ ...DEFAULT_LOADOUT, hull: 'hull.nebula', trail: 'hull.void', engine: 'missing' });
    expect(look.hull.pattern).toBe('nebula');
    expect(look.hull.frames).toBeGreaterThan(1);
    expect(look.trail.style).toBe('line');
    expect(look.engine.style).toBe('standard');
    expect(look.rarity).toBe('mythic');
    expect(resolveLook(null).key).toBe(resolveLook(DEFAULT_LOADOUT).key);
    // High rarity means motion: every legendary and mythic hull is animated.
    for (const c of COSMETICS) if (c.slot === 'hull' && RARITY_RANK[c.rarity] >= 4) expect((c.look as { frames: number }).frames, c.id).toBeGreaterThan(1);
  });

  it('the run spawns the fitted exhaust particles', () => {
    const level = generateLevelFromSeed(5, 2);
    const burn = (particles: string): number => {
      const run = new Run({ demo: false, sink: quiet, seed: 5, level, noSpawns: true, look: resolveLook({ ...DEFAULT_LOADOUT, particles }) });
      const spawned: string[] = [];
      const spawn = run.particles.spawn.bind(run.particles);
      run.particles.spawn = (...args: Parameters<typeof spawn>) => {
        spawned.push(args[5]);
        spawn(...args);
      };
      for (let i = 0; i < 2 / CONFIG.STEP; i++) run.step(CONFIG.STEP, { accel: true, brake: false, lateral: 0, boost: false });
      return spawned.filter((c) => c === '#bfe8ff' || c === '#ffffff').length;
    };
    // Frost exhaust is white and pale blue; the stock exhaust is orange and amber.
    expect(burn('particles.frost')).toBeGreaterThan(20);
    expect(burn('particles.standard')).toBe(0);
  });
});

// ------------------------------------------------------------------ modules in flight

describe('modules in flight', () => {
  it('are neutral when nothing is fitted', () => {
    const m = computeModuleMods(null);
    expect(m).toMatchObject({ disturbMul: 1, anchorCd: 0, thrustMul: 1, burstWindow: 0, collectR: 0, deepScan: 0, phaseTimeMul: 1, previewMul: 1, stabilityDrainMul: 1 });
    // Every module changes something and has an unlock and a description.
    for (const id of MODULE_IDS) {
      const one = computeModuleMods({ levels: { ...emptyLevels(), [id]: 1 }, equipped: [id] });
      expect(JSON.stringify(one), id).not.toBe(JSON.stringify(m));
      expect(MODULES[id].summary.length).toBeGreaterThan(20);
    }
    for (const s of SYNERGIES) expect(MODULE_IDS).toEqual(expect.arrayContaining(s.pair));
  });

  const emptyLevels = () => Object.fromEntries(MODULE_IDS.map((id) => [id, 0])) as Record<(typeof MODULE_IDS)[number], number>;

  function waveTest(anchor: number): number {
    const level = generateLevelFromSeed(31, 6);
    const run = new Run({ demo: false, sink: quiet, seed: 31, level, noSpawns: true, modules: { levels: { ...emptyLevels(), anchor }, equipped: anchor ? ['anchor'] : [] } });
    for (let i = 0; i < CONFIG.INTRO_TIME / CONFIG.STEP + 10; i++) run.step(CONFIG.STEP, { accel: false, brake: false, lateral: 0, boost: false });
    run.launchWave(1, 3);
    let dv = 0;
    for (let i = 0; i < 4 / CONFIG.STEP; i++) {
      run.step(CONFIG.STEP, { accel: false, brake: false, lateral: 0, boost: false });
      const s = run.ship;
      const r = Math.hypot(s.x, s.y);
      dv = Math.max(dv, Math.abs((s.x * s.vx + s.y * s.vy) / r));
    }
    return dv;
  }

  it('the Gravitational Anchor absorbs a gravity wave outright', () => {
    expect(waveTest(1)).toBeLessThan(waveTest(0) * 0.6);
  });

  it('the Deep-Space Scanner is what makes hidden caches collectable', () => {
    let level = generateLevelFromSeed(1, 8, new Set(), undefined, { kind: 'survival', tier: 2, variant: 'pristine' });
    expect(level.mission.pickups.some((p) => p.kind === 'cache')).toBe(true);
    // Put the cache right on the ship's starting point.
    const start = { ...level.mission.pickups.find((p) => p.kind === 'cache')!, anchor: { r: level.startRadius * (1 - 0), angle: 0, omega: 0 } };
    level = { ...level, startEcc: 0, mission: { ...level.mission, pickups: [start] } };
    const fly = (scanner: number): number => {
      const run = new Run({ demo: false, sink: quiet, seed: 1, level, noSpawns: true, modules: { levels: { ...emptyLevels(), scanner }, equipped: scanner ? ['scanner'] : [] } });
      for (let i = 0; i < 0.5 / CONFIG.STEP; i++) run.step(CONFIG.STEP, { accel: false, brake: false, lateral: 0, boost: false });
      return run.mission.tally.caches;
    };
    expect(fly(0)).toBe(0);
    expect(fly(1)).toBe(1);
  });

  it('the Quantum Collector draws pickups in from range', () => {
    let level = generateLevelFromSeed(2, 8);
    const near = { kind: 'repair' as const, anchor: { r: level.startRadius + 22, angle: 0.02, omega: 0 } };
    level = { ...level, startEcc: 0, mission: { ...level.mission, pickups: [near] } };
    const fly = (collector: number): boolean => {
      const run = new Run({ demo: false, sink: quiet, seed: 2, level, noSpawns: true, modules: { levels: { ...emptyLevels(), collector }, equipped: collector ? ['collector'] : [] } });
      for (let i = 0; i < 1.5 / CONFIG.STEP; i++) run.step(CONFIG.STEP, { accel: false, brake: false, lateral: 0, boost: false });
      return run.mission.pickups[0].taken;
    };
    expect(fly(0)).toBe(false);
    expect(fly(3)).toBe(true);
  });
});

// ------------------------------------------------------------------ star systems

const ROW = (over: PscompparsRow): PscompparsRow => ({ pl_name: 'Test-1 b', hostname: 'Test-1', sy_snum: 1, sy_pnum: 1, cb_flag: 0, pl_orbper: 3.2, pl_orbsmax: 0.04, st_teff: 5100, sy_dist: 10, disc_year: 2019, discoverymethod: 'Transit', ...over });

describe('star-system data pipeline', () => {
  it('normalises archive rows into systems: grouped, deduplicated, units converted, nothing invented', () => {
    const { systems, rejected } = normalizeExoplanetRows(
      [
        ROW({}),
        ROW({ pl_name: 'Test-1 c', pl_orbsmax: 0.09, pl_orbeccen: 1.7, pl_rade: null, disc_year: 2021 }),
        ROW({}),
        ROW({ pl_name: 'Pair-2 b', hostname: 'Pair-2', sy_snum: 2, cb_flag: 1, sy_dist: null, st_teff: 'n/a' }),
        ROW({ pl_name: null }),
      ],
      NOW,
    );
    expect(rejected).toHaveLength(1);
    const t = systems.find((s) => s.name === 'Test-1')!;
    expect(t.planets.map((p) => p.letter)).toEqual(['b', 'c']);
    expect(t.distanceLy).toBeCloseTo(32.616, 2);
    expect(t.discoveryYear).toBe(2019);
    // An out-of-range eccentricity is dropped, not clamped into something plausible.
    expect(t.planets[1].eccentricity).toBeNull();
    expect(t.planets[1].radiusEarth).toBeNull();
    const p = systems.find((s) => s.name === 'Pair-2')!;
    expect(p).toMatchObject({ kind: 'binary', starCount: 2, hostConfig: 'circumbinary', distanceLy: null });
    expect(p.stars[0].teff).toBeNull();
    for (const s of systems) expect(validateSystem(s), s.name).toEqual([]);
  });

  it('merges a re-fetch into what is known without losing measurements', () => {
    const [old] = normalizeExoplanetRows([ROW({ pl_rade: 1.4 })], '2026-01-01T00:00:00Z').systems;
    const [fresh] = normalizeExoplanetRows([ROW({ pl_rade: null, pl_orbper: 3.25 }), ROW({ pl_name: 'Test-1 d' })], NOW).systems;
    const { systems, added, updated } = mergeSystems([old], [fresh]);
    expect(added).toBe(0);
    expect(updated).toBe(1);
    expect(systems).toHaveLength(1);
    const b = systems[0].planets.find((x) => x.name === 'Test-1 b')!;
    expect(b.periodDays).toBe(3.25);
    expect(b.radiusEarth).toBe(1.4);
    expect(systems[0].planets).toHaveLength(2);
    expect(systems[0].lastUpdated).toBe(NOW);
  });

  it('rejects malformed records', () => {
    const [good] = normalizeExoplanetRows([ROW({})], NOW).systems;
    expect(validateSystem({ ...good, kind: 'binary' })).toContain('kind does not match star count');
    expect(validateSystem({ ...good, id: 'x' })).toContain('bad id');
    expect(validateSystem({ ...good, distanceLy: Infinity })).toContain('distance not finite');
    expect(validateSystem({ ...good, hostConfig: 'circumbinary' })).toContain('host configuration on a single star');
    expect(validateSystem('nope')).toEqual(['not an object']);
  });

  it('ships a real snapshot that packs and unpacks losslessly and holds the showcase systems', () => {
    const cat = getSystems();
    expect(cat.size).toBeGreaterThan(900);
    const trappist = cat.find('TRAPPIST-1')!;
    expect(trappist.planets).toHaveLength(7);
    expect(trappist.kind).toBe('single');
    const k16 = cat.find('Kepler-16')!;
    expect(k16).toMatchObject({ kind: 'binary', hostConfig: 'circumbinary' });
    const proxima = cat.find('Proxima Centauri')!;
    expect(proxima.name).toBe('Proxima Cen');
    expect(proxima.kind).toBe('multiple');
    expect(cat.find('Kepler-90')!.planets).toHaveLength(8);
    // One star, one entry: SIMBAD's Kepler-90 is the archive's KOI-351.
    expect(cat.systems.filter((s) => s.name === 'Kepler-90' || s.name === 'KOI-351')).toHaveLength(1);
    const sol = cat.get(SOLAR_SYSTEM_ID)!;
    expect(sol.planets.map((p) => p.name)).toEqual(['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']);
    expect(solarSystemFrom(getCatalogue())?.source).toBe('JPL-HORIZONS');
    for (const s of cat.systems) expect(validateSystem(s), s.id).toEqual([]);
    expect(new Set(cat.systems.map((s) => s.id)).size).toBe(cat.size);
    const file = unpackSystems(packSystems({ version: 1, generatedAt: NOW, sources: {}, systems: normalizeExoplanetRows([ROW({}), ROW({ pl_name: 'Pair-2 b', hostname: 'Pair-2', sy_snum: 2, cb_flag: 0 })], NOW).systems }));
    expect(file.systems.map((s) => s.name)).toEqual(['Pair-2', 'Test-1']);
    expect(file.systems[0].hostConfig).toBe('circumstellar');
  });

  it('classifies a SIMBAD star as binary only on its object type', () => {
    const cat = getCatalogue();
    const binaries = cat.objects.filter(isSimbadBinary);
    expect(binaries.length).toBeGreaterThan(20);
    for (const o of binaries) expect(['SB*', 'EB*', 'El*', 'RS*', 'Sy*', '**']).toContain(o.context.objectType);
  });

  it('filters and searches systems the way the catalogue screen does', () => {
    const cat = getSystems();
    const circ = cat.search({ kind: 'circumbinary' });
    expect(circ.length).toBeGreaterThan(10);
    expect(circ.every((s) => s.hostConfig === 'circumbinary')).toBe(true);
    expect(cat.search({ kind: 'multiple' }).every((s) => s.starCount >= 3)).toBe(true);
    const seen = new Set(['sys:trappist-1']);
    expect(cat.search({ status: 'discovered', discovered: seen }).map((s) => s.id)).toEqual(['sys:trappist-1']);
    expect(cat.search({ status: 'undiscovered', discovered: seen }).some((s) => s.id === 'sys:trappist-1')).toBe(false);
    expect(cat.search({ text: 'kepler-90' }).map((s) => s.id)).toContain('sys:koi-351');
  });

  it('parses JPL small-body and Horizons records, keeping absent values absent', () => {
    const { body } = normalizeSbdb(
      {
        object: { fullname: '99942 Apophis (2004 MN4)', des: '99942', kind: 'an', neo: true, pha: true, orbit_class: { name: 'Aten' } },
        orbit: { elements: [{ name: 'a', value: '.9224' }, { name: 'e', value: '.1911' }, { name: 'i', value: '3.34' }, { name: 'per', value: '323.6' }] },
        phys_par: [{ name: 'diameter', value: '.34' }],
      },
      NOW,
    );
    expect(body).toMatchObject({ id: 'sb:99942', kind: 'asteroid', orbitClass: 'Aten', smaAu: 0.9224, diameterKm: 0.34, albedo: null, rotationHours: null, neo: true });
    expect(normalizeSbdb({ message: 'specified object was not found' }, NOW).body).toBeNull();
    const h = parseHorizonsPhysical(' Vol. mean radius (km) = 3389.92+-0.04  Mass x10^23 (kg) = 6.4171 Sidereal orb. per. = 686.98 d  ');
    expect(h.radiusKm).toBe(3389.92);
    expect(h.massKg).toBeCloseTo(6.4171e23, -20);
    expect(h.orbitalPeriodDays).toBe(686.98);
    expect(h.rotationHours).toBeNull();
    expect(sanitizeTerm("x'; drop table--")).toBe('x drop table--');
  });
});

describe('live imports', () => {
  const archiveRows = (term: string): string => JSON.stringify([ROW({ pl_name: `${term} b`, hostname: term }), ROW({ pl_name: `${term} c`, hostname: term, pl_orbsmax: 0.08 })]);
  const fakeCatalogue = (): SystemCatalogue => new SystemCatalogue({ version: 1, generatedAt: NOW, sources: {}, systems: normalizeExoplanetRows([ROW({})], NOW).systems });
  const instant = { sleep: async () => undefined, minIntervalMs: 0, backoffMs: () => 0 };

  it('imports, validates, merges and caches - and the cache survives a restart with no network', async () => {
    const mem = new MemStore();
    const cat = fakeCatalogue();
    const queries: string[] = [];
    const transport: FetchText = async (up, q) => {
      queries.push(`${up}?${decodeURIComponent(q)}`);
      return archiveRows('Live-7');
    };
    const svc = new AstroService(cat, { transport, storage: mem, ...instant });
    const res = await svc.importSystems('Live-7');
    expect(res).toMatchObject({ ok: true, added: 1, updated: 0 });
    expect(queries[0]).toContain("lower(hostname) like '%live-7%'");
    expect(cat.get('sys:live-7')).toMatchObject({ origin: 'live', planetCount: 2 });
    // Importing again refreshes rather than duplicates.
    expect(await svc.importSystems('Live-7')).toMatchObject({ added: 0, updated: 1 });
    expect(cat.systems.filter((s) => s.id === 'sys:live-7')).toHaveLength(1);
    // A new session, offline: the import is still there.
    const cat2 = fakeCatalogue();
    const offline = new AstroService(cat2, { transport: null, storage: mem, ...instant });
    expect(cat2.get('sys:live-7')).toBeDefined();
    const res2 = await offline.importSystems('Anything');
    expect(res2.ok).toBe(false);
    expect(res2.message).toMatch(/offline|unreachable|connection/i);
    expect(offline.requests).toBe(0);
  });

  it('retries server errors, gives up cleanly, cools down, and leaves the catalogue unchanged', async () => {
    const cat = fakeCatalogue();
    let calls = 0;
    const transport: FetchText = async () => {
      calls++;
      throw Object.assign(new Error('HTTP 503 from exo'), { status: 503 });
    };
    let clock = 1_000_000;
    const svc = new AstroService(cat, { transport, storage: new MemStore(), ...instant, retries: 2, now: () => clock });
    const before = cat.size;
    const res = await svc.importSystems('Kepler');
    expect(res.ok).toBe(false);
    expect(calls).toBe(3);
    expect(cat.size).toBe(before);
    // Inside the cool-down nothing more is sent.
    expect((await svc.importSystems('Kepler')).ok).toBe(false);
    expect(calls).toBe(3);
    clock += 31_000;
    await svc.importSystems('Kepler');
    expect(calls).toBe(6);
  });

  it('does not retry its own bad requests, rejects bad data, and refuses to run twice at once', async () => {
    let calls = 0;
    const bad: FetchText = async () => {
      calls++;
      throw Object.assign(new Error('HTTP 400'), { status: 400 });
    };
    const svc = new AstroService(fakeCatalogue(), { transport: bad, storage: new MemStore(), ...instant });
    await svc.importSystems('Kepler');
    expect(calls).toBe(1);
    const junk = new AstroService(fakeCatalogue(), { transport: async () => '<html>maintenance</html>', storage: new MemStore(), ...instant });
    expect((await junk.importSystems('Kepler')).ok).toBe(false);
    let release: () => void = () => undefined;
    const slow = new AstroService(fakeCatalogue(), { transport: () => new Promise((r) => (release = () => r(archiveRows('Slow-1')))), storage: new MemStore(), ...instant });
    const first = slow.importSystems('Slow-1');
    await Promise.resolve();
    expect((await slow.importSystems('Slow-1')).message).toMatch(/already running/);
    release();
    expect((await first).ok).toBe(true);
    expect((await svc.importSystems('x')).ok).toBe(false);
  });

  it('drops a corrupt or oversized cache instead of trusting it', () => {
    const mem = new MemStore();
    mem.setItem(LIVE_CACHE_KEY, '{not json');
    expect(readCache(mem).systems).toEqual([]);
    const many = Array.from({ length: MAX_LIVE_SYSTEMS + 50 }, (_, i) => normalizeExoplanetRows([ROW({ pl_name: `H${i} b`, hostname: `H${i}` })], NOW).systems[0]);
    mem.setItem(LIVE_CACHE_KEY, JSON.stringify({ version: 1, systems: [...many, { id: 'evil' }], bodies: [{ id: 'sb:x' }], lastSync: { exo: 'yesterday' } }));
    const c = readCache(mem);
    expect(c.systems).toHaveLength(MAX_LIVE_SYSTEMS);
    expect(c.bodies).toEqual([]);
    expect(c.lastSync).toEqual({});
  });

  it('the import proxy only ever reaches the three fixed services', async () => {
    const urls: string[] = [];
    const fake = (async (u: string) => {
      urls.push(u);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    expect((await fetchUpstream('http://evil.example', 'x=1', fake)).status).toBe(400);
    expect((await fetchUpstream('exo', 'a\r\nHost: evil', fake)).status).toBe(400);
    expect((await fetchUpstream('exo', '', fake)).status).toBe(400);
    expect((await fetchUpstream('exo', 'query=1', fake)).status).toBe(200);
    expect((await fetchUpstream('sbdb', 'sstr=433', fake)).status).toBe(200);
    expect(urls).toEqual(['https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=1', 'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=433']);
    const failing = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect((await fetchUpstream('horizons', 'x=1', failing)).status).toBe(502);
    expect(typeof proxy).toBe('function');
  });
});

describe('real systems as playable sectors', () => {
  it('builds a sector from a system: its worlds in order, its star colour, its own identity', () => {
    const cat = getSystems();
    const trappist = cat.find('TRAPPIST-1')!;
    const level = levelForSystem(trappist, 99, 6)!;
    expect(level.identity).toMatchObject({ kind: 'REAL OBJECT', objectName: 'TRAPPIST-1', systemId: trappist.id, environment: 'star_system', source: 'NASA Exoplanet Archive' });
    const worlds = level.companions.filter((c) => c.kind === 'planet');
    expect(worlds).toHaveLength(Math.min(5, trappist.planets.length));
    expect(sampleWorlds(trappist).map((p) => p.name)[0]).toBe('TRAPPIST-1 b');
    for (let i = 1; i < worlds.length; i++) expect(worlds[i].orbitRadius).toBeGreaterThan(worlds[i - 1].orbitRadius);
    // A 2,566 K star is drawn red; the Sun is drawn yellow-white.
    const red = level.body.look.ramp[4];
    const sun = levelForSystem(cat.get(SOLAR_SYSTEM_ID)!, 99, 6)!;
    expect(parseInt(red.slice(5, 7), 16)).toBeLessThan(parseInt(sun.body.look.ramp[4].slice(5, 7), 16));
    // Eight planets sample evenly to five, innermost and outermost kept.
    expect(sun.identity.planets).toEqual(['Mercury', 'Earth', 'Jupiter', 'Saturn', 'Neptune']);
  });

  it('gives a circumbinary system two stars in motion, and a circumstellar one a wide companion', () => {
    const cat = getSystems();
    const k16 = levelForSystem(cat.find('Kepler-16')!, 7, 6)!;
    expect(k16.identity.environment).toBe('circumbinary');
    expect(k16.body.orbit).not.toBeNull();
    expect(k16.companions.filter((c) => c.kind === 'star')).toHaveLength(1);
    // The planets ride outside the pair - outside the band the ship flies.
    for (const p of k16.companions.filter((c) => c.kind === 'planet')) expect(p.orbitRadius).toBeGreaterThan(k16.safeMax);
    expect(k16.mechanics.stream).not.toBeNull();
    const prox = levelForSystem(cat.find('Proxima Cen')!, 7, 6)!;
    expect(prox.identity.environment).toBe('companion_star');
    expect(prox.body.orbit).toBeNull();
    expect(prox.companions.some((c) => c.kind === 'star' && c.orbitRadius > prox.safeMax)).toBe(true);
    expect(levelForSystem({ ...cat.find('Kepler-16')!, planets: [] }, 1, 3)).toBeNull();
  });

  it('runs draw on real systems by themselves', () => {
    const hosts = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const l = generateLevelFromSeed(seed, 12);
      if (l.identity.systemId) hosts.add(l.identity.environment);
    }
    expect(hosts.has('star_system')).toBe(true);
    expect(MISSIONS.survey.envs).toContain('star_system');
  });
});
