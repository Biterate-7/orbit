import { useEffect, useRef, useState } from 'react';
import { formatTime, padScore } from '../game/math';
import type { RunSummary, SfxName } from '../game/types';
import { UPGRADES } from '../game/upgrades';
import { useArrowNav, useKeys } from './hooks';

interface Props {
  summary: RunSummary;
  /** A single practice sector rather than a run. */
  practice?: boolean;
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

export function GameOver({ summary, practice = false, onRetry, onMenu, sfx }: Props) {
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
  const ranks = summary.ranks.filter((r) => r !== '-');
  const rankLine = ranks.length > 0 ? ranks.join(' ') : '—';
  const cleared = practice && summary.missionsCompleted > 0;
  const rows: { k: string; v: string; badge?: string; amber?: boolean }[] = [
    { k: 'SECTOR REACHED', v: String(summary.level).padStart(2, '0'), badge: summary.newBestLevel ? 'BEST' : undefined },
    { k: 'MISSIONS COMPLETED', v: String(summary.missionsCompleted) },
    { k: 'MISSION RANKS', v: rankLine },
    { k: 'BOSSES DEFEATED', v: summary.bossesDefeated.length > 0 ? summary.bossesDefeated.join(' · ') : '0', badge: summary.bossesDefeated.length > 0 ? 'NEW' : undefined },
    { k: 'SHARDS FOUND', v: String(summary.shards) },
    { k: 'SURVIVAL TIME', v: formatTime(summary.time), badge: summary.newBestTime ? 'BEST' : undefined },
    { k: 'HAZARDS DESTROYED', v: String(summary.destroyed) },
    { k: 'NEAR MISSES', v: String(summary.nearMisses) },
    { k: 'ENERGY COLLECTED', v: String(summary.energy) },
    { k: 'OBJECTS CATALOGUED', v: summary.discoveries.length > 0 ? `+${summary.discoveries.length}` : '0', badge: summary.discoveries.length > 0 ? 'NEW' : undefined },
    { k: 'CREDITS EARNED', v: `+${summary.creditsEarned} CR`, amber: true },
  ];

  return (
    <div className="overlay dim">
      <div className="panel gameover" ref={ref} role="dialog" aria-label="Run terminated">
        <h2>{cleared ? 'PRACTICE COMPLETE' : practice ? 'PRACTICE OVER' : 'RUN TERMINATED'}</h2>
        <div className="cause">{summary.cause}</div>

        <div className="score-big">
          <div>
            <div className="label">SCORE{summary.scoreMultiplier !== 1 ? ` · MODIFIERS x${summary.scoreMultiplier.toFixed(2)}` : ''}</div>
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

        {summary.discoveries.length > 0 && (
          <div className="unlock-note">
            <span className="label">ADDED TO THE CATALOGUE</span>
            {summary.discoveries.slice(0, 8).join(' · ')}
            {summary.discoveries.length > 8 ? ` · +${summary.discoveries.length - 8} more` : ''}
          </div>
        )}
        {summary.milestones.length > 0 && (
          <div className="unlock-note">
            <span className="label">MILESTONE REACHED</span>
            {summary.milestones.join(' · ')}
          </div>
        )}
        {summary.partsUnlocked.length > 0 && (
          <div className="unlock-note">
            <span className="label">SHIP PART UNLOCKED</span>
            {summary.partsUnlocked.join(' · ')} can now be bought in the hangar.
          </div>
        )}
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
            {practice ? 'FLY AGAIN' : 'RETRY'}
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
