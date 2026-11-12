/**
 * One controller per mission type: objective, win condition, failure pressure and HUD text.
 * Shared machinery (pickups, gates, clouds, mines, enemies, fuel, ranking) lives in runtime.ts.
 */
import { PALETTE } from '../config';
import { clamp, TAU, wrapAngle } from '../math';
import { orbitInfo } from '../orbital';
import { eulerStep } from '../physics';
import { P_GLOW } from '../particles';
import { inWedge } from '../collision';
import type { Run } from '../run';
import { LULL } from '../../generation/missionGenerator';
import { Enemy, Mission } from './runtime';
import type { PickupRt, TargetRt } from './runtime';
import type { MissionSpec } from './types';

const pct = (v: number): string => `${Math.floor(clamp(v, 0, 1) * 100)}%`;

/** Distance from the ship to a point. */
function distTo(run: Run, x: number, y: number): number {
  return Math.hypot(run.ship.x - x, run.ship.y - y);
}

// ------------------------------------------------------------------ survival

class SurvivalMission extends Mission {
  wave = 0;
  lull = false;
  waveT = 0;

  protected onSetup(): void {
    this.applyWave();
  }

  private applyWave(): void {
    const w = this.spec.waves[this.wave];
    if (w) this.run.setSpawn(new Set(w.mods), w.rate);
  }

  protected tick(dt: number, active: boolean): void {
    if (!active || this.complete) return;
    const W = this.spec.waves;
    this.waveT += dt;
    if (this.lull) {
      if (this.waveT >= LULL) {
        this.lull = false;
        this.waveT = 0;
        this.wave++;
        this.applyWave();
        this.run.sink.message(this.wave === W.length - 1 ? `FINAL WAVE · ${this.wave + 1}/${W.length}` : `WAVE ${this.wave + 1}/${W.length}`, 'warn');
        this.run.sink.sfx('warning');
      }
    } else if (this.waveT >= W[this.wave].duration) {
      if (this.wave >= W.length - 1) {
        this.complete = true;
        return;
      }
      this.lull = true;
      this.waveT = 0;
      this.run.setSpawn(new Set(), 0);
      this.run.sink.message(`WAVE ${this.wave + 1} SURVIVED · BRACE`, 'good');
      this.run.scatterMotes(5);
    }
  }

  objective(): { title: string; detail: string; progress: number } {
    const W = this.spec.waves;
    const total = this.run.level.duration;
    if (this.lull) return { title: `NEXT WAVE ${this.wave + 2}/${W.length}`, detail: `BRACE · ${Math.ceil(LULL - this.waveT)}s`, progress: this.activeT / total };
    const w = W[this.wave];
    return { title: `SURVIVE WAVE ${this.wave + 1}/${W.length}`, detail: `${Math.ceil(Math.max(0, w.duration - this.waveT))}s`, progress: this.activeT / total };
  }
}

// ------------------------------------------------------------------ precision

class PrecisionMission extends Mission {
  protected tick(): void {
    if (!this.complete && this.nextGate >= this.gates.length) {
      this.complete = true;
      this.run.sink.message('ALL GATES CLEARED', 'good');
    }
  }

  objective(): { title: string; detail: string; progress: number } {
    const g = this.gates[this.nextGate];
    const n = this.gates.length;
    if (!g) return { title: 'GATES CLEARED', detail: '', progress: 1 };
    let detail = 'KEEP GOING';
    if (g.aligned) detail = 'ON LINE';
    else if (!Number.isNaN(g.predR)) {
      const d = Math.round(g.r - g.predR);
      detail = d > 0 ? `RAISE ORBIT +${d}` : `LOWER ORBIT ${d}`;
    }
    return { title: `GATE ${this.nextGate + 1}/${n}`, detail, progress: this.nextGate / n };
  }
}

// ------------------------------------------------------------------ docking (extraction + neutron nodes)

/**
 * Velocity of a target relative to the ship as seen from the target's own rotating orbit. A ship
 * sharing the target's orbit a little behind it reads ~0 here, even though in the fixed frame
 * their velocity vectors point in slightly different directions.
 */
export function relOrbitVelocity(run: Run, tg: TargetRt): { x: number; y: number } {
  const s = run.ship;
  const dx = tg.x - s.x;
  const dy = tg.y - s.y;
  const w = tg.anchor.omega;
  return { x: tg.vx - s.vx + w * dy, y: tg.vy - s.vy - w * dx };
}

/** Rendezvous speed below which a tractor beam can lock on. */
export const LOCK_SPEED = 34;

/** True when the ship is close enough, and slow enough relative to the target, for a tractor lock. */
export function canLock(run: Run, tg: TargetRt, captureR: number): boolean {
  if (distTo(run, tg.x, tg.y) > captureR) return false;
  const rv = relOrbitVelocity(run, tg);
  return Math.hypot(rv.x, rv.y) < LOCK_SPEED * run.mods.tractorMul;
}

