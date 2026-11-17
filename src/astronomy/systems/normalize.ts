/**
 * Validation and normalisation of raw source rows into the game's star-system format.
 *
 * Shared by the offline ingestion script (scripts/ingest-systems.ts) and by the in-game live
 * importer, so a record fetched while playing passes exactly the same checks as a bundled one.
 */
import { PARSEC_LY, kindFromStarCount, systemId } from './types';
import type { PlanetHostConfig, SmallBody, StarSystem, SystemPlanet, SystemStar } from './types';

/** Columns requested from the NASA Exoplanet Archive `pscomppars` table. */
export const PSCOMPPARS_COLUMNS = [
  'pl_name',
  'hostname',
  'sy_snum',
  'sy_pnum',
  'cb_flag',
  'pl_orbper',
  'pl_orbsmax',
  'pl_orbeccen',
  'pl_rade',
  'pl_bmasse',
  'pl_eqt',
  'st_spectype',
  'st_teff',
  'st_rad',
  'st_mass',
  'sy_dist',
  'disc_year',
  'discoverymethod',
  'disc_facility',
] as const;

export type PscompparsRow = Partial<Record<(typeof PSCOMPPARS_COLUMNS)[number], string | number | null>>;

export interface Rejection {
  name: string;
  reason: string;
}

/** Parse anything into a finite number or null; never NaN or Infinity. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

/** A number inside a physically meaningful range, else null (a bad cell never poisons a record). */
function ranged(v: unknown, lo: number, hi: number): number | null {
  const n = num(v);
  return n === null || n < lo || n > hi ? null : n;
}

function planetLetter(planet: string, host: string): string | null {
  if (!planet.startsWith(host)) return null;
  const rest = planet.slice(host.length).trim();
  return rest && rest.length <= 3 ? rest : null;
}

/**
 * Group planet rows by host star into systems. Rows with no planet name or host are rejected and
 * reported; a planet listed twice is kept once. `fetchedAt` stamps every record.
 */
export function normalizeExoplanetRows(
  rows: readonly PscompparsRow[],
  fetchedAt: string,
  origin: StarSystem['origin'] = 'bundled',
): { systems: StarSystem[]; rejected: Rejection[] } {
  const rejected: Rejection[] = [];
  const byHost = new Map<string, { host: string; rows: PscompparsRow[] }>();
  for (const row of rows) {
    const planet = text(row.pl_name);
    const host = text(row.hostname);
    if (!planet || !host) {
      rejected.push({ name: planet ?? host ?? '(unnamed)', reason: 'missing planet name or host star' });
      continue;
    }
    const key = systemId(host);
    const g = byHost.get(key);
    if (g) g.rows.push(row);
    else byHost.set(key, { host, rows: [row] });
  }

  const systems: StarSystem[] = [];
  for (const [id, group] of byHost) {
    const first = group.rows[0];
    const planets: SystemPlanet[] = [];
    const seen = new Set<string>();
    for (const row of group.rows) {
      const name = text(row.pl_name) as string;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      planets.push({
        name,
        letter: planetLetter(name, group.host),
        periodDays: ranged(row.pl_orbper, 1e-3, 1e9),
        smaAu: ranged(row.pl_orbsmax, 1e-4, 1e5),
        eccentricity: ranged(row.pl_orbeccen, 0, 0.9999),
        radiusEarth: ranged(row.pl_rade, 0.01, 100),
        massEarth: ranged(row.pl_bmasse, 1e-4, 1e5),
        eqTempK: ranged(row.pl_eqt, 1, 1e4),
        discoveryYear: ranged(row.disc_year, 1900, 2100),
        discoveryMethod: text(row.discoverymethod),
        discoveryFacility: text(row.disc_facility),
      });
    }
    // Innermost first; planets with no measured orbit go last, in name order.
    planets.sort((a, b) => (a.smaAu ?? a.periodDays ?? Infinity) - (b.smaAu ?? b.periodDays ?? Infinity) || a.name.localeCompare(b.name));

    const starCount = Math.max(1, Math.round(ranged(first.sy_snum, 1, 20) ?? 1));
    const listed = Math.round(ranged(first.sy_pnum, 0, 50) ?? planets.length);
    const cb = num(first.cb_flag);
    const hostConfig: PlanetHostConfig = starCount >= 2 ? (cb === 1 ? 'circumbinary' : cb === 0 ? 'circumstellar' : null) : null;
    const star: SystemStar = {
      name: group.host,
      spectralType: text(first.st_spectype),
      teff: ranged(first.st_teff, 500, 2e5),
      radiusSun: ranged(first.st_rad, 1e-3, 3000),
      massSun: ranged(first.st_mass, 1e-3, 500),
    };
    const pc = ranged(first.sy_dist, 0, 1e6);
    const years = planets.map((p) => p.discoveryYear).filter((y): y is number => y !== null);
    systems.push({
      id,
      name: group.host,
      kind: kindFromStarCount(starCount),
      starCount,
      planetCount: Math.max(listed, planets.length),
      hostConfig,
      stars: [star],
      planets,
      distanceLy: pc === null ? null : Math.round(pc * PARSEC_LY * 1000) / 1000,
      discoveryYear: years.length ? Math.min(...years) : null,
      source: 'NASA-EXOPLANET-ARCHIVE',
      sourceUrl: `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(group.host)}`,
      lastUpdated: fetchedAt,
      origin,
    });
  }
  systems.sort((a, b) => a.name.localeCompare(b.name));
  return { systems, rejected };
}

