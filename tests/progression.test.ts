import { describe, expect, it } from 'vitest';
import { getCatalogue } from '../src/astronomy/database/catalogue';
import type { LevelIdentity } from '../src/game/types';
import { discoveryStats, emptyLog, progressFrom, recordVisit, sanitizeLog } from '../src/progression/discovery';
import { isComplete, MILESTONES, newlyCompleted } from '../src/progression/milestones';
import { environmentEntries } from '../src/progression/unlocks';

const identity = (over: Partial<LevelIdentity>): LevelIdentity => ({
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

describe('discovery log', () => {
  it('logs real objects once and counts repeat visits', () => {
    const log = emptyLog();
    expect(recordVisit(log, identity({}), 4, '2026-01-01T00:00:00Z')).toBe(true);
    expect(recordVisit(log, identity({}), 9, '2026-01-02T00:00:00Z')).toBe(false);
    expect(log.objects['horizons:599']).toMatchObject({ sector: 4, visits: 2, env: 'gas_giant' });
    expect(log.environments).toEqual(['gas_giant']);
  });

  it('keeps generated and invented settings out of the object list', () => {
    const log = emptyLog();
    expect(recordVisit(log, identity({ kind: 'PROCEDURAL VARIANT', objectId: 'pv:ice:1', environment: 'ice' }), 2, '')).toBe(false);
    expect(recordVisit(log, identity({ kind: 'FICTIONAL OBJECT', objectId: 'fx:anomaly:1', environment: 'anomaly', rarity: 'legendary' }), 20, '')).toBe(false);
    expect(Object.keys(log.objects)).toEqual([]);
    expect(log).toMatchObject({ proceduralVisits: 1, fictionalVisits: 1, rareEncounters: 1 });
    expect(log.environments).toEqual(['ice', 'anomaly']);
  });

  it('feeds the encounter selector', () => {
    const log = emptyLog();
    recordVisit(log, identity({}), 1, '');
    const p = progressFrom(log);
    expect(p.discovered.has('horizons:599')).toBe(true);
    expect(p.environmentsSeen.has('gas_giant')).toBe(true);
  });

  it('tolerates corrupt or missing save data', () => {
    expect(sanitizeLog(undefined)).toEqual(emptyLog());
    expect(sanitizeLog('garbage')).toEqual(emptyLog());
    const cleaned = sanitizeLog({ objects: { a: { sector: -3, visits: 'x' }, b: null }, environments: ['rocky', 5, 'rocky'], sectorsCleared: NaN });
    expect(cleaned.objects.a).toMatchObject({ sector: 1, visits: 1 });
    expect(cleaned.objects.b).toBeUndefined();
    expect(cleaned.environments).toEqual(['rocky']);
    expect(cleaned.sectorsCleared).toBe(0);
  });

  it('summarises progress against the catalogue', () => {
    const cat = getCatalogue();
    const log = emptyLog();
    recordVisit(log, identity({}), 1, '');
    recordVisit(log, identity({ objectId: 'no-longer-in-catalogue' }), 2, '');
    const stats = discoveryStats(log, cat);
    expect(stats.discovered).toBe(1);
    expect(stats.total).toBe(cat.size);
    expect(stats.categories.find((c) => c.category === 'planet')?.discovered).toBe(1);
  });
});

describe('milestones', () => {
  it('complete from lifetime progress and pay out once', () => {
    const log = emptyLog();
    expect(newlyCompleted({ log, highestLevel: 0 }, [])).toEqual([]);
    recordVisit(log, identity({ environment: 'red_dwarf', family: 'stellar', objectId: 'simbad:x' }), 4, '');
    const first = newlyCompleted({ log, highestLevel: 4 }, []).map((m) => m.id);
    expect(first).toEqual(['first-star']);
    expect(newlyCompleted({ log, highestLevel: 4 }, first)).toEqual([]);

    recordVisit(log, identity({ environment: 'black_hole', family: 'extreme', rarity: 'rare', kind: 'PROCEDURAL VARIANT' }), 11, '');
    log.sectorsCleared = 50;
    const next = newlyCompleted({ log, highestLevel: 11 }, first).map((m) => m.id);
    expect(next.sort()).toEqual(['first-extreme', 'first-rare', 'sector-10', 'sectors-50'].sort());
  });

  it('covers the journey markers the design calls for', () => {
    const ids = MILESTONES.map((m) => m.id);
    for (const id of ['sector-10', 'sectors-50', 'sectors-100', 'first-star', 'first-extreme', 'first-rare']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MILESTONES) {
      const [cur, target] = m.progress({ log: emptyLog(), highestLevel: 0 });
      expect(cur).toBe(0);
      expect(target).toBeGreaterThan(0);
      expect(isComplete(m, { log: emptyLog(), highestLevel: 0 })).toBe(false);
    }
  });
});

describe('unlocks', () => {
  it('opens environments with depth', () => {
    const cat = getCatalogue();
    const log = emptyLog();
    recordVisit(log, identity({ environment: 'rocky' }), 1, '');
    const entries = environmentEntries(log, 3, cat);
    const status = (id: string): string | undefined => entries.find((e) => e.env.id === id)?.status;
    expect(status('rocky')).toBe('visited');
    expect(status('gas_giant')).toBe('in-range');
    expect(status('quasar')).toBe('locked');
    expect(entries.find((e) => e.env.id === 'quasar')?.hint).toContain('SECTOR');
  });
});
