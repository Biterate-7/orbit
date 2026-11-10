import { CONFIG, PALETTE } from './config';
import { Rng } from './rng';
import { clamp, easeInCubic, easeOutBack, lerp, TAU } from './math';
import { eulerStep, gravityAt, leapfrogStep } from './physics';
import type { Attractor } from './physics';
import { circularSpeed, evaluateStability, orbitInfo, predictTrajectory } from './orbital';
import { generateLevel, menuLevel } from './levels';
import { P_GLOW, P_GRAVITY, P_SPARK, Particles } from './particles';
import { NO_CONTROLS, Ship } from './player';
import type { Controls } from './player';
import { edgeSpawn, makeHazard } from './hazards';
import { circlesOverlap, closestApproach, hitsBeam, inWedge } from './collision';
import { UPGRADES, UPGRADE_ORDER, computeMods, emptyStacks } from './upgrades';
import type { RunMods, Stacks } from './upgrades';
import type { SaveData } from './persistence';
import type {
  BeamState,
  BodyKind,
  Flare,
  GravityWave,
  Hazard,
  LevelDef,
  MessageTone,
  ModifierKind,
  Mote,
  PermanentId,
  SfxName,
  StabilityReason,
  StormState,
  UpgradeId,
  UpgradeOffer,
} from './types';

export type RunPhase = 'intro' | 'active' | 'clearing' | 'warping' | 'dying' | 'dead';

export interface RunSink {
  sfx(name: SfxName, intensity?: number): void;
  message(text: string, tone: MessageTone): void;
  levelIntro(level: LevelDef): void;
  upgradeReady(): void;
  died(cause: string): void;
}

export interface ShockRing {
  x: number;
  y: number;
  r: number;
  maxR: number;
  t: number;
  dur: number;
  color: string;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
  dur: number;
}

export interface Ghost {
  x: number;
  y: number;
  heading: number;
  t: number;
}

const BODY_DEATH: Record<BodyKind, string> = {
  planet: 'CRASHED INTO THE PLANET',
  redgiant: 'INCINERATED BY THE RED GIANT',
  neutron: 'CRUSHED BY THE NEUTRON STAR',
  blackhole: 'CONSUMED BY THE BLACK HOLE',
  gasgiant: 'SWALLOWED BY THE GAS GIANT',
};

const ROCK_COLORS = ['#b3a8c2', '#7a6d8a', '#4a3f5c', '#ffc94d'];
const DEBRIS_COLORS = ['#c9d3ea', '#8a96b8', '#ff8a3d'];
const COMET_COLORS = ['#e8f0ff', '#7ffcff', '#3ef2ff'];
const SHIP_COLORS = ['#e8f0ff', '#3ef2ff', '#9b5cff', '#ffc94d', '#ff8a3d'];

export interface RunOptions {
  demo: boolean;
  sink: RunSink;
  save?: SaveData;
  sensitivity?: number;
  reducedEffects?: boolean;
  seed?: number;
}

/**
 * A single run: owns the simulation state of the ship, hazards, environment and progression.
 * Everything here is advanced with a fixed timestep by the Engine and is independent of React.
 */
export class Run {
  readonly demo: boolean;
  readonly seed: number;
  private sink: RunSink;
  private rng: Rng;
  private fx: Rng;
  level: LevelDef;
  levelIndex = 1;
  phase: RunPhase = 'intro';
  phaseTime = 0;
  time = 0;
  levelTime = 0;
  simTime = 0;

  readonly ship: Ship;
  hazards: Hazard[] = [];
  motes: Mote[] = [];
  readonly particles: Particles;
  rings: ShockRing[] = [];
  texts: FloatText[] = [];
  ghosts: Ghost[] = [];
  attractors: Attractor[] = [];

  flares: Flare[] = [];
  beam: BeamState | null = null;
  waves: GravityWave[] = [];
  storm: StormState = { state: 'idle', t: 0, dirX: 1, dirY: 0, strength: 0, next: 8 };
  private nextFlare = 5;
  private nextWave = 7;
  waveCharge = 0;
  private waveSeq = 1;
  private nextComet = 8;
  private cometQueue: { delay: number; angle: number }[] = [];
  private nextDebris = 5;
  private nextAsteroid = 1;
  private nextMote = 0.5;
  private flareMessages = 0;
  private debrisMessage = false;
  private waveMessage = false;

  score = 0;
  energy = 0;
  avoided = 0;
  destroyed = 0;
  nearMisses = 0;
  levelsCleared = 0;
  milestonePrev = 0;
  milestoneNext: number = CONFIG.MILESTONE_FIRST;
  private milestoneCount = 0;
  pendingUpgrades = 0;

  stacks: Stacks = emptyStacks();
  mods: RunMods;
  private perm: Record<PermanentId, number>;
  private unlocked: Set<UpgradeId>;
  overdrive = 0;
  temporalT = 0;
  temporalCd = 0;
  combo = 0;
  private comboTimer = 0;
  shake = 0;
  flash = 0;
  hurtFlash = 0;
  stabilityReason: StabilityReason = null;
  stabilityDanger = 0;
  private criticalFlag = false;
  private heatSoundT = 0;
  deathCause = '';
  private deathMode: 'explode' | 'spin' | 'consumed' = 'explode';
  readonly seenMods = new Set<ModifierKind>();
  private sensitivity: number;
  reducedEffects: boolean;

  viewHalfW = 360;
  viewHalfH = 205;

  readonly traj = new Float32Array(2 * 400);
  trajCount = 0;
  trajCrashed = false;

  private tmp = { x: 0, y: 0 };

  constructor(opts: RunOptions) {
    this.demo = opts.demo;
    this.sink = opts.sink;
    this.seed = opts.seed ?? ((Math.random() * 0xffffffff) >>> 0);
    this.rng = new Rng(this.seed);
    this.fx = new Rng(this.seed ^ 0xa5a5a5);
    this.sensitivity = opts.sensitivity ?? 1;
    this.reducedEffects = opts.reducedEffects ?? false;
    this.perm = opts.save ? { ...opts.save.permanent } : { thrusters: 0, hull: 0, collector: 0, shields: 0, reactor: 0 };
    this.unlocked = new Set(opts.save?.unlocked ?? []);
    this.mods = computeMods(this.stacks, this.perm);
    this.particles = new Particles(700);
    this.particles.limit = this.reducedEffects ? 260 : 700;

    this.ship = new Ship(CONFIG.HULL_BASE + this.perm.hull * 12);
    this.ship.boostCdMax = CONFIG.BOOST_COOLDOWN * this.mods.boostCdMul;
    if (this.perm.shields > 0) this.ship.shield = 1;
    this.energy = this.perm.reactor * 3;

    this.level = this.demo ? menuLevel() : generateLevel(1, this.seed, null, this.seenMods);
    this.setupLevel(true);
    if (this.demo) {
      this.phase = 'active';
    } else {
      this.sink.levelIntro(this.level);
    }
  }

  setView(hw: number, hh: number): void {
    this.viewHalfW = hw;
    this.viewHalfH = hh;
  }

  setPreferences(sensitivity: number, reducedEffects: boolean): void {
    this.sensitivity = sensitivity;
    this.reducedEffects = reducedEffects;
    this.particles.limit = reducedEffects ? 260 : 700;
  }

  // ------------------------------------------------------------------ level setup

