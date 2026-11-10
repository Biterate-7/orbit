import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SfxName, UpgradeId, UpgradeOffer } from '../game/types';
import { useKeys } from './hooks';
import { PixelIcon } from './PixelIcon';

interface Props {
  options: UpgradeOffer[];
  onChoose: (id: UpgradeId) => void;
  sfx: (n: SfxName) => void;
}

export function UpgradePicker({ options, onChoose, sfx }: Props) {
  const [focus, setFocus] = useState(0);
  const [chosen, setChosen] = useState<UpgradeId | null>(null);
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const n = options.length;

  useEffect(() => {
    // Ignore keys for a moment so a held/pressed key from gameplay doesn't instantly pick.
    const t = window.setTimeout(() => setArmed(true), 350);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(timer.current);
    };
  }, []);

  const choose = (i: number): void => {
    if (chosen) return;
    const o = options[i];
    if (!o) return;
    setFocus(i);
    setChosen(o.id);
    sfx('click');
    timer.current = window.setTimeout(() => onChoose(o.id), 420);
  };

  const move = (d: number) => {
    setFocus((f) => (f + d + n) % n);
    sfx('hover');
  };

  useKeys(
    {
      Digit1: () => choose(0),
      Digit2: () => choose(1),
      Digit3: () => choose(2),
      Numpad1: () => choose(0),
      Numpad2: () => choose(1),
      Numpad3: () => choose(2),
      ArrowLeft: () => move(-1),
      ArrowUp: () => move(-1),
      KeyA: () => move(-1),
      KeyW: () => move(-1),
      ArrowRight: () => move(1),
      ArrowDown: () => move(1),
      KeyD: () => move(1),
      KeyS: () => move(1),
      Enter: () => choose(focus),
      Space: () => choose(focus),
    },
    armed && !chosen,
  );

  return (
    <div className="overlay dim">
      <div className="picker" role="dialog" aria-label="Choose an upgrade">
        <div className="picker-head">
          <div className="label">ENERGY MILESTONE REACHED</div>
          <h2>SELECT MODULE</h2>
        </div>
        <div className="cards">
          {options.map((o, i) => {
            const state = chosen ? (chosen === o.id ? ' chosen' : ' dropped') : focus === i ? ' focus' : '';
            return (
              <button
                key={o.id}
                className={`card${state}`}
                style={{ '--accent': o.color } as CSSProperties}
                onMouseEnter={() => {
                  if (!chosen && focus !== i) {
                    setFocus(i);
                    sfx('hover');
                  }
                }}
                onClick={() => choose(i)}
              >
                <div className="icon-wrap">
                  <PixelIcon name={o.id} color={o.color} size={36} />
                </div>
                <div className="text">
                  <div className="name">{o.name}</div>
                  <div className="desc">{o.description}</div>
                </div>
                <div className="detail">{o.detail}</div>
                <div className="foot">
                  <span className={`lvl${o.stack === 0 ? ' new' : ''}`}>
                    {o.stack === 0 ? 'NEW MODULE' : o.max >= 99 ? `INSTALLED x${o.stack}` : `LV ${o.stack} > ${o.stack + 1}`}
                  </span>
                  <span className="key">{i + 1}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
