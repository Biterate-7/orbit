/**
 * The mission director: decides what each sector of a run is played for.
 *
 * There is no fixed sequence. Every sector is drawn from the whole mission registry
 * (game/missions/catalog.ts) by weighted random choice, shaped by a few rules:
 *
 *   - a mission type cannot come back until its cool-down has passed, and never twice in a row;
 *   - types that have not been seen for a while grow more likely, so a run tours the registry
 *     instead of circling a few favourites;
 *   - rarer types are drawn less often, and only once the run is deep enough for them;
 *   - major encounters arrive after a varying number of sectors (never on a fixed beat), and the
 *     same one never returns twice running;
 *   - sectors can carry twists ("mutators") and come in rare variants, more so the deeper the run.
 *
 * Everything is a pure function of (run seed, sector, what was played before, player experience):
 * the same inputs always give the same mission, so a run can be reproduced from its seed.
 * All probabilities live in DIRECTOR below.
 */
import { BOSSES, MISSIONS, MUTATORS, NORMAL_MISSIONS, survivalTier } from '../game/missions/catalog';
import type { MissionKind, MutatorId, VariantId } from '../game/missions/types';
import { Rng } from '../game/rng';
import { hash32 } from './seed';

export interface MissionPick {
  kind: MissionKind;
  tier: number;
  mutators?: MutatorId[];
  variant?: VariantId;
}

export interface DirectorConfig {
  /** Sector of the first major encounter: uniform in [min, max]. */
  firstBoss: [number, number];
  /** Sectors from one major encounter to the next: uniform in [min, max]. */
  bossGap: [number, number];
  /** Weight multiplier by mission rarity. */
  rarityWeight: Record<'common' | 'uncommon' | 'rare', number>;
  /** Extra weight per sector since a type was last played, up to `recencyCap` sectors. */
  recencyBoost: number;
  recencyCap: number;
  /** Lifetime sectors cleared after which every mission's earliest sector is halved. */
  veteranSectors: number;
  /** Chance of a first twist: base + perSector * sector, capped. */
  mutator: { base: number; perSector: number; cap: number };
  /** Chance of a second twist: perSector * (sector - from), capped. */
  secondMutator: { from: number; perSector: number; cap: number };
  /** Variant chances (elite grows with depth). */
  variant: { eliteFrom: number; elitePerSector: number; eliteCap: number; pristine: number; anomalous: number; from: number };
  /** Sector at which missions reach tier 2 and tier 3, and the sectors per tier after that. */
  tiers: { two: number; three: number; step: number };
}

export const DIRECTOR: DirectorConfig = {
  firstBoss: [4, 7],
  bossGap: [4, 7],
  rarityWeight: { common: 1, uncommon: 0.8, rare: 0.5 },
  recencyBoost: 0.45,
  recencyCap: 10,
  veteranSectors: 20,
  mutator: { base: 0.1, perSector: 0.035, cap: 0.75 },
  secondMutator: { from: 8, perSector: 0.03, cap: 0.4 },
  variant: { eliteFrom: 5, elitePerSector: 0.012, eliteCap: 0.14, pristine: 0.07, anomalous: 0.06, from: 3 },
  tiers: { two: 8, three: 22, step: 15 },
};

/** What the director knows about the player beyond the current run. */
export interface DirectorContext {
  /** Sectors cleared across all runs. */
  experience: number;
}

export const NEW_PLAYER: DirectorContext = { experience: 0 };

const intIn = (rng: Rng, [lo, hi]: [number, number]): number => lo + Math.floor(rng.next() * (hi - lo + 1));

/**
 * The sectors of a run that hold a major encounter, in order, up to `upTo`. Derived from the run
 * seed alone, so it can be computed for any sector without replaying the run.
 */
export function bossSectors(runSeed: number, upTo: number, cfg: DirectorConfig = DIRECTOR): number[] {
  const rng = new Rng(hash32(runSeed, 0xb055));
  const out: number[] = [];
  let at = intIn(rng, cfg.firstBoss);
  while (at <= upTo) {
    out.push(at);
    at += intIn(rng, cfg.bossGap);
  }
  return out;
}

export function isBossSector(runSeed: number, index: number, cfg: DirectorConfig = DIRECTOR): boolean {
  return bossSectors(runSeed, index, cfg).includes(index);
}

/** Sectors until the next major encounter (0 = this one). */
export function sectorsToBoss(runSeed: number, index: number, cfg: DirectorConfig = DIRECTOR): number {
  const next = bossSectors(runSeed, index + cfg.bossGap[1] + cfg.firstBoss[1], cfg).find((s) => s >= index);
  return next === undefined ? cfg.bossGap[1] : next - index;
}

/** Difficulty tier of an ordinary mission at a sector. */
export function tierAt(index: number, cfg: DirectorConfig = DIRECTOR): number {
  if (index < cfg.tiers.two) return 1;
  if (index < cfg.tiers.three) return 2;
  return 3 + Math.floor((index - cfg.tiers.three) / cfg.tiers.step);
}

export function tierFor(kind: MissionKind, index: number, recent: readonly MissionKind[] = [], cfg: DirectorConfig = DIRECTOR): number {
  if (kind === 'survival') return survivalTier(index);
  // A major encounter comes back stronger each time it has already been beaten or met in this run.
  if (MISSIONS[kind].boss) return 1 + recent.filter((k) => k === kind).length;
  return tierAt(index, cfg);
}

