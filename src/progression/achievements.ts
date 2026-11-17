/**
 * Achievements - one system for everything the pilot can complete.
 *
 * The journey milestones that existed before (progression/milestones.ts) are part of this list:
 * they are adapted into achievements of the 'milestone' category under their original ids, so a
 * milestone completed in an old save is the same record as the achievement here and is never paid
 * twice. Every achievement is a pure predicate over the saved state (`progress`), which makes the
 * whole list safe to re-evaluate at any time.
 */
import { COSMETICS } from '../game/cosmetics/catalog';
import { BOSSES, MISSIONS, NORMAL_MISSIONS } from '../game/missions/catalog';
import { MODULE_IDS, MODULE_MAX, SYNERGIES } from '../game/modules';
import type { SaveData } from '../game/persistence';
import { levelFor } from './level';
import { MILESTONES } from './milestones';
import { deriveStats } from './stats';
import type { DerivedStats } from './stats';

export type AchievementCategory = 'milestone' | 'exploration' | 'missions' | 'encounters' | 'collection' | 'engineering' | 'mastery';

export const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  milestone: 'JOURNEY MILESTONES',
  exploration: 'EXPLORATION',
  missions: 'MISSIONS',
  encounters: 'MAJOR ENCOUNTERS',
  collection: 'COLLECTION',
  engineering: 'ENGINEERING',
  mastery: 'MASTERY',
};

export const CATEGORY_ORDER: AchievementCategory[] = ['exploration', 'missions', 'encounters', 'collection', 'engineering', 'mastery', 'milestone'];

/** Badge metal: a quick read of how much an achievement asks for. */
export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'prismatic';

export interface AchievementContext {
  save: SaveData;
  d: DerivedStats;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  tier: BadgeTier;
  /** Credits paid once on unlocking. */
  reward: number;
  /** Not listed until unlocked (title and description stay hidden). */
  hidden?: boolean;
  icon: string;
  /** [current, target] - unlocked when current >= target. */
  progress: (c: AchievementContext) => [number, number];
}

const tierFor = (reward: number): BadgeTier => (reward >= 400 ? 'prismatic' : reward >= 150 ? 'gold' : reward >= 60 ? 'silver' : 'bronze');

const def = (
  id: string,
  title: string,
  description: string,
  category: AchievementCategory,
  reward: number,
  icon: string,
  progress: (c: AchievementContext) => [number, number],
  hidden = false,
): AchievementDef => ({ id, title, description, category, tier: tierFor(reward), reward, icon, progress, hidden });

const flag = (v: boolean): [number, number] => [v ? 1 : 0, 1];

/** Exploration achievements that together make up MASTER EXPLORER. */
const EXPLORER_SET = ['first-contact', 'cartographer-25', 'binary-explorer', 'twin-suns', 'planets-25', 'signals-1', 'first-rare', 'deep-field'];

const SOLAR_PLANETS = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

