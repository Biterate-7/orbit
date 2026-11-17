/**
 * Controllers for the missions added in 2.0: binary star navigation, solar flare avoidance,
 * wormhole traversal, gravitational anomaly, escort, resource extraction, astronomical discovery
 * and system survey.
 *
 * Like the original eight (controllers.ts), each one owns only its objective, win condition,
 * pressure and HUD text; pickups, gates, wormholes, fuel, ranking and the physics all come from the
 * shared runtime.
 */
import { PALETTE } from '../config';
import { clamp, TAU, wrapAngle } from '../math';
import { P_GLOW, P_SPARK } from '../particles';
import type { Run } from '../run';
import { canLock, dockPull, relOrbitVelocity } from './controllers';
import { Mission } from './runtime';
import type { MissionLane, MissionLink, MissionWedge, TargetRt } from './runtime';

const pct = (v: number): string => `${Math.floor(clamp(v, 0, 1) * 100)}%`;
const dist = (run: Run, x: number, y: number): number => Math.hypot(run.ship.x - x, run.ship.y - y);
type Objective = { title: string; detail: string; progress: number };

// ------------------------------------------------------------------ binary star navigation

/**
 * Tidal gates around two stars. The gates breathe with the pair's orbit and the level's
 * mass-transfer stream (LevelMechanics.stream) flares along the stars' axis while you thread them.
 */
export class BinaryNavMission extends Mission {
  protected tick(): void {
    if (!this.complete && this.nextGate >= this.gates.length) {
      this.complete = true;
      this.run.sink.message('RELAY CHAIN COMPLETE', 'good');
    }
  }

  objective(): Objective {
    const g = this.gates[this.nextGate];
    const n = this.gates.length;
    if (!g) return { title: 'GATES CLEARED', detail: '', progress: 1 };
    let detail = 'KEEP GOING';
    if (g.aligned) detail = 'ON LINE';
    else if (!Number.isNaN(g.predR)) {
      const d = Math.round(g.r - g.predR);
      detail = d > 0 ? `RAISE ORBIT +${d}` : `LOWER ORBIT ${d}`;
    }
    return { title: `TIDAL GATE ${this.nextGate + 1}/${n}`, detail, progress: this.nextGate / n };
  }
}

// ------------------------------------------------------------------ solar flare avoidance

/**
 * Superflares irradiate every direction at once - except the cone of shadow behind the shield
 * world. The shadow turns with the planet's (real, Keplerian) orbit, so sheltering is a rendezvous:
 * drop low to catch the shadow up, climb to let it come round, then sit just outside the planet.
 */
export class FlareRunMission extends Mission {
  fired = 0;
  /** Seconds until the next superflare. */
  timer = 0;
  exposed = 0;
  private warned = false;

  protected onSetup(): void {
    // The first flare is timed for when the shadow first comes round to the starting lane.
    const eta = this.shadowEta();
    const synodic = this.spec.params.hold;
    this.timer = Number.isFinite(eta) ? (eta < 9 ? eta + synodic : eta) : this.spec.params.period + 3;
    this.first = this.timer;
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
  }

  private first = 1;

  /**
   * Seconds until the shadow reaches the ship at the rates both are moving right now (0 while
   * sheltered, Infinity if the ship is outrunning it). The shield world is on a lower, faster orbit,
   * so its shadow gains on anything flying above it.
   */
  shadowEta(): number {
    const run = this.run;
    const s = run.ship;
    if (this.inShadow(s.x, s.y)) return 0;
    const c = run.level.companions[0];
    if (!c) return Infinity;
    const rx = s.x - run.bx;
    const ry = s.y - run.by;
    const gain = TAU / c.period - (rx * s.vy - ry * s.vx) / (rx * rx + ry * ry);
    if (gain <= 0.01) return Infinity;
    const behind = (((Math.atan2(ry, rx) - this.shadowAngle()) % TAU) + TAU) % TAU;
    return Math.max(0, behind - this.spec.params.range) / gain;
  }

  /** Direction of the shadow: from the star through the shield world. */
  shadowAngle(): number {
    const p = this.run.attractors[1];
    return p ? Math.atan2(p.y - this.run.by, p.x - this.run.bx) : 0;
  }

  private planetR(): number {
    const p = this.run.attractors[1];
    return p ? Math.hypot(p.x - this.run.bx, p.y - this.run.by) : 0;
  }

