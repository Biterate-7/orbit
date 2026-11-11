/**
 * The discovery log: which catalogued objects and which environments the player has met.
 *
 * Only real catalogue objects are logged individually. Procedural variants and fictional
 * settings are infinite, so they are counted rather than listed - and never mixed in with
 * real objects.
 */
import type { Catalogue } from '../astronomy/database/catalogue';
import type { AstroCategory } from '../astronomy/database/schema';
import type { LevelIdentity } from '../game/types';
import type { PlayerProgress } from '../generation/encounterSelector';

export interface DiscoveryRecord {
  /** Sector in which the object was first met. */
  sector: number;
  /** ISO date of the first encounter. */
  at: string;
  visits: number;
  /** Environment it was met as, for the catalogue card. */
  env: string;
  orbit: string;
}

export interface DiscoveryLog {
  objects: Record<string, DiscoveryRecord>;
  environments: string[];
  proceduralVisits: number;
  fictionalVisits: number;
  rareEncounters: number;
  /** Sectors cleared across all runs. */
  sectorsCleared: number;
}

export function emptyLog(): DiscoveryLog {
  return { objects: {}, environments: [], proceduralVisits: 0, fictionalVisits: 0, rareEncounters: 0, sectorsCleared: 0 };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Defensive parse of a saved log (tolerates missing or hand-edited fields). */
export function sanitizeLog(raw: unknown): DiscoveryLog {
  const log = emptyLog();
  if (!raw || typeof raw !== 'object') return log;
  const r = raw as Partial<DiscoveryLog>;
  if (r.objects && typeof r.objects === 'object') {
    for (const [id, rec] of Object.entries(r.objects)) {
      if (!rec || typeof rec !== 'object' || typeof id !== 'string') continue;
      const d = rec as Partial<DiscoveryRecord>;
      log.objects[id] = {
        sector: Math.max(1, count(d.sector)),
        at: typeof d.at === 'string' ? d.at : '',
        visits: Math.max(1, count(d.visits)),
        env: typeof d.env === 'string' ? d.env : '',
        orbit: typeof d.orbit === 'string' ? d.orbit : '',
      };
    }
  }
  if (Array.isArray(r.environments)) log.environments = [...new Set(r.environments.filter((e): e is string => typeof e === 'string'))];
  log.proceduralVisits = count(r.proceduralVisits);
  log.fictionalVisits = count(r.fictionalVisits);
  log.rareEncounters = count(r.rareEncounters);
  log.sectorsCleared = count(r.sectorsCleared);
  return log;
}

/** Record entering a sector. Mutates `log`; returns true when a catalogued object is new. */
export function recordVisit(log: DiscoveryLog, identity: LevelIdentity, sector: number, now: string): boolean {
  if (!log.environments.includes(identity.environment)) log.environments.push(identity.environment);
  if (identity.rarity === 'rare' || identity.rarity === 'legendary') log.rareEncounters++;
  if (identity.kind === 'PROCEDURAL VARIANT') {
    log.proceduralVisits++;
    return false;
  }
  if (identity.kind === 'FICTIONAL OBJECT') {
    log.fictionalVisits++;
    return false;
  }
  const existing = log.objects[identity.objectId];
  if (existing) {
    existing.visits++;
    return false;
  }
  log.objects[identity.objectId] = { sector, at: now, visits: 1, env: identity.environment, orbit: identity.orbitLabel };
  return true;
}

export function progressFrom(log: DiscoveryLog): PlayerProgress {
  return { discovered: new Set(Object.keys(log.objects)), environmentsSeen: new Set(log.environments) };
}

export interface CategoryProgress {
  category: AstroCategory;
  discovered: number;
  total: number;
}

export function discoveryStats(log: DiscoveryLog, catalogue: Catalogue): { discovered: number; total: number; categories: CategoryProgress[] } {
  const found = new Map<AstroCategory, number>();
  let discovered = 0;
  for (const id of Object.keys(log.objects)) {
    const o = catalogue.get(id);
    if (!o) continue; // an object from an older catalogue version that no longer exists
    discovered++;
    found.set(o.category, (found.get(o.category) ?? 0) + 1);
  }
  const categories = catalogue.categoryCounts().map(({ category, count: total }) => ({ category, discovered: found.get(category) ?? 0, total }));
  return { discovered, total: catalogue.size, categories };
}
