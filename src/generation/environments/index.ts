import type { Catalogue } from '../../astronomy/database/catalogue';
import type { AstroObject } from '../../astronomy/database/schema';
import { primaryEnvironment } from './classify';
import type { EnvId, EnvironmentDef } from './common';
import { EXTREME } from './extreme';
import { PLANETARY } from './planetary';
import { STELLAR } from './stellar';

export type { EnvBlueprint, EnvContext, EnvId, EnvironmentDef } from './common';
export { primaryEnvironment } from './classify';

export const ENVIRONMENTS: readonly EnvironmentDef[] = [...PLANETARY, ...STELLAR, ...EXTREME];

const BY_ID = new Map<EnvId, EnvironmentDef>(ENVIRONMENTS.map((e) => [e.id, e]));

export function environment(id: EnvId): EnvironmentDef {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`unknown environment ${id}`);
  return e;
}

/** Environments where gravity itself is the threat (used for the "extreme gravity" milestone). */
export const EXTREME_GRAVITY: ReadonlySet<EnvId> = new Set<EnvId>(['black_hole', 'xray_binary', 'quasar', 'galactic_core', 'neutron_star', 'pulsar', 'anomaly']);

const pools = new WeakMap<Catalogue, Map<EnvId, AstroObject[]>>();

/** Catalogue objects that can host each environment (computed once per catalogue). */
export function hostPools(catalogue: Catalogue): Map<EnvId, AstroObject[]> {
  let map = pools.get(catalogue);
  if (!map) {
    map = new Map(ENVIRONMENTS.map((e) => [e.id, [] as AstroObject[]]));
    for (const o of catalogue.objects) {
      const id = primaryEnvironment(o);
      if (id) map.get(id)?.push(o);
    }
    pools.set(catalogue, map);
  }
  return map;
}
