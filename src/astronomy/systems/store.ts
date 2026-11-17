/**
 * The in-game star-system catalogue.
 *
 * Three layers, merged into one list:
 *   1. the bundled snapshot of the NASA Exoplanet Archive (src/astronomy/data/systems.json),
 *   2. systems assembled from the bundled object catalogue: the Solar System (JPL Horizons) and
 *      binary stars identified by SIMBAD,
 *   3. systems and small bodies imported while playing and cached locally (see live.ts).
 *
 * Nothing here touches the network; missions only ever read this in-memory catalogue.
 */
import systemsRaw from '../data/systems.json?raw';
import { getCatalogue } from '../database/catalogue';
import type { Catalogue } from '../database/catalogue';
import type { AstroObject } from '../database/schema';
import { unpackSystems } from './codec';
import type { PackedSystems } from './codec';
import { mergeSystems, validateSmallBody, validateSystem } from './normalize';
import { SYSTEM_SOURCE_URL, kindFromStarCount } from './types';
import type { SmallBody, StarSystem, SystemKind, SystemPlanet, SystemsFile } from './types';

const EARTH_RADIUS_KM = 6371;
const EARTH_MASS_KG = 5.9722e24;
const SUN_RADIUS_KM = 695700;
const SUN_MASS_KG = 1.98841e30;

export const SOLAR_SYSTEM_ID = 'sys:solar-system';

/** Names a system is also known by. The archive files Kepler-90 under its KOI number. */
export const SYSTEM_ALIASES: Record<string, string[]> = {
  'sys:koi-351': ['Kepler-90'],
  'sys:proxima-cen': ['Proxima Centauri', 'Alpha Centauri C'],
  'sys:solar-system': ['Sol', 'Sun'],
  'sys:eps-eri': ['Epsilon Eridani'],
  'sys:tau-cet': ['Tau Ceti'],
  'sys:55-cnc': ['55 Cancri', 'Copernicus'],
};

/** The Solar System, assembled from the Horizons records already in the object catalogue. */
export function solarSystemFrom(catalogue: Catalogue): StarSystem | null {
  const sun = catalogue.get('horizons:10');
  if (!sun) return null;
  const planets: SystemPlanet[] = catalogue.objects
    .filter((o) => o.source === 'JPL-HORIZONS' && o.category === 'planet' && o.context.hostName === 'Sun')
    .sort((a, b) => (a.orbitalProperties.semiMajorAxis ?? Infinity) - (b.orbitalProperties.semiMajorAxis ?? Infinity))
    .map((o) => ({
      name: o.name,
      letter: null,
      periodDays: o.orbitalProperties.orbitalPeriod,
      smaAu: o.orbitalProperties.semiMajorAxis,
      eccentricity: o.orbitalProperties.eccentricity,
      radiusEarth: o.physicalProperties.radius === null ? null : o.physicalProperties.radius / EARTH_RADIUS_KM,
      massEarth: o.physicalProperties.mass === null ? null : o.physicalProperties.mass / EARTH_MASS_KG,
      eqTempK: null,
      discoveryYear: o.context.discoveryYear,
      discoveryMethod: null,
      discoveryFacility: null,
    }));
  if (planets.length === 0) return null;
  return {
    id: SOLAR_SYSTEM_ID,
    name: 'Solar System',
    kind: 'single',
    starCount: 1,
    planetCount: planets.length,
    hostConfig: null,
    stars: [
      {
        name: 'Sun',
        spectralType: sun.context.spectralType,
        teff: sun.physicalProperties.temperature,
        radiusSun: sun.physicalProperties.radius === null ? null : sun.physicalProperties.radius / SUN_RADIUS_KM,
        massSun: sun.physicalProperties.mass === null ? null : sun.physicalProperties.mass / SUN_MASS_KG,
      },
    ],
    planets,
    distanceLy: null,
    discoveryYear: null,
    source: 'JPL-HORIZONS',
    sourceUrl: SYSTEM_SOURCE_URL['JPL-HORIZONS'],
    lastUpdated: sun.lastUpdated,
    origin: 'bundled',
  };
}

/** SIMBAD object types that state a two-star system outright. */
const SIMBAD_BINARY = new Set(['SB*', 'EB*', 'El*', 'RS*', 'Sy*']);