/**
 * Tractor lock: hold the ship co-rotating with a target on its orbit and draw it in. A plain
 * spring towards the target would be wrong here - pulling a ship that sits below a target
 * backwards lowers its orbit and opens the gap - so the beam matches the orbit instead.
 */
function dockPull(run: Run, tg: TargetRt, strength: number, out: { x: number; y: number }): void {
  const s = run.ship;
  // Hold a true circular orbit at the ship's own radius (so letting go leaves a clean orbit), and
  // drift it in radius and in phase towards the target.
  const r = Math.hypot(s.x, s.y) || 1;
  const ux = s.x / r;
  const uy = s.y / r;
  const dir = Math.sign(tg.anchor.omega) || 1;
  const vc = Math.sqrt((run.level.orbitMu * run.mission.muScale) / r) * dir;
  const dPhase = wrapAngle(Math.atan2(tg.y, tg.x) - Math.atan2(s.y, s.x));
  const vt = vc + 0.8 * dPhase * r;
  const vr = 0.8 * (Math.hypot(tg.x, tg.y) - r);
  const tvx = -uy * vt + ux * vr;
  const tvy = ux * vt + uy * vr;
  let ax = (tvx - s.vx) * 4;
  let ay = (tvy - s.vy) * 4;
  const am = Math.hypot(ax, ay);
  const cap = strength * run.mods.tractorMul;
  if (am > cap) {
    ax = (ax / am) * cap;
    ay = (ay / am) * cap;
  }
  out.x += ax;
  out.y += ay;
}

class ExtractionMission extends Mission {
  private startEnergy = 0;
  private revealed = false;

  protected onSetup(): void {
    this.startEnergy = this.run.energy;
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
  }

  private get collected(): number {
    return this.run.energy - this.startEnergy;
  }

  protected tick(dt: number, active: boolean): void {
    if (!active || this.complete) return;
    const run = this.run;
    const q = this.spec.params.quota;
    if (this.collected >= q * 1.5 && !this.targets[0].done) this.bonusDone.add('quota');
    const dock = this.targets[0];
    if (!this.revealed && this.collected >= q) {
      this.revealed = true;
      dock.hidden = false;
      run.sink.message('QUOTA MET · EXTRACTION DOCK ON ORBIT', 'good');
      run.sink.sfx('upgrade');
      run.rings.push({ x: dock.x, y: dock.y, r: 4, maxR: 40, t: 0, dur: 0.7, color: PALETTE.violet });
    }
    if (!this.revealed) return;
    if (canLock(run, dock, this.spec.params.captureR)) {
      dock.sync += (dt * run.mods.tractorMul) / this.spec.params.syncTime;
      this.alert = `TRACTOR LOCK · DOCKING ${pct(dock.sync)}`;
      if (dock.sync >= 1) {
        dock.done = true;
        this.complete = true;
        run.sink.sfx('dock');
        run.sink.message('DOCKED · ENERGY EXTRACTED', 'good');
      }
    } else dock.sync = Math.max(0, dock.sync - dt * 0.5);
  }

  protected tractor(out: { x: number; y: number }): void {
    const dock = this.targets[0];
    if (!this.revealed || dock.done) return;
    if (canLock(this.run, dock, this.spec.params.captureR)) dockPull(this.run, dock, 90, out);
  }

  objective(): { title: string; detail: string; progress: number } {
    const q = this.spec.params.quota;
    if (!this.revealed) return { title: 'HARVEST ENERGY', detail: `${Math.min(q, this.collected)}/${q}`, progress: (0.75 * this.collected) / q };
    const dock = this.targets[0];
    const rv = relOrbitVelocity(this.run, dock);
    const rel = Math.round(Math.hypot(rv.x, rv.y));
    return {
      title: 'MATCH ORBIT WITH THE DOCK',
      detail: dock.sync > 0 ? `DOCKING ${pct(dock.sync)}` : `RANGE ${Math.round(distTo(this.run, dock.x, dock.y))} · REL ${rel}`,
      progress: 0.75 + 0.25 * dock.sync,
    };
  }
}

// ------------------------------------------------------------------ travel missions

/** Missions won by reaching targets[0]. */
abstract class ReachMission extends Mission {
  protected d0 = 1;

  protected onSetup(): void {
    const tg = this.targets[0];
    this.d0 = Math.max(1, distTo(this.run, tg.x, tg.y));
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
  }

  protected reached(): boolean {
    const tg = this.targets[0];
    return distTo(this.run, tg.x, tg.y) < tg.r;
  }

  protected reachDetail(): string {
    const tg = this.targets[0];
    return `DIST ${Math.round(distTo(this.run, tg.x, tg.y))}${tg.aligned ? ' · ON COURSE' : ''}`;
  }

  protected reachProgress(): number {
    const tg = this.targets[0];
    return 1 - distTo(this.run, tg.x, tg.y) / this.d0;
  }

  protected finishReach(text: string): void {
    this.complete = true;
    this.targets[0].done = true;
    this.run.sink.sfx('gate');
    this.run.sink.message(text, 'good');
  }
}

