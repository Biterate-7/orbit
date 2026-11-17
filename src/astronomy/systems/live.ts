/**
 * Live astronomical imports.
 *
 * While the game is running the player can pull further records from NASA and JPL: search a host
 * star in the Exoplanet Archive, look an asteroid or comet up in the Small-Body Database, refresh
 * what was imported before. Every response goes through the same validation and normalisation as
 * the bundled snapshot, is deduplicated against what is already known, and is cached locally so
 * it is still there offline.
 *
 * Nothing in here runs on its own: imports happen only when the player asks for them (and never
 * while a mission loads). A failure of any kind leaves the catalogue exactly as it was.
 */
import { mergeSystems, validateSmallBody, validateSystem } from './normalize';
import { fetchExoplanetSystems, fetchHorizonsBody, fetchSmallBody, hostsWhere, sanitizeTerm, searchWhere } from './sources';
import type { FetchText, Upstream } from './sources';
import type { SystemCatalogue } from './store';
import type { SmallBody, StarSystem } from './types';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LIVE_CACHE_KEY = 'orbitlost.astro.v1';
/** Bounds on the local cache so it can never outgrow localStorage. */
export const MAX_LIVE_SYSTEMS = 400;
export const MAX_LIVE_BODIES = 200;
/** Imported records older than this are re-fetched by `refresh()`. */
export const STALE_MS = 30 * 24 * 3600 * 1000;

export interface LiveCache {
  version: 1;
  systems: StarSystem[];
  bodies: SmallBody[];
  /** ISO time of the last successful request per upstream. */
  lastSync: Partial<Record<Upstream, string>>;
}

export function emptyCache(): LiveCache {
  return { version: 1, systems: [], bodies: [], lastSync: {} };
}

/** Read the cache defensively: a corrupt or hand-edited entry is dropped, never trusted. */
export function readCache(storage: KeyValueStore | null): LiveCache {
  const out = emptyCache();
  if (!storage) return out;
  try {
    const raw = storage.getItem(LIVE_CACHE_KEY);
    if (!raw) return out;
    const d = JSON.parse(raw) as Partial<LiveCache>;
    if (Array.isArray(d.systems)) out.systems = d.systems.filter((s) => validateSystem(s).length === 0).slice(0, MAX_LIVE_SYSTEMS);
    if (Array.isArray(d.bodies)) out.bodies = d.bodies.filter((b) => validateSmallBody(b).length === 0).slice(0, MAX_LIVE_BODIES);
    if (d.lastSync && typeof d.lastSync === 'object') {
      for (const k of ['exo', 'sbdb', 'horizons'] as const) {
        const v = (d.lastSync as Record<string, unknown>)[k];
        if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) out.lastSync[k] = v;
      }
    }
  } catch {
    return emptyCache();
  }
  return out;
}

export function writeCache(storage: KeyValueStore | null, cache: LiveCache): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LIVE_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false; // storage full or blocked: the import still works for this session
  }
}

export class AstroServiceError extends Error {
  constructor(
    message: string,
    /** offline = could not reach the service; upstream = it answered with an error; busy = rate limited locally. */
    readonly kind: 'offline' | 'upstream' | 'busy' | 'input',
  ) {
    super(message);
    this.name = 'AstroServiceError';
  }
}

export interface ImportResult {
  ok: boolean;
  /** Records in the response that were new to the catalogue. */
  added: number;
  /** Records that were already known and have been refreshed. */
  updated: number;
  /** Rows the validator turned away. */
  rejected: number;
  /** Ids of the systems / bodies touched, for highlighting. */
  ids: string[];
  message: string;
}

