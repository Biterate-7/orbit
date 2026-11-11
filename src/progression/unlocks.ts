/**
 * What the journey has opened up so far. Environments unlock by depth: an environment can appear
 * once a run reaches its first sector, so pushing deeper is what reveals new kinds of places.
 */
import { ENVIRONMENTS, hostPools } from '../generation/environments';
import type { EnvironmentDef } from '../generation/environments';
import type { Catalogue } from '../astronomy/database/catalogue';
import type { DiscoveryLog } from './discovery';

export type EnvironmentStatus = 'visited' | 'in-range' | 'locked';

export interface EnvironmentEntry {
  env: EnvironmentDef;
  status: EnvironmentStatus;
  /** Real catalogue objects that can host this environment. */
  hosts: number;
  /** Of those, how many the player has catalogued. */
  hostsDiscovered: number;
  hint: string;
}

export function environmentEntries(log: DiscoveryLog, highestLevel: number, catalogue: Catalogue): EnvironmentEntry[] {
  const pools = hostPools(catalogue);
  const visited = new Set(log.environments);
  return ENVIRONMENTS.map((env) => {
    const pool = pools.get(env.id) ?? [];
    const status: EnvironmentStatus = visited.has(env.id) ? 'visited' : env.minLevel <= highestLevel + 1 ? 'in-range' : 'locked';
    return {
      env,
      status,
      hosts: pool.length,
      hostsDiscovered: pool.reduce((n, o) => n + (log.objects[o.id] ? 1 : 0), 0),
      hint: status === 'visited' ? '' : status === 'in-range' ? 'IN RANGE · NOT YET ENCOUNTERED' : `FIRST APPEARS AROUND SECTOR ${env.minLevel}`,
    };
  });
}
