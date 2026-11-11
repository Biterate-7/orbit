/**
 * Catalogue ingestion CLI.
 *
 *   npm run ingest                         refresh everything
 *   npm run ingest -- --only sbdb,simbad   refresh selected sources (others are kept as they are)
 *   npm run ingest -- --fresh              ignore the on-disk HTTP cache
 *   npm run ingest -- --rebuild            start from an empty catalogue instead of updating the existing one
 *
 * Output: src/astronomy/data/catalogue.json, sprites.json and ingest-report.json.
 * The game never calls these APIs itself - it only reads the files written here.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { HttpClient } from '../src/astronomy/api/http';
import type { ResponseCache } from '../src/astronomy/api/http';
import { packCatalogue, unpackCatalogue } from '../src/astronomy/database/codec';
import type { PackedCatalogue } from '../src/astronomy/database/codec';
import type { CatalogueFile, PixelSprite } from '../src/astronomy/database/schema';
import { ALL_SOURCES, runPipeline } from '../src/astronomy/ingestion/pipeline';
import type { SourceName, SpriteResult } from '../src/astronomy/ingestion/pipeline';
import { quantizeToSprite } from '../src/astronomy/ingestion/sprites';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src', 'astronomy', 'data');
const cacheDir = join(root, 'node_modules', '.cache', 'orbit-lost-astro');

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return null;
  return args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '';
};

/** Responses are cached on disk for a week so re-runs are fast and polite to the APIs. */
class FileCache implements ResponseCache {
  constructor(
    private dir: string,
    private ttlMs: number,
  ) {
    mkdirSync(dir, { recursive: true });
  }
  private path(key: string): string {
    return join(this.dir, `${createHash('sha1').update(key).digest('hex')}.json`);
  }
  async get(key: string): Promise<string | null> {
    const p = this.path(key);
    if (!existsSync(p)) return null;
    try {
      const { at, body } = JSON.parse(readFileSync(p, 'utf8')) as { at: number; body: string };
      return Date.now() - at < this.ttlMs ? body : null;
    } catch {
      return null;
    }
  }
  async set(key: string, value: string): Promise<void> {
    writeFileSync(this.path(key), JSON.stringify({ at: Date.now(), body: value }));
  }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const only = (flag('only') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SourceName => (ALL_SOURCES as string[]).includes(s));
  const log = (m: string): void => console.log(m);
  const http = new HttpClient({
    cache: flag('fresh') === null ? new FileCache(cacheDir, 7 * 86400000) : null,
    minIntervalMs: 300,
    hostIntervals: { 'ssd.jpl.nasa.gov': 650, 'ned.ipac.caltech.edu': 500, 'images-api.nasa.gov': 250 },
    log,
  });

  const makeSprite = async (thumbUrl: string): Promise<SpriteResult | null> => {
    const res = await fetch(thumbUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 3_000_000) return null;
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256 });
    return quantizeToSprite(img.data, img.width, img.height);
  };

  mkdirSync(dataDir, { recursive: true });
  const cataloguePath = join(dataDir, 'catalogue.json');
  const spritesPath = join(dataDir, 'sprites.json');
  const rebuild = flag('rebuild') !== null;
  const stored = rebuild ? null : readJson<PackedCatalogue | CatalogueFile>(cataloguePath);
  const result = await runPipeline({
    http,
    only,
    existing: stored ? unpackCatalogue(stored) : null,
    existingSprites: rebuild ? {} : (readJson<Record<string, PixelSprite>>(spritesPath) ?? {}),
    makeSprite,
    refreshImages: flag('refresh-images') !== null,
    log,
  });

  writeFileSync(cataloguePath, `${JSON.stringify(packCatalogue(result.catalogue))}\n`);
  writeFileSync(spritesPath, `${JSON.stringify(result.sprites)}\n`);
  const byCategory: Record<string, number> = {};
  for (const o of result.catalogue.objects) byCategory[o.category] = (byCategory[o.category] ?? 0) + 1;
  const summary = {
    generatedAt: result.catalogue.generatedAt,
    total: result.catalogue.objects.length,
    added: result.added,
    updated: result.updated,
    duplicatesMerged: result.merged,
    rejected: result.rejected,
    byCategory,
    withImage: result.catalogue.objects.filter((o) => o.visualProperties.imageUrl).length,
    sprites: Object.keys(result.sprites).length,
    sources: result.report,
    http: { requests: http.requests, cacheHits: http.cacheHits },
  };
  writeFileSync(join(dataDir, 'ingest-report.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, rejected: summary.rejected.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
