/**
 * Bridge between a run and the procedural generation engine (src/generation).
 * The run asks for "the next sector": the schedule decides what the sector is played for (its
 * mission), the selector picks an encounter that suits both the mission and the journey so far,
 * and the generator builds the level from that encounter's seed.
 */
import { selectEncounter } from '../generation/encounterSelector';
import type { PlayerProgress, RunHistory } from '../generation/encounterSelector';
import { buildLevel, generateLevelFromSeed, MOD_LABEL } from '../generation/levelGenerator';
import type { Encounter } from '../generation/levelGenerator';
import { missionForSector } from '../generation/missionSchedule';
import type { MissionPick } from '../generation/missionSchedule';
import { MISSIONS } from './missions/catalog';
import type { LevelDef } from './types';

export { MOD_LABEL };
export { difficultyProfile, durationFor as levelDuration, intensityFor as difficultyFor } from '../generation/difficulty';

export interface GeneratedLevel {
  level: LevelDef;
  encounter: Encounter;
  mission: MissionPick;
}

export function generateLevel(index: number, runSeed: number, history: RunHistory, progress: PlayerProgress, seen: ReadonlySet<string>): GeneratedLevel {
  const mission = missionForSector(runSeed, index, history.missions ?? []);
  const { encounter } = selectEncounter(runSeed, index, history, progress, undefined, MISSIONS[mission.kind].envs);
  return { level: buildLevel(encounter, seen, undefined, mission), encounter, mission };
}

/** A calm level used for the animated main-menu background. */
export function menuLevel(): LevelDef {
  const lvl = generateLevelFromSeed(1234, 1);
  return { ...lvl, newMechanics: [] };
}