export interface AstroServiceOptions {
  /** How to reach the upstreams, or null when there is no route (then every import reports offline). */
  transport: FetchText | null;
  storage: KeyValueStore | null;
  now?: () => number;
  /** Minimum gap between two outgoing requests, ms. */
  minIntervalMs?: number;
  retries?: number;
  /** Wait before retry n (ms). */
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Coordinates imports: one request at a time, a minimum gap between requests, bounded retries with
 * backoff, and a short cool-down after a failure so a dead service is not hammered.
 */
export class AstroService {
  private readonly transport: FetchText | null;
  private readonly storage: KeyValueStore | null;
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private readonly retries: number;
  private readonly backoffMs: (attempt: number) => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private cache: LiveCache;
  private nextSlot = 0;
  private coolUntil: Partial<Record<Upstream, number>> = {};
  private inFlight = false;
  /** Outgoing requests actually made (for tests and the status line). */
  requests = 0;
  lastError = '';

  constructor(
    private readonly catalogue: SystemCatalogue,
    opts: AstroServiceOptions,
  ) {
    this.transport = opts.transport;
    this.storage = opts.storage;
    this.now = opts.now ?? Date.now;
    this.minIntervalMs = opts.minIntervalMs ?? 1500;
    this.retries = opts.retries ?? 2;
    this.backoffMs = opts.backoffMs ?? ((n) => 800 * 2 ** n);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.cache = readCache(this.storage);
    this.catalogue.setLive(this.cache.systems, this.cache.bodies);
  }

  get busy(): boolean {
    return this.inFlight;
  }

  get online(): boolean {
    return this.transport !== null;
  }

  get lastSync(): LiveCache['lastSync'] {
    return this.cache.lastSync;
  }

  get cached(): { systems: number; bodies: number } {
    return { systems: this.cache.systems.length, bodies: this.cache.bodies.length };
  }

