/**
 * Unified astronomical object schema.
 *
 * Every record in the local catalogue has this shape regardless of which database it came from.
 * Missing measurements are `null` - nothing here is ever estimated or invented by the game.
 *
 * Units (fixed for the whole catalogue):
 *   radius            km
 *   mass              kg
 *   temperature       K      (effective temperature for stars, equilibrium / surface for planets)
 *   luminosity        solar luminosities
 *   rotationPeriod    hours
 *   eccentricity      dimensionless
 *   inclination       degrees
 *   semiMajorAxis     AU
 *   orbitalPeriod     days
 */

export type AstroCategory =
  | 'star'
  | 'planet'
  | 'moon'
  | 'dwarf-planet'
  | 'asteroid'
  | 'comet'
  | 'exoplanet'
  | 'stellar-remnant'
  | 'nebula'
  | 'galaxy'
  | 'quasar';

export const CATEGORY_LABEL: Record<AstroCategory, string> = {
  star: 'STARS',
  planet: 'PLANETS',
  moon: 'MOONS',
  'dwarf-planet': 'DWARF PLANETS',
  asteroid: 'ASTEROIDS',
  comet: 'COMETS',
  exoplanet: 'EXOPLANETS',
  'stellar-remnant': 'STELLAR REMNANTS',
  nebula: 'NEBULAE',
  galaxy: 'GALAXIES',
  quasar: 'QUASARS & ACTIVE NUCLEI',
};

export type SourceId = 'JPL-SBDB' | 'JPL-HORIZONS' | 'NASA-EXOPLANET-ARCHIVE' | 'EXOPLANET-EU' | 'SIMBAD' | 'NED';

export const SOURCE_LABEL: Record<SourceId, string> = {
  'JPL-SBDB': 'NASA/JPL Small-Body Database',
  'JPL-HORIZONS': 'NASA/JPL Horizons',
  'NASA-EXOPLANET-ARCHIVE': 'NASA Exoplanet Archive',
  'EXOPLANET-EU': 'Extrasolar Planets Encyclopaedia (exoplanet.eu)',
  SIMBAD: 'SIMBAD (CDS, Strasbourg)',
  NED: 'NASA/IPAC Extragalactic Database',
};

export const SOURCE_URL: Record<SourceId, string> = {
  'JPL-SBDB': 'https://ssd.jpl.nasa.gov/tools/sbdb_query.html',
  'JPL-HORIZONS': 'https://ssd.jpl.nasa.gov/horizons/',
  'NASA-EXOPLANET-ARCHIVE': 'https://exoplanetarchive.ipac.caltech.edu/',
  'EXOPLANET-EU': 'https://exoplanet.eu/',
  SIMBAD: 'https://simbad.cds.unistra.fr/simbad/',
  NED: 'https://ned.ipac.caltech.edu/',
};

/** When several sources describe the same object, the higher priority one wins field by field. */
export const SOURCE_PRIORITY: Record<SourceId, number> = {
  'JPL-HORIZONS': 6,
  'JPL-SBDB': 5,
  'NASA-EXOPLANET-ARCHIVE': 4,
  NED: 3,
  SIMBAD: 2,
  'EXOPLANET-EU': 1,
};

export interface PhysicalProperties {
  radius: number | null;
  mass: number | null;
  temperature: number | null;
  luminosity: number | null;
  rotationPeriod: number | null;
}

export interface OrbitalProperties {
  eccentricity: number | null;
  inclination: number | null;
  semiMajorAxis: number | null;
  orbitalPeriod: number | null;
}

export interface VisualProperties {
  /** Small preview image hosted by NASA. Only set when the image was matched to this specific object. */
  imageUrl: string | null;
  /** Page / asset id the image came from, e.g. "NASA Image and Video Library · PIA03606". */
  imageSource: string | null;
  /** Credit line as published with the image. */
  imageAttribution: string | null;
  /** Hex colours, most dominant first. See `colorSource` for where they came from. */
  dominantColors: string[];
  /** 'image' = sampled from the matched NASA image, 'derived' = computed from catalogue properties. */
  colorSource: 'image' | 'derived';
  visualDescription: string;
}

/** State vector snapshot from JPL Horizons (ecliptic J2000). */
export interface Ephemeris {
  /** ISO date of the snapshot (TDB). */
  epoch: string;
  /** Horizons id of the centre body the vector is relative to. */
  center: string;
  /** km */
  position: [number, number, number];
  /** km/s */
  velocity: [number, number, number];
}