  private setupLevel(first: boolean): void {
    const L = this.level;
    this.attractors = [{ x: 0, y: 0, mu: L.body.mu, soft2: 9 }];
    if (L.moon) this.attractors.push({ x: 0, y: 0, mu: L.moon.mu, soft2: 36 });
    this.updateMoon();
    for (const m of L.modifiers) this.seenMods.add(m);

    this.hazards = [];
    this.motes = [];
    this.flares = [];
    this.waves = [];
    this.cometQueue = [];
    this.flareMessages = 0;
    this.debrisMessage = false;
    this.waveMessage = false;
    const d = L.difficulty;
    this.nextAsteroid = 0.6;
    this.nextFlare = this.rng.range(2.5, 4);
    this.nextWave = this.rng.range(4, 6);
    this.waveCharge = 0;
    this.nextComet = this.rng.range(4, 7);
    this.nextDebris = this.rng.range(3, 6);
    this.nextMote = 0.3;
    this.storm = { state: 'idle', t: 0, dirX: 1, dirY: 0, strength: 0, next: this.rng.range(5, 8) };

    this.beam = L.modifiers.includes('beams')
      ? {
          angle: this.rng.range(0, TAU),
          angularSpeed: 0.36 * Math.pow(d, 0.3),
          cycleT: 0,
          off: Math.max(1.8, 2.9 / Math.pow(d, 0.4)),
          charge: 0.9,
          on: 0.8,
          count: 2,
          length: 320,
          halfWidth: 4,
          hitCooldown: 0,
        }
      : null;

    if (L.modifiers.includes('belt')) this.spawnBelt();

    // Place the ship on a circular orbit at the level's recommended radius, preserving direction.
    const s = this.ship;
    const angle = first ? -Math.PI / 2 : Math.atan2(s.y, s.x);
    const dir = first ? 1 : Math.sign(s.x * s.vy - s.y * s.vx) || 1;
    const r = L.startRadius;
    const v = circularSpeed(L.body.mu, r);
    s.x = Math.cos(angle) * r;
    s.y = Math.sin(angle) * r;
    s.vx = -Math.sin(angle) * v * dir;
    s.vy = Math.cos(angle) * v * dir;
    s.heading = Math.atan2(s.vy, s.vx);
    gravityAt(s.x, s.y, this.attractors, 1, this.tmp);
    s.gx = this.tmp.x;
    s.gy = this.tmp.y;
    s.clearTrail();
    if (!first) s.stability = Math.min(100, s.stability + 40);
  }

