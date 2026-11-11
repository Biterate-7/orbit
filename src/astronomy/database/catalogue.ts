/**
 * The local astronomical catalogue the game runs on.
 *
 * The data files are produced offline by `npm run ingest` and bundled with the game, so nothing
 * here ever touches the network. Lookups are indexed once on first use.
 */
import catalogueRaw from '../data/catalogue.json?raw';
import spritesRaw from '../data/sprites.json?raw';
import { unpackCatalogue } from './codec';
import type { PackedCatalogue } from './codec';
import { SOURCE_LABEL } from './schema';
import type { AstroCategory, AstroObject, CatalogueFile, PixelSprite, SourceId } from './schema';

export interface CatalogueFilter {
  text?: string;
  category?: AstroCategory;
  source?: SourceId;
  /** Restrict to these ids (e.g. the player's discoveries). */
  ids?: ReadonlySet<string>;
}

export class Catalogue {
  readonly version: number;
  readonly generatedAt: string;
  readonly sources: CatalogueFile['sources'];
  readonly objects: readonly AstroObject[];
  private readonly ids = new Map<string, AstroObject>();
  private readonly categories = new Map<AstroCategory, AstroObject[]>();
  private readonly children = new Map<string, AstroObject[]>();
  private readonly sprites: Record<string, PixelSprite>;

  constructor(file: CatalogueFile, sprites: Record<string, PixelSprite> = {}) {
    this.version = file.version;
    this.generatedAt = file.generatedAt;
    this.sources = file.sources;
    this.sprites = sprites;
    const seen = new Set<string>();
    const objects: AstroObject[] = [];
    for (const o of file.objects) {
      if (!o?.id || seen.has(o.id)) continue; // never serve duplicates, even from a hand-edited file
      seen.add(o.id);
      objects.push(o);
      this.ids.set(o.id, o);
      const list = this.categories.get(o.category);
      if (list) list.push(o);
      else this.categories.set(o.category, [o]);
      const parent = o.context.parentId;
      if (parent) {
        const kids = this.children.get(parent);
        if (kids) kids.push(o);
        else this.children.set(parent, [o]);
      }
    }
    this.objects = objects;
  }

  get size(): number {
    return this.objects.length;
  }

  get(id: string): AstroObject | undefined {
    return this.ids.get(id);
  }

  byCategory(category: AstroCategory): readonly AstroObject[] {
    return this.categories.get(category) ?? [];
  }

  /** Moons of a body, nearest first. */
  moonsOf(id: string): AstroObject[] {
    return [...(this.children.get(id) ?? [])].sort(
      (a, b) => (a.orbitalProperties.semiMajorAxis ?? Infinity) - (b.orbitalProperties.semiMajorAxis ?? Infinity),
    );
  }

  sprite(id: string): PixelSprite | null {
    return this.sprites[id] ?? null;
  }

  categoryCounts(): { category: AstroCategory; count: number }[] {
    return [...this.categories.entries()].map(([category, list]) => ({ category, count: list.length }));
  }

  search(filter: CatalogueFilter): AstroObject[] {
    const text = filter.text?.trim().toLowerCase() ?? '';
    const pool = filter.category ? this.byCategory(filter.category) : this.objects;
    return pool.filter((o) => {
      if (filter.ids && !filter.ids.has(o.id)) return false;
      if (filter.source && o.source !== filter.source) return false;
      if (!text) return true;
      return (
        o.name.toLowerCase().includes(text) ||
        o.designation.toLowerCase().includes(text) ||
        o.classification.toLowerCase().includes(text) ||
        (o.context.hostName?.toLowerCase().includes(text) ?? false)
      );
    });
  }
}

let instance: Catalogue | null = null;

export function getCatalogue(): Catalogue {
  if (!instance) {
    instance = new Catalogue(unpackCatalogue(JSON.parse(catalogueRaw) as PackedCatalogue | CatalogueFile), JSON.parse(spritesRaw) as Record<string, PixelSprite>);
  }
  return instance;
}