const NEW: AchievementDef[] = [
  // ---- exploration
  def('first-contact', 'FIRST CONTACT', 'Discover your first star system.', 'exploration', 30, 'm_survey', (c) => [c.d.systemsDiscovered, 1]),
  def('systems-10', 'SYSTEM HOPPER', 'Discover 10 star systems.', 'exploration', 90, 'm_survey', (c) => [c.d.systemsDiscovered, 10]),
  def('cartographer-25', 'GALACTIC CARTOGRAPHER', 'Discover 25 star systems.', 'exploration', 220, 'm_survey', (c) => [c.d.systemsDiscovered, 25]),
  def('binary-explorer', 'BINARY EXPLORER', 'Complete a mission in a binary star system.', 'exploration', 80, 'm_binary', (c) => [c.save.stats.binaryMissions, 1]),
  def('twin-suns', 'TWIN SUNS', 'Enter a circumbinary system: planets that orbit two stars.', 'exploration', 70, 'm_binary', (c) => flag(c.save.journey.environments.includes('circumbinary'))),
  def('planets-25', 'WORLD WALKER', 'Encounter 25 real planets and moons.', 'exploration', 90, 'm_survey', (c) => [c.d.planetsEncountered, 25]),
  def('planets-100', 'A HUNDRED WORLDS', 'Encounter 100 real planets and moons.', 'exploration', 260, 'm_survey', (c) => [c.d.planetsEncountered, 100]),
  def('grand-tour', 'GRAND TOUR', 'Encounter all eight planets of the Solar System.', 'exploration', 150, 'm_sling', (c) => [SOLAR_PLANETS.filter((p) => c.save.journey.planets.includes(p)).length, 8]),
  def('signals-1', 'FIRST LIGHT', 'Locate a hidden signal source.', 'exploration', 60, 'm_discovery', (c) => [c.save.stats.signalsFound, 1]),
  def('signals-5', 'SIGNAL HUNTER', 'Locate 5 hidden signal sources.', 'exploration', 200, 'm_discovery', (c) => [c.save.stats.signalsFound, 5]),
  def('caches-5', 'PROSPECTOR', 'Recover 5 hidden supply caches.', 'exploration', 90, 'mod_scanner', (c) => [c.save.stats.cachesFound, 5]),
  def('rare-10', 'RARE AIR', 'Make 10 rare discoveries.', 'exploration', 160, 'm_discovery', (c) => [c.save.stats.rareDiscoveries, 10]),
  def('open-archive', 'OPEN ARCHIVE', 'Import a record live from NASA or JPL into the catalogue.', 'exploration', 40, 'mod_scanner', (c) => [c.save.stats.liveImports, 1]),
  def('master-explorer', 'MASTER EXPLORER', 'Complete eight exploration achievements: first contact, 25 systems, a binary, twin suns, 25 worlds, a signal, a rare encounter and another galaxy.', 'exploration', 320, 'm_discovery', (c) => [EXPLORER_SET.filter((id) => id in c.save.achievements).length, EXPLORER_SET.length]),

  // ---- missions
  def('missions-10', 'REGULAR', 'Complete 10 missions.', 'missions', 50, 'm_gates', (c) => [c.save.stats.missionsCompleted, 10]),
  def('missions-50', 'SEASONED', 'Complete 50 missions.', 'missions', 160, 'm_gates', (c) => [c.save.stats.missionsCompleted, 50]),
  def('cosmic-veteran', 'COSMIC VETERAN', 'Complete 100 missions.', 'missions', 500, 'm_gates', (c) => [c.save.stats.missionsCompleted, 100]),
  def('all-missions', 'JACK OF ALL ORBITS', 'Complete every type of mission at least once.', 'missions', 300, 'm_survival', (c) => [NORMAL_MISSIONS.filter((k) => (c.save.missions[k]?.completed ?? 0) > 0).length, NORMAL_MISSIONS.length]),
  def('s-rank-1', 'TEXTBOOK', 'Earn an S rank.', 'missions', 40, 'm_gates', (c) => [c.save.stats.sRanks, 1]),
  def('s-rank-25', 'ACE', 'Earn 25 S ranks.', 'missions', 280, 'm_gates', (c) => [c.save.stats.sRanks, 25]),
  def('flawless-10', 'NOT A SCRATCH', 'Complete 10 missions without losing any hull.', 'missions', 120, 'hull', (c) => [c.save.stats.flawless, 10]),
  def('elite-5', 'ELITE', 'Clear 5 elite sectors.', 'missions', 180, 'm_boss', (c) => [c.save.stats.eliteCleared, 5]),
  def('twisted', 'DOUBLE TROUBLE', 'Complete a mission with two or more twists active.', 'missions', 90, 'm_anomaly', (c) => [c.save.stats.twistedCleared, 1]),
  def('shadow-dancer', 'SHADOW DANCER', 'Shelter from every superflare of a solar flare mission.', 'missions', 90, 'm_flare', (c) => [c.save.stats.feats.flare_run ?? 0, 1]),
  def('guardian', 'GUARDIAN', 'Finish an escort with the tender untouched.', 'missions', 90, 'm_escort', (c) => [c.save.stats.feats.escort ?? 0, 1]),
  def('miner-25', 'STRIP MINER', 'Mine 25 ore rocks.', 'missions', 140, 'm_mining', (c) => [c.save.stats.asteroidsCollected, 25]),
  def('transits-10', 'SHORTCUT', 'Make 10 wormhole transits.', 'missions', 70, 'm_worm', (c) => [c.save.stats.wormholeTransits, 10]),
  def('assists-10', 'FREE RIDE', 'Fly 10 gravity assists.', 'missions', 110, 'm_sling', (c) => [c.save.stats.gravityAssists, 10]),
  def('beyond-horizon', 'BEYOND THE HORIZON', 'Reach sector 20 in a single run.', 'missions', 240, 'm_hole', (c) => [c.d.highestLevel, 20]),

  // ---- major encounters
  def('boss-neutron', 'CORE BREAKER', 'Defeat the Neutron Core.', 'encounters', 60, 'm_boss', (c) => [c.save.stats.bossRecords.boss_neutron?.defeats ?? (c.save.bosses.includes('boss_neutron') ? 1 : 0), 1]),
  def('boss-devourer', 'STARVED IT', 'Defeat the Devourer.', 'encounters', 60, 'm_boss', (c) => [c.save.stats.bossRecords.boss_devourer?.defeats ?? (c.save.bosses.includes('boss_devourer') ? 1 : 0), 1]),
  def('boss-sentinel', 'MELTDOWN', 'Defeat the Sentinel.', 'encounters', 60, 'm_boss', (c) => [c.save.stats.bossRecords.boss_sentinel?.defeats ?? (c.save.bosses.includes('boss_sentinel') ? 1 : 0), 1]),
  def('trinity', 'TRINITY', 'Defeat all three major encounters.', 'encounters', 160, 'm_boss', (c) => [BOSSES.filter((k) => c.save.bosses.includes(k)).length, BOSSES.length]),
  def('boss-hunter', 'BOSS HUNTER', 'Defeat 10 major encounters.', 'encounters', 260, 'm_boss', (c) => [c.save.stats.bossesDefeated, 10]),
  def('escalation', 'ESCALATION', 'Defeat a major encounter at MK II or higher.', 'encounters', 150, 'm_boss', (c) => [Math.max(0, ...Object.values(c.save.stats.bossRecords).map((b) => b?.highestTier ?? 0)), 2]),
  def('untouched', 'UNTOUCHED', 'Defeat a major encounter without losing any hull.', 'encounters', 220, 'shield', (c) => [Object.values(c.save.stats.bossRecords).reduce((n, b) => n + (b?.flawless ?? 0), 0), 1], true),

  // ---- collection
  def('collector-20', 'COLLECTOR', 'Obtain 20 cosmetic items.', 'collection', 150, 'collector', (c) => [c.d.cosmeticsCollected, 20]),
  def('collector-45', 'CURATOR', 'Obtain 45 cosmetic items.', 'collection', 320, 'collector', (c) => [c.d.cosmeticsCollected, 45]),
  def('collector-all', 'COMPLETE HANGAR', 'Obtain every cosmetic item.', 'collection', 600, 'collector', (c) => [c.d.cosmeticsCollected, c.d.cosmeticsTotal]),
  def('ships-6', 'FLEET', 'Own 6 hull skins.', 'collection', 110, 'hull', (c) => [c.d.shipsOwned, 6]),
  def('dressed', 'DRESSED TO ORBIT', 'Fly with a non-standard part fitted in every cosmetic slot.', 'collection', 120, 'hull', (c) => [Object.values(c.save.inventory.equipped).filter((id) => COSMETICS.find((x) => x.id === id)?.obtain.kind !== 'starter').length, 8]),
  def('legend', 'LEGEND', 'Own a legendary item.', 'collection', 120, 'overdrive', (c) => flag(Object.keys(c.save.inventory.owned).some((id) => COSMETICS.find((x) => x.id === id)?.rarity === 'legendary'))),
  def('myth', 'MYTH', 'Own a mythic item.', 'collection', 250, 'overdrive', (c) => flag(Object.keys(c.save.inventory.owned).some((id) => COSMETICS.find((x) => x.id === id)?.rarity === 'mythic')), true),
  def('cases-10', 'UNBOXER', 'Open 10 cases.', 'collection', 100, 'collector', (c) => [c.save.stats.casesOpened, 10]),

  // ---- engineering
  def('module-1', 'FITTED OUT', 'Buy your first ship module.', 'engineering', 40, 'mod_anchor', (c) => [MODULE_IDS.filter((id) => c.save.modules.levels[id] > 0).length, 1]),
  def('module-max', 'FULLY TUNED', `Raise a module to level ${MODULE_MAX}.`, 'engineering', 140, 'mod_dualcore', (c) => [Math.max(...MODULE_IDS.map((id) => c.save.modules.levels[id])), MODULE_MAX]),
  def('modules-all', 'ARSENAL', 'Own every ship module.', 'engineering', 300, 'mod_resonator', (c) => [MODULE_IDS.filter((id) => c.save.modules.levels[id] > 0).length, MODULE_IDS.length]),
  def('synergy-1', 'RESONANCE', 'Fly with two modules that form a synergy.', 'engineering', 70, 'mod_resonator', (c) => [c.save.modules.synergies.length, 1]),
  def('synergy-all', 'GRAND UNIFICATION', 'Discover every module synergy.', 'engineering', 350, 'mod_resonator', (c) => [c.save.modules.synergies.length, SYNERGIES.length], true),

  // ---- mastery
  def('level-5', 'PILOT', 'Reach pilot level 5.', 'mastery', 60, 'thrusters', (c) => [levelFor(c.save.profile.xp), 5]),
  def('level-10', 'NAVIGATOR', 'Reach pilot level 10.', 'mastery', 150, 'thrusters', (c) => [levelFor(c.save.profile.xp), 10]),
  def('level-20', 'CAPTAIN', 'Reach pilot level 20.', 'mastery', 400, 'thrusters', (c) => [levelFor(c.save.profile.xp), 20]),
  def('funded', 'WELL FUNDED', 'Earn 5,000 credits in total.', 'mastery', 150, 'reactor', (c) => [c.save.stats.creditsEarned, 5000]),
  def('long-haul', 'LONG HAUL', 'Stay alive for 15 minutes in a single run.', 'mastery', 180, 'stabilizer', (c) => [Math.floor(c.d.longestSurvival), 900]),
  def('needle', 'THREADING THE NEEDLE', 'Rack up 40 near misses in a single run.', 'mastery', 160, 'scanner', (c) => [c.save.stats.bestNearMisses, 40], true),
  def('light-years', 'A LONG WAY FROM HOME', 'Fly a million units in total.', 'mastery', 200, 'thrusters', (c) => [Math.floor(c.save.stats.distance), 1_000_000]),
];