  /** One upstream call with rate limiting, retries and failure cool-down. */
  private call: FetchText = async (upstream, query) => {
    if (!this.transport) throw new AstroServiceError('No connection to the astronomical services from this build.', 'offline');
    const cool = this.coolUntil[upstream] ?? 0;
    if (this.now() < cool) throw new AstroServiceError(`${upstream.toUpperCase()} is not responding. Try again in ${Math.ceil((cool - this.now()) / 1000)}s.`, 'busy');
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const wait = this.nextSlot - this.now();
      if (wait > 0) await this.sleep(wait);
      this.nextSlot = this.now() + this.minIntervalMs;
      this.requests++;
      try {
        const body = await this.transport(upstream, query);
        this.cache.lastSync[upstream] = new Date(this.now()).toISOString();
        return body;
      } catch (e) {
        lastErr = e;
        // A 4xx is our own mistake (bad query): retrying cannot help.
        const status = (e as { status?: number }).status;
        if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) break;
        if (attempt < this.retries) await this.sleep(this.backoffMs(attempt));
      }
    }
    this.coolUntil[upstream] = this.now() + 30000;
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    const status = (lastErr as { status?: number } | null)?.status;
    throw new AstroServiceError(msg || 'request failed', typeof status === 'number' ? 'upstream' : 'offline');
  };

  private async guarded(run: () => Promise<ImportResult>): Promise<ImportResult> {
    if (this.inFlight) return { ok: false, added: 0, updated: 0, rejected: 0, ids: [], message: 'An import is already running.' };
    this.inFlight = true;
    try {
      const res = await run();
      this.lastError = res.ok ? '' : res.message;
      return res;
    } catch (e) {
      const offline = e instanceof AstroServiceError && e.kind === 'offline';
      this.lastError = offline ? 'Service unreachable. The catalogue is unchanged and the game works offline.' : (e as Error).message;
      return { ok: false, added: 0, updated: 0, rejected: 0, ids: [], message: this.lastError };
    } finally {
      this.inFlight = false;
    }
  }

  private commitSystems(incoming: StarSystem[], rejected: number, empty: string): ImportResult {
    const valid = incoming.filter((s) => validateSystem(s).length === 0).map((s) => ({ ...s, origin: 'live' as const }));
    const turnedAway = rejected + (incoming.length - valid.length);
    if (valid.length === 0) return { ok: true, added: 0, updated: 0, rejected: turnedAway, ids: [], message: empty };
    const known = new Set(this.catalogue.systems.map((s) => s.id));
    const added = valid.filter((s) => !known.has(s.id)).length;
    const merged = mergeSystems(this.cache.systems, valid).systems;
    // Newest first when trimming, so the cap drops the stalest imports.
    merged.sort((a, b) => Date.parse(b.lastUpdated) - Date.parse(a.lastUpdated));
    this.cache.systems = merged.slice(0, MAX_LIVE_SYSTEMS);
    writeCache(this.storage, this.cache);
    this.catalogue.setLive(this.cache.systems, this.cache.bodies);
    const updated = valid.length - added;
    return {
      ok: true,
      added,
      updated,
      rejected: turnedAway,
      ids: valid.map((s) => s.id),
      message: `${added} new system${added === 1 ? '' : 's'}${updated ? `, ${updated} refreshed` : ''} from the NASA Exoplanet Archive.`,
    };
  }

  /** Import every system whose host-star name contains `term`. */
  importSystems(term: string): Promise<ImportResult> {
    return this.guarded(async () => {
      const t = sanitizeTerm(term);
      if (t.length < 2) return { ok: false, added: 0, updated: 0, rejected: 0, ids: [], message: 'Type at least two characters of a star name.' };
      const res = await fetchExoplanetSystems(this.call, searchWhere(t), { pageSize: 400, origin: 'live', now: () => new Date(this.now()).toISOString() });
      return this.commitSystems(res.systems, res.rejected.length, `No confirmed planetary system matches "${t}".`);
    });
  }

  /** Import further systems by a named selection (a different shell of the archive each time). */
  importMore(selection: 'nearby' | 'multi-star' | 'recent'): Promise<ImportResult> {
    return this.guarded(async () => {
      const where =
        selection === 'nearby'
          ? 'sy_dist>=25 and sy_dist<40'
          : selection === 'multi-star'
            ? 'sy_snum>=2 and sy_pnum>=2'
            : `disc_year>=${new Date(this.now()).getUTCFullYear() - 2} and sy_dist<150`;
      const res = await fetchExoplanetSystems(this.call, where, { pageSize: 600, origin: 'live', now: () => new Date(this.now()).toISOString() });
      // Stay inside the cache budget: keep the systems with the most planets.
      const room = Math.max(40, MAX_LIVE_SYSTEMS - this.cache.systems.length);
      const picked = [...res.systems].sort((a, b) => b.planets.length - a.planets.length).slice(0, room);
      return this.commitSystems(picked, res.rejected.length, 'The archive returned nothing new for that selection.');
    });
  }

  /** Re-fetch imported systems that have gone stale. Bundled records are refreshed by `npm run ingest:systems`. */
  refresh(force = false): Promise<ImportResult> {
    return this.guarded(async () => {
      const cutoff = this.now() - STALE_MS;
      const stale = this.cache.systems.filter((s) => force || Date.parse(s.lastUpdated) < cutoff);
      if (stale.length === 0) return { ok: true, added: 0, updated: 0, rejected: 0, ids: [], message: 'Imported records are up to date.' };
      const out: StarSystem[] = [];
      let rejected = 0;
      for (let i = 0; i < stale.length; i += 40) {
        const res = await fetchExoplanetSystems(this.call, hostsWhere(stale.slice(i, i + 40).map((s) => s.name)), { pageSize: 600, origin: 'live', now: () => new Date(this.now()).toISOString() });
        out.push(...res.systems);
        rejected += res.rejected.length;
      }
      return this.commitSystems(out, rejected, 'The archive no longer lists those systems; cached copies kept.');
    });
  }

  /** Look an asteroid or comet up in the JPL Small-Body Database and add it to the catalogue. */
  importSmallBody(term: string): Promise<ImportResult> {
    return this.guarded(async () => {
      const t = sanitizeTerm(term);
      if (!t) return { ok: false, added: 0, updated: 0, rejected: 0, ids: [], message: 'Type a name or designation, e.g. "433" or "Halley".' };
      const { body, reason } = await fetchSmallBody(this.call, t, () => new Date(this.now()).toISOString());
      if (!body) return { ok: true, added: 0, updated: 0, rejected: 0, ids: [], message: `JPL found no single object for "${t}"${reason ? ` (${reason})` : ''}.` };
      if (validateSmallBody(body).length > 0) return { ok: true, added: 0, updated: 0, rejected: 1, ids: [], message: 'JPL returned a record that failed validation; it was not added.' };
      const had = this.cache.bodies.some((b) => b.id === body.id);
      this.cache.bodies = [body, ...this.cache.bodies.filter((b) => b.id !== body.id)].slice(0, MAX_LIVE_BODIES);
      writeCache(this.storage, this.cache);
      this.catalogue.setLive(this.cache.systems, this.cache.bodies);
      return { ok: true, added: had ? 0 : 1, updated: had ? 1 : 0, rejected: 0, ids: [body.id], message: `${body.name} ${had ? 'refreshed' : 'added'} from the JPL Small-Body Database.` };
    });
  }

  /** Check that Horizons answers (used by the status panel) and return what it says about a body. */
  async probeHorizons(id = '399'): Promise<{ ok: boolean; radiusKm: number | null; massKg: number | null }> {
    try {
      const r = await fetchHorizonsBody(this.call, id);
      writeCache(this.storage, this.cache);
      return { ok: r.ok, radiusKm: r.radiusKm, massKg: r.massKg };
    } catch {
      return { ok: false, radiusKm: null, massKg: null };
    }
  }

  /** Forget everything imported at run time (bundled data is untouched). */
  clear(): void {
    this.cache = emptyCache();
    writeCache(this.storage, this.cache);
    this.catalogue.setLive([], []);
  }
}

