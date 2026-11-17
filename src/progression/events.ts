/**
 * The progression core: every change to the pilot's lasting state goes through `applyEvent`.
 *
 * Gameplay and menus do not edit the save themselves. They describe what happened as a GameEvent
 * ("a sector was entered", "a mission ended", "a case was opened") and this reducer is the single
 * place that turns it into statistics, credits, experience, inventory and achievements. That is
 * what keeps the systems honest with each other:
 *
 *   - a reward is paid in exactly one place, so it cannot be paid twice;
 *   - credits can only go down through `spend`, which refuses to go below zero;
 *   - after every event the achievement list is re-evaluated until nothing new unlocks, and an
 *     achievement is recorded before its reward is paid, so it can never unlock twice.
 *
 * `applyEvent` mutates the draft it is given and returns an Outcome describing what changed, which
 * the UI uses for toasts and reveal screens. It has no other side effects, so it is fully testable.
 */
import { CASES, meetsPity, rollCase } from '../game/cosmetics/cases';
import type { CaseId, CaseRoll } from '../game/cosmetics/cases';
import { COSMETICS, cosmetic } from '../game/cosmetics/catalog';
import type { CosmeticSlot } from '../game/cosmetics/catalog';
import { MISSIONS } from '../game/missions/catalog';
import type { MissionDebrief, MissionKind } from '../game/missions/types';
import { MODULES, MODULE_COSTS, MODULE_MAX, activeSynergies, baysOpen, moduleUnlocked } from '../game/modules';
import type { ModuleId, ModuleProgress, SynergyId } from '../game/modules';
import { betterRank } from '../game/persistence';
import type { SaveData } from '../game/persistence';
import type { LevelIdentity, PermanentId, UpgradeId } from '../game/types';
import { PERMANENTS, PERMANENT_COSTS, PERMANENT_MAX, UPGRADES, UPGRADE_ORDER, partUnlocked } from '../game/upgrades';
import { achievementCosmetics, pendingAchievements } from './achievements';
import type { AchievementDef } from './achievements';
import { recordVisit } from './discovery';
import { XP, levelFor, levelReward } from './level';
import { deriveStats } from './stats';

/** Credit values of the things that are not a mission payout. One table, so the economy can be tuned. */
export const REWARDS = {
  newObject: 5,
  newSystem: 15,
  newPlanet: 2,
  rareEncounter: 10,
  /** Credits per unit of energy banked at the end of a run. */
  energy: 0.5,
  /** One credit per this much final score. */
  scorePerCredit: 2000,
  /** Practice sectors pay this fraction. */
  practice: 0.5,
};

export type GameEvent =
  | { type: 'sector_enter'; index: number; identity: LevelIdentity; kind: MissionKind; practice: boolean; modules: ModuleId[]; hull: string }
  | { type: 'sector_end'; debrief: MissionDebrief; practice: boolean; distance: number; binary: boolean }
  | {
      type: 'run_end';
      level: number;
      time: number;
      score: number;
      energy: number;
      avoided: number;
      destroyed: number;
      nearMisses: number;
      sectorsCleared: number;
      practice: boolean;
      creditMul: number;
      /** Credits already paid during the run (missions, discoveries), for the best-run record. */
      earnedInRun: number;
    }
  | { type: 'buy_permanent'; id: PermanentId }
  | { type: 'buy_module'; id: ModuleId }
  | { type: 'equip_module'; id: ModuleId; on: boolean }
  | { type: 'buy_cosmetic'; id: string }
  | { type: 'equip_cosmetic'; slot: CosmeticSlot; id: string }
  | { type: 'open_case'; caseId: CaseId; random: () => number }
  | { type: 'mark_seen'; ids: string[] }
  | { type: 'rename'; name: string }
  | { type: 'live_import'; added: number }
  /** Re-evaluate achievements and levels without anything else happening (first load, after a migration). */
  | { type: 'settle' };

