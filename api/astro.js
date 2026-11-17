// Same-origin import proxy for the in-game astronomical catalogue.
//
// NASA's Exoplanet Archive and JPL's SSD services do not send CORS headers, so a browser cannot
// call them directly. This handler forwards a GET to one of three fixed upstreams and returns the
// body. It is deliberately not a general proxy: the upstream is chosen by key, never by URL.
//
// It is written against plain Node request / response objects, so the same file is
//   - the serverless function at /api/astro on the web host, and
//   - the middleware the Vite dev and preview servers mount (see vite.config.ts).

export const UPSTREAMS = {
  exo: 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync',
  sbdb: 'https://ssd-api.jpl.nasa.gov/sbdb.api',
  horizons: 'https://ssd.jpl.nasa.gov/api/horizons.api',
};

const MAX_QUERY = 4000;
const TIMEOUT_MS = 25000;

/** Fetch one upstream. Resolves to { status, body, type }; never throws. */
export async function fetchUpstream(src, query, fetchImpl = fetch) {
  const base = Object.prototype.hasOwnProperty.call(UPSTREAMS, src) ? UPSTREAMS[src] : null;
  if (!base) return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'unknown source' }) };
  if (typeof query !== 'string' || query.length === 0 || query.length > MAX_QUERY || /[\r\n#]/.test(query)) {
    return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'bad query' }) };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${base}?${query}`, { method: 'GET', signal: ctl.signal, headers: { Accept: 'application/json', 'User-Agent': 'lost-orbit-game' } });
    const body = await res.text();
    return { status: res.status, type: res.headers.get('content-type') || 'application/json', body };
  } catch (e) {
    return { status: 502, type: 'application/json', body: JSON.stringify({ error: ctl.signal.aborted ? 'upstream timed out' : 'upstream unreachable' }) };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('');
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const out = await fetchUpstream(url.searchParams.get('src'), url.searchParams.get('q'));
  res.statusCode = out.status;
  res.setHeader('Content-Type', out.type.includes('json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Archive data changes slowly: let the edge and the browser hold successful answers for a day.
  res.setHeader('Cache-Control', out.status === 200 ? 'public, max-age=86400, s-maxage=86400' : 'no-store');
  res.end(out.body);
}
