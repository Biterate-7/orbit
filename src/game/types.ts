import type { MissionDebrief, MissionKind, MissionSpec, ObjectiveHud, Rank } from './missions/types';

export type { MissionDebrief, MissionKind, MissionSpec, ObjectiveHud, Rank };

/** Rendering / physics family of a celestial body. */
export type BodyKind = 'planet' | 'gasgiant' | 'star' | 'neutron' | 'blackhole' | 'smallbody';

export type ModifierKind =
  | 'belt' // orbiting rocks
  | 'asteroids' // dense crossing asteroid field
  | 'flares' // solar flare wedges
  | 'beams' // rotating pulsar beams / relativistic jets
  | 'fog' // nebula, reduced visibility
  | 'storm' // ion / dust storm wind gusts
  | 'debris' // fast debris swarms
  | 'comets' // comet showers
  | 'waves' // gravity / shock waves
  | 'moon'; // extra gravitating companion

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

export type PermanentId = 'thrusters' | 'hull' | 'collector' | 'shields' | 'reactor' | 'tanks' | 'tractor' | 'heatshield' | 'gyro' | 'phase';

/** Optional difficulty modifiers chosen before a run. */
export type RunModifierId = 'glass' | 'swarm' | 'blind' | 'dry' | 'calm';

/** How a body's surface is shaded by the pixel renderer. */
export type SurfaceStyle = 'rock' | 'bands' | 'ice' | 'lava' | 'ocean' | 'locked' | 'dark' | 'plasma' | 'lumpy';

export interface RingLook {
  /** Inner / outer edge in world units (measured from the body centre). */
  inner: number;
  outer: number;
  ramp: string[];
  gap: boolean;
}

/** Everything the renderer needs to draw a body. Built from catalogue data by the generator. */
export interface BodyLook {
  surface: SurfaceStyle;
  /** Colour ramp from darkest to brightest (5-8 steps). */
  ramp: string[];
  /** Atmosphere rim colour on the lit limb, or null. */
  rim: string | null;
  glow: string;
  /** Glow radius in body radii. */
  glowScale: number;
  glowIntensity: number;
  ring: RingLook | null;
  /** 0..1 silhouette irregularity (small bodies). */
  lumpiness: number;
}

export interface BodySpec {
  kind: BodyKind;
  /** Short class label, e.g. "RED DWARF". */
  label: string;
  /** Surface / event horizon radius in world units. */
  radius: number;
  /** Gravitational parameter G*M. */
  mu: number;
  /** Radius of the damaging zone (corona, accretion disk, radiation). 0 if none. */
  heatRadius: number;
  heatDps: number;
  /** Visual spin speed (radians of texture per second). */
  spin: number;
  look: BodyLook;
  /** Game-over line when the ship hits this body. */
  deathText: string;
  /** Circular path of the body itself around the barycentre (binary systems), or null. */
  orbit: { radius: number; period: number; phase: number } | null;
}

/** A gravitating body moving on a fixed Keplerian path ("on rails"): a moon, companion star or planet. */
export interface CompanionSpec {
  kind: 'moon' | 'star' | 'planet';
  /** Real name when the companion is a catalogued object (drawn as a tiny label). */
  name: string | null;
  /** Semi-major axis of its path around the barycentre, world units. */
  orbitRadius: number;
  ecc: number;
  argPeri: number;
  /** Seconds per revolution; negative = clockwise. */
  period: number;
  /** Mean anomaly at t = 0. */
  phase: number;
  radius: number;
  mu: number;
  heatRadius: number;
  heatDps: number;
  look: BodyLook | null;
}

/** A ring of bodies on Keplerian orbits around the primary. */
export interface BeltSpec {
  radius: number;
  spread: number;
  count: number;
  dir: 1 | -1;
  ecc: number;
  /** Inclination to the ship's orbital plane, radians. Inclined bodies only threaten the ship near the nodes. */
  inclination: number;
  node: number;
  kind: 'asteroid' | 'debris' | 'star';
}

/** Annulus that bleeds orbital speed (ring particles, upper atmosphere). */
export interface DragZone {
  rMin: number;
  rMax: number;
  /** Fraction of velocity lost per second. */
  k: number;
  /** Multiplier on energy mote spawns inside the zone. */
  moteBias: number;
  label: string;
  style: 'ring' | 'haze';
  color: string;
}

export interface BeamConfig {
  count: number;
  angularSpeed: number;
  off: number;
  charge: number;
  on: number;
  halfWidth: number;
  /** Relativistic jet styling (black holes) instead of a pulsar beam. */
  jet: boolean;
}

/** Environment-specific mechanics. Null / empty members are simply inactive. */
export interface LevelMechanics {
  belts: BeltSpec[];
  dragZones: DragZone[];
  beam: BeamConfig | null;
  /** Rotating cryo-plume: pushes the ship outward and carries energy crystals. */
  plume: { halfWidth: number; angularSpeed: number; reach: number; kick: number } | null;
  /** Ballistic ejecta launched from the surface. `reach` is the apoapsis range of the ejecta. */
  eruptions: { interval: [number, number]; count: [number, number]; reach: [number, number] } | null;
  /** Permanently irradiated sector facing the host star. */
  scorch: { angle: number; halfWidth: number; reach: number; dps: number } | null;
  /** Starless darkness: only a small bubble around the ship is visible; radar pings reveal hazards. */
  dark: { radius: number; pingPeriod: number } | null;
  /** Radiation pressure pushing outward, with gusts. */
  wind: { base: number; gust: number; period: number } | null;
  /** Magnetic bursts that knock the thrusters offline. */
  emp: { interval: [number, number]; duration: number; telegraph: number } | null;
  /** Stellar pulsation: the heat zone swells and shrinks. */
  pulsation: { period: number; amp: number } | null;
  /** Tangential drag near a spinning black hole (deceleration at the start radius, u/s^2). */
  frameDrag: number;
  /** Score multiplier for holding a deep orbit. */
  depthBonus: boolean;
  /** Activity cycle driven by the body's own eccentric orbit (Kepler's equation with the real eccentricity). */
  season: { period: number; ecc: number } | null;
  /** How edge hazards arrive. 'donor' = shed by the first companion towards the primary. */
  spawn: 'edge' | 'clusters' | 'stream' | 'donor';
  streamAngle: number;
  /** Fictional: the central mass itself oscillates. */
  muWobble: { amp: number; period: number } | null;
  /** Shock-wave strength multiplier when the 'waves' modifier is active. */
  waveStrength: number;
  /** Flare frequency multiplier when the 'flares' modifier is active. */
  flareRate: number;
}

