/**
 * The save: one versioned, validated document in localStorage.
 *
 * Version history
 *   1  records, credits, ship parts, in-run unlocks, settings, discovery log, milestones, mission
 *      records, bosses, run modifiers            (key orbitlost.save.v1)
 *   2  + pilot profile, lifetime statistics, unified achievements (the old milestone list is
 *      folded in), ship modules, cosmetic inventory and loadout, shop state, star-system log
 *                                                (key orbitlost.save.v2)
 *
 * Rules this file keeps:
 *   - A save from any earlier version is migrated, never discarded. The old document is left
 *     untouched under its own key, so a migration can always be re-run.
 *   - Everything read from storage is validated field by field; a missing or damaged field falls
 *     back to its default without taking the rest of the save with it.
 *   - A document that cannot be parsed at all is copied aside (orbitlost.save.corrupt) before a
 *     fresh save is started, so nothing is silently destroyed.
 *   - Credits are never negative, counters are never NaN, ids that no longer exist are dropped.
 */
import { emptyLog, sanitizeLog } from '../progression/discovery';
import type { DiscoveryLog } from '../progression/discovery';
import { ACHIEVEMENT_IDS } from '../progression/achievements';
import { emptyStats, sanitizeStats } from '../progression/stats';
import type { LifetimeStats } from '../progression/stats';
import { XP } from '../progression/level';
import type { MissionKind, PermanentId, Rank, RunModifierId, UpgradeId } from './types';
import { BASE_UNLOCKED, PERMANENT_COSTS, UPGRADE_ORDER } from './upgrades';
import { MISSIONS, MISSION_ORDER } from './missions/catalog';
import { MODIFIER_IDS } from './modifiers';
import { MODULE_BAYS, MODULE_IDS, MODULE_MAX, SYNERGIES, emptyModuleLevels } from './modules';
import type { ModuleId, SynergyId } from './modules';
import { CASES } from './cosmetics/cases';
import type { CaseId } from './cosmetics/cases';
import { DEFAULT_LOADOUT, SLOTS, STARTER_IDS, cosmetic } from './cosmetics/catalog';
import type { Loadout } from './cosmetics/catalog';

/** Lifetime record of one mission type. */
export interface MissionRecord {
  completed: number;
  best: Rank;
}

const RANK_ORDER: Rank[] = ['-', 'C', 'B', 'A', 'S'];

/** The better of two ranks. */
export function betterRank(a: Rank, b: Rank): Rank {
  return RANK_ORDER.indexOf(a) >= RANK_ORDER.indexOf(b) ? a : b;
}

export interface Settings {
  masterVolume: number;
  muted: boolean;
  sfx: boolean;
  ambience: boolean;
  screenShake: boolean;
  reducedEffects: boolean;
  sensitivity: number;
  autoPause: boolean;
  touchControls: 'auto' | 'on' | 'off';
}

export interface Records {
  highestLevel: number;
  bestTime: number;
  bestScore: number;
  totalRuns: number;
  lifetimeEnergy: number;
  lifetimeTime: number;
  asteroidsAvoided: number;
  asteroidsDestroyed: number;
  /** Shards recovered over all runs (unlocks advanced ship parts). */
  shards: number;
  missionsCompleted: number;
}

export interface Profile {
  name: string;
  /** ISO date the profile was created (or first migrated). */
  createdAt: string;
  /** Lifetime experience; the pilot level is derived from it. */
  xp: number;
}

export interface OwnedItem {
  /** ISO date acquired. */
  at: string;
  /** Where it came from: starter, shop, case:<id>, achievement:<id>, level:<n>. */
  source: string;
  /** Not yet looked at in the hangar. */
  fresh: boolean;
}

export interface Inventory {
  owned: Record<string, OwnedItem>;
  equipped: Loadout;
}

export interface ModuleState {
  levels: Record<ModuleId, number>;
  /** Modules fitted to the ship's bays, in order. */
  equipped: ModuleId[];
  /** Synergies the pilot has discovered by fitting both halves. */
  synergies: SynergyId[];
}

export interface ShopState {
  /** Cases opened, per case. */
  opened: Partial<Record<CaseId, number>>;
  /** Opens since the last reward at or above each case's guaranteed rarity. */
  pity: Partial<Record<CaseId, number>>;
}

export const SAVE_VERSION = 2;

