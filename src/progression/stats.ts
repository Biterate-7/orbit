/**
 * Lifetime statistics.
 *
 * Counters here are only ever changed by game events (see events.ts) - nothing writes
 * demonstration numbers into them. Values that can be worked out from other saved data (systems
 * discovered, cosmetics owned, achievements unlocked ...) are not stored at all: `deriveStats`
 * computes them, so they can never drift out of step with the thing they count.
 */
import { COSMETICS, cosmetic } from '../game/cosmetics/catalog';
import { MISSION_ORDER } from '../game/missions/catalog';
import type { MissionKind, Rank } from '../game/missions/types';
import { MODULE_IDS } from '../game/modules';
import type { ModuleId } from '../game/modules';
import type { SaveData } from '../game/persistence';

export interface BossRecord {
  defeats: number;
  /** Fastest winning time in seconds (0 = none yet). */
  bestTime: number;
  bestRank: Rank;
  /** Highest MK tier beaten. */
  highestTier: number;
  /** Defeats without losing any hull. */
  flawless: number;
}

export interface LifetimeStats {
  missionsCompleted: number;
  missionsAttempted: number;
  missionsFailed: number;
  bossesDefeated: number;
  /** World units flown, all sectors. */
  distance: number;
  /** Ore rocks mined out. */
  asteroidsCollected: number;
  creditsEarned: number;
  creditsSpent: number;
  casesOpened: number;
  duplicatesConverted: number;
  sRanks: number;
  /** Missions completed without losing any hull. */
  flawless: number;
  eliteCleared: number;
  /** Missions completed with two or more twists active. */
  twistedCleared: number;
  signalsFound: number;
  cachesFound: number;
  wormholeTransits: number;
  gravityAssists: number;
  /** First meetings with a rare or legendary environment, plus located signals. */
  rareDiscoveries: number;
  escortsCompleted: number;
  binaryMissions: number;
  /** Records imported live from NASA / JPL. */
  liveImports: number;
  /** Most near misses in a single run. */
  bestNearMisses: number;
  /** Most credits earned in a single run. */
  bestRunCredits: number;
  /** Most sectors cleared in a single run. */
  bestRunSectors: number;
  /** Sectors attempted, per mission type. */
  missionPlays: Partial<Record<MissionKind, number>>;
  /** Sectors flown with each module fitted. */
  moduleUse: Partial<Record<ModuleId, number>>;
  /** Sectors flown in each hull skin. */
  hullUse: Record<string, number>;
  bossRecords: Partial<Record<MissionKind, BossRecord>>;
  /** Times each mission's own challenge bonus was completed. */
  feats: Partial<Record<MissionKind, number>>;
}

const NUMERIC: (keyof LifetimeStats)[] = [
  'missionsCompleted',
  'missionsAttempted',
  'missionsFailed',
  'bossesDefeated',
  'distance',
  'asteroidsCollected',
  'creditsEarned',
  'creditsSpent',
  'casesOpened',
  'duplicatesConverted',
  'sRanks',
  'flawless',
  'eliteCleared',
  'twistedCleared',
  'signalsFound',
  'cachesFound',
  'wormholeTransits',
  'gravityAssists',
  'rareDiscoveries',
  'escortsCompleted',
  'binaryMissions',
  'liveImports',
  'bestNearMisses',
  'bestRunCredits',
  'bestRunSectors',
];

