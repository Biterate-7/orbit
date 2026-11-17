/**
 * Mission data model.
 *
 * A mission is the objective a sector is played for. Its layout is plain data generated from the
 * level seed (src/generation/missionGenerator.ts), so a sector code still rebuilds the exact same
 * level. Positions are given in the *mission frame*: polar coordinates around the barycentre in
 * which the ship starts at angle 0 travelling towards positive angles. At run time the frame is
 * rotated to wherever the ship actually enters the sector and mirrored if it orbits the other way.
 */
import type { ModifierKind } from '../types';

export type MissionKind =
  | 'survival'
  | 'precision'
  | 'extraction'
  | 'asteroid_run'
  | 'slingshot'
  | 'event_horizon'
  | 'nebula'
  | 'pursuit'
  | 'binary_nav'
  | 'flare_run'
  | 'wormhole'
  | 'anomaly'
  | 'escort'
  | 'mining'
  | 'discovery'
  | 'survey'
  | 'boss_neutron'
  | 'boss_devourer'
  | 'boss_sentinel';

/**
 * How orbit stability is judged.
 *  band - the classic rule: keep the predicted orbit between the two rings.
 *  free - travel missions: only falling into the body or leaving the arena is punished.
 */
export type OrbitRule = 'band' | 'free';

/** A point fixed in the mission frame (omega = 0) or moving on a circular rail around the barycentre. */
export interface Anchor {
  r: number;
  /** Angle at t = 0, mission frame. */
  angle: number;
  /** Angular speed in rad/s (mission frame; positive = the ship's direction of travel). */
  omega: number;
}

/** A gate is radial: two posts at r +- gap/2 on the same ray, flown through tangentially. */
export interface GateSpec {
  anchor: Anchor;
  gap: number;
  /** Radial oscillation of the whole gate (dynamic obstacle), world units; 0 = still. */
  osc: number;
  oscPeriod: number;
}

/**
 * gate / beacon / dock are the original three; the rest belong to the newer missions:
 *   ore - a rock to mine, convoy - the ship being escorted, signal - a hidden source to find,
 *   scan - a survey point riding with a planet or moon, relay - a navigation relay.
 */
export type TargetKind = 'gate' | 'beacon' | 'dock' | 'ore' | 'convoy' | 'signal' | 'scan' | 'relay';

export interface TargetSpec {
  kind: TargetKind;
  anchor: Anchor;
  /** Capture radius. */
  r: number;
  /** Hidden until the objective unlocks it (extraction dock). */
  hidden: boolean;
  /** Boss phase (0-based) this target belongs to. */
  phase?: number;
  /** Display name (a surveyed planet, a convoy call sign). */
  label?: string;
  /** Index of the level companion this target rides with (survey points), or -1. */
  companion?: number;
  /** Rich ore vein / high-value target. */
  rich?: boolean;
}

export interface CloudSpec {
  x: number;
  y: number;
  r: number;
}

export interface WormholeSpec {
  a: Anchor;
  b: Anchor;
  r: number;
  /** The exit sets the ship on the circular orbit of the far mouth, whatever shape it came in on. */
  circular?: boolean;
}

/** A magnetic region: velocity is rotated at `turn` rad/s while inside (v x B), sign = polarity. */
export interface FieldSpec {
  anchor: Anchor;
  r: number;
  turn: number;
}

/** cache = a hidden supply cache: invisible (and out of reach) without a Deep-Space Scanner. */
export type PickupKind = 'shard' | 'fuel' | 'aegis' | 'repair' | 'cell' | 'charge' | 'cache';

export interface PickupSpec {
  kind: PickupKind;
  anchor: Anchor;
}

export interface MineSpec {
  anchor: Anchor;
}

/** A ring of rock on Keplerian orbits with empty arcs to fly through. */
export interface RockBeltSpec {
  radius: number;
  spread: number;
  count: number;
  /** +1 = with the ship, -1 = retrograde. */
  dir: 1 | -1;
  /** Empty arcs: centre angle (mission frame) and angular width. */
  gaps: { angle: number; width: number }[];
  /** 0 = all small, 1 = mixed. */
  large: number;
}

export interface WaveSpec {
  duration: number;
  /** Hazard systems switched on during this wave. */
  mods: ModifierKind[];
  /** Spawn-rate multiplier. */
  rate: number;
}

/** 'feat' and 'feat2' are mission-specific challenges; their wording lives in the BonusSpec label. */
export type BonusId = 'nohit' | 'par' | 'shards' | 'assist' | 'fuel' | 'quota' | 'clean' | 'noburn' | 'kill' | 'deep' | 'feat' | 'feat2';

export interface BonusSpec {
  id: BonusId;
  label: string;
}

