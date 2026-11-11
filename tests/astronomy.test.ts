import { describe, expect, it } from 'vitest';
import { parsePhysical } from '../src/astronomy/api/horizons';
import { HttpClient, HttpError, MemoryCache, parseCsv } from '../src/astronomy/api/http';
import { matchImage } from '../src/astronomy/api/nasaImages';
import type { NasaImage } from '../src/astronomy/api/nasaImages';
import { describeObject, factRows, getCatalogue } from '../src/astronomy/database/catalogue';
import { packCatalogue, unpackCatalogue } from '../src/astronomy/database/codec';
import { validateObject } from '../src/astronomy/database/schema';
import type { AstroObject, CatalogueFile } from '../src/astronomy/database/schema';
import { deduplicate } from '../src/astronomy/ingestion/deduplicator';
import { classifyPlanet, cleanSimbadId, normalizeExoplanet, normalizeHorizons, normalizeNed, normalizeSimbad, normalizeSmallBody, pickCommonName } from '../src/astronomy/ingestion/normalizer';
import { runPipeline } from '../src/astronomy/ingestion/pipeline';
import { quantizeToSprite } from '../src/astronomy/ingestion/sprites';

const NOW = '2026-01-01T00:00:00.000Z';

const sbdbRow = (over: Record<string, string | number | null>) =>
  ({ spkid: 1, full_name: '1 Ceres', pdes: '1', name: 'Ceres', prefix: null, kind: 'an', class: 'MBA', e: '0.0797', a: '2.766', q: '2.5', i: '10.59', per: '1680', diameter: '939.4', rot_per: '9.07', albedo: '0.09', H: '3.3', spec_B: 'C', spec_T: 'G', GM: '62.6284', neo: 'N', pha: 'N', ...over }) as Parameters<typeof normalizeSmallBody>[0];