export function emptyStats(): LifetimeStats {
  return {
    missionsCompleted: 0,
    missionsAttempted: 0,
    missionsFailed: 0,
    bossesDefeated: 0,
    distance: 0,
    asteroidsCollected: 0,
    creditsEarned: 0,
    creditsSpent: 0,
    casesOpened: 0,
    duplicatesConverted: 0,
    sRanks: 0,
    flawless: 0,
    eliteCleared: 0,
    twistedCleared: 0,
    signalsFound: 0,
    cachesFound: 0,
    wormholeTransits: 0,
    gravityAssists: 0,
    rareDiscoveries: 0,
    escortsCompleted: 0,
    binaryMissions: 0,
    liveImports: 0,
    bestNearMisses: 0,
    bestRunCredits: 0,
    bestRunSectors: 0,
    missionPlays: {},
    moduleUse: {},
    hullUse: {},
    bossRecords: {},
    feats: {},
  };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const RANKS: Rank[] = ['-', 'C', 'B', 'A', 'S'];

/** Defensive parse of saved statistics: unknown keys are dropped, bad values become 0. */
export function sanitizeStats(raw: unknown): LifetimeStats {
  const out = emptyStats();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const num = out as unknown as Record<string, number>;
  for (const k of NUMERIC) num[k] = k === 'distance' ? count(r[k]) : Math.floor(count(r[k]));
  const map = (v: unknown, allow: (k: string) => boolean): Record<string, number> => {
    const m: Record<string, number> = {};
    if (v && typeof v === 'object') for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (allow(k) && count(n) > 0) m[k] = Math.floor(count(n));
    return m;
  };
  const kinds = new Set<string>(MISSION_ORDER);
  out.missionPlays = map(r.missionPlays, (k) => kinds.has(k));
  out.feats = map(r.feats, (k) => kinds.has(k));
  out.moduleUse = map(r.moduleUse, (k) => (MODULE_IDS as string[]).includes(k));
  out.hullUse = map(r.hullUse, (k) => cosmetic(k)?.slot === 'hull');
  if (r.bossRecords && typeof r.bossRecords === 'object') {
    for (const [k, v] of Object.entries(r.bossRecords as Record<string, unknown>)) {
      if (!kinds.has(k) || !v || typeof v !== 'object') continue;
      const b = v as Partial<BossRecord>;
      out.bossRecords[k as MissionKind] = {
        defeats: Math.floor(count(b.defeats)),
        bestTime: count(b.bestTime),
        bestRank: RANKS.includes(b.bestRank as Rank) ? (b.bestRank as Rank) : '-',
        highestTier: Math.floor(count(b.highestTier)),
        flawless: Math.floor(count(b.flawless)),
      };
    }
  }
  return out;
}

/** Statistics that are computed from the rest of the save rather than stored. */
export interface DerivedStats {
  systemsDiscovered: number;
  objectsDiscovered: number;
  planetsEncountered: number;
  environmentsSeen: number;
  cosmeticsCollected: number;
  cosmeticsTotal: number;
  /** Hull skins owned ("ships"). */
  shipsOwned: number;
  achievementsUnlocked: number;
  highestLevel: number;
  longestSurvival: number;
  playtime: number;
  totalRuns: number;
  sectorsCleared: number;
  shards: number;
  /** Hull skin flown the most, or the one fitted if nothing has been flown yet. */
  favouriteShip: string;
  mostUsedModules: { id: ModuleId; sectors: number }[];
  mostPlayedMissions: { kind: MissionKind; sectors: number }[];
}

export function deriveStats(save: SaveData): DerivedStats {
  const owned = Object.keys(save.inventory.owned);
  const hullUse = Object.entries(save.stats.hullUse).sort((a, b) => b[1] - a[1]);
  return {
    systemsDiscovered: Object.keys(save.journey.systems).length,
    objectsDiscovered: Object.keys(save.journey.objects).length,
    planetsEncountered: save.journey.planets.length,
    environmentsSeen: save.journey.environments.length,
    cosmeticsCollected: owned.length,
    cosmeticsTotal: COSMETICS.length,
    shipsOwned: owned.filter((id) => cosmetic(id)?.slot === 'hull').length,
    achievementsUnlocked: Object.keys(save.achievements).length,
    highestLevel: save.records.highestLevel,
    longestSurvival: save.records.bestTime,
    playtime: save.records.lifetimeTime,
    totalRuns: save.records.totalRuns,
    sectorsCleared: save.journey.sectorsCleared,
    shards: save.records.shards,
    favouriteShip: hullUse[0]?.[0] ?? save.inventory.equipped.hull,
    mostUsedModules: (Object.entries(save.stats.moduleUse) as [ModuleId, number][]).sort((a, b) => b[1] - a[1]).map(([id, sectors]) => ({ id, sectors })),
    mostPlayedMissions: (Object.entries(save.stats.missionPlays) as [MissionKind, number][]).sort((a, b) => b[1] - a[1]).map(([kind, sectors]) => ({ kind, sectors })),
  };
}