/** The original journey milestones, as achievements under their original ids. */
const FROM_MILESTONES: AchievementDef[] = MILESTONES.map((m) =>
  def(m.id, m.title, m.description, 'milestone', m.reward, 'm_survival', (c) => m.progress({ log: c.save.journey, highestLevel: c.save.records.highestLevel })),
);

export const ACHIEVEMENTS: readonly AchievementDef[] = [...NEW, ...FROM_MILESTONES];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function achievement(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

export const ACHIEVEMENT_IDS: ReadonlySet<string> = new Set(ACHIEVEMENTS.map((a) => a.id));

/** Cosmetics an achievement grants (declared on the cosmetic, so there is one source of truth). */
export function achievementCosmetics(id: string): string[] {
  return COSMETICS.filter((c) => c.obtain.kind === 'achievement' && c.obtain.id === id).map((c) => c.id);
}

export function achievementContext(save: SaveData): AchievementContext {
  return { save, d: deriveStats(save) };
}

export function isUnlocked(save: SaveData, id: string): boolean {
  return id in save.achievements;
}

/** Achievements whose condition is met but that are not recorded as unlocked yet. */
export function pendingAchievements(save: SaveData): AchievementDef[] {
  const ctx = achievementContext(save);
  return ACHIEVEMENTS.filter((a) => {
    if (a.id in save.achievements) return false;
    const [cur, target] = a.progress(ctx);
    return cur >= target;
  });
}

export function achievementSummary(save: SaveData): { unlocked: number; total: number; credits: number } {
  let credits = 0;
  for (const a of ACHIEVEMENTS) if (a.id in save.achievements) credits += a.reward;
  return { unlocked: ACHIEVEMENTS.filter((a) => a.id in save.achievements).length, total: ACHIEVEMENTS.length, credits };
}

/** Human title of a boss (for records). */
export const bossTitle = (kind: keyof typeof MISSIONS): string => MISSIONS[kind].title;
