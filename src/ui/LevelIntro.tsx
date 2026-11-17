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
        {intro.variant !== 'standard' && <span className={`variant-tag ${intro.variant}`}>{intro.variant.toUpperCase()}</span>}
        <span className="mission-name">{intro.missionTitle}</span>
        {intro.reward !== 1 && <span className="reward-tag">PAYS x{intro.reward.toFixed(2)}</span>}
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
      {(intro.twists.length > 0 || intro.variantNote) && (
        <div className="twists">
          {intro.variantNote && <span className="twist variant">{intro.variantNote}</span>}
          {intro.twists.map((t) => (
            <span key={t.name} className="twist" style={{ '--twist': t.color } as CSSProperties}>
              <b>{t.name}</b> {t.note}
            </span>
          ))}
        </div>
      )}
      {/* What this sector is about: the object, where the data comes from, and how it orbits. */}
      <div className="ident">
        <span className={`badge ${KIND_CLASS[id.kind]}`}>{id.kind}</span>
        <span className="obj">
          {id.objectName} · {id.objectClass.toUpperCase()}
        </span>
        <span className="orb">{id.orbitLabel}</span>
        {intro.newSystem && <span className="badge real">NEW SYSTEM</span>}
        {intro.toBoss > 0 && intro.toBoss <= 2 && <span className="orb warn">{intro.toBoss === 1 ? 'MAJOR ENCOUNTER NEXT' : 'MAJOR ENCOUNTER CLOSE'}</span>}
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
