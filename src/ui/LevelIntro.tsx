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
  return (
    <div
      className={`intro${rare ? ' rare' : ''}${intro.name.length > 16 ? ' long' : ''}`}
      key={intro.key}
      onAnimationEnd={(e) => {
        if (e.animationName === 'introOut') onDone();
      }}
      aria-live="polite"
    >
      <div className="cls">
        {rare && <span className="rare-tag">{id.rarity === 'legendary' ? 'ANOMALOUS ENCOUNTER' : 'RARE ENCOUNTER'} // </span>}
        {intro.classification}
      </div>
      <div className="name" aria-label={title}>
        {intro.name}
      </div>
      <div className="line" />
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
