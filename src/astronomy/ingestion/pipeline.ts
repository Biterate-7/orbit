/**
 * Ingestion pipeline: fetch -> normalise -> deduplicate -> merge into the existing catalogue.
 *
 * Each source is an independent worker. A failing source is reported and skipped; the objects it
 * contributed in earlier runs stay in the catalogue, so one API outage never shrinks the game's
 * universe. The catalogue only grows - ids are stable so saved discoveries keep pointing at them.
 */
import { fetchExoplanetEu, fetchExoplanets } from '../api/exoplanets';
import { fetchBody, HORIZONS_TARGETS } from '../api/horizons';
import type { HttpClient } from '../api/http';
import { fetchSmallBodies, SBDB_QUERIES } from '../api/jpl';
import { attribution, matchImage, searchImages } from '../api/nasaImages';
import { lookupObject, NED_TARGETS } from '../api/ned';
import { fetchBrightStars, fetchByType, fetchCommonNames, fetchNearbyStars, fetchTemperatures, SIMBAD_TYPE_QUERIES } from '../api/simbad';
import type { SimbadRow } from '../api/simbad';
import { validateObject } from '../database/schema';
import type { AstroObject, CatalogueFile, PixelSprite } from '../database/schema';
import { derivedColors } from '../database/visuals';
import { deduplicate, mergeObjects } from './deduplicator';
import { normalizeExoplanet, normalizeExoplanetEu, normalizeHorizons, normalizeNed, normalizeSimbad, normalizeSmallBody, prettyNedName } from './normalizer';

export const CATALOGUE_VERSION = 1;

export type SourceName = 'sbdb' | 'horizons' | 'exoplanets' | 'simbad' | 'ned' | 'images';
export const ALL_SOURCES: SourceName[] = ['sbdb', 'horizons', 'exoplanets', 'simbad', 'ned', 'images'];

export interface SpriteResult {
  sprite: PixelSprite;
  colors: string[];
}

export interface PipelineOptions {
  http: HttpClient;
  only?: SourceName[];
  /** Existing catalogue to update incrementally. */
  existing?: CatalogueFile | null;
  existingSprites?: Record<string, PixelSprite>;
  /** Turns a matched thumbnail into a pixel sprite + palette. Injected so the pipeline stays platform-neutral. */
  makeSprite?: (thumbUrl: string) => Promise<SpriteResult | null>;
  /** Epoch for Horizons state vectors, YYYY-MM-DD. */
  epoch?: string;
  maxExoplanets?: number;
  maxImageLookups?: number;
  /** Forget previously matched imagery and match again. */
  refreshImages?: boolean;
  log?: (msg: string) => void;
  now?: string;
}

export interface SourceReport {
  ok: boolean;
  count: number;
  note: string;
  fetchedAt: string;
}

export interface PipelineResult {
  catalogue: CatalogueFile;
  sprites: Record<string, PixelSprite>;
  report: Record<string, SourceReport>;
  added: number;
  updated: number;
  merged: number;
  rejected: { id: string; problems: string[] }[];
}