// ------------------------------------------------------------------ presentation helpers

/** Compact number formatting for catalogue values: 3 significant figures, thousands separators, powers of ten. */
export function formatValue(n: number): string {
  const a = Math.abs(n);
  if (a === 0) return '0';
  if (a >= 1e6 || a < 1e-3) {
    const exp = Math.floor(Math.log10(a));
    return `${(n / 10 ** exp).toFixed(2)}e${exp}`;
  }
  if (a >= 1000) return Math.round(n).toLocaleString('en-US');
  return String(Number(n.toPrecision(3)));
}

const EARTH_MASS = 5.9722e24;
const EARTH_RADIUS = 6371;
const JUPITER_MASS = 1.89813e27;
const SUN_MASS = 1.98841e30;

function massText(kg: number): string {
  if (kg >= SUN_MASS * 0.05) return `${formatValue(kg / SUN_MASS)} M☉`;
  if (kg >= JUPITER_MASS * 0.3) return `${formatValue(kg / JUPITER_MASS)} MJ`;
  if (kg >= EARTH_MASS * 0.05) return `${formatValue(kg / EARTH_MASS)} M⊕`;
  return `${formatValue(kg)} kg`;
}

function periodText(days: number): string {
  if (days >= 730) return `${formatValue(days / 365.25)} yr`;
  if (days < 2) return `${formatValue(days * 24)} h`;
  return `${formatValue(days)} d`;
}

export interface FactRow {
  k: string;
  v: string;
}

/** The measured properties worth showing for an object. Rows with no data are omitted, never guessed. */
export function factRows(o: AstroObject): FactRow[] {
  const p = o.physicalProperties;
  const q = o.orbitalProperties;
  const c = o.context;
  const rows: FactRow[] = [];
  const add = (k: string, v: string | null): void => {
    if (v) rows.push({ k, v });
  };
  add('SPECTRAL TYPE', c.spectralType && o.category !== 'exoplanet' ? c.spectralType : null);
  add('RADIUS', p.radius === null ? null : p.radius >= EARTH_RADIUS * 0.3 ? `${formatValue(p.radius)} km (${formatValue(p.radius / EARTH_RADIUS)} R⊕)` : `${formatValue(p.radius)} km`);
  add('MASS', p.mass === null ? null : massText(p.mass));
  add('TEMPERATURE', p.temperature === null ? null : `${formatValue(p.temperature)} K`);
  add('LUMINOSITY', p.luminosity === null ? null : `${formatValue(p.luminosity)} L☉`);
  add('ROTATION', p.rotationPeriod === null ? null : p.rotationPeriod >= 48 ? `${formatValue(p.rotationPeriod / 24)} d` : `${formatValue(p.rotationPeriod)} h`);
  add('ORBITAL PERIOD', q.orbitalPeriod === null ? null : periodText(q.orbitalPeriod));
  add('SEMI-MAJOR AXIS', q.semiMajorAxis === null ? null : q.semiMajorAxis < 0.01 ? `${formatValue(q.semiMajorAxis * 149597870.7)} km` : `${formatValue(q.semiMajorAxis)} AU`);
  add('ECCENTRICITY', q.eccentricity === null ? null : formatValue(q.eccentricity));
  // The reference plane differs by source: the ecliptic for Solar System bodies, the plane of the sky for exoplanets.
  add(o.category === 'exoplanet' ? 'INCLINATION (TO SKY)' : 'INCLINATION (ECLIPTIC)', q.inclination === null ? null : `${formatValue(q.inclination)}°`);
  add('ORBITS', c.hostName);
  add('HOST STAR', o.category === 'exoplanet' && c.spectralType ? `${c.spectralType}${c.hostTemperature ? `, ${formatValue(c.hostTemperature)} K` : ''}` : null);
  add('STARS IN SYSTEM', c.starsInSystem === null ? null : String(c.starsInSystem));
  add('ALBEDO', c.albedo === null ? null : formatValue(c.albedo));
  add('TAXONOMY', c.taxonomy ? `${c.taxonomy}-type` : null);
  add('DISTANCE', c.distanceLy === null || c.distanceLy === 0 ? null : `${formatValue(c.distanceLy)} ly`);
  add('REDSHIFT', c.redshift === null ? null : `z = ${formatValue(c.redshift)}`);
  add('DISCOVERED', c.discoveryYear === null ? null : String(c.discoveryYear));
  return rows;
}