export interface SaveData {
  version: 2;
  records: Records;
  credits: number;
  permanent: Record<PermanentId, number>;
  unlocked: UpgradeId[];
  settings: Settings;
  /** Discovery log: catalogued objects and systems, environments met, lifetime sectors. */
  journey: DiscoveryLog;
  /** Unlocked achievements (journey milestones included): id -> ISO date ('' = before dates were kept). */
  achievements: Record<string, string>;
  /** Best rank and completions per mission type (only types that have been played). */
  missions: Partial<Record<MissionKind, MissionRecord>>;
  /** Major encounters ever defeated. */
  bosses: MissionKind[];
  /** Difficulty modifiers selected for the next run. */
  runModifiers: RunModifierId[];
  profile: Profile;
  stats: LifetimeStats;
  modules: ModuleState;
  inventory: Inventory;
  shop: ShopState;
}

export const SAVE_KEY = 'orbitlost.save.v2';
export const LEGACY_KEY = 'orbitlost.save.v1';
export const CORRUPT_KEY = 'orbitlost.save.corrupt';

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.7,
  muted: false,
  sfx: true,
  ambience: true,
  screenShake: true,
  reducedEffects: false,
  sensitivity: 1,
  autoPause: true,
  touchControls: 'auto',
};

function starterInventory(at: string): Inventory {
  const owned: Record<string, OwnedItem> = {};
  for (const id of STARTER_IDS) owned[id] = { at, source: 'starter', fresh: false };
  return { owned, equipped: { ...DEFAULT_LOADOUT } };
}

export function defaultSave(now = ''): SaveData {
  return {
    version: 2,
    records: {
      highestLevel: 0,
      bestTime: 0,
      bestScore: 0,
      totalRuns: 0,
      lifetimeEnergy: 0,
      lifetimeTime: 0,
      asteroidsAvoided: 0,
      asteroidsDestroyed: 0,
      shards: 0,
      missionsCompleted: 0,
    },
    credits: 0,
    permanent: { thrusters: 0, hull: 0, collector: 0, shields: 0, reactor: 0, tanks: 0, tractor: 0, heatshield: 0, gyro: 0, phase: 0 },
    unlocked: [...BASE_UNLOCKED],
    settings: { ...DEFAULT_SETTINGS },
    journey: emptyLog(),
    achievements: {},
    missions: {},
    bosses: [],
    runModifiers: [],
    profile: { name: 'PILOT', createdAt: now, xp: 0 },
    stats: emptyStats(),
    modules: { levels: emptyModuleLevels(), equipped: [], synergies: [] },
    inventory: starterInventory(now),
    shop: { opened: {}, pity: {} },
  };
}

const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const isoOr = (v: unknown, fallback: string): string => (typeof v === 'string' && (v === '' || !Number.isNaN(Date.parse(v))) ? v : fallback);

/** Version of a raw document: 2 when it says so, otherwise it is treated as the original format. */
export function saveVersionOf(raw: unknown): number {
  const v = raw && typeof raw === 'object' ? (raw as { version?: unknown }).version : undefined;
  return v === 2 ? 2 : 1;
}

/**
 * Validate a raw document of any known version into a current save. For a version-1 document the
 * parts that did not exist yet are derived from what it does record (see `migrateV1`).
 */
