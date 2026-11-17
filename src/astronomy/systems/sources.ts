/**
 * The external services star-system data is retrieved from, and the queries sent to them.
 *
 *   exo       NASA Exoplanet Archive TAP, table `pscomppars`
 *             https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html
 *   sbdb      NASA/JPL Small-Body Database lookup   https://ssd-api.jpl.nasa.gov/doc/sbdb.html
 *   horizons  NASA/JPL Horizons                     https://ssd-api.jpl.nasa.gov/doc/horizons.html
 *
 * Everything here is transport-agnostic: callers pass a `fetchText(upstream, query)` function. The
 * ingestion script uses Node's fetch; the game goes through a same-origin proxy (web) or the
 * desktop app's main process, because these services do not send CORS headers.
 */
import { PSCOMPPARS_COLUMNS, normalizeExoplanetRows, normalizeSbdb, parseHorizonsPhysical } from './normalize';
import type { PscompparsRow, Rejection } from './normalize';
import type { SmallBody, StarSystem } from './types';

export type Upstream = 'exo' | 'sbdb' | 'horizons';

/** The only hosts the game (or its proxy) will ever contact. */
export const UPSTREAMS: Record<Upstream, string> = {
  exo: 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync',
  sbdb: 'https://ssd-api.jpl.nasa.gov/sbdb.api',
  horizons: 'https://ssd.jpl.nasa.gov/api/horizons.api',
};

export function isUpstream(v: unknown): v is Upstream {
  return v === 'exo' || v === 'sbdb' || v === 'horizons';
}

/** Fetch `UPSTREAMS[upstream] + '?' + query` and return the body as text. Throws on failure. */
export type FetchText = (upstream: Upstream, query: string) => Promise<string>;

/**
 * Systems worth shipping with the build: multi-planet, circumbinary, multi-star or nearby. The
 * selection is split into disjoint partitions fetched one request each - the archive's ORDER BY
 * collation differs from its string comparison, so keyset paging on a name silently drops rows.
 */
export const BUNDLE_PARTITIONS = [
  'sy_pnum>=3',
  'sy_pnum<3 and cb_flag=1',
  'sy_pnum<3 and cb_flag=0 and sy_snum>=2',
  'sy_pnum<3 and cb_flag=0 and sy_snum<2 and sy_dist<25',
];

/** Systems the game names explicitly as playable examples; always part of the bundle. */
export const SHOWCASE_HOSTS = ['TRAPPIST-1', 'Kepler-16', 'Proxima Cen', 'Kepler-90', 'Kepler-47', 'TOI-700', '55 Cnc', 'Kepler-11', 'HD 10180', 'tau Cet', 'eps Eri', 'Kepler-444', 'TOI-178', 'HR 8799', 'Kepler-34', 'Kepler-35', 'Kepler-1647', 'TOI-1338 A'];

/** Strip a search term down to characters that occur in star names, so it is safe inside an ADQL literal. */
export function sanitizeTerm(term: string): string {
  return term.replace(/[^A-Za-z0-9 +\-.]/g, '').trim().slice(0, 40);
}

function tapQuery(where: string, top: number): string {
  const cols = PSCOMPPARS_COLUMNS.join(',');
  const adql = `select top ${top} ${cols} from pscomppars where ${where}`;
  return `query=${encodeURIComponent(adql)}&format=json`;
}

function parseRows(body: string): PscompparsRow[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('NASA Exoplanet Archive returned something that is not JSON');
  }
  if (!Array.isArray(data)) throw new Error('NASA Exoplanet Archive returned an unexpected shape');
  return data.filter((r): r is PscompparsRow => !!r && typeof r === 'object');
}

export interface ExoFetchOptions {
  /** Row cap per request. A partition that reaches it is reported as truncated. */
  pageSize?: number;
  origin?: StarSystem['origin'];
  now?: () => string;
  onPage?: (rows: number, page: number) => void;
}

/**
 * Planet rows matching each `where` partition (one request per partition), grouped into systems.
 * A row that arrives from more than one partition is deduplicated by the normaliser.
 */
export async function fetchExoplanetSystems(
  fetchText: FetchText,
  where: string | readonly string[],
  opts: ExoFetchOptions = {},
): Promise<{ systems: StarSystem[]; rejected: Rejection[]; rows: number; pages: number; truncated: boolean }> {
  const pageSize = opts.pageSize ?? 3000;
  const parts = typeof where === 'string' ? [where] : where;
  const rows: PscompparsRow[] = [];
  let pages = 0;
  let truncated = false;
  for (const part of parts) {
    const page = parseRows(await fetchText('exo', tapQuery(part, pageSize)));
    pages++;
    rows.push(...page);
    if (page.length >= pageSize) truncated = true;
    opts.onPage?.(page.length, pages);
  }
  const fetchedAt = (opts.now ?? (() => new Date().toISOString()))();
  const { systems, rejected } = normalizeExoplanetRows(rows, fetchedAt, opts.origin ?? 'bundled');
  return { systems, rejected, rows: rows.length, pages, truncated };
}

/** Systems whose host-star name contains `term` (case-insensitive). */
export function searchWhere(term: string): string {
  const t = sanitizeTerm(term).toLowerCase();
  return `lower(hostname) like '%${t}%'`;
}

export function hostsWhere(hosts: readonly string[]): string {
  return `hostname in (${hosts.map((h) => `'${sanitizeTerm(h)}'`).join(',')})`;
}

/** Look one small body up by name or designation ("433", "Eros", "1P", "Halley"). */
export async function fetchSmallBody(fetchText: FetchText, term: string, now = (): string => new Date().toISOString()): Promise<{ body: SmallBody | null; reason: string }> {
  const q = sanitizeTerm(term).replace(/\./g, '');
  if (!q) return { body: null, reason: 'empty search' };
  const text = await fetchText('sbdb', `sstr=${encodeURIComponent(q)}&phys-par=1`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { body: null, reason: 'JPL Small-Body Database returned something that is not JSON' };
  }
  return normalizeSbdb(data, now());
}

/** Physical data of a major body from Horizons (e.g. 499 = Mars). Fields it does not state stay null. */
export async function fetchHorizonsBody(fetchText: FetchText, id: string): Promise<ReturnType<typeof parseHorizonsPhysical> & { ok: boolean }> {
  const safe = id.replace(/[^0-9A-Za-z]/g, '').slice(0, 12);
  const text = await fetchText('horizons', `format=json&COMMAND='${safe}'&OBJ_DATA='YES'&MAKE_EPHEM='NO'`);
  try {
    const data = JSON.parse(text) as { result?: string };
    if (typeof data.result !== 'string') return { ok: false, radiusKm: null, massKg: null, rotationHours: null, orbitalPeriodDays: null };
    return { ok: true, ...parseHorizonsPhysical(data.result) };
  } catch {
    return { ok: false, radiusKm: null, massKg: null, rotationHours: null, orbitalPeriodDays: null };
  }
}