export interface Outcome {
  /** False when a purchase or change was refused (not enough credits, locked, invalid). */
  ok: boolean;
  /** Why it was refused, for the UI. */
  reason: string;
  /** Net credits gained by this event (rewards minus nothing: spending is reported in `spent`). */
  credits: number;
  spent: number;
  xp: number;
  /** Reward lines worth telling the player about ("NEW SYSTEM +15 CR"). */
  notes: string[];
  achievements: AchievementDef[];
  /** Pilot levels reached. */
  levels: number[];
  /** Cosmetic ids granted (by achievements, levels or a case). */
  cosmetics: string[];
  synergies: SynergyId[];
  /** In-run upgrade modules unlocked by a run's records. */
  upgrades: UpgradeId[];
  /** Ship parts that became available to buy. */
  parts: string[];
  /** Whether this sector's object or system was new to the pilot. */
  discovery: { object: boolean; system: boolean; planets: number };
  roll: CaseRoll | null;
}

function blank(): Outcome {
  return { ok: true, reason: '', credits: 0, spent: 0, xp: 0, notes: [], achievements: [], levels: [], cosmetics: [], synergies: [], upgrades: [], parts: [], discovery: { object: false, system: false, planets: 0 }, roll: null };
}

function refuse(out: Outcome, reason: string): Outcome {
  out.ok = false;
  out.reason = reason;
  return out;
}

function earn(d: SaveData, out: Outcome, amount: number): void {
  const n = Math.max(0, Math.round(amount));
  if (n === 0) return;
  d.credits += n;
  d.stats.creditsEarned += n;
  out.credits += n;
}

/** The only way credits leave the account. Returns false (and changes nothing) if they are not there. */
export function spend(d: SaveData, out: Outcome, amount: number): boolean {
  const n = Math.max(0, Math.round(amount));
  if (!Number.isFinite(n) || d.credits < n) return false;
  d.credits -= n;
  d.stats.creditsSpent += n;
  out.spent += n;
  return true;
}

function gainXp(d: SaveData, out: Outcome, amount: number): void {
  const n = Math.max(0, Math.round(amount));
  d.profile.xp += n;
  out.xp += n;
}

/** Add a cosmetic to the inventory. Owning it already is a no-op, so a grant can never duplicate. */
export function grantCosmetic(d: SaveData, out: Outcome, id: string, source: string, now: string): boolean {
  if (!cosmetic(id) || d.inventory.owned[id]) return false;
  d.inventory.owned[id] = { at: now, source, fresh: true };
  out.cosmetics.push(id);
  return true;
}

export function moduleProgress(d: SaveData): ModuleProgress {
  const derived = deriveStats(d);
  return {
    sectorsCleared: d.journey.sectorsCleared,
    missionsCompleted: d.stats.missionsCompleted,
    bossesDefeated: Math.max(d.stats.bossesDefeated, d.bosses.length),
    systemsDiscovered: derived.systemsDiscovered,
    objectsDiscovered: derived.objectsDiscovered,
    rocksMined: d.stats.asteroidsCollected,
    wormholeTransits: d.stats.wormholeTransits,
    escortsCompleted: d.stats.escortsCompleted,
    binaryMissions: d.stats.binaryMissions,
    gravityAssists: d.stats.gravityAssists,
    pilotLevel: levelFor(d.profile.xp),
  };
}

/**
 * Unlock whatever the new state has earned: achievements, then the levels their experience may
 * reach, then the achievements those levels may complete - repeated until nothing changes.
 */
function settle(d: SaveData, out: Outcome, now: string, levelBefore: number): void {
  let level = levelBefore;
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const a of pendingAchievements(d)) {
      // Recorded first: whatever happens next, this achievement cannot be paid again.
      d.achievements[a.id] = now;
      earn(d, out, a.reward);
      gainXp(d, out, a.reward * XP.perAchievementCredit);
      for (const id of achievementCosmetics(a.id)) grantCosmetic(d, out, id, `achievement:${a.id}`, now);
      out.achievements.push(a);
      changed = true;
    }
    const reached = levelFor(d.profile.xp);
    while (level < reached) {
      level++;
      earn(d, out, levelReward(level));
      for (const c of COSMETICS) if (c.obtain.kind === 'level' && c.obtain.level === level) grantCosmetic(d, out, c.id, `level:${level}`, now);
      out.levels.push(level);
      changed = true;
    }
    if (!changed) break;
  }
}