class AsteroidRunMission extends ReachMission {
  protected onSetup(): void {
    super.onSetup();
    const run = this.run;
    const mu = run.level.orbitMu;
    for (const b of this.spec.rockBelts) {
      const v = Math.sqrt(mu / b.radius) * b.dir;
      for (let i = 0; i < b.count; i++) {
        const a = (i / b.count) * TAU + run.rng.range(-0.04, 0.04);
        // Leave the gaps empty: the whole puzzle is meeting a gap as you cross the belt.
        if (b.gaps.some((g) => Math.abs(((a - g.angle + Math.PI * 3) % TAU) - Math.PI) < g.width / 2)) continue;
        const r = b.radius + run.rng.range(-1, 1);
        const wa = run.frameAngle + a;
        const size: 0 | 1 = run.rng.chance(0.35 * b.large) ? 1 : 0;
        const h = run.spawnHazard('asteroid', size, Math.cos(wa) * r, Math.sin(wa) * r, -Math.sin(wa) * v, Math.cos(wa) * v, 1);
        h.orbiting = true;
        h.entered = true;
      }
    }
  }

  protected tick(_dt: number, active: boolean): void {
    if (active && !this.complete && this.reached()) this.finishReach('JUMP GATE REACHED');
  }

  objective(): { title: string; detail: string; progress: number } {
    return { title: 'REACH THE JUMP GATE', detail: this.reachDetail(), progress: this.reachProgress() };
  }
}

class SlingshotMission extends ReachMission {
  /** Orbital energy when the ship entered each planet's sphere of influence (NaN = outside). */
  private entry: number[] = [];

  private energyNow(): number {
    const run = this.run;
    const s = run.ship;
    const r = Math.hypot(s.x - run.bx, s.y - run.by);
    return (s.vx * s.vx + s.vy * s.vy) / 2 - run.attractors[0].mu / r;
  }

  protected tick(_dt: number, active: boolean): void {
    const run = this.run;
    const L = run.level;
    if (!active || this.complete) return;
    for (let i = 0; i < L.companions.length; i++) {
      const m = run.attractors[i + 1];
      if (!m) continue;
      const zone = L.companions[i].radius * 5.5;
      const inside = distTo(run, m.x, m.y) < zone;
      const was = !Number.isNaN(this.entry[i] ?? NaN);
      if (inside && !was) this.entry[i] = this.energyNow();
      else if (!inside && was) {
        const e0 = this.entry[i];
        const gain = (this.energyNow() - e0) / Math.abs(e0);
        this.entry[i] = NaN;
        if (gain > 0.06) {
          this.assisted = true;
          const p = Math.round(gain * 100);
          run.sink.message(`GRAVITY ASSIST · +${p}% ORBITAL ENERGY`, 'good');
          run.sink.sfx('upgrade');
          run.score += 250 + 10 * p;
          run.addText(run.ship.x, run.ship.y - 12, `SLINGSHOT +${p}%`, PALETTE.amber);
        } else if (gain < -0.06) {
          run.sink.message(`BRAKING PASS · ${Math.round(gain * 100)}% ENERGY`, 'warn');
        }
      }
      if (inside) this.alert = 'IN THE PLANET\'S GRIP';
    }
    if (this.reached()) this.finishReach('BEACON REACHED');
  }

  objective(): { title: string; detail: string; progress: number } {
    return { title: 'REACH THE BEACON', detail: this.reachDetail(), progress: this.reachProgress() };
  }
}

class EventHorizonMission extends Mission {
  private startR = 1;
  private hint = 0;

  protected onSetup(): void {
    const s = this.run.ship;
    this.startR = Math.hypot(s.x, s.y);
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
  }

  protected tick(dt: number, active: boolean): void {
    const run = this.run;
    if (!active || this.complete) return;
    // The hole is feeding: its mass - and with it the horizon and the accretion disk - keep growing.
    this.muScale = Math.min(3, this.muScale + this.spec.params.growth * dt);
    this.bodyScale = 1 + (this.muScale - 1) * 0.8;
    const s = run.ship;
    const r = Math.hypot(s.x, s.y);
    if (r > this.spec.params.escapeR) {
      this.complete = true;
      run.sink.message('ESCAPED THE WELL', 'good');
      run.sink.sfx('gate');
      return;
    }
    // Teach the Oberth effect: the same burn buys the most orbital energy where you move fastest.
    const info = orbitInfo(s.x, s.y, s.vx, s.vy, run.attractors[0].mu);
    this.hint = Math.max(0, this.hint - dt);
    if (!info.escaping && info.ecc > 0.08 && Math.abs(info.vRadial) < 0.12 * info.speed && r < (info.peri + info.apo) / 2) {
      this.alert = this.fuel > 0 ? 'PERIAPSIS · BURN HERE' : 'PERIAPSIS';
      if (this.hint <= 0 && s.thrust > 0) {
        this.hint = 6;
        run.note('oberth', 'OBERTH EFFECT · BURNS COUNT MOST AT PERIAPSIS', 'info');
      }
    }
  }

  rings(): [number, string, string][] {
    return [[this.spec.params.escapeR, PALETTE.green, 'ESCAPE']];
  }

