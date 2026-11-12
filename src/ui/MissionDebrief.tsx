import type { CSSProperties } from 'react';
import { formatTime } from '../game/math';
import { MISSIONS } from '../game/missions/catalog';
import type { MissionDebrief } from '../game/types';

interface Props {
  debrief: MissionDebrief;
  onDone: () => void;
}

/** End-of-sector report: rank, time against par, bonus objectives and shards. Non-blocking. */
export function MissionDebriefCard({ debrief: d, onDone }: Props) {
  const color = MISSIONS[d.kind].color;
  return (
    <div
      className={`debrief${d.success ? '' : ' failed'}`}
      key={d.key}
      style={{ '--mission': color } as CSSProperties}
      onAnimationEnd={(e) => {
        if (e.animationName === 'debriefOut') onDone();
      }}
      role="status"
    >
      <div className="head">
        <div>
          <div className="label">
            SECTOR {String(d.index).padStart(3, '0')} · {d.boss ? 'MAJOR ENCOUNTER' : 'MISSION'} {d.success ? 'COMPLETE' : 'ABANDONED'}
          </div>
          <div className="title">{d.title}</div>
        </div>
        <div className={`rank rank-${d.rank === '-' ? 'none' : d.rank}`}>{d.rank === '-' ? '—' : d.rank}</div>
      </div>
      {!d.success && <div className="fail-line">{d.failure} · HULL STRESS</div>}
      <div className="rows">
        <div>
          <span className="k">TIME</span>
          <span className={`v${d.time <= d.par ? ' good' : ''}`}>
            {formatTime(d.time)} <em>PAR {formatTime(d.par)}</em>
          </span>
        </div>
        <div>
          <span className="k">HULL LOST</span>
          <span className={`v${d.damage === 0 ? ' good' : ''}`}>{d.damage}</span>
        </div>
        {d.shardsTotal > 0 && (
          <div>
            <span className="k">SHARDS</span>
            <span className={`v${d.shards === d.shardsTotal ? ' good' : ''}`}>
              {d.shards}/{d.shardsTotal}
            </span>
          </div>
        )}
      </div>
      <ul className="bonuses">
        {d.bonuses.map((b) => (
          <li key={b.label} className={b.done ? 'done' : ''}>
            <i />
            {b.label}
          </li>
        ))}
      </ul>
      <div className="score">+{d.score}</div>
    </div>
  );
}
