import { useRef } from 'react';
import type { CSSProperties } from 'react';
import { CURRICULUM, MISSION_ORDER, MISSIONS } from '../game/missions/catalog';
import type { SaveData } from '../game/persistence';
import type { MissionKind, SfxName } from '../game/types';
import { useArrowNav, useKeys } from './hooks';

interface Props {
  save: SaveData;
  onPractice: (kind: MissionKind) => void;
  onBack: () => void;
  sfx: (n: SfxName) => void;
}

/** Mission log: every mission type, its best rank, and practice runs of the ones already reached. */
export function Missions({ save, onPractice, onBack, sfx }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useArrowNav(ref, true);
  useKeys({ Escape: onBack });
  const reached = save.records.highestLevel;
  const completedKinds = MISSION_ORDER.filter((k) => (save.missions[k]?.completed ?? 0) > 0).length;
  const sRanks = MISSION_ORDER.filter((k) => save.missions[k]?.best === 'S').length;

  return (
    <div className="overlay dim">
      <div className="panel missions" ref={ref} role="dialog" aria-label="Missions">
        <div className="hangar-head">
          <div>
            <h2 className="panel-title">MISSION LOG</h2>
            <p className="panel-sub">Best rank per mission type. Practise any mission you have reached in a run.</p>
          </div>
          <div className="credits">
            <div className="label">S RANKS</div>
            <div className="value">
              {sRanks}/{MISSION_ORDER.length}
            </div>
          </div>
        </div>
        <div className="mission-stats">
          <span>
            <b>{completedKinds}</b>/{MISSION_ORDER.length} TYPES CLEARED
          </span>
          <span>
            <b>{save.records.missionsCompleted}</b> MISSIONS FLOWN
          </span>
          <span>
            <b>{save.records.shards}</b> SHARDS FOUND
          </span>
          <span>
            <b>{save.bosses.length}</b>/3 ENCOUNTERS DEFEATED
          </span>
        </div>
        <div className="mission-list">
          {MISSION_ORDER.map((kind) => {
            const info = MISSIONS[kind];
            const first = CURRICULUM.indexOf(kind) + 1;
            const open = reached >= first;
            const rec = save.missions[kind];
            return (
              <div key={kind} className={`mission-row${open ? '' : ' locked'}${info.boss ? ' boss' : ''}`} style={{ '--mission': info.color } as CSSProperties}>
                <div className={`rank rank-${rec && rec.best !== '-' ? rec.best : 'none'}`}>{rec && rec.best !== '-' ? rec.best : '·'}</div>
                <div className="info">
                  <div className="name">{open ? info.title : '??????'}</div>
                  <div className="desc">{open ? info.summary : `REACH SECTOR ${first} TO UNLOCK`}</div>
                </div>
                <div className="done">{rec ? `${rec.completed}×` : ''}</div>
                <button
                  className="btn outline small nav"
                  disabled={!open}
                  onClick={() => {
                    sfx('click');
                    onPractice(kind);
                  }}
                  onMouseEnter={() => open && sfx('hover')}
                >
                  PRACTICE
                </button>
              </div>
            );
          })}
        </div>
        <p className="panel-sub" style={{ marginTop: 10 }}>
          Practice flies one fresh sector of the mission. It pays half credits and does not count towards records.
        </p>
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
