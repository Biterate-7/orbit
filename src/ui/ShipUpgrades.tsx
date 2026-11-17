import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { MODULES, MODULE_BAYS, MODULE_COSTS, MODULE_IDS, MODULE_MAX, SYNERGIES, THIRD_BAY_LEVEL, activeSynergies, baysOpen, moduleUnlocked } from '../game/modules';
import type { ModuleId } from '../game/modules';
import type { SaveData } from '../game/persistence';
import type { PermanentId, SfxName } from '../game/types';
import { PERMANENTS, PERMANENT_COSTS, PERMANENT_MAX, UPGRADES, UPGRADE_ORDER, partUnlocked } from '../game/upgrades';
import { moduleProgress } from '../progression/events';
import { levelFor } from '../progression/level';
import type { Progression } from '../progression/service';
import { useArrowNav, useKeys } from './hooks';
import { PixelIcon } from './PixelIcon';

interface Props {
  save: SaveData;
  progress: Progression;
  onBack: () => void;
  sfx: (n: SfxName) => void;
}

type Tab = 'modules' | 'parts' | 'inrun';

/**
 * Engineering: the three ways a ship gets better.
 *   MODULES   equippable systems that change how missions are flown; pairs can form synergies
 *   PARTS     permanent improvements bought with credits
 *   IN-RUN    the upgrades offered at energy milestones during a run
 */
