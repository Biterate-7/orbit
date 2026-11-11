/**
 * NASA/JPL Horizons API - osculating orbital elements, state vectors and the physical data sheet
 * for major solar-system bodies.
 * Docs: https://ssd-api.jpl.nasa.gov/doc/horizons.html
 */
import type { HttpClient } from './http';

const BASE = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const KM_PER_AU = 149597870.7;
/** G in km^3 kg^-1 s^-2, used to convert JPL's GM into a mass when no mass line is published. */
const G_KM = 6.6743e-20;

export interface HorizonsTarget {
  /** Horizons body id, e.g. '599'. */
  id: string;
  name: string;
  /** Horizons centre, e.g. '500@10' (Sun) or '500@599' (Jupiter). */
  center: string;
  kind: 'star' | 'planet' | 'dwarf-planet' | 'moon';
  parent?: string;
}

export interface HorizonsBody {
  target: HorizonsTarget;
  epoch: string;
  elements: { e: number; incDeg: number; aAu: number; periodDays: number } | null;
  vector: { position: [number, number, number]; velocity: [number, number, number] } | null;
  physical: { radiusKm: number | null; massKg: number | null; rotationHours: number | null; temperatureK: number | null; luminositySun: number | null };
}

interface HorizonsResponse {
  result?: string;
  error?: string;
}

async function call(http: HttpClient, params: Record<string, string>): Promise<string> {
  const q = Object.entries({ format: 'json', ...params })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const res = await http.json<HorizonsResponse>(`${BASE}?${q}`);
  if (res.error || !res.result) throw new Error(`Horizons: ${res.error ?? 'empty result'}`);
  return res.result;
}

const first = (text: string, res: RegExp[]): RegExpExecArray | null => {
  for (const re of res) {
    const m = re.exec(text);
    if (m) return m;
  }
  return null;
};

