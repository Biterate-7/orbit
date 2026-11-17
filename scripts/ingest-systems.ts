/**
 * Star-system ingestion CLI.
 *
 *   npm run ingest:systems            refresh the bundled star-system snapshot
 *   npm run ingest:systems -- --fresh ignore the on-disk HTTP cache
 *
 * Retrieves confirmed planetary systems from the NASA Exoplanet Archive (TAP, `pscomppars`),
 * validates and normalises them (src/astronomy/systems/normalize.ts - the same code the game uses
 * for live imports), merges them into src/astronomy/data/systems.json and writes a report.
 *
 * If the archive cannot be reached the existing snapshot is left exactly as it is.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpClient } from '../src/astronomy/api/http';
import type { ResponseCache } from '../src/astronomy/api/http';
import { packSystems, unpackSystems } from '../src/astronomy/systems/codec';
import type { PackedSystems } from '../src/astronomy/systems/codec';
import { mergeSystems, validateSystem } from '../src/astronomy/systems/normalize';
import { BUNDLE_PARTITIONS, SHOWCASE_HOSTS, UPSTREAMS, fetchExoplanetSystems, hostsWhere } from '../src/astronomy/systems/sources';
import type { FetchText } from '../src/astronomy/systems/sources';
import type { StarSystem, SystemsFile } from '../src/astronomy/systems/types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src', 'astronomy', 'data');
const cacheDir = join(root, 'node_modules', '.cache', 'orbit-lost-systems');
const outFile = join(dataDir, 'systems.json');
const reportFile = join(dataDir, 'systems-report.json');
const fresh = process.argv.includes('--fresh');

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

async function main(): Promise<void> {
  const http = new HttpClient({
    minIntervalMs: 1200,
    retries: 3,
    timeoutMs: 90000,
    cache: fresh ? null : new FileCache(cacheDir, 7 * 24 * 3600 * 1000),
    log: (m) => console.log(`  ${m}`),
  });
  const fetchText: FetchText = (upstream, query) => http.text(`${UPSTREAMS[upstream]}?${query}`);

  const previous: SystemsFile | null = existsSync(outFile) ? unpackSystems(JSON.parse(readFileSync(outFile, 'utf8')) as PackedSystems | SystemsFile) : null;
  const startedAt = new Date().toISOString();
  console.log('NASA Exoplanet Archive · pscomppars');
  let fetched: StarSystem[] = [];
  let note = '';
  let ok = true;
  let rejected: { name: string; reason: string }[] = [];
  try {
    const where = [...BUNDLE_PARTITIONS, hostsWhere(SHOWCASE_HOSTS)];
    const res = await fetchExoplanetSystems(fetchText, where, { pageSize: 3000, now: () => startedAt, onPage: (n, p) => console.log(`  partition ${p}: ${n} planet rows`) });
    if (res.truncated) throw new Error('a partition reached the row cap; split it further');
    fetched = res.systems;
    rejected = res.rejected;
    note = `${res.rows} planet rows in ${res.pages} requests -> ${res.systems.length} systems`;
  } catch (e) {
    ok = false;
    note = `FAILED: ${(e as Error).message}`;
  }

  if (!ok) {
    console.error(`  ${note}`);
    console.error(previous ? '  Existing snapshot kept unchanged.' : '  No snapshot written.');
    writeFileSync(reportFile, JSON.stringify({ generatedAt: startedAt, ok: false, note, kept: previous?.systems.length ?? 0 }, null, 2));
    process.exitCode = 1;
    return;
  }

  const invalid: { name: string; reason: string }[] = [];
  const valid = fetched.filter((s) => {
    const errs = validateSystem(s);
    if (errs.length) invalid.push({ name: s.name, reason: errs.join('; ') });
    return errs.length === 0;
  });
  // Every bundled record carries this run's fetch date: the snapshot is re-fetched as a whole.
  const merged = mergeSystems((previous?.systems ?? []).filter((p) => !valid.some((v) => v.id === p.id)), valid);
  const added = valid.filter((v) => !previous?.systems.some((p) => p.id === v.id)).length;
  const file: SystemsFile = {
    version: 1,
    generatedAt: startedAt,
    sources: { 'nasa-exoplanet-archive': { ok: true, count: valid.length, note, fetchedAt: startedAt } },
    systems: merged.systems,
  };
  writeFileSync(outFile, JSON.stringify(packSystems({ ...file, systems: merged.systems.map((x) => ({ ...x, lastUpdated: startedAt })) })));
  const s = merged.systems;
  const report = {
    generatedAt: startedAt,
    ok: true,
    note,
    total: s.length,
    added,
    updated: valid.length - added,
    planets: s.reduce((n, x) => n + x.planets.length, 0),
    byKind: { single: s.filter((x) => x.kind === 'single').length, binary: s.filter((x) => x.kind === 'binary').length, multiple: s.filter((x) => x.kind === 'multiple').length },
    circumbinary: s.filter((x) => x.hostConfig === 'circumbinary').length,
    circumstellar: s.filter((x) => x.hostConfig === 'circumstellar').length,
    showcase: SHOWCASE_HOSTS.map((h) => ({ host: h, present: s.some((x) => x.name === h) })),
    rejected: [...rejected, ...invalid].slice(0, 50),
    http: { requests: http.requests, cacheHits: http.cacheHits },
  };
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`  ${note}`);
  console.log(`  ${s.length} systems (${added} new, ${valid.length - added} updated), ${report.planets} planets`);
  console.log(`  binary ${report.byKind.binary} · multiple ${report.byKind.multiple} · circumbinary ${report.circumbinary} · rejected ${report.rejected.length}`);
}

void main();
