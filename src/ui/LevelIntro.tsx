import type { CSSProperties } from 'react';
import { MISSIONS } from '../game/missions/catalog';
import type { LevelIntro } from '../game/types';

interface Props {
  intro: LevelIntro;
  onDone: () => void;
}

const KIND_CLASS = { 'REAL OBJECT': 'real', 'PROCEDURAL VARIANT': 'variant', 'FICTIONAL OBJECT': 'fiction' } as const;

export function LevelIntroCard({ intro, onDone }: Props) {
  const id = intro.identity;
  const rare = id.rarity === 'rare' || id.rarity === 'legendary';
  const title = `${String(intro.index).padStart(3, '0')} — ${intro.name}`;
  const color = MISSIONS[intro.missionKind].color;
  return (
    <div
      className={`intro${rare ? ' rare' : ''}${intro.boss ? ' boss' : ''}${intro.name.length > 16 ? ' long' : ''}`}
      key={intro.key}
      style={{ '--mission': color } as CSSProperties}
      onAnimationEnd={(e) => {
        if (e.animationName === 'introOut') onDone();
      }}
      aria-live="polite"
    >
      {intro.boss && <div className="boss-warn">WARNING // MAJOR ENCOUNTER</div>}
      <div className="mission-tag">
        {intro.newMission && !intro.boss && <span className="new-mission">NEW MISSION</span>}
        <span className="mission-name">{intro.missionTitle}</span>
      </div>
      <div className="cls">
        {rare && <span className="rare-tag">{id.rarity === 'legendary' ? 'ANOMALOUS ENCOUNTER' : 'RARE ENCOUNTER'} // </span>}
        {intro.classification}
      </div>
      <div className="name" aria-label={title}>
        {intro.name}
      </div>
      <div className="line" />
      <div className="brief">{intro.missionBrief}</div>
      <div className="tag">{intro.tagline}</div>
      {/* What this sector is about: the object, where the data comes from, and how it orbits. */}
      <div className="ident">
        <span className={`badge ${KIND_CLASS[id.kind]}`}>{id.kind}</span>
        <span className="obj">
          {id.objectName} · {id.objectClass.toUpperCase()}
        </span>
        <span className="orb">{id.orbitLabel}</span>
      </div>
      {intro.newMechanics.length > 0 && (
        <div className="new">
          {intro.newMechanics.map((m) => (
            <span key={m}>NEW · {m}</span>
          ))}
        </div>
      )}
    </div>
  );
}