type Worker = () => Promise<{ objects: AstroObject[]; note: string }>;

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { http } = opts;
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? new Date().toISOString();
  const want = new Set<SourceName>(opts.only?.length ? opts.only : ALL_SOURCES);
  const report: Record<string, SourceReport> = { ...(opts.existing?.sources ?? {}) };
  const fresh: AstroObject[] = [];

  const workers: Partial<Record<SourceName, Worker>> = {
    sbdb: async () => {
      const objects: AstroObject[] = [];
      const notes: string[] = [];
      for (const q of SBDB_QUERIES) {
        try {
          const rows = await fetchSmallBodies(http, q);
          for (const r of rows) {
            const o = normalizeSmallBody(r, now);
            if (o) objects.push(o);
          }
          notes.push(`${q.label}: ${rows.length}`);
        } catch (e) {
          notes.push(`${q.label}: FAILED (${errText(e)})`);
        }
      }
      if (objects.length === 0) throw new Error(notes.join('; '));
      return { objects, note: notes.join('; ') };
    },

    horizons: async () => {
      const epoch = opts.epoch ?? now.slice(0, 10);
      const objects: AstroObject[] = [];
      let failed = 0;
      for (const t of HORIZONS_TARGETS) {
        try {
          objects.push(normalizeHorizons(await fetchBody(http, t, epoch), now));
        } catch (e) {
          failed++;
          log(`  horizons ${t.name}: ${errText(e)}`);
        }
      }
      if (objects.length === 0) throw new Error('no body could be fetched');
      return { objects, note: `${objects.length} bodies at epoch ${epoch}${failed ? `, ${failed} failed` : ''}` };
    },

    exoplanets: async () => {
      const max = opts.maxExoplanets ?? 700;
      try {
        const rows = await fetchExoplanets(http, max);
        const objects = rows.map((r) => normalizeExoplanet(r, now)).filter((o): o is AstroObject => o !== null);
        return { objects, note: `NASA Exoplanet Archive pscomppars: ${objects.length}` };
      } catch (primary) {
        log(`  NASA Exoplanet Archive unavailable (${errText(primary)}); falling back to exoplanet.eu`);
        const rows = await fetchExoplanetEu(http);
        const usable = rows
          .filter((r) => (Number(r.radius) > 0 || Number(r.mass) > 0) && Number(r.star_distance) > 0)
          .sort((a, b) => Number(a.star_distance) - Number(b.star_distance))
          .slice(0, max);
        const objects = usable.map((r) => normalizeExoplanetEu(r, now)).filter((o): o is AstroObject => o !== null);
        return { objects, note: `FALLBACK exoplanet.eu: ${objects.length} (NASA Exoplanet Archive: ${errText(primary)})` };
      }
    },

    simbad: async () => {
      const rows = new Map<string, SimbadRow>();
      const notes: string[] = [];
      const take = (label: string, list: SimbadRow[]): void => {
        for (const r of list) if (r.main_id && !rows.has(r.main_id)) rows.set(r.main_id, r);
        notes.push(`${label}: ${list.length}`);
      };
      const attempt = async (label: string, fn: () => Promise<SimbadRow[]>): Promise<void> => {
        try {
          take(label, await fn());
        } catch (e) {
          notes.push(`${label}: FAILED (${errText(e)})`);
        }
      };
      await attempt('bright stars', () => fetchBrightStars(http, 4.0, 380));
      await attempt('nearby stars', () => fetchNearbyStars(http, 100, 140));
      for (const t of SIMBAD_TYPE_QUERIES) await attempt(t.otype, () => fetchByType(http, t.otype, t.top));
      if (rows.size === 0) throw new Error(notes.join('; '));
      const ids = [...rows.keys()];
      let names = new Map<string, string[]>();
      let temps = new Map<string, { teff: number; n: number }>();
      try {
        names = await fetchCommonNames(http, ids);
      } catch (e) {
        notes.push(`names: FAILED (${errText(e)})`);
      }
      try {
        temps = await fetchTemperatures(http, ids);
      } catch (e) {
        notes.push(`temperatures: FAILED (${errText(e)})`);
      }
      const objects: AstroObject[] = [];
      for (const r of rows.values()) {
        const o = normalizeSimbad(r, names.get(r.main_id), temps.get(r.main_id)?.teff ?? null, now);
        if (o) objects.push(o);
      }
      return { objects, note: `${objects.length} objects (${names.size} named, ${temps.size} with Teff)` };
    },

    ned: async () => {
      const objects: AstroObject[] = [];
      let missing = 0;
      let failed = 0;
      for (const name of NED_TARGETS) {
        try {
          const res = await lookupObject(http, name);
          const o = res ? normalizeNed(res, now) : null;
          if (o) objects.push(o);
          else missing++;
        } catch (e) {
          failed++;
          log(`  ned ${name}: ${errText(e)}`);
        }
      }
      if (objects.length === 0) throw new Error('no object could be resolved');
      return { objects, note: `${objects.length} resolved, ${missing} unresolved or untyped, ${failed} failed` };
    },
  };

  for (const name of ALL_SOURCES) {
    const worker = workers[name];
    if (!worker || !want.has(name)) continue;
    log(`[${name}] fetching...`);
    try {
      const { objects, note } = await worker();
      fresh.push(...objects);
      report[name] = { ok: true, count: objects.length, note, fetchedAt: now };
      log(`[${name}] ok - ${note}`);
    } catch (e) {
      const prev = report[name];
      report[name] = { ok: false, count: prev?.count ?? 0, note: `FAILED: ${errText(e)}${prev?.ok ? ` (keeping data from ${prev.fetchedAt})` : ''}`, fetchedAt: prev?.fetchedAt ?? now };
      log(`[${name}] FAILED - ${errText(e)}`);
    }
  }

  // ---- merge with what we already have (fresh data wins inside its own source)
  const existing = opts.existing?.objects ?? [];
  const freshIds = new Set(fresh.map((o) => o.id));
  const carried = existing.filter((o) => !freshIds.has(o.id));
  const before = new Map(existing.map((o) => [o.id, o]));
  // A refreshed record keeps what earlier runs added to it (matched imagery, fields filled by other sources).
  const refreshed = fresh.map((o) => {
    const old = before.get(o.id);
    return old && old.source === o.source ? mergeObjects(o, old) : o;
  });
  const { objects: deduped, merged } = deduplicate([...refreshed, ...carried]);

  const rejected: PipelineResult['rejected'] = [];
  const objects: AstroObject[] = [];
  for (const o of deduped) {
    const problems = validateObject(o);
    if (problems.length) rejected.push({ id: o.id, problems });
    else objects.push(o);
  }

  // ---- imagery
  const sprites: Record<string, PixelSprite> = opts.refreshImages ? {} : { ...(opts.existingSprites ?? {}) };
  if (opts.refreshImages) {
    // Drop every earlier match so the current matching rules decide from scratch.
    for (const o of objects) {
      if (!o.visualProperties.imageUrl) continue;
      o.visualProperties = { ...o.visualProperties, imageUrl: null, imageSource: null, imageAttribution: null, dominantColors: derivedColors(o), colorSource: 'derived' };
    }
  }
  if (want.has('images')) {
    log('[images] matching NASA imagery...');
    try {
      const n = await attachImages(objects, sprites, opts, log);
      report.images = { ok: true, count: n.matched, note: `${n.matched} matched of ${n.searched} searched, ${n.sprites} pixel sprites`, fetchedAt: now };
      log(`[images] ok - ${report.images.note}`);
    } catch (e) {
      report.images = { ok: false, count: 0, note: `FAILED: ${errText(e)}`, fetchedAt: now };
      log(`[images] FAILED - ${errText(e)}`);
    }
  }
  for (const id of Object.keys(sprites)) if (!objects.some((o) => o.id === id)) delete sprites[id];

  // ---- keep timestamps stable for records whose content did not change
  let added = 0;
  let updated = 0;
  const strip = (o: AstroObject): string => JSON.stringify({ ...o, lastUpdated: '' });
  for (const o of objects) {
    const old = before.get(o.id);
    if (!old) added++;
    else if (strip(old) === strip(o)) o.lastUpdated = old.lastUpdated;
    else updated++;
  }

  return {
    catalogue: { version: CATALOGUE_VERSION, generatedAt: now, sources: report, objects },
    sprites,
    report,
    added,
    updated,
    merged,
    rejected,
  };
}

