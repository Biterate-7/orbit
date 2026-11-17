/**
 * Star systems: the unit the in-game astronomical catalogue is browsed and played by.
 *
 * A system groups a host star (or stars) with its known planets. Every number here comes from a
 * source database; a value the source does not give is `null` and is shown as "Unknown". Nothing
 * is estimated or invented - the only arithmetic is unit conversion (parsecs to light-years).
 *
 * Units:
 *   distanceLy      light-years
 *   teff            K
 *   radiusSun       solar radii        massSun    solar masses
 *   radiusEarth     Earth radii        massEarth  Earth masses
 *   periodDays      days               smaAu      AU
 *   eqTempK         K
 */

export type SystemSource = 'NASA-EXOPLANET-ARCHIVE' | 'JPL-HORIZONS' | 'JPL-SBDB' | 'SIMBAD';

export const SYSTEM_SOURCE_LABEL: Record<SystemSource, string> = {
  'NASA-EXOPLANET-ARCHIVE': 'NASA Exoplanet Archive',
  'JPL-HORIZONS': 'NASA/JPL Horizons',
  'JPL-SBDB': 'NASA/JPL Small-Body Database',
  SIMBAD: 'SIMBAD (CDS, Strasbourg)',
};

export const SYSTEM_SOURCE_URL: Record<SystemSource, string> = {
  'NASA-EXOPLANET-ARCHIVE': 'https://exoplanetarchive.ipac.caltech.edu/',
  'JPL-HORIZONS': 'https://ssd.jpl.nasa.gov/horizons/',
  'JPL-SBDB': 'https://ssd-api.jpl.nasa.gov/doc/sbdb.html',
  SIMBAD: 'https://simbad.cds.unistra.fr/simbad/',
};

/** single = one star, binary = two, multiple = three or more. Taken from the source's star count. */
export type SystemKind = 'single' | 'binary' | 'multiple';

/**
 * How the known planets sit in a multi-star system, when the source says.
 *   circumbinary  - the planets orbit both stars (Exoplanet Archive `cb_flag` = 1)
 *   circumstellar - the planets orbit one star of a wider pair (several stars, `cb_flag` = 0)
 */
export type PlanetHostConfig = 'circumbinary' | 'circumstellar' | null;

export interface SystemStar {
  /** Name of the host star as catalogued. */
  name: string;
  spectralType: string | null;
  teff: number | null;
  radiusSun: number | null;
  massSun: number | null;
}

export interface SystemPlanet {
  name: string;
  /** Letter or short suffix ("b", "c") when the name follows the host-plus-letter convention. */
  letter: string | null;
  periodDays: number | null;
  smaAu: number | null;
  eccentricity: number | null;
  radiusEarth: number | null;
  massEarth: number | null;
  eqTempK: number | null;
  discoveryYear: number | null;
  discoveryMethod: string | null;
  discoveryFacility: string | null;
}

export interface StarSystem {
  /** Stable id: "sys:" + slug of the system name. */
  id: string;
  name: string;
  kind: SystemKind;
  /** Number of stars the source lists for the system. */
  starCount: number;
  /** Number of planets the source lists (may exceed `planets.length` if rows were rejected). */
  planetCount: number;
  hostConfig: PlanetHostConfig;
  /** The star(s) the source describes. Companion stars it only counts are not invented here. */
  stars: SystemStar[];
  planets: SystemPlanet[];
  distanceLy: number | null;
  /** Earliest discovery year among the planets, when given. */
  discoveryYear: number | null;
  source: SystemSource;
  sourceUrl: string;
  /** ISO date the record was fetched from the source. */
  lastUpdated: string;
  /** 'bundled' = shipped with the build, 'live' = imported at run time and cached locally. */
  origin: 'bundled' | 'live';
}

/** A small body (asteroid or comet) imported at run time from the JPL Small-Body Database. */
export interface SmallBody {
  id: string;
  name: string;
  designation: string;
  kind: 'asteroid' | 'comet';
  /** Orbit class as named by JPL, e.g. "Amor", "Main-belt Asteroid", "Jupiter-family Comet". */
  orbitClass: string | null;
  smaAu: number | null;
  eccentricity: number | null;
  inclinationDeg: number | null;
  periodDays: number | null;
  diameterKm: number | null;
  rotationHours: number | null;
  albedo: number | null;
  /** True for near-Earth objects / potentially hazardous asteroids, as flagged by JPL. */
  neo: boolean | null;
  pha: boolean | null;
  source: 'JPL-SBDB';
  sourceUrl: string;
  lastUpdated: string;
  origin: 'bundled' | 'live';
}

export interface SystemsFile {
  version: number;
  generatedAt: string;
  /** Per-source outcome of the ingestion that produced the file. */
  sources: Record<string, { ok: boolean; count: number; note: string; fetchedAt: string }>;
  systems: StarSystem[];
}

export const PARSEC_LY = 3.2615637769;

export function systemId(name: string): string {
  return `sys:${name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;
}

export function kindFromStarCount(n: number): SystemKind {
  return n >= 3 ? 'multiple' : n === 2 ? 'binary' : 'single';
}