  pointer(): { x: number; y: number; color: string } | null {
    return null;
  }

  objective(): { title: string; detail: string; progress: number } {
    const run = this.run;
    const s = run.ship;
    const r = Math.hypot(s.x, s.y);
    const info = orbitInfo(s.x, s.y, s.vx, s.vy, run.attractors[0].mu);
    const apo = info.escaping ? Infinity : info.apo;
    const reach = Math.max(r, Math.min(apo, this.spec.params.escapeR));
    const esc = this.spec.params.escapeR;
    return {
      title: 'CLIMB OUT OF THE WELL',
      detail: `ALT ${Math.round(r)}/${esc} · APO ${Number.isFinite(apo) ? Math.round(apo) : 'ESC'}`,
      progress: (reach - this.startR) / (esc - this.startR),
    };
  }
}

class NebulaMission extends ReachMission {
  private nextSurge = 0;

  protected onSetup(): void {
    super.onSetup();
    // The first surge lands early, while the climb through the gas is under way.
    this.nextSurge = 2.5;
  }

  protected tick(dt: number, active: boolean): void {
    if (!active || this.complete) return;
    const run = this.run;
    if (this.invertT <= 0 && this.invertCharge <= 0) {
      this.nextSurge -= dt;
      if (this.nextSurge <= 0) {
        this.invertCharge = 1.4;
        this.nextSurge = this.spec.params.surgeEvery * run.rng.range(0.8, 1.2);
        run.sink.message('ION SURGE INBOUND · CONTROLS WILL INVERT', 'warn');
        run.sink.sfx('warning');
      }
    }
    if (this.reached()) this.finishReach('THROUGH THE NEBULA');
  }

  objective(): { title: string; detail: string; progress: number } {
    const s = this.run.ship;
    // Still on the starting orbit: count down to the main corridor's mouth, where the climb begins.
    if (Math.hypot(s.x, s.y) < this.spec.startR + 10) {
      const ahead = ((this.spec.params.mouth - this.shipAngle()) % TAU + TAU) % TAU;
      const deg = Math.round((ahead * 180) / Math.PI);
      const detail = deg < 12 || deg > 352 ? 'MAIN CORRIDOR · BURN NOW' : `MAIN CORRIDOR IN ${deg}°`;
      return { title: 'REACH THE EXIT BEACON', detail, progress: this.reachProgress() };
    }
    return { title: 'REACH THE EXIT BEACON', detail: this.reachDetail(), progress: this.reachProgress() };
  }
}

// ------------------------------------------------------------------ pursuit

class PursuitMission extends Mission {
  private charge = 0;
  private spawned = false;
  private killed = false;

  protected onSetup(): void {
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
    for (const p of this.pickups) if (p.kind !== 'shard') p.respawn = 15;
  }

  private get hunter(): Enemy | undefined {
    return this.enemies[0];
  }

  protected tick(dt: number, active: boolean): void {
    const run = this.run;
    if (!active || this.complete) return;
    if (!this.spawned && this.activeT > 1.2) {
      this.spawned = true;
      const s = run.ship;
      const r = Math.min(this.spec.arena - 40, Math.hypot(s.x, s.y) + 120);
      this.spawnEnemy('hunter', this.spec.params.enemyHp, r, this.shipAngle() + Math.PI);
      run.sink.message('HOSTILE CRAFT INBOUND', 'danger');
      run.sink.sfx('alarm');
    }
    const h = this.hunter;
    if (this.spawned && !h && !this.killed) {
      this.killed = true;
      this.bonusDone.add('kill');
      this.complete = true;
      run.sink.message('HUNTER DESTROYED · JUMPING', 'good');
      return;
    }
    if (!h) return;
    const d = distTo(run, h.x, h.y);
    const far = d > this.spec.params.fastRange;
    this.charge += (dt * (far ? 2 : 1)) / this.spec.params.chargeTime;
    if (h.telegraph > 0) this.alert = 'LOCK ON';
    if (this.charge >= 1) {
      this.complete = true;
      run.sink.message('JUMP DRIVE CHARGED · ESCAPED', 'good');
      run.sink.sfx('gate');
    }
  }

  objective(): { title: string; detail: string; progress: number } {
    const h = this.hunter;
    if (!h) return { title: 'JUMP DRIVE CHARGING', detail: this.spawned ? 'HUNTER DOWN' : 'CONTACT...', progress: this.charge };
    const d = distTo(this.run, h.x, h.y);
    const far = d > this.spec.params.fastRange;
    return {
      title: 'JUMP DRIVE CHARGING',
      detail: `${pct(this.charge)} · ${far ? 'OUT OF RANGE x2' : `HUNTER ${Math.round(d)}`} · HP ${h.hp}/${h.hpMax}`,
      progress: this.charge,
    };
  }
}

// ------------------------------------------------------------------ bosses

class NeutronBoss extends Mission {
  private phase = 0;
  private waveTimer = 4;
  private respite = 0;
  private queued = 0;
  private pullNext = false;
  private finished = false;