// ------------------------------------------------------------------ imagery

/** Small bodies a spacecraft has imaged up close, plus historically famous comets. */
const IMAGED_SMALL_BODIES = new Set(
  ['eros', 'bennu', 'ryugu', 'itokawa', 'gaspra', 'ida', 'mathilde', 'lutetia', 'steins', 'psyche', 'arrokoth', 'didymos', 'toutatis', 'annefrank', 'braille', 'dinkinesh', 'halley', 'tempel 1', 'wild 2', 'churyumov-gerasimenko', 'hartley 2', 'borrelly', 'hale-bopp', 'encke', 'giacobini-zinner', 'shoemaker-levy 9', 'hyakutake', 'neowise', 'ison', 'siding spring', 'chiron', 'eris', 'makemake', 'haumea', 'sedna'].map(
    (s) => s.toLowerCase(),
  ),
);

/** Asteroid names that are also moons, missions or everyday words: an image search for them returns the wrong thing. */
const SHARED_NAMES = new Set(['juno', 'psyche', 'europa', 'io', 'dione', 'rhea', 'titania', 'ariel', 'miranda', 'pandora', 'hera', 'lucy', 'dawn', 'thetis', 'metis', 'thebe', 'amalthea', 'themis', 'iris', 'eos', 'aurora', 'victoria', 'fortuna', 'hope', 'flora', 'hebe', 'harmonia', 'irene', 'eugenia']);

