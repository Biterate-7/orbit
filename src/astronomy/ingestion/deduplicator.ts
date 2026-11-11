/**
 * Deduplication: the same object can arrive from several databases (Pluto from Horizons and the
 * small-body database, an exoplanet from two archives) or several times from one (M77 = NGC 1068).
 *
 * Records are grouped by identity keys, then merged field by field - the highest-priority source
 * keeps its values and lower-priority sources only fill fields that are still null.
 */
import { SOURCE_PRIORITY, slug } from '../database/schema';
import type { AstroCategory, AstroObject, SourceId } from '../database/schema';

/** Objects are only ever compared inside one namespace, so the asteroid "Europa" never merges with the moon. */
const NAMESPACE: Record<AstroCategory, string> = {
  star: 'deep',
  'stellar-remnant': 'deep',
  nebula: 'deep',
  planet: 'major',
  moon: 'moon',
  'dwarf-planet': 'minor',
  asteroid: 'minor',
  comet: 'minor',
  exoplanet: 'exo',
  galaxy: 'xgal',
  quasar: 'xgal',
};

export function identityKeys(o: AstroObject): string[] {
  const ns = NAMESPACE[o.category];
  const keys = new Set<string>([`id:${o.id}`]);
  const name = slug(o.name);
  const des = slug(o.designation);
  if (o.category === 'comet') {
    // Discoverer names repeat endlessly among comets ("LINEAR", "NEAT"); only the designation identifies one.
    if (des) keys.add(`comet:${des}`);
    return [...keys];
  }
  if (name) keys.add(`${ns}:${name}`);
  if (des) keys.add(`${ns}:${des}`);
  return [...keys];
}

function fill<T extends object>(target: T, extra: T): void {
  for (const k of Object.keys(extra) as (keyof T)[]) {
    if (target[k] === null || target[k] === undefined) target[k] = extra[k];
  }
}

/** Merge `b` into a copy of `a`. `a` must be the higher-priority record. */
export function mergeObjects(a: AstroObject, b: AstroObject): AstroObject {
  const out: AstroObject = JSON.parse(JSON.stringify(a)) as AstroObject;
  fill(out.physicalProperties, b.physicalProperties);
  fill(out.orbitalProperties, b.orbitalProperties);
  fill(out.context, b.context);
  if (!out.visualProperties.imageUrl && b.visualProperties.imageUrl) out.visualProperties = { ...b.visualProperties };
  const also = new Set<SourceId>([...a.alsoIn, ...b.alsoIn, b.source]);
  also.delete(out.source);
  out.alsoIn = [...also].sort();
  if (b.lastUpdated > out.lastUpdated) out.lastUpdated = b.lastUpdated;
  return out;
}

export interface DedupeResult {
  objects: AstroObject[];
  /** Number of input records that were folded into another record. */
  merged: number;
}

export function deduplicate(input: AstroObject[]): DedupeResult {
  // Union-find over records that share any identity key.
  const parent = input.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const owner = new Map<string, number>();
  input.forEach((o, i) => {
    for (const k of identityKeys(o)) {
      const j = owner.get(k);
      if (j === undefined) owner.set(k, i);
      else parent[find(i)] = find(j);
    }
  });

  const groups = new Map<number, AstroObject[]>();
  input.forEach((o, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(o);
    else groups.set(root, [o]);
  });

  const objects: AstroObject[] = [];
  let merged = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]);
    let acc = group[0];
    for (let i = 1; i < group.length; i++) {
      acc = mergeObjects(acc, group[i]);
      merged++;
    }
    objects.push(acc);
  }
  objects.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { objects, merged };
}