  protected onSetup(): void {
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
    for (const p of this.pickups) p.respawn = 16;
    this.revealPhase();
    this.updateBoss();
  }

  private revealPhase(): void {
    for (const t of this.targets) t.hidden = t.phase !== this.phase;
  }

  private get nodes(): TargetRt[] {
    return this.targets.filter((t) => t.phase === this.phase);
  }

  private updateBoss(): void {
    const nodes = this.nodes;
    const done = nodes.filter((n) => n.done).length;
    const within = nodes.reduce((s, n) => s + (n.done ? 1 : n.sync), 0) / Math.max(1, nodes.length);
    this.boss = {
      name: this.spec.title,
      phase: Math.min(3, this.phase + 1),
      phases: 3,
      hp: 1 - (this.phase + within) / 3,
      status: this.finished ? 'COLLAPSED' : `NODES ${done}/${nodes.length}`,
    };
  }

  protected tick(dt: number, active: boolean): void {
    const run = this.run;
    this.updateBoss();
    if (!active || this.complete) return;
    if (this.respite > 0) this.respite -= dt;
    // Node synchronisation.
    for (const n of this.nodes) {
      if (n.done) continue;
      if (canLock(run, n, this.spec.params.captureR)) {
        n.sync += (dt * run.mods.tractorMul) / this.spec.params.syncTime;
        this.alert = `TRACTOR LOCK · SYNC ${pct(n.sync)}`;
        if (n.sync >= 1) {
          n.done = true;
          run.sink.sfx('dock');
          run.sink.message('NODE SYNCHRONISED', 'good');
          run.rings.push({ x: n.x, y: n.y, r: 4, maxR: 34, t: 0, dur: 0.6, color: PALETTE.cyan });
        }
      } else n.sync = Math.max(0, n.sync - dt * 0.35);
    }
    if (this.nodes.every((n) => n.done)) this.advancePhase();
    if (this.complete) return;

    // Attack pattern: gravitational waves, harder and stranger every phase.
    const every = this.spec.params.waveEvery * [1, 0.85, 0.75][this.phase];
    if (this.queued > 0) {
      this.queued -= dt;
      if (this.queued <= 0 && run.waveCharge <= 0) run.launchWave(-1, 1.2);
    }
    if (this.respite <= 0 && run.waveCharge <= 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.waveTimer = every;
        if (this.phase === 0) run.launchWave(1, 1);
        else if (this.phase === 1) {
          run.launchWave(this.pullNext ? -1 : 1, 1.15);
          this.pullNext = !this.pullNext;
        } else {
          run.launchWave(1, 1.3);
          this.queued = 1.9;
        }
        run.note('nwave', this.phase === 0 ? 'GRAVITATIONAL WAVE · HOLD YOUR ORBIT' : 'PULL WAVES · THEY DRAG YOU INWARD', 'warn');
      }
    }
  }

  private advancePhase(): void {
    const run = this.run;
    this.phase++;
    run.clearHazards();
    run.flash = 0.8;
    run.shake = 8;
    run.sink.sfx('bosshit');
    run.rings.push({ x: run.bx, y: run.by, r: 4, maxR: 220, t: 0, dur: 1.1, color: PALETTE.cyan });
    if (this.phase >= 3) {
      this.finished = true;
      this.complete = true;
      run.explodeAt(run.bx, run.by, ['#ffffff', '#7ffcff', '#3ef2ff'], 90);
      run.sink.message('THE NEUTRON CORE COLLAPSES', 'upgrade');
      return;
    }
    run.sink.message(`CORE DESTABILISED · PHASE ${this.phase + 1}/3`, 'upgrade');
    this.respite = 3;
    this.waveTimer = 2;
    this.revealPhase();
    run.setSpawn(new Set(run.level.modifiers), this.spec.ambient * (1 + 0.4 * this.phase));
    if (this.phase === 2 && run.beam) run.beam.angularSpeed *= 1.35;
  }

  protected tractor(out: { x: number; y: number }): void {
    for (const n of this.nodes) {
      if (!n.done && canLock(this.run, n, this.spec.params.captureR)) dockPull(this.run, n, 80, out);
    }
  }

  objective(): { title: string; detail: string; progress: number } {
    const nodes = this.nodes;
    const open = nodes.filter((n) => !n.done);
    if (open.length === 0) return { title: 'CORE COLLAPSING', detail: '', progress: 1 };
    const near = open.reduce((a, b) => (distTo(this.run, a.x, a.y) < distTo(this.run, b.x, b.y) ? a : b));
    const rv = relOrbitVelocity(this.run, near);
    const rel = Math.round(Math.hypot(rv.x, rv.y));
    return {
      title: 'SYNCHRONISE THE STABILISER NODES',
      detail: near.sync > 0 ? `SYNC ${pct(near.sync)}` : `NODE ${Math.round(distTo(this.run, near.x, near.y))} · REL ${rel}`,
      progress: (this.phase + nodes.filter((n) => n.done).length / nodes.length) / 3,
    };
  }
}

