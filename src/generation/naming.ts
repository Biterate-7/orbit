/**
 * Level names. Every title is derived from the level's own data: the object's name or
 * designation, its orbit, or the environment it hosts - never a random unrelated phrase.
 */
import type { AstroObject } from '../astronomy/database/schema';
import type { Rng } from '../game/rng';
import type { OrbitConfig } from './orbitalConfiguration';

/** A compact upper-case form of an object's name that fits a HUD line. */
export function shortName(o: { name: string; designation: string }): string {
  const clean = (s: string): string =>
    s
      .replace(/\(.*?\)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  const name = clean(o.name);
  if (name.length <= 16) return name;
  const des = clean(o.designation);
  return des.length < name.length ? des : name;
}

/** "PSR B0531+21" -> "B0531+21"; "V* CM Tau" style names fall back to the short name. */
function pulsarTag(o: { name: string; designation: string }): string | null {
  const m = /(?:PSR\s+)?([BJ]\d{4}[+-]\d{2,4}\w*)/i.exec(`${o.designation} ${o.name}`);
  return m ? m[1].toUpperCase() : null;
}

export interface NameInputs {
  templates: string[];
  subject: { name: string; designation: string };
  object: AstroObject | null;
  orbit: OrbitConfig;
  rng: Rng;
}

export function levelName(a: NameInputs): string {
  const n = shortName(a.subject);
  const z = a.object?.context.redshift ?? null;
  const d = pulsarTag(a.subject);
  const e = a.object?.orbitalProperties.eccentricity ?? null;
  const sma = a.object?.orbitalProperties.semiMajorAxis ?? null;

  const pool: string[] = [];
  for (const t of a.templates) {
    if (t.includes('{Z}') && z === null) continue;
    if (t.includes('{D}') && d === null) continue;
    if (t.includes('{N}') && n.length > 18) continue;
    pool.push(t);
  }
  // Orbit-derived titles are only offered when the data actually supports them.
  if (a.orbit.id === 'eccentric' && e !== null) {
    if (e >= 0.85) pool.push('THE LAST PERIHELION', 'THE LAST PERIHELION');
    else if (e >= 0.45) pool.push('PERIHELION RUN');
    if (sma !== null && sma > 30) pool.push('APHELION');
  }
  if (a.orbit.id === 'inclined') pool.push('{N} NODE');
  if (a.orbit.id === 'decaying') pool.push('{N} DECAY');
  if (a.orbit.id === 'unstable' && a.object) pool.push('{N} PERTURBED');

  const usable = pool.filter((t) => !t.includes('{N}') || n.length <= 18);
  const pick = usable.length > 0 ? a.rng.pick(usable) : `${n.slice(0, 18)} ORBIT`;
  return pick
    .replace('{N}', n)
    .replace('{D}', d ?? n)
    .replace('{Z}', z === null ? '' : z.toFixed(z < 1 ? 3 : 2))
    .trim();
}

const SYLLABLES = ['KA', 'RO', 'VEL', 'TI', 'AN', 'OR', 'SI', 'MA', 'DRA', 'EL', 'NU', 'TH', 'AR', 'IS', 'ON', 'YR', 'XA', 'LO', 'QUE', 'ZE'];

/**
 * Designation for a procedural or fictional setting. The "OLS" prefix (ORBIT//LOST Survey) marks
 * it as generated - it never imitates a real catalogue's naming scheme.
 */
export function proceduralDesignation(rng: Rng, planet: boolean): { name: string; designation: string } {
  const num = rng.int(1000, 9999);
  const designation = `OLS ${num}${planet ? ` ${rng.pick(['b', 'c', 'd', 'e'])}` : ''}`;
  const name = `${rng.pick(SYLLABLES)}${rng.pick(SYLLABLES)}${rng.chance(0.4) ? rng.pick(SYLLABLES) : ''}`;
  return { name: `${name}-${num}`, designation };
}