/** Structural check used on everything that enters the catalogue, bundled or imported. */
export function validateSystem(s: unknown): string[] {
  const errs: string[] = [];
  if (!s || typeof s !== 'object') return ['not an object'];
  const o = s as Partial<StarSystem>;
  if (typeof o.id !== 'string' || !o.id.startsWith('sys:') || o.id.length < 5) errs.push('bad id');
  if (typeof o.name !== 'string' || !o.name.trim()) errs.push('missing name');
  if (o.kind !== 'single' && o.kind !== 'binary' && o.kind !== 'multiple') errs.push('bad kind');
  if (typeof o.starCount !== 'number' || o.starCount < 1 || !Number.isFinite(o.starCount)) errs.push('bad star count');
  if (o.kind && typeof o.starCount === 'number' && kindFromStarCount(o.starCount) !== o.kind) errs.push('kind does not match star count');
  if (typeof o.planetCount !== 'number' || o.planetCount < 0) errs.push('bad planet count');
  if (!Array.isArray(o.stars) || o.stars.length === 0) errs.push('no host star');
  if (!Array.isArray(o.planets)) errs.push('planets not a list');
  if (typeof o.source !== 'string' || !o.source) errs.push('missing source');
  if (typeof o.lastUpdated !== 'string' || Number.isNaN(Date.parse(o.lastUpdated))) errs.push('bad lastUpdated');
  if (o.hostConfig && o.kind === 'single') errs.push('host configuration on a single star');
  const finite = (label: string, v: unknown): void => {
    if (v !== null && v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) errs.push(`${label} not finite`);
  };
  finite('distance', o.distanceLy);
  for (const st of Array.isArray(o.stars) ? o.stars : []) {
    if (!st || typeof st.name !== 'string' || !st.name) errs.push('star without a name');
    finite('teff', st?.teff);
    finite('star radius', st?.radiusSun);
    finite('star mass', st?.massSun);
  }
  for (const p of Array.isArray(o.planets) ? o.planets : []) {
    if (!p || typeof p.name !== 'string' || !p.name) {
      errs.push('planet without a name');
      continue;
    }
    finite(`${p.name} period`, p.periodDays);
    finite(`${p.name} axis`, p.smaAu);
    finite(`${p.name} radius`, p.radiusEarth);
    finite(`${p.name} mass`, p.massEarth);
    if (typeof p.eccentricity === 'number' && (p.eccentricity < 0 || p.eccentricity >= 1)) errs.push(`${p.name} eccentricity out of range`);
  }
  return errs;
}

/**
 * Merge incoming systems into an existing list. A system is one object however often it arrives:
 * the newer record replaces the older one, but a measurement the newer record lacks is kept from
 * the older one rather than lost.
 */
export function mergeSystems(existing: readonly StarSystem[], incoming: readonly StarSystem[]): { systems: StarSystem[]; added: number; updated: number } {
  const map = new Map<string, StarSystem>();
  for (const s of existing) map.set(s.id, s);
  let added = 0;
  let updated = 0;
  for (const s of incoming) {
    const old = map.get(s.id);
    if (!old) {
      map.set(s.id, s);
      added++;
      continue;
    }
    const newer = Date.parse(s.lastUpdated) >= Date.parse(old.lastUpdated) ? s : old;
    const older = newer === s ? old : s;
    const planets = newer.planets.map((p) => {
      const prev = older.planets.find((q) => q.name.toLowerCase() === p.name.toLowerCase());
      return prev ? fillNulls(p, prev) : p;
    });
    for (const p of older.planets) if (!planets.some((q) => q.name.toLowerCase() === p.name.toLowerCase())) planets.push(p);
    const stars = newer.stars.map((st, i) => (older.stars[i] && older.stars[i].name === st.name ? fillNulls(st, older.stars[i]) : st));
    map.set(s.id, { ...fillNulls(newer, older), stars, planets, planetCount: Math.max(newer.planetCount, planets.length) });
    updated++;
  }
  return { systems: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)), added, updated };
}

function fillNulls<T extends object>(primary: T, fallback: T): T {
  const out = { ...primary } as Record<string, unknown>;
  for (const [k, v] of Object.entries(fallback)) if (out[k] === null || out[k] === undefined) out[k] = v;
  return out as T;
}

