export type BodyKind = 'planet' | 'redgiant' | 'neutron' | 'blackhole' | 'gasgiant';

export type ModifierKind =
  | 'belt' // orbiting rocks in the outer band
  | 'asteroids' // dense crossing asteroid field
  | 'flares' // solar flare wedges
  | 'beams' // rotating pulsar / jet beams
  | 'fog' // nebula, reduced visibility
  | 'storm' // ion storm wind gusts
  | 'debris' // fast debris swarms
  | 'comets' // comet showers
  | 'waves' // gravity shockwaves
  | 'moon'; // second gravitating body

export type UpgradeId =
  | 'stabilizer'
  | 'hull'
  | 'magnet'
  | 'thrusters'
  | 'shield'
  | 'overdrive'
  | 'repair'
  | 'scanner'
  | 'temporal'
  | 'iontrail';

export type PermanentId = 'thrusters' | 'hull' | 'collector' | 'shields' | 'reactor';

export interface BodySpec {
  kind: BodyKind;
  /** Surface / event horizon radius in world units. */
  radius: number;
  /** Gravitational parameter G*M. */
  mu: number;
  /** Radius of the damaging zone (corona, accretion disk, radiation). 0 if none. */
  heatRadius: number;
  heatDps: number;
  /** Visual spin speed (radians of texture per second). */
  spin: number;
}

export interface MoonSpec {
  orbitRadius: number;
  radius: number;
  mu: number;
  angularSpeed: number;
  phase: number;
}

export interface LevelTheme {
  bg: string;
  nebulaA: string;
  nebulaB: string;
  nebulaStrength: number;
  accent: string;
  ripple: string;
}

export interface LevelDef {
  index: number;
  seed: number;
  name: string;
  /** Short descriptive subtitle for the intro card. */
  tagline: string;
  /** e.g. "RED GIANT // COMET SHOWER" for procedural levels. */
  classification: string;
  body: BodySpec;
  moon: MoonSpec | null;
  safeMin: number;
  safeMax: number;
  startRadius: number;
  outerLimit: number;
  duration: number;
  difficulty: number;
  hazardGravity: number;
  thrustScale: number;
  asteroidInterval: [number, number];
  asteroidSpeed: [number, number];
  asteroidSizeWeights: [number, number, number];
  modifiers: ModifierKind[];
  /** Mechanics shown as "NEW" in the intro the first time they appear in a run. */
  newMechanics: string[];
  theme: LevelTheme;
}

export type HazardKind = 'asteroid' | 'debris' | 'comet';

export interface Hazard {
  id: number;
  kind: HazardKind;
  size: 0 | 1 | 2;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  spin: number;
  variant: number;
  damage: number;
  gravity: number;
  orbiting: boolean;
  alive: boolean;
  entered: boolean;
  hitPlayer: boolean;
  nearArmed: boolean;
  nearAwarded: boolean;
  age: number;
  warnTime: number;
  waveId: number;
}

export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  life: number;
  maxLife: number;
  phase: number;
  big: boolean;
  alive: boolean;
  waveId: number;
}

export interface Flare {
  angle: number;
  t: number;
  telegraph: number;
  active: number;
  reach: number;
  halfWidth: number;
  hit: boolean;
}

export interface GravityWave {
  id: number;
  r: number;
  speed: number;
  strength: number;
  maxR: number;
  charge: number;
  shipHit: boolean;
}

export interface StormState {
  state: 'idle' | 'warn' | 'active';
  t: number;
  dirX: number;
  dirY: number;
  strength: number;
  next: number;
}

export interface BeamState {
  angle: number;
  angularSpeed: number;
  cycleT: number;
  off: number;
  charge: number;
  on: number;
  count: number;
  length: number;
  halfWidth: number;
  hitCooldown: number;
}

export type StabilityReason = 'DECAYING' | 'ESCAPING' | 'TOO CLOSE' | 'TOO FAR' | 'HEAT' | 'SIGNAL LOST' | null;

export type MessageTone = 'info' | 'warn' | 'danger' | 'good' | 'upgrade';

export interface HudMessage {
  id: number;
  text: string;
  tone: MessageTone;
  time: number;
}

export interface HudState {
  level: number;
  levelName: string;
  levelProgress: number;
  levelPhase: string;
  score: number;
  time: number;
  hull: number;
  hullMax: number;
  shield: number;
  shieldMax: number;
  stability: number;
  stabilityReason: StabilityReason;
  energy: number;
  milestonePrev: number;
  milestoneNext: number;
  boostReady: boolean;
  boostCharge: number;
  overdrive: number;
  temporalReady: boolean;
  hasTemporal: boolean;
  combo: number;
  message: HudMessage | null;
}

export interface UpgradeOffer {
  id: UpgradeId;
  name: string;
  description: string;
  detail: string;
  stack: number;
  max: number;
  color: string;
}

export interface LevelIntro {
  index: number;
  name: string;
  tagline: string;
  classification: string;
  newMechanics: string[];
  key: number;
}

export interface RunSummary {
  cause: string;
  level: number;
  time: number;
  score: number;
  energy: number;
  avoided: number;
  destroyed: number;
  nearMisses: number;
  creditsEarned: number;
  newBestScore: boolean;
  newBestLevel: boolean;
  newBestTime: boolean;
  unlocked: UpgradeId[];
  upgrades: { id: UpgradeId; stacks: number }[];
}

export type SfxName =
  | 'collide'
  | 'destroy'
  | 'energy'
  | 'upgrade'
  | 'offer'
  | 'level'
  | 'clear'
  | 'gameover'
  | 'boost'
  | 'warning'
  | 'click'
  | 'hover'
  | 'nearmiss'
  | 'shield'
  | 'flare'
  | 'beam'
  | 'wave'
  | 'temporal'
  | 'explode'
  | 'critical'
  | 'heat';
