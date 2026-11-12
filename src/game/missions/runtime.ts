/**
 * Mission runtime: the live objects a mission adds to a sector and the rules they follow.
 *
 * Everything here runs inside the Run's fixed-timestep simulation and uses the same physics:
 * mines and enemy craft are integrated under the same point-mass gravity as the ship, bolts are
 * ordinary hazards that curve through the gravity well, magnetic regions bend velocity (v x B),
 * wormholes carry momentum through, and tractor beams are just another external acceleration.
 *
 * The base class owns the shared machinery (pickups, gates, clouds, wormholes, fields, mines,
 * enemies, fuel, bonus tracking, ranking). Each mission type in controllers.ts adds its own
 * objective, win condition and HUD.
 */
import { CONFIG, PALETTE } from '../config';
import { clamp, TAU, wrapAngle } from '../math';
import { eulerStep, leapfrogStep } from '../physics';
import { orbitInfo } from '../orbital';
import type { LeapfrogBody } from '../physics';
import { P_GLOW, P_SPARK } from '../particles';
import type { Run } from '../run';
import type {
  Anchor,
  BonusId,
  BossHud,
  CloudSpec,
  MissionDebrief,
  MissionSpec,
  ObjectiveHud,
  PickupKind,
  Rank,
  TargetKind,
} from './types';

export interface GateRt {
  index: number;
  /** Mission-frame angle of the gate. */
  angle: number;
  r: number;
  baseR: number;
  gap: number;
  osc: number;
  oscPeriod: number;
  passed: boolean;
  /** Seconds of "missed" / "passed" flash for rendering. */
  flash: number;
  /** True while the predicted trajectory threads this gate. */
  aligned: boolean;
  /** Radius at which the predicted trajectory crosses the gate's line (NaN if it does not within the preview). */
  predR: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TargetRt {
  kind: TargetKind;
  anchor: Anchor;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hidden: boolean;
  phase: number;
  /** Docking / sync progress 0..1. */
  sync: number;
  done: boolean;
  /** True while the predicted trajectory passes through it. */
  aligned: boolean;
}

export interface PickupRt {
  kind: PickupKind;
  anchor: Anchor;
  x: number;
  y: number;
  taken: boolean;
  /** Seconds until a taken pickup returns (0 = never). */
  respawn: number;
  timer: number;
  bob: number;
}

export interface MineRt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: 'dormant' | 'armed' | 'chasing' | 'dead';
  t: number;
}

export interface WormholeRt {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  anchorA: Anchor;
  anchorB: Anchor;
  spin: number;
}

export interface FieldRt {
  x: number;
  y: number;
  r: number;
  turn: number;
  anchor: Anchor;
}

export interface Buoy {
  x: number;
  y: number;
  alt: boolean;
}

export type EnemyKind = 'hunter' | 'sentinel';

/** A hostile craft: a physics body with engines and a pursuit autopilot. */
export class Enemy implements LeapfrogBody {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  gx = 0;
  gy = 0;
  heading = 0;
  readonly kind: EnemyKind;
  hp: number;
  readonly hpMax: number;
  readonly radius: number;
  alive = true;
  /** Seconds until it is allowed to fire again. */
  fireCd = 2;
  /** Seconds of the visible wind-up before a shot. */
  telegraph = 0;
  /** Seconds left of an overheat stun (sentinel). */
  stun = 0;
  /** 0..1 accumulated heat (sentinel weakness). */
  heat = 0;
  hitCd = 0;
  thrusting = false;
  /** Dash attack: wind-up and burn timers and direction. */
  dashCharge = 0;
  dashT = 0;
  dashX = 0;
  dashY = 0;
  dashCd = 6;
  mineCd = 4;
  /** Seconds this craft has been inside a heat zone (hunters burn up). */
  burn = 0;
  flash = 0;

  constructor(kind: EnemyKind, hp: number) {
    this.kind = kind;
    this.hp = hp;
    this.hpMax = hp;
    this.radius = kind === 'sentinel' ? 8 : 5;
  }
}

/**
 * Velocity on leaving a wormhole. The mouths preserve the *shape* of an orbit rather than raw
 * momentum: the velocity turns with the position around the barycentre and scales with the local
 * circular speed (v ~ 1/sqrt(r)), so a circular orbit in is a circular orbit out, an ellipse stays
 * an ellipse of the same eccentricity. Carrying raw momentum outward would turn every transit into
 * an escape trajectory.
 */
export function wormholeVelocity(fx: number, fy: number, tx: number, ty: number, vx: number, vy: number): { x: number; y: number } {
  const rf = Math.hypot(fx, fy) || 1;
  const rt = Math.hypot(tx, ty) || 1;
  const turn = Math.atan2(ty, tx) - Math.atan2(fy, fx);
  const k = Math.sqrt(rf / rt);
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return { x: (vx * c - vy * s) * k, y: (vx * s + vy * c) * k };
}

/** Distance from point (px, py) to the segment a-b. */
function segmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

const SHARD_COLORS = ['#ffc94d', '#ffffff', '#ff8a3d'];
const PICK_COLORS: Record<PickupKind, string> = {
  shard: PALETTE.amber,
  fuel: PALETTE.orange,
  aegis: PALETTE.cyan,
  repair: PALETTE.green,
  cell: PALETTE.violet,
  charge: '#ff4d5e',
};

export const PICKUP_LABEL: Record<PickupKind, string> = {
  shard: 'SHARD',
  fuel: 'FUEL',
  aegis: 'AEGIS',
  repair: 'REPAIR',
  cell: 'ENERGY CELL',
  charge: 'CHARGE',
};

export abstract class Mission {
  readonly spec: MissionSpec;
  protected readonly run: Run;
  /** Seconds since the sector began (intro included) - drives every rail. */
  t = 0;
  /** Seconds of the active phase. */
  activeT = 0;
  complete = false;
  /** Non-fatal failure (forced jump), '' while none. */
  failure = '';