function onSectorEnter(d: SaveData, out: Outcome, e: Extract<GameEvent, { type: 'sector_enter' }>, now: string): void {
  const id = e.identity;
  const objectsBefore = Object.keys(d.journey.objects).length;
  const systemsBefore = Object.keys(d.journey.systems).length;
  const planetsBefore = d.journey.planets.length;
  const rareBefore = d.journey.environments.includes(id.environment);
  recordVisit(d.journey, id, e.index, now);
  const newObject = Object.keys(d.journey.objects).length > objectsBefore;
  const newSystem = Object.keys(d.journey.systems).length > systemsBefore;
  const newPlanets = d.journey.planets.length - planetsBefore;
  out.discovery = { object: newObject, system: newSystem, planets: newPlanets };
  if (newObject) {
    earn(d, out, REWARDS.newObject);
    gainXp(d, out, XP.newObject);
    out.notes.push(`NEW OBJECT CATALOGUED  +${REWARDS.newObject} CR`);
  }
  if (newSystem) {
    earn(d, out, REWARDS.newSystem);
    gainXp(d, out, XP.newSystem);
    out.notes.push(`NEW SYSTEM DISCOVERED  +${REWARDS.newSystem} CR`);
  }
  if (newPlanets > 0) {
    earn(d, out, REWARDS.newPlanet * newPlanets);
    gainXp(d, out, XP.planet * newPlanets);
  }
  // A rare environment met for the first time is a rare discovery.
  if ((id.rarity === 'rare' || id.rarity === 'legendary') && !rareBefore) {
    d.stats.rareDiscoveries++;
    earn(d, out, REWARDS.rareEncounter);
    gainXp(d, out, XP.rare);
    out.notes.push(`RARE DISCOVERY  +${REWARDS.rareEncounter} CR`);
  }
  d.stats.missionsAttempted++;
  d.stats.missionPlays[e.kind] = (d.stats.missionPlays[e.kind] ?? 0) + 1;
  for (const m of new Set(e.modules)) d.stats.moduleUse[m] = (d.stats.moduleUse[m] ?? 0) + 1;
  if (cosmetic(e.hull)?.slot === 'hull') d.stats.hullUse[e.hull] = (d.stats.hullUse[e.hull] ?? 0) + 1;
}

function onSectorEnd(d: SaveData, out: Outcome, e: Extract<GameEvent, { type: 'sector_end' }>): void {
  const r = e.debrief;
  const s = d.stats;
  const partsBefore = { shards: d.records.shards, bosses: [...d.bosses] };
  d.records.shards += r.shards;
  s.distance += Math.max(0, e.distance);
  // Tallies count whatever was actually done, whether or not the mission was then completed.
  s.asteroidsCollected += r.tally.mined;
  s.signalsFound += r.tally.signals;
  s.cachesFound += r.tally.caches;
  s.wormholeTransits += r.tally.transits;
  s.gravityAssists += r.tally.assists;
  s.rareDiscoveries += r.tally.signals;
  for (const name of r.tally.surveyed) {
    if (!d.journey.planets.includes(name)) {
      d.journey.planets.push(name);
      gainXp(d, out, XP.planet);
    }
  }
  if (r.tally.signals > 0) gainXp(d, out, XP.signal * r.tally.signals);
  if (r.tally.caches > 0) gainXp(d, out, XP.cache * r.tally.caches);

  if (r.success) {
    d.records.missionsCompleted += 1;
    s.missionsCompleted += 1;
    const rec = d.missions[r.kind] ?? { completed: 0, best: '-' as const };
    d.missions[r.kind] = { completed: rec.completed + 1, best: betterRank(rec.best, r.rank) };
    if (r.rank === 'S') s.sRanks++;
    if (r.damage <= 0) s.flawless++;
    if (r.variant === 'elite') s.eliteCleared++;
    if (r.mutators.length >= 2) s.twistedCleared++;
    if (r.kind === 'escort') s.escortsCompleted++;
    if (e.binary) s.binaryMissions++;
    if (r.bonuses.some((b) => b.done && b.feat)) s.feats[r.kind] = (s.feats[r.kind] ?? 0) + 1;
    if (r.boss) {
      s.bossesDefeated++;
      if (!d.bosses.includes(r.kind)) d.bosses.push(r.kind);
      const b = s.bossRecords[r.kind] ?? { defeats: 0, bestTime: 0, bestRank: '-' as const, highestTier: 0, flawless: 0 };
      s.bossRecords[r.kind] = {
        defeats: b.defeats + 1,
        bestTime: b.bestTime > 0 ? Math.min(b.bestTime, r.time) : r.time,
        bestRank: betterRank(b.bestRank, r.rank),
        highestTier: Math.max(b.highestTier, r.tier),
        flawless: b.flawless + (r.damage <= 0 ? 1 : 0),
      };
    }
    gainXp(d, out, (r.boss ? XP.boss : XP.mission) * Math.max(0.6, r.reward));
  } else {
    s.missionsFailed++;
    gainXp(d, out, XP.missionFailed);
  }
  earn(d, out, r.credits * (e.practice ? REWARDS.practice : 1));
  const partsAfter = { shards: d.records.shards, bosses: d.bosses };
  for (const p of PERMANENTS) if (!partUnlocked(p, partsBefore) && partUnlocked(p, partsAfter)) out.parts.push(p.name);
}

