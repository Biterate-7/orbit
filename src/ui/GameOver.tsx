import { useEffect, useRef, useState } from 'react';
import { formatTime, padScore } from '../game/math';
import type { RunSummary, SfxName } from '../game/types';
import { UPGRADES } from '../game/upgrades';
import { useArrowNav, useKeys } from './hooks';

interface Props {
  summary: RunSummary;
  onRetry: () => void;
  onMenu: () => void;
  sfx: (n: SfxName) => void;
}

function useCountUp(target: number, ms: number): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setV(Math.floor(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function GameOver({ summary, onRetry, onMenu, sfx }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  useArrowNav(ref, true);
  const score = useCountUp(summary.score, 900);

  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 500);
    return () => window.clearTimeout(t);
  }, []);

  useKeys(
    {
      KeyR: onRetry,
      Escape: onMenu,
      KeyM: onMenu,
    },
    armed,
  );

  const anyRecord = summary.newBestScore || summary.newBestLevel || summary.newBestTime;
  const rows: { k: string; v: string; badge?: string; amber?: boolean }[] = [
    { k: 'SECTOR REACHED', v: String(summary.level).padStart(2, '0'), badge: summary.newBestLevel ? 'BEST' : undefined },
    { k: 'SURVIVAL TIME', v: formatTime(summary.time), badge: summary.newBestTime ? 'BEST' : undefined },
    { k: 'ASTEROIDS AVOIDED', v: String(summary.avoided) },
    { k: 'ASTEROIDS DESTROYED', v: String(summary.destroyed) },
    { k: 'NEAR MISSES', v: String(summary.nearMisses) },
    { k: 'ENERGY COLLECTED', v: String(summary.energy) },
    { k: 'CREDITS EARNED', v: `+${summary.creditsEarned} CR`, amber: true },
  ];

  return (
    <div className="overlay dim">
      <div className="panel gameover" ref={ref} role="dialog" aria-label="Run terminated">
        <h2>RUN TERMINATED</h2>
        <div className="cause">{summary.cause}</div>

        <div className="score-big">
          <div>
            <div className="label">SCORE</div>
            <div className="value">{padScore(score)}</div>
          </div>
          {anyRecord && <span className="record">NEW PERSONAL RECORD</span>}
        </div>

        <div className="rows">
          {rows.map((r, i) => (
            <div className="row-item" key={r.k} style={{ animationDelay: `${0.15 + i * 0.05}s` }}>
              <span className="k">{r.k}</span>
              <span className="dots" />
              {r.badge && <span className="badge">{r.badge}</span>}
              <span className={`v${r.amber ? ' amber' : ''}`}>{r.v}</span>
            </div>
          ))}
        </div>

        {summary.unlocked.length > 0 && (
          <div className="unlock-note">
            <span className="label">NEW MODULE UNLOCKED</span>
            {summary.unlocked.map((u) => UPGRADES[u].name).join(' · ')} can now appear during runs.
          </div>
        )}

        <div className="actions">
          <button
            className="btn primary nav"
            onClick={onRetry}
            onMouseEnter={() => sfx('hover')}
          >
            RETRY
          </button>
          <button
            className="btn outline nav"
            onClick={() => {
              sfx('click');
              onMenu();
            }}
            onMouseEnter={() => sfx('hover')}
          >
            MAIN MENU
          </button>
        </div>
        <div className="hint-line">ENTER / R TO RETRY · ESC FOR MENU</div>
      </div>
    </div>
  );
}
