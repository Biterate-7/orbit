/**
 * Which mission a sector is played for.
 *
 * Sectors 1-15 follow a fixed curriculum (see CURRICULUM): each teaches one skill and every fifth
 * sector is a major encounter. After that the run keeps a boss every fifth sector, rotating
 * through the three, and fills the gaps with a seeded mix of the eight mission types that never
 * repeats the previous sector and favours the types played least recently.
 */
import { BOSS_INTERVAL, BOSS_ROTATION, CURRICULUM, MISSIONS, NORMAL_MISSIONS, survivalTier } from '../game/missions/catalog';
import type { MissionKind } from '../game/missions/types';
import { Rng } from '../game/rng';
import { hash32 } from './seed';

export interface MissionPick {
  kind: MissionKind;
  tier: number;
}

export function tierFor(kind: MissionKind, index: number): number {
  if (kind === 'survival') return survivalTier(index);
  if (MISSIONS[kind].boss) return 1 + Math.floor((index - BOSS_INTERVAL) / (BOSS_INTERVAL * BOSS_ROTATION.length));
  if (index <= CURRICULUM.length) return CURRICULUM.slice(0, index).filter((k) => k === kind).length;
  return 2 + Math.floor((index - CURRICULUM.length - 1) / 15);
}

/** `recent` = mission kinds of the sectors already played in this run, oldest first. */
export function missionForSector(runSeed: number, index: number, recent: readonly MissionKind[] = []): MissionPick {
  if (index >= 1 && index <= CURRICULUM.length) {
    const kind = CURRICULUM[index - 1];
    return { kind, tier: tierFor(kind, index) };
  }
  if (index % BOSS_INTERVAL === 0) {
    const kind = BOSS_ROTATION[(index / BOSS_INTERVAL - 1) % BOSS_ROTATION.length];
    return { kind, tier: tierFor(kind, index) };
  }
  const prev = recent[recent.length - 1];
  const pool = NORMAL_MISSIONS.filter((k) => k !== prev);
  const weights = pool.map((k) => {
    const last = recent.lastIndexOf(k);
    const since = last < 0 ? 8 : recent.length - last;
    return 1 + 0.6 * Math.min(8, since);
  });
  const kind = new Rng(hash32(runSeed, index, 0x31551)).weighted(pool, weights);
  return { kind, tier: tierFor(kind, index) };
}
