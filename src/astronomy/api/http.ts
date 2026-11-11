/**
 * Shared HTTP layer for all astronomy API clients: per-host rate limiting, timeouts,
 * retry with exponential backoff, mirror fail-over and an optional response cache.
 *
 * It only relies on `fetch`, so the same clients run in Node (ingestion script) and in a browser.
 */

export interface ResponseCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export class MemoryCache implements ResponseCache {
  private map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
}

export interface HttpOptions {
  /** Minimum delay between two requests to the same host, ms. */
  minIntervalMs?: number;
  retries?: number;
  timeoutMs?: number;
  cache?: ResponseCache | null;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  /** Per-host overrides of `minIntervalMs`. */
  hostIntervals?: Record<string, number>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  /** Form fields for POST (sent url-encoded). */
  form?: Record<string, string>;
  timeoutMs?: number;
  /** Skip the cache for this call. */
  fresh?: boolean;
  retries?: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class HttpClient {
  private opts: Required<Omit<HttpOptions, 'cache' | 'fetchImpl' | 'log' | 'hostIntervals'>>;
  private cache: ResponseCache | null;
  private fetchImpl: typeof fetch;
  private log: (msg: string) => void;
  private hostIntervals: Record<string, number>;
  /** Earliest time the next request to each host may start. */
  private nextSlot = new Map<string, number>();
  private deadHosts = new Set<string>();
  private healthyHosts = new Set<string>();
  requests = 0;
  cacheHits = 0;

  constructor(opts: HttpOptions = {}) {
    this.opts = { minIntervalMs: opts.minIntervalMs ?? 350, retries: opts.retries ?? 3, timeoutMs: opts.timeoutMs ?? 45000 };
    this.cache = opts.cache ?? null;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.log = opts.log ?? (() => undefined);
    this.hostIntervals = opts.hostIntervals ?? {};
  }

  private async throttle(host: string): Promise<void> {
    const gap = this.hostIntervals[host] ?? this.opts.minIntervalMs;
    const now = Date.now();
    const at = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, at + gap);
    if (at > now) await sleep(at - now);
  }

  /** Fetch a URL as text. Throws HttpError after all retries are exhausted. */
  async text(url: string, req: RequestOptions = {}): Promise<string> {
    const body = req.form ? new URLSearchParams(req.form).toString() : undefined;
    const key = `${req.method ?? 'GET'} ${url}${body ? ` ${body}` : ''}`;
    if (this.cache && !req.fresh) {
      const hit = await this.cache.get(key);
      if (hit !== null) {
        this.cacheHits++;
        return hit;
      }
    }
    const host = new URL(url).host;
    const retries = req.retries ?? this.opts.retries;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.throttle(host);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? this.opts.timeoutMs);
      try {
        this.requests++;
        const res = await this.fetchImpl(url, {
          method: req.method ?? (body ? 'POST' : 'GET'),
          body,
          headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          // 4xx (other than rate limiting) will not get better by retrying.
          const retryable = res.status === 429 || res.status >= 500;
          const err = new HttpError(`HTTP ${res.status} from ${host}`, res.status, url);
          if (!retryable) throw err;
          lastErr = err;
        } else {
          const text = await res.text();
          if (this.cache) await this.cache.set(key, text);
          return text;
        }
      } catch (e) {
        if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < retries) {
        const wait = Math.min(15000, 600 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
        this.log(`retry ${attempt + 1}/${retries} for ${host} in ${Math.round(wait)}ms`);
        await sleep(wait);
      }
    }
    if (lastErr instanceof HttpError) throw lastErr;
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new HttpError(`request to ${host} failed: ${msg}`, 0, url);
  }

  async json<T>(url: string, req: RequestOptions = {}): Promise<T> {
    const text = await this.text(url, req);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(`non-JSON response from ${new URL(url).host}`, 0, url);
    }
  }

  /** Try the same path against several mirrors in order; the first one that answers wins. */
  async textFromMirrors(bases: readonly string[], path: string, req: RequestOptions = {}): Promise<string> {
    let last: unknown = null;
    // Hosts that already failed in this session go last, so a dead mirror costs one timeout, not one per query.
    const order = [...bases].sort((a, b) => Number(this.deadHosts.has(new URL(a).host)) - Number(this.deadHosts.has(new URL(b).host)));
    for (const base of order) {
      const host = new URL(base).host;
      try {
        const probing = !this.healthyHosts.has(host);
        const text = await this.text(base + path, {
          ...req,
          retries: req.retries ?? (probing ? 0 : 1),
          timeoutMs: probing ? Math.min(20000, req.timeoutMs ?? 20000) : req.timeoutMs,
        });
        this.healthyHosts.add(host);
        this.deadHosts.delete(host);
        return text;
      } catch (e) {
        last = e;
        // 400 means the host is alive and rejected the query itself - another mirror would say the same.
        // Anything else (404 from a half-restored host, 5xx, timeouts) is the mirror's problem.
        if (e instanceof HttpError && e.status === 400) throw e;
        this.deadHosts.add(host);
        this.healthyHosts.delete(host);
        this.log(`mirror ${host} unavailable, trying next`);
      }
    }
    throw last instanceof Error ? last : new Error('all mirrors failed');
  }
}

/** Minimal RFC-4180 CSV parser (quoted fields, embedded commas / newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = r[i] ?? ''));
    return o;
  });
}
