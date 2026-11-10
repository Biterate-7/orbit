import type { PermanentId, UpgradeId } from './types';
import { PALETTE } from './config';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  summary: string;
  detail: (nextStack: number) => string;
  max: number;
  color: string;
  unlock: null | { kind: 'level' | 'energy'; value: number; hint: string };
}

/** In-run upgrade modules, offered three at a time at energy milestones. */
export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  stabilizer: {
    id: 'stabilizer',
    name: 'GRAVITY STABILIZER',
    summary: 'Damps radial drift. Stability drains slower and recovers faster.',
    detail: (n) => `-${Math.round((1 - Math.pow(0.74, n)) * 100)}% STABILITY DRAIN · AUTO-CIRCULARIZE`,
    max: 3,
    color: PALETTE.cyan,
    unlock: null,
  },
  hull: {
    id: 'hull',
    name: 'REINFORCED HULL',
    summary: 'Adds armour plating. Raises max hull and patches it.',
    detail: () => '+25 MAX HULL · +25 HULL',
    max: 4,
    color: PALETTE.gray,
    unlock: null,
  },
  magnet: {
    id: 'magnet',
    name: 'MAGNETIC CORE',
    summary: 'Pulls nearby energy particles into the ship.',
    detail: (n) => `PULL RADIUS ${28 + (n - 1) * 22}`,
    max: 3,
    color: PALETTE.violet,
    unlock: null,
  },
  thrusters: {
    id: 'thrusters',
    name: 'ADVANCED THRUSTERS',
    summary: 'Stronger engines and sharper strafing control.',
    detail: (n) => `+${n * 22}% THRUST · +${n * 40}% STRAFE`,
    max: 3,
    color: PALETTE.orange,
    unlock: null,
  },
  shield: {
    id: 'shield',
    name: 'ENERGY SHIELD',
    summary: 'A bubble that absorbs one collision completely.',
    detail: () => '+1 SHIELD CHARGE (MAX 3)',
    max: 6,
    color: PALETTE.cyan,
    unlock: null,
  },
  repair: {
    id: 'repair',
    name: 'REPAIR SYSTEM',
    summary: 'Nanite swarm restores hull integrity.',
    detail: () => 'RESTORE 45% HULL',
    max: 99,
    color: PALETTE.green,
    unlock: null,
  },
  overdrive: {
    id: 'overdrive',
    name: 'OVERDRIVE',
    summary: 'Temporarily floods the engines. More thrust, faster boost, bonus score.',
    detail: () => '20s · x1.5 THRUST · x2.5 BOOST RECHARGE · x1.5 SCORE',
    max: 99,
    color: PALETTE.amber,
    unlock: { kind: 'level', value: 2, hint: 'REACH SECTOR 2' },
  },
  scanner: {
    id: 'scanner',
    name: 'ORBITAL SCANNER',
    summary: 'Detects incoming hazards earlier and plots their paths.',
    detail: (n) => `+${n}.0s EARLY WARNING · HAZARD PATHS`,
    max: 2,
    color: PALETTE.blue,
    unlock: { kind: 'level', value: 3, hint: 'REACH SECTOR 3' },
  },
  temporal: {
    id: 'temporal',
    name: 'TEMPORAL FIELD',
    summary: 'When impact is imminent, hazards briefly slow to a crawl.',
    detail: (n) => `AUTO SLOW-TIME · ${22 - (n - 1) * 5}s COOLDOWN`,
    max: 3,
    color: PALETTE.violet,
    unlock: { kind: 'level', value: 4, hint: 'REACH SECTOR 4' },
  },
  iontrail: {
    id: 'iontrail',
    name: 'ION TRAIL',
    summary: 'Charged exhaust. Longer flight path preview and a small speed bonus.',
    detail: () => '+60% PATH PREVIEW · +10% THRUST · +20% BOOST',
    max: 2,
    color: PALETTE.cyan,
    unlock: { kind: 'energy', value: 60, hint: 'COLLECT 60 ENERGY (LIFETIME)' },
  },
};

