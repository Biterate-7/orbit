import type { LevelIntro } from '../game/types';

interface Props {
  intro: LevelIntro;
  onDone: () => void;
}

export function LevelIntroCard({ intro, onDone }: Props) {
  return (
    <div
      className="intro"
      key={intro.key}
      onAnimationEnd={(e) => {
        if (e.animationName === 'introOut') onDone();
      }}
      aria-live="polite"
    >
      <div className="cls">{intro.classification}</div>
      <div className="name">{intro.name}</div>
      <div className="line" />
      <div className="tag">{intro.tagline}</div>
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
