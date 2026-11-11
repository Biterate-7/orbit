/**
 * NASA Exoplanet Archive - TAP service, `pscomppars` (one composite row per confirmed planet).
 * Docs: https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html
 *
 * A secondary client for the Extrasolar Planets Encyclopaedia (exoplanet.eu) is provided as a
 * fallback for when the archive is offline; records from it are labelled with their own source
 * and are superseded by NASA records on the next successful ingestion.
 */
import type { HttpClient } from './http';
import { parseCsv } from './http';

const TAP = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';

export const EXO_COLUMNS = [
  'pl_name',
  'hostname',
  'pl_rade',
  'pl_bmasse',
  'pl_orbper',
  'pl_orbsmax',
  'pl_orbeccen',
  'pl_orbincl',
  'pl_eqt',
  'st_spectype',
  'st_teff',
  'st_lum',
  'sy_dist',
  'sy_snum',
  'sy_pnum',
  'disc_year',
  'discoverymethod',
] as const;

export type ExoRow = Record<(typeof EXO_COLUMNS)[number], string | number | null>;

/**
 * Confirmed planets with a measured radius or mass. `where` narrows the selection;
 * ordering by distance keeps the best-characterised nearby systems first.
 */
export async function fetchExoplanets(http: HttpClient, limit: number, where = ''): Promise<ExoRow[]> {
  const cond = ['(pl_rade is not null or pl_bmasse is not null)', where].filter(Boolean).join(' and ');
  const adql = `select top ${limit} ${EXO_COLUMNS.join(',')} from pscomppars where ${cond} order by sy_dist asc`;
  const url = `${TAP}?query=${encodeURIComponent(adql).replace(/%20/g, '+')}&format=json`;
  const text = await http.text(url, { timeoutMs: 90000 });
  if (text.trimStart().startsWith('<')) throw new Error('NASA Exoplanet Archive returned a non-data page (service offline or in maintenance)');
  const rows = JSON.parse(text) as ExoRow[];
  if (!Array.isArray(rows)) throw new Error('NASA Exoplanet Archive: unexpected response shape');
  return rows;
}

// ------------------------------------------------------------------ exoplanet.eu fallback

export interface ExoEuRow {
  name: string;
  planet_status: string;
  mass: string;
  radius: string;
  orbital_period: string;
  semi_major_axis: string;
  eccentricity: string;
  inclination: string;
  temp_calculated: string;
  temp_measured: string;
  discovered: string;
  detection_type: string;
  star_name: string;
  star_distance: string;
  star_sp_type: string;
  star_teff: string;
  [key: string]: string;
}

export async function fetchExoplanetEu(http: HttpClient): Promise<ExoEuRow[]> {
  const text = await http.text('https://exoplanet.eu/catalog/csv/', { timeoutMs: 240000, retries: 1 });
  const rows = parseCsv(text) as ExoEuRow[];
  if (rows.length === 0 || !('name' in rows[0])) throw new Error('exoplanet.eu: unexpected CSV');
  return rows.filter((r) => r.planet_status === 'Confirmed');
}
