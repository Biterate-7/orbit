import { emptyLog, sanitizeLog } from '../progression/discovery';
import type { DiscoveryLog } from '../progression/discovery';
import { MILESTONES } from '../progression/milestones';
import type { MissionKind, PermanentId, Rank, RunModifierId, UpgradeId } from './types';
import { BASE_UNLOCKED, UPGRADE_ORDER } from './upgrades';
import { MISSION_ORDER } from './missions/catalog';
import { MODIFIER_IDS } from './modifiers';

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

export interface SaveData {
  version: 1;
  records: Records;
  credits: number;
  permanent: Record<PermanentId, number>;
  unlocked: UpgradeId[];
  settings: Settings;
  /** Discovery log: catalogued objects, environments met, lifetime sectors. */
  journey: DiscoveryLog;
  /** Ids of completed milestones. */
  milestones: string[];
  /** Best rank and completions per mission type (only types that have been played). */
  missions: Partial<Record<MissionKind, MissionRecord>>;
  /** Major encounters ever defeated. */
  bosses: MissionKind[];
  /** Difficulty modifiers selected for the next run. */
  runModifiers: RunModifierId[];
}

const KEY = 'orbitlost.save.v1';

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

export function defaultSave(): SaveData {
  return {
    version: 1,
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
    milestones: [],
    missions: {},
    bosses: [],
    runModifiers: [],
  };
}

const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Defensive parse: tolerate missing / corrupt fields from older or edited saves. */
function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  const rec = (r.records ?? {}) as Partial<Records>;
  for (const k of Object.keys(d.records) as (keyof Records)[]) d.records[k] = num(rec[k], 0, 0);
  d.credits = Math.floor(num(r.credits, 0, 0));
  const perm = (r.permanent ?? {}) as Partial<Record<PermanentId, number>>;
  for (const k of Object.keys(d.permanent) as PermanentId[]) d.permanent[k] = Math.floor(num(perm[k], 0, 0, 5));
  if (Array.isArray(r.unlocked)) {
    const set = new Set<UpgradeId>(BASE_UNLOCKED);
    for (const u of r.unlocked) if ((UPGRADE_ORDER as string[]).includes(u)) set.add(u);
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
  // Saves from before the discovery system simply start with an empty log.
  d.journey = sanitizeLog(r.journey);
  const known = new Set(MILESTONES.map((m) => m.id));
  d.milestones = Array.isArray(r.milestones) ? [...new Set(r.milestones.filter((m): m is string => typeof m === 'string' && known.has(m)))] : [];
  // Mission records (absent in saves from before missions existed).
  const missions = (r.missions ?? {}) as Record<string, Partial<MissionRecord> | null>;
  for (const k of MISSION_ORDER) {
    const m = missions && typeof missions === 'object' ? missions[k] : null;
    if (!m || typeof m !== 'object') continue;
    d.missions[k] = { completed: Math.floor(num(m.completed, 0, 0)), best: RANK_ORDER.includes(m.best as Rank) ? (m.best as Rank) : '-' };
  }
  d.bosses = Array.isArray(r.bosses) ? MISSION_ORDER.filter((k) => (r.bosses as unknown[]).includes(k)) : [];
  d.runModifiers = Array.isArray(r.runModifiers) ? MODIFIER_IDS.filter((k) => (r.runModifiers as unknown[]).includes(k)) : [];
  return d;
}

type Listener = () => void;

/** Tiny observable store backed by localStorage. Snapshots are immutable (replaced on every update). */
export class SaveStore {
  private data: SaveData;
  private listeners = new Set<Listener>();

  constructor() {
    this.data = SaveStore.load();
  }

  static load(): SaveData {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return defaultSave();
      return sanitize(JSON.parse(raw));
    } catch {
      return defaultSave();
    }
  }

  private persist(): void {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
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
    this.data = draft;
    this.persist();
    this.listeners.forEach((l) => l());
  }

  updateSettings(patch: Partial<Settings>): void {
    this.update((d) => {
      d.settings = { ...d.settings, ...patch };
    });
  }

  reset(): void {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.persist();
    this.listeners.forEach((l) => l());
  }
}