describe('bundled catalogue', () => {
  const cat = getCatalogue();

  it('is substantial and covers every kind of object', () => {
    expect(cat.size).toBeGreaterThan(1500);
    const cats = new Set(cat.objects.map((o) => o.category));
    for (const c of ['star', 'planet', 'moon', 'dwarf-planet', 'asteroid', 'comet', 'exoplanet', 'stellar-remnant', 'nebula', 'galaxy', 'quasar']) expect(cats.has(c as AstroObject['category'])).toBe(true);
  });

  it('has no duplicate objects', () => {
    const ids = new Set(cat.objects.map((o) => o.id));
    expect(ids.size).toBe(cat.size);
    // Re-running deduplication over the stored catalogue must be a no-op.
    expect(deduplicate([...cat.objects]).merged).toBe(0);
  });

  it('passes schema validation with no invented values', () => {
    const problems = cat.objects.flatMap((o) => validateObject(o).map((p) => `${o.id}: ${p}`));
    expect(problems).toEqual([]);
    for (const o of cat.objects) {
      for (const v of [...Object.values(o.physicalProperties), ...Object.values(o.orbitalProperties)]) {
        expect(v === null || Number.isFinite(v)).toBe(true);
      }
      expect(o.source).toBeTruthy();
      expect(o.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('attributes every image and only derives colours when there is none', () => {
    for (const o of cat.objects) {
      const v = o.visualProperties;
      if (v.imageUrl) {
        expect(v.imageUrl.startsWith('https://images-assets.nasa.gov/')).toBe(true);
        expect(v.imageAttribution).toBeTruthy();
        expect(v.imageSource).toContain('NASA Image and Video Library');
      } else {
        expect(v.colorSource).toBe('derived');
        expect(cat.sprite(o.id)).toBeNull();
      }
      expect(v.dominantColors.length).toBeGreaterThan(0);
    }
  });

  it('records where every source came from', () => {
    for (const key of ['sbdb', 'horizons', 'exoplanets', 'simbad', 'ned', 'images']) expect(cat.sources[key]).toBeDefined();
  });

  it('survives a pack / unpack round trip unchanged', () => {
    const file: CatalogueFile = { version: cat.version, generatedAt: cat.generatedAt, sources: cat.sources, objects: [...cat.objects] };
    expect(unpackCatalogue(JSON.parse(JSON.stringify(packCatalogue(file)))).objects).toEqual(file.objects);
  });

  it('searches and filters', () => {
    const jupiter = cat.search({ text: 'jupiter', category: 'planet' });
    expect(jupiter.map((o) => o.name)).toContain('Jupiter');
    expect(cat.moonsOf(jupiter[0].id).map((m) => m.name)).toEqual(['Io', 'Europa', 'Ganymede', 'Callisto']);
    expect(cat.search({ category: 'comet' }).every((o) => o.category === 'comet')).toBe(true);
    expect(cat.search({ text: 'zzzz-no-such-object' })).toEqual([]);
  });

  it('describes objects from their data only', () => {
    const ceres = cat.search({ text: 'ceres', category: 'dwarf-planet' })[0];
    expect(describeObject(ceres)).toContain('orbiting the Sun');
    // Names inside a class keep their capital; articles follow the sound of the class.
    const neptuneLike = cat.objects.find((o) => o.classification === 'Neptune-like exoplanet');
    if (neptuneLike) expect(describeObject(neptuneLike)).toMatch(/^A Neptune-like exoplanet/);
    const mGiant = cat.objects.find((o) => o.classification === 'M-type giant');
    if (mGiant) expect(describeObject(mGiant)).toMatch(/^An M-type giant/);
    const pulsar = cat.objects.find((o) => o.classification === 'Pulsar');
    if (pulsar) expect(describeObject(pulsar)).toMatch(/^A pulsar/);
    expect(factRows(ceres).some((r) => r.k === 'RADIUS')).toBe(true);
    // An object with no measurements yields no fact rows rather than placeholders.
    const bare = cat.objects.find((o) => Object.values(o.physicalProperties).every((v) => v === null) && Object.values(o.orbitalProperties).every((v) => v === null) && o.context.distanceLy === null && o.context.redshift === null && !o.context.spectralType);
    if (bare) expect(factRows(bare).every((r) => r.v.length > 0)).toBe(true);
  });
});

describe('normalisation', () => {
  it('converts small-body units and keeps unknowns null', () => {
    const o = normalizeSmallBody(sbdbRow({}), NOW)!;
    expect(o.category).toBe('dwarf-planet');
    expect(o.physicalProperties.radius).toBeCloseTo(469.7, 1);
    expect(o.physicalProperties.mass).toBeCloseTo(62.6284 / 6.6743e-20, -18);
    expect(o.orbitalProperties.orbitalPeriod).toBe(1680);
    const bare = normalizeSmallBody(sbdbRow({ pdes: '99999', name: null, diameter: null, GM: null, rot_per: null, albedo: null, spec_B: null, spec_T: null }), NOW)!;
    expect(bare.physicalProperties).toEqual({ radius: null, mass: null, temperature: null, luminosity: null, rotationPeriod: null });
    expect(bare.context.albedo).toBeNull();
    expect(bare.name).toBe('99999');
  });

  it('labels comets by designation', () => {
    const c = normalizeSmallBody(sbdbRow({ pdes: '1P', name: 'Halley', full_name: '1P/Halley', kind: 'cn', class: 'HTC', e: '0.9679' }), NOW)!;
    expect(c.category).toBe('comet');
    expect(c.designation).toBe('1P/Halley');
    expect(c.classification).toBe('Halley-type comet');
  });

  it('classifies exoplanets by size', () => {
    expect(classifyPlanet(1, null, 300)).toBe('Terrestrial exoplanet');
    expect(classifyPlanet(1.6, null, 300)).toBe('Super-Earth');
    expect(classifyPlanet(4, null, 300)).toBe('Neptune-like exoplanet');
    expect(classifyPlanet(11, null, 3)).toBe('Hot Jupiter');
    expect(classifyPlanet(null, 300, 400)).toBe('Gas giant exoplanet');
    expect(classifyPlanet(null, null, 10)).toBe('Exoplanet');
    const o = normalizeExoplanet({ pl_name: 'Test b', hostname: 'Test', pl_rade: 1, pl_bmasse: null, pl_orbper: 10, pl_orbsmax: 0.05, pl_orbeccen: 0, pl_orbincl: null, pl_eqt: null, st_spectype: 'M4V', st_teff: 3100, st_lum: null, sy_dist: 10, sy_snum: 1, sy_pnum: 1, disc_year: 2020, discoverymethod: 'Transit' }, NOW)!;
    expect(o.physicalProperties.radius).toBeCloseTo(6371, 0);
    expect(o.physicalProperties.mass).toBeNull();
    expect(o.context.distanceLy).toBeCloseTo(32.616, 2);
  });

  it('cleans SIMBAD identifiers and prefers proper names', () => {
    expect(cleanSimbadId('* alf Ori')).toBe('Alpha Ori');
    expect(cleanSimbadId('NAME Vela Pulsar')).toBe('Vela Pulsar');
    expect(pickCommonName(['Betelgeuse', 'Alpha Orionis'])).toBe('Betelgeuse');
    expect(pickCommonName(['Crab', 'Crab Nebula'], /nebula/i)).toBe('Crab Nebula');
    const row = { main_id: '* alf Ori', otype: 's*r', sp_type: 'M1-M2Ia-Iab', ra: '88.79', dec: '7.4', plx_value: '6.55', nbref: '2000', V: '0.42', B: '2.27' };
    const o = normalizeSimbad(row, ['Betelgeuse'], 3600, NOW)!;
    expect(o.name).toBe('Betelgeuse');
    expect(o.classification).toBe('Red supergiant');
    expect(o.context.distanceLy).toBeCloseTo(498, 0);
    // No parallax, no temperature: both stay null.
    const o2 = normalizeSimbad({ ...row, plx_value: '' }, undefined, null, NOW)!;
    expect(o2.context.distanceLy).toBeNull();
    expect(o2.physicalProperties.temperature).toBeNull();
  });

  it('normalises NED objects and skips untyped ones', () => {
    const g = normalizeNed({ queried: 'M87', preferredName: 'MESSIER 087', ra: 187.7, dec: 12.39, objType: 'G', redshift: 0.00428 }, NOW)!;
    expect(g.name).toBe('Messier 87');
    expect(g.category).toBe('galaxy');
    expect(normalizeNed({ queried: 'X', preferredName: 'X', ra: null, dec: null, objType: null, redshift: null }, NOW)).toBeNull();
  });

  it('parses Horizons data sheets, including scaled masses', () => {
    const jupiter = parsePhysical('  Mass x 10^26 (kg)     = 18.9819\n  Vol. Mean Radius (km) = 69911+-6\n  Sid. rot. period (III)= 9h 55m 29.711 s\n  GM (km^3/s^2)         = 126686531.900\n  Atmos. temp. (1 bar)  = 165+-5 K', null);
    expect(jupiter.radiusKm).toBe(69911);
    expect(jupiter.massKg).toBeCloseTo(1.898e27, -24);
    expect(jupiter.rotationHours).toBeCloseTo(9.925, 2);
    expect(jupiter.temperatureK).toBe(165);
    // Tiny moons print "Mass (10^20 kg) = 1.08 (10^-4)": the trailing multiplier must not be dropped.
    const phobos = parsePhysical('  Mass (10^20 kg )        =  1.08 (10^-4)', null);
    expect(phobos.massKg === null || phobos.massKg < 1e17).toBe(true);
    const viaGm = parsePhysical('  Mean radius (km)       = 11.1\n  GM (km^3/s^2)          = 0.0007087', null);
    expect(viaGm.massKg).toBeCloseTo(1.062e16, -14);
    expect(parsePhysical('nothing useful here', null)).toEqual({ radiusKm: null, massKg: null, rotationHours: null, temperatureK: null, luminositySun: null });
    const europa = parsePhysical('Rotational period   = Synchronous', 3.55);
    expect(europa.rotationHours).toBeCloseTo(85.2, 1);
  });

  it('builds Horizons records with ephemerides', () => {
    const o = normalizeHorizons(
      { target: { id: '502', name: 'Europa', center: '500@599', kind: 'moon', parent: 'Jupiter' }, epoch: '2026-01-01', elements: { e: 0.009, incDeg: 0.46, aAu: 0.00448, periodDays: 3.55 }, vector: { position: [1, 2, 3], velocity: [4, 5, 6] }, physical: { radiusKm: 1560.8, massKg: 4.8e22, rotationHours: null, temperatureK: null, luminositySun: null } },
      NOW,
    );
    expect(o.context.parentId).toBe('horizons:599');
    expect(o.context.ephemeris?.position).toEqual([1, 2, 3]);
  });
});

describe('deduplication', () => {
  it('merges the same body from two sources, highest priority first', () => {
    const horizons = normalizeHorizons({ target: { id: '999', name: 'Pluto', center: '500@10', kind: 'dwarf-planet' }, epoch: '2026-01-01', elements: null, vector: null, physical: { radiusKm: 1188.3, massKg: null, rotationHours: null, temperatureK: null, luminositySun: null } }, NOW);
    const sbdb = normalizeSmallBody(sbdbRow({ pdes: '134340', name: 'Pluto', full_name: '134340 Pluto', class: 'TNO', diameter: '2000', albedo: '0.3' }), NOW)!;
    const { objects, merged } = deduplicate([sbdb, horizons]);
    expect(merged).toBe(1);
    expect(objects).toHaveLength(1);
    expect(objects[0].source).toBe('JPL-HORIZONS');
    expect(objects[0].physicalProperties.radius).toBe(1188.3); // Horizons wins
    expect(objects[0].context.albedo).toBe(0.3); // SBDB fills the gap
    expect(objects[0].alsoIn).toEqual(['JPL-SBDB']);
  });

  it('never merges different objects that share a name', () => {
    const linearA = normalizeSmallBody(sbdbRow({ pdes: '11P', name: 'LINEAR', full_name: '11P/LINEAR', kind: 'cn', class: 'JFc' }), NOW)!;
    const linearB = normalizeSmallBody(sbdbRow({ pdes: '160P', name: 'LINEAR', full_name: '160P/LINEAR', kind: 'cn', class: 'JFc' }), NOW)!;
    const europaAsteroid = normalizeSmallBody(sbdbRow({ pdes: '52', name: 'Europa', full_name: '52 Europa' }), NOW)!;
    const europaMoon = normalizeHorizons({ target: { id: '502', name: 'Europa', center: '500@599', kind: 'moon', parent: 'Jupiter' }, epoch: '2026-01-01', elements: null, vector: null, physical: { radiusKm: 1560, massKg: null, rotationHours: null, temperatureK: null, luminositySun: null } }, NOW);
    expect(deduplicate([linearA, linearB, europaAsteroid, europaMoon]).objects).toHaveLength(4);
  });

  it('collapses two names for one galaxy', () => {
    const a = normalizeNed({ queried: 'M77', preferredName: 'MESSIER 077', ra: 1, dec: 2, objType: 'G', redshift: 0.0038 }, NOW)!;
    const b = normalizeNed({ queried: 'NGC 1068', preferredName: 'MESSIER 077', ra: 1, dec: 2, objType: 'G', redshift: 0.0038 }, NOW)!;
    expect(deduplicate([a, b]).objects).toHaveLength(1);
  });
});

describe('http client', () => {
  const response = (status: number, body = 'ok'): Response => new Response(body, { status });

  it('retries server errors and then succeeds', async () => {
    let calls = 0;
    const http = new HttpClient({ minIntervalMs: 0, retries: 3, fetchImpl: (async () => (++calls < 3 ? response(503) : response(200, 'done'))) as typeof fetch });
    // Backoff starts at 600 ms; keep the test fast by racing a generous timeout.
    await expect(http.text('https://example.org/a')).resolves.toBe('done');
    expect(calls).toBe(3);
  }, 20000);

  it('does not retry a client error', async () => {
    let calls = 0;
    const http = new HttpClient({ minIntervalMs: 0, fetchImpl: (async () => (calls++, response(404))) as typeof fetch });
    await expect(http.text('https://example.org/a')).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(1);
  });

  it('rate-limits requests per host', async () => {
    const stamps: number[] = [];
    const http = new HttpClient({ minIntervalMs: 120, fetchImpl: (async () => (stamps.push(Date.now()), response(200))) as typeof fetch });
    await Promise.all([http.text('https://example.org/1'), http.text('https://example.org/2'), http.text('https://example.org/3')]);
    expect(stamps[2] - stamps[0]).toBeGreaterThanOrEqual(220);
  });

  it('serves repeated requests from the cache', async () => {
    let calls = 0;
    const http = new HttpClient({ minIntervalMs: 0, cache: new MemoryCache(), fetchImpl: (async () => (calls++, response(200, 'cached'))) as typeof fetch });
    await http.text('https://example.org/a');
    await http.text('https://example.org/a');
    expect(calls).toBe(1);
    expect(http.cacheHits).toBe(1);
  });

  it('fails over to a mirror and remembers the dead host', async () => {
    const hits: string[] = [];
    const http = new HttpClient({
      minIntervalMs: 0,
      fetchImpl: (async (url: string) => {
        hits.push(new URL(url).host);
        if (url.includes('dead.example')) throw new Error('connect timeout');
        return response(200, 'from mirror');
      }) as typeof fetch,
    });
    const bases = ['https://dead.example', 'https://alive.example'];
    await expect(http.textFromMirrors(bases, '/q')).resolves.toBe('from mirror');
    await http.textFromMirrors(bases, '/q2');
    // Second call goes straight to the healthy mirror.
    expect(hits).toEqual(['dead.example', 'alive.example', 'alive.example']);
  });

  it('parses CSV with quoted fields', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n1,2\n')).toEqual([
      { a: 'x, y', b: 'say "hi"' },
      { a: '1', b: '2' },
    ]);
  });
});

describe('image matching', () => {
  const img = (over: Partial<NasaImage>): NasaImage => ({ nasaId: 'PIA1', title: 'Europa', description: '', keywords: ['Europa', 'Galileo'], center: 'JPL', credit: 'NASA/JPL', thumbUrl: 'https://images-assets.nasa.gov/x~thumb.jpg', dateCreated: null, ...over });

  it('accepts an image whose metadata names the object', () => {
    expect(matchImage(['Europa'], 'moon', [img({})])?.nasaId).toBe('PIA1');
    expect(matchImage(['Halley'], 'comet', [img({ title: 'Comet Halley', keywords: ['Halley'] })])).not.toBeNull();
  });

  it('rejects look-alikes rather than guessing', () => {
    // Shares the name but is a rocket, an event, an illustration, or a different object entirely.
    expect(matchImage(['Titan'], 'moon', [img({ title: 'Titan IV Rocket Launch', keywords: ['Titan'] })])).toBeNull();
    expect(matchImage(['Mars'], 'planet', [img({ title: 'Mars Celebration', keywords: ['Mars'], center: 'HQ' })])).toBeNull();
    expect(matchImage(['Kepler-22 b'], 'exoplanet', [img({ title: "Artist's Concept of Kepler-22 b", keywords: [] })])).toBeNull();
    expect(matchImage(['Juno'], 'asteroid', [img({ title: 'Juno Views Jupiter', keywords: ['Juno', 'Jupiter'] })])).toBeNull();
    expect(matchImage(['Vega'], 'star', [img({ title: 'Jupiter', keywords: ['Jupiter'] })])).toBeNull();
    // Third-party copyright is never used.
    expect(matchImage(['Europa'], 'moon', [img({ description: 'Copyright Example Observatory, used with permission' })])).toBeNull();
  });
});

describe('pixel sprites', () => {
  it('quantises an image to a small palette', () => {
    const w = 64;
    const rgba = new Uint8Array(w * w * 4);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const inside = Math.hypot(x - 32, y - 32) < 20;
        rgba[i] = inside ? 220 : 0;
        rgba[i + 1] = inside ? 120 : 0;
        rgba[i + 2] = inside ? 40 : 4;
        rgba[i + 3] = 255;
      }
    }
    const res = quantizeToSprite(rgba, w, w)!;
    expect(res.sprite.data).toHaveLength(32 * 32);
    expect(res.sprite.palette.length).toBeLessThanOrEqual(12);
    expect(res.colors[0]).toMatch(/^#[0-9a-f]{6}$/);
    expect(quantizeToSprite(new Uint8Array(4 * 4 * 4), 4, 4)).toBeNull();
  });
});