function onRunEnd(d: SaveData, out: Outcome, e: Extract<GameEvent, { type: 'run_end' }>): void {
  const rec = d.records;
  if (!e.practice) {
    rec.bestScore = Math.max(rec.bestScore, e.score);
    rec.bestTime = Math.max(rec.bestTime, e.time);
    rec.highestLevel = Math.max(rec.highestLevel, e.level);
    d.stats.bestRunSectors = Math.max(d.stats.bestRunSectors, e.sectorsCleared);
    d.stats.bestNearMisses = Math.max(d.stats.bestNearMisses, e.nearMisses);
  }
  rec.totalRuns += 1;
  rec.lifetimeEnergy += e.energy;
  rec.lifetimeTime += e.time;
  rec.asteroidsAvoided += e.avoided;
  rec.asteroidsDestroyed += e.destroyed;
  d.journey.sectorsCleared += e.sectorsCleared;
  const banked = (e.energy * REWARDS.energy + Math.floor(e.score / REWARDS.scorePerCredit)) * e.creditMul * (e.practice ? REWARDS.practice : 1);
  earn(d, out, banked);
  if (!e.practice) d.stats.bestRunCredits = Math.max(d.stats.bestRunCredits, Math.round(e.earnedInRun + out.credits));
  const have = new Set(d.unlocked);
  for (const id of UPGRADE_ORDER) {
    const u = UPGRADES[id].unlock;
    if (!u || have.has(id)) continue;
    if (u.kind === 'level' ? rec.highestLevel >= u.value : rec.lifetimeEnergy >= u.value) out.upgrades.push(id);
  }
  d.unlocked = UPGRADE_ORDER.filter((id) => have.has(id) || out.upgrades.includes(id));
}

function onOpenCase(d: SaveData, out: Outcome, e: Extract<GameEvent, { type: 'open_case' }>, now: string): Outcome {
  const def = CASES.find((c) => c.id === e.caseId);
  if (!def) return refuse(out, 'Unknown case.');
  if (d.credits < def.price) return refuse(out, 'Not enough credits.');
  const owned = new Set(Object.keys(d.inventory.owned));
  // Roll before paying: if the roll cannot produce an item (an empty pool), nothing is charged.
  const roll = rollCase(def, owned, d.shop.pity[def.id] ?? 0, e.random);
  if (!roll.item) return refuse(out, 'This case is empty.');
  if (!spend(d, out, def.price)) return refuse(out, 'Not enough credits.');
  d.shop.opened[def.id] = (d.shop.opened[def.id] ?? 0) + 1;
  d.shop.pity[def.id] = meetsPity(def, roll.rarity) ? 0 : (d.shop.pity[def.id] ?? 0) + 1;
  d.stats.casesOpened++;
  if (roll.duplicate) {
    d.stats.duplicatesConverted++;
    earn(d, out, roll.refund);
  } else {
    grantCosmetic(d, out, roll.item.id, `case:${def.id}`, now);
  }
  out.roll = roll;
  return out;
}

