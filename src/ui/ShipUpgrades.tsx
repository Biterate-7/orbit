import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SaveData, SaveStore } from '../game/persistence';
import type { PermanentId, SfxName } from '../game/types';
import { PERMANENTS, PERMANENT_COSTS, PERMANENT_MAX, UPGRADES, UPGRADE_ORDER, partUnlocked } from '../game/upgrades';
import { useArrowNav, useKeys } from './hooks';
import { PixelIcon } from './PixelIcon';

interface Props {
  save: SaveData;
  store: SaveStore;
  onBack: () => void;
  sfx: (n: SfxName) => void;
}

export function ShipUpgrades({ save, store, onBack, sfx }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<PermanentId | null>(null);
  useArrowNav(ref, true);
  useKeys({ Escape: onBack });

  const buy = (id: PermanentId) => {
    const lvl = save.permanent[id];
    if (lvl >= PERMANENT_MAX) return;
    const def = PERMANENTS.find((x) => x.id === id);
    if (def && !partUnlocked(def, { shards: save.records.shards, bosses: save.bosses })) return;
    const cost = PERMANENT_COSTS[lvl];
    if (save.credits < cost) return;
    store.update((d) => {
      d.credits -= cost;
      d.permanent[id] = lvl + 1;
    });
    sfx('upgrade');
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 520);
  };

  const unlocked = new Set(save.unlocked);
  const progress = { shards: save.records.shards, bosses: save.bosses };

  return (
    <div className="overlay dim">
      <div className="panel hangar" ref={ref} role="dialog" aria-label="Ship upgrades">
        <div className="hangar-head">
          <div>
            <h2 className="panel-title">SHIP UPGRADES</h2>
            <p className="panel-sub">Permanent improvements, paid for with credits earned each run.</p>
          </div>
          <div className="credits">
            <div className="label">CREDITS</div>
            <div className="value">{save.credits} CR</div>
          </div>
        </div>

        <div className="perm-list">
          {PERMANENTS.map((p) => {
            const lvl = save.permanent[p.id];
            const open = partUnlocked(p, progress);
            const maxed = lvl >= PERMANENT_MAX;
            const cost = maxed ? 0 : PERMANENT_COSTS[lvl];
            const afford = open && !maxed && save.credits >= cost;
            return (
              <div
                key={p.id}
                className={`perm${flash === p.id ? ' flash' : ''}${open ? '' : ' locked'}`}
                style={{ '--accent': p.color } as CSSProperties}
              >
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
                <button
                  className={`btn outline buy nav`}
                  disabled={!afford}
                  onClick={() => buy(p.id)}
                  onMouseEnter={() => afford && sfx('hover')}
                >
                  {!open ? 'LOCKED' : maxed ? 'MAXED' : <span className="cost">{cost} CR</span>}
                </button>
              </div>
            );
          })}
        </div>

        <div className="label" style={{ marginBottom: 10 }}>
          MODULE DATABASE · IN-RUN UPGRADES
        </div>
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
