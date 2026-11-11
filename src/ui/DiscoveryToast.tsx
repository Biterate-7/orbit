import type { LevelIdentity } from '../game/types';

interface Props {
  identity: LevelIdentity;
  /** Re-mount key so consecutive discoveries restart the animation. */
  toastKey: number;
  onDone: () => void;
}

/** Compact "new catalogue entry" read-out shown once the sector intro has cleared. */
export function DiscoveryToast({ identity, toastKey, onDone }: Props) {
  return (
    <div
      className="discovery"
      key={toastKey}
      role="status"
      onAnimationEnd={(e) => {
        if (e.animationName === 'discoveryOut') onDone();
      }}
    >
      <div className="d-head">◆ NEW CATALOGUE ENTRY</div>
      <div className="d-name">{identity.objectName}</div>
      <div className="d-class">{identity.objectClass.toUpperCase()}</div>
      <div className="d-src">{identity.source}</div>
    </div>
  );
}
