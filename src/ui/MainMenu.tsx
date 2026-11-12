import { useRef } from 'react';
import { formatTime, padScore } from '../game/math';
import type { SaveData } from '../game/persistence';
import { RUN_MODIFIERS, scoreMultiplier } from '../game/modifiers';
import type { SfxName } from '../game/types';
import { useArrowNav } from './hooks';

interface Props {
  save: SaveData;
  onPlay: () => void;
  onUpgrades: () => void;
  onMissions: () => void;
  onModifiers: () => void;
  onCatalogue: () => void;
  /** Number of objects in the bundled astronomical catalogue. */
  catalogueSize: number;
  onHowTo: () => void;
  onSettings: () => void;
  sfx: (n: SfxName) => void;
}

export function MainMenu({ save, onPlay, onUpgrades, onMissions, onModifiers, onCatalogue, catalogueSize, onHowTo, onSettings, sfx }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useArrowNav(ref, true);
  const r = save.records;
  const mult = scoreMultiplier(save.runModifiers);
  const mods = RUN_MODIFIERS.filter((m) => save.runModifiers.includes(m.id));
  const hover = () => sfx('hover');
  const click = (fn: () => void) => () => {
    sfx('click');
    fn();
  };

  return (
    <div className="menu" ref={ref}>
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
          {save.bosses.length > 0 && <span className="credits-chip log">{save.bosses.length}/3 BOSSES</span>}
        </button>
        <button className="btn nav" onClick={click(onModifiers)} onMouseEnter={hover}>
          MODIFIERS
          {mods.length > 0 && <span className="credits-chip mods">{mods.length} ON</span>}
        </button>
        <button className="btn nav" onClick={click(onUpgrades)} onMouseEnter={hover}>
          SHIP UPGRADES
          {save.credits > 0 && <span className="credits-chip">{save.credits} CR</span>}
        </button>
        <button className="btn nav" onClick={click(onCatalogue)} onMouseEnter={hover}>
          CATALOGUE
          <span className="credits-chip log">
            {Object.keys(save.journey.objects).length}/{catalogueSize}
          </span>
        </button>
        <button className="btn nav" onClick={click(onHowTo)} onMouseEnter={hover}>
          HOW TO PLAY
        </button>
        <button className="btn nav" onClick={click(onSettings)} onMouseEnter={hover}>
          SETTINGS
        </button>
      </nav>

      <div className="stats">
        <div className="stat">
          <div className="label">HIGHEST SECTOR</div>
          <div className="value">{r.highestLevel > 0 ? String(r.highestLevel).padStart(2, '0') : '--'}</div>
        </div>
        <div className="stat">
          <div className="label">BEST SURVIVAL</div>
          <div className="value">{formatTime(r.bestTime)}</div>
        </div>
        <div className="stat">
          <div className="label">BEST SCORE</div>
          <div className="value">{padScore(r.bestScore, 6)}</div>
        </div>
        <div className="stat">
          <div className="label">TOTAL RUNS</div>
          <div className="value">{r.totalRuns}</div>
        </div>
      </div>

      <div className="menu-footer">W / S TO STEER · SPACE TO BOOST · ESC TO PAUSE</div>
    </div>
  );
}
