/**
 * Journey milestones. Each is a pure predicate over the player's lifetime progress, so they can be
 * re-evaluated at any time; completing one pays a one-off credit reward.
 */
import { EXTREME_GRAVITY, ENVIRONMENTS, environment } from '../generation/environments';
import type { EnvId } from '../generation/environments';
import type { DiscoveryLog } from './discovery';

export interface MilestoneContext {
  log: DiscoveryLog;
  /** Deepest sector reached in a single run. */
  highestLevel: number;
}

export interface MilestoneDef {
  id: string;
  title: string;
  description: string;
  /** Credits paid once on completion. */
  reward: number;
  /** [current, target] for the progress read-out. */
  progress: (c: MilestoneContext) => [number, number];
}

const KNOWN = new Set<string>(ENVIRONMENTS.map((e) => e.id));
const seen = (c: MilestoneContext, test: (id: EnvId) => boolean): number => (c.log.environments.some((e) => KNOWN.has(e) && test(e as EnvId)) ? 1 : 0);
const discovered = (c: MilestoneContext): number => Object.keys(c.log.objects).length;
const REAL_ENVIRONMENTS = ENVIRONMENTS.filter((e) => !e.fictional).length;

export const MILESTONES: MilestoneDef[] = [
  { id: 'sector-10', title: 'FIRST TEN SECTORS', description: 'Reach sector 10 in a single run.', reward: 40, progress: (c) => [c.highestLevel, 10] },
  { id: 'sectors-50', title: 'FIFTY SECTORS', description: 'Clear 50 sectors across all runs.', reward: 80, progress: (c) => [c.log.sectorsCleared, 50] },
  { id: 'sectors-100', title: 'ONE HUNDRED SECTORS', description: 'Clear 100 sectors across all runs.', reward: 160, progress: (c) => [c.log.sectorsCleared, 100] },
  { id: 'first-star', title: 'FIRST STELLAR SYSTEM', description: 'Enter orbit around a star.', reward: 25, progress: (c) => [seen(c, (e) => environment(e).family === 'stellar'), 1] },
  { id: 'first-extreme', title: 'EXTREME GRAVITY', description: 'Survive the approach to a neutron star, pulsar or black hole.', reward: 40, progress: (c) => [seen(c, (e) => EXTREME_GRAVITY.has(e)), 1] },
  { id: 'first-rare', title: 'RARE ENCOUNTER', description: 'Meet one of the rare environments.', reward: 40, progress: (c) => [Math.min(1, c.log.rareEncounters), 1] },
  { id: 'deep-field', title: 'BEYOND THE GALAXY', description: 'Reach an extragalactic object: a galactic core or a quasar.', reward: 60, progress: (c) => [seen(c, (e) => e === 'galactic_core' || e === 'quasar'), 1] },
  { id: 'catalogue-10', title: 'SURVEYOR', description: 'Catalogue 10 real astronomical objects.', reward: 20, progress: (c) => [discovered(c), 10] },
  { id: 'catalogue-50', title: 'CARTOGRAPHER', description: 'Catalogue 50 real astronomical objects.', reward: 80, progress: (c) => [discovered(c), 50] },
  { id: 'catalogue-200', title: 'ARCHIVIST', description: 'Catalogue 200 real astronomical objects.', reward: 250, progress: (c) => [discovered(c), 200] },
  {
    id: 'all-environments',
    title: 'FULL SPECTRUM',
    description: `Experience all ${REAL_ENVIRONMENTS} kinds of real environment.`,
    reward: 200,
    progress: (c) => [c.log.environments.filter((e) => KNOWN.has(e) && !environment(e as EnvId).fictional).length, REAL_ENVIRONMENTS],
  },
  { id: 'uncharted', title: 'UNCHARTED', description: 'Encounter something that is in no catalogue.', reward: 100, progress: (c) => [Math.min(1, c.log.fictionalVisits), 1] },
];

export function isComplete(m: MilestoneDef, c: MilestoneContext): boolean {
  const [current, target] = m.progress(c);
  return current >= target;
}

/** Milestones that are complete now but not yet in `done`. */
export function newlyCompleted(c: MilestoneContext, done: readonly string[]): MilestoneDef[] {
  const have = new Set(done);
  return MILESTONES.filter((m) => !have.has(m.id) && isComplete(m, c));
}
