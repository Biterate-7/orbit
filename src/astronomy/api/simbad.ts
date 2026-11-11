/**
 * SIMBAD (CDS) TAP service. The Strasbourg host and the Harvard mirror serve the same database.
 * Docs: https://simbad.cds.unistra.fr/simbad/sim-tap
 */
import type { HttpClient } from './http';
import { parseCsv } from './http';

export const SIMBAD_MIRRORS = ['https://simbad.cds.unistra.fr', 'https://simbad.cfa.harvard.edu'] as const;
const PATH = '/simbad/sim-tap/sync';

export interface SimbadRow {
  main_id: string;
  otype: string;
  sp_type: string;
  ra: string;
  dec: string;
  plx_value: string;
  nbref: string;
  V: string;
  B: string;
  [key: string]: string;
}

export async function simbadQuery(http: HttpClient, adql: string): Promise<Record<string, string>[]> {
  const text = await http.textFromMirrors(SIMBAD_MIRRORS, PATH, {
    method: 'POST',
    form: { request: 'doQuery', lang: 'adql', format: 'csv', query: adql },
    timeoutMs: 90000,
  });
  if (text.trimStart().startsWith('<')) {
    const m = /QUERY_STATUS" value="ERROR">([^<]*)/.exec(text);
    throw new Error(`SIMBAD query rejected: ${m ? m[1].trim() : 'unknown error'}`);
  }
  return parseCsv(text);
}

const COLS = 'main_id, otype, sp_type, ra, dec, plx_value, nbref, V, B';

/** Brightest stars in the sky with a spectral classification. */
export async function fetchBrightStars(http: HttpClient, vMax: number, top: number): Promise<SimbadRow[]> {
  const q = `SELECT TOP ${top} ${COLS} FROM basic JOIN allfluxes ON oidref=oid WHERE V < ${vMax} AND sp_type IS NOT NULL ORDER BY V ASC`;
  return (await simbadQuery(http, q)) as SimbadRow[];
}

/** Nearest stars (largest parallax) with a spectral classification. */
export async function fetchNearbyStars(http: HttpClient, plxMin: number, top: number): Promise<SimbadRow[]> {
  const q = `SELECT TOP ${top} ${COLS} FROM basic LEFT JOIN allfluxes ON oidref=oid WHERE plx_value > ${plxMin} AND sp_type IS NOT NULL ORDER BY plx_value DESC`;
  return (await simbadQuery(http, q)) as SimbadRow[];
}

/** The most-studied objects of one SIMBAD object type (ranked by number of references). */
export async function fetchByType(http: HttpClient, otype: string, top: number): Promise<SimbadRow[]> {
  const q = `SELECT TOP ${top} ${COLS} FROM basic LEFT JOIN allfluxes ON oidref=oid WHERE otype='${otype}' ORDER BY nbref DESC`;
  return (await simbadQuery(http, q)) as SimbadRow[];
}

const quoteList = (ids: string[]): string => ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',');

async function batched<T>(ids: string[], size: number, fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
  return out;
}

/** Common names ("NAME Betelgeuse") for a set of main identifiers. */
export async function fetchCommonNames(http: HttpClient, ids: string[]): Promise<Map<string, string[]>> {
  const rows = await batched(ids, 80, (chunk) =>
    simbadQuery(http, `SELECT main_id, id FROM basic JOIN ident ON oidref=oid WHERE main_id IN (${quoteList(chunk)}) AND id LIKE 'NAME %'`),
  );
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.main_id) ?? [];
    list.push(r.id.replace(/^NAME\s+/, ''));
    map.set(r.main_id, list);
  }
  return map;
}

/** Mean of the literature effective-temperature measurements SIMBAD compiles for each object. */
export async function fetchTemperatures(http: HttpClient, ids: string[]): Promise<Map<string, { teff: number; n: number }>> {
  const rows = await batched(ids, 80, (chunk) =>
    simbadQuery(
      http,
      `SELECT main_id, AVG(teff) AS teff, COUNT(*) AS n FROM basic JOIN mesFe_h ON oidref=oid WHERE main_id IN (${quoteList(chunk)}) AND teff > 0 GROUP BY main_id`,
    ),
  );
  const map = new Map<string, { teff: number; n: number }>();
  for (const r of rows) {
    const teff = Number(r.teff);
    if (Number.isFinite(teff) && teff > 0) map.set(r.main_id, { teff: Math.round(teff), n: Number(r.n) || 1 });
  }
  return map;
}

/** Object types pulled from SIMBAD and how many of each. */
export const SIMBAD_TYPE_QUERIES: { otype: string; top: number }[] = [
  { otype: 'Psr', top: 60 },
  { otype: 'N*', top: 16 },
  { otype: 'WD*', top: 40 },
  { otype: 'BH', top: 3 },
  { otype: 'HXB', top: 30 },
  { otype: 'LXB', top: 20 },
  { otype: 'SNR', top: 40 },
  { otype: 'PN', top: 45 },
  { otype: 'HII', top: 35 },
  { otype: 'RNe', top: 15 },
  { otype: 'DNe', top: 12 },
  { otype: 'MoC', top: 12 },
  { otype: 'cC*', top: 30 },
  { otype: 'Mi*', top: 30 },
  { otype: 'RR*', top: 20 },
  { otype: 'WR*', top: 30 },
  { otype: 'No*', top: 15 },
  { otype: 'EB*', top: 30 },
  { otype: 'SB*', top: 30 },
  { otype: 's*b', top: 20 },
  { otype: 's*r', top: 20 },
  { otype: 'BD*', top: 15 },
  { otype: 'TT*', top: 15 },
];
