import { useMemo, useRef, useState } from 'react';
import { describeObject, factRows, getCatalogue, sourceLine } from '../astronomy/database/catalogue';
import { CATEGORY_LABEL } from '../astronomy/database/schema';
import type { AstroCategory, AstroObject } from '../astronomy/database/schema';
import type { SaveData } from '../game/persistence';
import { portraitFor } from '../game/render/portrait';
import type { SfxName } from '../game/types';
import { environment, primaryEnvironment } from '../generation/environments';
import { discoveryStats } from '../progression/discovery';
import { isComplete, MILESTONES } from '../progression/milestones';
import { environmentEntries } from '../progression/unlocks';
import { useKeys } from './hooks';
import { Portrait } from './Portrait';

interface Props {
  save: SaveData;
  onBack: () => void;
  sfx: (n: SfxName) => void;
}

type Tab = 'objects' | 'environments' | 'milestones';
const LIST_LIMIT = 120;

/**
 * The celestial catalogue: an old survey-computer view of everything the player has encountered.
 * Only objects that have actually been met are listed; the rest of the database stays dark.
 */
export function Catalogue({ save, onBack, sfx }: Props) {
  const catalogue = getCatalogue();
  const log = save.journey;
  const [tab, setTab] = useState<Tab>('objects');
  const [category, setCategory] = useState<AstroCategory | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useKeys({ Escape: onBack });

  const stats = useMemo(() => discoveryStats(log, catalogue), [log, catalogue]);
  const ids = useMemo(() => new Set(Object.keys(log.objects)), [log]);
  const found = useMemo(() => {
    const list = catalogue.search({ text: query, category: category ?? undefined, ids });
    // Most recent discoveries first.
    return list.sort((a, b) => (log.objects[b.id]?.at ?? '').localeCompare(log.objects[a.id]?.at ?? ''));
  }, [catalogue, query, category, ids, log]);
  const selected = (selectedId ? found.find((o) => o.id === selectedId) : undefined) ?? found[0] ?? null;

  const pick = (fn: () => void) => () => {
    sfx('click');
    fn();
  };

  return (
    <div className="overlay dim">
      <div className="panel catalogue" role="dialog" aria-label="Celestial catalogue">
        <div className="cat-head">
          <div>
            <h2 className="panel-title">CELESTIAL CATALOGUE</h2>
            <p className="panel-sub">SURVEY DATABASE · {catalogue.size.toLocaleString('en-US')} OBJECTS ON FILE · SNAPSHOT {catalogue.generatedAt.slice(0, 10)}</p>
          </div>
          <div className="cat-count">
            <div className="label">ENCOUNTERED</div>
            <div className="value">
              {stats.discovered}
              <span> / {stats.total.toLocaleString('en-US')}</span>
            </div>
          </div>
        </div>

        <div className="cat-tabs" role="tablist">
          {(['objects', 'environments', 'milestones'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`cat-tab${tab === t ? ' on' : ''}`} onClick={pick(() => setTab(t))}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {tab === 'objects' && (
          <div className="cat-body">
            <div className="cat-left">
              <div className="cat-filters">
                <button className={`chip${category === null ? ' on' : ''}`} onClick={pick(() => setCategory(null))}>
                  ALL {stats.discovered}
                </button>
                {stats.categories.map((c) => (
                  <button key={c.category} className={`chip${category === c.category ? ' on' : ''}${c.discovered === 0 ? ' empty' : ''}`} onClick={pick(() => setCategory(c.category))}>
                    {CATEGORY_LABEL[c.category]} {c.discovered}/{c.total}
                  </button>
                ))}
              </div>
              <label className="cat-search">
                <span>&gt;</span>
                <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SEARCH LOG" spellCheck={false} aria-label="Search discovered objects" />
              </label>
              <div className="cat-list">
                {found.length === 0 && (
                  <div className="cat-empty">
                    {stats.discovered === 0 ? 'NO ENTRIES YET. EVERY SECTOR YOU ENTER IS LOGGED HERE.' : 'NO LOGGED OBJECT MATCHES.'}
                  </div>
                )}
                {found.slice(0, LIST_LIMIT).map((o) => (
                  <button key={o.id} className={`cat-row${selected?.id === o.id ? ' on' : ''}`} onClick={pick(() => setSelectedId(o.id))}>
                    <span className="n">{o.name}</span>
                    <span className="c">{o.classification}</span>
                  </button>
                ))}
                {found.length > LIST_LIMIT && <div className="cat-empty">+ {found.length - LIST_LIMIT} MORE · REFINE THE SEARCH</div>}
                <div className="cat-dark">
                  {(stats.total - stats.discovered).toLocaleString('en-US')} OBJECTS ON FILE NOT YET ENCOUNTERED
                  {log.proceduralVisits > 0 && <> · {log.proceduralVisits} PROCEDURAL VARIANTS SURVEYED</>}
                  {log.fictionalVisits > 0 && <> · {log.fictionalVisits} UNCHARTED</>}
                </div>
              </div>
            </div>
            <div className="cat-detail">{selected ? <ObjectCard object={selected} save={save} /> : <div className="cat-empty">SELECT AN ENTRY</div>}</div>
          </div>
        )}

        {tab === 'environments' && (
          <div className="cat-envs">
            {environmentEntries(log, save.records.highestLevel, catalogue).map((e) => (
              <div key={e.env.id} className={`env ${e.status}`}>
                <div className="env-top">
                  <span className="env-name">{e.status === 'locked' ? '? ? ?' : e.env.label}</span>
                  <span className={`env-rarity ${e.env.rarity}`}>{e.env.rarity.toUpperCase()}</span>
                </div>
                <div className="env-fam">
                  {e.env.family.toUpperCase()}
                  {e.env.fictional ? ' · FICTIONAL' : ''}
                </div>
                <div className="env-hint">
                  {e.status === 'visited'
                    ? e.hosts > 0
                      ? `${e.hostsDiscovered} / ${e.hosts} REAL HOSTS CATALOGUED`
                      : e.env.fictional
                        ? 'NO REAL-WORLD COUNTERPART'
                        : 'PROCEDURAL VARIANTS ONLY'
                    : e.hint}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'milestones' && (
          <div className="cat-miles">
            {MILESTONES.map((m) => {
              const ctx = { log, highestLevel: save.records.highestLevel };
              const done = save.milestones.includes(m.id) || isComplete(m, ctx);
              const [cur, target] = m.progress(ctx);
              return (
                <div key={m.id} className={`mile${done ? ' done' : ''}`}>
                  <div className="mile-top">
                    <span className="mile-title">{m.title}</span>
                    <span className="mile-reward">{done ? 'COMPLETE' : `+${m.reward} CR`}</span>
                  </div>
                  <div className="mile-desc">{m.description}</div>
                  <div className="mile-bar">
                    <i style={{ width: `${Math.min(100, (cur / target) * 100)}%` }} />
                  </div>
                  <div className="mile-num">
                    {Math.min(cur, target)} / {target}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="back-row">
          <button className="btn outline nav" onClick={pick(onBack)}>
            BACK
          </button>
        </div>
      </div>
    </div>
  );
}

function ObjectCard({ object: o, save }: { object: AstroObject; save: SaveData }) {
  const rec = save.journey.objects[o.id];
  const envId = primaryEnvironment(o);
  const env = envId ? environment(envId) : null;
  const facts = factRows(o);
  const portrait = portraitFor(o);
  return (
    <div className="obj-card">
      <div className="card-top">
        <Portrait object={o} />
        <div className="card-id">
          <div className="badge real">REAL OBJECT</div>
          <div className="card-name">{o.name}</div>
          {o.designation !== o.name && <div className="card-des">{o.designation}</div>}
          <div className="card-class">{o.classification.toUpperCase()}</div>
        </div>
      </div>
      <p className="card-desc">{describeObject(o)}</p>
      {facts.length > 0 && (
        <div className="facts">
          {facts.map((f) => (
            <div className="fact" key={f.k}>
              <span className="k">{f.k}</span>
              <span className="dots" />
              <span className="v">{f.v}</span>
            </div>
          ))}
        </div>
      )}
      {facts.length === 0 && <div className="card-note">NO PHYSICAL MEASUREMENTS ON FILE FOR THIS OBJECT.</div>}
      <div className="card-meta">
        <div>
          <span className="label">SOURCE</span> {sourceLine(o)}
        </div>
        {env && (
          <div>
            <span className="label">IN GAME</span> {env.label} — a gameplay interpretation of this object, not a measurement.
          </div>
        )}
        <div>
          <span className="label">VISUAL</span>{' '}
          {portrait.source === 'image' && o.visualProperties.imageSource
            ? `Pixel rendering of ${o.visualProperties.imageSource}. Credit: ${o.visualProperties.imageAttribution}.`
            : 'Procedural rendering from catalogue data (no verified image of this object on file).'}
        </div>
        {rec && (
          <div>
            <span className="label">LOGGED</span> Sector {String(rec.sector).padStart(3, '0')}
            {rec.at ? ` · ${rec.at.slice(0, 10)}` : ''}
            {rec.visits > 1 ? ` · ${rec.visits} visits` : ''}
            {rec.orbit ? ` · ${rec.orbit}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
