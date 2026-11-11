import { useEffect, useRef, useState } from 'react';
import type { LevelDef, SfxName } from '../game/types';
import { useArrowNav, useKeys } from './hooks';

interface Props {
  level: number;
  levelName: string;
  /** The sector being played: shown as a short scan read-out. */
  scan?: LevelDef;
  muted: boolean;
  onResume: () => void;
  onRestart: () => void;
  onSettings: () => void;
  onHowTo: () => void;
  onMenu: () => void;
  onToggleMute: () => void;
  sfx: (n: SfxName) => void;
}

export function PauseMenu(p: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<null | 'restart' | 'menu'>(null);
  const [armed, setArmed] = useState(false);
  useArrowNav(ref, true, [confirm]);

  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 150);
    return () => window.clearTimeout(t);
  }, []);

  useKeys(
    {
      Escape: () => (confirm ? setConfirm(null) : p.onResume()),
      KeyP: () => p.onResume(),
    },
    armed,
  );

  const click = (fn: () => void) => () => {
    p.sfx('click');
    fn();
  };
  const hover = () => p.sfx('hover');

  return (
    <div className="overlay dim">
      <div className="panel pause-panel" ref={ref} role="dialog" aria-label="Paused">
        <h2 className="panel-title">PAUSED</h2>
        <p className="panel-sub">
          SECTOR {String(p.level).padStart(2, '0')} · {p.levelName}
        </p>
        {p.scan && !confirm && (
          <div className="scan">
            <div>
              <span className="label">SCAN</span> {p.scan.identity.objectName} · {p.scan.identity.objectClass.toUpperCase()}
            </div>
            <div>
              <span className="label">TYPE</span> {p.scan.identity.kind}
              {p.scan.identity.source ? ` · ${p.scan.identity.source}` : ''}
            </div>
            <div>
              <span className="label">ORBIT</span> {p.scan.identity.orbitLabel}
            </div>
            <p>{p.scan.identity.description}</p>
            <div className="scan-code">SECTOR CODE {p.scan.code}</div>
          </div>
        )}
        {confirm ? (
          <div className="menu-list">
            <p className="panel-sub" style={{ marginBottom: 8 }}>
              {confirm === 'restart' ? 'ABANDON THIS RUN AND START OVER?' : 'ABANDON THIS RUN? PROGRESS IS NOT SAVED.'}
            </p>
            <button className="btn nav danger" onClick={click(confirm === 'restart' ? p.onRestart : p.onMenu)} onMouseEnter={hover}>
              YES, {confirm === 'restart' ? 'RESTART' : 'QUIT'}
            </button>
            <button className="btn nav" onClick={click(() => setConfirm(null))} onMouseEnter={hover}>
              CANCEL
            </button>
          </div>
        ) : (
          <div className="menu-list">
            <button className="btn nav" onClick={click(p.onResume)} onMouseEnter={hover}>
              RESUME
            </button>
            <button className="btn nav" onClick={click(() => setConfirm('restart'))} onMouseEnter={hover}>
              RESTART RUN
            </button>
            <button className="btn nav" onClick={click(p.onSettings)} onMouseEnter={hover}>
              SETTINGS
            </button>
            <button className="btn nav" onClick={click(p.onHowTo)} onMouseEnter={hover}>
              HOW TO PLAY
            </button>
            <button className="btn nav" onClick={click(p.onToggleMute)} onMouseEnter={hover}>
              SOUND: {p.muted ? 'MUTED' : 'ON'}
            </button>
            <button className="btn nav" onClick={click(() => setConfirm('menu'))} onMouseEnter={hover}>
              MAIN MENU
            </button>
          </div>
        )}
        <div className="hint-line">ESC / P TO RESUME</div>
      </div>
    </div>
  );
}