  private spawnBelt(): void {
    const L = this.level;
    const n = this.demo ? 9 : 8;
    const base = this.rng.range(0, TAU);
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * TAU + this.rng.range(-0.25, 0.25);
      const r = this.rng.range(L.safeMax - 24, L.safeMax - 6);
      const v = circularSpeed(L.body.mu, r);
      const size: 0 | 1 = this.rng.chance(0.6) ? 0 : 1;
      const h = makeHazard('asteroid', size, Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, this.rng);
      h.gravity = 1;
      h.orbiting = true;
      h.entered = true;
      this.hazards.push(h);
    }
  }

  private nextLevel(): void {
    const prevKind = this.level.body.kind;
    this.levelIndex++;
    this.level = generateLevel(this.levelIndex, this.seed, prevKind, this.seenMods);
    this.setupLevel(false);
    this.levelTime = 0;
    this.phase = 'intro';
    this.phaseTime = 0;
    this.flash = 1;
    this.sink.levelIntro(this.level);
  }

  private updateMoon(): void {
    const m = this.level.moon;
    if (!m || this.attractors.length < 2) return;
    const a = m.phase + m.angularSpeed * this.simTime;
    this.attractors[1].x = Math.cos(a) * m.orbitRadius;
    this.attractors[1].y = Math.sin(a) * m.orbitRadius;
  }

  moonAt = (t: number, out: { x: number; y: number }): void => {
    const m = this.level.moon;
    if (!m) return;
    const a = m.phase + m.angularSpeed * t;
    out.x = Math.cos(a) * m.orbitRadius;
    out.y = Math.sin(a) * m.orbitRadius;
  };

  // ------------------------------------------------------------------ derived values for rendering / HUD

  get levelProgress(): number {
    return clamp(this.levelTime / this.level.duration, 0, 1);
  }

  get bodyScale(): number {
    if (this.phase === 'intro' && !this.demo) return easeOutBack(this.phaseTime / 0.9);
    if (this.phase === 'warping') return Math.max(0, 1 - easeInCubic(this.phaseTime / (CONFIG.WARP_TIME * 0.8)));
    return 1;
  }

  get warpAmount(): number {
    if (this.phase === 'warping') return easeInCubic(this.phaseTime / CONFIG.WARP_TIME);
    if (this.phase === 'intro' && !this.demo) return Math.max(0, 1 - this.phaseTime / 0.7);
    return 0;
  }

  get hazardTimeScale(): number {
    return this.temporalT > 0 ? 0.32 : 1;
  }

  get playing(): boolean {
    return this.phase === 'intro' || this.phase === 'active' || this.phase === 'clearing' || this.phase === 'warping';
  }

  get fogRadius(): number {
    return 92 + this.mods.scanner * 22;
  }

  // ------------------------------------------------------------------ main step

  step(dt: number, controls: Controls): void {
    this.simTime += dt;
    this.updateMoon();
    this.phaseTime += dt;

    if (this.temporalT > 0) this.temporalT -= dt;
    if (this.temporalCd > 0) this.temporalCd -= dt;
    const hdt = dt * this.hazardTimeScale;

    if (!this.demo && this.playing) {
      this.time += dt;
      const mult = (1 + 0.2 * (this.levelIndex - 1)) * (this.overdrive > 0 ? 1.5 : 1);
      this.score += dt * 10 * mult;
    }

    switch (this.phase) {
      case 'intro':
        if (this.phaseTime >= CONFIG.INTRO_TIME) this.setPhase('active');
        break;
      case 'active':
        if (!this.demo) {
          this.levelTime += dt;
          if (this.levelTime >= this.level.duration) this.beginClearing();
        }
        this.updateSpawns(dt);
        break;
      case 'clearing':
        this.updateClearing();
        if (this.phaseTime >= CONFIG.CLEAR_TIME) {
          this.setPhase('warping');
          this.sink.sfx('level');
          this.hazards = [];
        }
        break;
      case 'warping':
        if (this.phaseTime >= CONFIG.WARP_TIME) this.nextLevel();
        break;
      case 'dying':
        if (this.deathMode === 'spin' && this.ship.visible && this.phaseTime > 1.0) this.explodeShip();
        if (this.phaseTime >= CONFIG.DYING_TIME) {
          this.setPhase('dead');
          this.sink.died(this.deathCause);
        }
        break;
      case 'dead':
        break;
    }

    this.updateShip(dt, this.phase === 'intro' || this.phase === 'active' || this.phase === 'clearing' ? controls : NO_CONTROLS);
    this.updateEnvironment(hdt);
    this.updateHazards(hdt);
    this.updateMotes(dt);
    this.particles.update(dt, this.attractors);
    this.updateEffects(dt);

    if (!this.demo && this.phase === 'active') {
      this.checkTemporal();
      this.checkMilestones();
    }
  }

  private setPhase(p: RunPhase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  private beginClearing(): void {
    this.setPhase('clearing');
    this.levelsCleared++;
    const bonus = 200 * this.levelIndex;
    this.score += bonus;
    this.sink.sfx('clear');
    this.sink.message(`SECTOR CLEAR  +${bonus}`, 'good');
    this.addText(this.ship.x, this.ship.y - 12, `+${bonus}`, PALETTE.green);
    this.flares = [];
    this.waves = [];
    this.cometQueue = [];
    if (this.storm.state !== 'idle') this.storm.state = 'idle';
  }

  private updateClearing(): void {
    // Pop remaining hazards one by one for a satisfying sweep.
    if (this.phaseTime > 0.25 && this.hazards.length > 0 && Math.random() < 0.35) {
      const h = this.hazards[0];
      if (this.onScreen(h.x, h.y, 10)) {
        this.particles.burst(h.x, h.y, 8, 10, 40, 0.5, ['#3ef2ff', '#9b5cff', '#e8f0ff'], { flags: P_GLOW });
      }
      h.alive = false;
      this.hazards.shift();
    }
  }

  // ------------------------------------------------------------------ ship

  private updateShip(dt: number, c: Controls): void {
    const s = this.ship;
    if (!s.visible) return;
    const L = this.level;
    const controllable = !this.demo && (this.phase === 'intro' || this.phase === 'active' || this.phase === 'clearing');
    const dying = this.phase === 'dying';

    if (s.invuln > 0) s.invuln -= dt;
    if (s.boostT > 0) s.boostT -= dt;
    if (s.boostCd > 0) s.boostCd -= dt * (this.overdrive > 0 ? 2.5 : 1);
    if (this.overdrive > 0) {
      this.overdrive -= dt;
      if (this.overdrive <= 0) this.sink.message('OVERDRIVE ENDED', 'info');
    }
    if (this.mods.shieldRecharge > 0 && s.shield === 0 && controllable) {
      s.shieldTimer += dt;
      if (s.shieldTimer >= this.mods.shieldRecharge) {
        s.shield = 1;
        s.shieldTimer = 0;
        this.sink.message('SHIELD RECHARGED', 'good');
        this.sink.sfx('shield');
      }
    }

    const pro = s.prograde(this.tmp);
    const px = pro.x;
    const py = pro.y;
    let ex = 0;
    let ey = 0;
    let t = 0;
    let lat = 0;
    if (controllable) {
      const thrust =
        CONFIG.THRUST * L.thrustScale * this.mods.thrustMul * this.sensitivity * (this.overdrive > 0 ? 1.5 : 1);
      t = (c.accel ? 1 : 0) - (c.brake ? 1 : 0);
      lat = c.lateral;
      ex += px * t * thrust;
      ey += py * t * thrust;
      if (lat !== 0) {
        const lt = thrust * CONFIG.LATERAL_FACTOR * this.mods.lateralMul;
        ex += -py * lat * lt;
        ey += px * lat * lt;
      }
      if (c.boost && s.boostCd <= 0) this.boost(t, lat, px, py);
      if (this.mods.stabilizer > 0) {
        const r = Math.hypot(s.x, s.y) || 1;
        const rx = s.x / r;
        const ry = s.y / r;
        const vr = s.vx * rx + s.vy * ry;
        const k = 0.14 * this.mods.stabilizer;
        ex -= rx * vr * k;
        ey -= ry * vr * k;
      }
    }
    s.thrust = t;
    s.lateral = lat;

    if (this.storm.state === 'active') {
      const w = this.storm.strength * (1 - 0.15 * this.mods.stabilizer);
      ex += this.storm.dirX * w;
      ey += this.storm.dirY * w;
    }

    leapfrogStep(s, dt, this.attractors, 1, ex, ey);
    s.updateHeading(dt, dying);
    s.pushTrail();

    // Engine particles.
    if (t !== 0 || lat !== 0) this.emitThrust(t, lat);
    if (s.boostT > 0 && Math.random() < 0.6) {
      this.particles.spawn(s.x, s.y, -s.vx * 0.1, -s.vy * 0.1, 0.4, '#3ef2ff', 1, 2, P_GLOW, '#9b5cff');
    }

    if (this.demo) return;

    // Lethal contact with celestial bodies.
    const r = Math.hypot(s.x, s.y);
    if (!dying && r < L.body.radius + s.radius * 0.5) {
      this.kill(BODY_DEATH[L.body.kind], 'consumed');
      return;
    }
    if (!dying && L.moon && this.attractors.length > 1) {
      const m = this.attractors[1];
      if (circlesOverlap(s.x, s.y, s.radius * 0.6, m.x, m.y, L.moon.radius)) {
        this.kill('CRASHED INTO THE MOON', 'explode');
        return;
      }
    }
    if (dying || !controllable) return;

    // Heat zones.
    let zoneDrain = 0;
    let zoneReason: StabilityReason = null;
    if (L.body.heatRadius > 0 && r < L.body.heatRadius && this.phase !== 'clearing') {
      const depth = 1 - (r - L.body.radius) / (L.body.heatRadius - L.body.radius);
      zoneDrain = 18 + 14 * clamp(depth, 0, 1);
      zoneReason = 'HEAT';
      if (s.boostT <= 0) {
        this.damage(L.body.heatDps * (0.6 + 0.6 * depth) * dt, false);
        this.hurtFlash = Math.max(this.hurtFlash, 0.35);
      }
      this.heatSoundT -= dt;
      if (this.heatSoundT <= 0) {
        this.sink.sfx('heat');
        this.heatSoundT = 0.2;
      }
      if (Math.random() < 0.5) {
        this.particles.spawn(s.x, s.y, this.fx.range(-30, 30), this.fx.range(-30, 30), 0.4, '#ffc94d', 1, 3, P_GLOW, '#ff4d5e');
      }
    }

    // Orbit stability.
    if (this.phase === 'active' || this.phase === 'intro') {
      const info = orbitInfo(s.x, s.y, s.vx, s.vy, L.body.mu);
      const res = evaluateStability(info, {
        bodyRadius: L.body.radius,
        safeMin: L.safeMin,
        safeMax: L.safeMax,
        outerLimit: L.outerLimit,
        zoneDrain,
        zoneReason,
        stabilizer: this.mods.stabilizer,
      });
      let rate = res.rate;
      if (this.phase === 'intro' && rate < 0) rate = 0;
      s.stability = clamp(s.stability + rate * dt, 0, 100);
      this.stabilityReason = res.reason;
      this.stabilityDanger = res.danger;
      if (s.stability < 25 && !this.criticalFlag) {
        this.criticalFlag = true;
        this.sink.message('ORBIT CRITICAL', 'danger');
        this.sink.sfx('critical');
      } else if (s.stability > 40) {
        this.criticalFlag = false;
      }
      if (s.stability <= 0) {
        const far = res.reason === 'ESCAPING' || res.reason === 'TOO FAR' || res.reason === 'SIGNAL LOST';
        this.kill(far ? 'LOST TO DEEP SPACE' : 'ORBIT COLLAPSED', 'spin');
      }
    } else {
      this.stabilityReason = null;
      this.stabilityDanger = 0;
    }
  }

  private emitThrust(t: number, lat: number): void {
    const s = this.ship;
    if (Math.random() < (this.reducedEffects ? 0.35 : 0.75)) {
      const hx = Math.cos(s.heading);
      const hy = Math.sin(s.heading);
      const od = this.overdrive > 0;
      if (t > 0) {
        const bx = s.x - hx * 5;
        const by = s.y - hy * 5;
        const spd = this.fx.range(28, 60);
        const sp = this.fx.range(-0.35, 0.35);
        const dx = -hx * Math.cos(sp) + hy * Math.sin(sp);
        const dy = -hy * Math.cos(sp) - hx * Math.sin(sp);
        this.particles.spawn(
          bx,
          by,
          s.vx * 0.6 + dx * spd,
          s.vy * 0.6 + dy * spd,
          this.fx.range(0.2, 0.42),
          od ? '#ffc94d' : this.fx.chance(0.5) ? '#ff8a3d' : '#ffc94d',
          1,
          2.5,
          P_GLOW,
          od ? '#ff4d5e' : '#9b5cff',
        );
      } else if (t < 0) {
        const bx = s.x + hx * 5;
        const by = s.y + hy * 5;
        const spd = this.fx.range(22, 44);
        const sp = this.fx.chance(0.5) ? 0.7 : -0.7;
        const dx = hx * Math.cos(sp) - hy * Math.sin(sp);
        const dy = hy * Math.cos(sp) + hx * Math.sin(sp);
        this.particles.spawn(bx, by, s.vx * 0.6 + dx * spd, s.vy * 0.6 + dy * spd, this.fx.range(0.15, 0.32), '#3ef2ff', 1, 3, P_GLOW, '#1a7f8f');
      }
      if (lat !== 0) {
        const sx = hy * lat;
        const sy = -hx * lat;
        this.particles.spawn(s.x + sx * 4, s.y + sy * 4, s.vx * 0.7 + sx * 30, s.vy * 0.7 + sy * 30, 0.2, '#e8f0ff', 1, 4, P_GLOW, '#3ef2ff');
      }
    }
  }

  private boost(t: number, lat: number, px: number, py: number): void {
    const s = this.ship;
    s.boostT = CONFIG.BOOST_TIME;
    s.boostCd = s.boostCdMax;
    const dv = CONFIG.BOOST_DV * this.mods.boostDvMul;
    let dx = px;
    let dy = py;
    if (t < 0) {
      dx = -px;
      dy = -py;
    } else if (t === 0 && lat !== 0) {
      dx = -py * lat;
      dy = px * lat;
    }
    s.vx += dx * dv;
    s.vy += dy * dv;
    this.sink.sfx('boost');
    this.shake = Math.max(this.shake, 2);
    this.particles.burst(s.x, s.y, this.reducedEffects ? 8 : 18, 20, 70, 0.5, ['#3ef2ff', '#e8f0ff', '#9b5cff'], {
      baseVx: s.vx * 0.5,
      baseVy: s.vy * 0.5,
      flags: P_GLOW,
    });
    this.rings.push({ x: s.x, y: s.y, r: 2, maxR: 18, t: 0, dur: 0.35, color: PALETTE.cyan });
  }

  private damage(amount: number, impactSound: boolean): void {
    const s = this.ship;
    s.hull -= amount;
    if (impactSound) this.sink.sfx('collide');
    if (s.hull <= 0) {
      s.hull = 0;
      this.kill('HULL BREACH', 'explode');
    }
  }

  private kill(cause: string, mode: 'explode' | 'spin' | 'consumed'): void {
    if (this.demo || this.phase === 'dying' || this.phase === 'dead') return;
    this.deathCause = cause;
    this.deathMode = mode;
    this.setPhase('dying');
    const s = this.ship;
    s.thrust = 0;
    s.lateral = 0;
    if (mode === 'explode') {
      this.explodeShip();
    } else if (mode === 'spin') {
      s.spin = (Math.random() < 0.5 ? -1 : 1) * 11;
      this.sink.sfx('critical');
      this.sink.message('CONTROL LOST', 'danger');
    } else {
      s.visible = false;
      s.alive = false;
      this.sink.sfx('explode');
      this.shake = 6;
      this.flash = 0.6;
      const col = this.level.body.kind === 'blackhole' ? ['#9b5cff', '#e8f0ff', '#3ef2ff'] : ['#ffc94d', '#ff8a3d', '#e8f0ff'];
      this.particles.burst(s.x, s.y, 40, 20, 110, 1.0, col, { flags: P_GLOW | P_GRAVITY, drag: 0.5 });
      this.rings.push({ x: s.x, y: s.y, r: 2, maxR: 40, t: 0, dur: 0.7, color: col[0] });
    }
  }

  private explodeShip(): void {
    const s = this.ship;
    s.visible = false;
    s.alive = false;
    this.sink.sfx('explode');
    this.shake = 9;
    this.flash = 0.5;
    this.particles.burst(s.x, s.y, this.reducedEffects ? 30 : 70, 15, 150, 1.3, SHIP_COLORS, {
      baseVx: s.vx * 0.3,
      baseVy: s.vy * 0.3,
      flags: P_SPARK | P_GLOW,
      drag: 1.1,
    });
    this.rings.push({ x: s.x, y: s.y, r: 2, maxR: 46, t: 0, dur: 0.8, color: PALETTE.white });
    this.rings.push({ x: s.x, y: s.y, r: 2, maxR: 26, t: 0, dur: 0.5, color: PALETTE.orange });
  }

  // ------------------------------------------------------------------ spawning

  private updateSpawns(dt: number): void {
    const L = this.level;
    const d = L.difficulty;

    // Asteroids.
    this.nextAsteroid -= dt;
    if (this.nextAsteroid <= 0) {
      if (this.demo) {
        this.spawnAsteroid(this.rng.range(18, 30), this.rng.chance(0.6) ? 0 : 1);
        this.nextAsteroid = this.rng.range(3.5, 6);
      } else {
        const sz = this.rng.weighted([0, 1, 2] as const, L.asteroidSizeWeights);
        this.spawnAsteroid(this.rng.range(L.asteroidSpeed[0], L.asteroidSpeed[1]), sz);
        const p = this.levelProgress;
        this.nextAsteroid = lerp(L.asteroidInterval[0], L.asteroidInterval[1], p) * this.rng.range(0.7, 1.3);
      }
    }

    if (this.demo) {
      this.nextMote -= dt;
      return;
    }
    const mods = L.modifiers;

    if (mods.includes('comets')) {
      this.nextComet -= dt;
      if (this.nextComet <= 0) {
        const count = 1 + this.rng.int(0, Math.min(2, Math.floor((this.levelIndex - 4) / 4)));
        const angle = this.rng.range(0, TAU);
        for (let i = 0; i < count; i++) this.cometQueue.push({ delay: i * 0.55, angle: angle + this.rng.range(-0.35, 0.35) });
        this.sink.message(count > 1 ? 'COMET SHOWER INBOUND' : 'COMET INBOUND', 'warn');
        this.sink.sfx('warning');
        this.nextComet = this.rng.range(9, 13) / Math.pow(d, 0.35);
      }
    }
    for (let i = this.cometQueue.length - 1; i >= 0; i--) {
      const q = this.cometQueue[i];
      q.delay -= dt;
      if (q.delay <= 0) {
        this.spawnComet(q.angle);
        this.cometQueue.splice(i, 1);
      }
    }

    if (mods.includes('debris')) {
      this.nextDebris -= dt;
      if (this.nextDebris <= 0) {
        this.spawnDebrisSwarm();
        if (!this.debrisMessage) {
          this.sink.message('DEBRIS SWARM', 'warn');
          this.debrisMessage = true;
        }
        this.nextDebris = this.rng.range(6.5, 10) / Math.pow(d, 0.4);
      }
    }

    if (mods.includes('flares')) {
      this.nextFlare -= dt;
      if (this.nextFlare <= 0) {
        this.spawnFlare();
        this.nextFlare = this.rng.range(4.5, 7.5) / Math.pow(d, 0.45);
      }
    }

    if (mods.includes('waves')) {
      this.nextWave -= dt;
      if (this.nextWave <= 0 && this.waveCharge <= 0) {
        this.waveCharge = 1.1;
        this.sink.sfx('warning');
        if (!this.waveMessage) {
          this.sink.message('GRAVITY WAVE', 'warn');
          this.waveMessage = true;
        }
        this.nextWave = this.rng.range(7, 10.5) / Math.pow(d, 0.35);
      }
    }

    if (mods.includes('storm')) {
      const st = this.storm;
      if (st.state === 'idle') {
        st.next -= dt;
        if (st.next <= 0) {
          st.state = 'warn';
          st.t = 1.5;
          const a = this.rng.range(0, TAU);
          st.dirX = Math.cos(a);
          st.dirY = Math.sin(a);
          st.strength = 10 * Math.pow(d, 0.3);
          this.sink.message('ION STORM INBOUND', 'warn');
          this.sink.sfx('warning');
        }
      }
    }
  }

  private spawnAsteroid(speed: number, size: 0 | 1 | 2): void {
    const sv = edgeSpawn(this.rng, this.level, this.viewHalfW, this.viewHalfH, speed);
    const h = makeHazard('asteroid', size, sv.x, sv.y, sv.vx, sv.vy, this.rng);
    h.gravity = this.level.hazardGravity;
    this.hazards.push(h);
  }

  private spawnComet(angle: number): void {
    const speed = this.rng.range(150, 185) * Math.pow(this.level.difficulty, 0.25);
    const sv = edgeSpawn(this.rng, this.level, this.viewHalfW, this.viewHalfH, speed, angle);
    const h = makeHazard('comet', 0, sv.x, sv.y, sv.vx, sv.vy, this.rng);
    h.gravity = 0.55;
    this.hazards.push(h);
  }

  private spawnDebrisSwarm(): void {
    const n = this.rng.int(4, 6 + Math.min(3, Math.floor(this.levelIndex / 5)));
    const speed = this.rng.range(85, 120) * Math.pow(this.level.difficulty, 0.3);
    const sv = edgeSpawn(this.rng, this.level, this.viewHalfW, this.viewHalfH, speed);
    const nx = -sv.vy / speed;
    const ny = sv.vx / speed;
    for (let i = 0; i < n; i++) {
      const off = this.rng.range(-16, 16);
      const back = this.rng.range(0, 30);
      const h = makeHazard(
        'debris',
        0,
        sv.x + nx * off - (sv.vx / speed) * back,
        sv.y + ny * off - (sv.vy / speed) * back,
        sv.vx * this.rng.range(0.92, 1.08),
        sv.vy * this.rng.range(0.92, 1.08),
        this.rng,
      );
      h.gravity = 0.3;
      this.hazards.push(h);
    }
  }

  private spawnFlare(): void {
    const s = this.ship;
    const shipAngle = Math.atan2(s.y, s.x);
    const r = Math.max(30, Math.hypot(s.x, s.y));
    const omega = (s.x * s.vy - s.y * s.vx) / (r * r);
    const telegraph = 2.2 - Math.min(0.5, (this.level.difficulty - 1) * 0.5);
    // Aim near where the ship will be, so flares demand a reaction - but never dead-on every time.
    const angle = shipAngle + omega * (telegraph + 0.4) + this.rng.range(-1.7, 1.7);
    this.flares.push({
      angle,
      t: 0,
      telegraph,
      active: 0.85,
      // Flares lick out into the inner band only: a high orbit is the safe answer.
      reach: this.rng.range(108, 142) + Math.min(14, (this.level.difficulty - 1) * 14),
      halfWidth: this.rng.range(0.15, 0.22),
      hit: false,
    });
    if (this.flareMessages < 2) {
      this.sink.message('SOLAR FLARE', 'warn');
      this.flareMessages++;
    }
    this.sink.sfx('warning');
  }

  // ------------------------------------------------------------------ environment

  private updateEnvironment(dt: number): void {
    const s = this.ship;
    const shipHittable = !this.demo && s.visible && this.phase === 'active' && s.boostT <= 0;

    // Flares.
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      const prev = f.t;
      f.t += dt;
      if (prev < f.telegraph && f.t >= f.telegraph) {
        this.sink.sfx('flare');
        this.shake = Math.max(this.shake, 1.5);
      }
      const at = f.t - f.telegraph;
      if (at >= 0 && at < f.active) {
        const reachNow = this.level.body.radius + (f.reach - this.level.body.radius) * Math.min(1, at / 0.25);
        if (Math.random() < 0.8) {
          const a = f.angle + this.fx.range(-f.halfWidth, f.halfWidth);
          const rr = this.fx.range(this.level.body.radius, reachNow);
          this.particles.spawn(Math.cos(a) * rr, Math.sin(a) * rr, Math.cos(a) * 60, Math.sin(a) * 60, 0.45, '#ffc94d', 1, 2, P_GLOW, '#ff4d5e');
        }
        if (shipHittable && !f.hit && s.invuln <= 0 && inWedge(s.x, s.y, f.angle, f.halfWidth, reachNow)) {
          f.hit = true;
          this.environmentHit(16, 'FLARE', Math.cos(f.angle) * 10, Math.sin(f.angle) * 10);
        }
      }
      if (f.t > f.telegraph + f.active) this.flares.splice(i, 1);
    }

    // Pulsar beams.
    const b = this.beam;
    if (b && (this.phase === 'active' || this.phase === 'intro' || this.demo)) {
      b.cycleT += dt;
      const cycle = b.off + b.charge + b.on;
      if (b.cycleT >= cycle) b.cycleT -= cycle;
      if (b.hitCooldown > 0) b.hitCooldown -= dt;
      const state = this.beamState();
      b.angle += b.angularSpeed * dt * (state === 'on' ? 0.6 : 1);
      if (state === 'on' && this.phase === 'active') {
        if (b.cycleT - b.off - b.charge < dt * 1.5) this.sink.sfx('beam');
        for (let k = 0; k < b.count; k++) {
          const a = b.angle + (k * TAU) / b.count;
          if (shipHittable && s.invuln <= 0 && b.hitCooldown <= 0 && hitsBeam(s.x, s.y, s.radius, a, b.length, b.halfWidth)) {
            b.hitCooldown = 1.0;
            this.environmentHit(14, 'BEAM', -Math.sin(a) * 6, Math.cos(a) * 6);
          }
          for (const h of this.hazards) {
            if (h.alive && !h.orbiting && hitsBeam(h.x, h.y, h.r, a, b.length, b.halfWidth)) {
              this.destroyHazard(h, 'env');
            }
          }
        }
      }
    }

    // Gravity waves.
    if (this.waveCharge > 0) {
      this.waveCharge -= dt;
      if (this.waveCharge <= 0) {
        this.waves.push({ id: this.waveSeq++, r: this.level.body.radius, speed: 150, strength: 13, maxR: 300, charge: 0, shipHit: false });
        this.sink.sfx('wave');
        this.shake = Math.max(this.shake, 2.5);
      }
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      const prevR = w.r;
      w.r += w.speed * dt;
      const sr = Math.hypot(s.x, s.y);
      if (!w.shipHit && s.visible && !this.demo && prevR <= sr && w.r > sr) {
        w.shipHit = true;
        if (s.boostT <= 0 && this.phase === 'active') {
          const k = w.strength * (1 - 0.2 * this.mods.stabilizer);
          s.vx += (s.x / sr) * k;
          s.vy += (s.y / sr) * k;
          this.shake = Math.max(this.shake, 2);
          s.stability = Math.max(0, s.stability - 4);
        }
      }
      for (const h of this.hazards) {
        if (h.waveId === w.id) continue;
        const hr = Math.hypot(h.x, h.y);
        if (prevR <= hr && w.r > hr) {
          h.waveId = w.id;
          h.vx += (h.x / hr) * w.strength * 0.8;
          h.vy += (h.y / hr) * w.strength * 0.8;
        }
      }
      for (const m of this.motes) {
        if (m.waveId === w.id) continue;
        const mr = Math.hypot(m.x, m.y);
        if (prevR <= mr && w.r > mr) {
          m.waveId = w.id;
          m.vx += (m.x / mr) * w.strength * 0.6;
          m.vy += (m.y / mr) * w.strength * 0.6;
        }
      }
      if (w.r > w.maxR) this.waves.splice(i, 1);
    }

    // Ion storm.
    const st = this.storm;
    if (st.state === 'warn') {
      st.t -= dt;
      if (st.t <= 0) {
        st.state = 'active';
        st.t = 3.2;
        this.shake = Math.max(this.shake, 1.5);
      }
    } else if (st.state === 'active') {
      st.t -= dt;
      if (st.t <= 0) {
        st.state = 'idle';
        st.next = this.rng.range(8, 12);
      }
    }
    if (st.state !== 'idle' && !this.reducedEffects) {
      const n = st.state === 'active' ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const px = this.fx.range(-this.viewHalfW, this.viewHalfW) - st.dirX * this.viewHalfW * 0.6;
        const py = this.fx.range(-this.viewHalfH, this.viewHalfH) - st.dirY * this.viewHalfH * 0.6;
        const sp = st.state === 'active' ? 260 : 120;
        this.particles.spawn(px, py, st.dirX * sp, st.dirY * sp, 0.9, st.state === 'active' ? '#b77dff' : '#4b2a8a', 1, 0, P_SPARK, '#3d6bff');
      }
    }
  }

  beamState(): 'off' | 'charge' | 'on' {
    const b = this.beam;
    if (!b) return 'off';
    if (b.cycleT < b.off) return 'off';
    if (b.cycleT < b.off + b.charge) return 'charge';
    return 'on';
  }

  private environmentHit(dmg: number, label: string, kx: number, ky: number): void {
    const s = this.ship;
    if (s.shield > 0) {
      this.absorbWithShield();
      return;
    }
    this.damage(dmg, true);
    s.invuln = CONFIG.GRACE_TIME * 0.7;
    s.stability = Math.max(0, s.stability - 10);
    const k = 1 - 0.2 * this.mods.stabilizer;
    s.vx += kx * k;
    s.vy += ky * k;
    this.shake = Math.max(this.shake, 5);
    this.hurtFlash = 1;
    this.addText(s.x, s.y - 10, `-${dmg} ${label}`, PALETTE.red);
    this.particles.burst(s.x, s.y, 14, 20, 70, 0.5, ['#ff4d5e', '#ffc94d', '#e8f0ff'], { flags: P_SPARK });
  }

  private absorbWithShield(): void {
    const s = this.ship;
    s.shield--;
    s.shieldTimer = 0;
    s.invuln = 0.7;
    this.sink.sfx('shield');
    this.sink.message(s.shield > 0 ? `SHIELD ABSORBED · ${s.shield} LEFT` : 'SHIELD DOWN', 'info');
    this.shake = Math.max(this.shake, 3);
    this.rings.push({ x: s.x, y: s.y, r: 6, maxR: 26, t: 0, dur: 0.45, color: PALETTE.cyan });
    this.particles.burst(s.x, s.y, 20, 30, 90, 0.5, ['#3ef2ff', '#e8f0ff', '#1a7f8f'], { flags: P_GLOW | P_SPARK });
  }

  // ------------------------------------------------------------------ hazards

  private onScreen(x: number, y: number, margin: number): boolean {
    return Math.abs(x) < this.viewHalfW + margin && Math.abs(y) < this.viewHalfH + margin;
  }

  private updateHazards(dt: number): void {
    const s = this.ship;
    const L = this.level;
    const st = this.storm;
    const wx = st.state === 'active' ? st.dirX * st.strength * 1.4 : 0;
    const wy = st.state === 'active' ? st.dirY * st.strength * 1.4 : 0;
    const shipCollides = !this.demo && s.visible && (this.phase === 'active' || this.phase === 'intro');
    const nearCheck = !this.demo && s.visible && this.phase === 'active';
    const moon = L.moon && this.attractors.length > 1 ? this.attractors[1] : null;

    for (const h of this.hazards) {
      if (!h.alive) continue;
      eulerStep(h, dt, this.attractors, h.gravity, wx, wy);
      h.rot += h.spin * dt;
      h.age += dt;
      if (!h.entered && this.onScreen(h.x, h.y, -h.r)) h.entered = true;

      if (h.kind === 'comet' && Math.random() < (this.reducedEffects ? 0.4 : 0.9)) {
        const sp = Math.hypot(h.vx, h.vy) || 1;
        this.particles.spawn(
          h.x - (h.vx / sp) * 3 + this.fx.range(-1.5, 1.5),
          h.y - (h.vy / sp) * 3 + this.fx.range(-1.5, 1.5),
          h.vx * 0.15,
          h.vy * 0.15,
          this.fx.range(0.4, 0.8),
          this.fx.chance(0.5) ? '#7ffcff' : '#e8f0ff',
          1,
          1,
          P_GLOW,
          '#3d6bff',
        );
      }

      // Celestial body impacts.
      const hr = Math.hypot(h.x, h.y);
      if (hr < L.body.radius + h.r * 0.4) {
        if (!this.demo && h.entered && !h.hitPlayer) this.avoided++;
        this.destroyHazard(h, 'body');
        continue;
      }
      if (moon && L.moon && circlesOverlap(h.x, h.y, h.r, moon.x, moon.y, L.moon.radius)) {
        if (!this.demo && h.entered && !h.hitPlayer) this.avoided++;
        this.destroyHazard(h, 'body');
        continue;
      }

      // Leaving the arena.
      if (!h.orbiting) {
        const out = Math.abs(h.x) > this.viewHalfW + 170 || Math.abs(h.y) > this.viewHalfH + 170;
        if (out && h.x * h.vx + h.y * h.vy > 0) {
          h.alive = false;
          if (!this.demo && h.entered && !h.hitPlayer) this.avoided++;
          continue;
        }
        if (h.age > 60) h.alive = false;
      }

      if (!shipCollides) continue;

      const dx = h.x - s.x;
      const dy = h.y - s.y;
      const dist = Math.hypot(dx, dy);
      const hitR = h.r + s.radius;
      if (dist < hitR) {
        if (s.boostT > 0) {
          this.destroyed++;
          this.score += 30;
          this.addText(h.x, h.y - 8, '+30', PALETTE.cyan);
          this.destroyHazard(h, 'ram');
          continue;
        }
        if (s.invuln > 0) continue;
        if (s.shield > 0) {
          this.absorbWithShield();
          this.destroyed++;
          this.destroyHazard(h, 'shield');
          continue;
        }
        this.hitByHazard(h);
        continue;
      }
      if (nearCheck && !h.hitPlayer && !h.nearAwarded) {
        const nearR = hitR + 9;
        if (dist < nearR) h.nearArmed = true;
        else if (h.nearArmed && s.invuln <= 0) {
          h.nearAwarded = true;
          this.nearMisses++;
          const pts = 40 + 10 * this.levelIndex;
          this.score += pts;
          this.addText(s.x, s.y - 10, 'NEAR MISS', PALETTE.amber);
          this.sink.sfx('nearmiss');
        }
      }
    }
    if (this.hazards.some((h) => !h.alive)) this.hazards = this.hazards.filter((h) => h.alive);
  }

  private hitByHazard(h: Hazard): void {
    const s = this.ship;
    h.hitPlayer = true;
    const massK = h.kind === 'asteroid' ? [0.08, 0.14, 0.2][h.size] : h.kind === 'comet' ? 0.12 : 0.05;
    let ix = (h.vx - s.vx) * massK;
    let iy = (h.vy - s.vy) * massK;
    const im = Math.hypot(ix, iy);
    const maxI = 24;
    if (im > maxI) {
      ix *= maxI / im;
      iy *= maxI / im;
    }
    const k = 1 - 0.2 * this.mods.stabilizer;
    s.vx += ix * k;
    s.vy += iy * k;
    s.invuln = CONFIG.GRACE_TIME;
    s.stability = Math.max(0, s.stability - CONFIG.STABILITY_HIT);
    this.shake = Math.max(this.shake, 4 + h.size * 2);
    this.hurtFlash = 1;
    this.addText(s.x, s.y - 10, `-${h.damage}`, PALETTE.red);
    this.destroyHazard(h, 'hit');
    this.damage(h.damage, true);
  }

  destroyHazard(h: Hazard, how: 'ram' | 'shield' | 'hit' | 'body' | 'env'): void {
    h.alive = false;
    const visible = this.onScreen(h.x, h.y, 20);
    if (visible) {
      const n = h.kind === 'asteroid' ? [10, 16, 26][h.size] : h.kind === 'comet' ? 18 : 6;
      const colors = h.kind === 'asteroid' ? ROCK_COLORS : h.kind === 'comet' ? COMET_COLORS : DEBRIS_COLORS;
      const bh = how === 'body' && this.level.body.kind === 'blackhole';
      this.particles.burst(h.x, h.y, this.reducedEffects ? Math.ceil(n / 2) : n, 10, 60 + h.r * 4, 0.7, bh ? ['#9b5cff', '#b77dff', '#e8f0ff'] : colors, {
        baseVx: h.vx * 0.3,
        baseVy: h.vy * 0.3,
        flags: how === 'body' ? P_GLOW : P_SPARK,
        size: h.size === 2 ? 2 : undefined,
      });
      if (h.size > 0 || h.kind === 'comet') {
        this.rings.push({ x: h.x, y: h.y, r: 2, maxR: 8 + h.r * 1.8, t: 0, dur: 0.35, color: bh ? PALETTE.violet : PALETTE.amber });
      }
      if (how !== 'body' || this.fx.chance(0.4)) this.sink.sfx('destroy');
    }
    // Large asteroids split when struck by the ship.
    if (h.kind === 'asteroid' && h.size === 2 && (how === 'ram' || how === 'hit' || how === 'shield' || how === 'env')) {
      const sp = Math.hypot(h.vx, h.vy) || 1;
      const nx = -h.vy / sp;
      const ny = h.vx / sp;
      for (const sign of [-1, 1]) {
        const c = makeHazard('asteroid', 0, h.x + nx * sign * 6, h.y + ny * sign * 6, h.vx + nx * sign * 22, h.vy + ny * sign * 22, this.rng);
        c.gravity = h.gravity;
        c.entered = true;
        c.hitPlayer = true;
        this.hazards.push(c);
      }
    }
    if ((how === 'ram' || how === 'shield') && this.rng.chance(0.6)) {
      this.spawnMoteAt(h.x, h.y, h.size === 2 ? 3 : 1);
    }
    if (how === 'ram' || how === 'shield') this.shake = Math.max(this.shake, 2.5);
  }

  // ------------------------------------------------------------------ energy motes

  private orbitDirection(): number {
    const s = this.ship;
    return Math.sign(s.x * s.vy - s.y * s.vx) || 1;
  }

  private spawnOrbitMote(): void {
    const L = this.level;
    const s = this.ship;
    const shipA = Math.atan2(s.y, s.x);
    let a = 0;
    for (let tries = 0; tries < 6; tries++) {
      a = this.rng.range(0, TAU);
      const diff = Math.abs(((a - shipA + Math.PI * 3) % TAU) - Math.PI);
      if (diff > 0.6) break;
    }
    const shipR = Math.hypot(s.x, s.y);
    const near = this.rng.chance(0.55) && shipR > L.safeMin && shipR < L.safeMax;
    const r = near
      ? clamp(shipR + this.rng.range(-38, 38), L.safeMin + 8, L.safeMax - 8)
      : this.rng.range(L.safeMin + 8, L.safeMax - 8);
    const dir = this.orbitDirection();
    const stream = this.rng.chance(0.22);
    const n = stream ? 4 : 1;
    for (let i = 0; i < n; i++) {
      const ai = a - i * 0.13 * dir;
      const v = circularSpeed(L.body.mu, r);
      const big = !stream && this.rng.chance(0.08);
      this.motes.push({
        x: Math.cos(ai) * r,
        y: Math.sin(ai) * r,
        vx: -Math.sin(ai) * v * dir,
        vy: Math.cos(ai) * v * dir,
        value: big ? 4 : 1,
        life: CONFIG.MOTE_LIFE + i * 0.2,
        maxLife: CONFIG.MOTE_LIFE + i * 0.2,
        phase: this.rng.range(0, TAU),
        big,
        alive: true,
        waveId: 0,
      });
    }
  }

  private spawnMoteAt(x: number, y: number, value: number): void {
    const r = Math.max(this.level.body.radius + 10, Math.hypot(x, y));
    const a = Math.atan2(y, x);
    const v = circularSpeed(this.level.body.mu, r);
    const dir = this.orbitDirection();
    this.motes.push({
      x,
      y,
      vx: -Math.sin(a) * v * dir,
      vy: Math.cos(a) * v * dir,
      value,
      life: 10,
      maxLife: 10,
      phase: Math.random() * TAU,
      big: value > 1,
      alive: true,
      waveId: 0,
    });
  }

  private updateMotes(dt: number): void {
    const s = this.ship;
    const L = this.level;
    const canSpawn = this.phase === 'active' || this.phase === 'intro';
    if (canSpawn) {
      this.nextMote -= dt;
      const max = this.demo ? 6 : CONFIG.MAX_MOTES;
      if (this.nextMote <= 0 && this.motes.length < max) {
        this.spawnOrbitMote();
        this.nextMote = CONFIG.MOTE_INTERVAL * this.rng.range(0.7, 1.3) * (this.demo ? 2.5 : 1);
      }
    }
    const collecting = s.visible && (this.playing || this.demo) && this.phase !== 'warping';
    const vacuum = this.phase === 'clearing';
    const magnetR = vacuum ? 9999 : this.mods.magnetRadius;
    const pickR = this.mods.pickupRadius;
    const st = this.storm;
    const wx = st.state === 'active' ? st.dirX * st.strength : 0;
    const wy = st.state === 'active' ? st.dirY * st.strength : 0;

    for (const m of this.motes) {
      m.life -= dt;
      m.phase += dt * 6;
      if (m.life <= 0) {
        m.alive = false;
        continue;
      }
      let ax = wx;
      let ay = wy;
      const dx = s.x - m.x;
      const dy = s.y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      if (collecting && magnetR > 0 && d < magnetR) {
        const pull = vacuum ? 900 : 120 + 420 * (1 - d / magnetR);
        ax += (dx / d) * pull;
        ay += (dy / d) * pull;
        // Damp sideways velocity so motes actually arrive.
        m.vx += (s.vx - m.vx) * Math.min(1, dt * (vacuum ? 8 : 3));
        m.vy += (s.vy - m.vy) * Math.min(1, dt * (vacuum ? 8 : 3));
      }
      eulerStep(m, dt, this.attractors, 1, ax, ay);
      if (collecting && d < pickR + (m.big ? 2 : 0)) {
        this.collectMote(m);
        continue;
      }
      const mr = Math.hypot(m.x, m.y);
      if (mr < L.body.radius + 2 || mr > 420) m.alive = false;
    }
    if (this.motes.some((m) => !m.alive)) this.motes = this.motes.filter((m) => m.alive);
  }

  private collectMote(m: Mote): void {
    m.alive = false;
    if (this.demo) {
      this.particles.burst(m.x, m.y, 4, 10, 30, 0.35, ['#3ef2ff', '#e8f0ff'], { flags: P_GLOW });
      return;
    }
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = 1.6;
    this.energy += m.value;
    const pts = Math.round(15 * m.value * (1 + 0.1 * (this.combo - 1)));
    this.score += pts;
    this.sink.sfx('energy', this.combo - 1);
    this.particles.burst(m.x, m.y, m.big ? 12 : 6, 15, 45, 0.45, m.big ? ['#b77dff', '#e8f0ff', '#9b5cff'] : ['#3ef2ff', '#e8f0ff', '#1a7f8f'], {
      baseVx: this.ship.vx * 0.5,
      baseVy: this.ship.vy * 0.5,
      flags: P_GLOW,
    });
    this.addText(m.x, m.y - 6, this.combo > 2 ? `+${m.value} x${this.combo}` : `+${m.value}`, m.big ? PALETTE.violet : PALETTE.cyan);
  }

  // ------------------------------------------------------------------ upgrades

  private checkMilestones(): void {
    while (this.energy >= this.milestoneNext) {
      this.milestonePrev = this.milestoneNext;
      this.milestoneCount++;
      this.milestoneNext += CONFIG.MILESTONE_BASE + CONFIG.MILESTONE_GROW * this.milestoneCount;
      this.pendingUpgrades++;
      this.sink.message('UPGRADE AVAILABLE', 'upgrade');
      this.sink.upgradeReady();
    }
  }

  private eligible(id: UpgradeId): boolean {
    const def = UPGRADES[id];
    if (!this.unlocked.has(id)) return false;
    if (this.stacks[id] >= def.max) return false;
    if (id === 'repair') return this.ship.hull < this.ship.hullMax * 0.95;
    if (id === 'shield') return this.ship.shield < 3;
    if (id === 'overdrive') return this.overdrive <= 0;
    return true;
  }

  makeOffer(): UpgradeOffer[] {
    const pool = UPGRADE_ORDER.filter((id) => this.eligible(id));
    const weights = pool.map((id) => {
      if (id === 'repair') return this.ship.hull < this.ship.hullMax * 0.5 ? 3 : 0.8;
      if (id === 'shield' && this.ship.shield === 0) return 1.3;
      return 1;
    });
    const picks: UpgradeId[] = [];
    const p = [...pool];
    const w = [...weights];
    while (picks.length < 3 && p.length > 0) {
      const id = this.rng.weighted(p, w);
      const idx = p.indexOf(id);
      picks.push(id);
      p.splice(idx, 1);
      w.splice(idx, 1);
    }
    return picks.map((id) => {
      const def = UPGRADES[id];
      const next = this.stacks[id] + 1;
      return {
        id,
        name: def.name,
        description: def.summary,
        detail: def.detail(next),
        stack: this.stacks[id],
        max: def.max,
        color: def.color,
      };
    });
  }

  /** Called when an offer had no options at all (everything maxed). */
  skipUpgrade(): void {
    this.pendingUpgrades = Math.max(0, this.pendingUpgrades - 1);
    this.score += 500;
    this.sink.message('SYSTEMS MAXED  +500', 'good');
  }

  applyUpgrade(id: UpgradeId): void {
    this.pendingUpgrades = Math.max(0, this.pendingUpgrades - 1);
    this.stacks[id]++;
    this.mods = computeMods(this.stacks, this.perm);
    const s = this.ship;
    s.boostCdMax = CONFIG.BOOST_COOLDOWN * this.mods.boostCdMul;
    switch (id) {
      case 'hull':
        s.hullMax += 25;
        s.hull = Math.min(s.hullMax, s.hull + 25);
        break;
      case 'shield':
        s.shield = Math.min(3, s.shield + 1);
        break;
      case 'repair':
        s.hull = Math.min(s.hullMax, s.hull + s.hullMax * 0.45);
        break;
      case 'overdrive':
        this.overdrive = 20;
        s.boostCd = 0;
        break;
      case 'stabilizer':
        s.stability = Math.min(100, s.stability + 25);
        break;
      default:
        break;
    }
    const def = UPGRADES[id];
    this.rings.push({ x: s.x, y: s.y, r: 4, maxR: 40, t: 0, dur: 0.6, color: def.color });
    this.particles.burst(s.x, s.y, this.reducedEffects ? 10 : 26, 30, 90, 0.7, [def.color, '#e8f0ff'], { flags: P_GLOW, baseVx: s.vx * 0.6, baseVy: s.vy * 0.6 });
    this.addText(s.x, s.y - 12, def.name, def.color);
  }

  private checkTemporal(): void {
    if (this.mods.temporal <= 0 || this.temporalCd > 0 || this.temporalT > 0) return;
    const s = this.ship;
    if (!s.visible || s.invuln > 0 || s.boostT > 0) return;
    for (const h of this.hazards) {
      const ca = closestApproach(s.x, s.y, s.vx, s.vy, h.x, h.y, h.vx, h.vy);
      if (ca.t > 0 && ca.t < 0.55 && ca.dist < h.r + s.radius + 2) {
        this.temporalT = 1.6 + 0.4 * (this.mods.temporal - 1);
        this.temporalCd = 22 - 5 * (this.mods.temporal - 1);
        this.sink.sfx('temporal');
        this.sink.message('TEMPORAL FIELD', 'upgrade');
        this.rings.push({ x: s.x, y: s.y, r: 4, maxR: 90, t: 0, dur: 0.8, color: PALETTE.violet });
        return;
      }
    }
  }

  // ------------------------------------------------------------------ effects

  addText(x: number, y: number, text: string, color: string): void {
    if (this.texts.length > 14) this.texts.shift();
    this.texts.push({ x, y, text, color, t: 0, dur: 1.0 });
  }

  private updateEffects(dt: number): void {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    this.shake = Math.max(0, this.shake - dt * 14);
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.dur);
    for (const t of this.texts) {
      t.t += dt;
      t.y -= dt * 14;
    }
    this.texts = this.texts.filter((t) => t.t < t.dur);
    const s = this.ship;
    if (s.boostT > 0 && s.visible) {
      if (this.ghosts.length === 0 || this.ghosts[this.ghosts.length - 1].t > 0.05) {
        this.ghosts.push({ x: s.x, y: s.y, heading: s.heading, t: 0 });
      }
    }
    for (const g of this.ghosts) g.t += dt;
    this.ghosts = this.ghosts.filter((g) => g.t < 0.3);
  }

  /** Recompute the ship's ballistic trajectory preview (called once per rendered frame). */
  updatePrediction(): void {
    const s = this.ship;
    if (!s.visible) {
      this.trajCount = 0;
      return;
    }
    const attractors = this.attractors.map((a) => ({ ...a }));
    const res = predictTrajectory(
      s.x,
      s.y,
      s.vx,
      s.vy,
      attractors,
      this.level.moon ? this.moonAt : null,
      this.simTime,
      CONFIG.TRAJECTORY_TIME * this.mods.trajectoryMul,
      1 / 40,
      this.traj,
      this.level.body.radius + 1,
    );
    this.trajCount = res.count;
    this.trajCrashed = res.crashed;
  }

  get upgradesSummary(): { id: UpgradeId; stacks: number }[] {
    return UPGRADE_ORDER.filter((id) => this.stacks[id] > 0).map((id) => ({ id, stacks: this.stacks[id] }));
  }
}