class DevourerBoss extends Mission {
  private hp = 3;
  private mass = 1;
  private carrying = false;
  private surgeCharge = 0;
  private surgeT = 0;
  private nextSurge = 6;
  /** A released charge falling into the hole. */
  falling: { x: number; y: number; vx: number; vy: number; t: number } | null = null;

  protected onSetup(): void {
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
    for (const p of this.pickups) p.respawn = 16;
    this.spawnCharge();
    this.updateBoss();
  }

  get carryingCharge(): boolean {
    return this.carrying;
  }

  /** Radius the charge has to be carried down to. */
  get deliverR(): number {
    return this.run.heatRadiusNow + 10;
  }

  private spawnCharge(): void {
    const mu = this.run.level.body.mu;
    const r = 215;
    // Released a quarter-turn ahead: reachable with one climb, never sitting right on top of you.
    this.pickups.push({
      kind: 'charge',
      anchor: { r, angle: this.shipAngle() + 1.6 + this.run.rng.range(-0.4, 0.4), omega: Math.sqrt(mu / (r * r * r)) },
      x: 0,
      y: 0,
      taken: false,
      respawn: 0,
      timer: 0,
      bob: 0,
    });
  }

  protected collect(p: PickupRt): void {
    super.collect(p);
    if (p.kind === 'charge') {
      this.carrying = true;
      this.run.sink.message('CHARGE ARMED · CARRY IT DOWN TO THE PHOTON RING', 'upgrade');
      this.run.sink.sfx('upgrade');
    }
  }

  private updateBoss(): void {
    this.boss = {
      name: this.spec.title,
      phase: Math.min(3, 4 - this.hp),
      phases: 3,
      hp: this.hp / 3,
      status: this.surgeT > 0 ? 'GRAVITY SURGE' : `MASS x${this.mass.toFixed(2)}`,
    };
  }

  protected tick(dt: number, active: boolean): void {
    const run = this.run;
    this.updateBoss();
    if (!active || this.complete) return;
    const phase = 3 - this.hp;
    this.mass = Math.min(2.4, this.mass + this.spec.params.growth * (1 + 0.35 * phase) * dt);
    // Gravity surges from the second phase: telegraphed, then the pull swells and eases off again.
    // The swell is smooth, so an orbit that rides it out returns to its old shape; burning hard
    // against it leaves you with too much energy once it passes.
    let surge = 1;
    if (phase >= 1) {
      if (this.surgeT > 0) {
        this.surgeT -= dt;
        const k = 1 - this.surgeT / this.spec.params.surgeTime;
        surge = 1 + 0.4 * Math.sin(Math.PI * clamp(k, 0, 1));
        run.shake = Math.max(run.shake, 1.2);
        this.alert = 'GRAVITY SURGE · RIDE IT OUT';
      } else if (this.surgeCharge > 0) {
        this.surgeCharge -= dt;
        this.alert = 'GRAVITY SURGE INBOUND';
        if (this.surgeCharge <= 0) {
          this.surgeT = this.spec.params.surgeTime;
          run.sink.sfx('wave');
        }
      } else {
        this.nextSurge -= dt;
        if (this.nextSurge <= 0) {
          this.surgeCharge = 1.6;
          this.nextSurge = this.spec.params.surgeEvery * (phase >= 2 ? 0.75 : 1);
          run.sink.sfx('warning');
        }
      }
    }
    this.muScale = this.mass * surge;
    this.bodyScale = 1 + (this.mass - 1) * 0.8;

    const s = run.ship;
    if (this.carrying && Math.hypot(s.x - run.bx, s.y - run.by) < this.deliverR) {
      this.carrying = false;
      const r = Math.hypot(s.x - run.bx, s.y - run.by) || 1;
      this.falling = { x: s.x, y: s.y, vx: s.vx * 0.4 - ((s.x - run.bx) / r) * 50, vy: s.vy * 0.4 - ((s.y - run.by) / r) * 50, t: 0 };
      run.sink.message('CHARGE RELEASED · NOW CLIMB', 'good');
      run.sink.sfx('boost');
    }
    if (this.carrying && !this.alert) this.alert = `DIVE · ${Math.round(Math.hypot(s.x, s.y))} > ${Math.round(this.deliverR)}`;
    const f = this.falling;
    if (f) {
      f.t += dt;
      eulerStep(f, dt, run.attractors, 1, 0, 0);
      if (Math.random() < 0.8) run.particles.spawn(f.x, f.y, 0, 0, 0.4, '#ff4d5e', 1, 2, P_GLOW, '#ffc94d');
      if (Math.hypot(f.x - run.bx, f.y - run.by) < run.level.body.radius * run.bodyPulse + 2 || f.t > 2.2) this.impact();
    }
  }