describe('ingestion pipeline', () => {
  /** Answers SBDB requests and fails everything else, like a partial outage. */
  const partialOutage = (async (url: string) => {
    if (url.includes('sbdb_query.api')) {
      return new Response(JSON.stringify({ fields: ['spkid', 'full_name', 'pdes', 'name', 'prefix', 'kind', 'class', 'e', 'a', 'q', 'i', 'per', 'diameter', 'rot_per', 'albedo', 'H', 'spec_B', 'spec_T', 'GM', 'neo', 'pha'], data: [[20000004, '4 Vesta', '4', 'Vesta', null, 'an', 'MBA', '0.089', '2.36', '2.15', '7.14', '1325', '525.4', '5.34', '0.42', '3.2', 'V', 'V', '17.29', 'N', 'N']] }), { status: 200 });
    }
    return new Response('down', { status: 503 });
  }) as typeof fetch;

  it('keeps going when sources fail, and keeps what it already had', async () => {
    const existingObject = normalizeNed({ queried: 'M87', preferredName: 'MESSIER 087', ra: 1, dec: 2, objType: 'G', redshift: 0.004 }, '2025-01-01T00:00:00.000Z')!;
    const existing: CatalogueFile = { version: 1, generatedAt: '2025-01-01T00:00:00.000Z', sources: { ned: { ok: true, count: 1, note: 'ok', fetchedAt: '2025-01-01T00:00:00.000Z' } }, objects: [existingObject] };
    const http = new HttpClient({ minIntervalMs: 0, retries: 0, fetchImpl: partialOutage });
    const res = await runPipeline({ http, only: ['sbdb', 'ned'], existing, now: NOW });
    expect(res.report.sbdb.ok).toBe(true);
    expect(res.report.ned.ok).toBe(false);
    expect(res.report.ned.note).toContain('keeping data');
    const ids = res.catalogue.objects.map((o) => o.id).sort();
    expect(ids).toEqual(['ned:messier-087', 'sbdb:4']);
    expect(res.added).toBe(1);
    // The untouched record keeps its original timestamp.
    expect(res.catalogue.objects.find((o) => o.id === 'ned:messier-087')?.lastUpdated).toBe('2025-01-01T00:00:00.000Z');
  }, 30000);

  it('is idempotent: a second identical run adds and changes nothing', async () => {
    const http = new HttpClient({ minIntervalMs: 0, retries: 0, fetchImpl: partialOutage });
    const first = await runPipeline({ http, only: ['sbdb'], now: NOW });
    const second = await runPipeline({ http, only: ['sbdb'], existing: first.catalogue, now: '2026-06-01T00:00:00.000Z' });
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.catalogue.objects).toEqual(first.catalogue.objects);
  }, 30000);
});
