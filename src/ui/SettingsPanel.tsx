import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Settings } from '../game/persistence';
import type { SfxName } from '../game/types';
import { useArrowNav, useKeys } from './hooks';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onBack: () => void;
  onReset?: () => void;
  sfx: (n: SfxName) => void;
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`toggle nav${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on} aria-label={label}>
      {on ? 'ON' : 'OFF'}
    </button>
  );
}

export function SettingsPanel({ settings: s, onChange, onBack, onReset, sfx }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useArrowNav(ref, true);
  useKeys({ Escape: onBack });

  const toggle = (key: keyof Settings) => () => {
    onChange({ [key]: !s[key] } as Partial<Settings>);
    sfx('click');
  };
  const pct = (v: number, lo: number, hi: number) => ({ '--fill': `${((v - lo) / (hi - lo)) * 100}%` }) as CSSProperties;

  return (
    <div className="overlay dim">
      <div className="panel settings" ref={ref} role="dialog" aria-label="Settings">
        <h2 className="panel-title">SETTINGS</h2>
        <p className="panel-sub">Saved automatically on this device.</p>

        <div className="set-row">
          <div>
            <div className="name">MASTER VOLUME</div>
          </div>
          <div className="slider">
            <input
              className="nav"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.masterVolume}
              style={pct(s.masterVolume, 0, 1)}
              onChange={(e) => onChange({ masterVolume: Number(e.target.value) })}
              onPointerUp={() => sfx('energy')}
              aria-label="Master volume"
            />
            <span className="val">{Math.round(s.masterVolume * 100)}</span>
          </div>
        </div>

        <div className="set-row">
          <div>
            <div className="name">MUTE ALL AUDIO</div>
          </div>
          <Toggle on={s.muted} onClick={toggle('muted')} label="Mute" />
        </div>

        <div className="set-row">
          <div>
            <div className="name">SOUND EFFECTS</div>
          </div>
          <Toggle on={s.sfx} onClick={toggle('sfx')} label="Sound effects" />
        </div>

        <div className="set-row">
          <div>
            <div className="name">AMBIENT DRONE</div>
            <div className="desc">Low background hum for each environment.</div>
          </div>
          <Toggle on={s.ambience} onClick={toggle('ambience')} label="Ambient drone" />
        </div>

        <div className="set-row">
          <div>
            <div className="name">SCREEN SHAKE</div>
          </div>
          <Toggle on={s.screenShake} onClick={toggle('screenShake')} label="Screen shake" />
        </div>

        <div className="set-row">
          <div>
            <div className="name">REDUCED EFFECTS</div>
            <div className="desc">Fewer particles, no scanlines or vignette.</div>
          </div>
          <Toggle on={s.reducedEffects} onClick={toggle('reducedEffects')} label="Reduced effects" />
        </div>

        <div className="set-row">
          <div>
            <div className="name">CONTROL SENSITIVITY</div>
            <div className="desc">Engine thrust per key press.</div>
          </div>
          <div className="slider">
            <input
              className="nav"
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={s.sensitivity}
              style={pct(s.sensitivity, 0.5, 1.5)}
              onChange={(e) => onChange({ sensitivity: Number(e.target.value) })}
              aria-label="Control sensitivity"
            />
            <span className="val">x{s.sensitivity.toFixed(2)}</span>
          </div>
        </div>

        <div className="set-row">
          <div>
            <div className="name">AUTO-PAUSE</div>
            <div className="desc">Pause when the window loses focus. ESC / P pauses and resumes.</div>
          </div>
          <Toggle on={s.autoPause} onClick={toggle('autoPause')} label="Auto pause" />
        </div>

        <div className="set-row">
          <div>
            <div className="name">TOUCH CONTROLS</div>
          </div>
          <div className="seg" role="radiogroup" aria-label="Touch controls">
            {(['auto', 'on', 'off'] as const).map((v) => (
              <button
                key={v}
                className={`toggle nav${s.touchControls === v ? ' on' : ''}`}
                onClick={() => {
                  onChange({ touchControls: v });
                  sfx('click');
                }}
                role="radio"
                aria-checked={s.touchControls === v}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {onReset && (
          <div className="danger-zone">
            {confirmReset ? (
              <>
                <span className="label" style={{ color: 'var(--red)' }}>
                  ERASE RECORDS, CREDITS AND UPGRADES?
                </span>
                <button
                  className="btn small danger nav"
                  onClick={() => {
                    onReset();
                    setConfirmReset(false);
                    sfx('explode');
                  }}
                >
                  ERASE
                </button>
                <button className="btn small nav" onClick={() => setConfirmReset(false)}>
                  CANCEL
                </button>
              </>
            ) : (
              <button className="btn small danger nav" onClick={() => setConfirmReset(true)}>
                RESET PROGRESS
              </button>
            )}
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
