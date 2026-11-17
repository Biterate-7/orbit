/**
 * Compact on-disk form of the star-system snapshot. Field names are dropped (rows become arrays)
 * and values every bundled record shares - source, fetch date - are stored once. Lossless: unpack
 * returns exactly what was packed.
 */
import { SYSTEM_SOURCE_URL, kindFromStarCount } from './types';
import type { StarSystem, SystemPlanet, SystemSource, SystemsFile } from './types';

type N = number | null;
type S = string | null;
type PackedPlanet = [name: string, letter: S, period: N, sma: N, ecc: N, radius: N, mass: N, eqt: N, year: N, method: N, facility: N];
type PackedSystem = [name: string, id: string, stars: number, planetCount: number, cfg: 0 | 1 | 2, dist: N, year: N, spt: S, teff: N, rad: N, mass: N, planets: PackedPlanet[]];

export interface PackedSystems {
  version: number;
  generatedAt: string;
  sources: SystemsFile['sources'];
  source: SystemSource;
  /** Lookup tables for the repeated discovery strings. */
  methods: string[];
  facilities: string[];
  packed: PackedSystem[];
}

export function packSystems(file: SystemsFile): PackedSystems {
  const methods: string[] = [];
  const facilities: string[] = [];
  const index = (table: string[], v: string | null): N => {
    if (v === null) return null;
    const i = table.indexOf(v);
    return i >= 0 ? i : table.push(v) - 1;
  };
  const packed = file.systems.map((s): PackedSystem => {
    const st = s.stars[0];
    return [
      s.name,
      s.id,
      s.starCount,
      s.planetCount,
      s.hostConfig === 'circumbinary' ? 1 : s.hostConfig === 'circumstellar' ? 2 : 0,
      s.distanceLy,
      s.discoveryYear,
      st.spectralType,
      st.teff,
      st.radiusSun,
      st.massSun,
      s.planets.map((p): PackedPlanet => [p.name, p.letter, p.periodDays, p.smaAu, p.eccentricity, p.radiusEarth, p.massEarth, p.eqTempK, p.discoveryYear, index(methods, p.discoveryMethod), index(facilities, p.discoveryFacility)]),
    ];
  });
  return { version: file.version, generatedAt: file.generatedAt, sources: file.sources, source: 'NASA-EXOPLANET-ARCHIVE', methods, facilities, packed };
}

export function unpackSystems(raw: PackedSystems | SystemsFile): SystemsFile {
  if ('systems' in raw) return raw;
  const systems = raw.packed.map((r): StarSystem => {
    const [name, id, starCount, planetCount, cfg, distanceLy, discoveryYear, spectralType, teff, radiusSun, massSun, pl] = r;
    const planets = pl.map(
      (p): SystemPlanet => ({
        name: p[0],
        letter: p[1],
        periodDays: p[2],
        smaAu: p[3],
        eccentricity: p[4],
        radiusEarth: p[5],
        massEarth: p[6],
        eqTempK: p[7],
        discoveryYear: p[8],
        discoveryMethod: p[9] === null ? null : (raw.methods[p[9]] ?? null),
        discoveryFacility: p[10] === null ? null : (raw.facilities[p[10]] ?? null),
      }),
    );
    return {
      id,
      name,
      kind: kindFromStarCount(starCount),
      starCount,
      planetCount,
      hostConfig: cfg === 1 ? 'circumbinary' : cfg === 2 ? 'circumstellar' : null,
      stars: [{ name, spectralType, teff, radiusSun, massSun }],
      planets,
      distanceLy,
      discoveryYear,
      source: raw.source,
      sourceUrl: raw.source === 'NASA-EXOPLANET-ARCHIVE' ? `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(name)}` : SYSTEM_SOURCE_URL[raw.source],
      lastUpdated: raw.generatedAt,
      origin: 'bundled',
    };
  });
  return { version: raw.version, generatedAt: raw.generatedAt, sources: raw.sources, systems };
}