export function ShipUpgrades({ save, progress, onBack, sfx }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('modules');
  const [flash, setFlash] = useState<string | null>(null);
  const [note, setNote] = useState('');
  useArrowNav(ref, true, [tab]);
  useKeys({ Escape: onBack });

  const pulse = (id: string): void => {
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 520);
  };

  const buyPart = (id: PermanentId): void => {
    const out = progress.dispatch({ type: 'buy_permanent', id });
    setNote(out.ok ? '' : out.reason);
    sfx(out.ok ? 'upgrade' : 'warning');
    if (out.ok) pulse(id);
  };

  const buyModule = (id: ModuleId): void => {
    const out = progress.dispatch({ type: 'buy_module', id });
    setNote(out.ok ? '' : out.reason);
    sfx(out.ok ? 'upgrade' : 'warning');
    if (out.ok) pulse(id);
  };

  const toggleModule = (id: ModuleId, on: boolean): void => {
    const out = progress.dispatch({ type: 'equip_module', id, on });
    setNote(out.ok ? '' : out.reason);
    sfx(out.ok ? 'click' : 'warning');
  };

  const unlocked = new Set(save.unlocked);
  const partsProgress = { shards: save.records.shards, bosses: save.bosses };
  const mp = moduleProgress(save);
  const pilotLevel = levelFor(save.profile.xp);
  const bays = baysOpen(pilotLevel);
  const fitted = save.modules.equipped;
  const active = new Set(activeSynergies(fitted));

  return (
    <div className="overlay dim">
      <div className="panel hangar engineering" ref={ref} role="dialog" aria-label="Engineering">
        <div className="hangar-head">
          <div>
            <h2 className="panel-title">ENGINEERING</h2>
            <p className="panel-sub">Modules change how you fly. Parts make the ship tougher. In-run upgrades are found along the way.</p>
          </div>
          <div className="credits">
            <div className="label">CREDITS</div>
            <div className="value">{save.credits} CR</div>
          </div>
        </div>

        <div className="cat-tabs">
          <button className={`cat-tab${tab === 'modules' ? ' on' : ''}`} onClick={() => setTab('modules')}>
            MODULES
          </button>
          <button className={`cat-tab${tab === 'parts' ? ' on' : ''}`} onClick={() => setTab('parts')}>
            SHIP PARTS
          </button>
          <button className={`cat-tab${tab === 'inrun' ? ' on' : ''}`} onClick={() => setTab('inrun')}>
            IN-RUN UPGRADES
          </button>
          <span className="shop-note" role="status">
            {note}
          </span>
        </div>

        {tab === 'modules' && (
          <>
            <div className="bays" aria-label="Module bays">
              {Array.from({ length: MODULE_BAYS }, (_, i) => {
                const id = fitted[i];
                const open = i < bays;
                const def = id ? MODULES[id] : null;
                return (
                  <div key={i} className={`mod-bay${def ? ' full' : ''}${open ? '' : ' closed'}`} style={{ '--accent': def?.color ?? '#2c3a78' } as CSSProperties}>
                    <span className="label">BAY {i + 1}</span>
                    {def ? (
                      <>
                        <PixelIcon name={def.icon} color={def.color} size={27} />
                        <span className="bay-name">{def.name}</span>
                      </>
                    ) : (
                      <span className="bay-name dim">{open ? 'EMPTY' : `OPENS AT PILOT LEVEL ${THIRD_BAY_LEVEL}`}</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="perm-list">
              {MODULE_IDS.map((id) => {
                const def = MODULES[id];
                const lvl = save.modules.levels[id];
                const open = moduleUnlocked(id, mp);
                const [have, need] = def.unlock.progress(mp);
                const maxed = lvl >= MODULE_MAX;
                const cost = maxed ? 0 : MODULE_COSTS[lvl];
                const afford = open && !maxed && save.credits >= cost;
                const isFitted = fitted.includes(id);
                return (
                  <div key={id} className={`perm module-row${flash === id ? ' flash' : ''}${open ? '' : ' locked'}${isFitted ? ' fitted' : ''}`} style={{ '--accent': def.color } as CSSProperties}>
                    <div className="icon-wrap">
                      <PixelIcon name={open ? def.icon : 'lock'} color={open ? def.color : '#2c3a78'} size={27} />
                    </div>
                    <div>
                      <div className="name">{def.name}</div>
                      <div className="desc">{open ? def.summary : `LOCKED · ${def.unlock.hint} (${Math.min(have, need)}/${need})`}</div>
                      {open && (
                        <div className="effect">
                          {lvl > 0 ? def.effect(lvl) : 'NOT INSTALLED'}
                          {!maxed && <span className="next">{'  >  '}{def.effect(lvl + 1)}</span>}
                        </div>
                      )}
                      {open && <div className="visual">{def.visual}</div>}
                      <div className="pips" aria-label={`Level ${lvl} of ${MODULE_MAX}`}>
                        {Array.from({ length: MODULE_MAX }, (_, i) => (
                          <span key={i} className={i < lvl ? 'on' : ''} />
                        ))}
                      </div>
                    </div>
                    <div className="mod-act">
                      {lvl > 0 && (
                        <button className="btn small outline nav" disabled={!isFitted && fitted.length >= bays} onClick={() => toggleModule(id, !isFitted)} aria-pressed={isFitted}>
                          {isFitted ? 'REMOVE' : fitted.length >= bays ? 'BAYS FULL' : 'FIT'}
                        </button>
                      )}
                      <button className="btn outline buy nav" disabled={!afford} onClick={() => buyModule(id)} onMouseEnter={() => afford && sfx('hover')}>
                        {!open ? 'LOCKED' : maxed ? 'MAXED' : <span className="cost">{cost} CR</span>}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="label" style={{ margin: '14px 0 10px' }}>
              SYNERGIES · FIT BOTH MODULES OF A PAIR TO DISCOVER ONE ({save.modules.synergies.length}/{SYNERGIES.length} FOUND)
            </div>
            <div className="synergies">
              {SYNERGIES.map((s) => {
                const found = save.modules.synergies.includes(s.id);
                const on = active.has(s.id);
                return (
                  <div key={s.id} className={`synergy${found ? ' found' : ''}${on ? ' on' : ''}`} style={{ '--accent': s.color } as CSSProperties}>
                    <div className="syn-top">
                      <span className="syn-name">{found ? s.name : '? ? ?'}</span>
                      <span className="syn-state">{on ? 'ACTIVE' : found ? 'DISCOVERED' : 'UNDISCOVERED'}</span>
                    </div>
                    <div className="syn-pair">
                      {/* One half of an undiscovered pair is shown, as a lead to follow. */}
                      {MODULES[s.pair[0]].name} + {found ? MODULES[s.pair[1]].name : '?'}
                    </div>
                    <div className="syn-desc">{found ? s.description : 'Fit this module together with the right partner to find out.'}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === 'parts' && (
          <div className="perm-list">
            {PERMANENTS.map((p) => {
              const lvl = save.permanent[p.id];
              const open = partUnlocked(p, partsProgress);
              const maxed = lvl >= PERMANENT_MAX;
              const cost = maxed ? 0 : PERMANENT_COSTS[lvl];
              const afford = open && !maxed && save.credits >= cost;
              return (
                <div key={p.id} className={`perm${flash === p.id ? ' flash' : ''}${open ? '' : ' locked'}`} style={{ '--accent': p.color } as CSSProperties}>
                  <div className="icon-wrap">
                    <PixelIcon name={open ? p.icon : 'lock'} color={open ? p.color : '#2c3a78'} size={27} />
                  </div>
                  <div>
                    <div className="name">{p.name}</div>
                    <div className="desc">{open ? p.description : `LOCKED · ${p.unlock?.hint}`}</div>
                    <div className="effect">
                      {p.effect(lvl)}
                      {!maxed && <span className="next">{'  >  '}{p.effect(lvl + 1)}</span>}
                    </div>
                    <div className="pips" aria-label={`Level ${lvl} of ${PERMANENT_MAX}`}>
                      {Array.from({ length: PERMANENT_MAX }, (_, i) => (
                        <span key={i} className={i < lvl ? 'on' : ''} />
                      ))}
                    </div>
                  </div>
                  <button className="btn outline buy nav" disabled={!afford} onClick={() => buyPart(p.id)} onMouseEnter={() => afford && sfx('hover')}>
                    {!open ? 'LOCKED' : maxed ? 'MAXED' : <span className="cost">{cost} CR</span>}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'inrun' && (
          <>
            <p className="panel-sub" style={{ marginBottom: 12 }}>
              Offered three at a time whenever enough energy has been collected during a run. They last until the run ends.
            </p>
            <div className="modules">
              {UPGRADE_ORDER.map((id) => {
                const u = UPGRADES[id];
                const isUnlocked = unlocked.has(id);
                return (
                  <div key={id} className={`module${isUnlocked ? '' : ' locked'}`} title={u.summary}>
                    <PixelIcon name={isUnlocked ? id : 'lock'} color={isUnlocked ? u.color : '#2c3a78'} size={27} />
                    <div className="mname">{u.name}</div>
                    <div className="mhint">{isUnlocked ? u.summary : u.unlock?.hint}</div>
                  </div>
                );
              })}
            </div>
          </>
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
