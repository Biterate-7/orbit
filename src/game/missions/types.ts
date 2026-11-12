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

export type TargetKind = 'gate' | 'beacon' | 'dock';

export interface TargetSpec {
  kind: TargetKind;
  anchor: Anchor;
  /** Capture radius. */
  r: number;
  /** Hidden until the objective unlocks it (extraction dock). */
  hidden: boolean;
  /** Boss phase (0-based) this target belongs to. */
  phase?: number;
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
}

/** A magnetic region: velocity is rotated at `turn` rad/s while inside (v x B), sign = polarity. */
export interface FieldSpec {
  anchor: Anchor;
  r: number;
  turn: number;
}

export type PickupKind = 'shard' | 'fuel' | 'aegis' | 'repair' | 'cell' | 'charge';

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

export type BonusId = 'nohit' | 'par' | 'shards' | 'assist' | 'fuel' | 'quota' | 'clean' | 'noburn' | 'kill' | 'deep';

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
}

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
  bonuses: { label: string; done: boolean }[];
  shards: number;
  shardsTotal: number;
  score: number;
  key: number;
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
