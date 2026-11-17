import { useMemo, useState } from 'react';
import { getAstroService } from '../astronomy/systems/live';
import type { ImportResult } from '../astronomy/systems/live';
import { SOLAR_SYSTEM_ID, UNKNOWN, distanceText, getSystems, numText, periodText, systemTypeLabel } from '../astronomy/systems/store';
import type { SystemFilterKind } from '../astronomy/systems/store';
import { SYSTEM_SOURCE_LABEL } from '../astronomy/systems/types';
import type { SmallBody, StarSystem } from '../astronomy/systems/types';
import type { SaveData } from '../game/persistence';
import type { SfxName } from '../game/types';
import type { Progression } from '../progression/service';

interface Props {
  save: SaveData;
  progress: Progression;
  onFly: (system: StarSystem) => void;
  sfx: (n: SfxName) => void;
}

type View = SystemFilterKind | 'bodies';
type Status = 'all' | 'discovered' | 'undiscovered';

const LIST_LIMIT = 140;
const KINDS: [View, string][] = [
  ['all', 'ALL SYSTEMS'],
  ['single', 'SINGLE STAR'],
  ['binary', 'BINARY'],
  ['multiple', 'MULTIPLE STAR'],
  ['planetary', 'PLANETARY'],
  ['circumbinary', 'CIRCUMBINARY'],
  ['bodies', 'ASTEROIDS & COMETS'],
];

const ago = (iso: string | undefined): string => (iso ? iso.slice(0, 10) : 'NEVER');

/**
 * Star systems: every system on file (bundled NASA Exoplanet Archive snapshot, the Solar System
 * from JPL Horizons, binaries identified by SIMBAD, and anything imported live), with the pilot's
 * own exploration record alongside. Values a source does not give read "Unknown".
 */
