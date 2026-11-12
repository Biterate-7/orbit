import { useRef } from 'react';
import type { CSSProperties } from 'react';
import { RUN_MODIFIERS, scoreMultiplier } from '../game/modifiers';
import type { SaveData, SaveStore } from '../game/persistence';
import type { RunModifierId, SfxName } from '../game/types';
import { useArrowNav, useKeys } from './hooks';

interface Props {
  save: SaveData;
  store: SaveStore;
  onBack: () => void;
  sfx: (n: SfxName) => void;
}

/** Optional rules for the next run, each with its score multiplier. */
export function RunModifiers({ save, store, onBack, sfx }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useArrowNav(ref, true);
  useKeys({ Escape: onBack });
  const active = new Set(save.runModifiers);
  const toggle = (id: RunModifierId) => {
    sfx('click');
    store.update((d) => {
      const on = new Set(d.runModifiers);
      if (on.has(id)) on.delete(id);
      else on.add(id);
      d.runModifiers = RUN_MODIFIERS.map((m) => m.id).filter((m) => on.has(m));
    });
  };
  const mult = scoreMultiplier(save.runModifiers);

  return (
    <div className="overlay dim">
      <div className="panel modifiers" ref={ref} role="dialog" aria-label="Run modifiers">
        <div className="hangar-head">
          <div>
            <h2 className="panel-title">RUN MODIFIERS</h2>
            <p className="panel-sub">Change the rules of your next run. Harder rules multiply your score.</p>
          </div>
          <div className="credits">
            <div className="label">SCORE</div>
            <div className={`value${mult > 1 ? ' up' : mult < 1 ? ' down' : ''}`}>x{mult.toFixed(2)}</div>
          </div>
        </div>
        <div className="modifier-list">
          {RUN_MODIFIERS.map((m) => (
            <button
              key={m.id}
              className={`modifier nav${active.has(m.id) ? ' on' : ''}`}
              style={{ '--accent': m.color } as CSSProperties}
              onClick={() => toggle(m.id)}
              onMouseEnter={() => sfx('hover')}
              aria-pressed={active.has(m.id)}
            >
              <span className="check">{active.has(m.id) ? '■' : '□'}</span>
              <span className="name">{m.name}</span>
              <span className="desc">{m.description}</span>
              <span className="mul">x{m.scoreMul.toFixed(2)}</span>
            </button>
          ))}
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