  inShadow(x: number, y: number): boolean {
    const rx = x - this.run.bx;
    const ry = y - this.run.by;
    return Math.hypot(rx, ry) > this.planetR() + 2 && Math.abs(wrapAngle(Math.atan2(ry, rx) - this.shadowAngle())) < this.spec.params.range;
  }

  protected tick(dt: number, active: boolean): void {
    if (!active || this.complete) return;
    const run = this.run;
    const s = run.ship;
    this.timer -= dt;
    const safe = this.inShadow(s.x, s.y);
    if (this.timer <= 5) {
      if (!this.warned) {
        this.warned = true;
        run.sink.message('SUPERFLARE BUILDING · GET INTO THE SHADOW', 'danger');
        run.sink.sfx('alarm');
      }
      this.alert = `SUPERFLARE IN ${Math.max(0, Math.ceil(this.timer))}s · ${safe ? 'IN SHADOW' : 'EXPOSED'}`;
      // The corona brightens as the flare builds.
      if (Math.random() < 0.5) {
        const a = Math.random() * TAU;
        const r = run.level.body.radius + 2;
        run.particles.spawn(run.bx + Math.cos(a) * r, run.by + Math.sin(a) * r, Math.cos(a) * 70, Math.sin(a) * 70, 0.5, '#ffe08a', 1, 1, P_GLOW, '#ff8a3d');
      }
    }
    if (this.timer > 0) return;

    // Fire.
    this.fired++;
    this.warned = false;
    this.timer = this.spec.params.period;
    run.flash = Math.max(run.flash, 0.9);
    run.shake = Math.max(run.shake, 5);
    run.sink.sfx('flare');
    run.rings.push({ x: run.bx, y: run.by, r: run.level.body.radius, maxR: run.level.outerLimit, t: 0, dur: 0.55, color: '#ffe08a' });
    run.rings.push({ x: run.bx, y: run.by, r: run.level.body.radius, maxR: run.level.outerLimit * 0.8, t: 0, dur: 0.75, color: '#ff8a3d' });
    if (safe || this.aegisT > 0) {
      run.sink.message(`SHELTERED · ${this.fired}/${this.spec.params.count}`, 'good');
      run.score += 200;
      run.addText(s.x, s.y - 12, 'SHELTERED +200', PALETTE.green);
    } else if (s.visible) {
      this.exposed++;
      run.burnShip(this.spec.params.hp * run.mods.heatMul);
      s.stability = Math.max(0, s.stability - 14);
      run.sink.message('CAUGHT IN THE OPEN · RADIATION BURN', 'danger');
      run.explodeAt(s.x, s.y, ['#ffe08a', '#ff8a3d', '#ffffff'], 14);
    }
    if (this.fired >= this.spec.params.count) {
      this.complete = true;
      if (this.exposed === 0) this.bonusDone.add('feat');
      run.sink.message('THE STAR SETTLES', 'good');
    }
  }

  wedges(): MissionWedge[] {
    const L = this.run.level;
    const c = L.companions[0];
    return [{ x: this.run.bx, y: this.run.by, angle: this.shadowAngle(), halfWidth: this.spec.params.range, r0: this.planetR() + (c?.radius ?? 6), r1: L.outerLimit, color: '#8fd3ff', alpha: this.timer <= 5 ? 0.9 : 0.5, label: 'SHADOW' }];
  }

  pointer(): { x: number; y: number; color: string } | null {
    const a = this.shadowAngle();
    const r = this.planetR() + 18;
    return { x: this.run.bx + Math.cos(a) * r, y: this.run.by + Math.sin(a) * r, color: '#8fd3ff' };
  }

  objective(): Objective {
    const s = this.run.ship;
    const n = this.spec.params.count;
    const eta = this.shadowEta();
    // Two clocks to match: the flare, and the shadow's arrival. Climb to bring the shadow sooner, drop to delay it.
    const where = eta === 0 ? 'SHELTERED' : Math.hypot(s.x, s.y) < this.planetR() + 2 ? 'CLIMB ABOVE THE PLANET' : Number.isFinite(eta) ? `SHADOW IN ${Math.ceil(eta)}s` : 'OUTRUNNING THE SHADOW';
    const span = this.fired === 0 ? this.first : this.spec.params.period;
    return { title: `SUPERFLARE ${Math.min(n, this.fired + 1)}/${n}`, detail: `FLARE IN ${Math.max(0, Math.ceil(this.timer))}s · ${where}`, progress: (this.fired + clamp(1 - this.timer / span, 0, 1)) / n };
  }
}

