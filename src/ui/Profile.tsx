import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { RARITY_COLOR, cosmetic, resolveLook } from '../game/cosmetics/catalog';
import { formatTime, padScore } from '../game/math';
import { BOSSES, MISSIONS, MISSION_ORDER } from '../game/missions/catalog';
import { MODULES, MODULE_IDS, SYNERGIES } from '../game/modules';
import type { SaveData } from '../game/persistence';
import type { SfxName } from '../game/types';
import { ACHIEVEMENTS, CATEGORY_LABEL, CATEGORY_ORDER, achievementContext, achievementCosmetics, achievementSummary } from '../progression/achievements';
import type { AchievementDef, BadgeTier } from '../progression/achievements';
import { levelProgress, rankTitle } from '../progression/level';
import type { Progression } from '../progression/service';
import { deriveStats } from '../progression/stats';
import { useKeys } from './hooks';
import { PixelIcon } from './PixelIcon';
import { ShipPreview } from './ShipPreview';

interface Props {
  save: SaveData;
  progress: Progression;
  onBack: () => void;
  sfx: (n: SfxName) => void;
}

type Tab = 'overview' | 'stats' | 'achievements' | 'records';
type Show = 'all' | 'unlocked' | 'locked';

const TIER_COLOR: Record<BadgeTier, string> = { bronze: '#c8875a', silver: '#c9d3ea', gold: '#ffc94d', prismatic: '#ff7ad8' };

const big = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : Math.round(n).toLocaleString('en-US'));

