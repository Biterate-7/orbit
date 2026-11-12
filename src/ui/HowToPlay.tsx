import { useRef } from 'react';
import type { SfxName } from '../game/types';
import { useArrowNav, useKeys } from './hooks';
import { OrbitDiagram } from './OrbitDiagram';
import { PixelIcon } from './PixelIcon';

interface Props {
  onBack: () => void;
  sfx: (n: SfxName) => void;
}

export function HowToPlay({ onBack, sfx }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useArrowNav(ref, true);
  useKeys({ Escape: onBack });

  return (
    <div className="overlay dim">
      <div className="panel howto" ref={ref} role="dialog" aria-label="How to play">
        <h2 className="panel-title">HOW TO PLAY</h2>
        <p className="panel-sub">STEER. DODGE. MAINTAIN ORBIT. SURVIVE.</p>

        <div className="howto-grid">
          <div>
            <h3>CONTROLS</h3>
            <div className="controls-table">
              <div className="keys">
                <span className="key">W</span>
                <span className="key">
                  <PixelIcon name="up" color="#8592bb" size={9} />
                </span>
              </div>
              <div className="what">
                <b>Accelerate</b> along your path
              </div>
              <div className="keys">
                <span className="key">S</span>
                <span className="key">
                  <PixelIcon name="down" color="#8592bb" size={9} />
                </span>
              </div>
              <div className="what">
                <b>Decelerate</b> against your path
              </div>
              <div className="keys">
                <span className="key">A</span>
                <span className="key">D</span>
              </div>
              <div className="what">Fine strafe left / right</div>
              <div className="keys">
                <span className="key">SPACE</span>
              </div>
              <div className="what">
                <b>Boost</b>: phase through hazards briefly
              </div>
              <div className="keys">
                <span className="key">ESC</span>
                <span className="key">P</span>
              </div>
              <div className="what">Pause</div>
              <div className="keys">
                <span className="key">MOUSE</span>
              </div>
              <div className="what">Hold left = accelerate, right = decelerate</div>
            </div>
            <p style={{ marginTop: 10 }}>On touch screens, use the on-screen ACCEL / BRAKE / BOOST buttons.</p>
          </div>

          <div>
            <h3>ORBITS</h3>
            <OrbitDiagram />
            <p style={{ marginTop: 8 }}>
              Gravity always pulls you in. <b>Speeding up</b> swings the far side of your orbit outward; <b>slowing down</b> drops
              it inward. The dotted line shows where you are heading.
            </p>
          </div>

          <div>
            <h3>ORBIT STABILITY</h3>
            <p>
              Keep your path between the <b style={{ color: 'var(--red)' }}>inner</b> and <b style={{ color: 'var(--cyan)' }}>outer</b>{' '}
              rings. Drifting out of the band, falling inward, escaping or entering heat zones drains stability. At zero you lose
              control.
            </p>
            <p>Touching a star, planet or event horizon is fatal.</p>
          </div>

          <div>
            <h3>HAZARDS</h3>
            <ul>
              <li>
                <span className="hazard-swatch" style={{ background: '#8b81a3' }} />
                <span>
                  <b>Asteroids</b> drift through. Large ones split.
                </span>
              </li>
              <li>
                <span className="hazard-swatch" style={{ background: '#7ffcff' }} />
                <span>
                  <b>Comets</b> are fast. Watch for edge warnings.
                </span>
              </li>
              <li>
                <span className="hazard-swatch" style={{ background: '#ff8a3d' }} />
                <span>
                  <b>Flares, beams &amp; waves</b> are telegraphed. Time it.
                </span>
              </li>
              <li>
                <span className="hazard-swatch" style={{ background: '#ffc94d' }} />
                <span>
                  <b>Near misses</b> score bonus points.
                </span>
              </li>
            </ul>
          </div>

          <div>
            <h3>ENERGY &amp; UPGRADES</h3>
            <p>
              Collect <b style={{ color: 'var(--cyan)' }}>energy</b> orbiting the body. Milestones pause the run and offer three
              modules - pick one. After a run, energy becomes <b style={{ color: 'var(--amber)' }}>credits</b> for permanent ship
              upgrades.
            </p>
          </div>

          <div>
            <h3>MISSIONS</h3>
            <p>
              Every sector is flown for a <b>mission</b> - survive waves, thread gates, dock with a station, cross asteroid belts,
              slingshot past planets, climb out of a black hole, run a nebula, outrun a hunter. The objective sits under the sector
              name; the <b style={{ color: 'var(--green)' }}>preview turns its target green</b> when you are on course.
            </p>
            <p>
              <b>PE</b> / <b>AP</b> mark your periapsis and apoapsis: a burn changes the far side of the orbit, and counts most where
              you move fastest.
            </p>
          </div>

          <div>
            <h3>BOSSES &amp; RANKS</h3>
            <p>
              Every fifth sector is a <b style={{ color: 'var(--red)' }}>major encounter</b> with three phases and a weakness to find.
              Missions are ranked <b style={{ color: 'var(--amber)' }}>S</b>-C on time, damage and bonus objectives. <b>Shards</b> hidden
              off the safe line unlock advanced ship parts.
            </p>
          </div>
        </div>

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