/** Is this SIMBAD record reliably a binary? Type code, or a "double" entry whose spectrum lists exactly two components. */
export function isSimbadBinary(o: AstroObject): boolean {
  if (o.source !== 'SIMBAD' && !o.alsoIn.includes('SIMBAD')) return false;
  const t = o.context.objectType ?? '';
  if (SIMBAD_BINARY.has(t)) return true;
  return t === '**' && (o.context.spectralType ?? '').split('+').length === 2;
}

/** Binary stars with no catalogued planets, taken from the object catalogue's SIMBAD records. */
export function simbadBinariesFrom(catalogue: Catalogue): StarSystem[] {
  return catalogue.objects.filter(isSimbadBinary).map((o) => ({
    id: `sys:${o.id.replace(/^[a-z]+:/, '')}`,
    name: o.name,
    kind: 'binary' as const,
    starCount: 2,
    planetCount: 0,
    hostConfig: null,
    stars: [{ name: o.name, spectralType: o.context.spectralType, teff: o.physicalProperties.temperature, radiusSun: null, massSun: null }],
    planets: [],
    distanceLy: o.context.distanceLy,
    discoveryYear: null,
    source: 'SIMBAD' as const,
    sourceUrl: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(o.designation || o.name)}`,
    lastUpdated: o.lastUpdated,
    origin: 'bundled' as const,
  }));
}

export type SystemFilterKind = 'all' | SystemKind | 'planetary' | 'circumbinary';

export interface SystemFilter {
  text?: string;
  kind?: SystemFilterKind;
  /** 'discovered' / 'undiscovered' need `discovered`: the ids the player has visited. */
  status?: 'all' | 'discovered' | 'undiscovered';
  discovered?: ReadonlySet<string>;
  origin?: 'all' | 'bundled' | 'live';
}

export class SystemCatalogue {
  readonly generatedAt: string;
  readonly sources: SystemsFile['sources'];
  private list: StarSystem[] = [];
  private ids = new Map<string, StarSystem>();
  private bodyList: SmallBody[] = [];
  private readonly base: StarSystem[];
  /** Bumped whenever live records are merged in, so UI and caches can tell the catalogue changed. */
  revision = 0;

  constructor(file: SystemsFile, extra: readonly StarSystem[] = []) {
    this.generatedAt = file.generatedAt;
    this.sources = file.sources;
    // The archive wins over a SIMBAD-derived stub of the same star: it knows the planets. The same
    // star can be filed under different names (SIMBAD's Kepler-90 is the archive's KOI-351), so a
    // stub whose name is an archive system's name or alias is the same object, and is dropped.
    const archiveNames = new Set<string>();
    for (const f of file.systems) {
      archiveNames.add(f.name.toLowerCase());
      for (const a of SYSTEM_ALIASES[f.id] ?? []) archiveNames.add(a.toLowerCase());
    }
    const stubs = extra.filter((s) => validateSystem(s).length === 0 && (s.source !== 'SIMBAD' || !archiveNames.has(s.name.toLowerCase())));
    const merged = mergeSystems(stubs, file.systems.filter((s) => validateSystem(s).length === 0));
    this.base = merged.systems.map((s) => {
      const archive = file.systems.find((f) => f.id === s.id);
      return archive ? { ...s, source: archive.source, sourceUrl: archive.sourceUrl, starCount: archive.starCount, kind: archive.kind, hostConfig: archive.hostConfig } : s;
    });
    this.setLive([], []);
  }

  /** Replace the live layer (validated records only). */
  setLive(systems: readonly StarSystem[], bodies: readonly SmallBody[]): void {
    const live = systems.filter((s) => validateSystem(s).length === 0).map((s) => ({ ...s, origin: 'live' as const }));
    // A live import of a bundled system refreshes its data but it stays a bundled entry.
    const merged = mergeSystems(this.base, live).systems.map((s) => {
      const b = this.base.find((x) => x.id === s.id);
      return b ? { ...s, origin: 'bundled' as const, kind: kindFromStarCount(s.starCount) } : s;
    });
    this.list = merged;
    this.ids = new Map(merged.map((s) => [s.id, s]));
    const seen = new Set<string>();
    this.bodyList = bodies.filter((b) => validateSmallBody(b).length === 0 && !seen.has(b.id) && !!seen.add(b.id));
    this.revision++;
  }

  get systems(): readonly StarSystem[] {
    return this.list;
  }

  get bodies(): readonly SmallBody[] {
    return this.bodyList;
  }

  get size(): number {
    return this.list.length;
  }

  get(id: string): StarSystem | undefined {
    return this.ids.get(id);
  }

  /** Find by name or known alias (case-insensitive). */
  find(name: string): StarSystem | undefined {
    const n = name.trim().toLowerCase();
    return this.list.find((s) => s.name.toLowerCase() === n || (SYSTEM_ALIASES[s.id] ?? []).some((a) => a.toLowerCase() === n));
  }

  aliases(id: string): string[] {
    return SYSTEM_ALIASES[id] ?? [];
  }

  search(f: SystemFilter = {}): StarSystem[] {
    const text = f.text?.trim().toLowerCase() ?? '';
    return this.list.filter((s) => {
      if (f.kind && f.kind !== 'all') {
        if (f.kind === 'planetary') {
          if (s.planets.length === 0) return false;
        } else if (f.kind === 'circumbinary') {
          if (s.hostConfig !== 'circumbinary') return false;
        } else if (s.kind !== f.kind) return false;
      }
      if (f.origin && f.origin !== 'all' && s.origin !== f.origin) return false;
      if (f.status && f.status !== 'all' && f.discovered) {
        const has = f.discovered.has(s.id);
        if (f.status === 'discovered' ? !has : has) return false;
      }
      if (!text) return true;
      return (
        s.name.toLowerCase().includes(text) ||
        (SYSTEM_ALIASES[s.id] ?? []).some((a) => a.toLowerCase().includes(text)) ||
        s.planets.some((p) => p.name.toLowerCase().includes(text)) ||
        (s.stars[0]?.spectralType ?? '').toLowerCase().includes(text)
      );
    });
  }

  counts(): { total: number; single: number; binary: number; multiple: number; planetary: number; circumbinary: number; planets: number; live: number } {
    const c = { total: this.list.length, single: 0, binary: 0, multiple: 0, planetary: 0, circumbinary: 0, planets: 0, live: 0 };
    for (const s of this.list) {
      c[s.kind]++;
      if (s.planets.length > 0) c.planetary++;
      if (s.hostConfig === 'circumbinary') c.circumbinary++;
      if (s.origin === 'live') c.live++;
      c.planets += s.planets.length;
    }
    return c;
  }
}

let instance: SystemCatalogue | null = null;

export function getSystems(): SystemCatalogue {
  if (!instance) {
    const catalogue = getCatalogue();
    const file = unpackSystems(JSON.parse(systemsRaw) as PackedSystems | SystemsFile);
    const sol = solarSystemFrom(catalogue);
    instance = new SystemCatalogue(file, [...(sol ? [sol] : []), ...simbadBinariesFrom(catalogue)]);
  }
  return instance;
}

// ------------------------------------------------------------------ presentation helpers

const fmt = (n: number, digits = 3): string => {
  const a = Math.abs(n);
  if (a >= 1000) return Math.round(n).toLocaleString('en-US');
  return String(Number(n.toPrecision(digits)));
};

/** "Unknown" for anything the source does not give. */
export const UNKNOWN = 'Unknown';

export function systemTypeLabel(s: StarSystem): string {
  const base = s.kind === 'single' ? 'SINGLE STAR' : s.kind === 'binary' ? 'BINARY STAR' : `${s.starCount}-STAR SYSTEM`;
  if (s.hostConfig === 'circumbinary') return `${base} · CIRCUMBINARY PLANETS`;
  if (s.hostConfig === 'circumstellar') return `${base} · CIRCUMSTELLAR PLANETS`;
  return base;
}

export function distanceText(s: StarSystem): string {
  if (s.id === SOLAR_SYSTEM_ID) return 'Home';
  return s.distanceLy === null ? UNKNOWN : `${fmt(s.distanceLy)} ly`;
}

export function periodText(days: number | null): string {
  if (days === null) return UNKNOWN;
  if (days >= 730) return `${fmt(days / 365.25)} yr`;
  if (days < 2) return `${fmt(days * 24)} h`;
  return `${fmt(days)} d`;
}

export const numText = (v: number | null, unit: string, digits = 3): string => (v === null ? UNKNOWN : `${fmt(v, digits)}${unit}`);

export function starText(s: StarSystem): string {
  const st = s.stars[0];
  const parts: string[] = [];
  if (st.spectralType) parts.push(st.spectralType);
  if (st.teff !== null) parts.push(`${fmt(st.teff, 4)} K`);
  return parts.length ? parts.join(' · ') : UNKNOWN;
}