/** Catalogue context that does not fit the physical / orbital blocks. All optional data is nullable. */
export interface AstroContext {
  /** Raw object type code from the source (SIMBAD otype, NED type, SBDB orbit class ...). */
  objectType: string | null;
  spectralType: string | null;
  /** Name of the body or star this object orbits, when the source states it. */
  hostName: string | null;
  /** Catalogue id of the parent body for moons. */
  parentId: string | null;
  /** Distance from the Sun in light-years (from parallax or the source's own distance column). */
  distanceLy: number | null;
  redshift: number | null;
  /** ICRS right ascension / declination, degrees. */
  ra: number | null;
  dec: number | null;
  /** Number of stars in the system (Exoplanet Archive `sy_snum`). */
  starsInSystem: number | null;
  discoveryYear: number | null;
  /** Geometric albedo (small bodies). */
  albedo: number | null;
  /** Asteroid taxonomic class (SMASS / Tholen). */
  taxonomy: string | null;
  /** Host star effective temperature, K (exoplanets). */
  hostTemperature: number | null;
  /** How often the object is cited / cross-referenced - used only to rank what is worth ingesting. */
  notability: number | null;
  ephemeris: Ephemeris | null;
}

export interface AstroObject {
  id: string;
  name: string;
  designation: string;
  category: AstroCategory;
  classification: string;
  physicalProperties: PhysicalProperties;
  orbitalProperties: OrbitalProperties;
  visualProperties: VisualProperties;
  context: AstroContext;
  source: SourceId;
  /** Other databases that contributed fields after deduplication. */
  alsoIn: SourceId[];
  lastUpdated: string;
}

/** Tiny palette-indexed pixel-art translation of a matched NASA image (built at ingestion time). */
export interface PixelSprite {
  w: number;
  h: number;
  palette: string[];
  /** Row-major palette indices, one hex digit per pixel. */
  data: string;
}

export interface CatalogueFile {
  version: number;
  generatedAt: string;
  /** Per-source ingestion outcome of the run that produced this file. */
  sources: Record<string, { ok: boolean; count: number; note: string; fetchedAt: string }>;
  objects: AstroObject[];
}

export const EMPTY_PHYSICAL: PhysicalProperties = { radius: null, mass: null, temperature: null, luminosity: null, rotationPeriod: null };
export const EMPTY_ORBITAL: OrbitalProperties = { eccentricity: null, inclination: null, semiMajorAxis: null, orbitalPeriod: null };
export const EMPTY_CONTEXT: AstroContext = {
  objectType: null,
  spectralType: null,
  hostName: null,
  parentId: null,
  distanceLy: null,
  redshift: null,
  ra: null,
  dec: null,
  starsInSystem: null,
  discoveryYear: null,
  albedo: null,
  taxonomy: null,
  hostTemperature: null,
  notability: null,
  ephemeris: null,
};

/** Parse anything into a finite number or null. Never produces NaN / Infinity. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Structural validation used by the ingestion pipeline and the tests. Returns a list of problems. */
export function validateObject(o: AstroObject): string[] {
  const errs: string[] = [];
  if (!o.id) errs.push('missing id');
  if (!o.name) errs.push('missing name');
  if (!o.category) errs.push('missing category');
  if (!o.source) errs.push('missing source');
  const check = (label: string, v: number | null, lo: number, hi: number): void => {
    if (v === null) return;
    if (!Number.isFinite(v)) errs.push(`${label} not finite`);
    else if (v < lo || v > hi) errs.push(`${label} out of range (${v})`);
  };
  const p = o.physicalProperties;
  const q = o.orbitalProperties;
  check('radius', p.radius, 0, 1e13);
  check('mass', p.mass, 0, 1e45);
  check('temperature', p.temperature, 0, 1e9);
  check('luminosity', p.luminosity, 0, 1e15);
  check('rotationPeriod', p.rotationPeriod, 0, 1e7);
  check('eccentricity', q.eccentricity, 0, 20);
  check('inclination', q.inclination, 0, 180);
  check('semiMajorAxis', q.semiMajorAxis, -1e7, 1e7);
  check('orbitalPeriod', q.orbitalPeriod, 0, 1e13);
  for (const c of o.visualProperties.dominantColors) if (!/^#[0-9a-f]{6}$/.test(c)) errs.push(`bad colour ${c}`);
  if (o.visualProperties.imageUrl && !o.visualProperties.imageAttribution) errs.push('image without attribution');
  return errs;
}
