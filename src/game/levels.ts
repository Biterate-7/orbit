/**
 * Bridge between a run and the procedural generation engine (src/generation).
 * The run asks for "the next sector"; the selector picks an encounter that fits the journey so
 * far and the generator builds the level from that encounter's seed.
 */
import { selectEncounter } from '../generation/encounterSelector';
import type { PlayerProgress, RunHistory } from '../generation/encounterSelector';
import { buildLevel, generateLevelFromSeed, MOD_LABEL } from '../generation/levelGenerator';
import type { Encounter } from '../generation/levelGenerator';
import type { LevelDef } from './types';

export { MOD_LABEL };
export { difficultyProfile, durationFor as levelDuration, intensityFor as difficultyFor } from '../generation/difficulty';

export interface GeneratedLevel {
  level: LevelDef;
  encounter: Encounter;
}

export function generateLevel(index: number, runSeed: number, history: RunHistory, progress: PlayerProgress, seen: ReadonlySet<string>): GeneratedLevel {
  const { encounter } = selectEncounter(runSeed, index, history, progress);
  return { level: buildLevel(encounter, seen), encounter };
}

/** A calm level used for the animated main-menu background. */
export function menuLevel(): LevelDef {
  const lvl = generateLevelFromSeed(1234, 1);
  return { ...lvl, newMechanics: [] };
}