// ------------------------------------------------------------------ wormhole traversal

/** The beacon sits beyond the tank's reach: the only way up is the chain of wormholes. */
export class WormholeMission extends Mission {
  protected onSetup(): void {
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
  }

  /** How many links of the chain the ship has come through (a decoy, or going back, undoes them). */
  stage = 0;

  protected onTransit(index: number, forward: boolean): void {
    const hops = this.spec.params.count;
    if (index >= hops) {
      this.stage = 0;
      this.run.sink.message('DECOY · DROPPED BACK TO THE START SHELF', 'warn');
    } else this.stage = forward ? index + 1 : index;
  }

  /** The mouth to fly into next, or null once the whole chain is behind the ship. */
  private nextMouth(): { x: number; y: number; r: number; n: number } | null {
    const w = this.stage < this.spec.params.count ? this.wormholes[this.stage] : undefined;
    return w ? { x: w.ax, y: w.ay, r: Math.hypot(w.ax, w.ay), n: this.stage + 1 } : null;
  }

  protected tick(_dt: number, active: boolean): void {
    if (!active || this.complete) return;
    const tg = this.targets[0];
    if (dist(this.run, tg.x, tg.y) < tg.r) {
      this.complete = true;
      tg.done = true;
      this.run.sink.sfx('gate');
      this.run.sink.message('BEACON REACHED · CHAIN COMPLETE', 'good');
    }
  }

  pointer(): { x: number; y: number; color: string } | null {
    const m = this.nextMouth();
    if (m) return { x: m.x, y: m.y, color: PALETTE.violet };
    const tg = this.targets[0];
    return { x: tg.x, y: tg.y, color: PALETTE.amber };
  }

  objective(): Objective {
    const run = this.run;
    const tg = this.targets[0];
    const m = this.nextMouth();
    // Progress by altitude gained: distance to the beacon swings wildly as the orbits turn.
    const r0 = this.spec.startR || run.level.startRadius;
    const progress = clamp((Math.hypot(run.ship.x, run.ship.y) - r0) / Math.max(1, Math.hypot(tg.x, tg.y) - r0), 0, 0.98);
    if (!m) return { title: 'REACH THE BEACON', detail: `DIST ${Math.round(dist(run, tg.x, tg.y))}${tg.aligned ? ' · ON COURSE' : ''}`, progress };
    const dr = Math.round(m.r - Math.hypot(run.ship.x, run.ship.y));
    const trim = Math.abs(dr) <= 3 ? 'ON ITS ORBIT' : dr > 0 ? `RAISE ORBIT +${dr}` : `LOWER ORBIT ${dr}`;
    return { title: `WORMHOLE ${m.n}/${this.spec.params.count}`, detail: `${trim} · DIST ${Math.round(dist(run, m.x, m.y))}`, progress };
  }
}

// ------------------------------------------------------------------ gravitational anomaly

/**
 * The central mass breathes (its pull swells and fades), so every orbit breathes with it, while
 * alternating push and pull waves roll out. The objective is a narrow resonance lane: hold your
 * altitude inside it until it charges, then follow it to wherever it jumps next.
 */
export class AnomalyMission extends Mission {
  lane = 0;
  /** Seconds of charge on the current lane. */
  charge = 0;
  private broken = false;
  private nextWave = 0;
  private sign = 1;
  private inLane = false;

  protected onSetup(): void {
    this.nextWave = this.spec.params.waveEvery * 0.6;
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
  }

  private get lanes_(): number[] {
    return this.spec.params.nodes;
  }