  private impact(): void {
    const run = this.run;
    this.falling = null;
    this.hp--;
    // The hole is wounded, not shrunk: a sudden drop in mass would fling every orbit outward.
    run.flash = 0.9;
    run.shake = 9;
    run.sink.sfx('bosshit');
    run.rings.push({ x: run.bx, y: run.by, r: 6, maxR: 260, t: 0, dur: 1.2, color: PALETTE.violet });
    run.explodeAt(run.bx, run.by, ['#ffffff', '#b77dff', '#ffd890'], 60);
    if (this.hp <= 0) {
      this.complete = true;
      this.mass = 1;
      run.sink.message('THE DEVOURER EVAPORATES', 'upgrade');
      return;
    }
    run.sink.message(`DEVOURER DESTABILISED · ${this.hp} CHARGE${this.hp > 1 ? 'S' : ''} TO GO`, 'upgrade');
    run.clearHazards();
    run.setSpawn(new Set(run.level.modifiers), this.spec.ambient * (1 + 0.5 * (3 - this.hp)));
    if (this.hp === 1) run.enableJets();
    this.spawnCharge();
  }

  rings(): [number, string, string][] {
    return this.carrying ? [[this.deliverR, PALETTE.red, 'PHOTON RING']] : [];
  }

  pointer(): { x: number; y: number; color: string } | null {
    if (this.carrying || this.falling) return null;
    return super.pointer();
  }

  objective(): { title: string; detail: string; progress: number } {
    const run = this.run;
    const s = run.ship;
    const progress = (3 - this.hp) / 3;
    if (this.falling) return { title: 'CHARGE FALLING', detail: 'CLIMB AWAY', progress };
    if (this.carrying) return { title: 'DIVE TO THE PHOTON RING', detail: `ALT ${Math.round(Math.hypot(s.x - run.bx, s.y - run.by))} · RING ${Math.round(this.deliverR)}`, progress };
    const c = this.pickups.find((p) => p.kind === 'charge' && !p.taken);
    return { title: 'COLLECT THE CHARGE', detail: c ? `DIST ${Math.round(distTo(run, c.x, c.y))}` : '', progress };
  }
}

class SentinelBoss extends Mission {
  private spawned = false;

  protected onSetup(): void {
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
    for (const p of this.pickups) p.respawn = 14;
    this.updateBoss();
  }

  private get sentinel(): Enemy | undefined {
    return this.enemies[0];
  }

  private updateBoss(): void {
    const e = this.sentinel;
    const hp = e ? e.hp : this.spawned ? 0 : 3;
    const heat = e ? e.heat : 0;
    this.boss = {
      name: this.spec.title,
      phase: Math.min(3, 4 - Math.max(1, hp)),
      phases: 3,
      hp: Math.max(0, (hp - heat) / 3),
      status: !e ? (this.spawned ? 'DESTROYED' : 'INBOUND') : e.stun > 0 ? 'VENTING' : `HEAT ${pct(heat)}`,
    };
  }

  protected tick(dt: number, active: boolean): void {
    const run = this.run;
    this.updateBoss();
    if (!active || this.complete) return;
    if (!this.spawned && this.activeT > 1) {
      this.spawned = true;
      const s = run.ship;
      this.spawnEnemy('sentinel', this.spec.params.enemyHp, Math.min(this.spec.arena - 40, Math.hypot(s.x, s.y) + 110), this.shipAngle() + Math.PI);
      run.sink.message('THE SENTINEL HAS FOUND YOU', 'danger');
      run.sink.sfx('alarm');
    }
    const e = this.sentinel;
    if (this.spawned && !e) {
      this.complete = true;
      run.sink.message('THE SENTINEL IS DESTROYED', 'upgrade');
      return;
    }
    if (!e) return;
    if (e.telegraph > 0) this.alert = 'LOCK ON';
    if (e.stun > 0) return;
    // Phase two: it seeds its wake with mines.
    if (e.hp <= 2) {
      e.mineCd -= dt;
      if (e.mineCd <= 0) {
        e.mineCd = 4.5;
        this.mines.push({ x: e.x, y: e.y, vx: e.vx * 0.85, vy: e.vy * 0.85, state: 'dormant', t: 0 });
      }
    }
    // Phase three: telegraphed dash attacks.
    if (e.hp <= 1 && e.dashT <= 0) {
      const s = run.ship;
      if (e.dashCharge > 0) {
        e.dashCharge -= dt;
        this.alert = 'DASH INCOMING';
        if (e.dashCharge <= 0) {
          const tx = s.x + s.vx * 0.5 - e.x;
          const ty = s.y + s.vy * 0.5 - e.y;
          const d = Math.hypot(tx, ty) || 1;
          e.dashX = tx / d;
          e.dashY = ty / d;
          e.dashT = 0.7;
          run.sink.sfx('boost');
        }
      } else {
        e.dashCd -= dt;
        if (e.dashCd <= 0 && distTo(run, e.x, e.y) < 200) {
          e.dashCd = 6;
          e.dashCharge = 1;
          run.sink.sfx('warning');
        }
      }
    }
  }

  /** It learns: each breached core makes it warier of the corona, so luring it takes deeper dives. */
  protected heatAversion(e: Enemy): number {
    return e.hp >= 3 ? 0 : e.hp === 2 ? 0.35 : 0.6;
  }