function playtime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`;
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="fact">
      <span className="k">{k}</span>
      <span className="dots" />
      <span className="v">{v}</span>
    </div>
  );
}

function Bars({ rows, empty }: { rows: { label: string; value: number; color: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div className="cat-empty">{empty}</div>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label} style={{ '--accent': r.color } as CSSProperties}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <i style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="bar-val">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** The pilot's record: who they are, everything they have done, and what is still to do. */
export function Profile({ save, progress, onBack, sfx }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [show, setShow] = useState<Show>('all');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(save.profile.name);
  useKeys({ Escape: onBack }, !editing);

  const d = useMemo(() => deriveStats(save), [save]);
  const ctx = useMemo(() => achievementContext(save), [save]);
  const lv = levelProgress(save.profile.xp);
  const s = save.stats;
  const ach = achievementSummary(save);
  const favourite = cosmetic(d.favouriteShip);
  const favLook = useMemo(() => resolveLook({ ...save.inventory.equipped, hull: d.favouriteShip }), [save.inventory.equipped, d.favouriteShip]);
  const recent = ACHIEVEMENTS.filter((a) => save.achievements[a.id]).sort((a, b) => (save.achievements[b.id] ?? '').localeCompare(save.achievements[a.id] ?? '')).slice(0, 4);
  const success = s.missionsAttempted > 0 ? Math.round((s.missionsCompleted / s.missionsAttempted) * 100) : 0;

  const rename = (): void => {
    const out = progress.dispatch({ type: 'rename', name });
    sfx(out.ok ? 'click' : 'warning');
    setEditing(false);
    if (!out.ok) setName(save.profile.name);
  };

  const card = (a: AchievementDef) => {
    const at = save.achievements[a.id];
    const done = at !== undefined;
    const [cur, target] = a.progress(ctx);
    const secret = a.hidden && !done;
    const gifts = achievementCosmetics(a.id).map((id) => cosmetic(id)).filter((c) => !!c);
    return (
      <div key={a.id} className={`ach${done ? ' done' : ''}${secret ? ' secret' : ''}`} style={{ '--tier': TIER_COLOR[a.tier] } as CSSProperties}>
        <div className="ach-badge" aria-hidden="true">
          <PixelIcon name={secret ? 'lock' : a.icon} color={done ? TIER_COLOR[a.tier] : '#3a4672'} size={27} />
        </div>
        <div className="ach-main">
          <div className="ach-top">
            <span className="ach-title">{secret ? 'HIDDEN ACHIEVEMENT' : a.title}</span>
            <span className="ach-reward">{done ? (at ? at.slice(0, 10) : 'COMPLETE') : `+${a.reward} CR`}</span>
          </div>
          <div className="ach-desc">{secret ? 'Keep flying. You will know it when it happens.' : a.description}</div>
          {gifts.length > 0 && !secret && (
            <div className="ach-gift">
              {gifts.map((g) => (
                <span key={g!.id} style={{ color: RARITY_COLOR[g!.rarity] }}>
                  + {g!.name}
                </span>
              ))}
            </div>
          )}
          {!done && !secret && (
            <div className="ach-prog">
              <span className="mile-bar">
                <i style={{ width: `${Math.min(100, (cur / target) * 100)}%` }} />
              </span>
              <span className="ach-num">
                {big(Math.min(cur, target))} / {big(target)}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="overlay dim">
      <div className="panel profile" role="dialog" aria-label="Pilot profile">
        <div className="x-head">
          <div className="pilot-id">
            <div className="pilot-badge">
              <PixelIcon name="pilot" color="#3ef2ff" size={45} />
              <span className="pilot-level">{lv.level}</span>
            </div>
            <div>
              {editing ? (
                <form
                  className="rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename();
                  }}
                >
                  <input className="x-input" value={name} maxLength={16} autoFocus onChange={(e) => setName(e.target.value)} aria-label="Pilot name" spellCheck={false} />
                  <button className="btn small outline" type="submit">
                    SAVE
                  </button>
                </form>
              ) : (
                <h2 className="panel-title">
                  {save.profile.name}
                  <button className="btn small rename-btn" onClick={() => setEditing(true)} aria-label="Rename pilot">
                    RENAME
                  </button>
                </h2>
              )}
              <p className="panel-sub">
                {rankTitle(lv.level)} · LEVEL {lv.level}
                {save.profile.createdAt ? ` · FLYING SINCE ${save.profile.createdAt.slice(0, 10)}` : ''}
              </p>
              <div className="xp">
                <span className="mile-bar">
                  <i style={{ width: `${lv.fraction * 100}%` }} />
                </span>
                <span className="label">
                  {lv.into} / {lv.need} XP TO LEVEL {lv.level + 1}
                </span>
              </div>
            </div>
          </div>
          <div className="credits">
            <div className="label">CREDITS</div>
            <div className="value">{save.credits} CR</div>
          </div>
        </div>

        <div className="cat-tabs">
          {(['overview', 'stats', 'achievements', 'records'] as Tab[]).map((t) => (
            <button key={t} className={`cat-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
              {t === 'stats' ? 'STATISTICS' : t.toUpperCase()}
              {t === 'achievements' && <span className="n">{ach.unlocked}/{ach.total}</span>}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="prof-overview">
            <div className="prof-ship">
              <div className="label">FAVOURITE SHIP</div>
              <ShipPreview look={favLook} width={88} height={56} scale={3.5} reduced={save.settings.reducedEffects} label="Favourite ship" />
              <div className="prof-ship-name" style={{ color: RARITY_COLOR[favourite?.rarity ?? 'common'] }}>
                {favourite?.name ?? 'SURVEY WHITE'}
              </div>
              <div className="label">{s.hullUse[d.favouriteShip] ? `${s.hullUse[d.favouriteShip]} SECTORS FLOWN IN IT` : 'NOT FLOWN YET'}</div>
            </div>
            <div className="prof-tiles">
              {[
                ['MISSIONS COMPLETED', s.missionsCompleted],
                ['MAJOR ENCOUNTERS WON', s.bossesDefeated],
                ['SYSTEMS DISCOVERED', d.systemsDiscovered],
                ['OBJECTS CATALOGUED', d.objectsDiscovered],
                ['WORLDS ENCOUNTERED', d.planetsEncountered],
                ['HIGHEST SECTOR', d.highestLevel],
                ['ITEMS COLLECTED', `${d.cosmeticsCollected}/${d.cosmeticsTotal}`],
                ['ACHIEVEMENTS', `${ach.unlocked}/${ach.total}`],
              ].map(([k, v]) => (
                <div className="stat" key={k}>
                  <div className="label">{k}</div>
                  <div className="value">{v}</div>
                </div>
              ))}
            </div>
            <div className="prof-recent">
              <div className="label">LATEST ACHIEVEMENTS</div>
              {recent.length === 0 ? <div className="cat-empty">NONE YET. THE FIRST ONES COME QUICKLY.</div> : recent.map(card)}
              <div className="label" style={{ marginTop: 12 }}>
                RARE DISCOVERIES
              </div>
              <div className="rare-line">
                <b>{s.rareDiscoveries}</b> RARE DISCOVERIES · <b>{s.signalsFound}</b> UNLISTED SOURCES LOCATED · <b>{s.cachesFound}</b> HIDDEN CACHES · <b>{save.journey.rareEncounters}</b> RARE ENCOUNTERS FLOWN
              </div>
            </div>
          </div>
        )}

        {tab === 'stats' && (
          <div className="prof-stats">
            <section>
              <h3>FLIGHT</h3>
              <Row k="MISSIONS COMPLETED" v={s.missionsCompleted} />
              <Row k="MISSIONS ATTEMPTED" v={s.missionsAttempted} />
              <Row k="SUCCESS RATE" v={s.missionsAttempted > 0 ? `${success}%` : '—'} />
              <Row k="MAJOR ENCOUNTERS DEFEATED" v={s.bossesDefeated} />
              <Row k="S RANKS" v={s.sRanks} />
              <Row k="FLAWLESS MISSIONS" v={s.flawless} />
              <Row k="TOTAL DISTANCE TRAVELLED" v={`${big(s.distance)} UNITS`} />
              <Row k="TOTAL PLAYTIME" v={playtime(d.playtime)} />
              <Row k="RUNS" v={d.totalRuns} />
              <Row k="SECTORS CLEARED" v={d.sectorsCleared} />
              <Row k="HIGHEST SECTOR REACHED" v={d.highestLevel} />
              <Row k="LONGEST SURVIVAL" v={formatTime(d.longestSurvival)} />
            </section>
            <section>
              <h3>EXPLORATION</h3>
              <Row k="STAR SYSTEMS DISCOVERED" v={d.systemsDiscovered} />
              <Row k="OBJECTS CATALOGUED" v={d.objectsDiscovered} />
              <Row k="PLANETS AND MOONS ENCOUNTERED" v={d.planetsEncountered} />
              <Row k="ENVIRONMENTS SEEN" v={d.environmentsSeen} />
              <Row k="RARE DISCOVERIES" v={s.rareDiscoveries} />
              <Row k="UNLISTED SOURCES LOCATED" v={s.signalsFound} />
              <Row k="HIDDEN CACHES RECOVERED" v={s.cachesFound} />
              <Row k="ASTEROIDS MINED" v={s.asteroidsCollected} />
              <Row k="SHARDS RECOVERED" v={d.shards} />
              <Row k="WORMHOLE TRANSITS" v={s.wormholeTransits} />
              <Row k="GRAVITY ASSISTS" v={s.gravityAssists} />
              <Row k="RECORDS IMPORTED LIVE" v={s.liveImports} />
            </section>
            <section>
              <h3>ECONOMY AND COLLECTION</h3>
              <Row k="CREDITS EARNED" v={big(s.creditsEarned)} />
              <Row k="CREDITS SPENT" v={big(s.creditsSpent)} />
              <Row k="BEST SINGLE RUN" v={`${s.bestRunCredits} CR`} />
              <Row k="CASES OPENED" v={s.casesOpened} />
              <Row k="DUPLICATES CONVERTED" v={s.duplicatesConverted} />
              <Row k="COSMETICS COLLECTED" v={`${d.cosmeticsCollected} / ${d.cosmeticsTotal}`} />
              <Row k="SHIPS OWNED" v={d.shipsOwned} />
              <Row k="MODULES OWNED" v={`${MODULE_IDS.filter((m) => save.modules.levels[m] > 0).length} / ${MODULE_IDS.length}`} />
              <Row k="SYNERGIES DISCOVERED" v={`${save.modules.synergies.length} / ${SYNERGIES.length}`} />
              <Row k="ACHIEVEMENTS UNLOCKED" v={`${ach.unlocked} / ${ach.total}`} />
              <Row k="FAVOURITE SHIP" v={favourite?.name ?? '—'} />
            </section>
            <section>
              <h3>MOST-PLAYED MISSIONS</h3>
              <Bars rows={d.mostPlayedMissions.slice(0, 8).map((m) => ({ label: MISSIONS[m.kind].title, value: m.sectors, color: MISSIONS[m.kind].color }))} empty="NO MISSIONS FLOWN YET" />
            </section>
            <section>
              <h3>MOST-USED MODULES</h3>
              <Bars rows={d.mostUsedModules.map((m) => ({ label: MODULES[m.id].name, value: m.sectors, color: MODULES[m.id].color }))} empty="NO MODULES FLOWN YET" />
            </section>
          </div>
        )}

        {tab === 'achievements' && (
          <div className="prof-ach">
            <div className="chips">
              {(['all', 'unlocked', 'locked'] as Show[]).map((v) => (
                <button key={v} className={`chip${show === v ? ' on' : ''}`} onClick={() => setShow(v)}>
                  {v.toUpperCase()}
                </button>
              ))}
              <span className="label ach-sum">
                {ach.unlocked}/{ach.total} UNLOCKED · {ach.credits} CR EARNED FROM ACHIEVEMENTS
              </span>
            </div>
            {CATEGORY_ORDER.map((cat) => {
              const list = ACHIEVEMENTS.filter((a) => a.category === cat && (show === 'all' || (show === 'unlocked') === (a.id in save.achievements)));
              if (list.length === 0) return null;
              const got = ACHIEVEMENTS.filter((a) => a.category === cat && a.id in save.achievements).length;
              return (
                <section key={cat}>
                  <h3>
                    {CATEGORY_LABEL[cat]}
                    <span className="n">
                      {got}/{ACHIEVEMENTS.filter((a) => a.category === cat).length}
                    </span>
                  </h3>
                  <div className="ach-grid">{list.map(card)}</div>
                </section>
              );
            })}
          </div>
        )}

        {tab === 'records' && (
          <div className="prof-stats">
            <section>
              <h3>PERSONAL RECORDS</h3>
              <Row k="BEST SCORE" v={padScore(save.records.bestScore, 6)} />
              <Row k="HIGHEST SECTOR" v={d.highestLevel} />
              <Row k="LONGEST SURVIVAL" v={formatTime(d.longestSurvival)} />
              <Row k="MOST SECTORS IN ONE RUN" v={s.bestRunSectors} />
              <Row k="MOST CREDITS IN ONE RUN" v={`${s.bestRunCredits} CR`} />
              <Row k="MOST NEAR MISSES IN ONE RUN" v={s.bestNearMisses} />
              <Row k="ELITE SECTORS CLEARED" v={s.eliteCleared} />
            </section>
            <section className="wide">
              <h3>MAJOR ENCOUNTERS</h3>
              <table className="rec-table">
                <thead>
                  <tr>
                    <th>ENCOUNTER</th>
                    <th>DEFEATS</th>
                    <th>BEST RANK</th>
                    <th>FASTEST</th>
                    <th>HIGHEST MK</th>
                    <th>FLAWLESS</th>
                  </tr>
                </thead>
                <tbody>
                  {BOSSES.map((k) => {
                    const b = s.bossRecords[k];
                    return (
                      <tr key={k} className={b ? '' : 'none'} style={{ '--accent': MISSIONS[k].color } as CSSProperties}>
                        <th>{b || save.bosses.includes(k) ? MISSIONS[k].title : '? ? ?'}</th>
                        <td>{b?.defeats ?? 0}</td>
                        <td>{b && b.bestRank !== '-' ? b.bestRank : '—'}</td>
                        <td>{b && b.bestTime > 0 ? formatTime(b.bestTime) : '—'}</td>
                        <td>{b && b.highestTier > 0 ? ['I', 'II', 'III', 'IV', 'V'][Math.min(4, b.highestTier - 1)] : '—'}</td>
                        <td>{b?.flawless ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
            <section className="wide">
              <h3>MISSION RECORDS</h3>
              <table className="rec-table">
                <thead>
                  <tr>
                    <th>MISSION</th>
                    <th>FLOWN</th>
                    <th>COMPLETED</th>
                    <th>BEST RANK</th>
                    <th>CHALLENGE</th>
                  </tr>
                </thead>
                <tbody>
                  {MISSION_ORDER.filter((k) => !MISSIONS[k].boss).map((k) => {
                    const rec = save.missions[k];
                    const flown = s.missionPlays[k] ?? 0;
                    return (
                      <tr key={k} className={flown > 0 || rec ? '' : 'none'} style={{ '--accent': MISSIONS[k].color } as CSSProperties}>
                        <th>{flown > 0 || rec ? MISSIONS[k].title : '? ? ?'}</th>
                        <td>{flown}</td>
                        <td>{rec?.completed ?? 0}</td>
                        <td>{rec && rec.best !== '-' ? rec.best : '—'}</td>
                        <td>{s.feats[k] ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </div>
        )}

        <div className="back-row">
          <button
            className="btn outline nav"
            onClick={() => {
              sfx('click');
              onBack();
            }}
          >
            BACK
          </button>
        </div>
      </div>
    </div>
  );
}