export function sanitizeSave(raw: unknown, now = ''): SaveData {
  const d = defaultSave(now);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const version = saveVersionOf(raw);

  // ---- fields shared by every version
  const rec = (r.records ?? {}) as Partial<Records>;
  for (const k of Object.keys(d.records) as (keyof Records)[]) d.records[k] = num(rec[k], 0, 0);
  d.credits = Math.floor(num(r.credits, 0, 0));
  const perm = (r.permanent ?? {}) as Partial<Record<PermanentId, number>>;
  for (const k of Object.keys(d.permanent) as PermanentId[]) d.permanent[k] = Math.floor(num(perm[k], 0, 0, 5));
  if (Array.isArray(r.unlocked)) {
    const set = new Set<UpgradeId>(BASE_UNLOCKED);
    for (const u of r.unlocked) if ((UPGRADE_ORDER as string[]).includes(u as string)) set.add(u as UpgradeId);
    d.unlocked = UPGRADE_ORDER.filter((u) => set.has(u));
  }
  const s = (r.settings ?? {}) as Partial<Settings>;
  d.settings = {
    masterVolume: num(s.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 1),
    muted: bool(s.muted, DEFAULT_SETTINGS.muted),
    sfx: bool(s.sfx, DEFAULT_SETTINGS.sfx),
    ambience: bool(s.ambience, DEFAULT_SETTINGS.ambience),
    screenShake: bool(s.screenShake, DEFAULT_SETTINGS.screenShake),
    reducedEffects: bool(s.reducedEffects, DEFAULT_SETTINGS.reducedEffects),
    sensitivity: num(s.sensitivity, DEFAULT_SETTINGS.sensitivity, 0.5, 1.5),
    autoPause: bool(s.autoPause, DEFAULT_SETTINGS.autoPause),
    touchControls: s.touchControls === 'on' || s.touchControls === 'off' ? s.touchControls : 'auto',
  };
  d.journey = sanitizeLog(r.journey);
  const missions = (r.missions ?? {}) as Record<string, Partial<MissionRecord> | null>;
  for (const k of MISSION_ORDER) {
    const m = missions && typeof missions === 'object' ? missions[k] : null;
    if (!m || typeof m !== 'object') continue;
    d.missions[k] = { completed: Math.floor(num(m.completed, 0, 0)), best: RANK_ORDER.includes(m.best as Rank) ? (m.best as Rank) : '-' };
  }
  d.bosses = Array.isArray(r.bosses) ? MISSION_ORDER.filter((k) => MISSIONS[k].boss && (r.bosses as unknown[]).includes(k)) : [];
  d.runModifiers = Array.isArray(r.runModifiers) ? MODIFIER_IDS.filter((k) => (r.runModifiers as unknown[]).includes(k)) : [];

  // ---- achievements: version 2 stores them directly; version 1 stored milestone ids
  if (r.achievements && typeof r.achievements === 'object' && !Array.isArray(r.achievements)) {
    for (const [id, at] of Object.entries(r.achievements as Record<string, unknown>)) if (ACHIEVEMENT_IDS.has(id)) d.achievements[id] = isoOr(at, '');
  }
  if (Array.isArray(r.milestones)) {
    // These were paid when they were completed; recording them here is what stops a second payment.
    for (const id of r.milestones) if (typeof id === 'string' && ACHIEVEMENT_IDS.has(id) && !(id in d.achievements)) d.achievements[id] = '';
  }

  if (version < 2) return migrateV1(d, now);

  // ---- version 2 fields
  const p = (r.profile ?? {}) as Partial<Profile>;
  d.profile = {
    name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 16) : 'PILOT',
    createdAt: isoOr(p.createdAt, now),
    xp: Math.floor(num(p.xp, 0, 0)),
  };
  d.stats = sanitizeStats(r.stats);
  const mod = (r.modules ?? {}) as Partial<ModuleState>;
  const levels = (mod.levels ?? {}) as Partial<Record<ModuleId, number>>;
  for (const id of MODULE_IDS) d.modules.levels[id] = Math.floor(num(levels[id], 0, 0, MODULE_MAX));
  d.modules.equipped = Array.isArray(mod.equipped) ? [...new Set(MODULE_IDS.filter((id) => (mod.equipped as unknown[]).includes(id) && d.modules.levels[id] > 0))].slice(0, MODULE_BAYS) : [];
  d.modules.synergies = Array.isArray(mod.synergies) ? SYNERGIES.map((x) => x.id).filter((id) => (mod.synergies as unknown[]).includes(id)) : [];
  const inv = (r.inventory ?? {}) as Partial<Inventory>;
  if (inv.owned && typeof inv.owned === 'object') {
    for (const [id, item] of Object.entries(inv.owned as Record<string, Partial<OwnedItem> | null>)) {
      if (!cosmetic(id) || !item || typeof item !== 'object') continue; // an item that no longer exists is dropped, not kept as a ghost
      d.inventory.owned[id] = { at: isoOr(item.at, ''), source: typeof item.source === 'string' ? item.source : 'unknown', fresh: bool(item.fresh, false) };
    }
  }
  const eq = (inv.equipped ?? {}) as Partial<Loadout>;
  for (const slot of SLOTS) {
    const id = eq[slot];
    // Only something owned, and only in its own slot, can be fitted.
    if (typeof id === 'string' && cosmetic(id)?.slot === slot && d.inventory.owned[id]) d.inventory.equipped[slot] = id;
  }
  const shop = (r.shop ?? {}) as Partial<ShopState>;
  for (const c of CASES) {
    const opened = Math.floor(num((shop.opened as Record<string, unknown> | undefined)?.[c.id], 0, 0));
    const pity = Math.floor(num((shop.pity as Record<string, unknown> | undefined)?.[c.id], 0, 0, c.pity.after));
    if (opened > 0) d.shop.opened[c.id] = opened;
    if (pity > 0) d.shop.pity[c.id] = pity;
  }
  return d;
}

/**
 * Fill in what a version-1 save could not have: statistics are seeded from the records it kept, so
 * nothing the player did is forgotten, and experience is granted for the missions already flown.
 */