// ------------------------------------------------------------------ browser / desktop transport

interface DesktopBridge {
  astroFetch?: (upstream: string, query: string) => Promise<{ ok: boolean; status: number; body: string }>;
}

class TransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * The route from the running game to the upstream services:
 *   desktop app -> the Electron main process fetches (no CORS there),
 *   web         -> the same-origin proxy at ./api/astro (Vite dev/preview server, or the serverless
 *                  function on the web host).
 * Both accept only the three upstreams in sources.ts. Returns null outside a browser.
 */
export function createTransport(timeoutMs = 20000): FetchText | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { lostOrbitDesktop?: DesktopBridge }).lostOrbitDesktop;
  if (bridge?.astroFetch) {
    const call = bridge.astroFetch;
    return async (upstream, query) => {
      const res = await call(upstream, query);
      if (!res.ok) throw new TransportError(res.status ? `HTTP ${res.status} from ${upstream}` : `could not reach ${upstream}`, res.status || undefined);
      return res.body;
    };
  }
  if (typeof fetch !== 'function') return null;
  return async (upstream, query) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`./api/astro?src=${upstream}&q=${encodeURIComponent(query)}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      const type = res.headers.get('content-type') ?? '';
      // A static host with no proxy answers /api/astro with its index.html: treat that as "no route".
      if (!res.ok || type.includes('text/html')) throw new TransportError(res.ok ? 'no import proxy on this host' : `HTTP ${res.status} from ${upstream}`, res.ok ? undefined : res.status);
      return await res.text();
    } catch (e) {
      if (e instanceof TransportError) throw e;
      throw new TransportError(ctl.signal.aborted ? `${upstream} timed out` : `could not reach ${upstream}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

function browserStorage(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

let service: AstroService | null = null;

/** The app-wide service. Creating it also loads cached imports into the catalogue (no network). */
export function getAstroService(catalogue: SystemCatalogue): AstroService {
  if (!service) service = new AstroService(catalogue, { transport: createTransport(), storage: browserStorage() });
  return service;
}
