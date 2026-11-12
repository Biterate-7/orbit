import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../game/engine';
import { formatTime, padScore } from '../game/math';
import { PixelIcon } from './PixelIcon';

interface Props {
  engine: Engine;
  touch: boolean;
  showHint: boolean;
  onPause: () => void;
}

/**
 * Minimal in-game HUD. Values are written straight to the DOM from the engine's frame callback,
 * so React never re-renders at 60 fps.
 */
export function Hud({ engine, touch, showHint, onPause }: Props) {
  const level = useRef<HTMLSpanElement>(null);
  const env = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLElement>(null);
  const score = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLDivElement>(null);
  const hullMeter = useRef<HTMLDivElement>(null);
  const hullFill = useRef<HTMLElement>(null);
  const hullNum = useRef<HTMLSpanElement>(null);
  const stabMeter = useRef<HTMLDivElement>(null);
  const stabFill = useRef<HTMLElement>(null);
  const stabNum = useRef<HTMLSpanElement>(null);
  const stabTag = useRef<HTMLSpanElement>(null);
  const energy = useRef<HTMLSpanElement>(null);
  const next = useRef<HTMLElement>(null);
  const boost = useRef<HTMLDivElement>(null);
  const boostFill = useRef<HTMLElement>(null);
  const boostState = useRef<HTMLSpanElement>(null);
  const flags = useRef<HTMLDivElement>(null);
  const msg = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const objTitle = useRef<HTMLDivElement>(null);
  const objDetail = useRef<HTMLDivElement>(null);
  const objTimer = useRef<HTMLDivElement>(null);
  const objBonus = useRef<HTMLUListElement>(null);
  const boss = useRef<HTMLDivElement>(null);
  const bossName = useRef<HTMLDivElement>(null);
  const bossFill = useRef<HTMLElement>(null);
  const bossStatus = useRef<HTMLDivElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const fuelMeter = useRef<HTMLDivElement>(null);
  const fuelFill = useRef<HTMLElement>(null);
  const fuelNum = useRef<HTMLSpanElement>(null);
  const [hintVisible] = useState(showHint);

  useEffect(() => {
    const last: Record<string, unknown> = {};
    const changed = (k: string, v: unknown): boolean => {
      if (last[k] === v) return false;
      last[k] = v;
      return true;
    };
    return engine.onFrame(() => {
      const h = engine.hud;
      if (changed('lv', h.level) && level.current) level.current.textContent = `LV ${String(h.level).padStart(2, '0')}`;
      if (changed('env', h.levelName) && env.current) env.current.textContent = h.levelName;
      const prog = Math.round(h.levelProgress * 100);
      if (changed('prog', prog) && progress.current) progress.current.style.width = `${prog}%`;
      if (changed('score', h.score) && score.current) score.current.textContent = padScore(h.score);
      const ts = Math.floor(h.time);
      if (changed('time', ts) && time.current) time.current.textContent = formatTime(h.time);

      const hullPct = Math.max(0, Math.round((h.hull / h.hullMax) * 100));
      if (changed('hull', hullPct)) {
        if (hullFill.current) hullFill.current.style.width = `${hullPct}%`;
        if (hullNum.current) hullNum.current.textContent = `${Math.ceil(h.hull)}`;
        if (hullMeter.current) hullMeter.current.className = `meter hull${hullPct <= 25 ? ' danger' : hullPct <= 50 ? ' warn' : ''}`;
      }
      const stab = Math.round(h.stability);
      if (changed('stab', stab)) {
        if (stabFill.current) stabFill.current.style.width = `${stab}%`;
        if (stabNum.current) stabNum.current.textContent = `${stab}%`;
        if (stabMeter.current) stabMeter.current.className = `meter${stab <= 25 ? ' danger' : stab <= 55 ? ' warn' : ''}`;
      }
      if (changed('reason', h.stabilityReason) && stabTag.current) {
        stabTag.current.textContent = h.stabilityReason ?? '';
        stabTag.current.style.color = h.stabilityReason === 'HEAT' || h.stabilityReason === 'TOO CLOSE' ? 'var(--red)' : 'var(--amber)';
      }
      if (changed('energy', h.energy) && energy.current) energy.current.textContent = String(h.energy);
      const span = Math.max(1, h.milestoneNext - h.milestonePrev);
      const np = Math.round(Math.min(1, Math.max(0, (h.energy - h.milestonePrev) / span)) * 100);
      if (changed('next', np) && next.current) next.current.style.width = `${np}%`;
      const bc = Math.round(h.boostCharge * 100);
      if (changed('boost', bc)) {
        if (boostFill.current) boostFill.current.style.width = `${bc}%`;
        if (boost.current) boost.current.className = `hud-boost${h.boostReady ? ' ready' : ''}`;
        if (boostState.current) boostState.current.textContent = h.boostReady ? 'READY' : `${bc}%`;
      }
      const flagKey = `${h.shield}|${Math.ceil(h.overdrive)}|${h.hasTemporal ? (h.temporalReady ? 1 : 2) : 0}`;
      if (changed('flags', flagKey) && flags.current) {
        const parts: string[] = [];
        if (h.shield > 0) parts.push(`<span class="shield">SHIELD${'<i class="pip"></i>'.repeat(h.shield)}</span>`);
        if (h.overdrive > 0) parts.push(`<span class="od">OVERDRIVE ${Math.ceil(h.overdrive)}s</span>`);
        if (h.hasTemporal) parts.push(`<span class="tf">${h.temporalReady ? 'TEMPORAL READY' : 'TEMPORAL ...'}</span>`);
        flags.current.innerHTML = parts.join('');
      }
      const m = h.message;
      if (m && changed('msg', m.id) && msg.current) {
        const el = msg.current;
        el.textContent = m.text;
        el.className = `hud-msg ${m.tone}`;
        void el.offsetWidth; // restart animation
        el.className = `hud-msg show ${m.tone}`;
      }
      if (hint.current && !hint.current.classList.contains('hide') && (h.time > 10 || h.level > 1)) {
        hint.current.classList.add('hide');
      }

      // ---- mission objective
      const o = h.objective;
      if (changed('objT', o.title) && objTitle.current) objTitle.current.textContent = o.title;
      if (changed('objD', o.detail) && objDetail.current) objDetail.current.textContent = o.detail;
      const timer = o.timer >= 0 ? Math.ceil(o.timer) : -1;
      if (changed('objTm', timer) && objTimer.current) {
        objTimer.current.textContent = timer >= 0 ? `JUMP WINDOW ${formatTime(timer)}` : '';
        objTimer.current.className = `obj-timer${timer >= 0 && timer <= 15 ? ' urgent' : ''}`;
      }
      const bonusKey = o.bonuses.map((b) => `${b.label}:${b.state}`).join('|');
      if (changed('bonus', bonusKey) && objBonus.current) {
        objBonus.current.innerHTML = o.bonuses
          .map((b) => `<li class="${b.state === 1 ? 'done' : b.state === 2 ? 'fail' : ''}"><i></i>${b.label}</li>`)
          .join('');
      }
      const bossKey = o.boss ? `${o.boss.name}|${o.boss.phase}|${Math.round(o.boss.hp * 100)}|${o.boss.status}` : '';
      if (changed('boss', bossKey) && boss.current) {
        boss.current.style.display = o.boss ? '' : 'none';
        if (o.boss) {
          if (bossName.current) bossName.current.textContent = o.boss.name;
          if (bossFill.current) bossFill.current.style.width = `${Math.round(o.boss.hp * 100)}%`;
          if (bossStatus.current) bossStatus.current.textContent = `PHASE ${o.boss.phase}/${o.boss.phases} · ${o.boss.status}`;
          boss.current.dataset.phase = String(o.boss.phase);
        }
      }
      if (changed('alert', o.alert) && alert.current) {
        alert.current.textContent = o.alert;
        alert.current.className = `hud-alert${o.alert ? ' show' : ''}${/INVERT|NO FUEL|SURGE|LOCK ON|DASH|BURN$/.test(o.alert) ? ' danger' : ''}`;
      }
      const fuelPct = o.fuelMax > 0 ? Math.round((o.fuel / o.fuelMax) * 100) : -1;
      if (changed('fuel', fuelPct) && fuelMeter.current) {
        fuelMeter.current.style.display = fuelPct >= 0 ? '' : 'none';
        if (fuelPct >= 0) {
          if (fuelFill.current) fuelFill.current.style.width = `${fuelPct}%`;
          if (fuelNum.current) fuelNum.current.textContent = `${o.fuel.toFixed(1)}s`;
          fuelMeter.current.className = `meter fuel${fuelPct <= 15 ? ' danger' : fuelPct <= 35 ? ' warn' : ''}`;
        }
      }
    });
  }, [engine]);

  return (
    <div className={`hud${touch ? ' has-touch' : ''}`}>
      <div className="hud-corner hud-tl">
        <div className="hud-level">
          <span className="lv" ref={level}>
            LV 01
          </span>
        </div>
        <div className="hud-env" ref={env} />
        <div className="hud-progress" aria-hidden="true">
          <i ref={progress} />
        </div>
        <div className="hud-obj" aria-live="polite">
          <div className="obj-title" ref={objTitle} />
          <div className="obj-detail" ref={objDetail} />
          <div className="obj-timer" ref={objTimer} />
          <ul className="obj-bonus" ref={objBonus} />
        </div>
      </div>

      <div className="hud-boss" ref={boss} style={{ display: 'none' }}>
        <div className="name" ref={bossName} />
        <div className="bar">
          <i ref={bossFill} />
        </div>
        <div className="status" ref={bossStatus} />
      </div>

      <div className="hud-alert" ref={alert} role="status" />

      <div className="hud-corner hud-tr">
        <div className="hud-score" ref={score}>
          0000000
        </div>
        <div className="hud-time" ref={time}>
          00:00
        </div>
      </div>

      <button className="hud-pause" onClick={onPause} aria-label="Pause">
        <PixelIcon name="pause" color="#8592bb" size={18} />
      </button>

      <div className="hud-corner hud-bl">
        <div className="meter fuel" ref={fuelMeter} style={{ display: 'none' }}>
          <div className="meter-head">
            <span className="label">FUEL</span>
            <span className="num" ref={fuelNum}>
              0s
            </span>
          </div>
          <div className="meter-bar">
            <i ref={fuelFill} />
          </div>
        </div>
        <div className="meter hull" ref={hullMeter}>
          <div className="meter-head">
            <span className="label">HULL</span>
            <span className="num" ref={hullNum}>
              100
            </span>
          </div>
          <div className="meter-bar">
            <i ref={hullFill} />
          </div>
        </div>
        <div className="meter" ref={stabMeter}>
          <div className="meter-head">
            <span className="label">
              <span className="wide-only">ORBIT </span>STABILITY
            </span>
            <span className="num" ref={stabNum}>
              100%
            </span>
          </div>
          <div className="meter-bar">
            <i ref={stabFill} />
          </div>
          <span className="meter-tag" ref={stabTag} />
        </div>
      </div>

      <div className="hud-corner hud-br">
        <div className="hud-flags" ref={flags} />
        <div className="hud-energy">
          <span className="label">ENERGY</span>
          <span className="gem" />
          <span ref={energy}>0</span>
        </div>
        <div className="hud-next" title="Next upgrade">
          <i ref={next} />
        </div>
        <div className="hud-boost ready" ref={boost}>
          <span className="label">BOOST</span>
          <div className="bar">
            <i ref={boostFill} style={{ width: '100%' }} />
          </div>
          <span className="state" ref={boostState}>
            READY
          </span>
        </div>
      </div>

      <div className="hud-msg" ref={msg} role="status" aria-live="polite" />

      {hintVisible && (
        <div className="hud-hint" ref={hint}>
          {touch ? (
            <div className="row">
              <span>
                HOLD <b>ACCEL</b> / <b>BRAKE</b> TO SHAPE YOUR ORBIT · <b>BOOST</b> TO PHASE THROUGH ROCK
              </span>
            </div>
          ) : (
            <div className="row">
              <span className="key">W</span>
              <span className="key"><PixelIcon name="up" color="#8592bb" size={9} /></span>
              <span>ACCELERATE</span>
              <span className="key">S</span>
              <span className="key"><PixelIcon name="down" color="#8592bb" size={9} /></span>
              <span>DECELERATE</span>
              <span className="key">SPACE</span>
              <span>BOOST</span>
            </div>
          )}
          <div className="row">
            <span>
              KEEP THE <b>DOTTED PATH</b> BETWEEN THE TWO RINGS
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