/** Which objects are worth an image lookup, and which names to search / verify with. */
export function imageQuery(o: AstroObject): { query: string; names: string[] } | null {
  switch (o.category) {
    case 'planet':
    case 'moon':
      return { query: o.name, names: [o.name] };
    case 'dwarf-planet':
      return { query: `${o.name} dwarf planet`, names: [o.name] };
    case 'asteroid': {
      const numbered = /^(\d+) /.exec(o.designation);
      const lower = o.name.toLowerCase();
      if (SHARED_NAMES.has(lower)) return null;
      if (!IMAGED_SMALL_BODIES.has(lower) && !(numbered && Number(numbered[1]) <= 60)) return null;
      return { query: `${o.name} asteroid`, names: [o.name] };
    }
    case 'comet':
      if (!IMAGED_SMALL_BODIES.has(o.name.toLowerCase())) return null;
      return { query: `comet ${o.name}`, names: [o.name] };
    case 'star':
    case 'stellar-remnant':
    case 'nebula':
      // Only objects with a proper name: catalogue designations never match image titles reliably.
      // "Sun" is far too common a word in image titles to verify a match, so the Sun stays procedural.
      if (o.name === o.designation || o.source === 'JPL-HORIZONS') return null;
      return { query: o.name, names: [o.name] };
    case 'galaxy':
    case 'quasar': {
      const names = new Set<string>([o.name, o.designation]);
      const m = /^Messier (\d+)$/.exec(o.designation);
      if (m) names.add(`M${m[1]}`);
      return { query: m ? `Messier ${m[1]}` : prettyNedName(o.name), names: [...names] };
    }
    case 'exoplanet':
      // Published exoplanet imagery is almost entirely artist's concepts, which we never present as the object.
      return null;
  }
}

async function attachImages(
  objects: AstroObject[],
  sprites: Record<string, PixelSprite>,
  opts: PipelineOptions,
  log: (msg: string) => void,
): Promise<{ searched: number; matched: number; sprites: number }> {
  const limit = opts.maxImageLookups ?? 900;
  const queue = objects
    .filter((o) => !o.visualProperties.imageUrl || (opts.makeSprite && !sprites[o.id]))
    .map((o) => ({ o, q: imageQuery(o) }))
    .filter((x): x is { o: AstroObject; q: { query: string; names: string[] } } => x.q !== null)
    .sort((a, b) => (b.o.context.notability ?? 0) - (a.o.context.notability ?? 0))
    .slice(0, limit);
  let matched = 0;
  let made = 0;
  let failures = 0;
  for (const { o, q } of queue) {
    try {
      let thumb = o.visualProperties.imageUrl;
      if (!thumb) {
        const hit = matchImage(q.names, o.category, await searchImages(opts.http, q.query, 40));
        if (!hit) continue;
        o.visualProperties.imageUrl = thumb = hit.thumbUrl;
        o.visualProperties.imageSource = `NASA Image and Video Library · ${hit.nasaId} · "${hit.title}"`;
        o.visualProperties.imageAttribution = attribution(hit);
        matched++;
      }
      if (opts.makeSprite && !sprites[o.id]) {
        const res = await opts.makeSprite(thumb);
        if (res) {
          sprites[o.id] = res.sprite;
          o.visualProperties.dominantColors = res.colors;
          o.visualProperties.colorSource = 'image';
          made++;
        }
      }
    } catch (e) {
      failures++;
      log(`  image ${o.name}: ${errText(e)}`);
      if (failures > 25 && matched === 0) throw new Error('image service unreachable');
    }
  }
  return { searched: queue.length, matched, sprites: made };
}
