import type { CSSProperties } from 'react';
import { RARITY_COLOR, RARITY_LABEL, cosmetic } from '../game/cosmetics/catalog';
import { SYNERGIES } from '../game/modules';
import type { Outcome } from '../progression/events';
import { levelReward, rankTitle } from '../progression/level';
import { PixelIcon } from './PixelIcon';

export interface Toast {
  id: number;
  icon: string;
  color: string;
  kicker: string;
  title: string;
  sub: string;
}

const TIER_COLOR = { bronze: '#c8875a', silver: '#c9d3ea', gold: '#ffc94d', prismatic: '#ff7ad8' } as const;

let seq = 0;

/** Turn what an event earned into the notifications to show for it. */
export function toastsFor(out: Outcome): Toast[] {
  const list: Toast[] = [];
  for (const a of out.achievements) {
    list.push({ id: ++seq, icon: a.icon, color: TIER_COLOR[a.tier], kicker: 'ACHIEVEMENT UNLOCKED', title: a.title, sub: `${a.description}  +${a.reward} CR` });
  }
  for (const level of out.levels) {
    list.push({ id: ++seq, icon: 'pilot', color: '#3ef2ff', kicker: 'PILOT LEVEL UP', title: `LEVEL ${level} · ${rankTitle(level)}`, sub: `+${levelReward(level)} CR` });
  }
  for (const id of out.cosmetics) {
    const c = cosmetic(id);
    // A case reward has its own reveal screen; the toast is for things granted along the way.
    if (!c || out.roll) continue;
    list.push({ id: ++seq, icon: 'ship', color: RARITY_COLOR[c.rarity], kicker: `${RARITY_LABEL[c.rarity]} ITEM ADDED TO THE HANGAR`, title: c.name, sub: c.description });
  }
  for (const id of out.synergies) {
    const s = SYNERGIES.find((x) => x.id === id);
    if (s) list.push({ id: ++seq, icon: 'mod_resonator', color: s.color, kicker: 'SYNERGY DISCOVERED', title: s.name, sub: s.description });
  }
  return list;
}

/** Notifications for lasting rewards. They stack in a corner and never take input. */
export function RewardToasts({ toasts, onDone }: { toasts: Toast[]; onDone: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.slice(0, 4).map((t) => (
        <div
          key={t.id}
          className="toast"
          style={{ '--accent': t.color } as CSSProperties}
          onAnimationEnd={(e) => {
            if (e.animationName === 'toastLife') onDone(t.id);
          }}
        >
          <div className="toast-icon">
            <PixelIcon name={t.icon} color={t.color} size={27} />
          </div>
          <div>
            <div className="label">{t.kicker}</div>
            <div className="toast-title">{t.title}</div>
            <div className="toast-sub">{t.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