export interface LevelTheme {
  bg: string;
  nebulaA: string;
  nebulaB: string;
  nebulaStrength: number;
  accent: string;
  ripple: string;
}

export interface BackdropStar {
  /** Position as a fraction of the view (0..1). */
  x: number;
  y: number;
  color: string;
  size: number;
}

/** Static composition behind the playfield. */
export interface BackgroundSpec {
  starSeed: number;
  /** 1 = the default density. */
  starDensity: number;
  starColors: string[];
  /** Host star(s) seen from a planet. */
  hostStars: BackdropStar[];
  /** Number of faint background galaxies (deep-field levels). */
  galaxies: number;
  /** A diagonal band of unresolved stars (inside a galaxy). */
  band: boolean;
  /** Catalogue id whose pixel sprite shapes the nebula layer, when one exists. */
  spriteId: string | null;
  /** Fog colour for low-visibility levels. */
  fogColor: string;
  /** Rock palette for this level's asteroids (dark -> bright, 5 steps). */
  rockRamp: string[];
}

export type IdentityKind = 'REAL OBJECT' | 'PROCEDURAL VARIANT' | 'FICTIONAL OBJECT';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type EnvFamily = 'planetary' | 'stellar' | 'extreme';

/** Who / what the level is about. */
export interface LevelIdentity {
  kind: IdentityKind;
  /** Catalogue id for real objects, a generated id otherwise. */
  objectId: string;
  objectName: string;
  /** Real-world class of the object, e.g. "Main-belt asteroid". */
  objectClass: string;
  /** Database the object came from, or null for invented settings. */
  source: string | null;
  environment: string;
  environmentLabel: string;
  family: EnvFamily;
  orbit: string;
  orbitLabel: string;
  rarity: Rarity;
  /** One-line plain-language description of the environment. */
  description: string;
}

export interface LevelDef {
  index: number;
  seed: number;
  /** Re-creatable identifier: catalogue version, sector index and seed. */
  code: string;
  name: string;
  /** Short descriptive subtitle for the intro card. */
  tagline: string;
  /** e.g. "SECTOR 007 // PULSAR". */
  classification: string;
  identity: LevelIdentity;
  body: BodySpec;
  companions: CompanionSpec[];
  /** Mass the ship's orbit is measured against (everything inside the safe band). */
  orbitMu: number;
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
  mechanics: LevelMechanics;
  /** Keys of every hazard system and mechanic active in this level (used for "NEW" callouts). */
  mechanicKeys: string[];
  /** Multiplier on how fast orbit stability drains when the orbit is off (rises slowly with depth). */
  stabilityDrain: number;
  /** Eccentricity of the orbit the ship is injected on. */
  startEcc: number;
  /** How generously this sector yields energy (and therefore upgrades); 1 = average. Seeded per level. */
  energyRichness: number;
  /** Mechanics shown as "NEW" in the intro the first time they appear in a run. */
  newMechanics: string[];
  theme: LevelTheme;
  background: BackgroundSpec;
  /** What this sector is played for. */
  mission: MissionSpec;
}

export type HazardKind = 'asteroid' | 'debris' | 'comet' | 'bomb' | 'ice' | 'star' | 'bolt';

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
  /** Orbital inclination / ascending node for out-of-plane belt bodies (0 = in the ship's plane). */
  inc: number;
  node: number;
  /** True while an inclined body is above or below the ship's plane and cannot be hit. */
  offPlane: boolean;
  /** Seconds a radar ping keeps this hazard highlighted in the dark. */
  ping: number;
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

/** A pending surface eruption (telegraphed before the ejecta launch). */
export interface Eruption {
  angle: number;
  t: number;
  telegraph: number;
  count: number;
}

export type StabilityReason = 'DECAYING' | 'ESCAPING' | 'TOO CLOSE' | 'TOO FAR' | 'HEAT' | 'SIGNAL LOST' | 'DRAG' | null;

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
  objective: ObjectiveHud;
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
  identity: LevelIdentity;
  /** True the first time the player ever meets this object. */
  discovery: boolean;
  key: number;
  missionKind: MissionKind;
  missionTitle: string;
  missionBrief: string;
  boss: boolean;
  /** True the first time this mission type is played in this run. */
  newMission: boolean;
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
  /** Names of objects catalogued for the first time during this run. */
  discoveries: string[];
  /** Titles of milestones completed during this run. */
  milestones: string[];
  missionsCompleted: number;
  bossesDefeated: string[];
  shards: number;
  /** Rank of every sector completed, in order. */
  ranks: Rank[];
  /** Ship parts unlocked by this run. */
  partsUnlocked: string[];
  scoreMultiplier: number;
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
  | 'heat'
  | 'gate'
  | 'warp'
  | 'pickup'
  | 'alarm'
  | 'dock'
  | 'bosshit';