/** Earliest sector a mission can appear in, given how much the player has flown. */
export function earliestSector(kind: MissionKind, ctx: DirectorContext, cfg: DirectorConfig = DIRECTOR): number {
  const base = MISSIONS[kind].minSector;
  return ctx.experience >= cfg.veteranSectors ? Math.max(1, Math.ceil(base / 2)) : base;
}

/** The missions that may be drawn for a sector, with their weights. Exposed for tests and the survey script. */
export function candidates(index: number, recent: readonly MissionKind[], ctx: DirectorContext = NEW_PLAYER, cfg: DirectorConfig = DIRECTOR): { kind: MissionKind; weight: number }[] {
  const prev = recent[recent.length - 1];
  const firstEver = ctx.experience === 0 && index <= 1;
  const eligible = (strict: boolean): MissionKind[] =>
    NORMAL_MISSIONS.filter((k) => {
      const info = MISSIONS[k];
      if (k === prev) return false;
      if (firstEver && !info.gentle) return false;
      if (index < earliestSector(k, ctx, cfg)) return false;
      if (strict && info.cooldown > 0 && recent.slice(-info.cooldown).includes(k)) return false;
      return true;
    });
  let pool = eligible(true);
  // Cool-downs can never leave a sector with nothing to fly.
  if (pool.length < 2) pool = eligible(false);
  return pool.map((kind) => {
    const info = MISSIONS[kind];
    const last = recent.lastIndexOf(kind);
    const since = last < 0 ? cfg.recencyCap : Math.min(cfg.recencyCap, recent.length - last);
    return { kind, weight: info.weight * cfg.rarityWeight[info.rarity] * (1 + cfg.recencyBoost * since) };
  });
}

function pickBoss(rng: Rng, recent: readonly MissionKind[]): MissionKind {
  const faced = recent.filter((k) => MISSIONS[k].boss);
  const last = faced[faced.length - 1];
  const pool = BOSSES.filter((k) => k !== last);
  // Encounters not yet met in this run are twice as likely as returning ones.
  return rng.weighted(pool, pool.map((k) => MISSIONS[k].weight * (faced.includes(k) ? 1 : 2)));
}

function pickVariant(rng: Rng, index: number, cfg: DirectorConfig): VariantId {
  if (index < cfg.variant.from) return 'standard';
  const elite = Math.min(cfg.variant.eliteCap, Math.max(0, (index - cfg.variant.eliteFrom) * cfg.variant.elitePerSector));
  const r = rng.next();
  if (r < elite) return 'elite';
  if (r < elite + cfg.variant.pristine) return 'pristine';
  if (r < elite + cfg.variant.pristine + cfg.variant.anomalous) return 'anomalous';
  return 'standard';
}

function pickMutators(rng: Rng, kind: MissionKind, index: number, variant: VariantId, cfg: DirectorConfig): MutatorId[] {
  const pool = MISSIONS[kind].mutators.filter((m) => MUTATORS[m].minSector <= index);
  let n = 0;
  if (rng.next() < Math.min(cfg.mutator.cap, cfg.mutator.base + cfg.mutator.perSector * index)) n++;
  if (n > 0 && rng.next() < Math.min(cfg.secondMutator.cap, Math.max(0, (index - cfg.secondMutator.from) * cfg.secondMutator.perSector))) n++;
  if (variant === 'anomalous') n++;
  const out: MutatorId[] = [];
  const left = [...pool];
  while (out.length < n && left.length > 0) {
    const m = rng.pick(left);
    left.splice(left.indexOf(m), 1);
    out.push(m);
  }
  // Canonical order keeps sector codes stable.
  return out.sort();
}

/**
 * The mission of a sector.
 * `recent` = mission kinds of the sectors already played in this run, oldest first.
 */
export function missionForSector(
  runSeed: number,
  index: number,
  recent: readonly MissionKind[] = [],
  ctx: DirectorContext = NEW_PLAYER,
  cfg: DirectorConfig = DIRECTOR,
): MissionPick {
  const rng = new Rng(hash32(runSeed, index, 0x31551));
  if (isBossSector(runSeed, index, cfg)) {
    const kind = pickBoss(rng, recent);
    return { kind, tier: tierFor(kind, index, recent, cfg), mutators: [], variant: 'standard' };
  }
  const pool = candidates(index, recent, ctx, cfg);
  const kind = rng.weighted(
    pool.map((p) => p.kind),
    pool.map((p) => p.weight),
  );
  // A first-ever sector is always plain: one new thing at a time.
  const plain = ctx.experience === 0 && index <= 2;
  const variant = plain ? 'standard' : pickVariant(rng, index, cfg);
  const mutators = plain ? [] : pickMutators(rng, kind, index, variant, cfg);
  const tier = tierFor(kind, index, recent, cfg) + (variant === 'elite' && kind !== 'survival' ? 1 : 0);
  return { kind, tier, mutators, variant };
}

/** Lay a whole run's missions out in advance (for tests, the survey script and the mission board). */
export function previewRun(runSeed: number, sectors: number, ctx: DirectorContext = NEW_PLAYER, cfg: DirectorConfig = DIRECTOR): MissionPick[] {
  const out: MissionPick[] = [];
  const recent: MissionKind[] = [];
  for (let i = 1; i <= sectors; i++) {
    const pick = missionForSector(runSeed, i, recent, ctx, cfg);
    out.push(pick);
    recent.push(pick.kind);
  }
  return out;
}
