import { useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { RARITY_COLOR, resolveLook } from '../game/cosmetics/catalog';
import { padScore } from '../game/math';
import { NORMAL_MISSIONS } from '../game/missions/catalog';
import { RUN_MODIFIERS, scoreMultiplier } from '../game/modifiers';
import { baysOpen } from '../game/modules';
import type { SaveData } from '../game/persistence';
import type { SfxName } from '../game/types';
import { achievementSummary } from '../progression/achievements';
import { levelProgress, rankTitle } from '../progression/level';
import { useArrowNav } from './hooks';
import { ShipPreview } from './ShipPreview';

interface Props {
  save: SaveData;
  onPlay: () => void;
  onUpgrades: () => void;
  onMissions: () => void;
  onModifiers: () => void;
  onCatalogue: () => void;
  onHangar: () => void;
  onShop: () => void;
  onProfile: () => void;
  /** Number of star systems on file. */
  systemCount: number;
  onHowTo: () => void;
  onSettings: () => void;
  sfx: (n: SfxName) => void;
}

/**
 * The front door. One column of destinations, each with the one number that matters about it,
 * and the pilot's card - their ship as fitted, level and balance - beside it.
 */
export function MainMenu({ save, onPlay, onUpgrades, onMissions, onModifiers, onCatalogue, onHangar, onShop, onProfile, systemCount, onHowTo, onSettings, sfx }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useArrowNav(ref, true);
  const r = save.records;
  const mult = scoreMultiplier(save.runModifiers);
  const mods = RUN_MODIFIERS.filter((m) => save.runModifiers.includes(m.id));
  const lv = levelProgress(save.profile.xp);
  const look = useMemo(() => resolveLook(save.inventory.equipped), [save.inventory.equipped]);
  const fresh = Object.values(save.inventory.owned).filter((o) => o.fresh).length;
  const ach = achievementSummary(save);
  const flown = NORMAL_MISSIONS.filter((k) => (save.missions[k]?.completed ?? 0) > 0).length;
  const fitted = save.modules.equipped.length;
  const hover = () => sfx('hover');
  const click = (fn: () => void) => () => {
    sfx('click');
    fn();
  };

  return (
    <div className="menu menu2" ref={ref}>
      <div className="menu-main">
        <h1 className="title" aria-label="ORBIT LOST">
          ORBIT<span className="slash">//</span>LOST
        </h1>
        <p className="tagline">STAY IN ORBIT. SURVIVE THE UNIVERSE.</p>

        <nav className="menu-list" aria-label="Main menu">
          <button className="btn primary nav" onClick={onPlay} onMouseEnter={hover}>
            PLAY
            {mods.length > 0 && <span className="credits-chip mods">x{mult.toFixed(2)}</span>}
          </button>
          <button className="btn nav" onClick={click(onMissions)} onMouseEnter={hover}>
            MISSIONS
            <span className="credits-chip log">
              {flown}/{NORMAL_MISSIONS.length} TYPES · {save.bosses.length}/3 BOSSES
            </span>
          </button>
          <button className="btn nav" onClick={click(onCatalogue)} onMouseEnter={hover}>
            CATALOGUE
            <span className="credits-chip log">
              {Object.keys(save.journey.systems).length}/{systemCount} SYSTEMS · {Object.keys(save.journey.objects).length} OBJECTS
            </span>
          </button>
          <button className="btn nav" onClick={click(onHangar)} onMouseEnter={hover}>
            HANGAR
            {fresh > 0 ? <span className="credits-chip new">{fresh} NEW</span> : <span className="credits-chip log">{Object.keys(save.inventory.owned).length} ITEMS</span>}
          </button>
          <button className="btn nav" onClick={click(onShop)} onMouseEnter={hover}>
            SHOP
            <span className="credits-chip">{save.credits} CR</span>
          </button>
          <button className="btn nav" onClick={click(onUpgrades)} onMouseEnter={hover}>
            ENGINEERING
            <span className="credits-chip log">
              {fitted}/{baysOpen(lv.level)} MODULES FITTED
            </span>
          </button>
          <button className="btn nav" onClick={click(onProfile)} onMouseEnter={hover}>
            PROFILE
            <span className="credits-chip log">
              {ach.unlocked}/{ach.total} ACHIEVEMENTS
            </span>
          </button>
        </nav>

        <nav className="menu-minor" aria-label="More">
          <button className="btn small nav" onClick={click(onModifiers)} onMouseEnter={hover}>
            MODIFIERS{mods.length > 0 ? ` · ${mods.length} ON` : ''}
          </button>
          <button className="btn small nav" onClick={click(onHowTo)} onMouseEnter={hover}>
            HOW TO PLAY
          </button>
          <button className="btn small nav" onClick={click(onSettings)} onMouseEnter={hover}>
            SETTINGS
          </button>
        </nav>
      </div>

      <aside className="pilot-card" style={{ '--rar': RARITY_COLOR[look.rarity] } as CSSProperties} aria-label="Pilot">
        <div className="pilot-ship">
          <ShipPreview look={look} width={78} height={48} scale={3} reduced={save.settings.reducedEffects} label="Your ship" />
        </div>
        <div className="pilot-name">{save.profile.name}</div>
        <div className="label">
          {rankTitle(lv.level)} · LEVEL {lv.level}
        </div>
        <div className="xp">
          <span className="mile-bar">
            <i style={{ width: `${lv.fraction * 100}%` }} />
          </span>
          <span className="label">
            {lv.into}/{lv.need} XP
          </span>
        </div>
        <div className="pilot-stats">
          <div className="stat">
            <div className="label">HIGHEST SECTOR</div>
            <div className="value">{r.highestLevel > 0 ? String(r.highestLevel).padStart(2, '0') : '--'}</div>
          </div>
          <div className="stat">
            <div className="label">BEST SCORE</div>
            <div className="value">{padScore(r.bestScore, 6)}</div>
          </div>
          <div className="stat">
            <div className="label">MISSIONS</div>
            <div className="value">{save.stats.missionsCompleted}</div>
          </div>
          <div className="stat">
            <div className="label">CREDITS</div>
            <div className="value amber">{save.credits}</div>
          </div>
        </div>
      </aside>

      <div className="menu-footer">W / S TO STEER · SPACE TO BOOST · ESC TO PAUSE</div>
    </div>
  );
}
