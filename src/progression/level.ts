/**
 * Pilot level: a single number for overall progression, earned as experience from missions,
 * encounters, discoveries and achievements.
 */

/** Experience needed to go from `level` to `level + 1`. Grows linearly, so levels keep coming. */
export function xpToNext(level: number): number {
  return 140 + 70 * (Math.max(1, level) - 1);
}

/** Total experience needed to reach `level` (level 1 = 0). */
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level)) - 1;
  return 140 * n + (70 * n * (n - 1)) / 2;
}

export const MAX_LEVEL = 60;

export function levelFor(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Progress through the current level, 0..1, and the numbers behind it. */
export function levelProgress(xp: number): { level: number; into: number; need: number; fraction: number } {
  const level = levelFor(xp);
  const into = xp - xpForLevel(level);
  const need = xpToNext(level);
  return { level, into, need, fraction: level >= MAX_LEVEL ? 1 : Math.min(1, into / need) };
}

/** Credits paid on reaching `level`. */
export function levelReward(level: number): number {
  return 20 + 10 * level;
}

export const RANK_TITLES: [number, string][] = [
  [1, 'CADET'],
  [3, 'PILOT'],
  [6, 'SURVEYOR'],
  [10, 'NAVIGATOR'],
  [15, 'PATHFINDER'],
  [20, 'CAPTAIN'],
  [28, 'COMMODORE'],
  [38, 'ADMIRAL'],
  [50, 'STARFARER'],
];

export function rankTitle(level: number): string {
  let title = RANK_TITLES[0][1];
  for (const [at, name] of RANK_TITLES) if (level >= at) title = name;
  return title;
}

/** Experience values, in one place so the economy can be tuned. */
export const XP = {
  mission: 40,
  missionFailed: 10,
  boss: 150,
  newObject: 12,
  newSystem: 30,
  rare: 25,
  signal: 60,
  cache: 15,
  planet: 4,
  /** Experience for an achievement = its credit reward times this. */
  perAchievementCredit: 0.5,
};