  /** Its weakness: armour shrugs off impacts, but heat builds up inside a corona or a flare. */
  protected enemyHeat(e: Enemy, depth: number, dt: number): void {
    const run = this.run;
    let gain = 0;
    if (depth >= 0) gain += (0.6 + 1.6 * depth) / this.spec.params.overheat;
    for (const f of run.flares) {
      const at = f.t - f.telegraph;
      if (at >= 0 && at < f.active && inWedge(e.x - run.bx, e.y - run.by, f.angle, f.halfWidth, f.reach)) gain += 0.9;
    }
    if (gain > 0) {
      e.heat += gain * dt;
      if (Math.random() < 0.6) run.particles.spawn(e.x, e.y, run.fx.range(-30, 30), run.fx.range(-30, 30), 0.4, '#ffc94d', 1, 2, P_GLOW, '#ff4d5e');
    } else e.heat = Math.max(0, e.heat - 0.012 * dt); // Vacuum is a poor radiator: heat lingers between dives.
    if (e.heat >= 1) this.overheat(e);
  }

  private overheat(e: Enemy): void {
    const run = this.run;
    e.heat = 0;
    e.hp--;
    e.stun = 3.5;
    e.flash = 1;
    e.dashT = 0;
    e.dashCharge = 0;
    e.telegraph = 0;
    run.sink.sfx('bosshit');
    run.shake = 8;
    run.flash = 0.5;
    run.explodeAt(e.x, e.y, ['#ffffff', '#ffc94d', '#ff4d5e'], 40);
    run.rings.push({ x: e.x, y: e.y, r: 4, maxR: 60, t: 0, dur: 0.8, color: PALETTE.amber });
    if (e.hp <= 0) {
      this.enemyDestroyed(e);
      return;
    }
    run.sink.message(`SENTINEL OVERHEATED · ${e.hp} CORE${e.hp > 1 ? 'S' : ''} LEFT`, 'upgrade');
    run.clearHazards();
    run.setSpawn(new Set(run.level.modifiers), this.spec.ambient * (1 + 0.4 * (3 - e.hp)));
  }

  damageEnemy(e: Enemy, _amount: number, why: string): void {
    if (e.hitCd > 0 || !e.alive) return;
    e.hitCd = 1;
    e.flash = 0.3;
    // Armoured: impacts only warm it up.
    e.heat = Math.min(0.99, e.heat + (why === 'RAMMED' ? 0.22 : 0.1));
    this.run.addText(e.x, e.y - 12, why === 'RAMMED' ? '+HEAT' : 'DEFLECTED', PALETTE.amber);
    this.run.sink.sfx('collide');
  }

  protected enemyCrashed(e: Enemy): void {
    const run = this.run;
    // Skimming the star scorches it: it loses a core and jumps clear.
    e.heat = 1;
    this.overheat(e);
    if (!e.alive) return;
    const a = Math.atan2(run.ship.y, run.ship.x) + Math.PI;
    const r = 250;
    const v = Math.sqrt(run.level.orbitMu / r);
    e.x = Math.cos(a) * r;
    e.y = Math.sin(a) * r;
    e.vx = -Math.sin(a) * v;
    e.vy = Math.cos(a) * v;
    run.gravityInto(e);
  }

  objective(): { title: string; detail: string; progress: number } {
    const e = this.sentinel;
    if (!e) return { title: this.spawned ? 'SENTINEL DOWN' : 'CONTACT...', detail: '', progress: this.spawned ? 1 : 0 };
    return {
      title: 'LURE IT THROUGH THE CORONA',
      detail: e.stun > 0 ? 'VENTING · KEEP CLEAR' : `SENTINEL HEAT ${pct(e.heat)} · CORES ${e.hp}`,
      progress: (3 - e.hp + e.heat) / 3,
    };
  }
}

/** Generic missions only need the ambient hazard stream configured. */
class AmbientMission extends Mission {
  protected onSetup(): void {
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
  }

  protected tick(): void {}

  objective(): { title: string; detail: string; progress: number } {
    return { title: 'SURVIVE', detail: '', progress: this.activeT / this.run.level.duration };
  }
}

export function createMission(run: Run, spec: MissionSpec): Mission {
  switch (spec.kind) {
    case 'survival':
      return new SurvivalMission(run, spec);
    case 'precision':
      return new PrecisionMission(run, spec);
    case 'extraction':
      return new ExtractionMission(run, spec);
    case 'asteroid_run':
      return new AsteroidRunMission(run, spec);
    case 'slingshot':
      return new SlingshotMission(run, spec);
    case 'event_horizon':
      return new EventHorizonMission(run, spec);
    case 'nebula':
      return new NebulaMission(run, spec);
    case 'pursuit':
      return new PursuitMission(run, spec);
    case 'boss_neutron':
      return new NeutronBoss(run, spec);
    case 'boss_devourer':
      return new DevourerBoss(run, spec);
    case 'boss_sentinel':
      return new SentinelBoss(run, spec);
    default:
      return new AmbientMission(run, spec);
  }
}

export { DevourerBoss };