  protected tick(dt: number, active: boolean): void {
    const P = this.spec.params;
    const run = this.run;
    // The mass breathes from the moment the sector opens; it settles once the last lane is charged.
    this.muScale = this.complete ? 1 : 1 + P.growth * Math.sin((TAU * this.t) / P.period);
    if (!active || this.complete) return;
    this.nextWave -= dt;
    if (this.nextWave <= 0) {
      run.launchWave(this.sign, 1);
      run.sink.message(this.sign > 0 ? 'GRAVITY WAVE · PUSH' : 'GRAVITY WAVE · PULL', 'warn');
      this.sign = -this.sign;
      this.nextWave = P.waveEvery;
    }
    const s = run.ship;
    const r = Math.hypot(s.x, s.y);
    const target = this.lanes_[this.lane];
    this.inLane = Math.abs(r - target) <= P.range;
    if (this.inLane) {
      this.charge += dt;
      this.alert = `IN THE LANE · ${pct(this.charge / P.hold)}`;
      if (Math.random() < 0.4) run.particles.spawn(s.x, s.y, -s.vx * 0.1, -s.vy * 0.1, 0.45, '#7dffd8', 1, 2, P_GLOW, '#3ef2ff');
    } else {
      if (this.charge > P.hold * 0.5) this.broken = true;
      this.charge = Math.max(0, this.charge - dt * 0.6);
    }
    if (this.charge >= P.hold) {
      this.lane++;
      this.charge = 0;
      run.score += 120;
      run.sink.sfx('gate');
      run.rings.push({ x: s.x, y: s.y, r: 4, maxR: 30, t: 0, dur: 0.5, color: '#7dffd8' });
      if (this.lane >= this.lanes_.length) {
        this.complete = true;
        this.muScale = 1;
        if (!this.broken) this.bonusDone.add('feat');
        run.sink.message('ANOMALY STABILISED', 'good');
      } else run.sink.message(`LANE ${this.lane}/${this.lanes_.length} CHARGED · THE RESONANCE HAS MOVED`, 'good');
    }
  }

  lanes(): MissionLane[] {
    const P = this.spec.params;
    const out: MissionLane[] = [];
    const cur = this.lanes_[this.lane];
    if (cur !== undefined) out.push({ r0: cur - P.range, r1: cur + P.range, color: '#7dffd8', alpha: this.inLane ? 0.95 : 0.6, label: 'RESONANCE' });
    const next = this.lanes_[this.lane + 1];
    if (next !== undefined) out.push({ r0: next - P.range, r1: next + P.range, color: '#3ef2ff', alpha: 0.18, label: '' });
    return out;
  }

  pointer(): { x: number; y: number; color: string } | null {
    return null;
  }

  objective(): Objective {
    const P = this.spec.params;
    const n = this.lanes_.length;
    if (this.lane >= n) return { title: 'ANOMALY STABILISED', detail: '', progress: 1 };
    const s = this.run.ship;
    const d = Math.round(this.lanes_[this.lane] - Math.hypot(s.x, s.y));
    const detail = this.inLane ? `CHARGING ${pct(this.charge / P.hold)}` : d > 0 ? `RAISE ORBIT +${d}` : `LOWER ORBIT ${d}`;
    return { title: `RESONANCE LANE ${this.lane + 1}/${n}`, detail, progress: (this.lane + clamp(this.charge / P.hold, 0, 1)) / n };
  }
}

// ------------------------------------------------------------------ escort

/**
 * A survey tender crosses the sector on its own orbit and rock is thrown at it. The ship's shield
 * link covers the tender while the two fly close together: every impact it absorbs costs link
 * charge, which only rebuilds in formation. Out of range, or with the link drained, the tender
 * takes the hits itself.
 */
export class EscortMission extends Mission {
  hp = 100;
  /** Shield link charge, 0..1. */
  link = 1;
  transit = 0;
  linked = false;
  private damaged = false;
  private nextRaid = 0;
  private waveDrop = 0;

  protected onSetup(): void {
    this.hp = this.spec.params.hp;
    this.nextRaid = this.spec.params.period + 2;
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
  }

  private get tender(): TargetRt {
    return this.targets[0];
  }

  get linkRange(): number {
    return this.spec.params.range * this.run.mods.m.linkMul;
  }

  /** Throw a rock on a straight intercept course with the tender. */
  private raid(): void {
    const run = this.run;
    const t = this.tender;
    const lead = 2.8;
    const tx = t.x + t.vx * lead;
    const ty = t.y + t.vy * lead;
    // From outside the tender's orbit, so the shot crosses open space rather than the body.
    const out = Math.atan2(t.y, t.x) + run.rng.range(-1.1, 1.1);
    const x = t.x + Math.cos(out) * 150;
    const y = t.y + Math.sin(out) * 150;
    const h = run.spawnHazard('asteroid', run.rng.chance(0.3) ? 1 : 0, x, y, (tx - x) / lead, (ty - y) / lead, 0);
    h.entered = true;
    this.threats.add(h.id);
  }