export const UPGRADE_ORDER: UpgradeId[] = [
  'stabilizer',
  'hull',
  'magnet',
  'thrusters',
  'shield',
  'repair',
  'overdrive',
  'scanner',
  'temporal',
  'iontrail',
];

export const BASE_UNLOCKED: UpgradeId[] = ['stabilizer', 'hull', 'magnet', 'thrusters', 'shield', 'repair'];

export interface PermanentDef {
  id: PermanentId;
  name: string;
  description: string;
  effect: (level: number) => string;
  icon: string;
  color: string;
}

export const PERMANENT_COSTS = [25, 55, 95, 150, 230];
export const PERMANENT_MAX = 5;

export const PERMANENTS: PermanentDef[] = [
  {
    id: 'thrusters',
    name: 'THRUSTERS',
    description: 'Main engine output and boost recharge.',
    effect: (l) => (l === 0 ? 'STOCK ENGINES' : `+${l * 5}% THRUST · -${l * 6}% BOOST COOLDOWN`),
    icon: 'thrusters',
    color: PALETTE.orange,
  },
  {
    id: 'hull',
    name: 'HULL',
    description: 'Hull integrity at launch.',
    effect: (l) => `${100 + l * 12} MAX HULL`,
    icon: 'hull',
    color: PALETTE.gray,
  },
  {
    id: 'collector',
    name: 'COLLECTOR',
    description: 'Energy pickup radius and credit conversion.',
    effect: (l) => (l === 0 ? 'STANDARD INTAKE' : `+${l * 4} PICKUP RADIUS · +${l * 8}% CREDITS`),
    icon: 'collector',
    color: PALETTE.violet,
  },
  {
    id: 'shields',
    name: 'SHIELDS',
    description: 'Launch with a shield charge that slowly regenerates.',
    effect: (l) => (l === 0 ? 'NO SHIELD' : l === 1 ? '1 SHIELD AT LAUNCH' : `1 SHIELD · RECHARGES EVERY ${shieldRechargeFor(l)}s`),
    icon: 'shield',
    color: PALETTE.cyan,
  },
  {
    id: 'reactor',
    name: 'REACTOR',
    description: 'Start each run with stored energy.',
    effect: (l) => (l === 0 ? 'COLD START' : `+${l * 3} STARTING ENERGY`),
    icon: 'reactor',
    color: PALETTE.amber,
  },
];

export function shieldRechargeFor(level: number): number {
  if (level < 2) return 0;
  return [0, 0, 80, 64, 50, 40][level] ?? 40;
}

export type Stacks = Record<UpgradeId, number>;

export function emptyStacks(): Stacks {
  return {
    stabilizer: 0,
    hull: 0,
    magnet: 0,
    thrusters: 0,
    shield: 0,
    overdrive: 0,
    repair: 0,
    scanner: 0,
    temporal: 0,
    iontrail: 0,
  };
}

export interface RunMods {
  thrustMul: number;
  lateralMul: number;
  stabilizer: number;
  magnetRadius: number;
  pickupRadius: number;
  scanner: number;
  temporal: number;
  ionTrail: number;
  boostCdMul: number;
  boostDvMul: number;
  creditMul: number;
  shieldRecharge: number;
  trajectoryMul: number;
}

export function computeMods(stacks: Stacks, perm: Record<PermanentId, number>): RunMods {
  return {
    thrustMul: (1 + 0.05 * perm.thrusters) * (1 + 0.22 * stacks.thrusters) * (1 + 0.1 * stacks.iontrail),
    lateralMul: 1 + 0.4 * stacks.thrusters,
    stabilizer: stacks.stabilizer,
    magnetRadius: stacks.magnet > 0 ? 28 + (stacks.magnet - 1) * 22 : 0,
    pickupRadius: 10 + perm.collector * 4,
    scanner: stacks.scanner,
    temporal: stacks.temporal,
    ionTrail: stacks.iontrail,
    boostCdMul: 1 - 0.06 * perm.thrusters,
    boostDvMul: 1 + 0.2 * stacks.iontrail,
    creditMul: 1 + 0.08 * perm.collector,
    shieldRecharge: shieldRechargeFor(perm.shields),
    trajectoryMul: 1 + 0.6 * stacks.iontrail,
  };
}