/** Apply one event to a save draft. See the header for the guarantees this function provides. */
export function applyEvent(d: SaveData, e: GameEvent, now: string): Outcome {
  const out = blank();
  const levelBefore = levelFor(d.profile.xp);
  switch (e.type) {
    case 'sector_enter':
      onSectorEnter(d, out, e, now);
      break;
    case 'sector_end':
      onSectorEnd(d, out, e);
      break;
    case 'run_end':
      onRunEnd(d, out, e);
      break;
    case 'buy_permanent': {
      const def = PERMANENTS.find((p) => p.id === e.id);
      const lvl = d.permanent[e.id];
      if (!def || lvl === undefined) return refuse(out, 'Unknown part.');
      if (lvl >= PERMANENT_MAX) return refuse(out, 'Already at maximum.');
      if (!partUnlocked(def, { shards: d.records.shards, bosses: d.bosses })) return refuse(out, 'Not unlocked yet.');
      if (!spend(d, out, PERMANENT_COSTS[lvl])) return refuse(out, 'Not enough credits.');
      d.permanent[e.id] = lvl + 1;
      break;
    }
    case 'buy_module': {
      const lvl = d.modules.levels[e.id];
      if (!MODULES[e.id] || lvl === undefined) return refuse(out, 'Unknown module.');
      if (lvl >= MODULE_MAX) return refuse(out, 'Already at maximum.');
      if (!moduleUnlocked(e.id, moduleProgress(d))) return refuse(out, 'Not unlocked yet.');
      if (!spend(d, out, MODULE_COSTS[lvl])) return refuse(out, 'Not enough credits.');
      d.modules.levels[e.id] = lvl + 1;
      // A first purchase goes straight into a free bay, so it does something immediately.
      if (lvl === 0 && d.modules.equipped.length < baysOpen(levelBefore) && !d.modules.equipped.includes(e.id)) d.modules.equipped.push(e.id);
      break;
    }
    case 'equip_module': {
      if ((d.modules.levels[e.id] ?? 0) <= 0) return refuse(out, 'Module not owned.');
      const fitted = d.modules.equipped.includes(e.id);
      if (!e.on) d.modules.equipped = d.modules.equipped.filter((m) => m !== e.id);
      else if (!fitted) {
        if (d.modules.equipped.length >= baysOpen(levelBefore)) return refuse(out, 'All module bays are full.');
        d.modules.equipped.push(e.id);
      }
      break;
    }
    case 'buy_cosmetic': {
      const c = cosmetic(e.id);
      if (!c || c.obtain.kind !== 'shop') return refuse(out, 'Not for sale.');
      if (d.inventory.owned[c.id]) return refuse(out, 'Already owned.');
      if (!spend(d, out, c.obtain.price)) return refuse(out, 'Not enough credits.');
      grantCosmetic(d, out, c.id, 'shop', now);
      break;
    }
    case 'equip_cosmetic': {
      const c = cosmetic(e.id);
      if (!c || c.slot !== e.slot) return refuse(out, 'That does not fit this slot.');
      if (!d.inventory.owned[c.id]) return refuse(out, 'Not owned.');
      d.inventory.equipped[e.slot] = c.id;
      d.inventory.owned[c.id].fresh = false;
      break;
    }
    case 'open_case':
      if (!onOpenCase(d, out, e, now).ok) return out;
      break;
    case 'mark_seen':
      for (const id of e.ids) if (d.inventory.owned[id]) d.inventory.owned[id].fresh = false;
      break;
    case 'rename': {
      const name = e.name.replace(/[^\w \-.']/g, '').trim().slice(0, 16).toUpperCase();
      if (!name) return refuse(out, 'Enter a name.');
      d.profile.name = name;
      break;
    }
    case 'live_import':
      d.stats.liveImports += Math.max(0, Math.floor(e.added));
      break;
    case 'settle':
      break;
  }
  // Synergies are discovered by flying (or fitting) the pair.
  for (const id of activeSynergies(d.modules.equipped.filter((m) => d.modules.levels[m] > 0))) {
    if (!d.modules.synergies.includes(id)) {
      d.modules.synergies.push(id);
      out.synergies.push(id);
    }
  }
  settle(d, out, now, levelBefore);
  return out;
}

/** Title of a mission kind, for reward lines. */
export const missionTitle = (kind: MissionKind): string => MISSIONS[kind].title;