  private threats = new Set<number>();

  onWave(): void {
    // A gravity wave shakes the link loose for a moment - unless the Bulwark synergy holds it.
    if (!this.run.mods.m.syn.has('bulwark')) this.waveDrop = 1.2;
  }

  protected tick(dt: number, active: boolean): void {
    const run = this.run;
    const P = this.spec.params;
    const t = this.tender;
    t.sync = clamp(this.hp / P.hp, 0, 1);
    if (!active || this.complete || this.failure) return;
    this.transit += dt;
    if (this.waveDrop > 0) this.waveDrop -= dt;
    const d = dist(run, t.x, t.y);
    this.linked = d < this.linkRange && this.waveDrop <= 0 && run.ship.visible;
    this.link = clamp(this.link + dt * (this.linked ? 0.11 * run.mods.m.linkMul : 0.02), 0, 1);

    if (!run.noSpawns) {
      this.nextRaid -= dt;
      if (this.nextRaid <= 0) {
        for (let i = 0; i < P.count; i++) this.raid();
        this.nextRaid = P.period * run.rng.range(0.85, 1.15);
        run.sink.sfx('warning');
      }
    }
    // Anything solid that reaches the tender hits it - raid rock and stray traffic alike.
    for (const h of run.hazards) {
      if (!h.alive || h.offPlane || h.kind === 'bolt') continue;
      if (Math.hypot(h.x - t.x, h.y - t.y) > h.r + 7) continue;
      if (this.linked && this.link >= 0.3) {
        this.link -= 0.3;
        run.rings.push({ x: t.x, y: t.y, r: 5, maxR: 20, t: 0, dur: 0.35, color: PALETTE.cyan });
        run.sink.sfx('shield');
        run.score += 60;
      } else {
        const dmg = (16 + 8 * h.size) * (this.linked && run.mods.m.syn.has('bulwark') ? 0.6 : 1);
        this.hp -= dmg;
        this.damaged = true;
        run.sink.sfx('collide');
        run.shake = Math.max(run.shake, 2);
        run.addText(t.x, t.y - 10, `-${Math.round(dmg)}`, PALETTE.red);
      }
      this.threats.delete(h.id);
      run.destroyHazard(h, 'env');
      h.alive = false;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      t.done = true;
      run.explodeAt(t.x, t.y, ['#8fd3ff', '#ffffff', '#ff8a3d'], 30);
      run.sink.sfx('explode');
      this.failure = 'TENDER LOST';
      return;
    }
    if (!this.linked) this.alert = this.waveDrop > 0 ? 'LINK SHAKEN LOOSE' : `LINK DOWN · CLOSE TO ${Math.round(this.linkRange)}`;
    else if (this.link < 0.3) this.alert = 'LINK DRAINED · HOLD FORMATION';
    if (this.transit >= P.hold) {
      this.complete = true;
      t.done = true;
      if (!this.damaged) this.bonusDone.add('feat');
      run.sink.sfx('warp');
      run.rings.push({ x: t.x, y: t.y, r: 3, maxR: 34, t: 0, dur: 0.6, color: '#8fd3ff' });
      run.sink.message('TENDER AWAY · ESCORT COMPLETE', 'good');
    }
  }

  protected tractor(out: { x: number; y: number }): void {
    // Flying formation: once speeds are matched the link holds the ship on station.
    const t = this.tender;
    if (!t.done && this.linked && canLock(this.run, t, this.linkRange * 0.7)) dockPull(this.run, t, 35, out);
  }

  links(): MissionLink[] {
    const base = super.links();
    const t = this.tender;
    if (this.linked && !t.done) base.push({ x1: this.run.ship.x, y1: this.run.ship.y, x2: t.x, y2: t.y, color: PALETTE.cyan, alpha: 0.35 + 0.6 * this.link, lattice: this.run.mods.m.level.aegislink > 0 });
    return base;
  }

  objective(): Objective {
    const P = this.spec.params;
    const t = this.tender;
    const d = Math.round(dist(this.run, t.x, t.y));
    const state = this.linked ? `LINK ${pct(this.link)}` : `RANGE ${d}/${Math.round(this.linkRange)}`;
    return { title: `ESCORT · TENDER HULL ${pct(this.hp / P.hp)}`, detail: `${state} · JUMP IN ${Math.max(0, Math.ceil(P.hold - this.transit))}s`, progress: this.transit / P.hold };
  }
}