/** Parse the free-text physical data sheet. Anything that does not match cleanly stays null. */
export function parsePhysical(sheet: string, periodDays: number | null): HorizonsBody['physical'] {
  const out: HorizonsBody['physical'] = { radiusKm: null, massKg: null, rotationHours: null, temperatureK: null, luminositySun: null };

  const r = first(sheet, [/Vol\.\s*[Mm]ean\s*[Rr]adius[^=\n]*=\s*([\d.]+)/, /Mean\s+[Rr]adius\s*\(km\)\s*=\s*([\d.]+)/, /Radius\s*\(km\)\s*=\s*([\d.]+)/]);
  if (r) out.radiusKm = Number(r[1]);

  // GM is the quantity JPL actually measures, so prefer it. The printed mass line comes in several
  // layouts, including a trailing "(10^-4)" multiplier for tiny moons, which must not be dropped.
  const gm = /GM,?\s*\(?km\^3\/s\^2\)?\s*=\s*([\d.]+)/.exec(sheet);
  if (gm && Number(gm[1]) > 0) out.massKg = Number(gm[1]) / G_KM;
  else {
    const m = /Mass,?\s*x?\s*\(?10\^(\d+)\s*\(?kg\s*\)?\s*=\s*~?\s*([\d.]+)(?:\s*\(10\^(-?\d+)\))?/.exec(sheet);
    if (m) out.massKg = Number(m[2]) * 10 ** (Number(m[1]) + (m[3] ? Number(m[3]) : 0));
  }

  const rot = /(?:Sid\. rot\. period|Rotational period|Mean sidereal day, hr|Sidereal rot\. period)[^=\n]*=\s*([^\n]*)/.exec(sheet);
  if (rot) {
    const v = rot[1];
    const hms = /(\d+)\s*h\s*(\d+)\s*m\s*([\d.]+)\s*s/.exec(v);
    const hrs = /^~?\s*(-?[\d.]+)\s*(?:h|hr|hrs)\b/.exec(v);
    const days = /^~?\s*(-?[\d.]+)\s*d\b/.exec(v);
    const plain = /^~?\s*(-?[\d.]+)/.exec(v);
    if (hms) out.rotationHours = Number(hms[1]) + Number(hms[2]) / 60 + Number(hms[3]) / 3600;
    else if (hrs) out.rotationHours = Math.abs(Number(hrs[1]));
    else if (days) out.rotationHours = Math.abs(Number(days[1])) * 24;
    else if (/synchronous/i.test(v) && periodDays) out.rotationHours = periodDays * 24;
    else if (plain && /hr/.test(rot[0])) out.rotationHours = Math.abs(Number(plain[1]));
  }

  const t = first(sheet, [/Effective temp, K\s*=\s*~?\s*([\d.]+)/, /Atmos\. temp\. \(1 bar\)\s*=\s*~?\s*([\d.]+)/, /Mean (?:surface )?temp(?:erature)?\.?\s*\(K\)\s*=\s*~?\s*([\d.]+)/]);
  if (t) out.temperatureK = Number(t[1]);

  // The Sun's sheet lists luminosity in 10^24 J/s; by definition that is one solar luminosity.
  if (/Luminosity, 10\^24 J\/s\s*=\s*[\d.]+/.test(sheet)) out.luminositySun = 1;

  for (const k of Object.keys(out) as (keyof typeof out)[]) {
    const v = out[k];
    if (v !== null && !(Number.isFinite(v) && v > 0)) out[k] = null;
  }
  return out;
}

function parsePairs(block: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /([A-Z]{1,2})\s*=\s*([-+]?\d\.\d+E[-+]\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) if (!(m[1] in out)) out[m[1]] = Number(m[2]);
  return out;
}

const between = (text: string): string | null => {
  const a = text.indexOf('$$SOE');
  const b = text.indexOf('$$EOE');
  return a >= 0 && b > a ? text.slice(a + 5, b) : null;
};

/** Fetch elements + physical sheet + state vector for one body at `epoch` (YYYY-MM-DD). */
export async function fetchBody(http: HttpClient, target: HorizonsTarget, epoch: string): Promise<HorizonsBody> {
  const next = new Date(Date.parse(`${epoch}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const common = { COMMAND: `'${target.id}'`, START_TIME: `'${epoch}'`, STOP_TIME: `'${next}'`, STEP_SIZE: "'1 d'", OUT_UNITS: "'KM-S'" };
  const isSun = target.id === '10';

  let elements: HorizonsBody['elements'] = null;
  let sheet = '';
  if (isSun) {
    sheet = await call(http, { COMMAND: "'10'", OBJ_DATA: "'YES'", MAKE_EPHEM: "'NO'" });
  } else {
    const text = await call(http, { ...common, OBJ_DATA: "'YES'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'ELEMENTS'", CENTER: `'${target.center}'` });
    sheet = text.split('Ephemeris /')[0];
    const block = between(text);
    if (block) {
      const p = parsePairs(block);
      if ([p.EC, p.IN, p.A, p.PR].every((v) => Number.isFinite(v)) && p.A > 0 && p.PR > 0) {
        elements = { e: p.EC, incDeg: p.IN, aAu: p.A / KM_PER_AU, periodDays: p.PR / 86400 };
      }
    }
  }

  let vector: HorizonsBody['vector'] = null;
  if (!isSun) {
    const text = await call(http, { ...common, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'VECTORS'", VEC_TABLE: "'2'", CENTER: `'${target.center}'` });
    const block = between(text);
    if (block) {
      const p = parsePairs(block);
      if ([p.X, p.Y, p.Z, p.VX, p.VY, p.VZ].every((v) => Number.isFinite(v))) {
        vector = { position: [p.X, p.Y, p.Z], velocity: [p.VX, p.VY, p.VZ] };
      }
    }
  }

  return { target, epoch, elements, vector, physical: parsePhysical(sheet, elements?.periodDays ?? null) };
}

const moon = (id: string, name: string, parentId: string, parent: string): HorizonsTarget => ({ id, name, center: `500@${parentId}`, kind: 'moon', parent });

export const HORIZONS_TARGETS: HorizonsTarget[] = [
  { id: '10', name: 'Sun', center: '500@0', kind: 'star' },
  { id: '199', name: 'Mercury', center: '500@10', kind: 'planet' },
  { id: '299', name: 'Venus', center: '500@10', kind: 'planet' },
  { id: '399', name: 'Earth', center: '500@10', kind: 'planet' },
  { id: '499', name: 'Mars', center: '500@10', kind: 'planet' },
  { id: '599', name: 'Jupiter', center: '500@10', kind: 'planet' },
  { id: '699', name: 'Saturn', center: '500@10', kind: 'planet' },
  { id: '799', name: 'Uranus', center: '500@10', kind: 'planet' },
  { id: '899', name: 'Neptune', center: '500@10', kind: 'planet' },
  { id: '999', name: 'Pluto', center: '500@10', kind: 'dwarf-planet' },
  moon('301', 'Moon', '399', 'Earth'),
  moon('401', 'Phobos', '499', 'Mars'),
  moon('402', 'Deimos', '499', 'Mars'),
  moon('501', 'Io', '599', 'Jupiter'),
  moon('502', 'Europa', '599', 'Jupiter'),
  moon('503', 'Ganymede', '599', 'Jupiter'),
  moon('504', 'Callisto', '599', 'Jupiter'),
  moon('601', 'Mimas', '699', 'Saturn'),
  moon('602', 'Enceladus', '699', 'Saturn'),
  moon('603', 'Tethys', '699', 'Saturn'),
  moon('604', 'Dione', '699', 'Saturn'),
  moon('605', 'Rhea', '699', 'Saturn'),
  moon('606', 'Titan', '699', 'Saturn'),
  moon('608', 'Iapetus', '699', 'Saturn'),
  moon('701', 'Ariel', '799', 'Uranus'),
  moon('702', 'Umbriel', '799', 'Uranus'),
  moon('703', 'Titania', '799', 'Uranus'),
  moon('704', 'Oberon', '799', 'Uranus'),
  moon('705', 'Miranda', '799', 'Uranus'),
  moon('801', 'Triton', '899', 'Neptune'),
  moon('901', 'Charon', '999', 'Pluto'),
];