  gates: GateRt[] = [];
  nextGate = 0;
  targets: TargetRt[] = [];
  pickups: PickupRt[] = [];
  mines: MineRt[] = [];
  clouds: CloudSpec[] = [];
  buoys: Buoy[] = [];
  wormholes: WormholeRt[] = [];
  fields: FieldRt[] = [];
  enemies: Enemy[] = [];

  fuel = 0;
  fuelMax = 0;
  fuelRegen = 0;
  private sinceBurn = 0;
  /** Seconds of temporary aegis shield left. */
  aegisT = 0;
  /** Seconds of inverted controls left, and the warning before it. */
  invertT = 0;
  invertCharge = 0;
  /** Hole growth (event horizon / devourer). */
  bodyScale = 1;
  muScale = 1;
  shards = 0;
  shardsTotal = 0;
  damageTaken = 0;
  gateClips = 0;
  cloudBurns = 0;
  assisted = false;
  inCloud = false;
  alert = '';
  boss: BossHud | null = null;
  protected bonusDone = new Set<BonusId>();
  private wormholeCd = 0;
  private hazardWarp = new Map<number, number>();
  private shipAngPrev = 0;
  private cloudTick = 0;

  constructor(run: Run, spec: MissionSpec) {
    this.run = run;
    this.spec = spec;
  }

  // ------------------------------------------------------------------ frame helpers

  /** World position of an anchor at mission time `t`. */
  protected place(a: Anchor, t: number, out: { x: number; y: number }): void {
    const ang = this.run.frameAngle + a.angle + a.omega * t;
    out.x = Math.cos(ang) * a.r;
    out.y = Math.sin(ang) * a.r;
  }

  /** Ship angle in the mission frame. */
  protected shipAngle(): number {
    const s = this.run.ship;
    return Math.atan2(s.y, s.x) - this.run.frameAngle;
  }

