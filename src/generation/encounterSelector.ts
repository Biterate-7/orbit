/**
 * Encounter selection.
 *
 * Rarity alone makes for a flat journey, so the next sector is not simply rolled. For every
 * sector a handful of candidate levels are rolled from seeds derived from the run seed, and each
 * candidate is scored against what the player has already seen - in this run and across all runs:
 *
 *   - never the same environment twice in a row, and little repetition within a recent window
 *   - environments and objects the player has never met are strongly preferred
 *   - rare encounters are paced: suppressed just after one, increasingly likely as the drought
 *     grows, and favoured on every tenth sector
 *   - story beats: a first star by sector 5, a first extreme-gravity object by sector 12
 *
 * The winner is still an ordinary seeded level - its seed alone rebuilds it - so the selection
 * adds direction without giving up determinism (same run seed + same history = same journey).
 */
import { getCatalogue } from '../astronomy/database/catalogue';
import type { Catalogue } from '../astronomy/database/catalogue';
import type { MissionKind } from '../game/missions/types';
import type { EnvFamily } from '../game/types';
import { EXTREME_GRAVITY, environment } from './environments';
import type { EnvId } from './environments';
import { rollEncounter } from './levelGenerator';
import type { Encounter } from './levelGenerator';
import { candidateSeed } from './seed';

/** What has happened so far in the current run. */
export interface RunHistory {
  /** Environment of each sector played, oldest first. */
  environments: EnvId[];
  /** Object id of each sector played. */
  objects: string[];
  /** Sectors since the last rare or legendary encounter. */
  sinceRare: number;
  /** Mission of each sector played (absent in histories that predate missions). */
  missions?: MissionKind[];
}

/** What the player has seen across all runs. */
export interface PlayerProgress {
  discovered: ReadonlySet<string>;
  environmentsSeen: ReadonlySet<string>;
}

export const EMPTY_HISTORY: RunHistory = { environments: [], objects: [], sinceRare: 0 };
export const EMPTY_PROGRESS: PlayerProgress = { discovered: new Set(), environmentsSeen: new Set() };

const CANDIDATES = 12;

export function scoreEncounter(enc: Encounter, history: RunHistory, progress: PlayerProgress): number {
  const env = environment(enc.env);
  const idx = enc.index;
  const envs = history.environments;
  const prev = envs[envs.length - 1];
  let score = 0;

  // Variety within the run.
  if (prev === enc.env) score -= 100;
  const recent = envs.slice(-6);
  if (!recent.includes(enc.env)) score += 2;
  if (!envs.includes(enc.env)) score += 1.5;
  const families = envs.slice(-2).map((e) => environment(e).family);
  if (families.length === 2 && families.every((f: EnvFamily) => f === env.family)) score -= 1.5;
  if (enc.object && history.objects.includes(enc.object.id)) score -= 40;

  // Discovery across runs.
  if (!progress.environmentsSeen.has(enc.env)) score += 2.5;
  if (enc.object && !progress.discovered.has(enc.object.id)) score += 1.5;
  if (enc.identity === 'REAL OBJECT') score += 0.6;

  // Rare-encounter pacing.
  const rare = enc.rarity === 'rare' || enc.rarity === 'legendary';
  if (rare) {
    if (history.sinceRare < 4) score -= 12;
    else score += 4 * Math.min(1.5, (history.sinceRare - 5) / 7) - 1;
    if (idx % 10 === 0) score += 8;
    if (enc.rarity === 'legendary' && idx % 10 !== 0) score -= 1.5;
  }

  // Story beats.
  const seenFamily = (f: EnvFamily): boolean => envs.some((e) => environment(e).family === f);
  if (idx >= 3 && idx <= 6 && env.family === 'stellar' && !seenFamily('stellar')) score += idx >= 5 ? 30 : 5;
  if (idx >= 9 && EXTREME_GRAVITY.has(enc.env) && !envs.some((e) => EXTREME_GRAVITY.has(e))) score += idx >= 12 ? 30 : 4;

  return score;
}

export interface Selection {
  encounter: Encounter;
  /** Which candidate won (0 = the first roll). */
  attempt: number;
  score: number;
}

export function selectEncounter(
  runSeed: number,
  index: number,
  history: RunHistory = EMPTY_HISTORY,
  progress: PlayerProgress = EMPTY_PROGRESS,
  catalogue: Catalogue = getCatalogue(),
  /** Environments the sector's mission can take place in (empty = any). */
  allowed: readonly EnvId[] = [],
): Selection {
  let best: Selection | null = null;
  for (let attempt = 0; attempt < CANDIDATES; attempt++) {
    const encounter = rollEncounter(candidateSeed(runSeed, index, attempt), index, catalogue, allowed);
    const score = scoreEncounter(encounter, history, progress);
    if (!best || score > best.score) best = { encounter, attempt, score };
  }
  return best as Selection;
}

/** Append a played encounter to the run history (returns a new object). */
export function recordEncounter(history: RunHistory, enc: Encounter, objectId: string, mission?: MissionKind): RunHistory {
  const rare = enc.rarity === 'rare' || enc.rarity === 'legendary';
  const out: RunHistory = {
    environments: [...history.environments, enc.env],
    objects: [...history.objects, objectId],
    sinceRare: rare ? 0 : history.sinceRare + 1,
  };
  if (mission || history.missions) out.missions = [...(history.missions ?? []), ...(mission ? [mission] : [])];
  return out;
}
