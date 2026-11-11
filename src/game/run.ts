import { CONFIG, PALETTE } from './config';
import { Rng } from './rng';
import { clamp, easeInCubic, easeOutBack, lerp, TAU } from './math';
import { eulerStep, gravityAt, leapfrogStep } from './physics';
import type { Attractor } from './physics';
import { circularSpeed, evaluateStability, orbitInfo, predictTrajectory } from './orbital';
import { hash32 } from '../generation/seed';
import { recordEncounter } from '../generation/encounterSelector';
import type { PlayerProgress, RunHistory } from '../generation/encounterSelector';
import { generateLevel, menuLevel } from './levels';
import { P_GLOW, P_GRAVITY, P_SPARK, Particles } from './particles';
import { NO_CONTROLS, Ship } from './player';
import type { Controls } from './player';
import { edgeSpawn, makeHazard } from './hazards';
import { circlesOverlap, closestApproach, hitsBeam, inWedge } from './collision';
import { placeAttractors, seasonIntensity } from './rails';
import { UPGRADES, UPGRADE_ORDER, computeMods, emptyStacks } from './upgrades';
import type { RunMods, Stacks } from './upgrades';
import type { SaveData } from './persistence';
import type {
  BeamState,
  BeltSpec,
  Eruption,
  Flare,
  GravityWave,
  Hazard,
  HazardKind,
  LevelDef,
  LevelIdentity,
  MessageTone,
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
  /** `discovery` is true when the player has never met this level's object before. */
  levelIntro(level: LevelDef, discovery: boolean): void;
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

/** One sector visited during a run (kept for the discovery log and the run summary). */
export interface Visit {
  index: number;
  identity: LevelIdentity;
  discovery: boolean;
}

const ROCK_COLORS = ['#b3a8c2', '#7a6d8a', '#4a3f5c', '#ffc94d'];
const DEBRIS_COLORS = ['#c9d3ea', '#8a96b8', '#ff8a3d'];
const COMET_COLORS = ['#e8f0ff', '#7ffcff', '#3ef2ff'];
const BOMB_COLORS = ['#ffd890', '#ff8a3d', '#ff4d5e'];
const STAR_HAZARD_COLORS = ['#ffffff', '#ffd890', '#b8c4ff'];
const BURST_COLORS: Record<HazardKind, string[]> = {
  asteroid: ROCK_COLORS,
  debris: DEBRIS_COLORS,
  comet: COMET_COLORS,
  ice: COMET_COLORS,
  bomb: BOMB_COLORS,
  star: STAR_HAZARD_COLORS,
};
const BURST_COUNT: Record<HazardKind, number> = { asteroid: 0, debris: 6, comet: 18, ice: 9, bomb: 12, star: 22 };
/** Fraction of relative velocity transferred to the ship on impact. */
const IMPACT_MASS: Record<HazardKind, number> = { asteroid: 0, debris: 0.05, comet: 0.12, ice: 0.07, bomb: 0.08, star: 0.2 };
const SHIP_COLORS = ['#e8f0ff', '#3ef2ff', '#9b5cff', '#ffc94d', '#ff8a3d'];

export interface RunOptions {
  demo: boolean;
  sink: RunSink;
  save?: SaveData;
  sensitivity?: number;
  reducedEffects?: boolean;
  seed?: number;
  /** Objects and environments the player has already met in earlier runs. */
  progress?: PlayerProgress;
  /** Testing aid: environment mechanics stay active but nothing is spawned at the player. */
  noSpawns?: boolean;
  /** Start from this exact level (e.g. one rebuilt from a level code) instead of sector 1. */
  level?: LevelDef;
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

  // ---- environment-specific mechanics (see LevelMechanics)
  /** Current direction of the cryo-plume. */
  plumeAngle = 0;
  eruptions: Eruption[] = [];
  private nextEruption = 6;
  private nextPlumeMote = 1;
  /** Seconds until a telegraphed magnetic burst lands (0 = none pending). */
  empCharge = 0;
  /** Seconds the thrusters stay offline. */
  empT = 0;
  private nextEmp = 10;
  /** Stellar pulsation phase, -1..1. */
  pulse = 0;
  /** 0 at apoapsis .. 1 at periapsis of the body's own eccentric orbit. */
  seasonK = 0;
  private seasonWarned = false;
  /** Current outward push of the stellar wind (u/s^2). */
  windNow = 0;
  /** Radius of the expanding radar ping in dark levels (0 = idle). */
  pingR = 0;
  private nextPing = 1.5;
  /** True while the ship is inside a drag zone. */
  inDrag = false;
  private mechMessages = new Set<string>();
  private noSpawns: boolean;

  // ---- journey
  private history: RunHistory = { environments: [], objects: [], sinceRare: 0 };
  private discovered: Set<string>;
  private environmentsSeen: Set<string>;
  readonly visits: Visit[] = [];

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
  /** Keys of every hazard system / mechanic met so far in this run. */
  readonly seenMods = new Set<string>();
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

    this.noSpawns = opts.noSpawns ?? false;
    this.discovered = new Set(opts.progress?.discovered ?? []);
    this.environmentsSeen = new Set(opts.progress?.environmentsSeen ?? []);

    this.level = this.demo ? menuLevel() : (opts.level ?? this.chooseLevel(1));
    this.levelIndex = this.level.index;
    this.setupLevel(true);
    if (this.demo) {
      this.phase = 'active';
    } else {
      this.announceLevel();
    }
  }

  /** Pick and build the next sector from the journey so far. */
  private chooseLevel(index: number): LevelDef {
    const { level, encounter } = generateLevel(
      index,
      this.seed,
      this.history,
      { discovered: this.discovered, environmentsSeen: this.environmentsSeen },
      this.seenMods,
    );
    this.history = recordEncounter(this.history, encounter, level.identity.objectId);
    return level;
  }

  /** Log the visit and tell the UI, flagging first-ever encounters with a catalogued object. */
  private announceLevel(): void {
    const id = this.level.identity;
    const discovery = id.kind === 'REAL OBJECT' && !this.discovered.has(id.objectId);
    this.discovered.add(id.objectId);
    this.environmentsSeen.add(id.environment);
    this.visits.push({ index: this.level.index, identity: id, discovery });
    this.sink.levelIntro(this.level, discovery);
  }

  /** Position of the primary body (it moves in binary systems). */
  get bx(): number {
    return this.attractors[0]?.x ?? 0;
  }

  get by(): number {
    return this.attractors[0]?.y ?? 0;
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
    const M = L.mechanics;
    this.attractors = [{ x: 0, y: 0, mu: L.body.mu, soft2: 9 }];
    for (const c of L.companions) this.attractors.push({ x: 0, y: 0, mu: c.mu, soft2: c.kind === 'moon' ? 36 : 64 });
    this.updateRails();
    for (const k of L.mechanicKeys) this.seenMods.add(k);

    this.hazards = [];
    this.motes = [];
    this.flares = [];
    this.waves = [];
    this.cometQueue = [];
    this.eruptions = [];
    this.flareMessages = 0;
    this.debrisMessage = false;
    this.waveMessage = false;
    this.mechMessages.clear();
    this.plumeAngle = this.rng.range(0, TAU);
    this.nextEruption = this.rng.range(3.5, 5.5);
    this.nextPlumeMote = 1;
    this.empCharge = 0;
    this.empT = 0;
    this.nextEmp = M.emp ? this.rng.range(M.emp.interval[0] * 0.6, M.emp.interval[1] * 0.7) : 0;
    this.pulse = 0;
    this.seasonK = 0;
    this.seasonWarned = false;
    this.windNow = 0;
    this.pingR = 0;
    this.nextPing = 1.5;
    this.inDrag = false;
    const d = L.difficulty;
    this.nextAsteroid = 0.6;
    this.nextFlare = this.rng.range(2.5, 4);
    this.nextWave = this.rng.range(4, 6);
    this.waveCharge = 0;
    this.nextComet = this.rng.range(4, 7);
    this.nextDebris = this.rng.range(3, 6);
    this.nextMote = 0.3;
    this.storm = { state: 'idle', t: 0, dirX: 1, dirY: 0, strength: 0, next: this.rng.range(5, 8) };

    const bc = M.beam;
    this.beam = bc
      ? {
          angle: this.rng.range(0, TAU),
          angularSpeed: bc.angularSpeed * Math.pow(d, 0.3),
          cycleT: 0,
          off: Math.max(bc.off * 0.62, bc.off / Math.pow(d, 0.4)),
          charge: bc.charge,
          on: bc.on,
          count: bc.count,
          length: 320,
          halfWidth: bc.halfWidth,
          hitCooldown: 0,
        }
      : null;

    for (const belt of M.belts) this.spawnBelt(belt);

    // Place the ship at the level's recommended radius, preserving its direction of travel. On an
    // eccentric configuration it starts at the periapsis of an ellipse that stays inside the band.
    const s = this.ship;
    const angle = first ? -Math.PI / 2 : Math.atan2(s.y, s.x);
    const dir = first ? 1 : Math.sign(s.x * s.vy - s.y * s.vx) || 1;
    const a = L.startRadius;
    const e = this.demo ? 0 : clamp(Math.min(L.startEcc, 1 - (L.safeMin + 10) / a, (L.safeMax - 10) / a - 1), 0, 0.3);
    const r = a * (1 - e);
    const v = Math.sqrt((L.orbitMu * (1 + e)) / r);
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

  /**
   * Populate one belt. Bodies are placed on Keplerian orbits (circular, or at a random point of an
   * ellipse for eccentric belts) and then simply integrated like everything else.
   */
  private spawnBelt(belt: BeltSpec): void {
    const mu = this.level.orbitMu;
    const base = this.rng.range(0, TAU);
    for (let i = 0; i < belt.count; i++) {
      const sma = belt.radius + this.rng.range(-belt.spread, belt.spread);
      let x: number;
      let y: number;
      let vx: number;
      let vy: number;
      if (belt.ecc > 0.01) {
        // True anomaly spread around the orbit; argument of periapsis differs per body.
        const nu = this.rng.range(0, TAU);
        const w = belt.node + this.rng.range(0, TAU);
        const p = sma * (1 - belt.ecc * belt.ecc);
        const r = p / (1 + belt.ecc * Math.cos(nu));
        const k = Math.sqrt(mu / p);
        const cw = Math.cos(w);
        const sw = Math.sin(w);
        const px = r * Math.cos(nu);
        const py = r * Math.sin(nu);
        const pvx = -k * Math.sin(nu);
        const pvy = k * (belt.ecc + Math.cos(nu));
        x = px * cw - py * sw;
        y = px * sw + py * cw;
        vx = pvx * cw - pvy * sw;
        vy = pvx * sw + pvy * cw;
        if (belt.dir < 0) {
          // Mirroring the orbit reverses its sense of rotation.
          y = -y;
          vy = -vy;
        }
      } else {
        const a = base + (i / belt.count) * TAU + this.rng.range(-0.25, 0.25);
        const v = circularSpeed(mu, sma) * belt.dir;
        x = Math.cos(a) * sma;
        y = Math.sin(a) * sma;
        vx = -Math.sin(a) * v;
        vy = Math.cos(a) * v;
      }
      const size: 0 | 1 = this.rng.chance(0.6) ? 0 : 1;
      const h = makeHazard(belt.kind, size, x, y, vx, vy, this.rng);
      h.gravity = 1;
      h.orbiting = true;
      h.entered = true;
      h.inc = belt.inclination;
      h.node = belt.node;
      this.hazards.push(h);
    }
  }

  private nextLevel(): void {
    this.levelIndex++;
    this.level = this.chooseLevel(this.levelIndex);
    this.setupLevel(false);
    this.levelTime = 0;
    this.phase = 'intro';
    this.phaseTime = 0;
    this.flash = 1;
    this.announceLevel();
  }

  /** Move the primary and every companion along their rails to the current time. */
  private updateRails(): void {
    const L = this.level;
    placeAttractors(L, this.simTime, this.attractors);
    const wob = L.mechanics.muWobble;
    if (wob) this.attractors[0].mu = L.body.mu * (1 + wob.amp * Math.sin((TAU * this.simTime) / wob.period));
  }

  /** Rails callback for trajectory prediction. */
  private placeAt = (t: number, attractors: Attractor[]): void => {
    placeAttractors(this.level, t, attractors);
  };

  /** Heat-zone radius of the primary right now (it breathes on pulsating stars and swells at periapsis). */
  get heatRadiusNow(): number {
    const L = this.level;
    if (L.body.heatRadius <= 0) return 0;
    const p = L.mechanics.pulsation;
    return L.body.heatRadius * (1 + (p ? p.amp * this.pulse : 0)) * (1 + 0.18 * this.seasonK);
  }

  /** Visual swell of a pulsating star. */
  get bodyPulse(): number {
    const p = this.level.mechanics.pulsation;
    return p ? 1 + 0.09 * p.amp * 2.6 * this.pulse : 1;
  }

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
    return (this.level.mechanics.dark?.radius ?? 92) + this.mods.scanner * 22;
  }

  // ------------------------------------------------------------------ main step

  step(dt: number, controls: Controls): void {
    this.simTime += dt;
    this.updateRails();
    this.phaseTime += dt;

    if (this.temporalT > 0) this.temporalT -= dt;
    if (this.temporalCd > 0) this.temporalCd -= dt;
    const hdt = dt * this.hazardTimeScale;

    const M = this.level.mechanics;
    if (M.pulsation) this.pulse = Math.sin((TAU * this.simTime) / M.pulsation.period);
    if (M.season && !this.demo) {
      // The cycle starts at apoapsis (phase pi) so every sector opens in its quiet season.
      const k = seasonIntensity(Math.PI + (TAU * this.levelTime) / M.season.period, M.season.ecc);
      if (k > 0.55 && !this.seasonWarned && this.phase === 'active') {
        this.seasonWarned = true;
        this.sink.message('PERIAPSIS APPROACH · ACTIVITY RISING', 'warn');
        this.sink.sfx('warning');
      } else if (k < 0.2) this.seasonWarned = false;
      this.seasonK = k;
    }

    if (!this.demo && this.playing) {
      this.time += dt;
      let mult = (1 + 0.2 * (this.levelIndex - 1)) * (this.overdrive > 0 ? 1.5 : 1);
      if (M.depthBonus && this.ship.visible) {
        // Deep orbits near a black hole pay more: the closer to the inner edge, the higher the multiplier.
        const L = this.level;
        const r = Math.hypot(this.ship.x - this.bx, this.ship.y - this.by);
        if (r >= L.safeMin) mult *= 1 + 1.2 * clamp((L.startRadius - r) / Math.max(1, L.startRadius - L.safeMin), 0, 1);
      }
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
    const rarity = this.level.identity.rarity;
    // Surviving a rare encounter is worth more.
    const bonus = Math.round(200 * this.levelIndex * (rarity === 'legendary' ? 2 : rarity === 'rare' ? 1.5 : 1));
    this.score += bonus;
    this.sink.sfx('clear');
    this.sink.message(`SECTOR CLEAR  +${bonus}`, 'good');
    this.addText(this.ship.x, this.ship.y - 12, `+${bonus}`, PALETTE.green);
    this.flares = [];
    this.waves = [];
    this.cometQueue = [];
    this.eruptions = [];
    this.empCharge = 0;
    this.empT = 0;
    this.pingR = 0;
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
    const M = L.mechanics;
    const bx = this.bx;
    const by = this.by;
    // Position relative to the primary (which is off-centre in binary systems).
    const relX = s.x - bx;
    const relY = s.y - by;
    const relR = Math.hypot(relX, relY) || 1;
    if (this.empT > 0) this.empT -= dt;
    if (controllable) {
      const thrust =
        CONFIG.THRUST * L.thrustScale * this.mods.thrustMul * this.sensitivity * (this.overdrive > 0 ? 1.5 : 1);
      // A magnetic burst leaves the engines dead for a moment; the boost capacitor still fires.
      const online = this.empT <= 0;
      t = online ? (c.accel ? 1 : 0) - (c.brake ? 1 : 0) : 0;
      lat = online ? c.lateral : 0;
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

    if (!this.demo) {
      // Drag zones (ring plane, upper atmosphere) bleed speed in proportion to it.
      this.inDrag = false;
      for (const z of M.dragZones) {
        if (relR >= z.rMin && relR <= z.rMax) {
          this.inDrag = true;
          ex -= s.vx * z.k;
          ey -= s.vy * z.k;
          if (Math.random() < 0.35) {
            this.particles.spawn(s.x + this.fx.range(-3, 3), s.y + this.fx.range(-3, 3), s.vx * 0.5, s.vy * 0.5, 0.35, z.color, 1, 2, P_SPARK, '#e8f0ff');
          }
        }
      }
      // Frame dragging: a steady retrograde pull that strengthens steeply toward the hole.
      if (M.frameDrag > 0) {
        const sp = Math.hypot(s.vx, s.vy) || 1;
        const k = M.frameDrag * Math.min(3, Math.pow(L.startRadius / relR, 3));
        ex -= (s.vx / sp) * k;
        ey -= (s.vy / sp) * k;
      }
      // Stellar wind: outward radiation pressure, surging in gusts.
      if (M.wind) {
        const g = Math.max(0, Math.sin((TAU * this.simTime) / M.wind.period));
        this.windNow = M.wind.base + M.wind.gust * g * g;
        ex += (relX / relR) * this.windNow;
        ey += (relY / relR) * this.windNow;
      }
      // Cryo-plume: a shove straight outward while the ship is inside the jet.
      if (M.plume && relR > L.body.radius && inWedge(relX, relY, this.plumeAngle, M.plume.halfWidth, M.plume.reach)) {
        const kick = M.plume.kick * (1 + 0.6 * this.seasonK) * (1 - 0.15 * this.mods.stabilizer);
        ex += (relX / relR) * kick;
        ey += (relY / relR) * kick;
        this.note('plume', 'INSIDE THE PLUME', 'info');
      }
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
    const r = Math.hypot(s.x - this.bx, s.y - this.by);
    if (!dying && r < L.body.radius * this.bodyPulse + s.radius * 0.5) {
      this.kill(L.body.deathText, 'consumed');
      return;
    }
    if (!dying) {
      for (let i = 0; i < L.companions.length; i++) {
        const c = L.companions[i];
        const m = this.attractors[i + 1];
        if (m && circlesOverlap(s.x, s.y, s.radius * 0.6, m.x, m.y, c.radius)) {
          const what = c.kind === 'star' ? 'INCINERATED BY THE COMPANION STAR' : `CRASHED INTO ${c.name ?? 'THE MOON'}`;
          this.kill(what, c.kind === 'star' ? 'consumed' : 'explode');
          return;
        }
      }
    }
    if (dying || !controllable) return;

    // Heat zones: the primary's corona, companion stars, and any permanently scorched sector.
    let zoneDrain = 0;
    let zoneReason: StabilityReason = null;
    let heatDepth = -1;
    let heatDps = 0;
    const hr = this.heatRadiusNow;
    if (hr > 0 && r < hr) {
      heatDepth = clamp(1 - (r - L.body.radius) / (hr - L.body.radius), 0, 1);
      heatDps = L.body.heatDps;
    }
    for (let i = 0; i < L.companions.length; i++) {
      const c = L.companions[i];
      const m = this.attractors[i + 1];
      if (c.heatRadius <= 0 || !m) continue;
      const dc = Math.hypot(s.x - m.x, s.y - m.y);
      if (dc < c.heatRadius) {
        const depth = clamp(1 - (dc - c.radius) / (c.heatRadius - c.radius), 0, 1);
        if (depth * c.heatDps > heatDepth * heatDps) {
          heatDepth = depth;
          heatDps = c.heatDps;
        }
      }
    }
    const sc = L.mechanics.scorch;
    if (sc && heatDepth < 0 && inWedge(s.x - this.bx, s.y - this.by, sc.angle, sc.halfWidth, sc.reach)) {
      heatDepth = 0.45;
      heatDps = sc.dps;
      this.note('scorch', 'DAY SIDE · RADIATION', 'danger');
    }
    if (heatDepth >= 0 && this.phase !== 'clearing') {
      const depth = heatDepth;
      zoneDrain = 18 + 14 * depth;
      zoneReason = 'HEAT';
      if (s.boostT <= 0) {
        this.damage(heatDps * (0.6 + 0.6 * depth) * dt, false);
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
      // The orbit is measured about the barycentre against everything inside the band.
      const info = orbitInfo(s.x, s.y, s.vx, s.vy, L.orbitMu);
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
      if (rate < 0) rate *= L.stabilityDrain;
      if (this.phase === 'intro' && rate < 0) rate = 0;
      s.stability = clamp(s.stability + rate * dt, 0, 100);
      this.stabilityReason = res.reason ?? (this.inDrag ? 'DRAG' : null);
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

  /** Show a mechanic's explanatory message once per sector. */
  private note(key: string, text: string, tone: MessageTone): void {
    if (this.mechMessages.has(key) || this.demo) return;
    this.mechMessages.add(key);
    this.sink.message(text, tone);
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

  private updateSpawns(realDt: number): void {
    const L = this.level;
    const d = L.difficulty;
    const M = L.mechanics;
    if (this.noSpawns) return;
    // Near periapsis of an eccentric orbit everything arrives faster.
    const dt = realDt * (1 + 1.2 * this.seasonK);

    // The environment's main stream of incoming bodies.
    this.nextAsteroid -= dt;
    if (this.nextAsteroid <= 0) {
      if (this.demo) {
        this.spawnAsteroid(this.rng.range(18, 30), this.rng.chance(0.6) ? 0 : 1);
        this.nextAsteroid = this.rng.range(3.5, 6);
      } else {
        const sz = this.rng.weighted([0, 1, 2] as const, L.asteroidSizeWeights);
        const speed = this.rng.range(L.asteroidSpeed[0], L.asteroidSpeed[1]);
        let pace = 1;
        if (M.spawn === 'clusters') {
          this.spawnCluster(speed);
          pace = 2.3;
        } else if (M.spawn === 'stream') {
          this.spawnIce(speed * 1.2, sz);
        } else if (M.spawn === 'donor' && L.companions.length > 0) {
          this.spawnDonorBlob();
        } else {
          this.spawnAsteroid(speed, sz);
        }
        const p = this.levelProgress;
        this.nextAsteroid = lerp(L.asteroidInterval[0], L.asteroidInterval[1], p) * this.rng.range(0.7, 1.3) * pace;
      }
    }

    if (this.demo) {
      this.nextMote -= dt;
      return;
    }
    const mods = L.modifiers;

    if (M.eruptions) {
      this.nextEruption -= dt;
      if (this.nextEruption <= 0) {
        const s = this.ship;
        const rr = Math.max(30, Math.hypot(s.x, s.y));
        const omega = (s.x * s.vy - s.y * s.vx) / (rr * rr);
        const telegraph = 1.5;
        // Erupt somewhere ahead of the ship, so it is a threat that can be read and avoided.
        const angle = Math.atan2(s.y, s.x) + omega * (telegraph + 1.3) + this.rng.range(-1.1, 1.1);
        this.eruptions.push({ angle, t: 0, telegraph, count: this.rng.int(M.eruptions.count[0], M.eruptions.count[1]) });
        this.note('eruption', 'ERUPTION', 'warn');
        this.sink.sfx('warning');
        this.nextEruption = this.rng.range(M.eruptions.interval[0], M.eruptions.interval[1]) / Math.pow(d, 0.4);
      }
    }

    if (M.emp) {
      this.nextEmp -= realDt;
      if (this.nextEmp <= 0 && this.empCharge <= 0) {
        this.empCharge = M.emp.telegraph;
        this.sink.message('MAGNETIC BURST INBOUND', 'warn');
        this.sink.sfx('warning');
        this.nextEmp = this.rng.range(M.emp.interval[0], M.emp.interval[1]) / Math.pow(d, 0.3);
      }
    }

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
        this.nextFlare = this.rng.range(4.5, 7.5) / Math.pow(d, 0.45) / M.flareRate;
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

  /** A loose formation of rocks sharing one heading, with a gap to fly through. */
  private spawnCluster(speed: number): void {
    const sv = edgeSpawn(this.rng, this.level, this.viewHalfW, this.viewHalfH, speed);
    const ux = sv.vx / speed;
    const uy = sv.vy / speed;
    const n = this.rng.int(3, 4 + Math.min(2, Math.floor(this.levelIndex / 8)));
    // Leave one lateral slot empty so there is always a way through.
    const gap = this.rng.int(0, n);
    for (let i = 0; i <= n; i++) {
      if (i === gap) continue;
      const off = (i - n / 2) * 20 + this.rng.range(-4, 4);
      const back = this.rng.range(0, 26);
      const size: 0 | 1 | 2 = this.rng.chance(0.2) ? 2 : this.rng.chance(0.5) ? 1 : 0;
      const h = makeHazard('asteroid', size, sv.x - uy * off - ux * back, sv.y + ux * off - uy * back, sv.vx, sv.vy, this.rng);
      h.gravity = this.level.hazardGravity;
      this.hazards.push(h);
    }
  }

  /** Ice shed by a comet: it always arrives from the sunward side, carried down the tail. */
  private spawnIce(speed: number, size: 0 | 1 | 2): void {
    const M = this.level.mechanics;
    const side = M.streamAngle + Math.sin(this.levelTime * 0.17) * 0.45 + this.rng.range(-0.55, 0.55);
    const sv = edgeSpawn(this.rng, this.level, this.viewHalfW, this.viewHalfH, speed, side);
    // Bias the heading along the stream so the flow reads as a current, not a scatter.
    const fx = -Math.cos(M.streamAngle);
    const fy = -Math.sin(M.streamAngle);
    const vx = sv.vx * 0.55 + fx * speed * 0.45;
    const vy = sv.vy * 0.55 + fy * speed * 0.45;
    const h = makeHazard('ice', size, sv.x, sv.y, vx, vy, this.rng);
    h.gravity = this.level.hazardGravity;
    this.hazards.push(h);
  }

  /** A blob of plasma torn from the donor star, falling toward the compact object. */
  private spawnDonorBlob(): void {
    const c = this.level.companions[0];
    const m = this.attractors[1];
    if (!c || !m) return;
    const dx = this.bx - m.x;
    const dy = this.by - m.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const side = this.rng.range(-52, 52);
    const h = makeHazard('bomb', 0, m.x + ux * (c.radius + 5), m.y + uy * (c.radius + 5), ux * 34 - uy * side, uy * 34 + ux * side, this.rng);
    h.gravity = 1;
    h.entered = true;
    this.hazards.push(h);
    this.note('donor', 'ACCRETION STREAM', 'warn');
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
    const L = this.level;
    const relX = s.x - this.bx;
    const relY = s.y - this.by;
    const shipAngle = Math.atan2(relY, relX);
    const r = Math.max(30, Math.hypot(relX, relY));
    const omega = (s.x * s.vy - s.y * s.vx) / (r * r);
    const telegraph = 2.2 - Math.min(0.5, (L.difficulty - 1) * 0.5);
    // Aim near where the ship will be, so flares demand a reaction - but never dead-on every time.
    const angle = shipAngle + omega * (telegraph + 0.4) + this.rng.range(-1.7, 1.7);
    const width = L.safeMax - L.safeMin;
    this.flares.push({
      angle,
      t: 0,
      telegraph,
      active: 0.85,
      // Flares lick out into the inner band only: a high orbit is the safe answer.
      reach: L.safeMin + this.rng.range(0.2, 0.6) * width + Math.min(14, (L.difficulty - 1) * 14),
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
    const L = this.level;
    const M = L.mechanics;
    const bx = this.bx;
    const by = this.by;
    const live = this.phase === 'active' || this.phase === 'intro';

    // Cryo-plume: rotates with the body, sheds ice particles and energy crystals.
    if (M.plume) {
      this.plumeAngle += M.plume.angularSpeed * dt;
      if (!this.reducedEffects || Math.random() < 0.4) {
        const a = this.plumeAngle + this.fx.range(-M.plume.halfWidth, M.plume.halfWidth) * 0.8;
        const rr = this.fx.range(L.body.radius, M.plume.reach * 0.55);
        const sp = this.fx.range(50, 95);
        this.particles.spawn(bx + Math.cos(a) * rr, by + Math.sin(a) * rr, Math.cos(a) * sp, Math.sin(a) * sp, this.fx.range(0.5, 1.0), '#e8f6ff', 1, 1, P_GLOW, '#3d6bff');
      }
      if (live && !this.demo) {
        this.nextPlumeMote -= dt * (1 + this.seasonK);
        if (this.nextPlumeMote <= 0 && this.motes.length < CONFIG.MAX_MOTES + 4) {
          this.nextPlumeMote = this.rng.range(1.1, 1.9);
          const a = this.plumeAngle + this.rng.range(-0.6, 0.6) * M.plume.halfWidth;
          const rr = this.rng.range(L.safeMin + 6, Math.min(M.plume.reach, L.safeMax) - 6);
          const v = circularSpeed(L.orbitMu, rr) * this.orbitDirection();
          this.motes.push({
            x: bx + Math.cos(a) * rr,
            y: by + Math.sin(a) * rr,
            vx: -Math.sin(a) * v + Math.cos(a) * 6,
            vy: Math.cos(a) * v + Math.sin(a) * 6,
            value: this.rng.chance(0.25) ? 4 : 1,
            life: 9,
            maxLife: 9,
            phase: this.rng.range(0, TAU),
            big: false,
            alive: true,
            waveId: 0,
          });
          this.motes[this.motes.length - 1].big = this.motes[this.motes.length - 1].value > 1;
        }
      }
    }

    // Eruptions: a telegraphed vent, then ballistic ejecta that climb through the band and fall back.
    for (let i = this.eruptions.length - 1; i >= 0; i--) {
      const e = this.eruptions[i];
      e.t += dt;
      const ca = Math.cos(e.angle);
      const sa = Math.sin(e.angle);
      if (e.t < e.telegraph) {
        if (Math.random() < 0.5) {
          const sp = this.fx.range(15, 45);
          this.particles.spawn(bx + ca * (L.body.radius + 1), by + sa * (L.body.radius + 1), ca * sp + this.fx.range(-12, 12), sa * sp + this.fx.range(-12, 12), 0.45, '#ffc94d', 1, 2, P_GLOW, '#ff4d5e');
        }
        continue;
      }
      if (M.eruptions) {
        const r0 = L.body.radius + 3;
        for (let k = 0; k < e.count; k++) {
          // Launch speed for a chosen apoapsis, from energy conservation: v^2 = 2 mu (1/r0 - 1/apo).
          const apo = this.rng.range(M.eruptions.reach[0], M.eruptions.reach[1]);
          const v = Math.sqrt(2 * L.body.mu * (1 / r0 - 1 / apo));
          const side = this.rng.range(-26, 26);
          const h = makeHazard('bomb', 0, bx + ca * r0, by + sa * r0, ca * v - sa * side, sa * v + ca * side, this.rng);
          h.gravity = 1;
          h.entered = true;
          this.hazards.push(h);
        }
        this.sink.sfx('flare');
        this.shake = Math.max(this.shake, 2);
        this.particles.burst(bx + ca * r0, by + sa * r0, this.reducedEffects ? 8 : 18, 20, 90, 0.6, BOMB_COLORS, { flags: P_GLOW });
      }
      this.eruptions.splice(i, 1);
    }

    // Magnetic burst: telegraph, then the thrusters drop out unless the ship is mid-boost.
    if (this.empCharge > 0) {
      this.empCharge -= dt;
      if (this.empCharge <= 0 && M.emp) {
        this.sink.sfx('beam');
        this.shake = Math.max(this.shake, 3);
        this.rings.push({ x: bx, y: by, r: L.body.radius, maxR: 260, t: 0, dur: 0.7, color: PALETTE.cyan });
        if (shipHittable) {
          this.empT = M.emp.duration * (1 - 0.15 * this.mods.stabilizer);
          this.sink.message('THRUSTERS OFFLINE', 'danger');
          this.particles.burst(s.x, s.y, 12, 20, 60, 0.5, ['#3ef2ff', '#e8f0ff'], { flags: P_SPARK });
        } else if (!this.demo && s.visible && s.boostT > 0) {
          this.sink.message('BURST EVADED', 'good');
        }
      }
    }
    if (this.empT > 0 && s.visible && Math.random() < 0.3) {
      this.particles.spawn(s.x + this.fx.range(-4, 4), s.y + this.fx.range(-4, 4), this.fx.range(-20, 20), this.fx.range(-20, 20), 0.25, '#3ef2ff', 1, 4, P_SPARK, '#e8f0ff');
    }

    // Stellar wind streaks.
    if (M.wind && !this.reducedEffects && this.windNow > M.wind.base + 1 && Math.random() < 0.6) {
      const a = this.fx.range(0, TAU);
      const rr = this.fx.range(L.body.radius * 1.2, L.safeMax);
      const sp = 60 + this.windNow * 18;
      this.particles.spawn(bx + Math.cos(a) * rr, by + Math.sin(a) * rr, Math.cos(a) * sp, Math.sin(a) * sp, 0.5, '#bff9ff', 1, 0, P_SPARK, '#3d6bff');
    }

    // Radar ping in the dark: an expanding ring that briefly marks whatever it crosses.
    if (M.dark && !this.demo && s.visible) {
      if (this.pingR > 0) {
        const prev = this.pingR;
        this.pingR += 240 * dt;
        for (const h of this.hazards) {
          const hd = Math.hypot(h.x - s.x, h.y - s.y);
          if (hd >= prev && hd < this.pingR) h.ping = 1.7;
        }
        if (this.pingR > 330) this.pingR = 0;
      } else {
        this.nextPing -= dt;
        if (this.nextPing <= 0) {
          this.pingR = 1;
          this.nextPing = M.dark.pingPeriod / (1 + 0.3 * this.mods.scanner);
          this.note('dark', 'RADAR PING ACTIVE', 'info');
        }
      }
    }

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
          this.particles.spawn(bx + Math.cos(a) * rr, by + Math.sin(a) * rr, Math.cos(a) * 60, Math.sin(a) * 60, 0.45, '#ffc94d', 1, 2, P_GLOW, '#ff4d5e');
        }
        if (shipHittable && !f.hit && s.invuln <= 0 && inWedge(s.x - bx, s.y - by, f.angle, f.halfWidth, reachNow)) {
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
          if (shipHittable && !this.noSpawns && s.invuln <= 0 && b.hitCooldown <= 0 && hitsBeam(s.x - bx, s.y - by, s.radius, a, b.length, b.halfWidth)) {
            b.hitCooldown = 1.0;
            this.environmentHit(14, M.beam?.jet ? 'JET' : 'BEAM', -Math.sin(a) * 6, Math.cos(a) * 6);
          }
          for (const h of this.hazards) {
            if (h.alive && !h.orbiting && hitsBeam(h.x - bx, h.y - by, h.r, a, b.length, b.halfWidth)) {
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
        this.waves.push({ id: this.waveSeq++, r: this.level.body.radius, speed: 150, strength: 13 * M.waveStrength, maxR: 300, charge: 0, shipHit: false });
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
    const shipCollides = !this.demo && !this.noSpawns && s.visible && (this.phase === 'active' || this.phase === 'intro');
    const nearCheck = !this.demo && s.visible && this.phase === 'active';
    const bx = this.bx;
    const by = this.by;
    const bodyR = L.body.radius * this.bodyPulse;

    for (const h of this.hazards) {
      if (!h.alive) continue;
      eulerStep(h, dt, this.attractors, h.gravity, wx, wy);
      h.rot += h.spin * dt;
      h.age += dt;
      if (h.ping > 0) h.ping -= dt;
      if (!h.entered && this.onScreen(h.x, h.y, -h.r)) h.entered = true;

      // Inclined belts: height above the ship's plane varies around the orbit and is zero at the
      // two nodes - the only places where the body can actually be hit.
      if (h.inc > 0) {
        const hx = h.x - bx;
        const hy = h.y - by;
        const z = Math.hypot(hx, hy) * Math.sin(h.inc) * Math.sin(Math.atan2(hy, hx) - h.node);
        h.offPlane = Math.abs(z) > h.r + 7;
      }

      if (h.kind === 'bomb' && Math.random() < (this.reducedEffects ? 0.3 : 0.7)) {
        this.particles.spawn(h.x + this.fx.range(-1, 1), h.y + this.fx.range(-1, 1), h.vx * 0.1, h.vy * 0.1, this.fx.range(0.25, 0.5), '#ffc94d', 1, 2, P_GLOW, '#ff4d5e');
      }

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
      const hr = Math.hypot(h.x - bx, h.y - by);
      // Freshly launched ejecta are still clearing the surface.
      if (hr < bodyR + h.r * 0.4 && !(h.kind === 'bomb' && h.age < 0.4)) {
        if (!this.demo && h.entered && !h.hitPlayer) this.avoided++;
        this.destroyHazard(h, 'body');
        continue;
      }
      let swallowed = false;
      for (let i = 0; i < L.companions.length; i++) {
        const c = L.companions[i];
        const m = this.attractors[i + 1];
        // A donor star does not destroy the plasma it is shedding.
        if (!m || (h.kind === 'bomb' && h.age < 1.2)) continue;
        if (circlesOverlap(h.x, h.y, h.r, m.x, m.y, c.radius)) {
          swallowed = true;
          break;
        }
      }
      if (swallowed) {
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

      if (!shipCollides || h.offPlane) continue;

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
    const massK = h.kind === 'asteroid' ? [0.08, 0.14, 0.2][h.size] : IMPACT_MASS[h.kind];
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
      const n = h.kind === 'asteroid' ? [10, 16, 26][h.size] : BURST_COUNT[h.kind];
      const colors = BURST_COLORS[h.kind];
      const bh = how === 'body' && this.level.body.kind === 'blackhole';
      this.particles.burst(h.x, h.y, this.reducedEffects ? Math.ceil(n / 2) : n, 10, 60 + h.r * 4, 0.7, bh ? ['#9b5cff', '#b77dff', '#e8f0ff'] : colors, {
        baseVx: h.vx * 0.3,
        baseVy: h.vy * 0.3,
        flags: how === 'body' ? P_GLOW : P_SPARK,
        size: h.size === 2 ? 2 : undefined,
      });
      if (h.size > 0 || h.kind === 'comet' || h.kind === 'star') {
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
    let r = near
      ? clamp(shipR + this.rng.range(-38, 38), L.safeMin + 8, L.safeMax - 8)
      : this.rng.range(L.safeMin + 8, L.safeMax - 8);
    // Energy-rich zones (a ring plane) attract most of the spawns: the reward for braving the drag.
    for (const z of L.mechanics.dragZones) {
      const lo = Math.max(z.rMin, L.safeMin) + 4;
      const hi = Math.min(z.rMax, L.safeMax) - 4;
      if (z.moteBias > 1 && hi > lo && this.rng.chance(z.moteBias / (z.moteBias + 1.6))) r = this.rng.range(lo, hi);
    }
    const dir = this.orbitDirection();
    const stream = this.rng.chance(0.22);
    const n = stream ? 4 : 1;
    for (let i = 0; i < n; i++) {
      const ai = a - i * 0.13 * dir;
      const v = circularSpeed(L.orbitMu, r);
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
    const v = circularSpeed(this.level.orbitMu, r);
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
        this.nextMote = (CONFIG.MOTE_INTERVAL * this.rng.range(0.7, 1.3) * (this.demo ? 2.5 : 1)) / L.energyRichness;
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
      const mr = Math.hypot(m.x - this.bx, m.y - this.by);
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
    // Offers are drawn from the sector's own seed, so a level's upgrade opportunities are reproducible.
    const offerRng = new Rng(hash32(this.level.seed, this.milestoneCount, 0x0ffe2));
    while (picks.length < 3 && p.length > 0) {
      const id = offerRng.weighted(p, w);
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
      this.level.companions.length > 0 || this.level.body.orbit ? this.placeAt : null,
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