  protected frameXY(x: number, y: number): { x: number; y: number } {
    const c = Math.cos(this.run.frameAngle);
    const s = Math.sin(this.run.frameAngle);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  // ------------------------------------------------------------------ setup

  /** Create the live objects once the ship has been placed. */
  setup(): void {
    const S = this.spec;
    const mods = this.run.mods;
    const dry = this.run.modifierOn('dry');
    if (S.fuel > 0 || dry) {
      const base = S.fuel > 0 ? S.fuel * (dry ? 0.8 : 1) : 9;
      this.fuelMax = base * mods.fuelMul;
      this.fuel = this.fuelMax;
      this.fuelRegen = S.fuel > 0 ? S.fuelRegen : 0.3;
    }
    this.gates = S.gates.map((g, index) => ({
      index,
      angle: g.anchor.angle,
      r: g.anchor.r,
      baseR: g.anchor.r,
      gap: g.gap,
      osc: g.osc,
      oscPeriod: g.oscPeriod,
      passed: false,
      flash: 0,
      aligned: false,
      predR: NaN,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
    }));
    this.targets = S.targets.map((t) => ({ kind: t.kind, anchor: t.anchor, r: t.r, x: 0, y: 0, vx: 0, vy: 0, hidden: t.hidden, phase: t.phase ?? 0, sync: 0, done: false, aligned: false }));
    this.pickups = S.pickups.map((p) => ({ kind: p.kind, anchor: p.anchor, x: 0, y: 0, taken: false, respawn: 0, timer: 0, bob: Math.random() * TAU }));
    this.shardsTotal = this.pickups.filter((p) => p.kind === 'shard').length;
    this.clouds = S.clouds.map((c) => ({ ...this.frameXY(c.x, c.y), r: c.r }));
    this.buoys = S.buoys.map((b) => ({ ...this.frameXY(b.x, b.y), alt: b.alt }));
    this.wormholes = S.wormholes.map((w) => ({ ax: 0, ay: 0, bx: 0, by: 0, r: w.r, anchorA: w.a, anchorB: w.b, spin: 0 }));
    this.fields = S.fields.map((f) => ({ x: 0, y: 0, r: f.r, turn: f.turn, anchor: f.anchor }));
    const tmp = { x: 0, y: 0 };
    const mu = this.run.level.orbitMu;
    for (const m of S.mines) {
      // Mines are released onto real orbits and from then on simply fall like everything else.
      this.place(m.anchor, 0, tmp);
      const r = Math.hypot(tmp.x, tmp.y) || 1;
      const v = Math.sqrt(mu / r) * Math.sign(m.anchor.omega || 1);
      this.mines.push({ x: tmp.x, y: tmp.y, vx: (-tmp.y / r) * v, vy: (tmp.x / r) * v, state: 'dormant', t: 0 });
    }
    this.syncPositions();
    this.shipAngPrev = this.shipAngle();
    // By default the environment's own hazards keep coming, scaled by the mission.
    this.run.setSpawn(new Set(this.run.level.modifiers), S.ambient);
    this.onSetup();
  }

  protected onSetup(): void {}

  // ------------------------------------------------------------------ per step

  /** Advance the mission. `live` = the sector is in its intro or active phase. */
  update(dt: number, active: boolean): void {
    this.t += dt;
    if (active) this.activeT += dt;
    this.alert = '';
    this.syncPositions();
    const run = this.run;
    const s = run.ship;
    if (this.aegisT > 0) this.aegisT -= dt;
    if (this.wormholeCd > 0) this.wormholeCd -= dt;
    for (const g of this.gates) if (g.flash > 0) g.flash -= dt;
    // Fuel trickles back while coasting.
    if (this.fuelMax > 0) {
      if (s.thrust !== 0 || s.lateral !== 0) this.sinceBurn = 0;
      else this.sinceBurn += dt;
      if (this.sinceBurn > 1.2 && this.fuel < this.fuelMax) this.fuel = Math.min(this.fuelMax, this.fuel + this.fuelRegen * dt);
    }
    if (this.invertCharge > 0) {
      this.invertCharge -= dt;
      if (this.invertCharge <= 0) {
        this.invertT = this.spec.params.surgeTime * run.mods.disruptMul;
        run.sink.message('CONTROLS INVERTED', 'danger');
        run.sink.sfx('beam');
        run.shake = Math.max(run.shake, 3);
      }
    }
    if (this.invertT > 0) this.invertT -= dt;

    if (s.visible && (run.phase === 'intro' || run.phase === 'active')) {
      this.updatePickups(dt);
      this.updateWormholes();
      this.updateClouds(dt, active);
      if (run.phase === 'intro' || run.phase === 'active') this.updateGates();
    }
    this.updateMines(dt, active);
    this.updateEnemies(dt, active);
    this.updateFieldsOnHazards(dt);

    this.tick(dt, active);

    if (active && !this.complete && !this.failure && this.spec.window > 0 && this.activeT >= this.spec.window) {
      this.failure = 'JUMP WINDOW CLOSED';
    }
    if (this.fuelMax > 0 && this.fuel <= 0.01 && this.wantsThrust && !this.alert) this.alert = this.fuelRegen > 0 ? 'NO FUEL · COAST TO RECHARGE' : 'NO FUEL · FIND A FUEL CELL';
    if (this.invertT > 0) this.alert = 'CONTROLS INVERTED';
    else if (this.invertCharge > 0) this.alert = 'ION SURGE INBOUND';
  }

  /** Mission-specific logic. */
  protected abstract tick(dt: number, active: boolean): void;

  /** Set when the player held a thrust key this step (for the empty-tank warning). */
  wantsThrust = false;

  /** Radius of a (possibly oscillating) gate at mission time t. */
  gateRadiusAt(g: GateRt, t: number): number {
    return g.baseR + (g.osc > 0 ? g.osc * Math.sin((TAU * t) / g.oscPeriod + g.index) : 0);
  }

  private syncPositions(): void {
    const tmp = { x: 0, y: 0 };
    const t = this.t;
    const fa = this.run.frameAngle;
    for (const g of this.gates) {
      g.r = this.gateRadiusAt(g, t);
      const a = fa + g.angle;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      g.x1 = c * (g.r - g.gap / 2);
      g.y1 = sn * (g.r - g.gap / 2);
      g.x2 = c * (g.r + g.gap / 2);
      g.y2 = sn * (g.r + g.gap / 2);
    }
    for (const tg of this.targets) {
      this.place(tg.anchor, t, tmp);
      tg.x = tmp.x;
      tg.y = tmp.y;
      // Velocity of a point on a circular rail: omega x r.
      tg.vx = -tmp.y * tg.anchor.omega;
      tg.vy = tmp.x * tg.anchor.omega;
    }
    for (const p of this.pickups) {
      this.place(p.anchor, t, tmp);
      p.x = tmp.x;
      p.y = tmp.y;
    }
    for (const w of this.wormholes) {
      this.place(w.anchorA, t, tmp);
      w.ax = tmp.x;
      w.ay = tmp.y;
      this.place(w.anchorB, t, tmp);
      w.bx = tmp.x;
      w.by = tmp.y;
      w.spin += 0.05;
    }
    for (const f of this.fields) {
      this.place(f.anchor, t, tmp);
      f.x = tmp.x;
      f.y = tmp.y;
    }
  }

  // ------------------------------------------------------------------ controls and forces

  /** Thrust the engines can actually deliver this step (fuel, ion surges). */
  filterControls(t: number, lat: number, dt: number): { t: number; lat: number } {
    this.wantsThrust = t !== 0 || lat !== 0;
    if (this.invertT > 0) {
      t = -t;
      lat = -lat;
    }
    if (this.fuelMax > 0 && (t !== 0 || lat !== 0)) {
      const use = (Math.abs(t) + Math.abs(lat) * 0.5) * dt;
      if (this.fuel <= 0) return { t: 0, lat: 0 };
      this.fuel = Math.max(0, this.fuel - use);
    }
    return { t, lat };
  }

  /** Extra acceleration on the ship from mission objects: magnetic fields, clouds, tractors. */
  shipAccel(out: { x: number; y: number }): void {
    out.x = 0;
    out.y = 0;
    const s = this.run.ship;
    for (const f of this.fields) {
      if (Math.hypot(s.x - f.x, s.y - f.y) > f.r) continue;
      // Lorentz force on a charged hull: a = omega x v, which turns the velocity without changing speed.
      const w = f.turn * this.run.mods.magneticMul;
      out.x += -w * s.vy;
      out.y += w * s.vx;
      if (Math.random() < 0.3) this.run.particles.spawn(s.x, s.y, -s.vy * 0.2 * Math.sign(w), s.vx * 0.2 * Math.sign(w), 0.4, f.turn > 0 ? PALETTE.cyan : PALETTE.violet, 1, 2, P_SPARK, PALETTE.blue);
    }
    if (this.inCloud) {
      // Dense ionised gas drags a little - enough to sag the orbit if you linger, not to drop you out of it.
      out.x -= s.vx * 0.05;
      out.y -= s.vy * 0.05;
    }
    this.tractor(out);
  }

  /**
   * Magnetic acceleration at a point for a given velocity (used by the trajectory preview, so a
   * field's bend shows in the predicted path before you fly into it).
   */
  fieldAccel(x: number, y: number, vx: number, vy: number, out: { x: number; y: number }): void {
    out.x = 0;
    out.y = 0;
    for (const f of this.fields) {
      if ((x - f.x) ** 2 + (y - f.y) ** 2 > f.r * f.r) continue;
      const w = f.turn * this.run.mods.magneticMul;
      out.x += -w * vy;
      out.y += w * vx;
    }
  }

  /** Docking tractor (overridden by docking missions). */
  protected tractor(_out: { x: number; y: number }): void {}

  /** Multiplier on body radius for collision and drawing. */
  get bodyMul(): number {
    return this.bodyScale;
  }

  // ------------------------------------------------------------------ shared objects

  private updatePickups(dt: number): void {
    const run = this.run;
    const s = run.ship;
    const reach = run.mods.pickupRadius + 4;
    for (const p of this.pickups) {
      p.bob += dt * 4;
      if (p.taken) {
        if (p.respawn > 0) {
          p.timer -= dt;
          if (p.timer <= 0) {
            p.taken = false;
            // Come back somewhere else on the same orbit.
            p.anchor = { ...p.anchor, angle: p.anchor.angle + run.rng.range(1.5, 4.5) };
          }
        }
        continue;
      }
      if (Math.hypot(s.x - p.x, s.y - p.y) > reach + (p.kind === 'shard' ? 1 : 0)) continue;
      p.taken = true;
      p.timer = p.respawn;
      this.collect(p);
    }
  }

  protected collect(p: PickupRt): void {
    const run = this.run;
    const s = run.ship;
    const col = PICK_COLORS[p.kind];
    run.particles.burst(p.x, p.y, 16, 15, 60, 0.6, [col, '#e8f0ff'], { flags: P_GLOW, baseVx: s.vx * 0.4, baseVy: s.vy * 0.4 });
    run.rings.push({ x: p.x, y: p.y, r: 3, maxR: 22, t: 0, dur: 0.45, color: col });
    run.sink.sfx('pickup');
    switch (p.kind) {
      case 'shard':
        this.shards++;
        run.score += 150;
        run.addText(p.x, p.y - 8, `SHARD ${this.shards}/${this.shardsTotal}`, PALETTE.amber);
        if (this.shards === this.shardsTotal) run.sink.message('ALL SHARDS RECOVERED', 'upgrade');
        break;
      case 'fuel':
        if (this.fuelMax > 0) this.fuel = Math.min(this.fuelMax, this.fuel + Math.max(1, this.fuelMax * 0.45));
        run.addText(p.x, p.y - 8, '+FUEL', PALETTE.orange);
        break;
      case 'aegis':
        this.aegisT = 7;
        run.sink.message('AEGIS SHIELD · 7s · HEAT AND IMPACT PROOF', 'good');
        run.sink.sfx('shield');
        break;
      case 'repair':
        s.hull = Math.min(s.hullMax, s.hull + 22);
        run.addText(p.x, p.y - 8, '+22 HULL', PALETTE.green);
        break;
      case 'cell':
        run.gainEnergy(4, p.x, p.y);
        break;
      case 'charge':
        break;
    }
  }

  private updateWormholes(): void {
    if (this.wormholes.length === 0) return;
    const run = this.run;
    const s = run.ship;
    for (const w of this.wormholes) {
      if (this.wormholeCd <= 0) {
        for (const [fx, fy, tx, ty] of [
          [w.ax, w.ay, w.bx, w.by],
          [w.bx, w.by, w.ax, w.ay],
        ]) {
          if (Math.hypot(s.x - fx, s.y - fy) > w.r) continue;
          const ox = s.x;
          const oy = s.y;
          const v = wormholeVelocity(fx, fy, tx, ty, s.vx, s.vy);
          s.vx = v.x;
          s.vy = v.y;
          const sp = Math.hypot(s.vx, s.vy) || 1;
          s.x = tx + (s.vx / sp) * (w.r + 5);
          s.y = ty + (s.vy / sp) * (w.r + 5);
          s.clearTrail();
          run.refreshGravity();
          this.wormholeCd = 1.2;
          run.flash = Math.max(run.flash, 0.35);
          run.sink.sfx('warp');
          run.rings.push({ x: ox, y: oy, r: 2, maxR: 30, t: 0, dur: 0.5, color: PALETTE.violet });
          run.rings.push({ x: s.x, y: s.y, r: 2, maxR: 30, t: 0, dur: 0.5, color: PALETTE.cyan });
          run.note('wormhole', 'WORMHOLE TRANSIT', 'info');
          break;
        }
      }
      // Loose rock is carried through as well.
      for (const h of run.hazards) {
        if (h.orbiting || !h.alive) continue;
        const cd = this.hazardWarp.get(h.id) ?? 0;
        if (cd > run.simTime) continue;
        for (const [fx, fy, tx, ty] of [
          [w.ax, w.ay, w.bx, w.by],
          [w.bx, w.by, w.ax, w.ay],
        ]) {
          if (Math.hypot(h.x - fx, h.y - fy) >= w.r) continue;
          const v = wormholeVelocity(fx, fy, tx, ty, h.vx, h.vy);
          h.x += tx - fx;
          h.y += ty - fy;
          h.vx = v.x;
          h.vy = v.y;
          this.hazardWarp.set(h.id, run.simTime + 1.5);
          break;
        }
      }
    }
  }

  private updateFieldsOnHazards(dt: number): void {
    if (this.fields.length === 0) return;
    for (const h of this.run.hazards) {
      // Rock is not magnetic; metal debris, plasma and bolts are.
      if (h.kind === 'asteroid' || h.kind === 'ice' || h.kind === 'comet' || h.kind === 'star') continue;
      for (const f of this.fields) {
        if (Math.hypot(h.x - f.x, h.y - f.y) > f.r) continue;
        const a = f.turn * dt;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const vx = h.vx * c - h.vy * sn;
        h.vy = h.vx * sn + h.vy * c;
        h.vx = vx;
      }
    }
  }

  private updateClouds(dt: number, active: boolean): void {
    if (this.clouds.length === 0) return;
    const run = this.run;
    const s = run.ship;
    this.inCloud = false;
    for (const c of this.clouds) {
      if (Math.hypot(s.x - c.x, s.y - c.y) < c.r + s.radius * 0.4) {
        this.inCloud = true;
        break;
      }
    }
    if (!this.inCloud || !active) return;
    run.note('cloud', 'ION BURN · GET OUT OF THE GAS', 'danger');
    this.alert = 'ION BURN';
    if (this.aegisT <= 0 && s.boostT <= 0) {
      this.cloudTick += dt;
      run.burnShip(7 * dt);
      if (this.cloudTick > 0.25) {
        this.cloudTick = 0;
        this.cloudBurns++;
      }
    }
    if (Math.random() < 0.5) run.particles.spawn(s.x, s.y, run.fx.range(-25, 25), run.fx.range(-25, 25), 0.35, '#ff7a9a', 1, 2, P_SPARK, '#ffffff');
  }

  private updateGates(): void {
    if (this.gates.length === 0) return;
    const run = this.run;
    const s = run.ship;
    const ang = this.shipAngle();
    const r = Math.hypot(s.x, s.y);
    // Only the next gate is solid; later gates are holographic previews until their turn comes.
    for (const g of this.gates) {
      if (g.index !== this.nextGate) continue;
      for (const [px, py] of [
        [g.x1, g.y1],
        [g.x2, g.y2],
      ]) {
        // Posts are thin: the opening you see is (nearly) the opening you get.
        if (Math.hypot(s.x - px, s.y - py) < s.radius * 0.7 + 2) {
          if (run.hitShip(12, 'GATE', (s.x - px) * 2, (s.y - py) * 2)) {
            this.gateClips++;
            g.flash = 0.5;
          }
        }
      }
    }
    const g = this.gates[this.nextGate];
    if (!g) return;
    const before = wrapAngle(this.shipAngPrev - g.angle);
    const after = wrapAngle(ang - g.angle);
    this.shipAngPrev = ang;
    if (before < 0 && after >= 0 && after - before < 1) {
      if (Math.abs(r - g.r) < g.gap / 2 - 1) {
        g.passed = true;
        g.flash = 0.6;
        this.nextGate++;
        run.score += 80 + 20 * this.nextGate;
        run.sink.sfx('gate');
        run.addText(s.x, s.y - 10, `GATE ${this.nextGate}/${this.gates.length}`, PALETTE.green);
        run.rings.push({ x: s.x, y: s.y, r: 4, maxR: 24, t: 0, dur: 0.4, color: PALETTE.green });
      } else {
        g.flash = 0.8;
        run.sink.message(r < g.r ? 'GATE MISSED · TOO LOW · COME AROUND' : 'GATE MISSED · TOO HIGH · COME AROUND', 'warn');
      }
    }
  }

  private updateMines(dt: number, active: boolean): void {
    if (this.mines.length === 0) return;
    const run = this.run;
    const s = run.ship;
    for (const m of this.mines) {
      if (m.state === 'dead') continue;
      let ax = 0;
      let ay = 0;
      const dx = s.x - m.x;
      const dy = s.y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      if (m.state === 'dormant') {
        if (active && s.visible && d < 64) {
          m.state = 'armed';
          m.t = 0.85;
          run.sink.sfx('alarm');
          run.note('mine', 'PROXIMITY MINE ARMED', 'warn');
        }
      } else if (m.state === 'armed') {
        m.t -= dt;
        if (m.t <= 0) {
          m.state = 'chasing';
          m.t = 2.6;
        }
      } else {
        m.t -= dt;
        ax = (dx / d) * 75;
        ay = (dy / d) * 75;
        if (m.t <= 0) {
          this.detonate(m, d);
          continue;
        }
      }
      eulerStep(m, dt * run.hazardTimeScale, run.attractors, 1, ax, ay);
      const br = Math.hypot(m.x - run.bx, m.y - run.by);
      if (br < run.level.body.radius * run.bodyPulse + 2) {
        m.state = 'dead';
        continue;
      }
      if (s.visible && active && Math.hypot(s.x - m.x, s.y - m.y) < s.radius + 3.5) {
        if (s.boostT > 0) {
          m.state = 'dead';
          run.score += 60;
          run.addText(m.x, m.y - 8, '+60', PALETTE.cyan);
          run.explodeAt(m.x, m.y, ['#ff4d5e', '#ffc94d', '#e8f0ff'], 14);
        } else this.detonate(m, 0);
      }
    }
  }

  private detonate(m: MineRt, dist: number): void {
    const run = this.run;
    m.state = 'dead';
    run.explodeAt(m.x, m.y, ['#ff4d5e', '#ffc94d', '#e8f0ff'], 22);
    run.rings.push({ x: m.x, y: m.y, r: 2, maxR: 22, t: 0, dur: 0.4, color: PALETTE.red });
    run.sink.sfx('explode');
    if (dist < 22) {
      const s = run.ship;
      const d = Math.hypot(s.x - m.x, s.y - m.y) || 1;
      run.hitShip(20, 'MINE', ((s.x - m.x) / d) * 14, ((s.y - m.y) / d) * 14);
    }
  }

  // ------------------------------------------------------------------ enemy craft

  /** Put a hostile craft on a circular orbit at radius r, mission angle a. */
  protected spawnEnemy(kind: EnemyKind, hp: number, r: number, a: number): Enemy {
    const run = this.run;
    const e = new Enemy(kind, hp);
    const ang = run.frameAngle + a;
    const v = Math.sqrt(run.level.orbitMu / r);
    e.x = Math.cos(ang) * r;
    e.y = Math.sin(ang) * r;
    e.vx = -Math.sin(ang) * v;
    e.vy = Math.cos(ang) * v;
    e.heading = Math.atan2(e.vy, e.vx);
    run.gravityInto(e);
    this.enemies.push(e);
    return e;
  }

  /** Engine acceleration available to an enemy (relative to the ship's own engine). */
  protected enemyThrust(e: Enemy): number {
    return CONFIG.THRUST * this.run.level.thrustScale * this.spec.params.enemyThrust * (e.kind === 'sentinel' ? 1 : 1);
  }

  private updateEnemies(dt: number, active: boolean): void {
    if (this.enemies.length === 0) return;
    const run = this.run;
    const s = run.ship;
    const L = run.level;
    const hdt = dt * run.hazardTimeScale;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.hitCd > 0) e.hitCd -= dt;
      if (e.flash > 0) e.flash -= dt;
      let ax = 0;
      let ay = 0;
      e.thrusting = false;
      const dx = s.x - e.x;
      const dy = s.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const amax = this.enemyThrust(e);
      if (e.stun > 0) {
        e.stun -= dt;
      } else if (e.dashT > 0) {
        e.dashT -= dt;
        ax = e.dashX * amax * 5;
        ay = e.dashY * amax * 5;
        e.thrusting = true;
      } else if (s.visible && active) {
        // Pursuit autopilot: steer towards where the ship will be, matching its velocity on arrival.
        const lead = clamp(dist / 160, 0.2, 1.1);
        let tx = s.x + s.vx * lead;
        let ty = s.y + s.vy * lead;
        // It flies orbits too: rather than cutting straight across the gravity well it goes around.
        const keep = this.keepOut(e) + 20;
        if (segmentDist(run.bx, run.by, e.x, e.y, tx, ty) < keep) {
          const er = Math.hypot(e.x - run.bx, e.y - run.by);
          const ea = Math.atan2(e.y - run.by, e.x - run.bx);
          const dir = Math.sign((e.x - run.bx) * e.vy - (e.y - run.by) * e.vx) || 1;
          const wr = Math.max(keep + 25, Math.min(er, Math.hypot(tx - run.bx, ty - run.by)));
          tx = run.bx + Math.cos(ea + dir * 0.9) * wr;
          ty = run.by + Math.sin(ea + dir * 0.9) * wr;
        }
        ax = 0.6 * (tx - e.x) + 1.5 * (s.vx - e.vx);
        ay = 0.6 * (ty - e.y) + 1.5 * (s.vy - e.vy);
        const am = Math.hypot(ax, ay) || 1;
        if (am > amax) {
          ax = (ax / am) * amax;
          ay = (ay / am) * amax;
        }
        e.thrusting = true;
      }
      // Collision avoidance: if the coasting path dives into the body (or the heat it fears), burn out.
      if (e.stun <= 0 || e.kind === 'sentinel') {
        const la = 1.4;
        const px = e.x + e.vx * la + e.gx * la * la * 0.5;
        const py = e.y + e.vy * la + e.gy * la * la * 0.5;
        const pr = Math.min(Math.hypot(px - run.bx, py - run.by), segmentDist(run.bx, run.by, e.x, e.y, px, py));
        const rx = e.x - run.bx;
        const ry = e.y - run.by;
        const rr = Math.hypot(rx, ry) || 1;
        // Orbital foresight: an orbit whose periapsis dips inside the keep-out radius is corrected
        // early, with a prograde-and-outward burn, before the dive is too fast to stop.
        const info = orbitInfo(rx, ry, e.vx, e.vy, run.attractors[0].mu);
        const vr = (rx * e.vx + ry * e.vy) / rr;
        if (pr < this.keepOut(e) || (!info.escaping && info.peri < this.keepOut(e) && vr < 0)) {
          const sp = Math.hypot(e.vx, e.vy) || 1;
          const ox = (rx / rr) * 0.75 + (e.vx / sp) * 0.65;
          const oy = (ry / rr) * 0.75 + (e.vy / sp) * 0.65;
          const ol = Math.hypot(ox, oy) || 1;
          ax = (ox / ol) * amax * 1.3;
          ay = (oy / ol) * amax * 1.3;
          e.thrusting = true;
        }
        // Moons and planets on rails are avoided the same way.
        for (let i = 0; i < L.companions.length; i++) {
          const m = run.attractors[i + 1];
          if (!m) continue;
          const keep = L.companions[i].radius + e.radius + 14;
          if (segmentDist(m.x, m.y, e.x, e.y, px, py) < keep) {
            const dx2 = e.x - m.x;
            const dy2 = e.y - m.y;
            const dl = Math.hypot(dx2, dy2) || 1;
            ax = (dx2 / dl) * amax * 1.3;
            ay = (dy2 / dl) * amax * 1.3;
            e.thrusting = true;
          }
        }
      }
      leapfrogStep(e, hdt, run.attractors, 1, ax, ay);
      const want = e.thrusting && Math.hypot(ax, ay) > 1 ? Math.atan2(ay, ax) : Math.atan2(e.vy - s.vy * 0, e.vx);
      e.heading += clamp(wrapAngle(want - e.heading), -6 * dt, 6 * dt);
      if (e.thrusting && Math.random() < 0.6) {
        const hx = Math.cos(e.heading);
        const hy = Math.sin(e.heading);
        run.particles.spawn(e.x - hx * e.radius, e.y - hy * e.radius, e.vx * 0.6 - hx * 40, e.vy * 0.6 - hy * 40, 0.3, e.kind === 'sentinel' ? '#ff4d5e' : '#ff8a3d', 1, 2, P_GLOW, '#ffc94d');
      }

      // Weapons.
      if (active && s.visible && e.stun <= 0) {
        if (e.telegraph > 0) {
          e.telegraph -= dt;
          if (e.telegraph <= 0) this.fire(e);
        } else {
          e.fireCd -= dt;
          if (e.fireCd <= 0 && dist < 210) {
            e.telegraph = 0.45;
            e.fireCd = this.spec.params.fireEvery * (0.85 + 0.3 * run.rng.next());
          }
        }
      }

      // The environment does not care whose side you are on.
      const br = Math.hypot(e.x - run.bx, e.y - run.by);
      if (br < L.body.radius * run.bodyPulse + e.radius * 0.5) {
        this.enemyCrashed(e, L.body.kind === 'star' || L.body.kind === 'neutron' ? 'INCINERATED' : 'DESTROYED');
        continue;
      }
      for (let i = 0; i < L.companions.length; i++) {
        const m = run.attractors[i + 1];
        if (m && Math.hypot(e.x - m.x, e.y - m.y) < L.companions[i].radius + e.radius) {
          this.enemyCrashed(e, 'SMASHED');
          break;
        }
      }
      if (!e.alive) continue;
      const depth = run.heatDepthAt(e.x, e.y);
      this.enemyHeat(e, depth, dt);
      for (const h of run.hazards) {
        if (!h.alive || h.offPlane || e.hitCd > 0) continue;
        if (h.kind === 'bolt' && h.age < 0.6) continue;
        if (Math.hypot(h.x - e.x, h.y - e.y) < h.r + e.radius) {
          run.destroyHazard(h, 'env');
          this.damageEnemy(e, 1, 'IMPACT');
        }
      }
      for (const m of this.mines) {
        if (m.state === 'dead' || e.hitCd > 0) continue;
        if (Math.hypot(m.x - e.x, m.y - e.y) < e.radius + 4) {
          this.detonate(m, 99);
          this.damageEnemy(e, 1, 'MINE');
        }
      }
      // Ramming.
      if (active && s.visible && dist < e.radius + s.radius) {
        const nx = dx / dist;
        const ny = dy / dist;
        if (s.boostT > 0) {
          if (e.hitCd <= 0) {
            this.damageEnemy(e, 1, 'RAMMED');
            e.vx -= nx * 30;
            e.vy -= ny * 30;
            s.vx += nx * 8;
            s.vy += ny * 8;
          }
        } else if (run.hitShip(18, 'COLLISION', nx * 22, ny * 22)) {
          e.vx -= nx * 12;
          e.vy -= ny * 12;
        }
      }
    }
    if (this.enemies.some((e) => !e.alive)) this.enemies = this.enemies.filter((e) => e.alive);
  }

  /** How close to the body an enemy is willing to fly. */
  protected keepOut(e: Enemy): number {
    const run = this.run;
    const br = run.level.body.radius * run.bodyPulse;
    const heat = Math.max(0, run.heatRadiusNow - br);
    // The Sentinel trusts its armour and flies tighter - which is exactly what lets a corona catch it.
    const margin = e.kind === 'sentinel' ? br * 1.15 + 3 : br * 1.9 + 6;
    return Math.max(margin, br + heat * this.heatAversion(e));
  }

  /** Fraction of the heat zone an enemy steers clear of (0 = ignores it, 1 = avoids it all). */
  protected heatAversion(e: Enemy): number {
    return e.kind === 'hunter' ? 0.8 : 0;
  }

  /** Heat handling: hunters burn up, the sentinel's weakness is handled by its boss controller. */
  protected enemyHeat(e: Enemy, depth: number, dt: number): void {
    if (depth < 0) {
      e.burn = Math.max(0, e.burn - dt);
      return;
    }
    e.burn += dt;
    if (e.burn > 1.1) {
      e.burn = 0;
      this.damageEnemy(e, 1, 'BURNING');
    }
  }

  protected fire(e: Enemy): void {
    const run = this.run;
    const s = run.ship;
    const speed = this.spec.params.boltSpeed;
    // Aim with lead: solve |d + w t| = speed t for the intercept time (gravity ignored - it curves).
    const dx = s.x - e.x;
    const dy = s.y - e.y;
    const wx = s.vx - e.vx;
    const wy = s.vy - e.vy;
    const a = wx * wx + wy * wy - speed * speed;
    const b = 2 * (dx * wx + dy * wy);
    const c = dx * dx + dy * dy;
    let t = Math.hypot(dx, dy) / speed;
    const disc = b * b - 4 * a * c;
    if (Math.abs(a) > 1e-6 && disc >= 0) {
      const r1 = (-b - Math.sqrt(disc)) / (2 * a);
      const r2 = (-b + Math.sqrt(disc)) / (2 * a);
      const best = Math.min(r1 > 0 ? r1 : Infinity, r2 > 0 ? r2 : Infinity);
      if (Number.isFinite(best)) t = best;
    }
    const aimX = dx + wx * t;
    const aimY = dy + wy * t;
    const base = Math.atan2(aimY, aimX);
    const spread = e.kind === 'sentinel' && e.hp <= 2 ? [-0.22, 0, 0.22] : [0];
    for (const off of spread) {
      const ang = base + off;
      const h = run.spawnHazard('bolt', 0, e.x + Math.cos(ang) * (e.radius + 2), e.y + Math.sin(ang) * (e.radius + 2), e.vx + Math.cos(ang) * speed, e.vy + Math.sin(ang) * speed, 1);
      h.entered = true;
    }
    run.sink.sfx('beam');
  }

  damageEnemy(e: Enemy, amount: number, why: string): void {
    const run = this.run;
    if (e.hitCd > 0 || !e.alive) return;
    e.hitCd = 1;
    e.flash = 0.4;
    e.hp -= amount;
    run.sink.sfx('bosshit');
    run.shake = Math.max(run.shake, 3);
    run.explodeAt(e.x, e.y, ['#ff4d5e', '#ffc94d', '#e8f0ff'], 12);
    run.addText(e.x, e.y - 10, why, PALETTE.amber);
    if (e.hp <= 0) this.enemyDestroyed(e);
  }

  protected enemyCrashed(e: Enemy, how: string): void {
    this.run.addText(e.x, e.y - 10, how, PALETTE.amber);
    e.hp = 0;
    this.enemyDestroyed(e);
  }

  protected enemyDestroyed(e: Enemy): void {
    const run = this.run;
    e.alive = false;
    run.explodeAt(e.x, e.y, ['#ff4d5e', '#ffc94d', '#ffffff', '#ff8a3d'], 50);
    run.rings.push({ x: e.x, y: e.y, r: 2, maxR: 50, t: 0, dur: 0.8, color: PALETTE.amber });
    run.sink.sfx('explode');
    run.shake = Math.max(run.shake, 7);
    run.score += 400;
  }

  // ------------------------------------------------------------------ hooks from the run

  /** Called when the ship loses hull. */
  onDamage(amount: number): void {
    if (this.run.phase === 'active' || this.run.phase === 'intro') this.damageTaken += amount;
  }

  /** Called with the remaining trajectory preview so targets and gates can light up. */
  checkPrediction(traj: Float32Array, count: number, dtStep: number): void {
    const fa = this.run.frameAngle;
    for (const tg of this.targets) tg.aligned = false;
    for (const g of this.gates) {
      g.aligned = false;
      g.predR = NaN;
    }
    const g = this.gates[this.nextGate];
    const tmp = { x: 0, y: 0 };
    let prevA = NaN;
    let gateDone = !g;
    for (let i = 0; i < count; i++) {
      const x = traj[i * 2];
      const y = traj[i * 2 + 1];
      const tf = this.t + (i + 1) * dtStep;
      for (const tg of this.targets) {
        if (tg.hidden || tg.done || tg.aligned) continue;
        this.place(tg.anchor, tf, tmp);
        if (Math.hypot(x - tmp.x, y - tmp.y) < tg.r) tg.aligned = true;
      }
      if (!gateDone && g) {
        const a = wrapAngle(Math.atan2(y, x) - fa - g.angle);
        if (!Number.isNaN(prevA) && prevA < 0 && a >= 0 && a - prevA < 1) {
          // A moving gate is judged where it will be when the ship gets there.
          const gr = this.gateRadiusAt(g, tf);
          g.predR = Math.hypot(x, y) - (gr - g.r);
          g.aligned = Math.abs(Math.hypot(x, y) - gr) < g.gap / 2 - 1;
          gateDone = true;
        }
        prevA = a;
      }
    }
  }

  // ------------------------------------------------------------------ objective, HUD, rank

  abstract objective(): { title: string; detail: string; progress: number };

  /** Where the current objective is (for the off-screen pointer), or null. */
  pointer(): { x: number; y: number; color: string } | null {
    const g = this.gates[this.nextGate];
    if (g) return { x: (g.x1 + g.x2) / 2, y: (g.y1 + g.y2) / 2, color: PALETTE.green };
    for (const t of this.targets) if (!t.hidden && !t.done) return { x: t.x, y: t.y, color: t.kind === 'dock' ? PALETTE.violet : PALETTE.amber };
    const c = this.pickups.find((p) => p.kind === 'charge' && !p.taken);
    if (c) return { x: c.x, y: c.y, color: PALETTE.red };
    const e = this.enemies[0];
    if (e) return { x: e.x, y: e.y, color: PALETTE.red };
    return null;
  }

  /** Radius rings the renderer should draw for this mission: [radius, color, label]. */
  rings(): [number, string, string][] {
    return [];
  }

  protected bonusState(id: BonusId): 0 | 1 | 2 {
    switch (id) {
      case 'nohit':
        return this.damageTaken > 0.5 ? 2 : this.complete ? 1 : 0;
      case 'par':
        return this.activeT > this.spec.par ? 2 : this.complete ? 1 : 0;
      case 'shards':
        return this.shards >= this.shardsTotal && this.shardsTotal > 0 ? 1 : 0;
      case 'clean':
        return this.gateClips > 0 ? 2 : this.complete ? 1 : 0;
      case 'noburn':
        return this.cloudBurns > 0 ? 2 : this.complete ? 1 : 0;
      case 'assist':
        return this.assisted ? 1 : 0;
      case 'fuel':
        return this.complete ? (this.fuel >= this.fuelMax * 0.4 ? 1 : 2) : 0;
      default:
        return this.bonusDone.has(id) ? 1 : 0;
    }
  }

  hud(): ObjectiveHud {
    const o = this.objective();
    return {
      title: o.title,
      detail: o.detail,
      progress: clamp(o.progress, 0, 1),
      timer: this.spec.window > 0 && !this.complete ? Math.max(0, this.spec.window - this.activeT) : -1,
      bonuses: this.spec.bonus.map((b) => ({ label: b.id === 'shards' ? `${b.label} ${this.shards}/${this.shardsTotal}` : b.label, state: this.bonusState(b.id) })),
      shards: this.shards,
      shardsTotal: this.shardsTotal,
      boss: this.boss,
      fuel: this.fuel,
      fuelMax: this.fuelMax,
      alert: this.alert,
    };
  }

  /** Rank and score the finished (or abandoned) sector. */
  debrief(key: number): MissionDebrief {
    const S = this.spec;
    const success = this.complete && !this.failure;
    const bonuses = S.bonus.map((b) => ({ label: b.label, done: this.bonusState(b.id) === 1 }));
    let rank: Rank = '-';
    let pts = 0;
    if (success) {
      pts = 40;
      const n = bonuses.length || 1;
      pts += (45 * bonuses.filter((b) => b.done).length) / n;
      const over = Math.max(0, this.activeT - S.par);
      pts += 15 * Math.max(0, 1 - over / Math.max(10, S.par));
      rank = pts >= 88 ? 'S' : pts >= 70 ? 'A' : pts >= 52 ? 'B' : 'C';
    }
    const mult = { S: 2.2, A: 1.6, B: 1.25, C: 1, '-': 0.3 }[rank];
    const score = Math.round(200 * (1 + 0.25 * (this.run.levelIndex - 1)) * mult * (S.boss ? 1.6 : 1));
    return {
      index: this.run.levelIndex,
      kind: S.kind,
      title: S.title,
      boss: S.boss,
      success,
      failure: this.failure,
      rank,
      time: this.activeT,
      par: S.par,
      damage: Math.round(this.damageTaken),
      bonuses,
      shards: this.shards,
      shardsTotal: this.shardsTotal,
      score,
      key,
    };
  }

  /** Display name of a pickup (for the renderer's legend). */
  static pickupColor(kind: PickupKind): string {
    return PICK_COLORS[kind];
  }

  static shardColors(): string[] {
    return SHARD_COLORS;
  }
}