/** Factual one-paragraph description assembled from catalogue fields only. */
export function describeObject(o: AstroObject): string {
  const p = o.physicalProperties;
  const q = o.orbitalProperties;
  const c = o.context;
  const parts: string[] = [];
  const cls = o.classification;
  // "An M-type giant", "An HII region", "An X-ray binary" - the article follows the sound, not the letter.
  const article = /^([aeiou]|HII|X-ray|[AEFHILMNORSX]-type)/i.test(cls) && !/^(U|Eu)/.test(cls) ? 'An' : 'A';
  // Keep names and acronyms capitalised mid-sentence ("a Neptune-like exoplanet", "a Mira variable").
  const proper = /^(Neptune|Jupiter|Halley|Encke|Chiron|Amor|Apollo|Aten|Atira|Mars|Wolf|Mira|Cepheid|Herbig|Delta|Beta|Gamma|Alpha|RR |BY |RS |RV |SX |W Virginis|T Tauri|Be |HII|OH|X-ray|[A-Z]-type)/.test(cls);
  let lead = `${article} ${proper ? cls : cls.charAt(0).toLowerCase() + cls.slice(1)}`;
  if (c.hostName && o.category !== 'star') lead += ` orbiting ${c.hostName === 'Sun' ? 'the Sun' : c.hostName}`;
  parts.push(`${lead}.`);
  if (q.orbitalPeriod !== null && q.semiMajorAxis !== null && q.semiMajorAxis > 0) {
    const a = q.semiMajorAxis < 0.01 ? `${formatValue(q.semiMajorAxis * 149597870.7)} km` : `${formatValue(q.semiMajorAxis)} AU`;
    parts.push(`It completes an orbit every ${periodText(q.orbitalPeriod)} at ${a}${q.eccentricity !== null && q.eccentricity > 0.3 ? `, on a strongly eccentric path (e = ${formatValue(q.eccentricity)})` : ''}.`);
  } else if (q.orbitalPeriod !== null) {
    parts.push(`It completes an orbit every ${periodText(q.orbitalPeriod)}.`);
  }
  if (p.radius !== null) parts.push(`Mean diameter ${formatValue(p.radius * 2)} km.`);
  if (c.spectralType && o.category !== 'exoplanet') parts.push(`Spectral type ${c.spectralType}${p.temperature ? `, about ${formatValue(p.temperature)} K` : ''}.`);
  else if (p.temperature !== null) parts.push(`${o.category === 'exoplanet' ? 'Equilibrium temperature' : 'Temperature'} about ${formatValue(p.temperature)} K.`);
  if (c.distanceLy !== null && c.distanceLy > 0) parts.push(`${formatValue(c.distanceLy)} light-years from the Sun.`);
  if (c.redshift !== null) parts.push(`Redshift z = ${formatValue(c.redshift)}.`);
  if (c.discoveryYear !== null) parts.push(`Discovered in ${c.discoveryYear}.`);
  return parts.join(' ');
}

export function sourceLine(o: AstroObject): string {
  const extra = o.alsoIn.length ? ` + ${o.alsoIn.map((s) => SOURCE_LABEL[s]).join(', ')}` : '';
  return `${SOURCE_LABEL[o.source]}${extra}`;
}