export function SystemsTab({ save, progress, onFly, sfx }: Props) {
  const systems = getSystems();
  const service = getAstroService(systems);
  const [view, setView] = useState<View>('all');
  const [status, setStatus] = useState<Status>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rev, setRev] = useState(systems.revision);
  const [term, setTerm] = useState('');
  const [bodyTerm, setBodyTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showImport, setShowImport] = useState(false);

  const discovered = useMemo(() => new Set(Object.keys(save.journey.systems)), [save.journey.systems]);
  const counts = useMemo(() => systems.counts(), [systems, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    if (view === 'bodies') return [];
    const found = systems.search({ text: query, kind: view, status, discovered });
    // An exact name (or alias) match first, then discovered (most recent first), then nearest.
    const q = query.trim().toLowerCase();
    const exact = (s: StarSystem): boolean => !!q && (s.name.toLowerCase() === q || systems.aliases(s.id).some((a) => a.toLowerCase() === q));
    return found.sort((a, b) => {
      if (exact(a) !== exact(b)) return exact(a) ? -1 : 1;
      const da = save.journey.systems[a.id]?.at ?? '';
      const db = save.journey.systems[b.id]?.at ?? '';
      if (!!da !== !!db) return da ? -1 : 1;
      if (da && db) return db.localeCompare(da);
      return (a.distanceLy ?? Infinity) - (b.distanceLy ?? Infinity);
    });
  }, [systems, rev, view, status, query, discovered, save.journey.systems]); // eslint-disable-line react-hooks/exhaustive-deps
  const bodies = useMemo(() => {
    const q = query.trim().toLowerCase();
    return systems.bodies.filter((b) => !q || b.name.toLowerCase().includes(q) || (b.orbitClass ?? '').toLowerCase().includes(q));
  }, [systems, rev, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = view === 'bodies' ? null : ((selectedId ? list.find((s) => s.id === selectedId) : undefined) ?? list[0] ?? null);
  const selectedBody = view === 'bodies' ? (bodies.find((b) => b.id === selectedId) ?? bodies[0] ?? null) : null;

  const run = async (job: () => Promise<ImportResult>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    sfx('click');
    const res = await job();
    setBusy(false);
    setResult(res);
    setRev(systems.revision);
    if (res.ok && res.added > 0) {
      // Imports count towards the pilot's record; the event is what unlocks OPEN ARCHIVE.
      progress.dispatch({ type: 'live_import', added: res.added });
      sfx('upgrade');
    } else sfx(res.ok ? 'dock' : 'warning');
    if (res.ids.length > 0) {
      const body = res.ids[0].startsWith('sb:');
      setView(body ? 'bodies' : 'all');
      setStatus('all');
      setQuery('');
      setSelectedId(res.ids[0]);
    }
  };

  return (
    <div className="sys-tab">
      <div className="sys-status">
        <span>
          <b>{counts.total.toLocaleString('en-US')}</b> SYSTEMS · <b>{counts.planets.toLocaleString('en-US')}</b> PLANETS · <b>{counts.binary + counts.multiple}</b> MULTI-STAR · <b>{counts.circumbinary}</b> CIRCUMBINARY · <b>{discovered.size}</b> DISCOVERED
        </span>
        <span className="sys-src">
          SNAPSHOT {systems.generatedAt.slice(0, 10)} · {counts.live} IMPORTED LIVE · {systems.bodies.length} SMALL BODIES
        </span>
        <button className="btn small outline" onClick={() => setShowImport((v) => !v)} aria-expanded={showImport}>
          {showImport ? 'CLOSE LIVE IMPORT' : 'LIVE IMPORT'}
        </button>
      </div>

      {showImport && (
        <div className="import-panel">
          <div className="import-row">
            <div className="import-block">
              <div className="label">NASA EXOPLANET ARCHIVE · IMPORT SYSTEMS BY HOST STAR NAME</div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => service.importSystems(term));
                }}
              >
                <input className="x-input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="E.G. KEPLER-22, GJ 667, HAT-P" aria-label="Host star name" spellCheck={false} />
                <button className="btn small outline" type="submit" disabled={busy || term.trim().length < 2}>
                  IMPORT
                </button>
              </form>
              <div className="import-more">
                <button className="btn small outline" disabled={busy} onClick={() => void run(() => service.importMore('nearby'))}>
                  + NEARBY (25–40 PC)
                </button>
                <button className="btn small outline" disabled={busy} onClick={() => void run(() => service.importMore('multi-star'))}>
                  + MULTI-STAR, MULTI-PLANET
                </button>
                <button className="btn small outline" disabled={busy} onClick={() => void run(() => service.importMore('recent'))}>
                  + RECENT DISCOVERIES
                </button>
                <button className="btn small outline" disabled={busy || service.cached.systems === 0} onClick={() => void run(() => service.refresh(true))}>
                  REFRESH IMPORTED
                </button>
              </div>
            </div>
            <div className="import-block">
              <div className="label">JPL SMALL-BODY DATABASE · LOOK UP AN ASTEROID OR COMET</div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => service.importSmallBody(bodyTerm));
                }}
              >
                <input className="x-input" value={bodyTerm} onChange={(e) => setBodyTerm(e.target.value)} placeholder="E.G. 433, APOPHIS, 1P" aria-label="Asteroid or comet" spellCheck={false} />
                <button className="btn small outline" type="submit" disabled={busy || !bodyTerm.trim()}>
                  LOOK UP
                </button>
              </form>
              <div className="import-sync">
                LAST CONTACT · EXOPLANET ARCHIVE {ago(service.lastSync.exo)} · SMALL-BODY DATABASE {ago(service.lastSync.sbdb)}
              </div>
            </div>
          </div>
          <div className={`import-result${result && !result.ok ? ' bad' : ''}`} role="status">
            {busy
              ? 'CONTACTING THE ARCHIVE …'
              : result
                ? `${result.message}${result.rejected > 0 ? ` ${result.rejected} record(s) failed validation and were left out.` : ''}`
                : 'Imports are validated, merged with what is on file and cached on this device, so they stay available offline. Nothing is fetched unless you ask.'}
          </div>
        </div>
      )}

      <div className="cat-body">
        <div className="cat-left">
          <div className="cat-filters">
            {KINDS.map(([k, label]) => (
              <button
                key={k}
                className={`chip${view === k ? ' on' : ''}`}
                onClick={() => {
                  setView(k);
                  setSelectedId(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {view !== 'bodies' && (
            <div className="cat-filters">
              {(['all', 'discovered', 'undiscovered'] as Status[]).map((v) => (
                <button key={v} className={`chip${status === v ? ' on' : ''}`} onClick={() => setStatus(v)}>
                  {v === 'all' ? 'ANY STATUS' : v.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <input className="x-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={view === 'bodies' ? 'SEARCH SMALL BODIES' : 'SEARCH SYSTEMS, PLANETS, SPECTRAL TYPES'} aria-label="Search" spellCheck={false} />
          <div className="cat-list">
            {view !== 'bodies' &&
              list.slice(0, LIST_LIMIT).map((s) => (
                <button key={s.id} className={`cat-row sys-row${selected?.id === s.id ? ' on' : ''}${discovered.has(s.id) ? ' seen' : ''}`} onClick={() => setSelectedId(s.id)}>
                  <span className="n">
                    {discovered.has(s.id) && <i className="seen-dot" aria-label="Discovered" />}
                    {s.name}
                    {systems.aliases(s.id).length > 0 && <em> · {systems.aliases(s.id)[0]}</em>}
                  </span>
                  <span className="c">
                    {s.kind === 'single' ? '1 STAR' : `${s.starCount} STARS`} · {s.planetCount} {s.planetCount === 1 ? 'PLANET' : 'PLANETS'}
                    {s.origin === 'live' ? ' · LIVE' : ''}
                  </span>
                </button>
              ))}
            {view !== 'bodies' && list.length > LIST_LIMIT && <div className="cat-empty">+ {list.length - LIST_LIMIT} MORE · REFINE THE SEARCH</div>}
            {view !== 'bodies' && list.length === 0 && <div className="cat-empty">NO SYSTEM ON FILE MATCHES. TRY LIVE IMPORT.</div>}
            {view === 'bodies' &&
              bodies.map((b) => (
                <button key={b.id} className={`cat-row${selectedBody?.id === b.id ? ' on' : ''}`} onClick={() => setSelectedId(b.id)}>
                  <span className="n">{b.name}</span>
                  <span className="c">
                    {b.kind.toUpperCase()}
                    {b.orbitClass ? ` · ${b.orbitClass.toUpperCase()}` : ''}
                  </span>
                </button>
              ))}
            {view === 'bodies' && bodies.length === 0 && (
              <div className="cat-empty">
                NO SMALL BODIES IMPORTED YET. THE BUNDLED CATALOGUE&apos;S ASTEROIDS AND COMETS ARE UNDER THE OBJECTS TAB; USE LIVE IMPORT TO LOOK UP ANY OTHER BY NAME.
              </div>
            )}
          </div>
        </div>
        <div className="cat-detail">
          {selected && <SystemCard system={selected} save={save} aliases={systems.aliases(selected.id)} onFly={onFly} />}
          {selectedBody && <BodyCard body={selectedBody} />}
          {!selected && !selectedBody && <div className="cat-empty">SELECT AN ENTRY</div>}
        </div>
      </div>
    </div>
  );
}

function SystemCard({ system: s, save, aliases, onFly }: { system: StarSystem; save: SaveData; aliases: string[]; onFly: (s: StarSystem) => void }) {
  const rec = save.journey.systems[s.id];
  const star = s.stars[0];
  const first = s.planets.find((p) => p.discoveryYear !== null && p.discoveryYear === s.discoveryYear) ?? s.planets[0];
  const surveyed = s.planets.filter((p) => save.journey.planets.includes(p.name)).length;
  return (
    <div className="obj-card sys-card">
      <div className="card-top">
        <div className="sys-glyph" aria-hidden="true">
          {Array.from({ length: Math.min(3, s.starCount) }, (_, i) => (
            <i key={i} className={`star s${i}`} />
          ))}
          {s.planets.slice(0, 8).map((p, i) => (
            <i key={p.name} className="planet" style={{ left: `${34 + i * 8}%` }} />
          ))}
        </div>
        <div className="card-id">
          <div className={`badge ${rec ? 'real' : 'variant'}`}>{rec ? 'DISCOVERED' : 'NOT YET ENCOUNTERED'}</div>
          <div className="card-name">{s.name}</div>
          {aliases.length > 0 && <div className="card-des">ALSO KNOWN AS {aliases.join(', ').toUpperCase()}</div>}
          <div className="card-class">{systemTypeLabel(s)}</div>
        </div>
      </div>

      <div className="facts">
        <Fact k="KNOWN STARS" v={String(s.starCount)} />
        <Fact k="KNOWN PLANETS" v={String(s.planetCount)} />
        <Fact k="DISTANCE FROM EARTH" v={distanceText(s)} />
        <Fact k="HOST STAR" v={star.name} />
        <Fact k="SPECTRAL TYPE" v={star.spectralType ?? UNKNOWN} />
        <Fact k="EFFECTIVE TEMPERATURE" v={numText(star.teff, ' K', 4)} />
        <Fact k="STELLAR RADIUS" v={numText(star.radiusSun, ' R☉')} />
        <Fact k="STELLAR MASS" v={numText(star.massSun, ' M☉')} />
        <Fact k="FIRST DISCOVERY" v={s.id === SOLAR_SYSTEM_ID ? 'Known since antiquity' : s.discoveryYear === null ? UNKNOWN : String(s.discoveryYear)} />
        <Fact k="DISCOVERY METHOD" v={first?.discoveryMethod ?? UNKNOWN} />
        <Fact k="DISCOVERY FACILITY" v={first?.discoveryFacility ?? UNKNOWN} />
      </div>

      {s.planets.length > 0 ? (
        <div className="planet-table-wrap">
          <table className="planet-table">
            <thead>
              <tr>
                <th>PLANET</th>
                <th>PERIOD</th>
                <th>SEMI-MAJOR AXIS</th>
                <th>RADIUS</th>
                <th>MASS</th>
                <th>EQ. TEMP</th>
              </tr>
            </thead>
            <tbody>
              {s.planets.map((p) => (
                <tr key={p.name} className={save.journey.planets.includes(p.name) ? 'met' : ''}>
                  <th>{p.name}</th>
                  <td>{periodText(p.periodDays)}</td>
                  <td>{numText(p.smaAu, ' AU')}</td>
                  <td>{numText(p.radiusEarth, ' R⊕')}</td>
                  <td>{numText(p.massEarth, ' M⊕')}</td>
                  <td>{numText(p.eqTempK, ' K', 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card-note">NO PLANETS ARE CATALOGUED FOR THIS SYSTEM.</div>
      )}

      <div className="card-meta">
        <div>
          <span className="label">SOURCE</span> {SYSTEM_SOURCE_LABEL[s.source]} · {s.sourceUrl}
        </div>
        <div>
          <span className="label">LAST UPDATED</span> {s.lastUpdated.slice(0, 10)} · {s.origin === 'live' ? 'imported live, cached on this device' : 'bundled snapshot'}
        </div>
        {s.kind !== 'single' && (
          <div>
            <span className="label">MULTIPLICITY</span>{' '}
            {s.source === 'SIMBAD'
              ? 'Classified as a binary by its SIMBAD object type.'
              : `The archive lists ${s.starCount} stars${s.hostConfig === 'circumbinary' ? ' and flags the planets as circumbinary' : s.hostConfig === 'circumstellar' ? '; the planets orbit one of them' : ''}. Only the host star's properties are catalogued here.`}
          </div>
        )}
        <div>
          <span className="label">EXPLORATION</span>{' '}
          {rec
            ? `Discovered in sector ${String(rec.sector).padStart(3, '0')}${rec.at ? ` on ${rec.at.slice(0, 10)}` : ''} · ${rec.visits} visit${rec.visits === 1 ? '' : 's'} · ${surveyed}/${s.planets.length} worlds encountered`
            : 'Not yet encountered. It can turn up in a run, or be flown from here.'}
        </div>
        <div>
          <span className="label">IN GAME</span> Scale is compressed and orbits are simplified for play; star colour, the number and order of worlds and their sizes come from the data above.
        </div>
      </div>
      {s.planets.length > 0 && (
        <div className="card-act">
          <button className="btn outline nav" onClick={() => onFly(s)}>
            {rec ? 'REVISIT THIS SYSTEM' : 'FLY THIS SYSTEM'}
          </button>
          <span className="label">ONE SECTOR · SURVEY FLIGHT · HALF PAY</span>
        </div>
      )}
    </div>
  );
}

function BodyCard({ body: b }: { body: SmallBody }) {
  const flag = (v: boolean | null): string => (v === null ? UNKNOWN : v ? 'Yes' : 'No');
  return (
    <div className="obj-card sys-card">
      <div className="card-top">
        <div className="card-id">
          <div className="badge real">REAL OBJECT · IMPORTED LIVE</div>
          <div className="card-name">{b.name}</div>
          <div className="card-class">{b.kind.toUpperCase()}</div>
        </div>
      </div>
      <div className="facts">
        <Fact k="DESIGNATION" v={b.designation} />
        <Fact k="ORBIT CLASS" v={b.orbitClass ?? UNKNOWN} />
        <Fact k="SEMI-MAJOR AXIS" v={numText(b.smaAu, ' AU')} />
        <Fact k="ECCENTRICITY" v={numText(b.eccentricity, '')} />
        <Fact k="INCLINATION" v={numText(b.inclinationDeg, '°')} />
        <Fact k="ORBITAL PERIOD" v={periodText(b.periodDays)} />
        <Fact k="DIAMETER" v={numText(b.diameterKm, ' km')} />
        <Fact k="ROTATION PERIOD" v={numText(b.rotationHours, ' h')} />
        <Fact k="ALBEDO" v={numText(b.albedo, '')} />
        <Fact k="NEAR-EARTH OBJECT" v={flag(b.neo)} />
        <Fact k="POTENTIALLY HAZARDOUS" v={flag(b.pha)} />
      </div>
      <div className="card-meta">
        <div>
          <span className="label">SOURCE</span> NASA/JPL Small-Body Database · {b.sourceUrl}
        </div>
        <div>
          <span className="label">LAST UPDATED</span> {b.lastUpdated.slice(0, 10)} · imported live, cached on this device
        </div>
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className={`fact${v === UNKNOWN ? ' unknown' : ''}`}>
      <span className="k">{k}</span>
      <span className="dots" />
      <span className="v">{v}</span>
    </div>
  );
}