// ------------------------------------------------------------------ resource extraction

/**
 * Ore rocks ride their own orbits around the band. Match orbits with one and the mining laser
 * cuts it; a cut rock breaks up into debris. Any rocks, in any order - the rich veins pay double
 * but sit at the edges of the band, where the heat and the drag are.
 */
export class MiningMission extends Mission {
  loads = 0;
  private cutting: TargetRt | null = null;

  protected onSetup(): void {
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
  }

  private nearest(): TargetRt | null {
    let best: TargetRt | null = null;
    let bd = Infinity;
    for (const t of this.targets) {
      if (t.done) continue;
      const d = dist(this.run, t.x, t.y);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  protected tick(dt: number, active: boolean): void {
    if (!active || this.complete) return;
    const run = this.run;
    const P = this.spec.params;
    const near = this.nearest();
    this.cutting = near && canLock(run, near, P.captureR) ? near : null;
    for (const t of this.targets) {
      if (t.done) continue;
      if (t === this.cutting) {
        t.sync += (dt * run.mods.m.drillMul) / P.hold;
        this.alert = `MINING LASER · ${pct(t.sync)}`;
        if (Math.random() < 0.7) run.particles.spawn(t.x, t.y, run.fx.range(-40, 40), run.fx.range(-40, 40), 0.35, '#ffc94d', 1, 2, P_SPARK, '#ff8a3d');
        if (t.sync >= 1) this.cut(t);
      } else t.sync = Math.max(0, t.sync - dt * 0.4);
    }
    if (this.loads >= P.quota) {
      this.complete = true;
      run.sink.message('HOLD FULL · EXTRACTION COMPLETE', 'good');
    }
  }

  private cut(t: TargetRt): void {
    const run = this.run;
    const s = run.ship;
    t.done = true;
    const loads = (t.rich ? 2 : 1) + (run.mods.m.syn.has('deepvein') ? 1 : 0);
    this.loads += loads;
    this.tally.mined++;
    if (t.rich) this.bonusDone.add('feat');
    run.gainEnergy(t.rich ? 5 : 3, t.x, t.y);
    run.score += t.rich ? 320 : 180;
    run.sink.sfx('dock');
    run.sink.message(`${t.rich ? 'RICH VEIN' : 'ORE'} CUT · ${Math.min(this.loads, this.spec.params.quota)}/${this.spec.params.quota} LOADS`, 'good');
    run.explodeAt(t.x, t.y, ['#e0a060', '#ffc94d', '#7a6d8a'], 16);
    // The rock breaks up: fragments drift off away from the ship and become debris to avoid.
    if (!run.noSpawns) {
      const away = Math.atan2(t.y - s.y, t.x - s.x);
      for (let i = 0; i < 3; i++) {
        const a = away + (i - 1) * 0.9;
        const h = run.spawnHazard('debris', 0, t.x + Math.cos(a) * 6, t.y + Math.sin(a) * 6, t.vx + Math.cos(a) * 16, t.vy + Math.sin(a) * 16, 1);
        h.entered = true;
      }
    }
  }

  protected tractor(out: { x: number; y: number }): void {
    if (this.cutting && !this.cutting.done) dockPull(this.run, this.cutting, 70, out);
  }

  links(): MissionLink[] {
    const base = super.links();
    const t = this.cutting;
    if (t && !t.done) base.push({ x1: this.run.ship.x, y1: this.run.ship.y, x2: t.x, y2: t.y, color: '#ffc94d', alpha: 0.9, lattice: false });
    return base;
  }

  pointer(): { x: number; y: number; color: string } | null {
    const t = this.nearest();
    return t ? { x: t.x, y: t.y, color: t.rich ? PALETTE.amber : '#e0a060' } : null;
  }

  objective(): Objective {
    const q = this.spec.params.quota;
    const t = this.nearest();
    let detail = '';
    if (this.cutting) detail = `CUTTING ${pct(this.cutting.sync)}`;
    else if (t) {
      const rv = relOrbitVelocity(this.run, t);
      detail = `${t.rich ? 'RICH VEIN' : 'ORE ROCK'} · RANGE ${Math.round(dist(this.run, t.x, t.y))} · REL ${Math.round(Math.hypot(rv.x, rv.y))}`;
    }
    return { title: `MINE ORE ${Math.min(q, this.loads)}/${q}`, detail, progress: (this.loads + (this.cutting?.sync ?? 0)) / q };
  }
}

// ------------------------------------------------------------------ astronomical discovery

/**
 * Something unlisted is in the sector and only its signal gives it away: the reading strengthens
 * as the range closes. Inside detection range it resolves; then it has to be held in the scan
 * field until the record is complete. A Deep-Space Scanner extends the detection range and gives a
 * bearing.
 */
export class DiscoveryMission extends Mission {
  found = false;
  /** 0..1 signal strength. */
  strength = 0;
  private lastD = 0;
  private trend = 0;

  protected onSetup(): void {
    this.lastD = dist(this.run, this.targets[0].x, this.targets[0].y);
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
  }

  get range(): number {
    return this.spec.params.range * this.run.mods.m.signalRangeMul;
  }

  /** True when the fitted scanner is good enough to show roughly where the source is. */
  get ghost(): boolean {
    return !this.found && (this.run.mods.m.deepScan >= 2 || this.run.mods.m.syn.has('pathfinder'));
  }

  protected tick(dt: number, active: boolean): void {
    if (!active || this.complete) return;
    const run = this.run;
    const P = this.spec.params;
    const tg = this.targets[0];
    const d = dist(run, tg.x, tg.y);
    this.strength = clamp(1 - (d - this.range) / (this.range * 3.2), 0, 1);
    this.trend += (this.lastD - d - this.trend) * Math.min(1, dt * 3);
    this.lastD = d;
    if (!this.found) {
      if (d < this.range) {
        this.found = true;
        tg.hidden = false;
        this.tally.signals++;
        this.bonusCredits += Math.round(40 * (run.mods.m.syn.has('prospector') ? 1.5 : 1));
        run.score += 400;
        run.sink.sfx('upgrade');
        run.flash = Math.max(run.flash, 0.3);
        run.rings.push({ x: tg.x, y: tg.y, r: 4, maxR: 46, t: 0, dur: 0.8, color: '#fff3a8' });
        run.sink.message('SOURCE RESOLVED · HOLD IT IN THE SCAN FIELD', 'upgrade');
      }
      return;
    }
    if (d < tg.r) {
      const matched = canLock(run, tg, tg.r);
      tg.sync += (dt * (matched ? 1 : 0.5) * run.mods.m.scanMul) / P.hold;
      this.alert = `SCANNING · ${pct(tg.sync)}${matched ? '' : ' · MATCH ITS ORBIT TO SCAN FASTER'}`;
      if (tg.sync >= 1) {
        tg.done = true;
        this.complete = true;
        run.sink.sfx('dock');
        run.sink.message('DISCOVERY LOGGED', 'good');
      }
    } else tg.sync = Math.max(0, tg.sync - dt * 0.03); // what has been recorded is kept; the record just goes stale slowly
  }

  protected tractor(out: { x: number; y: number }): void {
    // Scan lock: once speeds are matched inside the field, the lock holds the ship on station.
    const tg = this.targets[0];
    if (this.found && !tg.done && canLock(this.run, tg, tg.r)) dockPull(this.run, tg, 90, out);
  }

  links(): MissionLink[] {
    const base = super.links();
    const tg = this.targets[0];
    if (this.found && !tg.done && tg.sync > 0 && dist(this.run, tg.x, tg.y) < tg.r) base.push({ x1: this.run.ship.x, y1: this.run.ship.y, x2: tg.x, y2: tg.y, color: '#fff3a8', alpha: 0.8, lattice: false });
    return base;
  }

  pointer(): { x: number; y: number; color: string } | null {
    const tg = this.targets[0];
    // No bearing without a scanner: the reading is all there is.
    if (!this.found && this.run.mods.m.deepScan <= 0) return null;
    return { x: tg.x, y: tg.y, color: '#fff3a8' };
  }

  objective(): Objective {
    const tg = this.targets[0];
    if (!this.found) {
      const t = this.trend > 0.4 ? 'CLOSING' : this.trend < -0.4 ? 'OPENING' : 'STEADY';
      return { title: 'TRACE THE SIGNAL', detail: `SIGNAL ${pct(this.strength)} · ${t}`, progress: 0.5 * this.strength };
    }
    const d = Math.round(dist(this.run, tg.x, tg.y));
    return { title: 'HOLD THE SCAN', detail: d < tg.r ? `SCAN ${pct(tg.sync)}` : `RANGE ${d} · FIELD ${Math.round(tg.r)}`, progress: 0.5 + 0.5 * tg.sync };
  }
}

// ------------------------------------------------------------------ system survey

/**
 * Every survey point rides with a real world of the system. Flying through a world's scan field
 * records it; the closer the pass, the faster the scan - and the harder its gravity pulls.
 */
export class SurveyMission extends Mission {
  private scanning: TargetRt | null = null;

  protected onSetup(): void {
    this.follow();
    this.run.setSpawn(new Set(this.run.level.modifiers), this.spec.ambient);
  }

  /** Pin each survey point to its world (which may be on an eccentric rail). */
  private follow(): void {
    const run = this.run;
    for (const t of this.targets) {
      const a = run.attractors[(t.companion ?? -1) + 1];
      if (!a || t.companion === undefined || t.companion < 0) continue;
      t.x = a.x;
      t.y = a.y;
    }
  }

  private name(t: TargetRt): string | null {
    const label = t.label ?? '';
    if (!label || label.startsWith('UNNAMED')) return null;
    const id = this.run.level.identity;
    return label.length <= 3 && id.systemId ? `${id.objectName} ${label}` : label;
  }

  private get doneCount(): number {
    return this.targets.filter((t) => t.done).length;
  }

  protected tick(dt: number, active: boolean): void {
    this.follow();
    if (!active || this.complete) return;
    const run = this.run;
    const P = this.spec.params;
    this.scanning = null;
    for (const t of this.targets) {
      if (t.done) continue;
      const d = dist(run, t.x, t.y);
      if (d >= t.r) {
        t.sync = Math.max(0, t.sync - dt * 0.15);
        continue;
      }
      const c = run.level.companions[t.companion ?? -1];
      // Twice as fast at point-blank range as at the edge of the field.
      t.sync += (dt * (2 - d / t.r) * run.mods.m.scanMul) / P.hold;
      this.scanning = t;
      this.alert = `SCANNING ${t.label ?? 'WORLD'} · ${pct(t.sync)}`;
      if (c && d < c.radius * 3) this.bonusDone.add('feat');
      if (t.sync >= 1) {
        t.done = true;
        const name = this.name(t);
        if (name) this.tally.surveyed.push(name);
        run.score += 150;
        run.sink.sfx('gate');
        run.rings.push({ x: t.x, y: t.y, r: 4, maxR: 26, t: 0, dur: 0.5, color: '#9fe3ff' });
        run.sink.message(`${t.label ?? 'WORLD'} SURVEYED · ${this.doneCount}/${this.targets.length}`, 'good');
      }
    }
    if (this.doneCount >= this.targets.length) {
      this.complete = true;
      run.sink.message('SURVEY COMPLETE', 'good');
    }
  }

  checkPrediction(traj: Float32Array, count: number, dtStep: number): void {
    super.checkPrediction(traj, count, dtStep);
    // Survey points follow their worlds, not their nominal rails, so the rail-based test does not apply.
    for (const t of this.targets) t.aligned = false;
  }

  links(): MissionLink[] {
    const base = super.links();
    const t = this.scanning;
    if (t && !t.done) base.push({ x1: this.run.ship.x, y1: this.run.ship.y, x2: t.x, y2: t.y, color: '#9fe3ff', alpha: 0.8, lattice: false });
    return base;
  }

  private nearest(): TargetRt | null {
    let best: TargetRt | null = null;
    let bd = Infinity;
    for (const t of this.targets) {
      if (t.done) continue;
      const d = dist(this.run, t.x, t.y);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  pointer(): { x: number; y: number; color: string } | null {
    const t = this.nearest();
    return t ? { x: t.x, y: t.y, color: '#9fe3ff' } : null;
  }

  objective(): Objective {
    const n = this.targets.length;
    const t = this.scanning ?? this.nearest();
    let detail = '';
    if (t) detail = this.scanning ? `SCANNING ${t.label ?? ''} ${pct(t.sync)}` : `${t.label ?? 'WORLD'} · RANGE ${Math.round(dist(this.run, t.x, t.y))} · FIELD ${Math.round(t.r)}`;
    return { title: `SURVEY ${this.doneCount}/${n} WORLDS`, detail, progress: (this.doneCount + (this.scanning?.sync ?? 0)) / n };
  }
}