function migrateV1(d: SaveData, now: string): SaveData {
  const s = d.stats;
  const perKind = MISSION_ORDER.reduce((n, k) => n + (d.missions[k]?.completed ?? 0), 0);
  s.missionsCompleted = Math.max(d.records.missionsCompleted, perKind);
  d.records.missionsCompleted = s.missionsCompleted;
  s.missionsAttempted = s.missionsCompleted;
  for (const k of MISSION_ORDER) if (d.missions[k]) s.missionPlays[k] = d.missions[k]?.completed ?? 0;
  s.bossesDefeated = d.bosses.length;
  for (const k of d.bosses) s.bossRecords[k] = { defeats: 1, bestTime: 0, bestRank: d.missions[k]?.best ?? '-', highestTier: 1, flawless: 0 };
  s.sRanks = MISSION_ORDER.filter((k) => d.missions[k]?.best === 'S').length;
  // What was spent on ship parts is known exactly from their levels; what is left is in the balance.
  s.creditsSpent = (Object.values(d.permanent) as number[]).reduce((n, lvl) => n + PERMANENT_COSTS.slice(0, lvl).reduce((a, b) => a + b, 0), 0);
  s.creditsEarned = d.credits + s.creditsSpent;
  d.profile = {
    name: 'PILOT',
    createdAt: now,
    xp: Math.round(s.missionsCompleted * XP.mission + d.bosses.length * XP.boss + Object.keys(d.journey.objects).length * XP.newObject),
  };
  return d;
}

type Listener = () => void;

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): SaveStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Tiny observable store backed by localStorage. Snapshots are immutable (replaced on every update). */
export class SaveStore {
  private data: SaveData;
  private listeners = new Set<Listener>();
  private readonly storage: SaveStorage | null;
  /** True when this session started from a save in an older format. */
  readonly migrated: boolean;

  constructor(storage: SaveStorage | null = defaultStorage()) {
    this.storage = storage;
    const loaded = SaveStore.read(storage);
    this.data = loaded.data;
    this.migrated = loaded.migrated;
    // A migrated save is written out straight away in the new format (the old one stays where it was).
    if (loaded.migrated) this.persist();
  }

  /** Load the current save, migrating an older one or starting fresh. Never throws. */
  static read(storage: SaveStorage | null = defaultStorage(), now = new Date().toISOString()): { data: SaveData; migrated: boolean } {
    if (!storage) return { data: defaultSave(now), migrated: false };
    let current: string | null = null;
    let legacy: string | null = null;
    try {
      current = storage.getItem(SAVE_KEY);
      legacy = storage.getItem(LEGACY_KEY);
    } catch {
      return { data: defaultSave(now), migrated: false };
    }
    if (current) {
      try {
        return { data: sanitizeSave(JSON.parse(current), now), migrated: false };
      } catch {
        // Unreadable: keep a copy before anything can overwrite it, then fall back to the older save if there is one.
        try {
          storage.setItem(CORRUPT_KEY, current);
        } catch {
          // nothing more can be done
        }
      }
    }
    if (legacy) {
      try {
        return { data: sanitizeSave(JSON.parse(legacy), now), migrated: true };
      } catch {
        try {
          storage.setItem(CORRUPT_KEY, legacy);
        } catch {
          // nothing more can be done
        }
      }
    }
    return { data: defaultSave(now), migrated: false };
  }

  static load(): SaveData {
    return SaveStore.read().data;
  }

  private persist(): void {
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage may be full or blocked (private mode). The game keeps working in-memory.
    }
  }

  get = (): SaveData => this.data;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  update(mutator: (draft: SaveData) => void): void {
    const draft: SaveData = JSON.parse(JSON.stringify(this.data));
    mutator(draft);
    // Whatever a caller did, these invariants hold for what gets written.
    if (!Number.isFinite(draft.credits) || draft.credits < 0) draft.credits = Math.max(0, this.data.credits);
    draft.credits = Math.floor(draft.credits);
    this.data = draft;
    this.persist();
    this.listeners.forEach((l) => l());
  }

  updateSettings(patch: Partial<Settings>): void {
    this.update((d) => {
      d.settings = { ...d.settings, ...patch };
    });
  }

  /** Erase progress (settings are kept). The only way progress is ever removed, and only on request. */
  reset(): void {
    const settings = this.data.settings;
    this.data = defaultSave(new Date().toISOString());
    this.data.settings = settings;
    this.persist();
    this.listeners.forEach((l) => l());
  }
}