// ------------------------------------------------------------------ JPL Small-Body Database

interface SbdbResponse {
  object?: { fullname?: string; des?: string; kind?: string; neo?: boolean; pha?: boolean; orbit_class?: { name?: string } };
  orbit?: { elements?: { name?: string; value?: string | number | null }[] };
  phys_par?: { name?: string; value?: string | number | null }[];
  message?: string;
  code?: string | number;
}

/** One object from `sbdb.api?sstr=...&phys-par=1`. Returns null (with a reason) when it is not a usable record. */
export function normalizeSbdb(raw: unknown, fetchedAt: string, origin: SmallBody['origin'] = 'live'): { body: SmallBody | null; reason: string } {
  if (!raw || typeof raw !== 'object') return { body: null, reason: 'empty response' };
  const r = raw as SbdbResponse;
  const obj = r.object;
  if (!obj || typeof obj.fullname !== 'string' || !obj.fullname.trim()) return { body: null, reason: r.message ?? 'no single matching object' };
  const el = new Map<string, number | null>();
  for (const e of r.orbit?.elements ?? []) if (e?.name) el.set(e.name, num(e.value));
  const phys = new Map<string, number | null>();
  for (const p of r.phys_par ?? []) if (p?.name) phys.set(p.name, num(p.value));
  const des = text(obj.des) ?? obj.fullname.trim();
  const kindCode = (obj.kind ?? '').toLowerCase();
  const kind: SmallBody['kind'] = kindCode.startsWith('c') ? 'comet' : 'asteroid';
  const e = el.get('e') ?? null;
  const body: SmallBody = {
    id: `sb:${des.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`,
    name: obj.fullname.trim().replace(/\s+/g, ' '),
    designation: des,
    kind,
    orbitClass: text(obj.orbit_class?.name),
    smaAu: ranged(el.get('a'), 1e-3, 1e6),
    eccentricity: e !== null && e >= 0 ? e : null,
    inclinationDeg: ranged(el.get('i'), 0, 180),
    periodDays: ranged(el.get('per'), 1e-2, 1e12),
    diameterKm: ranged(phys.get('diameter'), 1e-4, 1e5),
    rotationHours: ranged(phys.get('rot_per'), 1e-3, 1e6),
    albedo: ranged(phys.get('albedo'), 0, 1),
    neo: typeof obj.neo === 'boolean' ? obj.neo : null,
    pha: typeof obj.pha === 'boolean' ? obj.pha : null,
    source: 'JPL-SBDB',
    sourceUrl: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(des)}`,
    lastUpdated: fetchedAt,
    origin,
  };
  return { body, reason: '' };
}

export function validateSmallBody(b: unknown): string[] {
  const errs: string[] = [];
  if (!b || typeof b !== 'object') return ['not an object'];
  const o = b as Partial<SmallBody>;
  if (typeof o.id !== 'string' || !o.id.startsWith('sb:')) errs.push('bad id');
  if (typeof o.name !== 'string' || !o.name) errs.push('missing name');
  if (o.kind !== 'asteroid' && o.kind !== 'comet') errs.push('bad kind');
  if (o.source !== 'JPL-SBDB') errs.push('bad source');
  for (const k of ['smaAu', 'eccentricity', 'inclinationDeg', 'periodDays', 'diameterKm', 'rotationHours', 'albedo'] as const) {
    const v = o[k];
    if (v !== null && v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) errs.push(`${k} not finite`);
  }
  return errs;
}

// ------------------------------------------------------------------ JPL Horizons

/**
 * Pull the handful of physical values out of a Horizons object-data block (free text). Each value
 * is optional: Horizons formats bodies differently, and a field that is not found stays null.
 */
export function parseHorizonsPhysical(result: string): { radiusKm: number | null; massKg: number | null; rotationHours: number | null; orbitalPeriodDays: number | null } {
  const find = (re: RegExp): number | null => {
    const m = re.exec(result);
    return m ? num(m[1].replace(/[, ]/g, '')) : null;
  };
  const radiusKm = find(/(?:Vol\.?\s*[Mm]ean [Rr]adius|Mean [Rr]adius)[^=]*=\s*([0-9.,]+)/);
  let massKg: number | null = null;
  const mass = /Mass,?\s*x?\s*10\^(\d+)\s*\(?k?g?\)?\s*=\s*([0-9.]+)/.exec(result);
  if (mass) {
    const m = num(mass[2]);
    massKg = m === null ? null : m * 10 ** Number(mass[1]);
  }
  const rotationHours = find(/(?:Sidereal rot\. period|Mean sidereal day)[^=]*=\s*([0-9.]+)\s*(?:hr|h)/);
  const orbitalPeriodDays = find(/Sidereal orb\.? per(?:iod)?[^=]*=\s*([0-9.]+)\s*d/);
  return { radiusKm, massKg, rotationHours, orbitalPeriodDays };
}