/** Numbers specific to one mission family. Unused members are 0. */
export interface MissionParams {
  /** Extraction: energy to collect. Survival: waves. */
  quota: number;
  /** Event horizon / Devourer: fractional growth of the hole per second. */
  growth: number;
  /** Event horizon: radius that counts as escaped. */
  escapeR: number;
  /** Docking / node sync: capture radius and seconds needed. */
  captureR: number;
  syncTime: number;
  /** Pursuit: seconds of jump-drive charge; distance beyond which it charges twice as fast. */
  chargeTime: number;
  fastRange: number;
  /** Enemy craft. */
  enemyThrust: number;
  enemyHp: number;
  fireEvery: number;
  boltSpeed: number;
  /** Nebula ion surges (inverted controls) / Devourer gravity surges. */
  surgeEvery: number;
  surgeTime: number;
  /** Neutron core: seconds between gravity waves. */
  waveEvery: number;
  /** Nodes to synchronise in each boss phase. */
  nodes: number[];
  /** Sentinel: heat needed to overheat (seconds inside the corona at full depth). */
  overheat: number;
  /** Nebula: mission-frame angle where the main corridor's burn begins. */
  mouth: number;
  /** How many of the mission's things there are (superflares, rifts, ore loads, survey points). */
  count: number;
  /** A mission-specific reach: shadow half-width (rad), lane half-width, link range, signal range. */
  range: number;
  /** Seconds of hold / dwell the objective needs. */
  hold: number;
  /** Hit points of the thing being protected. */
  hp: number;
  /** Seconds between the mission's own events (superflares, lane shifts, raids). */
  period: number;
}

/** Sector-wide twists the mission director can add on top of any mission. */
export type MutatorId = 'storm' | 'lowfuel' | 'rich' | 'mined' | 'wormholes' | 'magnetic' | 'haste' | 'dense' | 'aegis' | 'salvage';

/** standard = as generated. elite = a tier harder, pays more. pristine = untouched: more to find. anomalous = one more twist than usual. */
export type VariantId = 'standard' | 'elite' | 'pristine' | 'anomalous';

export interface MissionSpec {
  kind: MissionKind;
  /** 1 = first appearance; higher tiers combine more mechanics. */
  tier: number;
  title: string;
  /** One-line objective shown on the intro card. */
  brief: string;
  boss: boolean;
  orbitRule: OrbitRule;
  /** Radius of the playable area (free missions); beyond it the signal is lost. */
  arena: number;
  /** Seconds before the jump drive forces a jump (penalty, no rank); 0 = no limit. */
  window: number;
  /** Seconds for a full time bonus. */
  par: number;
  /** Seconds of engine burn available; 0 = unlimited. */
  fuel: number;
  /** Fuel recovered per second while coasting. */
  fuelRegen: number;
  /** Seconds of trajectory preview. */
  preview: number;
  /** Multiplier on the environment's own stream of incoming hazards (0 = none). */
  ambient: number;
  /** Ship start orbit radius override (0 = the level's own). */
  startR: number;
  /** Mechanic keys this mission adds (for "NEW" callouts). */
  features: string[];
  bonus: BonusSpec[];
  params: MissionParams;
  waves: WaveSpec[];
  gates: GateSpec[];
  targets: TargetSpec[];
  clouds: CloudSpec[];
  /** Guide buoys marking corridors (mission frame, cartesian). */
  buoys: { x: number; y: number; alt: boolean }[];
  wormholes: WormholeSpec[];
  fields: FieldSpec[];
  pickups: PickupSpec[];
  mines: MineSpec[];
  rockBelts: RockBeltSpec[];
  /** Twists added by the mission director (empty for a plain sector). */
  mutators: MutatorId[];
  variant: VariantId;
  /** Multiplier on the credits and score this sector pays (difficulty, variant and mutators). */
  reward: number;
}

export type Rank = 'S' | 'A' | 'B' | 'C' | '-';

/** End-of-sector report. */
export interface MissionDebrief {
  index: number;
  kind: MissionKind;
  title: string;
  boss: boolean;
  success: boolean;
  /** Why a mission failed without killing the ship (forced jump), or ''. */
  failure: string;
  rank: Rank;
  time: number;
  par: number;
  damage: number;
  /** `feat` marks the mission's own challenge (as opposed to the shared ones: no damage, par, shards). */
  bonuses: { label: string; done: boolean; feat?: boolean }[];
  shards: number;
  shardsTotal: number;
  score: number;
  key: number;
  tier: number;
  /** The sector's reward multiplier (difficulty, tier, variant, twists). */
  reward: number;
  /** Credits paid for the sector (filled in by the run). */
  credits: number;
  variant: VariantId;
  mutators: MutatorId[];
  /** Mission-specific tallies for the lifetime statistics. */
  tally: MissionTally;
}

/** What a sector added to the things the profile counts. */
export interface MissionTally {
  /** Rocks mined out. */
  mined: number;
  /** Planets and moons surveyed (names, so a body is only counted once per sector). */
  surveyed: string[];
  /** Hidden signal sources located. */
  signals: number;
  /** Hidden caches recovered. */
  caches: number;
  /** Wormhole transits. */
  transits: number;
  /** Gravity assists flown. */
  assists: number;
}

export interface BossHud {
  name: string;
  phase: number;
  phases: number;
  /** 0..1 remaining. */
  hp: number;
  status: string;
}

export interface ObjectiveHud {
  title: string;
  detail: string;
  progress: number;
  /** Seconds left before the forced jump, or -1. */
  timer: number;
  bonuses: { label: string; state: 0 | 1 | 2 }[];
  shards: number;
  shardsTotal: number;
  boss: BossHud | null;
  fuel: number;
  fuelMax: number;
  /** Short flashing status line (DOCKING 60%, CONTROLS INVERTED ...). */
  alert: string;
}
