/**
 * NASA/JPL Small-Body Database Query API.
 * Docs: https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html
 */
import type { HttpClient } from './http';

const BASE = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';

export const SBDB_FIELDS = [
  'spkid',
  'full_name',
  'pdes',
  'name',
  'prefix',
  'kind',
  'class',
  'e',
  'a',
  'q',
  'i',
  'per',
  'diameter',
  'rot_per',
  'albedo',
  'H',
  'spec_B',
  'spec_T',
  'GM',
  'neo',
  'pha',
] as const;

export type SbdbRow = Record<(typeof SBDB_FIELDS)[number], string | number | null>;

export interface SbdbQuery {
  label: string;
  /** 'a' asteroids, 'c' comets. */
  kind: 'a' | 'c';
  /** Orbit classes, e.g. ['TNO', 'CEN']. */
  classes?: string[];
  /** 'neo' or 'pha'. */
  group?: 'neo' | 'pha';
  /** Numbered objects only. */
  numbered?: boolean;
  /** Constraint expressions in SBDB syntax, e.g. "diameter|GT|120" or "name|DF". ANDed together. */
  where?: string[];
  sort?: string;
  limit: number;
}

interface SbdbResponse {
  fields?: string[];
  data?: (string | number | null)[][];
  count?: number;
  message?: string;
}

export async function fetchSmallBodies(http: HttpClient, q: SbdbQuery): Promise<SbdbRow[]> {
  const p = new URLSearchParams();
  p.set('fields', SBDB_FIELDS.join(','));
  p.set('sb-kind', q.kind);
  if (q.classes?.length) p.set('sb-class', q.classes.join(','));
  if (q.group) p.set('sb-group', q.group);
  if (q.numbered) p.set('sb-ns', 'n');
  if (q.where?.length) p.set('sb-cdata', JSON.stringify({ AND: q.where }));
  if (q.sort) p.set('sort', q.sort);
  p.set('limit', String(q.limit));
  const res = await http.json<SbdbResponse>(`${BASE}?${p.toString()}`);
  if (!res.fields || !res.data) throw new Error(`SBDB: unexpected response${res.message ? ` (${res.message})` : ''}`);
  const fields = res.fields;
  return res.data.map((row) => {
    const o: Record<string, string | number | null> = {};
    fields.forEach((f, i) => (o[f] = row[i] ?? null));
    return o as SbdbRow;
  });
}

/** The default set of small-body queries used to populate the catalogue. */
export const SBDB_QUERIES: SbdbQuery[] = [
  { label: 'largest asteroids', kind: 'a', where: ['diameter|GT|110'], sort: '-diameter', limit: 260 },
  { label: 'named near-Earth asteroids', kind: 'a', group: 'neo', where: ['name|DF', 'diameter|DF'], sort: '-diameter', limit: 140 },
  { label: 'trans-Neptunian objects and centaurs', kind: 'a', classes: ['TNO', 'CEN'], where: ['name|DF'], limit: 120 },
  { label: 'Jupiter trojans', kind: 'a', classes: ['TJN'], where: ['name|DF', 'diameter|GT|70'], sort: '-diameter', limit: 50 },
  { label: 'Mars crossers', kind: 'a', classes: ['MCA'], where: ['name|DF', 'diameter|GT|8'], sort: '-diameter', limit: 40 },
  { label: 'numbered periodic comets', kind: 'c', numbered: true, limit: 320 },
  { label: 'comets with measured nuclei', kind: 'c', where: ['diameter|DF'], limit: 120 },
];
